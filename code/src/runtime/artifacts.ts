import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Artifact, Run, Session } from "../../shared/contracts.js";
import { GatewayError } from "../errors.js";

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}
export async function validateDirectory(
  directory: string,
  allowed: string[],
): Promise<string> {
  if (!path.isAbsolute(directory))
    throw new GatewayError(
      "VALIDATION_ERROR",
      "Working directory must be an absolute server path",
      400,
    );
  let resolved: string;
  try {
    resolved = await realpath(directory);
    if (!(await stat(resolved)).isDirectory())
      throw new Error("not a directory");
  } catch {
    throw new GatewayError(
      "VALIDATION_ERROR",
      "Working directory does not exist or cannot be accessed",
      400,
    );
  }
  if (
    allowed.length &&
    !(await Promise.all(allowed.map((p) => realpath(p)))).some((root) =>
      isWithin(root, resolved),
    )
  )
    throw new GatewayError(
      "VALIDATION_ERROR",
      "Working directory is outside the allowed roots",
      400,
    );
  return resolved;
}
const media: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
};
export async function discoverFiles(
  root: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let visited = 0;
  async function visit(directory: string, depth: number) {
    if (depth > 10) return;
    for await (const entry of await opendir(directory)) {
      if (++visited > 10000)
        throw new GatewayError(
          "SERVICE_UNAVAILABLE",
          `Artifact discovery exceeded 10000 entries under ${root} (at ${directory})`,
          503,
          "artifact",
        );
      if (
        entry.isSymbolicLink() ||
        [".git", "node_modules", ".agentbridge", ".venv"].includes(entry.name)
      )
        continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full, depth + 1);
      else if (
        entry.isFile() &&
        media[path.extname(entry.name).toLowerCase()]
      ) {
        const s = await stat(full);
        files.set(path.relative(root, full), `${s.size}:${s.mtimeMs}`);
      }
    }
  }
  await visit(root, 0);
  return files;
}
export async function artifactPath(
  root: string,
  relativePath: string,
): Promise<string> {
  const candidate = path.resolve(root, relativePath);
  if (!isWithin(root, candidate))
    throw new GatewayError("NOT_FOUND", "Artifact not available", 404);
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new GatewayError("NOT_FOUND", "Artifact file is missing", 404);
  }
  if (!isWithin(root, resolved) || !(await stat(resolved)).isFile())
    throw new GatewayError("NOT_FOUND", "Artifact not available", 404);
  return resolved;
}
export async function digestFile(filename: string): Promise<string> {
  if ((await stat(filename)).size > 100 * 1024 * 1024)
    throw new GatewayError(
      "SERVICE_UNAVAILABLE",
      "Artifact exceeds 100 MiB verification limit",
      503,
    );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}
export async function registerChangedFiles(
  session: Session,
  run: Run,
  before: Map<string, string>,
): Promise<Artifact[]> {
  const after = await discoverFiles(session.directory);
  const result: Artifact[] = [];
  for (const [relativePath, signature] of after) {
    if (before.get(relativePath) === signature) continue;
    const filename = await artifactPath(session.directory, relativePath);
    const info = await stat(filename);
    result.push({
      id: randomUUID(),
      sessionId: session.id,
      runId: run.id,
      relativePath,
      displayName: path.basename(filename),
      mediaType:
        media[path.extname(filename).toLowerCase()] ??
        "application/octet-stream",
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      digest: await digestFile(filename),
      registeredAt: new Date().toISOString(),
      availability: "available",
      validation: "not_checked",
    });
  }
  return result;
}
