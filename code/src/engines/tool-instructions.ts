import path from "node:path";
import { existsSync } from "node:fs";

const sourceRoot = path.resolve(import.meta.dirname, "../../");
export const codeRoot = existsSync(path.join(sourceRoot, "tools/pi-extension.mjs"))
  ? sourceRoot
  : path.resolve(import.meta.dirname, "../../../");

export function toolInstructions(directory: string): string {
  return [
    "You are executing a delegated task in the supplied working directory. Finish without human input when interaction policy is automatic. Do not claim a file or external action succeeded without checking the actual result.",
    `Working directory: ${JSON.stringify(directory)}. Preserve input files unless the task explicitly requests deletion or overwrite.`,
    "Use installed skills and available tools for office tasks. Validate generated documents, re-open outputs, and report actual output paths. Missing integrations, model credentials, or failed commands must be reported as failures, never simulated.",
  ].join("\n");
}
