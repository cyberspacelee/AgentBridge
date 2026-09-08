import { z } from "zod";
import { agentIdSchema } from "./settings.js";

export const runStates = [
  "queued",
  "running",
  "stopping",
  "completed",
  "failed",
  "timed_out",
  "cancelled",
] as const;
export const runStateSchema = z.enum(runStates);
export type RunState = z.infer<typeof runStateSchema>;
export type RunOutcome = Extract<
  RunState,
  "completed" | "failed" | "timed_out" | "cancelled"
>;
export const modelSchema = z
  .object({
    providerID: z.string().min(1).max(200),
    modelID: z.string().min(1).max(300),
  })
  .strict();
export type ModelRef = z.infer<typeof modelSchema>;
export const inputPartsSchema = z
  .array(
    z
      .object({ type: z.literal("text"), text: z.string().min(1).max(131072) })
      .strict(),
  )
  .min(1)
  .max(16)
  .refine(
    (parts) => parts.some((p) => p.text.trim().length > 0),
    "Input must contain text",
  )
  .refine(
    (parts) =>
      new TextEncoder().encode(parts.map((p) => p.text).join("\n")).length <=
      131072,
    "Input exceeds 128 KiB",
  );
export const policySchema = z
  .object({
    permission: z.enum(["auto", "manual"]),
    question: z.enum(["auto", "manual"]),
  })
  .strict();
export type InteractionPolicy = z.infer<typeof policySchema>;
export const createSessionSchema = z
  .object({
    engineId: agentIdSchema.optional(),
    directory: z.string().min(1).max(4096),
    title: z.string().max(200).optional(),
    interactionPolicy: policySchema.optional(),
  })
  .strict();
export const promptSchema = z
  .object({ parts: inputPartsSchema, model: modelSchema.optional() })
  .strict();
export const submissionIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const submitRunSchema = promptSchema.extend({
  submissionId: submissionIdSchema,
});
export const createTaskSchema = createSessionSchema.extend(
  submitRunSchema.shape,
);
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type SubmitRunInput = z.infer<typeof submitRunSchema>;
export type PromptInput = z.infer<typeof promptSchema>;

export interface Failure {
  code: string;
  message: string;
  stage: string;
}
export interface Usage {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  costUsd: number | null;
  source: "reported" | "estimated";
}
export interface Session {
  id: string;
  title: string;
  directory: string;
  engineId: string;
  interactionPolicy: InteractionPolicy;
  availability: "ready" | "unavailable" | "deleting";
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface Run {
  configRevision: string | null;
  id: string;
  sessionId: string;
  submissionId: string;
  sequence: number;
  inputParts: PromptInput["parts"];
  model: ModelRef | null;
  state: RunState;
  acceptedAt: string;
  deadlineAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stopReason: "user" | "timeout" | "deletion" | "shutdown" | null;
  error: Failure | null;
  usage: Usage | null;
  traceId: string;
}
export interface TextPart {
  id: string;
  type: "text";
  text: string;
}
export interface ToolPart {
  id: string;
  type: "tool";
  toolCallId: string;
  name: string;
  input: unknown;
  output: string;
  state:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  startedAt: string | null;
  finishedAt: string | null;
}
export interface StepPart {
  id: string;
  type: "step-finish";
  reason: string;
  usage: Usage | null;
}
export type MessagePart = TextPart | ToolPart | StepPart;
export interface Message {
  id: string;
  sessionId: string;
  runId: string;
  role: "user" | "assistant";
  createdAt: string;
  completedAt: string | null;
  finishReason: string | null;
  parts: MessagePart[];
}
export interface Question {
  text: string;
  options: string[];
  multiple: boolean;
  allowCustom: boolean;
}
export interface Interaction {
  id: string;
  sessionId: string;
  runId: string;
  kind: "permission" | "question";
  title: string;
  questions: Question[];
  state: "pending" | "replying" | "resolved" | "expired";
  policy: "auto" | "manual";
  createdAt: string;
  resolvedAt: string | null;
  reply: InteractionReply | null;
  error: string | null;
}
export const interactionReplySchema = z.union([
  z.object({ decision: z.enum(["once", "always", "reject"]) }).strict(),
  z
    .object({
      answers: z.array(z.array(z.string().max(10000)).max(100)).max(100),
    })
    .strict(),
]);
export type InteractionReply = z.infer<typeof interactionReplySchema>;
export interface Artifact {
  id: string;
  sessionId: string;
  runId: string;
  relativePath: string;
  displayName: string;
  mediaType: string;
  sizeBytes: number;
  modifiedAt: string;
  digest: string;
  registeredAt: string;
  availability: "available" | "missing" | "changed" | "unavailable";
  validation: "not_checked" | "passed" | "failed";
}
export interface AcceptedRun {
  submissionId: string;
  taskId: string;
  sessionId: string;
  runId: string;
  acceptedAt: string;
}
export interface Submission {
  id: string;
  operation: string;
  target: string;
  digest: string;
  status: "processing" | "accepted" | "rejected" | "indeterminate" | "gone";
  result: AcceptedRun | null;
  error: Failure | null;
  createdAt: string;
}
export interface AppEvent {
  schemaVersion: 1;
  eventId: string;
  revision: number;
  instanceId: string;
  occurredAt: string;
  type: string;
  sessionId?: string;
  runId?: string;
  data: unknown;
}
export interface Snapshot {
  storeId: string;
  instanceId: string;
  revision: number;
  cursor: string;
  capturedAt: string;
}
export type TaskStatus =
  RunState | "not_started" | "waiting_input" | "unavailable" | "deleting";
export interface TaskSummary extends Session {
  status: TaskStatus;
  lastRun: Run | null;
  queuedCount: number;
  messageCount: number;
}
export interface TaskDetail {
  task: TaskSummary;
  runs: Run[];
  messages: Message[];
  interactions: Interaction[];
  artifacts: Artifact[];
}
export interface Page<T> {
  snapshot: Snapshot;
  items: T[];
  nextCursor: string | null;
}
export interface EngineHealth {
  status:
    "starting" | "ready" | "degraded" | "unavailable" | "stopping" | "disabled";
  version: string | null;
  message: string | null;
  processes: number;
  restarts: number;
}
export interface ModelOption extends ModelRef {
  name: string;
}
export interface EngineInfo {
  id: string;
  health: EngineHealth;
  enabled?: boolean;
  defaultModel?: ModelRef | null;
  interactionPolicy?: InteractionPolicy;
  capabilities?: {
    permissions: boolean;
    questions: boolean;
    recovery: boolean;
  };
}
export interface RuntimeInfo {
  instanceId: string;
  storeId: string;
  engine: string;
  health: EngineHealth;
  engines: EngineInfo[];
  storage: "sqlite" | "memory";
  models: ModelRef[];
  limits: Record<string, number>;
  interactionDefaults: InteractionPolicy;
  capabilities: Record<string, boolean>;
}
