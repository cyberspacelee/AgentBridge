import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error The engine loads the shipped JavaScript extension directly.
import extension from "../tools/pi-extension.mjs";

test("Pi manual permission blocks rejection and retains always for later tools", async () => {
  const original = process.env.AGENT_BRIDGE_PERMISSION_POLICY;
  process.env.AGENT_BRIDGE_PERMISSION_POLICY = "manual";
  let handler!: (event: unknown, context: unknown) => Promise<unknown>;
  let tool: unknown;
  let command: unknown;
  extension({
    on: (_name: string, cb: typeof handler) => {
      handler = cb;
    },
    registerTool: (value: unknown) => {
      tool = value;
    },
    registerCommand: (value: unknown) => {
      command = value;
    },
  });
  try {
    let decision = "reject";
    let calls = 0;
    const context = {
      ui: {
        select: async () => {
          calls++;
          return decision;
        },
      },
    };
    const event = { toolName: "bash", input: { command: "work" } };
    assert.deepEqual(await handler(event, context), {
      block: true,
      reason: "The gateway declined this tool call.",
    });
    assert.deepEqual(await handler({ toolName: "plugin_mcp_write", input: {} }, context), {
      block: true,
      reason: "The gateway declined this tool call.",
    });
    decision = "always";
    assert.equal(await handler(event, context), undefined);
    decision = "reject";
    assert.equal(await handler(event, context), undefined);
    assert.equal(calls, 3);
    assert.ok(tool);
    assert.equal(command, "bridge_health");
  } finally {
    if (original === undefined)
      delete process.env.AGENT_BRIDGE_PERMISSION_POLICY;
    else process.env.AGENT_BRIDGE_PERMISSION_POLICY = original;
  }
});
