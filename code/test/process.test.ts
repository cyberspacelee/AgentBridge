import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { readJsonLines } from "../src/engines/process.js";

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
