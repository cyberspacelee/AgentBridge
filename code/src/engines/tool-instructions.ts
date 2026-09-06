import path from "node:path";
import { existsSync } from "node:fs";

const sourceRoot = path.resolve(import.meta.dirname, "../../");
export const codeRoot = existsSync(path.join(sourceRoot, "tools/office.py"))
  ? sourceRoot
  : path.resolve(import.meta.dirname, "../../../");
export const toolsPython =
  process.env.AGENT_TOOLS_PYTHON ??
  path.join(
    codeRoot,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );

export function toolInstructions(directory: string): string {
  return [
    "You are executing a delegated task in the supplied working directory. Finish without human input when interaction policy is automatic. Do not claim a file or external action succeeded without checking the actual result.",
    `Working directory: ${JSON.stringify(directory)}. Preserve input files unless the task explicitly requests deletion or overwrite.`,
    `Shared tool documentation: ${JSON.stringify(path.join(codeRoot, "tools/README.md"))}. Read it using your native file tool before an office task.`,
    `Prepared Python executable: ${JSON.stringify(toolsPython)}. Tool entry point: ${JSON.stringify(path.join(codeRoot, "tools/office.py"))}.`,
    "Use native file/command tools to write a UTF-8 JSON request and invoke the Python tool with --directory and --request. It supports docx/pptx read and preserving package edits, table export, presentation creation, spreadsheet/CSV aggregation, validation, file find/delete, configured search and Windows Outlook launch. Installed Python libraries also support custom scripts.",
    "Validate generated documents, re-open outputs, and report actual output paths. Missing integrations, model credentials, or failed commands must be reported as failures, never simulated. WeLink is unavailable until a target integration is configured.",
  ].join("\n");
}
