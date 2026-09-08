import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcProcess } from "../src/engines/rpc.js";
import { within } from "../src/async.js";

const program = `require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const {id,method,params}=JSON.parse(line);
  if(method==='hang') return;
  if(method==='crash') return process.exit(7);
  const result=method==='invalid'?[]:{value:params.value};
  setTimeout(()=>process.stdout.write(JSON.stringify({id,result})+'\\n'),params.delay||0);
});`;

test("RPC correlates out-of-order replies, expires waiters and rejects every waiter on malformed responses or exit", async () => {
  for (const failure of ["invalid", "crash"]) {
    const rpc = new RpcProcess(process.execPath, ["-e", program], process.cwd(), process.env, true);
    try {
      assert.deepEqual(await Promise.all([
        rpc.request("echo", { value: "slow", delay: 30 }),
        rpc.request("echo", { value: "fast" }),
      ]), [{ value: "slow" }, { value: "fast" }]);
      await assert.rejects(rpc.request("hang", {}, 20), /timed out/);
      assert.equal(Reflect.get(rpc, "pending").size, 0);
      const results = await within(Promise.allSettled([
        rpc.request("hang", {}), rpc.request(failure, {}),
      ]), 3000);
      assert.ok(results.every((result) => result.status === "rejected"));
      assert.equal(Reflect.get(rpc, "pending").size, 0);
      assert.equal(rpc.closed, true);
    } finally { await rpc.stop(); }
  }
});

test("RPC bounds buffered writes and outstanding requests when a child does not read", async () => {
  const rpc = new RpcProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], process.cwd(), process.env, true);
  try {
    assert.throws(() => rpc.send({ data: "x".repeat(8 * 1024 * 1024) }), /buffer exceeded/);
    const results = Promise.allSettled(Array.from({ length: 1024 }, () => rpc.request("hang", {})));
    await assert.rejects(rpc.request("overflow", {}), /Too many pending/);
    await rpc.stop();
    assert.ok((await within(results, 3000)).every((r) => r.status === "rejected"));
  } finally { await rpc.stop(); }
});
