import { z } from "zod";
import type { EngineHealth, ModelOption } from "./contracts.js";

export const defaultInteractionPolicy = { permission: "auto", question: "auto" } as const;
export const defaultAgent = "pi";

export const agentIds = ["pi", "opencode", "codex", "grok"] as const;
export const agentIdSchema = z.enum(agentIds);
export type AgentId = z.infer<typeof agentIdSchema>;
export const modelRefSchema = z
  .object({
    providerID: z.string().min(1).max(100),
    modelID: z.string().min(1).max(300),
  })
  .strict();
export const runtimeSourceSchema = z.object({ mode: z.enum(["managed", "external"]), command: z.string().min(1).max(4096).optional() }).strict().refine((value) => value.mode !== "external" || !!value.command, "外部 CLI 需要可执行文件路径或命令");
export type RuntimeSource = z.infer<typeof runtimeSourceSchema>;
export const agentSchema = z
  .object({
    id: agentIdSchema,
    enabled: z.boolean().default(false),
    runtime: runtimeSourceSchema,
    models: z.array(modelRefSchema).max(200).default([]),
    defaultModel: modelRefSchema.nullable().default(null),
    contextCompaction: z.enum(["default", "enabled"]).default("default"),
    skillIds: z.array(z.string()).max(200).default([]),
    mcpIds: z.array(z.string()).max(100).default([]),
    interactionPolicy: z
      .object({
        permission: z.enum(["auto", "manual"]),
        question: z.enum(["auto", "manual"]),
      })
      .strict()
      .default(defaultInteractionPolicy),
  })
  .strict();
export type AgentConfiguration = z.infer<typeof agentSchema>;

const name = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, "标识仅支持英文字母、数字、下划线和连字符")
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
  );
const httpUrl = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}, "Use an HTTP(S) URL without embedded credentials");
export const providerSchema = z
  .object({
    id: name,
    baseUrl: httpUrl,
    apiKey: z.string().max(8192).default(""),
    api: z
      .enum(["openai-completions", "openai-responses"])
      .default("openai-completions"),
    models: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            name: z.string().max(200).default(""),
            thinking: z.enum(["default", "off"]).default("default"),
            contextWindow: z
              .number()
              .int()
              .min(1024)
              .max(10000000)
              .default(128000),
            maxTokens: z.number().int().min(1).max(1000000).default(16384),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        "模型 ID 不能重复",
      ),
    enabled: z.boolean().default(true),
  })
  .strict();
export const skillSchema = z
  .object({
    id: name,
    path: z.string().min(1).max(4096),
    enabled: z.boolean().default(true),
  })
  .strict();
const secrets = z.record(name, z.string().max(8192));
export const mcpSchema = z
  .object({
    id: name,
    enabled: z.boolean().default(true),
    config: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("local"),
          command: z.array(z.string().min(1).max(4096)).min(1).max(100),
          environment: secrets.default({}),
        })
        .strict(),
      z
        .object({
          type: z.literal("remote"),
          url: httpUrl,
          headers: z
            .record(z.string().min(1).max(200), z.string().max(8192))
            .default({}),
        })
        .strict(),
    ]),
  })
  .strict();
export const settingsSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    defaultAgent: agentIdSchema.default(defaultAgent),
    agents: z
      .array(agentSchema)
      .length(4)
      .default(() => agentIds.map((id) => agentSchema.parse({ id, runtime: { mode: "managed" } }))),
    providers: z.array(providerSchema).max(50).default([]),
    skills: z.array(skillSchema).max(200).default([]),
    mcp: z.array(mcpSchema).max(100).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    for (const key of ["providers", "skills", "mcp"] as const)
      if (new Set(value[key].map((item) => item.id)).size !== value[key].length)
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Duplicate ID",
        });
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    if (new Set(value.agents.map((agent) => agent.id)).size !== 4)
      issue(["agents"], "Each agent must occur exactly once");
    value.agents.forEach((agent, index) => {
      for (const [refs, resources] of [
        ["skillIds", "skills"],
        ["mcpIds", "mcp"],
      ] as const) {
        if (new Set(agent[refs]).size !== agent[refs].length)
          issue(["agents", index, refs], "Duplicate resource reference");
        for (const id of agent[refs])
          if (!value[resources].some((entry) => entry.id === id))
            issue(["agents", index, refs], `Unknown resource: ${id}`);
      }
      const keys = agent.models.map((model) => JSON.stringify(model));
      if (new Set(keys).size !== keys.length)
        issue(["agents", index, "models"], "Duplicate model reference");
      for (const model of agent.models) {
        const provider = value.providers.find(
          (entry) => entry.id === model.providerID,
        );
        if (!provider?.models.some((entry) => entry.id === model.modelID))
          issue(["agents", index, "models"], "Unknown model reference");
        if (agent.id === "codex" && provider?.api !== "openai-responses")
          issue(
            ["agents", index, "models"],
            "Codex 需要使用 Responses 协议的模型连接",
          );
      }
      if (
        agent.defaultModel &&
        !agent.models.some(
          (model) =>
            model.providerID === agent.defaultModel!.providerID &&
            model.modelID === agent.defaultModel!.modelID,
        )
      )
        issue(
          ["agents", index, "defaultModel"],
          "Default model must be enabled for this agent",
        );
      if (
        agent.enabled &&
        (!agent.defaultModel ||
          !value.providers.some(
            (p) => p.id === agent.defaultModel!.providerID && p.enabled,
          ))
      )
        issue(
          ["agents", index, "defaultModel"],
          "已启用的 Agent 需要可用的默认模型连接；请先更换默认模型或停用 Agent",
        );
    });
  });
export type Settings = z.infer<typeof settingsSchema>;
export type Provider = z.infer<typeof providerSchema>;
export interface SettingsView {
  settings: Settings;
  revision: string;
  dataDirectory: string;
}
export interface AgentView {
  id: AgentId;
  enabled: boolean;
  health: EngineHealth;
  directory: string;
  configFile: string;
  savedRevision: string;
  appliedRevision: string | null;
  pendingChanges: boolean;
  operation: "enable" | "disable" | "stop" | "apply" | null;
  error: string | null;
  activeRuns: number;
  queuedRuns: number;
  models: ModelOption[];
  capabilities: { permissions: boolean; questions: boolean; recovery: boolean };
}
export const agentActionSchema = z
  .object({ action: z.enum(["enable", "disable", "stop", "apply"]) })
  .strict();
export const hiddenSecret = "********";
