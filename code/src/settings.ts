import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { z } from "zod";
import {
  settingsSchema,
  hiddenSecret,
  providerSchema,
  type Settings,
  type SettingsView,
} from "../shared/settings.js";
import type { Config } from "./config.js";
import { GatewayError, errorDetail } from "./errors.js";
import {
  startProcess,
  stopProcess,
  processDiagnostic,
} from "./engines/process.js";
import { within } from "./async.js";

export function readJson(file: string): Record<string, unknown> {
  try {
    return z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new GatewayError(
      "VALIDATION_ERROR",
      `Cannot read configuration: ${file}`,
      400,
    );
  }
}
export function readSettings(config: Config): Settings {
  return settingsSchema.parse(
    readJson(path.join(config.dataDirectory, "settings.json")),
  );
}
export function piDirectory(config: Config, settings = readSettings(config)) {
  return path.resolve(
    config.pi.configDirectory ||
      settings.piConfigDirectory ||
      path.join(config.dataDirectory, "pi"),
  );
}
export function configuredProviders(
  config: Config,
  settings = readSettings(config),
) {
  const providers = settings.providers.filter((provider) => provider.enabled);
  if (config.compatibleProvider) {
    const provider = providerSchema.parse(config.compatibleProvider);
    return [...providers.filter((item) => item.id !== provider.id), provider];
  }
  return providers;
}
export function diagnosticSecrets(config: Config): string[] {
  const values = [
    config.opencode.password,
    config.compatibleProvider?.apiKey ?? "",
  ];
  // Invalid settings must not hide the error we are trying to report.
  try {
    const settings = readSettings(config);
    values.push(
      ...settings.providers.map((provider) => provider.apiKey),
      ...settings.mcp.flatMap((mcp) =>
        Object.values(
          mcp.config.type === "local"
            ? mcp.config.environment
            : mcp.config.headers,
        ),
      ),
    );
  } catch {}
  return values;
}
export function piProviders(config: Config) {
  return Object.fromEntries(
    configuredProviders(config).map((provider) => [
      provider.id,
      {
        baseUrl: provider.baseUrl,
        api: provider.api,
        // Escape Pi's command/environment interpolation: page keys are literal secrets.
        apiKey: (provider.apiKey || "not-required")
          .replaceAll("$", () => "$$")
          .replace(/^!/, "$!"),
        models: provider.models.map((model) => ({
          ...model,
          name: model.name || model.id,
          reasoning: false,
          input: ["text"] as ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
      },
    ]),
  );
}
export function opencodeEnvironment(config: Config) {
  const settings = readSettings(config);
  const content = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || "{}"));
  const provider = {
    ...z.record(z.string(), z.unknown()).parse(content.provider || {}),
  };
  for (const item of configuredProviders(config, settings))
    provider[item.id] = {
      npm:
        item.api === "openai-responses"
          ? "@ai-sdk/openai"
          : "@ai-sdk/openai-compatible",
      name: item.id,
      options: { baseURL: item.baseUrl, apiKey: item.apiKey || "not-required" },
      models: Object.fromEntries(
        item.models.map((model) => [
          model.id,
          {
            name: model.name || model.id,
            limit: { context: model.contextWindow, output: model.maxTokens },
          },
        ]),
      ),
    };
  const skills = z.record(z.string(), z.unknown()).parse(content.skills || {});
  return {
    ...(settings.opencodeConfigFile
      ? { OPENCODE_CONFIG: settings.opencodeConfigFile }
      : {}),
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...content,
      provider,
      skills: {
        ...skills,
        paths: [
          ...z.array(z.string()).parse(skills.paths || []),
          ...settings.skills
            .filter((s) => s.enabled && s.engine !== "pi")
            .map((s) => s.path),
        ],
      },
      mcp: {
        ...z.record(z.string(), z.unknown()).parse(content.mcp || {}),
        ...Object.fromEntries(
          settings.mcp
            .filter((m) => m.engine !== "pi")
            .map((m) => [m.id, { ...m.config, enabled: m.enabled }]),
        ),
      },
    }),
  };
}
const revision = (settings: Settings) =>
  createHash("sha256").update(JSON.stringify(settings)).digest("hex");
const restartSnapshot = (settings: Settings) =>
  JSON.stringify([
    settings.opencodeConfigFile,
    settings.providers,
    settings.skills.filter((skill) => skill.engine !== "pi"),
    settings.mcp.filter((mcp) => mcp.engine !== "pi"),
  ]);

export function piMcpConfiguration(settings: Settings) {
  const environment: NodeJS.ProcessEnv = {};
  const servers = Object.fromEntries(
    settings.mcp
      .filter((m) => m.engine !== "opencode")
      .map((m) => {
        const literal = (field: string, value: string) => {
          const key = `AGENT_BRIDGE_MCP_SECRET_${createHash("sha256")
            .update(JSON.stringify([m.id, field]))
            .digest("hex")}`;
          environment[key] = value;
          // The adapter expands {env:NAME} last, after checking for command secrets.
          return `{env:${key}}`;
        };
        const entries = (field: string, values: Record<string, string>) =>
          Object.fromEntries(
            Object.entries(values).map(([key, value]) => [
              key,
              literal(`${field}.${key}`, value),
            ]),
          );
        return [
          m.id,
          {
            ...(m.config.type === "local"
              ? {
                  command: m.config.command[0],
                  args: m.config.command
                    .slice(1)
                    .map((value, index) => literal(`args.${index}`, value)),
                  env: entries("env", m.config.environment),
                }
              : {
                  url: literal("url", m.config.url),
                  headers: entries("headers", m.config.headers),
                }),
            disabled: !m.enabled,
          },
        ];
      }),
  );
  return { servers, environment };
}

type ConfigWrite = { file: string; value: unknown };
function piMcpWrites(
  config: Config,
  settings: Settings,
  previous?: Settings,
): ConfigWrite[] {
  const directory = piDirectory(config, settings);
  const targets = new Map([[directory, piMcpConfiguration(settings).servers]]);
  if (previous && piDirectory(config, previous) !== directory)
    targets.set(piDirectory(config, previous), {});
  return [...targets].flatMap(([target, generated]) => {
    const file = path.join(target, "mcp.json");
    if (!Object.keys(generated).length && !existsSync(file)) return [];
    let native: Record<string, unknown>;
    try {
      native = readJson(file);
    } catch (error) {
      // Native JSONC remains the extension's concern when no managed entries need syncing.
      if (
        !Object.keys(generated).length &&
        !previous?.mcp.some((m) => m.engine !== "opencode")
      )
        return [];
      throw error;
    }
    const ownership = z
      .object({ owner: z.string(), servers: z.array(z.string()) })
      .optional()
      .parse(native._agentbridge);
    if (
      !Object.keys(generated).length &&
      ownership?.owner !== config.dataDirectory
    )
      return [];
    if (ownership && ownership.owner !== config.dataDirectory)
      throw new GatewayError(
        "CONFLICT",
        `Pi MCP configuration is managed by another gateway: ${file}`,
        409,
      );
    const servers = {
      ...z
        .record(z.string(), z.unknown())
        .parse(native.mcpServers ?? native["mcp-servers"] ?? {}),
    };
    for (const id of Object.keys(generated))
      if (Object.hasOwn(servers, id) && !ownership?.servers.includes(id))
        throw new GatewayError(
          "CONFLICT",
          `Pi MCP server ${id} already exists in ${file}; use another name`,
          409,
        );
    for (const id of ownership?.servers ?? []) delete servers[id];
    const value = {
      ...native,
      mcpServers: { ...servers, ...generated },
      _agentbridge: {
        owner: config.dataDirectory,
        servers: Object.keys(generated),
      },
    };
    return JSON.stringify(native) === JSON.stringify(value)
      ? []
      : [{ file, value }];
  });
}

function writeConfigFiles(writes: ConfigWrite[]) {
  const staged: {
    file: string;
    temporary: string;
    previous?: Buffer;
    committed: boolean;
  }[] = [];
  try {
    for (const { file, value } of writes) {
      const previous = existsSync(file) ? readFileSync(file) : undefined;
      mkdirSync(path.dirname(file), { recursive: true });
      const item = {
        file,
        temporary: `${file}.${randomUUID()}.tmp`,
        previous,
        committed: false,
      };
      staged.push(item);
      writeFileSync(item.temporary, JSON.stringify(value, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
    }
    for (const item of staged) {
      renameSync(item.temporary, item.file);
      item.committed = true;
    }
  } catch (error) {
    // Restore derived files if committing the gateway settings fails.
    for (const item of staged.reverse()) {
      if (!item.committed) continue;
      if (item.previous === undefined) rmSync(item.file, { force: true });
      else {
        writeFileSync(item.temporary, item.previous, {
          mode: 0o600,
          flag: "wx",
        });
        renameSync(item.temporary, item.file);
      }
    }
    throw new GatewayError(
      "CONFIGURATION_ERROR",
      `Could not save configuration: ${errorDetail(error)}`,
      500,
    );
  } finally {
    for (const item of staged) rmSync(item.temporary, { force: true });
  }
}

export function syncPiMcp(config: Config, settings = readSettings(config)) {
  writeConfigFiles(piMcpWrites(config, settings));
  return piMcpConfiguration(settings).environment;
}

export class SettingsManager {
  private initial: string;
  private installing = false;
  constructor(private config: Config) {
    this.initial = restartSnapshot(readSettings(config));
  }
  view(): SettingsView {
    const settings = readSettings(this.config);
    const safe = structuredClone(settings);
    for (const provider of safe.providers)
      if (provider.apiKey) provider.apiKey = hiddenSecret;
    for (const mcp of safe.mcp) {
      const values =
        mcp.config.type === "local"
          ? mcp.config.environment
          : mcp.config.headers;
      for (const key of Object.keys(values))
        if (values[key]) values[key] = hiddenSecret;
    }
    const packages = z
      .array(z.union([z.string(), z.object({ source: z.string() })]))
      .parse(
        readJson(path.join(piDirectory(this.config, settings), "settings.json"))
          .packages || [],
      );
    const localOpenCode = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "opencode",
      "opencode.json",
    );
    const directory = piDirectory(this.config, settings);
    const adapterDetected = packages.some((item) => {
      const source = typeof item === "string" ? item : item.source;
      if (/^npm:pi-mcp-adapter(?:@|$)/.test(source))
        return existsSync(
          path.join(directory, "npm/node_modules/pi-mcp-adapter/package.json"),
        );
      if (/^(npm:|git:|https?:|ssh:|git@)/.test(source)) return false;
      const manifest = path.resolve(
        directory,
        source.startsWith("~/")
          ? path.join(os.homedir(), source.slice(2))
          : source,
        "package.json",
      );
      try {
        return readJson(manifest).name === "pi-mcp-adapter";
      } catch {
        return false;
      }
    });
    return {
      settings: safe,
      revision: revision(settings),
      restartRequired: this.initial !== restartSnapshot(settings),
      local: {
        pi: path.join(os.homedir(), ".pi/agent"),
        opencode:
          !existsSync(localOpenCode) && existsSync(`${localOpenCode}c`)
            ? `${localOpenCode}c`
            : localOpenCode,
      },
      effectivePiDirectory: piDirectory(this.config, settings),
      externalOpenCode: !this.config.opencode.managed,
      environmentProvider: !!this.config.compatibleProvider,
      piMcp: {
        configFile: path.join(directory, "mcp.json"),
        adapterDetected,
        serverCount: settings.mcp.filter(
          (m) => m.engine !== "opencode" && m.enabled,
        ).length,
      },
      packages: packages.map((item) => {
        const source = typeof item === "string" ? item : item.source;
        return /^(npm:|git:|https?:|ssh:|git@)/.test(source)
          ? source
          : path.resolve(
              piDirectory(this.config, settings),
              source.startsWith("~/")
                ? path.join(os.homedir(), source.slice(2))
                : source,
            );
      }),
    };
  }
  save(input: unknown) {
    if (this.installing)
      throw new GatewayError(
        "CONFLICT",
        "Pi package operation in progress",
        409,
      );
    const request = z
      .object({ settings: settingsSchema, revision: z.string() })
      .strict()
      .parse(input);
    const previous = readSettings(this.config);
    if (request.revision !== revision(previous))
      throw new GatewayError(
        "CONFLICT",
        "Configuration changed; reload before saving",
        409,
      );
    const settings = request.settings;
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
    for (const provider of settings.providers)
      provider.apiKey = restore(
        provider.apiKey,
        previous.providers.find((p) => p.id === provider.id)?.apiKey,
      );
    for (const mcp of settings.mcp) {
      const old = previous.mcp.find((m) => m.id === mcp.id)?.config;
      const values =
        mcp.config.type === "local"
          ? mcp.config.environment
          : mcp.config.headers;
      const oldValues = old?.type === "local" ? old.environment : old?.headers;
      for (const key of Object.keys(values))
        values[key] = restore(values[key]!, oldValues?.[key]);
    }
    for (const [file, directory] of [
      [settings.piConfigDirectory, true],
      [settings.opencodeConfigFile, false],
      ...settings.skills.map((s) => [s.path, true]),
    ] as [string, boolean][]) {
      if (!file) continue;
      if (
        !path.isAbsolute(file) ||
        !existsSync(file) ||
        (directory ? !statSync(file).isDirectory() : !statSync(file).isFile())
      )
        throw new GatewayError(
          "VALIDATION_ERROR",
          `Expected an existing absolute ${directory ? "directory" : "file"}: ${file}`,
          400,
        );
    }
    writeConfigFiles([
      ...piMcpWrites(this.config, settings, previous),
      {
        file: path.join(this.config.dataDirectory, "settings.json"),
        value: settings,
      },
    ]);
    return this.view();
  }
  async packageOperation(input: unknown) {
    const { action, source } = z
      .object({
        action: z.enum(["install", "remove"]),
        source: z
          .string()
          .min(1)
          .max(2048)
          .refine(
            (s) =>
              !/[\r\n\0]/.test(s) &&
              (s.startsWith("npm:") ||
                s.startsWith("git:") ||
                /^(https?|ssh|git):\/\//.test(s) ||
                path.isAbsolute(s)),
            "Use npm:, git:, https:// or an absolute path",
          ),
      })
      .strict()
      .parse(input);
    if (this.installing)
      throw new GatewayError(
        "CONFLICT",
        "Pi package operation in progress",
        409,
      );
    this.installing = true;
    const directory = piDirectory(this.config);
    let child: ReturnType<typeof startProcess> | undefined;
    try {
      mkdirSync(directory, { recursive: true });
      child = startProcess(
        this.config.pi.command,
        [action, source],
        directory,
        {
          ...process.env,
          PI_CODING_AGENT_DIR: directory,
          PI_TELEMETRY: "0",
          PI_SKIP_VERSION_CHECK: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
      );
      child.stdout.resume();
      child.stdin.end();
      await within(
        new Promise<void>((resolve, reject) => {
          child!.once("error", (error) =>
            reject(
              new GatewayError(
                "ENGINE_ERROR",
                `Pi package command could not start: ${errorDetail(error, diagnosticSecrets(this.config))}`,
                502,
              ),
            ),
          );
          child!.once("close", (code) =>
            code === 0
              ? resolve()
              : reject(
                  new GatewayError(
                    "ENGINE_ERROR",
                    `Pi ${action} failed: ${errorDetail(processDiagnostic(child!), diagnosticSecrets(this.config))}`,
                    502,
                  ),
                ),
          );
        }),
        120000,
      );
      return this.view();
    } finally {
      try {
        if (child) await stopProcess(child, this.config.limits.abortTimeoutMs);
      } finally {
        this.installing = false;
      }
    }
  }
}
