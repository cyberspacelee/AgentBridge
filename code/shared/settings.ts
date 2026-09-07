import { z } from "zod";

const name = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/)
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
        "Duplicate model ID",
      ),
    enabled: z.boolean().default(true),
  })
  .strict();
export const skillSchema = z
  .object({
    id: name,
    path: z.string().min(1).max(4096),
    engine: z.enum(["both", "pi", "opencode"]).default("both"),
    enabled: z.boolean().default(true),
  })
  .strict();
const secrets = z.record(name, z.string().max(8192));
export const mcpSchema = z
  .object({
    id: name,
    engine: z.enum(["both", "pi", "opencode"]).default("opencode"),
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
    piConfigDirectory: z.string().max(4096).default(""),
    opencodeConfigFile: z.string().max(4096).default(""),
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
  });
export type Settings = z.infer<typeof settingsSchema>;
export type Provider = z.infer<typeof providerSchema>;
export interface SettingsView {
  settings: Settings;
  revision: string;
  restartRequired: boolean;
  local: { pi: string; opencode: string };
  effectivePiDirectory: string;
  externalOpenCode: boolean;
  environmentProvider: boolean;
  packages: string[];
  piMcp: { configFile: string; adapterDetected: boolean; serverCount: number };
}
export const hiddenSecret = "********";
