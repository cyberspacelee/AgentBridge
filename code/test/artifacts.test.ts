import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { digestFile, discoverFiles } from "../src/runtime/artifacts.js";

test("artifact verification and inventory enforce their inclusive size and entry limits", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-boundaries-"));
  try {
    const filename = path.join(directory, "large.bin");
    const file = await open(filename, "w");
    try {
      await file.truncate(100 * 1024 * 1024);
      assert.match(await digestFile(filename), /^[a-f0-9]{64}$/);
      await file.truncate(100 * 1024 * 1024 + 1);
      await assert.rejects(digestFile(filename), /100 MiB/);
    } finally { await file.close(); }
    const inventory = path.join(directory, "inventory");
    await mkdir(inventory);
    for (let start = 0; start < 10000; start += 100)
      await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(path.join(inventory, `${start + i}.bin`), "")));
    assert.equal((await discoverFiles(inventory)).size, 0);
    await writeFile(path.join(inventory, "overflow.bin"), "");
    await assert.rejects(discoverFiles(inventory), /10000 entries/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
