import { X509Certificate } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

export const defaultNetworkSettings = Object.freeze({
  mode: "environment",
  proxyUrl: "",
  proxyUsername: "",
  noProxy: "",
  useSystemCa: true,
  caFile: "",
});
const controls = /[\x00-\x1f\x7f]/;
const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"];
const proxyVariable = /^(?:https?_proxy|all_proxy|no_proxy|npm_config_(?:proxy|https_proxy|noproxy))$/i;

function bypassList(value) {
  if (!value) return [];
  if (controls.test(value)) throw new Error("Proxy bypass entries must be comma-separated hosts");
  const entries = value.split(",").map((entry) => entry.trim().toLowerCase());
  for (const entry of entries) {
    if (entry === "*" || (isIP(entry) && !entry.includes("%"))) continue;
    const match = entry.match(/^(\[[\da-f:]+\]|(?:\*\.)?\.?[a-z\d_-]+(?:\.[a-z\d_-]+)*\.?)(?::(\d{1,5}))?$/i);
    if (!match || (match[1].startsWith("[") && !isIP(match[1].slice(1, -1))) || (match[2] && (+match[2] < 1 || +match[2] > 65535)))
      throw new Error("Proxy bypass entries must be hosts, IP addresses or domain suffixes with an optional port");
  }
  return [...new Set(entries)];
}

export function validateCertificatePem(pem) {
  if (!pem || Buffer.byteLength(pem) > 2 * 1024 * 1024) throw new Error("CA certificate must be no larger than 2 MiB");
  const expression = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  const certificates = pem.match(expression);
  if (!certificates?.length || pem.replace(expression, "").replace(/^\s*#.*$/gm, "").trim()) throw new Error();
  for (const certificate of certificates) new X509Certificate(certificate);
}

export function validateNetworkSettings(input, previousPassword = "", validateCertificate = true) {
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    throw new Error("Network settings must be an object");
  const allowed = [...Object.keys(defaultNetworkSettings), "proxyPassword"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error("Network settings contain an unknown field");
  const settings = { ...defaultNetworkSettings, ...input, proxyPassword: input.proxyPassword === undefined ? previousPassword : input.proxyPassword };
  if (!["environment", "manual", "direct"].includes(settings.mode)) throw new Error("Invalid proxy mode");
  if (typeof settings.useSystemCa !== "boolean") throw new Error("System CA setting must be a boolean");
  for (const [key, maximum] of Object.entries({ proxyUrl: 2048, proxyUsername: 512, proxyPassword: 4096, noProxy: 4096, caFile: 4096 })) {
    if (typeof settings[key] !== "string" || settings[key].length > maximum || controls.test(settings[key]))
      throw new Error("Network fields must be bounded text without control characters");
  }
  if (settings.proxyUsername.includes(":")) throw new Error("Proxy username cannot contain a colon");
  if (settings.proxyUrl) {
    try {
      const url = new URL(settings.proxyUrl);
      if (!/^https?:\/\/[^\s/?#\\@]+\/?$/i.test(settings.proxyUrl) || !["http:", "https:"].includes(url.protocol) || !url.hostname || url.port === "0" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
        throw new Error();
      settings.proxyUrl = url.origin;
    } catch { throw new Error("Proxy URL must be an HTTP(S) server address without credentials, path, query or fragment"); }
  }
  if (settings.mode === "manual" && !settings.proxyUrl) throw new Error("Manual proxy mode requires a proxy URL");
  settings.noProxy = bypassList(settings.noProxy).join(",");
  if (settings.caFile && validateCertificate) {
    try {
      if (!path.isAbsolute(settings.caFile)) throw new Error();
      const info = statSync(settings.caFile);
      if (!info.isFile() || !info.size || info.size > 2 * 1024 * 1024) throw new Error();
      const pem = readFileSync(settings.caFile, "utf8");
      validateCertificatePem(pem);
    } catch { throw new Error("CA file must be an existing absolute PEM certificate file no larger than 2 MiB"); }
  }
  return settings;
}

export function proxyAddress(settings) {
  if (!settings.proxyUrl) return "";
  try {
    const url = new URL(settings.proxyUrl);
    url.username = encodeURIComponent(settings.proxyUsername);
    url.password = encodeURIComponent(settings.proxyPassword ?? "");
    return url.href;
  } catch { throw new Error("Proxy address or credentials are invalid"); }
}

export function networkEnvironment(settings, baseEnv = process.env) {
  const env = { ...baseEnv };
  const inheritedBypass = Object.entries(baseEnv)
    .filter(([key]) => /^(?:no_proxy|npm_config_noproxy)$/i.test(key))
    .flatMap(([, value]) => String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
  if (settings.mode === "environment") {
    // Windows collapses case-insensitive names at spawn; resolve precedence before that happens.
    for (const key of ["http_proxy", "https_proxy", "all_proxy", "npm_config_proxy", "npm_config_https_proxy"]) {
      const names = Object.keys(env).filter((name) => name.toLowerCase() === key);
      const value = env[key] ?? env[key.toUpperCase()] ?? (names.length ? env[names[0]] : undefined);
      for (const name of names) delete env[name];
      if (value !== undefined) env[key] = env[key.toUpperCase()] = value;
    }
  }
  if (settings.mode !== "environment") {
    for (const key of Object.keys(env)) if (proxyVariable.test(key)) delete env[key];
    if (settings.mode === "manual") {
      const address = proxyAddress(settings);
      for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "npm_config_proxy", "npm_config_https_proxy"]) env[key] = address;
    }
  }
  const bypass = settings.mode === "direct" ? "*" : [...new Set([...loopback, ...(settings.mode === "environment" ? inheritedBypass : []), ...bypassList(settings.noProxy)])].join(",");
  for (const key of Object.keys(env)) if (/^(?:no_proxy|npm_config_noproxy)$/i.test(key)) delete env[key];
  env.NO_PROXY = env.no_proxy = env.npm_config_noproxy = bypass;
  for (const key of Object.keys(env)) if (/^(?:NODE_USE_ENV_PROXY|NODE_USE_SYSTEM_CA|NODE_TLS_REJECT_UNAUTHORIZED|npm_config_strict_ssl)$/i.test(key)) delete env[key];
  env.NODE_USE_ENV_PROXY = "1";
  env.NODE_USE_SYSTEM_CA = settings.useSystemCa ? "1" : "0";
  env.npm_config_strict_ssl = "true";
  if (settings.caFile || settings.mode !== "environment") {
    for (const key of Object.keys(env)) if (key.toUpperCase() === "NODE_EXTRA_CA_CERTS") delete env[key];
    if (settings.caFile) env.NODE_EXTRA_CA_CERTS = settings.caFile;
  }
  return env;
}
