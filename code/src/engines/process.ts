import spawn from "cross-spawn";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { engineError } from "../errors.js";
import { within } from "../async.js";

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
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "pipe",
    windowsHide: true,
    detached: process.platform !== "win32",
  }) as ChildProcessWithoutNullStreams;
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
        onError(engineError("Engine record exceeded 8 MiB"));
        return;
      }
      parse(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
      failed = true;
      onError(engineError("Engine record exceeded 8 MiB"));
    }
  });
  stream.on("end", () => {
    if (failed) return;
    buffer += decoder.end();
    if (buffer) parse(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
  });
}
export async function stopProcess(
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
