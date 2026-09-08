import { gatewaySchema, defaultGateway } from "../host/gateway.mjs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { modelSchema } from "../shared/contracts.js";
import { providerSchema } from "../shared/settings.js";
import { agentIdSchema, defaultAgent } from "../shared/settings.js";
import { defaultNetworkSettings, normalizeNpmRegistry } from "../host/network.mjs";
import { GatewayError } from "./errors.js";

export const limitsSchema = z
  .object({
    runTimeoutMs: z.coerce.number().int().min(100).default(600000),
    startupTimeoutMs: z.coerce.number().int().min(100).default(30000),
    abortTimeoutMs: z.coerce.number().int().min(100).default(10000),
    maxConcurrentRuns: z.coerce.number().int().min(1).max(100).default(4),
    maxQueuedPerSession: z.coerce.number().int().min(1).max(1000).default(16),
    maxSessions: z.coerce.number().int().min(1).max(10000).default(100),
    maxSseConnections: z.coerce.number().int().min(1).max(10000).default(100),
    maxArtifactDownloads: z.coerce.number().int().min(1).max(16).default(2),
    maxEvents: z.coerce.number().int().min(100).default(100000),
    maxEventBytes: z.coerce
      .number()
      .int()
      .min(1048576)
      .default(128 * 1024 * 1024),
    eventRetentionMs: z.coerce.number().int().min(1000).default(86400000),
    maxPartBytes: z.coerce.number().int().min(1024).default(1048576),
  })
  .strict();
export type Limits = z.infer<typeof limitsSchema>;
export function readConfig(args = process.argv.slice(2), env = process.env) {
  const json = (name: string): unknown => {
    try { return JSON.parse(env[name]!); }
    catch { throw new GatewayError("CONFIGURATION_ERROR", `${name} must contain valid JSON`, 400); }
  };
  const { values } = parseArgs({
    args,
    options: {
      engine: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
    },
  });
  const engine = agentIdSchema.parse(
    values.engine ?? env.AGENT_ENGINE ?? defaultAgent,
  );
  const config = {
    engine,
    engineOverride: values.engine ?? env.AGENT_ENGINE,
    host: values.host ?? env.AGENT_HOST ?? defaultGateway.host,
    webOrigin: z.url().parse(env.AGENT_WEB_ORIGIN ?? "http://127.0.0.1:5173"),
    supervised: env.AGENT_SUPERVISED === "true",
    runtimeSources: {} as Record<string, { mode: "managed" | "external"; command?: string }>,
    managedRuntimes: env.AGENT_MANAGED_RUNTIMES === "true",
    runtimeNode: env.AGENT_RUNTIME_NODE ?? process.execPath,
    runtimeNpm: env.AGENT_RUNTIME_NPM ?? "",
    npmRegistry: normalizeNpmRegistry(env.AGENT_NPM_REGISTRY ?? defaultNetworkSettings.npmRegistry),
    port: z.coerce
      .number()
      .int()
      .min(0)
      .max(65535)
      .parse(values.port ?? env.AGENT_PORT ?? defaultGateway.port),
    dataDirectory: path.resolve(env.AGENT_DATA_DIR ?? ".agentbridge"),
    database:
      env.AGENT_STORAGE === "memory"
        ? ":memory:"
        : path.join(
            path.resolve(env.AGENT_DATA_DIR ?? ".agentbridge"),
            "state.sqlite",
          ),
    allowedDirectories: env.AGENT_ALLOWED_DIRECTORIES
      ? z.array(z.string()).parse(json("AGENT_ALLOWED_DIRECTORIES"))
      : [],
    model: env.AGENT_MODEL
      ? modelSchema.parse(json("AGENT_MODEL"))
      : null,
    compatibleProvider: env.AGENT_OPENAI_BASE_URL
      ? providerSchema.parse({
          id: env.AGENT_OPENAI_PROVIDER ?? "compatible",
          baseUrl: env.AGENT_OPENAI_BASE_URL,
          apiKey: env.AGENT_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? "",
          api: env.AGENT_OPENAI_API ?? "openai-completions",
          models: (env.AGENT_OPENAI_MODELS ?? "")
            .split(",")
            .map((id) => ({ id: id.trim() })),
        })
      : null,
    limits: limitsSchema.parse(
      env.AGENT_LIMITS ? json("AGENT_LIMITS") : {},
    ),
    questionAnswer:
      env.AGENT_QUESTION_ANSWER ??
      "Use the available context and proceed with a reasonable default.",
    opencode: {
      command: env.ENGINE_A_COMMAND ?? "opencode",
      url: `http://127.0.0.1:${z.coerce
        .number()
        .int()
        .min(0)
        .max(65535)
        .parse(env.ENGINE_A_PORT ?? 0)}`,
      username: env.ENGINE_A_USERNAME ?? "opencode",
      password: env.ENGINE_A_PASSWORD ?? "",
    },
    pi: {
      command: env.ENGINE_B_COMMAND ?? "pi",
      args: env.ENGINE_B_ARGS
        ? z.array(z.string()).parse(json("ENGINE_B_ARGS"))
        : [],
    },
    codex: { command: env.CODEX_COMMAND ?? "codex" },
    grok: { command: env.GROK_COMMAND ?? "grok" },
  };
  if (config.allowedDirectories.some((p) => !path.isAbsolute(p)))
    throw new Error("AGENT_ALLOWED_DIRECTORIES must contain absolute paths");
  gatewaySchema.parse({ host: config.host, port: config.port });
  return config;
}
export type Config = ReturnType<typeof readConfig>;
