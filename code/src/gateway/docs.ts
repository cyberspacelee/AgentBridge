import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import type { systemRoutes } from "./system.js";
import { openapi, sessionGuide } from "./openapi.js";
import { apiMarkdown } from "./api-markdown.js";

const require = createRequire(import.meta.url);
const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentBridge API 文档</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/api/docs/swagger-ui.css">
  <style>
    body { margin: 0; background: #fafafa; }
    :focus-visible { outline: 3px solid #1259a7; outline-offset: 3px; }
    .swagger-ui .info { margin: 24px 0; }
    .swagger-ui .opblock-summary-path { overflow-wrap: anywhere; }
    .swagger-ui .opblock-body { overflow-x: auto; }
    @media (max-width: 600px) {
      .swagger-ui .opblock .opblock-summary { flex-wrap: wrap; gap: 4px; }
      .swagger-ui .opblock .opblock-summary-description { flex-basis: 100%; }
      .swagger-ui .opblock .opblock-summary-path { max-width: calc(100% - 110px); }
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
  </style>
  <script src="/api/docs/swagger-ui-bundle.js" defer></script>
  <script src="/api/docs/init.js" defer></script>
</head>
<body><main id="swagger-ui" aria-label="API 文档"></main><noscript>请启用 JavaScript 阅读文档，或下载 <a href="/api/openapi.json">OpenAPI JSON</a>。</noscript></body>
</html>`;
const initializer = `SwaggerUIBundle({
  url: "/api/openapi.json",
  dom_id: "#swagger-ui",
  deepLinking: true,
  filter: true,
  docExpansion: "list",
  defaultModelRendering: "model",
  defaultModelExpandDepth: 3,
  defaultModelsExpandDepth: -1,
  displayRequestDuration: true,
  supportedSubmitMethods: [],
  validatorUrl: null,
  persistAuthorization: false,
  queryConfigEnabled: false
});`;

export function documentationRoutes(server: Parameters<typeof systemRoutes>[0]) {
  server.get("/api/docs", async (_request, reply) => reply.type("text/html; charset=utf-8").send(html));
  server.get("/api/openapi.json", async () => openapi);
  server.get("/api/docs.md", async (_request, reply) => reply.type("text/markdown; charset=utf-8").send(apiMarkdown()));
  server.get("/api/examples/session.md", async (_request, reply) => reply.type("text/plain; charset=utf-8").send(sessionGuide));
  server.get("/api/docs/init.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(initializer));
  for (const [filename, type] of [["swagger-ui.css", "text/css"], ["swagger-ui-bundle.js", "application/javascript"]]) {
    const location = require.resolve(`swagger-ui-dist/${filename}`);
    server.get(`/api/docs/${filename}`, async (_request, reply) => reply.type(`${type}; charset=utf-8`).send(await readFile(location)));
  }
}
