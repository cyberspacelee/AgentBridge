import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync,
  statSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { z } from "zod";
import {
  settingsSchema,
  providerSchema,
  skillSchema,
  mcpSchema,
  hiddenSecret,
  type Settings,
  type SettingsView,
  type AgentId,
  type AgentConfiguration,
} from "../shared/settings.js";
import type { Config } from "./config.js";
import { GatewayError, errorDetail } from "./errors.js";

const applied = new WeakMap<Config, Map<string, Settings>>();
const object = (value: unknown) =>
  z.record(z.string(), z.unknown()).parse(value);
export const revision = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function readJson(file: string): Record<string, unknown> {
  try {
    return object(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new GatewayError(
      "CONFIGURATION_ERROR",
      `Cannot read configuration: ${file}`,
      400,
    );
  }
}
export function readSettings(config: Config): Settings {
  const file = path.join(config.dataDirectory, "settings.json");
  if (existsSync(file)) {
    const value = readJson(file);
    if (value.schemaVersion !== 1) throw new GatewayError("CONFIGURATION_ERROR", "不支持历史配置。请使用新的数据目录重新配置；不提供迁移。", 400);
    return settingsSchema.parse(value);
  }
  const settings = settingsSchema.parse({ defaultAgent: config.engine });
  for (const agent of settings.agents) agent.runtime = config.managedRuntimes ? { mode: "managed" } : { mode: "external", command: config[agent.id].command };
  if (config.compatibleProvider) {
    const provider = providerSchema.parse(config.compatibleProvider);
    settings.providers.push(provider);
    const agent = settings.agents.find((a) => a.id === config.engine)!;
    agent.models = provider.models.map((m) => ({
      providerID: provider.id,
      modelID: m.id,
    }));
    agent.defaultModel = config.model ?? agent.models[0]!;
    agent.enabled = true;
  }
  return settingsSchema.parse(settings);
}
export function agentDirectory(config: Config, id: string) {
  return path.join(config.dataDirectory, "agents", id);
}
export function agentConfigFile(config: Config, id: string) {
  return path.join(
    agentDirectory(config, id),
    id === "pi"
      ? "settings.json"
      : id === "opencode"
        ? "opencode.json"
        : "config.toml",
  );
}
export function piDirectory(config: Config) {
  return agentDirectory(config, "pi");
}
export function effectiveSettings(config: Config, id: string) {
  return applied.get(config)?.get(id) ?? readSettings(config);
}
export function agentConfiguration(
  config: Config,
  id: string,
  settings = effectiveSettings(config, id),
): AgentConfiguration | undefined {
  return settings.agents.find((a) => a.id === id);
}
export function engineSettings(
  config: Config,
  id: string,
  settings = effectiveSettings(config, id),
) {
  const agent = agentConfiguration(config, id, settings);
  return {
    ...settings,
    providers: settings.providers
      .filter((p) => p.enabled)
      .map((p) => ({
        ...p,
        models: p.models.filter((m) =>
          agent?.models.some(
            (r) => r.providerID === p.id && r.modelID === m.id,
          ),
        ),
      }))
      .filter((p) => p.models.length),
    skills: settings.skills.filter(
      (s) => s.enabled && agent?.skillIds.includes(s.id),
    ),
    mcp: settings.mcp.filter((m) => m.enabled && agent?.mcpIds.includes(m.id)),
  };
}
export function agentRevision(
  config: Config,
  id: string,
  settings = readSettings(config),
) {
  const scoped = engineSettings(config, id, settings);
  const agent = agentConfiguration(config, id, settings);
  return revision({
    agent: agent && { ...agent, enabled: undefined },
    providers: scoped.providers,
    skills: scoped.skills,
    mcp: scoped.mcp,
  });
}
export function configuredModels(config: Config, id: string) {
  return engineSettings(config, id).providers.flatMap((p) =>
    p.models.map((m) => ({
      providerID: p.id,
      modelID: m.id,
      name: m.name || m.id,
    })),
  );
}
export function configuredModel(config: Config, id: string, ref = agentConfiguration(config, id)?.defaultModel) {
  ref ??= agentConfiguration(config, id)?.defaultModel;
  return engineSettings(config, id).providers
    .find((p) => p.id === ref?.providerID)?.models.find((m) => m.id === ref?.modelID);
}
export function codexCompactionConfig(config: Config, ref = agentConfiguration(config, "codex")?.defaultModel) {
  const model = configuredModel(config, "codex", ref);
  return model && agentConfiguration(config, "codex")?.contextCompaction === "enabled"
    ? { model_context_window: model.contextWindow, model_auto_compact_token_limit: Math.floor(model.contextWindow * 0.85) }
    : {};
}
export function diagnosticSecrets(config: Config): string[] {
  const values = [
    config.opencode.password,
    config.compatibleProvider?.apiKey ?? "",
  ];
  try {
    for (const settings of [
      readSettings(config),
      ...(applied.get(config)?.values() ?? []),
    ]) {
      values.push(...settings.providers.map((p) => p.apiKey));
      for (const m of settings.mcp)
        values.push(
          ...Object.values(
            m.config.type === "local" ? m.config.environment : m.config.headers,
          ),
        );
    }
  } catch {
    /* Configuration errors must remain reportable. */
  }
  return values.filter(Boolean);
}
export function piProviders(config: Config) {
  return Object.fromEntries(
    engineSettings(config, "pi").providers.map((p) => [
      p.id,
      {
        baseUrl: p.baseUrl,
        api: p.api,
        apiKey: (p.apiKey || "not-required")
          .replaceAll("$", () => "$$")
          .replace(/^!/, "$!"),
        models: p.models.map((m) => ({
          id: m.id,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          name: m.name || m.id,
          reasoning: m.thinking === "off",
          ...(m.thinking === "off" ? { thinkingLevelMap: { off: "none" } } : {}),
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
      },
    ]),
  );
}
export function piMcpConfiguration(settings: Settings) {
  const agent = settings.agents.find((a) => a.id === "pi");
  const environment: NodeJS.ProcessEnv = {};
  const servers = Object.fromEntries(
    settings.mcp
      .filter((m) => m.enabled && agent?.mcpIds.includes(m.id))
      .map((m) => {
        const literal = (field: string, value: string) => {
          const key = `AGENT_BRIDGE_MCP_${revision([m.id, field])}`;
          environment[key] = value;
          return `{env:${key}}`;
        };
        const entries = (values: Record<string, string>, prefix: string) =>
          Object.fromEntries(
            Object.entries(values).map(([key, value]) => [
              key,
              literal(prefix + key, value),
            ]),
          );
        return [
          m.id,
          m.config.type === "local"
            ? {
                command: m.config.command[0],
                args: m.config.command
                  .slice(1)
                  .map((v, i) => literal(`arg${i}`, v)),
                env: entries(m.config.environment, "env"),
              }
            : {
                url: literal("url", m.config.url),
                headers: entries(m.config.headers, "header"),
              },
        ];
      }),
  );
  return { servers, environment };
}
export function syncPiMcp(config: Config) {
  return piMcpConfiguration(effectiveSettings(config, "pi")).environment;
}
export function opencodeEnvironment(config: Config) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (key.startsWith("OPENCODE_")) delete environment[key];
  const settings = engineSettings(config, "opencode");
  const native = {
    autoupdate: false,
    ...(agentConfiguration(config, "opencode")?.contextCompaction === "enabled"
      ? { compaction: { auto: true } } : {}),
    plugin: [],
    enabled_providers: settings.providers.map((p) => p.id),
    provider: Object.fromEntries(
      settings.providers.map((p) => [
        p.id,
        {
          npm:
            p.api === "openai-responses"
              ? "@ai-sdk/openai"
              : "@ai-sdk/openai-compatible",
          name: p.id,
          options: { baseURL: p.baseUrl, apiKey: p.apiKey || "not-required" },
          models: Object.fromEntries(
            p.models.map((m) => [
              m.id,
              {
                name: m.name || m.id,
                limit: { context: m.contextWindow, output: m.maxTokens },
                ...(m.thinking === "off" ? { options: { reasoningEffort: "none" } } : {}),
              },
            ]),
          ),
        },
      ]),
    ),
    skills: { paths: settings.skills.map((s) => s.path) },
    mcp: Object.fromEntries(
      settings.mcp.map((m) => [m.id, { ...m.config, enabled: true }]),
    ),
  };
  return {
    ...environment,
    OPENCODE_CONFIG: agentConfigFile(config, "opencode"),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(native),
    OPENCODE_CONFIG_DIR: agentDirectory(config, "opencode"),
    XDG_CONFIG_HOME: path.join(
      agentDirectory(config, "opencode"),
      "xdg-config",
    ),
    XDG_DATA_HOME: path.join(agentDirectory(config, "opencode"), "xdg-data"),
    XDG_CACHE_HOME: path.join(agentDirectory(config, "opencode"), "xdg-cache"),
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_ENABLE_QUESTION_TOOL: "true",
  };
}
export function nativeEnvironment(config: Config, id: "codex" | "grok") {
  const settings = engineSettings(config, id);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(CODEX_|GROK_|XAI_|OPENAI_|AGENT_BRIDGE_KEY_)/.test(key))
      delete env[key];
  return {
    ...env,
    ...(id === "codex"
      ? { CODEX_HOME: agentDirectory(config, id) }
      : {
          GROK_HOME: agentDirectory(config, id),
          GROK_DISABLE_AUTOUPDATER: "1",
        }),
    ...Object.fromEntries(
      settings.providers.map((p) => [
        `AGENT_BRIDGE_KEY_${p.id}`,
        p.apiKey || "not-required",
      ]),
    ),
  };
}
export function nativeSessionDirectory(
  config: Config,
  id: "codex" | "grok",
  sessionId: string,
) {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId))
    throw new GatewayError(
      "VALIDATION_ERROR",
      "Invalid managed session ID",
      400,
    );
  return path.join(agentDirectory(config, id), "sessions", sessionId);
}
export function nativeSessionEnvironment(
  config: Config,
  id: "codex" | "grok",
  session: { id: string; directory: string },
) {
  // Native project settings can add executable resources despite a managed HOME.
  for (
    let directory = session.directory;
    ;
    directory = path.dirname(directory)
  ) {
    const file = path.join(
      directory,
      id === "codex" ? ".codex" : ".grok",
      "config.toml",
    );
    if (existsSync(file)) {
      const values = parseToml(readFileSync(file, "utf8"));
      if (Object.keys(values).length)
        throw new GatewayError(
          "CONFIGURATION_ERROR",
          `Project configuration is unsupported in managed mode: ${file}. Import these resources into AgentBridge first and remove the conflicting project entries.`,
          400,
        );
    }
    if (id === "grok" && existsSync(path.join(directory, ".mcp.json")))
      throw new GatewayError(
        "CONFIGURATION_ERROR",
        `Project MCP discovery is unsupported in managed mode: ${path.join(directory, ".mcp.json")}`,
        400,
      );
    if (
      directory === path.dirname(directory) ||
      existsSync(path.join(directory, ".git"))
    )
      break;
  }
  const home = nativeSessionDirectory(config, id, session.id);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const native = parseToml(readFileSync(agentConfigFile(config, id), "utf8"));
  if (id === "codex") {
    const skills = path.join(home, "skills");
    rmSync(skills, { recursive: true, force: true });
    mkdirSync(skills, { recursive: true, mode: 0o700 });
    for (const skill of engineSettings(config, id).skills)
      symlinkSync(
        skill.path,
        path.join(skills, skill.id),
        process.platform === "win32" ? "junction" : "dir",
      );
    native.skills = { config: [] };
  }
  atomicWrite(path.join(home, "config.toml"), stringifyToml(native));
  return {
    ...nativeEnvironment(config, id),
    [id === "codex" ? "CODEX_HOME" : "GROK_HOME"]: home,
  };
}
export function restrictNativeSkills(
  config: Config,
  id: "codex" | "grok",
  sessionId: string,
  discovered: { path: string; enabled: boolean }[],
) {
  const allowed = engineSettings(config, id).skills.map((skill) =>
    realpathSync(path.join(skill.path, "SKILL.md")),
  );
  const enabled = (location: string) => {
    try {
      return allowed.includes(
        realpathSync(
          location.endsWith("SKILL.md")
            ? location
            : path.join(location, "SKILL.md"),
        ),
      );
    } catch {
      return false;
    }
  };
  const unwanted = discovered.filter(
    (skill) => skill.enabled && !enabled(skill.path),
  );
  if (!unwanted.length) return false;
  const file = path.join(
    nativeSessionDirectory(config, id, sessionId),
    "config.toml",
  );
  const native = parseToml(readFileSync(file, "utf8"));
  native.skills =
    id === "codex"
      ? {
          config: discovered.map((skill) => ({
            path: skill.path,
            enabled: enabled(skill.path),
          })),
        }
      : {
          paths: engineSettings(config, id).skills.map((skill) => skill.path),
          ignore: unwanted.map((skill) => skill.path),
        };
  atomicWrite(file, stringifyToml(native));
  return true;
}
function atomicWrite(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
export function applyAgentConfiguration(config: Config, id: AgentId) {
  const settings = structuredClone(readSettings(config));
  const snapshots = applied.get(config) ?? new Map<string, Settings>();
  applied.set(config, snapshots);
  const previous = snapshots.get(id);
  snapshots.set(id, settings);
  try {
    const scoped = engineSettings(config, id);
    const agent = agentConfiguration(config, id)!;
    const file = agentConfigFile(config, id);
    if (id === "pi") {
      atomicWrite(
        file,
        JSON.stringify(
          {
            defaultProjectTrust: "never",
            packages: [],
            skills: [],
            extensions: [],
            ...(agent.contextCompaction === "enabled" ? { compaction: { enabled: true } } : {}),
            modelThinkingLevels: Object.fromEntries(scoped.providers.flatMap((p) =>
              p.models.filter((m) => m.thinking === "off").map((m) => [`${p.id}/${m.id}`, "off"]),
            )),
          },
          null,
          2,
        ),
      );
      atomicWrite(
        path.join(piDirectory(config), "models.json"),
        JSON.stringify({ providers: piProviders(config) }, null, 2),
      );
      atomicWrite(
        path.join(piDirectory(config), "mcp.json"),
        JSON.stringify(
          { mcpServers: piMcpConfiguration(settings).servers },
          null,
          2,
        ),
      );
    } else if (id === "opencode")
      atomicWrite(file, opencodeEnvironment(config).OPENCODE_CONFIG_CONTENT);
    else {
      const mcp = Object.fromEntries(
        scoped.mcp.map((m) => [
          m.id,
          m.config.type === "local"
            ? {
                command: m.config.command[0]!,
                args: m.config.command.slice(1),
                env: m.config.environment,
              }
            : {
                url: m.config.url,
                ...(id === "codex"
                  ? { http_headers: m.config.headers }
                  : { headers: m.config.headers }),
              },
        ]),
      );
      const native =
        id === "codex"
          ? {
              ...codexCompactionConfig(config),
              ...(agent.defaultModel
                ? {
                    model: agent.defaultModel.modelID,
                    model_provider: agent.defaultModel.providerID,
                  }
                : {}),
              model_providers: Object.fromEntries(
                scoped.providers.map((p) => [
                  p.id,
                  {
                    name: p.id,
                    base_url: p.baseUrl,
                    env_key: `AGENT_BRIDGE_KEY_${p.id}`,
                    wire_api: "responses",
                    requires_openai_auth: false,
                  },
                ]),
              ),
              mcp_servers: mcp,
              skills: {
                config: scoped.skills.map((s) => ({
                  path: s.path,
                  enabled: true,
                })),
              },
              approval_policy: "on-request",
              sandbox_mode: "workspace-write",
              web_search: "disabled",
            }
          : {
              ...(agent.contextCompaction === "enabled" ? { session: { auto_compact_threshold_percent: 85 } } : {}),
              models: {
                ...(agent.defaultModel
                  ? Object.fromEntries(
                      [
                        "default",
                        "web_search",
                        "session_summary",
                        "image_description",
                        "prompt_suggestion",
                      ].map((key) => [
                        key,
                        `${agent.defaultModel!.providerID}/${agent.defaultModel!.modelID}`,
                      ]),
                    )
                  : {}),
                allowed_models: scoped.providers.flatMap((p) =>
                  p.models.map((m) => `${p.id}/${m.id}`),
                ),
              },
              model: Object.fromEntries(
                scoped.providers.flatMap((p) =>
                  p.models.map((m) => [
                    `${p.id}/${m.id}`,
                    {
                      model: m.id,
                      base_url: p.baseUrl,
                      name: m.name || m.id,
                      env_key: `AGENT_BRIDGE_KEY_${p.id}`,
                      api_backend:
                        p.api === "openai-responses"
                          ? "responses"
                          : "chat_completions",
                      context_window: m.contextWindow,
                      max_completion_tokens: m.maxTokens,
                      supports_backend_search: false,
                      ...(m.thinking === "off" ? {
                        reasoning_efforts: [{ id: "none", value: "none", label: "Off", default: true }],
                      } : {}),
                    },
                  ]),
                ),
              ),
              mcp_servers: mcp,
              skills: { paths: scoped.skills.map((s) => s.path) },
              cli: { auto_update: false },
              compat: {
                cursor: {
                  skills: false,
                  rules: false,
                  agents: false,
                  mcps: false,
                  hooks: false,
                },
                claude: {
                  skills: false,
                  rules: false,
                  agents: false,
                  mcps: false,
                  hooks: false,
                },
              },
            };
      atomicWrite(file, stringifyToml(native));
    }
    return agentRevision(config, id, settings);
  } catch (error) {
    if (previous) snapshots.set(id, previous);
    else snapshots.delete(id);
    throw error;
  }
}

export class SettingsManager {
  constructor(readonly config: Config) {}
  view(): SettingsView {
    const settings = readSettings(this.config);
    const safe = structuredClone(settings);
    for (const p of safe.providers) if (p.apiKey) p.apiKey = hiddenSecret;
    for (const m of safe.mcp) {
      const values =
        m.config.type === "local" ? m.config.environment : m.config.headers;
      for (const key of Object.keys(values))
        if (values[key]) values[key] = hiddenSecret;
    }
    return {
      settings: safe,
      revision: revision(settings),
      dataDirectory: this.config.dataDirectory,
    };
  }
  save(input: unknown): SettingsView {
    const request = z
      .object({ settings: settingsSchema, revision: z.string() })
      .strict()
      .parse(input);
    const previous = readSettings(this.config);
    if (request.revision !== revision(previous))
      throw new GatewayError(
        "CONFLICT",
        "配置已在其他位置修改，请刷新配置后重试；当前草稿将保留",
        409,
      );
    const restore = (value: string, old?: string) => {
      if (value !== hiddenSecret) return value;
      if (old === undefined)
        throw new GatewayError(
          "VALIDATION_ERROR",
          "Enter a value for the new secret",
          400,
        );
      return old;
    };
    for (const p of request.settings.providers)
      p.apiKey = restore(
        p.apiKey,
        previous.providers.find((old) => old.id === p.id)?.apiKey,
      );
    for (const m of request.settings.mcp) {
      const old = previous.mcp.find((entry) => entry.id === m.id)?.config;
      const values =
        m.config.type === "local" ? m.config.environment : m.config.headers;
      const oldValues = old?.type === "local" ? old.environment : old?.headers;
      for (const key of Object.keys(values))
        values[key] = restore(values[key]!, oldValues?.[key]);
    }
    for (const s of request.settings.skills)
      if (
        !path.isAbsolute(s.path) ||
        !existsSync(s.path) ||
        !statSync(s.path).isDirectory() ||
        !existsSync(path.join(s.path, "SKILL.md"))
      )
        throw new GatewayError(
          "VALIDATION_ERROR",
          `Skill must be an existing absolute directory containing SKILL.md: ${s.path}`,
          400,
        );
    atomicWrite(
      path.join(this.config.dataDirectory, "settings.json"),
      JSON.stringify(request.settings, null, 2) + "\n",
    );
    return this.view();
  }
  async testProvider(id: string, input: unknown) {
    const { modelID } = z
      .object({ modelID: z.string().min(1).max(300) })
      .strict()
      .parse(input);
    const provider = readSettings(this.config).providers.find(
      (p) => p.id === id,
    );
    const model = provider?.models.find((m) => m.id === modelID);
    if (!provider || !model)
      throw new GatewayError("VALIDATION_ERROR", "Unknown provider/model", 400);
    const started = Date.now();
    try {
      const responses = provider.api === "openai-responses";
      const result = await fetch(
        `${provider.baseUrl.replace(/\/$/, "")}/${responses ? "responses" : "chat/completions"}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          headers: {
            "Content-Type": "application/json",
            ...(provider.apiKey
              ? { Authorization: `Bearer ${provider.apiKey}` }
              : {}),
          },
          body: JSON.stringify(
            responses
              ? {
                  model: modelID,
                  input: "Reply OK.",
                  max_output_tokens: 64,
                  ...(model.thinking === "off" ? { reasoning: { effort: "none" } } : {}),
                  store: false,
                }
              : {
                  model: modelID,
                  messages: [{ role: "user", content: "Reply OK." }],
                  max_tokens: 64,
                  ...(model.thinking === "off" ? { reasoning_effort: "none" } : {}),
                  stream: false,
                },
          ),
        },
      );
      if (!result.ok) {
        await result.body?.cancel();
        throw new Error(`Provider returned HTTP ${result.status}`);
      }
      const body = object(await result.json());
      if (
        body.error ||
        (responses
          ? !Array.isArray(body.output) && typeof body.output_text !== "string"
          : !Array.isArray(body.choices) || body.choices.length === 0)
      )
        throw new Error("Provider returned an invalid model response");
      return { ok: true, durationMs: Date.now() - started, modelID };
    } catch (error) {
      throw new GatewayError(
        "MODEL_CONNECTION_ERROR",
        errorDetail(error, diagnosticSecrets(this.config)),
        502,
      );
    }
  }
  importNative(id: AgentId, input: unknown) {
    const { file } = z
      .object({ file: z.string().min(1).max(4096) })
      .strict()
      .parse(input);
    if (
      !path.isAbsolute(file) ||
      !existsSync(file) ||
      !statSync(file).isFile() ||
      statSync(file).size > 1024 * 1024
    )
      throw new GatewayError(
        "VALIDATION_ERROR",
        "Expected an absolute configuration file under 1 MiB",
        400,
      );
    const raw = readFileSync(file, "utf8");
    let native: Record<string, unknown>;
    try {
      native = object(
        file.endsWith(".toml") ? parseToml(raw) : JSON.parse(raw),
      );
    } catch {
      throw new GatewayError(
        "VALIDATION_ERROR",
        "Expected a valid JSON or TOML configuration object",
        400,
      );
    }
    const providers: Settings["providers"] = [],
      skills: Settings["skills"] = [],
      mcp: Settings["mcp"] = [],
      warnings: string[] = [];
    const records = (value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? object(value)
        : {};
    const attempt = (name: string, action: () => void) => {
      try {
        action();
      } catch {
        warnings.push(`${name}: unsupported or incomplete configuration`);
      }
    };
    if (id === "grok") {
      for (const [name, value] of Object.entries(records(native.model)))
        attempt(name, () => {
          const m = object(value);
          providers.push(
            providerSchema.parse({
              id: name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100),
              baseUrl: m.base_url,
              api:
                m.api_backend === "responses"
                  ? "openai-responses"
                  : "openai-completions",
              models: [{ id: m.model, name: m.name }],
            }),
          );
        });
    } else if (id === "codex") {
      for (const [name, value] of Object.entries(
        records(native.model_providers),
      ))
        attempt(name, () => {
          const p = object(value);
          providers.push(
            providerSchema.parse({
              id: name,
              baseUrl: p.base_url,
              api: "openai-responses",
              models: [{ id: native.model }],
            }),
          );
        });
    } else {
      for (const [name, value] of Object.entries(
        records(native[id === "pi" ? "providers" : "provider"]),
      ))
        attempt(name, () => {
          const p = object(value),
            options = records(p.options);
          const models = Array.isArray(p.models)
            ? p.models.map((value) => {
                const model = object(value);
                return {
                  id: model.id,
                  name: model.name,
                  contextWindow: model.contextWindow,
                  maxTokens: model.maxTokens,
                };
              })
            : Object.entries(records(p.models)).map(([key, value]) => {
                const model = records(value),
                  limit = records(model.limit);
                return {
                  id: key,
                  name: model.name,
                  contextWindow: limit.context,
                  maxTokens: limit.output,
                };
              });
          providers.push(
            providerSchema.parse({
              id: name,
              baseUrl: p.baseUrl ?? options.baseURL,
              api:
                p.api ??
                (p.npm === "@ai-sdk/openai"
                  ? "openai-responses"
                  : "openai-completions"),
              models,
            }),
          );
        });
    }
    const nativeSkills = Array.isArray(native.skills)
      ? native.skills
      : (records(native.skills).paths ?? records(native.skills).config);
    if (Array.isArray(nativeSkills))
      nativeSkills.forEach((s, index) =>
        attempt(`skill ${index}`, () => {
          const location = typeof s === "string" ? s : object(s).path;
          const resolved = path.resolve(
            path.dirname(file),
            z.string().parse(location),
          );
          skills.push(
            skillSchema.parse({
              id: `imported-skill-${index + 1}`,
              path:
                path.basename(resolved) === "SKILL.md"
                  ? path.dirname(resolved)
                  : resolved,
            }),
          );
        }),
      );
    for (const [name, value] of Object.entries(
      records(native.mcp_servers ?? native.mcpServers ?? native.mcp),
    ))
      attempt(name, () => {
        const m = object(value),
          command = Array.isArray(m.command)
            ? m.command
            : [m.command, ...(Array.isArray(m.args) ? m.args : [])];
        mcp.push(
          mcpSchema.parse({
            id: name,
            config: m.url
              ? { type: "remote", url: m.url, headers: {} }
              : { type: "local", command, environment: {} },
          }),
        );
      });
    return {
      providers,
      skills,
      mcp,
      warnings: [
        ...warnings,
        "Credentials are not imported; enter API keys and MCP secrets before applying.",
      ],
    };
  }
}
