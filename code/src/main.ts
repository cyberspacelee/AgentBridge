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
import { LlmProxy, registerLlmProxy, unregisterLlmProxy } from "./llm-proxy/server.js";
import { readSettings } from "./settings.js";
import { disconnectHost, hostConnected, isUtilityProcess, onHostDisconnect, onHostMessage, sendHost } from "./host/control.js";
export async function startGateway(config = readConfig()) {
  const store = new Store(config.database, config.limits.maxEventBytes);
  const proxy = new LlmProxy(config, () => readSettings(config), (record) => {
    store.transaction(() => store.emit({ type: "llm.request.finished", properties: record }));
  });
  await proxy.start();
  registerLlmProxy(config, proxy);
  const adapters = [
    new OpenCodeAdapter(config),
    new PiAdapter(config),
    new CodexAdapter(config),
    new GrokAdapter(config),
  ];
  const runtime = new SessionRuntime(
    store,
    adapters.find((adapter) => adapter.id === config.engine)!,
    config,
    adapters.filter((adapter) => adapter.id !== config.engine),
  );
  const server = createServer(runtime);
  server.addHook("onClose", async () => {
    unregisterLlmProxy(config);
    await proxy.close();
  });
  runtime.onFatal = () => {
    // Reopen durable state only after native processes are stopped; never replay uncertain work.
    if (config.supervised && hostConnected())
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
    unregisterLlmProxy(config);
    await proxy.close();
    throw error;
  }
  return {
    server,
    proxy,
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
  if (!hostConnected() || process.env.AGENT_SUPERVISED !== "true") throw new Error("请通过 pnpm start 或 pnpm dev 启动网关");
  let interrupted = false;
  const interruptStartup = () => { interrupted = true; };
  const startupMessage = (message: unknown) => {
    if (message && typeof message === "object" && "type" in message && ["shutdown", "drain"].includes(String(message.type))) interruptStartup();
  };
  const removeDisconnect = onHostDisconnect(interruptStartup);
  const removeMessage = onHostMessage(startupMessage);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, interruptStartup);
  const { server, proxy, runtime, drain } = await startGateway();
  removeDisconnect();
  removeMessage();
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
      .finally(async () => {
        unregisterLlmProxy(runtime.config);
        await proxy.close();
        disconnectHost();
        if (isUtilityProcess()) process.exit(0);
      }));
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      void close();
    });
  if (hostConnected()) {
    onHostDisconnect(() => {
      void close();
    });
    onHostMessage((message: unknown) => {
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
    if (interrupted || !hostConnected()) void close();
    else if (address && typeof address !== "string")
      sendHost({ type: "ready", url: gatewayUrl(runtime.config.host, address.port) });
  }
}
