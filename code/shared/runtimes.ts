import { z } from "zod";
import type { AgentId } from "./settings.js";

export const runtimeActionSchema = z.object({
  action: z.enum(["check", "detect", "install", "update", "uninstall", "cancel"]),
}).strict();
export type RuntimeAction = z.infer<typeof runtimeActionSchema>["action"];
export interface RuntimeView {
  id: AgentId;
  managed: boolean;
  executable: string | null;
  detection: "unknown" | "checking" | "present" | "missing" | "failed";
  detectedAt: string | null;
  compatibility: "unknown" | "compatible" | "incompatible";
  usable: boolean;
  platform: string;
  installedVersion: string | null;
  managedVersion: string | null;
  latestVersion: string | null;
  runningVersion: string | null;
  checkedAt: string | null;
  checkError: string | null;
  status: "not_installed" | "installed" | "installing" | "uninstalling" | "failed";
  updateStatus: "idle" | "checking" | "available" | "downloading" | "switching" | "failed";
  operation: Exclude<RuntimeAction, "cancel"> | "source" | null;
  cancelable: boolean;
  progress: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  sizeBytes: number | null;
  error: string | null;
  source: string | null;
  integrity: string | null;
}
