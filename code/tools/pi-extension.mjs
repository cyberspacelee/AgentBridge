import { Type } from "typebox";

export default function bridgeInteractions(pi) {
  let always = process.env.AGENT_BRIDGE_PERMISSION_POLICY !== "manual";
  pi.on("tool_call", async (event, context) => {
    if (always || !["bash", "write", "edit"].includes(event.toolName)) return;
    const decision = await context.ui.select(`AgentBridge permission: ${event.toolName}\n${JSON.stringify(event.input).slice(0, 6000)}`, ["once", "always", "reject"], { signal: context.signal });
    if (decision === "always") always = true;
    if (decision !== "once" && decision !== "always") return { block: true, reason: "The gateway declined this tool call." };
  });
  pi.registerTool({
    name: "bridge_question", label: "Question", description: "Ask a required clarification through the gateway's configured automatic or human reply policy.",
    parameters: Type.Object({ question: Type.String({ minLength: 1, maxLength: 4000 }), options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { maxItems: 20 })) }),
    async execute(_id, parameters, signal, _onUpdate, context) {
      const answer = parameters.options?.length ? await context.ui.select(parameters.question, parameters.options, { signal }) : await context.ui.input(parameters.question, "", { signal });
      return { content: [{ type: "text", text: answer ?? "Question cancelled" }], details: { answer: answer ?? null } };
    },
  });
  pi.registerCommand("bridge_health", { description: "AgentBridge interaction extension readiness", handler: async (_args, context) => { context.ui.notify("AgentBridge interactions ready", "info"); } });
}
