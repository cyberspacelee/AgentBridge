import { EventEmitter } from "node:events";
import { utilityProcess } from "electron";

// Keep Supervisor independent from Electron. This adapter exposes the small
// ChildProcess surface Supervisor already uses for a backend process.
export function spawnUtilityBackend({ modulePath, args = [], cwd, env }) {
  const cleanEnv = Object.fromEntries(Object.entries(env ?? {}).filter(([, value]) => value !== undefined));
  const processHandle = utilityProcess.fork(modulePath, args, {
    cwd,
    env: cleanEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const child = new EventEmitter();
  child.pid = processHandle.pid;
  child.exitCode = null;
  child.signalCode = null;
  child.connected = true;
  child.stdout = processHandle.stdout;
  child.stderr = processHandle.stderr;
  child.send = (message, callback) => {
    if (!child.connected) {
      callback?.(new Error("Backend is disconnected"));
      return false;
    }
    try {
      processHandle.postMessage(message);
      callback?.(null);
      return true;
    } catch (error) {
      callback?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  };
  child.kill = () => {
    child.connected = false;
    return processHandle.kill();
  };
  child.killTree = child.kill;
  processHandle.on("message", (message) => child.emit("message", message));
  processHandle.on("error", (error) => child.emit("error", error));
  processHandle.on("exit", (code) => {
    child.connected = false;
    child.exitCode = code;
    child.emit("exit", code);
  });
  return child;
}
