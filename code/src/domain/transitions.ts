import type {
  Interaction,
  Run,
  RunState,
  Session,
  TaskStatus,
} from "../../shared/contracts.js";

export function isTerminal(state: RunState): boolean {
  return (
    state === "completed" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "timed_out"
  );
}

const transitions: Record<RunState, readonly RunState[]> = {
  queued: ["running", "cancelled", "timed_out", "failed"],
  running: ["stopping", "completed", "failed"],
  stopping: ["cancelled", "timed_out", "failed"],
  completed: [],
  failed: [],
  timed_out: [],
  cancelled: [],
};

export function transitionRun(run: Run, state: RunState, at: string): Run {
  if (!transitions[run.state].includes(state))
    throw new Error(`Invalid Run transition ${run.state} -> ${state}`);
  return {
    ...run,
    state,
    startedAt: state === "running" ? at : run.startedAt,
    finishedAt: isTerminal(state) ? at : null,
  };
}

export function taskStatus(
  session: Session,
  runs: Run[],
  interactions: Interaction[],
): TaskStatus {
  if (session.availability === "deleting") return "deleting";
  if (runs.some((r) => r.state === "stopping")) return "stopping";
  if (session.availability === "unavailable") return "unavailable";
  const active = runs.find((r) => r.state === "running");
  if (
    active &&
    interactions.some(
      (i) =>
        i.runId === active.id &&
        i.policy === "manual" &&
        (i.state === "pending" || i.state === "replying"),
    )
  )
    return "waiting_input";
  if (active) return "running";
  if (runs.some((r) => r.state === "queued")) return "queued";
  return runs.at(-1)?.state ?? "not_started";
}
