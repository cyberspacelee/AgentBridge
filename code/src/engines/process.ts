import { accessSync, constants, statSync } from "node:fs";
import spawn from "cross-spawn";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import { engineError } from "../errors.js";
import { within } from "../async.js";

export function resolveExecutable(command: string) {
  const paths = path.isAbsolute(command) ? [command] : /[\\/]/.test(command) ? [path.resolve(command)] : (process.env.PATH ?? "").split(path.delimiter).flatMap((directory) => process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")].map((extension) => path.join(directory, command + extension)) : [path.join(directory, command)]);
  for (const candidate of paths) {
      try { accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK); if (statSync(candidate).isFile()) return candidate; }
      catch { /* Continue executable discovery. */ }
    }
  return undefined;
}

const stderrTails = new WeakMap<ChildProcessWithoutNullStreams, string>();
export function processDiagnostic(
  child: ChildProcessWithoutNullStreams,
): string {
  return `exit=${child.exitCode ?? "pending"}, signal=${child.signalCode ?? "none"}${stderrTails.get(child) ? `; stderr: ${stderrTails.get(child)}` : ""}`;
}

export function startProcess(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): ChildProcessWithoutNullStreams {
  const childEnvironment = { ...env };
  if (env.AGENT_RUNTIME_NODE) {
    const searchPath = env.PATH ?? env[Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH"] ?? "";
    for (const key of Object.keys(childEnvironment)) if (key.toLowerCase() === "path") delete childEnvironment[key];
    childEnvironment.PATH = `${path.dirname(env.AGENT_RUNTIME_NODE)}${path.delimiter}${searchPath}`;
  }
  const child = spawn(command, args, {
    cwd,
    env: childEnvironment,
    stdio: "pipe",
    windowsHide: true,
    detached: process.platform !== "win32",
  }) as ChildProcessWithoutNullStreams;
  if (child.pid && process.connected) process.send?.({ type: "engine-started", pid: child.pid }, () => {});
  child.once("exit", () => {
    if (child.pid && process.platform !== "win32") {
      try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") process.stderr.write("Engine descendant cleanup failed\n");
      }
    }
    if (process.connected) process.send?.({ type: "engine-exited", pid: child.pid }, () => {});
  });
  // Drain stderr and retain a bounded tail for startup/crash diagnostics.
  child.stderr.on("data", (chunk) => {
    stderrTails.set(
      child,
      ((stderrTails.get(child) ?? "") + String(chunk)).slice(-8192),
    );
  });
  return child;
}
export function readJsonLines(
  stream: NodeJS.ReadableStream,
  onRecord: (value: unknown) => void,
  onError: (error: Error) => void,
) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let failed = false;
  const parse = (line: string) => {
    if (!line.trim()) return;
    try {
      onRecord(JSON.parse(line));
    } catch {
      failed = true;
      buffer = "";
      onError(engineError("Malformed engine JSONL record"));
    }
  };
  stream.on("data", (chunk: Buffer | string) => {
    if (failed) return;
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let at: number;
    while ((at = buffer.indexOf("\n")) >= 0 && !failed) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (Buffer.byteLength(line) > 8 * 1024 * 1024) {
        failed = true;
        buffer = "";
        onError(engineError("Engine record exceeded 8 MiB"));
        return;
      }
      parse(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
      failed = true;
      buffer = "";
      onError(engineError("Engine record exceeded 8 MiB"));
    }
  });
  stream.on("end", () => {
    if (failed) return;
    buffer += decoder.end();
    if (buffer) parse(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
  });
}
const stopping = new WeakMap<ChildProcessWithoutNullStreams, Promise<void>>();
export function stopProcess(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
  const pending = stopping.get(child);
  if (pending) return pending;
  // A second signal can race with a dying process group before Node delivers exit.
  const result = terminateProcess(child, timeoutMs).catch((error) => {
    stopping.delete(child);
    throw error;
  });
  stopping.set(child, result);
  return result;
}
async function terminateProcess(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (!child.pid) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
    await within(
      new Promise<void>((resolve, reject) => {
        killer.once("error", reject);
        killer.once("exit", (code) =>
          code === 0 || child.exitCode !== null
            ? resolve()
            : reject(engineError("Process tree termination failed")),
        );
      }),
      timeoutMs,
    );
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    try {
      await within(exited, Math.min(1000, timeoutMs));
      return;
    } catch {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  }
  await within(exited, timeoutMs);
}
