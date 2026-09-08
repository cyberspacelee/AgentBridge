import { readConfig } from "./config.js";
import { Store } from "./storage/sqlite.js";
import { SessionRuntime } from "./runtime/sessions.js";
import { OpenCodeAdapter } from "./engines/opencode/adapter.js";
import { PiAdapter } from "./engines/pi/adapter.js";
import { CodexAdapter } from "./engines/codex/adapter.js";
import { GrokAdapter } from "./engines/grok/adapter.js";
import { createServer } from "./gateway/server.js";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { GatewayError } from "./errors.js";
export async function startGateway(config = readConfig()) {
  const adapters = [
    new OpenCodeAdapter(config),
    new PiAdapter(config),
    new CodexAdapter(config),
    new GrokAdapter(config),
  ];
  const store = new Store(config.database, config.limits.maxEventBytes);
  const runtime = new SessionRuntime(
    store,
    adapters.find((adapter) => adapter.id === config.engine)!,
    config,
    adapters.filter((adapter) => adapter.id !== config.engine),
  );
  const server = createServer(runtime);
  let draining = false;
  server.addHook("onRequest", async (request) => {
    if (
      draining &&
      request.method === "POST" &&
      /^(?:\/api\/tasks(?:\/[^/]+\/runs)?|\/session(?:\/[^/]+\/prompt_async)?)$/.test(
        request.url.split("?")[0]!,
      )
    )
      throw new GatewayError(
        "SERVICE_UNAVAILABLE",
        "Gateway is waiting for tasks before exit",
        503,
      );
  });
  try {
    await runtime.start();
    await server.listen({ host: config.host, port: config.port });
  } catch (error) {
    await server.close();
    throw error;
  }
  return {
    server,
    runtime,
    drain: () => {
      draining = true;
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const { server, runtime, drain } = await startGateway();
  let closing: Promise<void> | undefined;
  let draining = false;
  const close = () =>
    (closing ??= server
      .close()
      .catch((error: unknown) => {
        process.exitCode = 1;
        process.stderr.write(
          `${error instanceof Error ? error.message : "Gateway shutdown failed"}\n`,
        );
      })
      .finally(() => {
        if (process.connected) process.disconnect();
      }));
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void close();
    });
  if (process.send) {
    process.once("disconnect", () => {
      void close();
    });
    process.on("message", (message: unknown) => {
      if (!message || typeof message !== "object" || !("type" in message))
        return;
      if (message.type === "shutdown") void close();
      if (message.type === "drain" && !draining) {
        draining = true;
        drain();
        const timer = setInterval(() => {
          if (
            closing ||
            runtime
              .agentViews()
              .every((agent) => !agent.activeRuns && !agent.queuedRuns)
          ) {
            clearInterval(timer);
            void close();
          }
        }, 250);
      }
    });
    const address = server.server.address();
    if (address && typeof address !== "string")
      process.send({ type: "ready", url: `http://127.0.0.1:${address.port}` });
  }
}
