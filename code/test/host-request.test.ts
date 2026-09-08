import { test } from "node:test";
import assert from "node:assert/strict";
import { hostRequest } from "../src/gateway/system.js";

test("host IPC bounds outstanding work and cleans success, send failure, timeout and disconnect", async (t) => {
  const descriptors = new Map(["send", "connected"].map((key) => [key, Object.getOwnPropertyDescriptor(process, key)]));
  const sent: { id: string }[] = [];
  let failSend = false;
  Object.defineProperty(process, "connected", { configurable: true, value: true });
  Object.defineProperty(process, "send", { configurable: true, value: (message: { id: string }, callback: (error?: Error) => void) => {
    sent.push(message);
    callback(failSend ? new Error("send failed") : undefined);
  } });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const requests = Array.from({ length: 32 }, () => hostRequest("gateway.get"));
    const outcomes = Promise.allSettled(requests);
    assert.throws(() => hostRequest("gateway.get"), /系统操作过多/);
    process.emit("message", { type: "host:response", id: sent[0]!.id, value: { ok: true } });
    assert.deepEqual(await requests[0], { ok: true });
    t.mock.timers.tick(20000);
    const results = await outcomes;
    assert.equal(results.filter((r) => r.status === "rejected").length, 31);
    failSend = true;
    await assert.rejects(hostRequest("gateway.get"), /send failed/);
    failSend = false;
    const pending = Promise.allSettled([hostRequest("gateway.get"), hostRequest("network.get")]);
    process.emit("disconnect");
    assert.ok((await pending).every((r) => r.status === "rejected"));
    const final = hostRequest("gateway.get");
    process.emit("message", { type: "host:response", id: sent.at(-1)!.id, value: "recovered" });
    assert.equal(await final, "recovered");
  } finally {
    process.emit("disconnect");
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(process, key, descriptor);
      else Reflect.deleteProperty(process, key);
    }
  }
});
