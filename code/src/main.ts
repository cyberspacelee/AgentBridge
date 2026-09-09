import { hostRequest } from "./gateway/system.js";
import { gatewayUrl } from "../host/gateway.mjs";
import { readConfig } from "./config.js";
import { Store } from "./storage/sqlite.js";
import { SessionRuntime } from "./runtime/sessions.js";
import { OpenCodeAdapter } from "./engines/opencode/adapter.js";
import { PiAdapter } from "./engines/pi/adapter.js";
import { CodexAdapter } from "./engines/codex/adapter.js";
import { GrokAdapter } from "./engines/grok/adapter.js";
import { createServer } from "./gateway/server.js";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
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
  runtime.onFatal = () => {
    // Reopen durable state only after native processes are stopped; never replay uncertain work.
    if (config.supervised && process.connected)
      void hostRequest("lifecycle", { action: "restart", mode: "stop" }).catch(() => {
        runtime.log("error", "recovery", "RESTART_FAILED", "Automatic recovery failed; restart the gateway manually");
      });
  };
  try {
    await runtime.start();
    for (const agent of runtime.runtimes.views()) if (!agent.managed) runtime.runtimes.action(agent.id, "detect");
    await server.listen({ host: config.host, port: config.port });
  } catch (error) {
    await server.close();
    throw error;
  }
  return {
    server,
    runtime,
    drain: () => {
      runtime.lifecycle = "draining";
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  if (!process.connected || process.env.AGENT_SUPERVISED !== "true") throw new Error("请通过 pnpm start 或 pnpm dev 启动网关");
  let interrupted = false;
  const interruptStartup = () => { interrupted = true; };
  const startupMessage = (message: unknown) => {
    if (message && typeof message === "object" && "type" in message && ["shutdown", "drain"].includes(String(message.type))) interruptStartup();
  };
  process.once("disconnect", interruptStartup);
  process.on("message", startupMessage);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, interruptStartup);
  const { server, runtime, drain } = await startGateway();
  process.removeListener("disconnect", interruptStartup);
  process.removeListener("message", startupMessage);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.removeListener(signal, interruptStartup);
  let closing: Promise<void> | undefined;
  let draining = false;
  const close = () => {
    runtime.lifecycle = "stopping";
    return (closing ??= server
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
  };
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
            (runtime.runtimes.views().every((item) => !item.operation) && runtime
              .agentViews()
              .every((agent) => !agent.activeRuns && !agent.queuedRuns))
          ) {
            clearInterval(timer);
            void close();
          }
        }, 250);
      }
    });
    const address = server.server.address();
    if (interrupted || !process.connected) void close();
    else if (address && typeof address !== "string")
      process.send({ type: "ready", url: gatewayUrl(runtime.config.host, address.port) });
  }
}
