import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import {
  startProcess,
  stopProcess,
  readJsonLines,
  processDiagnostic,
} from "./process.js";
import { engineError } from "../errors.js";

export const record = (value: unknown): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(value);
export const string = (value: unknown) =>
  typeof value === "string" ? value : "";
export const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export class RpcProcess {
  readonly child: ChildProcessWithoutNullStreams;
  closed = false;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  onMessage: (
    method: string,
    params: Record<string, unknown>,
    id?: number | string,
  ) => void = () => {};
  onClose: (error: Error) => void = () => {};
  constructor(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    private jsonrpc: boolean,
  ) {
    this.child = startProcess(command, args, cwd, env);
    const fail = (error: Error) => {
      if (this.closed) return;
      this.closed = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      this.onClose(error);
    };
    this.child.on("error", fail);
    this.child.stdin.on("error", fail);
    this.child.on("close", () =>
      fail(engineError("Agent process exited", processDiagnostic(this.child))),
    );
    readJsonLines(
      this.child.stdout,
      (value) => {
        const message = record(value);
        if (typeof message.method === "string") {
          const id =
            typeof message.id === "number" || typeof message.id === "string"
              ? message.id
              : undefined;
          this.onMessage(
            message.method,
            message.params ? record(message.params) : {},
            id,
          );
        } else if (typeof message.id === "number") {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error)
            pending.reject(
              engineError(
                "Agent RPC request failed",
                JSON.stringify(message.error),
              ),
            );
          else pending.resolve(message.result ? record(message.result) : {});
        }
      },
      (error) => {
        fail(error);
        void this.stop().catch(() => {});
      },
    );
  }
  send(message: Record<string, unknown>) {
    if (this.closed) throw engineError("Agent RPC connection is closed");
    this.child.stdin.write(
      JSON.stringify({
        ...(this.jsonrpc ? { jsonrpc: "2.0" } : {}),
        ...message,
      }) + "\n",
    );
  }
  request(
    method: string,
    params: unknown,
    timeoutMs = 30000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(engineError(`Agent RPC timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  respond(id: number | string, result: unknown) {
    this.send({ id, result });
  }
  reject(id: number | string, message: string) {
    this.send({ id, error: { code: -32601, message } });
  }
  async stop(timeoutMs = 10000) {
    await stopProcess(this.child, timeoutMs);
  }
}
