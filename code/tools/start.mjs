import { loadEnvFile } from "node:process";
import path from "node:path";
import { Supervisor } from "../host/supervisor.mjs";
try { loadEnvFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }
const supervisor = new Supervisor({
  directory: path.resolve(process.env.AGENT_DATA_DIR ?? ".agentbridge"),
  node: process.execPath, args: process.argv.slice(2), cwd: process.cwd(),
  onOutput: (value, stream) => process[stream].write(value),
  onExit: (code) => { process.exitCode = code; },
  onError: (error) => { console.error(error.message); process.exitCode = error.exitCode ?? 1; },
});
try { await supervisor.initialize(); } catch (error) { await supervisor.release(); throw error; }
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void supervisor.stop(); });
try { await supervisor.start(); } catch (error) { console.error(error.message); await supervisor.kill(); await supervisor.release(); process.exitCode = error.exitCode ?? 1; }
