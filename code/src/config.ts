import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { modelSchema } from "../shared/contracts.js";

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
  const { values } = parseArgs({
    args,
    options: {
      engine: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
    },
  });
  const engine = z
    .enum(["opencode", "pi"])
    .parse(values.engine ?? env.AGENT_ENGINE ?? "opencode");
  const config = {
    engine,
    host: values.host ?? env.AGENT_HOST ?? "127.0.0.1",
    webOrigin: z.url().parse(env.AGENT_WEB_ORIGIN ?? "http://127.0.0.1:5173"),
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(values.port ?? env.AGENT_PORT ?? 3000),
    dataDirectory: path.resolve(env.AGENT_DATA_DIR ?? ".agentbridge"),
    database:
      env.AGENT_STORAGE === "memory"
        ? ":memory:"
        : path.join(
            path.resolve(env.AGENT_DATA_DIR ?? ".agentbridge"),
            "state.sqlite",
          ),
    allowedDirectories: env.AGENT_ALLOWED_DIRECTORIES
      ? z.array(z.string()).parse(JSON.parse(env.AGENT_ALLOWED_DIRECTORIES))
      : [],
    model: env.AGENT_MODEL
      ? modelSchema.parse(JSON.parse(env.AGENT_MODEL))
      : null,
    limits: limitsSchema.parse(
      env.AGENT_LIMITS ? JSON.parse(env.AGENT_LIMITS) : {},
    ),
    questionAnswer:
      env.AGENT_QUESTION_ANSWER ??
      "Use the available context and proceed with a reasonable default.",
    opencode: {
      command: env.ENGINE_A_COMMAND ?? "opencode",
      url: env.ENGINE_A_URL ?? "http://127.0.0.1:4096",
      managed: !env.ENGINE_A_URL,
      username: env.ENGINE_A_USERNAME ?? "opencode",
      password: env.ENGINE_A_PASSWORD ?? "",
    },
    pi: {
      command: env.ENGINE_B_COMMAND ?? "pi",
      args: env.ENGINE_B_ARGS
        ? z.array(z.string()).parse(JSON.parse(env.ENGINE_B_ARGS))
        : [],
    },
  };
  if (config.allowedDirectories.some((p) => !path.isAbsolute(p)))
    throw new Error("AGENT_ALLOWED_DIRECTORIES must contain absolute paths");
  return config;
}
export type Config = ReturnType<typeof readConfig>;
