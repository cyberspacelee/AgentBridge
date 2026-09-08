import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { crc32, deflateSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const stage = path.join(root, ".desktop-stage");
const cache = path.join(root, ".desktop-cache");
const nodeVersion = "24.20.0";
const platform = process.platform === "win32" ? "win" : process.platform;
if (
  !["win", "linux", "darwin"].includes(platform) ||
  !["x64", "arm64"].includes(process.arch)
)
  throw new Error("Unsupported desktop build platform");
const extension = platform === "win" ? "zip" : "tar.gz";
const name = `node-v${nodeVersion}-${platform}-${process.arch}`;
const archiveName = `${name}.${extension}`;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body)
    throw new Error(`Download failed: ${url} (${response.status})`);
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination),
  );
}

await mkdir(cache, { recursive: true });
await mkdir(stage, { recursive: true });
const archive = path.join(cache, archiveName);
const sums = await (
  await fetch(`https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`, {
    signal: AbortSignal.timeout(30000),
  })
).text();
const expected = sums
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .find(([, file]) => file === archiveName)?.[0];
if (!expected || !/^[a-f0-9]{64}$/.test(expected))
  throw new Error("Node release checksum not found");
if (!existsSync(archive)) {
  await download(
    `https://nodejs.org/dist/v${nodeVersion}/${archiveName}`,
    `${archive}.partial`,
  );
  await rename(`${archive}.partial`, archive);
}
const digest = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
if (digest !== expected) {
  await rm(archive);
  throw new Error("Node release checksum mismatch; retry preparation");
}
await rm(path.join(stage, "node"), { recursive: true, force: true });
const extracted = path.join(stage, "node-extract");
await rm(extracted, { recursive: true, force: true });
await mkdir(extracted);
await run("tar", ["-xf", archive, "-C", extracted]);
await rename(path.join(extracted, name), path.join(stage, "node"));
await rm(extracted, { recursive: true, force: true });
// Headers are build-time inputs; retain Node/npm executables, licenses and runtime files.
await rm(path.join(stage, "node/include"), { recursive: true, force: true });
await rm(path.join(stage, "node/share/man"), { recursive: true, force: true });

const backend = path.join(stage, "backend");
await rm(backend, { recursive: true, force: true });
const pnpm = process.env.npm_execpath;
if (!pnpm || !pnpm.includes("pnpm"))
  throw new Error("Run preparation through pnpm desktop:prepare");
await run(process.execPath, [
  pnpm,
  "--filter=agentbridge",
  "--config.inject-workspace-packages=true",
  "deploy",
  "--prod",
  backend,
]);
await cp(path.join(root, "web/dist"), path.join(backend, "web/dist"), {
  recursive: true,
});

const seen = new Set();
async function inspect(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await realpath(file);
      if (target !== backend && !target.startsWith(`${backend}${path.sep}`))
        throw new Error(`Dependency link escapes package: ${file}`);
      continue;
    }
    if (entry.isDirectory()) {
      if (
        [
          "electron",
          "opencode-ai",
          "pi-coding-agent",
          "pi-mcp-adapter",
          "playwright",
          "typescript",
        ].includes(entry.name)
      )
        throw new Error(`Unexpected desktop runtime dependency: ${file}`);
      bytes += await inspect(file);
    } else {
      if (entry.name.endsWith(".map")) {
        await rm(file);
        continue;
      }
      const info = await stat(file);
      const key = `${info.dev}:${info.ino}`;
      if (!seen.has(key)) bytes += info.size;
      seen.add(key);
    }
  }
  return bytes;
}
const backendBytes = await inspect(backend);

// A small raster terminal mark used by the installer and system tray.
const size = 1024;
const pixels = Buffer.alloc(size * (1 + size * 4));
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const at = y * (1 + size * 4) + 1 + x * 4;
    const px = x * 256 / size, py = y * 256 / size;
    const chevron =
      px >= 52 && px <= 118 && Math.abs(Math.abs(py - 117) - (118 - px)) < 10;
    const line = px >= 126 && px <= 204 && py >= 165 && py <= 184;
    const color = chevron
      ? [77, 222, 160]
      : line
        ? [244, 246, 247]
        : [25, 29, 33];
    pixels.set([...color, 255], at);
  }
function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(data));
  return Buffer.concat([length, data, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
await writeFile(
  path.join(root, "desktop/icon.png"),
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
await writeFile(
  path.join(stage, "manifest.json"),
  JSON.stringify(
    {
      nodeVersion,
      platform,
      arch: process.arch,
      nodeArchiveSha256: digest,
      backendBytes,
    },
    null,
    2,
  ),
);
console.log(
  `Desktop resources prepared: backend ${(backendBytes / 1048576).toFixed(1)} MiB; Node ${nodeVersion}; ${platform}-${process.arch}; no Agent CLI bundled.`,
);
