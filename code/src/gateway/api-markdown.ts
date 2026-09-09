import { openapi } from "./openapi.js";

// Render the same contract as Swagger UI; keep Markdown useful without JavaScript.
type Schema = Record<string, any>;
const cell = (value: unknown) => String(value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
const type = (schema: Schema): string => {
  if (schema.$ref) return schema.$ref.split("/").at(-1);
  if (schema.oneOf || schema.anyOf) return (schema.oneOf ?? schema.anyOf).map(type).join(" | ");
  if (schema.type === "array") return `Array<${type(schema.items)}>`;
  if (schema.type === "object" && typeof schema.additionalProperties === "object") return `Record<string, ${type(schema.additionalProperties)}>`;
  return schema.type ?? "任意 JSON";
};
const constraints = (schema: Schema): string => [
  ...Object.entries(schema)
    .filter(([key]) => ["const", "enum", "default", "format", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "additionalProperties", "propertyNames"].includes(key))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`),
  ...(schema.oneOf ?? schema.anyOf ?? []).map(constraints),
  ...(schema.type === "array" && schema.items?.type !== "object" && constraints(schema.items) ? [`数组元素：${constraints(schema.items)}`] : []),
].filter(Boolean).join("；");
const code = (value: unknown, language = "json") => `\n\n\`\`\`${language}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n\`\`\`\n`;
function fields(schema: Schema, prefix = ""): string[] {
  if (schema.oneOf || schema.anyOf) return (schema.oneOf ?? schema.anyOf).flatMap((variant: Schema, index: number) => fields(variant, `${prefix}分支${index + 1}.`));
  if (schema.type === "array") return fields(schema.items, prefix || "[].");
  return Object.entries(schema.properties ?? {}).flatMap(([name, raw]) => {
    const field = raw as Schema;
    const path = `${prefix}${name}`;
    return [
      `| ${cell(path)} | ${cell(type(field))} | ${schema.required?.includes(name) ? "是" : "否"} | ${cell(constraints(field))} | ${cell(field.description)} |`,
      ...fields(field, `${path}${field.type === "array" ? "[]" : ""}.`),
    ];
  });
}
function schemaTable(schema: Schema): string {
  const rows = fields(schema);
  return rows.length ? `\n\n| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n` : "";
}
export function apiMarkdown(): string {
  const output = [
    `# ${openapi.info.title} — API Reference\n\n版本：${openapi.info.version} · OpenAPI ${openapi.openapi}`,
    openapi.info.description,
    "获取地址：`GET /api/docs.md`（本文）、`GET /api/openapi.json`（机器定义）、`GET /api/docs`（网页）、`GET /api/examples/session.md`（完整会话示例）。",
    "Base URL 示例：`http://127.0.0.1:6217`；以下路径相对此地址。无参数的操作明确标注“无”，不要构造额外请求体。请求表的“必填”针对所在对象；父对象可选不代表其内部必填字段可省略。响应表的“必返”表示字段存在，null 表示值可能为空。命名类型在文末数据模型中展开。",
    "## 接口索引\n\n| 方法 | 路径 | 用途 |\n| --- | --- | --- |",
  ];
  for (const [url, methods] of Object.entries(openapi.paths)) for (const [method, raw] of Object.entries(methods)) {
    const operation = raw as Schema;
    output.push(`| ${method.toUpperCase()} | ${url} | [${operation.summary}](#${operation.operationId.toLowerCase()}) |`);
  }
  for (const tag of openapi.tags) {
    output.push(`\n## ${tag.name}`);
    for (const [url, methods] of Object.entries(openapi.paths)) for (const [method, raw] of Object.entries(methods)) {
      const operation = raw as Schema;
      if (!operation.tags.includes(tag.name)) continue;
      output.push(`\n### ${operation.operationId.toLowerCase()}\n\n**${method.toUpperCase()} ${url} — ${operation.summary}**\n\n${operation.description.replace(/^(#{1,3}) /gm, "###$1 ")}`);
      const parameters = operation.parameters as Schema[];
      output.push(parameters.length ? "\n| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |\n| --- | --- | --- | --- | --- | --- |" : "\n路径/查询/额外请求头参数：无。");
      for (const parameter of parameters) output.push(`| ${parameter.name} | ${parameter.in} | ${cell(type(parameter.schema))} | ${parameter.required ? "是" : "否"} | ${cell(constraints(parameter.schema))} | ${cell(parameter.description)} |`);
      if (!operation.requestBody) output.push("\n请求体：无。");
      else for (const [media, rawBody] of Object.entries(operation.requestBody.content)) {
        const body = rawBody as Schema;
        output.push(`\n请求体：${operation.requestBody.required ? "必填" : "可选"}，Content-Type: ${media}；类型：${type(body.schema)}。`);
        const resolved = body.schema.$ref ? openapi.components.schemas[type(body.schema)]! : body.schema;
        if (resolved.description) output.push(resolved.description);
        output.push(schemaTable(resolved));
        if (body.example !== undefined) output.push("请求示例：", code(body.example));
      }
      output.push("\n| HTTP 状态码 | Content-Type | 响应类型 | 说明 |\n| --- | --- | --- | --- |");
      for (const [status, rawResponse] of Object.entries(operation.responses)) {
        const response = rawResponse as Schema;
        if (!response.content) output.push(`| ${status} | — | 无响应体 | ${cell(response.description)} |`);
        for (const [media, rawBody] of Object.entries(response.content ?? {})) {
          const body = rawBody as Schema;
          output.push(`| ${status} | ${media} | ${cell(type(body.schema))} | ${cell(response.description)} |`);
        }
      }
      for (const [status, rawResponse] of Object.entries(operation.responses)) {
        if (!status.startsWith("2")) continue;
        for (const rawBody of Object.values((rawResponse as Schema).content ?? {})) {
          const body = rawBody as Schema;
          output.push(schemaTable(body.schema));
          if (body.example !== undefined) output.push(`${status} 响应示例：`, code(body.example, typeof body.example === "string" ? "text" : "json"));
        }
      }
    }
  }
  output.push("\n## 数据模型\n\n必返/必填针对当前对象。oneOf/anyOf 表示分支；Array<T> 为 T 数组；任意 JSON 仅用于原生工具输入等不固定结构。错误响应统一为 Error，code 的示例不穷尽所有业务错误码。");
  for (const [name, schema] of Object.entries(openapi.components.schemas)) {
    output.push(`\n### ${name}\n\n${schema.description ?? ""}`, schemaTable(schema));
    if (schema.oneOf || schema.anyOf) output.push(`分支类型：${type(schema)}。`);
  }
  return `${output.join("\n").trim()}\n`;
}
