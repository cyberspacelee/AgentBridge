import { test } from "node:test";
import assert from "node:assert/strict";
import { limitsSchema, readConfig } from "../src/config.js";
import { GatewayError } from "../src/errors.js";

test("invalid JSON names its environment variable without echoing credentials", () => {
  for (const name of ["AGENT_MODEL", "AGENT_ALLOWED_DIRECTORIES", "AGENT_LIMITS", "ENGINE_B_ARGS"])
    assert.throws(() => readConfig([], { [name]: '{"secret":"private' }), (error: unknown) =>
      error instanceof GatewayError && error.code === "CONFIGURATION_ERROR" && error.message.includes(name) && !error.message.includes("private"));
});

test("limits reject fractional, non-finite and out-of-range values", () => {
  const boundaries = {
    runTimeoutMs: [100, 86400000], artifactTimeoutMs: [100, 600000], startupTimeoutMs: [100], abortTimeoutMs: [100],
    maxConcurrentRuns: [1, 100], maxQueuedPerSession: [1, 1000], maxSessions: [1, 10000],
    maxSseConnections: [1, 10000], maxArtifactDownloads: [1, 16], maxEvents: [100],
    maxEventBytes: [1048576], eventRetentionMs: [1000], maxPartBytes: [1024],
  };
  for (const [key, [min, max]] of Object.entries(boundaries)) {
    assert.ok(limitsSchema.safeParse({ [key]: min }).success, key);
    for (const value of [min! - 1, min! + 0.5, Infinity, NaN, ...(max ? [max + 1] : [])])
      assert.equal(limitsSchema.safeParse({ [key]: value }).success, false, `${key}=${value}`);
    if (max) assert.ok(limitsSchema.safeParse({ [key]: max }).success, key);
  }
});

test("every engine defaults to a 30 minute gateway deadline", () => {
  for (const engine of ["pi", "opencode", "codex", "grok"])
    assert.equal(readConfig(["--engine", engine], {}).limits.runTimeoutMs, 1800000);
});
