import { test } from "node:test";
import assert from "node:assert/strict";
import { transitionRun } from "../src/domain/transitions.js";
import type { Run, RunState } from "../shared/contracts.js";

test("all run transitions enforce terminality and timestamps", () => {
  const allowed: Record<RunState, RunState[]> = {
    queued: ["running", "cancelled", "timed_out", "failed"],
    running: ["stopping", "completed", "failed"],
    stopping: ["cancelled", "timed_out", "failed"],
    completed: [], failed: [], cancelled: [], timed_out: [],
  };
  const at = "2026-01-01T00:00:00.000Z";
  for (const from of Object.keys(allowed) as RunState[]) {
    for (const to of Object.keys(allowed) as RunState[]) {
      const run = { state: from, startedAt: from === "queued" ? null : at, finishedAt: null } as Run;
      if (!allowed[from].includes(to)) assert.throws(() => transitionRun(run, to, at), /Invalid Run transition/);
      else {
        const next = transitionRun(run, to, at);
        assert.equal(next.state, to);
        assert.equal(next.startedAt, to === "running" ? at : run.startedAt);
        assert.equal(next.finishedAt, ["completed", "failed", "cancelled", "timed_out"].includes(to) ? at : null);
        assert.equal(run.state, from);
      }
    }
  }
});
