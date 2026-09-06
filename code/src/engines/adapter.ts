import type {
  EngineHealth,
  Failure,
  Interaction,
  InteractionReply,
  Message,
  Run,
  Session,
  Usage,
} from "../../shared/contracts.js";

export type EngineUpdate =
  | { type: "message"; message: Message }
  | { type: "interaction"; interaction: Interaction };
export interface EngineResult {
  outcome: "completed" | "failed" | "aborted";
  error?: Failure;
  usage?: Usage | null;
}
export interface EngineBindingResult {
  nativeSessionId: string;
  processGeneration: number;
}
export interface EngineAdapter {
  readonly id: string;
  health(): EngineHealth;
  unavailableSessions?(): string[];
  start(): Promise<void>;
  createSession(session: Session): Promise<EngineBindingResult>;
  recoverSession?(sessionId: string): Promise<EngineBindingResult | null>;
  run(
    session: Session,
    run: Run,
    emit: (update: EngineUpdate) => void,
  ): Promise<EngineResult>;
  abort(sessionId: string, runId: string): Promise<void>;
  forceStop(sessionId: string): Promise<string[]>;
  reply(interactionId: string, reply: InteractionReply): Promise<void>;
  disposeSession(sessionId: string): Promise<void>;
  stop(): Promise<void>;
}
