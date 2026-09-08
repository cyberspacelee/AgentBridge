import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.js";
import { CodexAdapter } from "../src/engines/codex/adapter.js";
import { GrokAdapter } from "../src/engines/grok/adapter.js";
import type { EngineUpdate } from "../src/engines/adapter.js";
import type { Session, Run } from "../shared/contracts.js";

// Exercise the wire translations independently of the installed CLI and model output.
for (const id of ["codex", "grok"] as const)
  test(`${id} translates tools, approvals, questions, usage and cancellation`, async () => {
    const config = readConfig([], {});
    const adapter =
      id === "codex" ? new CodexAdapter(config) : new GrokAdapter(config);
    const session: Session = {
      id: randomUUID(),
      title: "Protocol",
        titleSource: "user",
      directory: process.cwd(),
      engineId: id,
      interactionPolicy: { permission: "manual", question: "manual" },
      availability: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };
    const run: Run = {
      id: randomUUID(),
      sessionId: session.id,
      submissionId: randomUUID(),
      sequence: 1,
      inputParts: [{ type: "text", text: "Execute" }],
      model: null,
      configRevision: null,
      state: "running",
      acceptedAt: session.createdAt,
      deadlineAt: new Date(Date.now() + 30000).toISOString(),
      startedAt: session.createdAt,
      finishedAt: null,
      stopReason: null,
      error: null,
      usage: null,
      traceId: randomUUID(),
    };
    const replies: { id: string | number; result: unknown }[] = [],
      rejected: unknown[] = [],
      updates: EngineUpdate[] = [];
    let completePrompt!: (result: Record<string, unknown>) => void;
    const native = {
      session,
      nativeId: "native-session",
      generation: 1,
      provider: "fixture",
      rpc: {
        closed: false,
        request: async (method: string) => {
          if (method === "session/prompt")
            return new Promise<Record<string, unknown>>((resolve) => {
              completePrompt = resolve;
            });
          if (method === "turn/interrupt") finish(true);
          return { turn: { id: "native-turn" } };
        },
        send: (message: Record<string, unknown>) => {
          if (message.method === "session/cancel") finish(true);
        },
        respond: (id: string | number, result: unknown) =>
          replies.push({ id, result }),
        reject: (id: string | number, error: string) =>
          rejected.push({ id, error }),
      },
    };
    Reflect.get(adapter, "sessions").set(session.id, native);
    const event = (
      method: string,
      params: Record<string, unknown>,
      requestId?: string,
    ) =>
      Reflect.get(adapter, "event").call(
        adapter,
        native,
        method,
        params,
        requestId,
      );
    const finish = (cancelled = false) =>
      id === "codex"
        ? event("turn/completed", {
            threadId: native.nativeId,
            turn: {
              id: "native-turn",
              status: cancelled ? "interrupted" : "completed",
            },
          })
        : completePrompt({ stopReason: cancelled ? "cancelled" : "end_turn" });
    const pending = adapter.run(session, run, (update) =>
      updates.push(structuredClone(update)),
    );
    await Promise.resolve();
    const address =
      id === "codex"
        ? { threadId: native.nativeId }
        : { sessionId: native.nativeId };
    const notify = (update: Record<string, unknown>) =>
      event("session/update", { ...address, update });
    if (id === "codex") {
      event("item/started", {
        ...address,
        item: { id: "tool", type: "commandExecution", command: "echo result" },
      });
      event("item/commandExecution/outputDelta", {
        ...address,
        itemId: "tool",
        delta: "result",
      });
      event("item/completed", {
        ...address,
        item: {
          id: "tool",
          type: "commandExecution",
          status: "completed",
          aggregatedOutput: "result",
        },
      });
    } else {
      notify({
        sessionUpdate: "tool_call",
        toolCallId: "tool",
        title: "command",
        rawInput: { command: "echo result" },
        status: "in_progress",
      });
      notify({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool",
        status: "completed",
        rawOutput: "result",
      });
    }
    event(
      id === "codex"
        ? "item/commandExecution/requestApproval"
        : "session/request_permission",
      {
        ...address,
        command: "echo result",
        options: [
          { kind: "allow_once", optionId: "allow" },
          { kind: "reject_once", optionId: "deny" },
        ],
      },
      "approval",
    );
    const permission = updates.at(-1)!;
    assert.equal(permission.type, "interaction");
    if (permission.type !== "interaction")
      throw new Error("Expected permission");
    await adapter.reply(permission.interaction.id, { reply: "reject" });
    assert.deepEqual(replies.at(-1), {
      id: "approval",
      result:
        id === "codex"
          ? { decision: "decline" }
          : { outcome: { outcome: "selected", optionId: "deny" } },
    });
    event(
      id === "codex" ? "item/tool/requestUserInput" : "_x.ai/ask_user_question",
      {
        ...address,
        questions: [
          {
            id: "question-id",
            question: "Choose format",
            isOther: true,
            multi_select: false,
            options: [{ label: "Markdown", description: "Portable text" }],
          },
        ],
      },
      "question",
    );
    const question = updates.at(-1)!;
    assert.equal(question.type, "interaction");
    if (question.type !== "interaction") throw new Error("Expected question");
    assert.equal(question.interaction.questions[0]?.allowCustom, true);
    assert.equal(question.interaction.sessionID, session.id);
    assert.deepEqual(question.interaction.questions[0]?.options, [{ label: "Markdown", description: "Portable text" }]);
    await adapter.reply(question.interaction.id, { answers: [["Plain text"]] });
    assert.deepEqual(replies.at(-1), {
      id: "question",
      result:
        id === "codex"
          ? { answers: { "question-id": { answers: ["Plain text"] } } }
          : {
              outcome: "accepted",
              answers: { "Choose format": ["Other"] },
              annotations: { "Choose format": { notes: "Plain text" } },
            },
    });
    await assert.rejects(
      adapter.reply(question.interaction.id, { answers: [["duplicate"]] }),
    );
    event("unsupported/request", address, "unsupported");
    assert.equal(rejected.length, 1);
    if (id === "codex") {
      for (const total of [110, 125, 125])
        event("thread/tokenUsage/updated", {
          ...address,
          tokenUsage: {
            total: {
              inputTokens: total,
              outputTokens: 14,
              cachedInputTokens: 3,
              cacheWriteInputTokens: 0,
            },
            last: {
              inputTokens: 10,
              outputTokens: 4,
              cachedInputTokens: 1,
              cacheWriteInputTokens: 0,
            },
          },
        });
      event("item/agentMessage/delta", {
        ...address,
        itemId: "text",
        delta: "Done",
      });
    } else
      notify({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Done" },
      });
    finish();
    const result = await pending;
    assert.equal(result.outcome, "completed");
    if (id === "codex") assert.equal(result.usage?.input, 25);
    const message = updates.at(-1)!;
    assert.equal(message.type, "message");
    if (message.type !== "message") throw new Error("Expected message");
    assert.equal(message.message.info.finish, "stop");
    assert.ok(
      message.message.parts.some(
        (part) =>
          part.type === "tool" &&
          part.state.status === "completed" &&
          part.output === "result",
      ),
    );
    assert.ok(
      message.message.parts.some(
        (part) => part.type === "text" && part.content === "Done",
      ),
    );
    const cancelled = adapter.run(
      session,
      { ...run, id: randomUUID() },
      () => {},
    );
    await Promise.resolve();
    await Promise.resolve();
    await adapter.abort(session.id);
    assert.equal((await cancelled).outcome, "aborted");
  });
