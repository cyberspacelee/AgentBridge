import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { rootCertificates } from "node:tls";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Socket } from "node:net";

test("start and dev load proxy, bypass and CA settings before Node initializes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-startup-"));
  const sockets = new Set<Socket>();
  let proxyRequests = 0;
  const proxy = createServer((_request, response) => {
    proxyRequests++;
    response.end("proxy");
  });
  proxy.on("connect", (_request, socket) => {
    proxyRequests++;
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () =>
      socket.end(
        "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nproxy",
      ),
    );
  });
  const direct = createServer((_request, response) => response.end("direct"));
  try {
    for (const server of [proxy, direct]) {
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
    }
    const proxyPort = (proxy.address() as { port: number }).port;
    const directPort = (direct.address() as { port: number }).port;
    await writeFile(path.join(directory, "ca.pem"), rootCertificates[0]!);
    await writeFile(
      path.join(directory, ".env"),
      `HTTP_PROXY=http://127.0.0.1:${proxyPort}\nHTTPS_PROXY=http://127.0.0.1:${proxyPort}\nNO_PROXY=127.0.0.1\nNODE_USE_ENV_PROXY=1\nNODE_EXTRA_CA_CERTS=./ca.pem\nSTARTUP_PRIORITY=file\n`,
    );
    const probe = path.join(directory, "probe.mjs");
    await writeFile(
      probe,
      `import { getCACertificates } from 'node:tls';
console.log(JSON.stringify({
  proxy: await (await fetch('http://proxy-check.invalid')).text(),
  direct: await (await fetch('http://127.0.0.1:${directPort}')).text(),
  ca: getCACertificates('extra').length,
  priority: process.env.STARTUP_PRIORITY,
  args: process.argv.slice(2),
}));`,
    );
    const { scripts } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(NODE_|https?_proxy$|no_proxy$|all_proxy$)/i.test(key),
      ),
    );
    for (const name of ["start", "dev"]) {
      // Replace the entry and omit watch mode so the real launcher exits after the probe.
      const args = (scripts[name] as string)
        .split(" ")
        .slice(1, -1)
        .filter((arg) => arg !== "--watch")
        .map((arg) =>
          arg === "tsx"
            ? import.meta.resolve("tsx")
            : arg === "tools/start.mjs"
              ? fileURLToPath(new URL("../tools/start.mjs", import.meta.url))
              : arg,
        );
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [...args, probe, "--engine", "pi"],
        {
          cwd: directory,
          env: { ...env, STARTUP_PRIORITY: "process" },
          timeout: 15000,
        },
      );
      assert.deepEqual(JSON.parse(stdout), {
        proxy: "proxy",
        direct: "direct",
        ca: 1,
        priority: "process",
        args: ["--engine", "pi"],
      });
    }
    assert.equal(proxyRequests, 2);
    await rm(path.join(directory, ".env"));
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [
          fileURLToPath(new URL("../tools/start.mjs", import.meta.url)),
          "-e",
          "process.exitCode = 7",
        ],
        { cwd: directory, env, timeout: 15000 },
      ),
      { code: 7 },
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    for (const server of [proxy, direct]) server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
