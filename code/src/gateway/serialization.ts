import type { AppEvent, Message } from "../../shared/contracts.js";

export function evaluationMessage(message: Message) {
  return {
    info: {
      id: message.id,
      sessionID: message.sessionId,
      role: message.role,
      time: {
        created: Date.parse(message.createdAt),
        ...(message.completedAt
          ? { completed: Date.parse(message.completedAt) }
          : {}),
      },
      ...(message.finishReason ? { finish: message.finishReason } : {}),
    },
    parts: message.parts.map((part) => ({
      ...part,
      messageID: message.id,
      sessionID: message.sessionId,
      ...(part.type === "tool"
        ? {
            tool: part.name,
            callID: part.toolCallId,
            state: {
              status: part.state === "failed" ? "error" : part.state,
              input: part.input,
              output: part.output,
              time: {
                start: part.startedAt ? Date.parse(part.startedAt) : undefined,
                end: part.finishedAt ? Date.parse(part.finishedAt) : undefined,
              },
            },
          }
        : {}),
    })),
  };
}
export function evaluationEvent(
  event: AppEvent,
): { type: string; properties: unknown } | null {
  if (
    [
      "session.status",
      "session.idle",
      "session.error",
      "question.asked",
      "permission.asked",
    ].includes(event.type)
  )
    return { type: event.type, properties: event.data };
  if (event.type === "message.part.updated") {
    const data = event.data as {
      messageId: string;
      part: Message["parts"][number];
    };
    const message: Message = {
      id: data.messageId,
      sessionId: event.sessionId!,
      runId: event.runId!,
      role: "assistant",
      createdAt: event.occurredAt,
      completedAt: null,
      finishReason: null,
      parts: [data.part],
    };
    return {
      type: event.type,
      properties: { part: evaluationMessage(message).parts[0] },
    };
  }
  return null;
}
