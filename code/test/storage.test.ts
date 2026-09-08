import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/storage/sqlite.js";

test("nested writes join the outer transaction and completion failures cannot undo committed data or skip observers", () => {
  const store = new Store(":memory:");
  const observed: string[] = [];
  try {
    store.transaction(() => {
      store.afterCommit(() => { throw new Error("observer failed"); });
      try {
        store.transaction(() => {
          store.setMeta("nested", "joined");
          store.afterCommit(() => observed.push("inner"));
          throw new Error("caught inside outer transaction");
        });
      } catch {}
      store.afterCommit(() => observed.push("outer"));
    });
    assert.equal(store.meta("nested"), "joined");
    assert.deepEqual(observed, ["inner", "outer"]);
    assert.throws(() => store.transaction(() => {
      store.transaction(() => {
        store.setMeta("nested", "rolled back");
        store.afterCommit(() => observed.push("must not run"));
        throw new Error("uncaught nested error");
      });
    }), /uncaught nested/);
    assert.equal(store.meta("nested"), "joined");
    assert.deepEqual(observed, ["inner", "outer"]);
    assert.throws(() => store.transaction(() => Promise.resolve()), /must be synchronous/);
    store.afterCommit(() => { throw new Error("outside transaction"); });
  } finally { store.close(); }
});
