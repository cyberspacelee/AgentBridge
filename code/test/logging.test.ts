import { test } from "node:test";
import assert from "node:assert/strict";
import { localLogTimestamp } from "../src/gateway/server.js";

test("log timestamps follow the system timezone with an explicit offset", () => {
  const previous = process.env.TZ;
  try {
    for (const [zone, instant, expected] of [
      ["UTC", "2026-09-07T20:30:00.123Z", "2026-09-07T20:30:00.123+00:00"],
      ["Asia/Shanghai", "2026-09-07T20:30:00.123Z", "2026-09-08T04:30:00.123+08:00"],
      ["Asia/Kathmandu", "2026-09-07T20:30:00.123Z", "2026-09-08T02:15:00.123+05:45"],
      ["America/New_York", "2026-01-07T02:30:00.123Z", "2026-01-06T21:30:00.123-05:00"],
      ["America/New_York", "2026-07-07T02:30:00.123Z", "2026-07-06T22:30:00.123-04:00"],
    ]) {
      process.env.TZ = zone;
      const { time } = JSON.parse(`{"level":30${localLogTimestamp(new Date(instant!))}}`);
      assert.equal(time, expected);
      assert.equal(Date.parse(time), Date.parse(instant!));
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
