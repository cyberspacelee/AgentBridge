import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import {
  readJsonLines,
  startProcess,
  processDiagnostic,
  stopProcess,
} from "../src/engines/process.js";
import { within } from "../src/async.js";

test("JSONL handles split UTF-8, CRLF, embedded separators and a final line", () => {
  const stream = new PassThrough();
  const values: unknown[] = [];
  const errors: Error[] = [];
  readJsonLines(
    stream,
    (value) => values.push(value),
    (error) => errors.push(error),
  );
  const bytes = Buffer.from(
    JSON.stringify({ text: "中文\u2028text" }) +
      "\r\n" +
      JSON.stringify({ count: 2 }) +
      "\n",
  );
  for (const byte of bytes) stream.write(Buffer.from([byte]));
  stream.end();
  assert.deepEqual(values, [{ text: "中文\u2028text" }, { count: 2 }]);
  assert.deepEqual(errors, []);
});
test("malformed JSONL stops later records", () => {
  const stream = new PassThrough();
  const values: unknown[] = [];
  const errors: Error[] = [];
  readJsonLines(
    stream,
    (value) => values.push(value),
    (error) => errors.push(error),
  );
  stream.write("{bad}\n{}\n");
  stream.end();
  assert.equal(errors.length, 1);
  assert.deepEqual(values, []);
});

test("process failures retain a bounded stderr tail and exit code", async () => {
  const child = startProcess(
    process.execPath,
    [
      "-e",
      "process.stderr.write('x'.repeat(10000) + ' configuration rejected'); process.exitCode = 7",
    ],
    process.cwd(),
  );
  child.stdout.resume();
  try {
    await within(
      new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", () => resolve());
      }),
      5000,
    );
    assert.match(processDiagnostic(child), /exit=7/);
    assert.match(processDiagnostic(child), /configuration rejected/);
    assert.ok(processDiagnostic(child).length < 8300);
  } finally {
    await stopProcess(child, 1000);
  }
});

test("engine processes never receive the desktop control token", async () => {
  const child = startProcess(process.execPath, ["-e", "process.stdout.write(String('AGENT_DESKTOP_TOKEN' in process.env))"], process.cwd(), { ...process.env, AGENT_DESKTOP_TOKEN: "test-only-control-token" });
  let output = ""; child.stdout.on("data", (chunk) => { output += chunk; });
  try {
    await within(new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("close", () => resolve()); }), 5000);
    assert.equal(output, "false");
  } finally { await stopProcess(child, 1000); }
});
