import { readConfig } from "./config.js";
import { Store } from "./storage/sqlite.js";
import { SessionRuntime } from "./runtime/sessions.js";
import { OpenCodeAdapter } from "./engines/opencode/adapter.js";
import { PiAdapter } from "./engines/pi/adapter.js";
import { createServer } from "./gateway/server.js";

const config = readConfig();
const adapters = {
  opencode: () => new OpenCodeAdapter(config),
  pi: () => new PiAdapter(config),
};
const store = new Store(config.database, config.limits.maxEventBytes);
const runtime = new SessionRuntime(store, adapters[config.engine](), config);
await runtime.start();
const server = createServer(runtime);
try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  await server.close();
  throw error;
}
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void server.close().catch(() => {
      process.exitCode = 1;
    });
  });
