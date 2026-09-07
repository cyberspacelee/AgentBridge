import { test } from "node:test";
import assert from "node:assert/strict";
import { errorDetail } from "../src/errors.js";

test("diagnostics preserve provider and Windows filesystem errors while redacting credentials", () => {
  const error = {
    name: "APIError",
    data: {
      statusCode: 401,
      message: "Invalid token demo-secret",
      responseBody: JSON.stringify({
        error: { code: "invalid_api_key", message: "Model access denied" },
        request: { prompt: "private prompt" },
      }),
      responseHeaders: { authorization: "Bearer demo-secret" },
    },
  };
  const detail = errorDetail(error, ["demo-secret"]);
  assert.match(detail, /401/);
  assert.match(detail, /Model access denied/);
  assert.ok(!detail.includes("demo-secret"));
  assert.ok(!detail.includes("private prompt"));
  assert.equal(
    errorDetail("Authorization: Bearer secret-value"),
    "Authorization: Bearer [REDACTED]",
  );
  assert.ok(!errorDetail("api_key=private-value").includes("private-value"));
  assert.equal(
    errorDetail(
      "https://private-token@registry.example/ _authToken=npm-private",
    ),
    "https://[REDACTED]@registry.example/ _authToken=[REDACTED]",
  );
  assert.match(
    errorDetail(
      new Error("fetch failed", {
        cause: Object.assign(new Error("connect refused"), {
          code: "ECONNREFUSED",
        }),
      }),
    ),
    /ECONNREFUSED/,
  );
  assert.match(
    errorDetail(
      Object.assign(
        new Error("EPERM: operation not permitted, scandir 'C:\\work\\locked'"),
        { code: "EPERM" },
      ),
    ),
    /C:\\work\\locked/,
  );
  const circular: Record<string, unknown> = { message: "failure" };
  circular.cause = circular;
  assert.ok(errorDetail(circular).length < 2000);
  assert.ok(errorDetail("x".repeat(10000) + " final failure").length <= 2000);
  assert.match(
    errorDetail("x".repeat(10000) + " final failure"),
    /final failure$/,
  );
});
