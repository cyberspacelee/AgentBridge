import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { rootCertificates } from "node:tls";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Socket } from "node:net";
import { defaultNetworkSettings, validateNetworkSettings, networkEnvironment, proxyAddress } from "../host/network.mjs";
import { readConfig } from "../src/config.js";

test("npm registry configuration validates URLs, preserves repository paths and overrides inherited npm settings", () => {
  for (const registry of ["https://registry.npmjs.org", "https://registry.npmmirror.com", "https://packages.example.com:8443/repository/npm"]) {
    const settings = validateNetworkSettings({ npmRegistry: registry });
    assert.equal(settings.npmRegistry, registry + "/");
    const env = networkEnvironment(settings, { NPM_CONFIG_REGISTRY: "https://old.invalid/", Npm_Config_Registry: "https://mixed.invalid/", AGENT_NPM_REGISTRY: "https://other.invalid/" });
    assert.equal(env.NPM_CONFIG_REGISTRY, undefined);
    assert.equal(env.Npm_Config_Registry, undefined);
    assert.equal(env.npm_config_registry, registry + "/");
    assert.equal(readConfig([], env).npmRegistry, registry + "/");
  }
  for (const npmRegistry of [null, "", "http://mirror.invalid", "file:///tmp/npm", "https://user:password@mirror.invalid", "https://@mirror.invalid", "https://mirror.invalid?token=secret", "https://mirror.invalid#fragment", "https://mirror.invalid\\path", "https://mirror.invalid/\nignore-scripts=false", "https://mirror.invalid:0", "https://mirror.invalid/" + "x".repeat(2048)]) {
    assert.throws(() => validateNetworkSettings({ npmRegistry }), /npm 源必须/);
  }
  assert.equal(readConfig([], {}).npmRegistry, "https://registry.npmjs.org/");
});

test("network settings validate fixed fields, proxy addresses, bypass rules and secret preservation", () => {
  assert.deepEqual(validateNetworkSettings({}), { ...defaultNetworkSettings, proxyPassword: "" });
  assert.equal(validateNetworkSettings({}, "saved password").proxyPassword, "saved password");
  assert.equal(validateNetworkSettings({ proxyPassword: "" }, "saved password").proxyPassword, "");
  assert.equal(validateNetworkSettings({ noProxy: " .example.com,localhost,*.internal,127.0.0.2:8080,[::1]:80,::1 " }).noProxy, ".example.com,localhost,*.internal,127.0.0.2:8080,[::1]:80,::1");
  const password = "private-p@ss:/#?% 雪";
  const manual = validateNetworkSettings({ mode: "manual", proxyUrl: "http://proxy.invalid:8080", proxyUsername: "user@example", proxyPassword: password });
  const address = new URL(proxyAddress(manual));
  assert.equal(decodeURIComponent(address.username), "user@example");
  assert.equal(decodeURIComponent(address.password), password);
  assert.equal(address.hostname, "proxy.invalid");
  assert.equal(address.pathname, "/");
  for (const input of [
    null, [], "manual", { unexpected: true }, { mode: "system" }, { useSystemCa: "true" },
    { proxyUrl: null }, { proxyPassword: 12 }, { proxyUsername: "user:name" },
    { proxyUsername: "x".repeat(513) }, { proxyPassword: "x".repeat(4097) },
    { mode: "manual" }, { proxyUrl: "socks5://proxy.invalid:1080" },
    { proxyUrl: `http://user:${password}@proxy.invalid` }, { proxyUrl: "https://@proxy.invalid" },
    { proxyUrl: "https://proxy.invalid/path" }, { proxyUrl: "https://proxy.invalid?secret=yes" },
    { proxyUrl: "https://proxy.invalid#fragment" }, { proxyUrl: "https://proxy.invalid\\path" },
    { proxyUrl: "http://proxy.invalid:0" }, { proxyUrl: "http://proxy.invalid:65536" },
    { noProxy: "localhost\r\nHTTP_PROXY=http://other.invalid" }, { noProxy: "<-loopback>" },
    { noProxy: "localhost;*" }, { noProxy: "http://example.com" }, { noProxy: "host:65536" },
    { noProxy: "host,,localhost" }, { noProxy: "host/8" }, { noProxy: "[bad:ipv6]" },
    { proxyPassword: "hidden\nvalue" },
  ]) {
    assert.throws(() => validateNetworkSettings(input), (error: Error) => {
      assert.ok(!error.message.includes(password));
      return true;
    });
  }
});

test("network modes override inherited proxies without mutating the environment or disabling TLS", () => {
  const base = { KEEP: "yes", HTTP_PROXY: "http://upper.invalid", http_proxy: "http://lower.invalid", Https_Proxy: "http://mixed.invalid", ALL_PROXY: "http://all.invalid", NO_PROXY: "legacy.invalid", no_proxy: "second.invalid", NPM_CONFIG_PROXY: "http://npm.invalid", NPM_CONFIG_NOPROXY: "npm-bypass.invalid", NODE_EXTRA_CA_CERTS: "/inherited-ca.pem", NODE_TLS_REJECT_UNAUTHORIZED: "0", NPM_CONFIG_STRICT_SSL: "false" };
  const original = { ...base };
  const inherited = networkEnvironment(validateNetworkSettings({ noProxy: ".custom.invalid", useSystemCa: false }), base);
  assert.equal(inherited.HTTP_PROXY, base.http_proxy);
  assert.equal(inherited.http_proxy, base.http_proxy);
  assert.equal(inherited.HTTPS_PROXY, base.Https_Proxy);
  assert.equal(inherited.https_proxy, base.Https_Proxy);
  assert.equal(inherited.NODE_EXTRA_CA_CERTS, base.NODE_EXTRA_CA_CERTS);
  assert.equal(inherited.NODE_USE_SYSTEM_CA, "0");
  for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", "legacy.invalid", "second.invalid", "npm-bypass.invalid", ".custom.invalid"]) assert.ok(inherited.NO_PROXY.split(",").includes(host));
  assert.equal(inherited.no_proxy, inherited.NO_PROXY);
  assert.equal(inherited.npm_config_noproxy, inherited.NO_PROXY);
  const manual = networkEnvironment(validateNetworkSettings({ mode: "manual", proxyUrl: "http://127.0.0.1:8080" }), base);
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "npm_config_proxy", "npm_config_https_proxy"]) assert.equal(manual[key], "http://127.0.0.1:8080/");
  assert.equal(manual.Https_Proxy, undefined);
  assert.equal(manual.NPM_CONFIG_PROXY, undefined);
  assert.equal(manual.NODE_EXTRA_CA_CERTS, undefined);
  assert.ok(!manual.NO_PROXY.includes("legacy.invalid"));
  const direct = networkEnvironment(validateNetworkSettings({ mode: "direct" }), base);
  assert.ok(Object.keys(direct).every((key) => !/^(?:https?_proxy|all_proxy|npm_config_(?:proxy|https_proxy))$/i.test(key)));
  assert.equal(direct.NO_PROXY, "*");
  for (const env of [inherited, manual, direct]) {
    assert.equal(env.NODE_USE_ENV_PROXY, "1");
    assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
    assert.equal(env.NPM_CONFIG_STRICT_SSL, undefined);
    assert.equal(env.npm_config_strict_ssl, "true");
    assert.equal(env.KEEP, "yes");
  }
  assert.deepEqual(base, original);
});

test("network CA settings accept PEM certificates and reject missing, relative and non-certificate files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-network-ca-"));
  const caFile = path.join(directory, "certificates.pem");
  try {
    await writeFile(caFile, rootCertificates.slice(0, 2).join("\n"));
    const settings = validateNetworkSettings({ caFile });
    const env = networkEnvironment(settings, {});
    assert.equal(env.NODE_EXTRA_CA_CERTS, caFile);
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", "import{getCACertificates}from'node:tls';console.log(getCACertificates('extra').length)"], { env: { ...process.env, ...env }, timeout: 10000 });
    assert.equal(stdout.trim(), "2");
    for (const filename of ["relative.pem", directory, path.join(directory, "missing.pem")]) assert.throws(() => validateNetworkSettings({ caFile: filename }), /CA file/);
    await writeFile(caFile, "-----BEGIN CERTIFICATE-----\nbroken\n-----END CERTIFICATE-----");
    assert.throws(() => validateNetworkSettings({ caFile }), /CA file/);
    await writeFile(caFile, `${rootCertificates[0]}\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----`);
    assert.throws(() => validateNetworkSettings({ caFile }), /CA file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("child fetch uses the configured authenticated proxy and bypasses loopback in every mode", async () => {
  const sockets = new Set<Socket>();
  const received: { method: string; url: string | undefined; authorization: string | undefined }[] = [];
  const proxy = createServer((request, response) => {
    received.push({ method: request.method!, url: request.url, authorization: request.headers["proxy-authorization"] });
    response.end("proxied");
  });
  proxy.on("connect", (request, socket) => {
    received.push({ method: "CONNECT", url: request.url, authorization: request.headers["proxy-authorization"] });
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied"));
  });
  const direct = createServer((_request, response) => response.end("direct"));
  const direct6 = createServer((_request, response) => response.end("direct-v6"));
  try {
    for (const server of [proxy, direct, direct6]) {
      server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, server === direct6 ? "::1" : "127.0.0.1", resolve); });
    }
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    const target = `http://127.0.0.1:${(direct.address() as { port: number }).port}`;
    const target6 = `http://[::1]:${(direct6.address() as { port: number }).port}`;
    const settings = validateNetworkSettings({ mode: "manual", proxyUrl, proxyUsername: "user@example", proxyPassword: "p:a/ss?#% 雪" });
    const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:NODE_|https?_proxy$|all_proxy$|no_proxy$|npm_config_)/i.test(key)));
    const run = async (env: NodeJS.ProcessEnv, urls: string[]) => {
      const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", "console.log(JSON.stringify(await Promise.all(JSON.parse(process.argv[1]).map(async url=>({url,text:await(await fetch(url,{signal:AbortSignal.timeout(5000)})).text()})))))", JSON.stringify(urls)], { env, timeout: 10000 });
      return JSON.parse(stdout) as { url: string; text: string }[];
    };
    const manual = await run(networkEnvironment(settings, { ...base, http_proxy: "http://127.0.0.1:1", NO_PROXY: "*" }), ["http://proxy-fixture.invalid", target, target.replace("127.0.0.1", "localhost"), target6]);
    assert.deepEqual(manual.map((entry) => entry.text), ["proxied", "direct", "direct", "direct-v6"]);
    assert.equal(received.length, 1);
    assert.equal(received[0]!.method, "CONNECT");
    assert.equal(received[0]!.url, "proxy-fixture.invalid:80");
    assert.equal(received[0]!.authorization, `Basic ${Buffer.from("user@example:p:a/ss?#% 雪").toString("base64")}`);
    assert.deepEqual((await run(networkEnvironment(validateNetworkSettings({ mode: "direct" }), { ...base, HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, ALL_PROXY: proxyUrl }), [target])).map((entry) => entry.text), ["direct"]);
    assert.equal(received.length, 1);
    assert.deepEqual((await run(networkEnvironment(validateNetworkSettings({}), { ...base, HTTP_PROXY: "http://127.0.0.1:1", http_proxy: proxyUrl }), ["http://inherited-proxy.invalid", target])).map((entry) => entry.text), ["proxied", "direct"]);
    assert.equal(received.length, 2);
    assert.equal(received[1]!.authorization, undefined);
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all([proxy, direct, direct6].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
});
