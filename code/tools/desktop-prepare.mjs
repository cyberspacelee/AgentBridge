import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const stage = path.join(root, ".desktop-stage");
const platform = process.platform === "win32" ? "win" : process.platform;
if (
  !["win", "linux", "darwin"].includes(platform) ||
  !["x64", "arm64"].includes(process.arch)
)
  throw new Error("Unsupported desktop build platform");

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

await mkdir(stage, { recursive: true });

const backend = path.join(stage, "backend");
await rm(backend, { recursive: true, force: true });
const pnpm = process.env.npm_execpath;
if (!pnpm || !pnpm.includes("pnpm"))
  throw new Error("Run preparation through pnpm desktop:prepare");
await run(process.execPath, [
  pnpm,
  "--filter=agentbridge",
  "--config.inject-workspace-packages=true",
  "--config.node-linker=hoisted",
  "deploy",
  "--prod",
  backend,
]);
await cp(path.join(root, "web/dist"), path.join(backend, "web/dist"), {
  recursive: true,
});

async function inspect(directory) {
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
      await inspect(file);
    } else {
      if (entry.name.endsWith(".map")) {
        await rm(file);
        continue;
      }
    }
  }
}
await inspect(backend);

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
console.log(`Desktop resources prepared for ${platform}-${process.arch}; no Node or Agent CLI bundled.`);
