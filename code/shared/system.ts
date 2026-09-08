import { z } from "zod";

export const networkSchema = z.object({
  mode: z.enum(["environment", "direct", "manual"]),
  proxyUrl: z.string().max(2048),
  proxyUsername: z.string().max(512),
  noProxy: z.string().max(4096),
  useSystemCa: z.boolean(),
  caFile: z.string().max(4096),
}).strict();
export type NetworkSettings = z.infer<typeof networkSchema>;
export const networkInputSchema = networkSchema.extend({ proxyPassword: z.string().max(4096).optional() });
export type NetworkInput = z.infer<typeof networkInputSchema>;
export interface NetworkView {
  settings: NetworkSettings;
  hasPassword: boolean;
  restartRequired: boolean;
  revision: string;
  appliedRevision: string;
  protection: "os" | "file";
  error: string | null;
}
export interface SystemView {
  storeId: string;
  version: string;
  nodeVersion: string;
  nodePath: string;
  npmPath: string | null;
  capabilities: { network: boolean; restart: boolean; directories: boolean; certificates: boolean };
  maintenance: "ready" | "draining" | "stopping";
}
export interface DirectoryView {
  directory: string | null;
  parent: string | null;
  entries: { name: string; path: string }[];
  truncated: boolean;
}
export const lifecycleSchema = z.object({ action: z.enum(["restart", "shutdown"]), mode: z.enum(["wait", "stop"]) }).strict();
