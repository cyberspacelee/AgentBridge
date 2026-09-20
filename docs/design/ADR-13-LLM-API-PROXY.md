# ADR-13：统一 LLM API 代理与协议转换

- 状态：已接受，已实现（QA 通过）
- 日期：2026-09-18
- 范围：五个 Agent engine 使用的模型连接、代理路由、协议转换、请求统计与配置页面
- 版本约束：`settings.schemaVersion`、数据库版本和现有应用版本均保持不变

## 背景

目前 provider 配置同时承担模型地址、密钥和协议，四个 engine 再把这些字段翻译成各自的原生配置。这样会产生三个问题：密钥进入多个原生配置目录；不同 engine 对 Responses 和 Chat Completions 的支持不一致；请求级 token、延迟、错误和上游路由无法集中统计。

开源实现提供了可复用的边界：Cherry Studio 将 provider 身份、endpoint 类型和 adapter family 分开，并在读取时合并用户覆盖；CC Switch 采用本地代理、路由检测、协议转换和审计日志链路；CLIProxyAPI 将兼容代理与独立 usage collector 分开；CCRelay 支持按路径路由和可选的请求日志；LiteLLM 明确提供 Responses 到 Chat Completions 的转换开关。这些实现也说明跨协议流式转换、工具调用、reasoning、`previous_response_id` 和 usage 是高风险边界，不能依靠字段猜测或静默丢弃。

参考：[Cherry Studio provider registry](https://github.com/CherryHQ/cherry-studio/blob/main/docs/references/provider-model/provider-registry.md)、[Cherry Studio provider resolution](https://github.com/CherryHQ/cherry-studio/blob/main/docs/references/ai/provider-resolution.md)、[CC Switch proxy](https://cc-switch.cc/en/tutorials/proxy-service)、[CC Switch usage](https://cc-switch.cc/en/tutorials/usage-statistics)、[CLIProxyAPI](https://github.com/lihao0811/CLIProxyAPI/blob/main/README.md)、[CCRelay](https://github.com/inflaborg/ccrelay)、[LiteLLM Responses bridge](https://github.com/BerriAI/litellm-docs/blob/main/docs/response_api.md)。

## 决策

在 AgentBridge 内置一个受网关生命周期管理的 LLM proxy。它与应用 API 同进程运行，默认只监听 loopback；Agent engine 只获得代理地址和短期运行令牌，上游 `baseUrl` 与 `apiKey` 只由 proxy 使用。

proxy 采用显式路由，不根据响应内容自动猜协议：

```text
Agent engine
  -> client protocol (/v1/responses 或 /v1/chat/completions)
  -> LLM proxy route(providerID, modelID)
  -> optional request headers/params
  -> upstream protocol
  -> upstream provider
```

每个已应用 provider 暴露一个临时 route base URL，例如 `http://127.0.0.1:<port>/llm/<providerID>/v1`；engine 仍按自己的 client protocol 请求 `/chat/completions` 或 `/responses`。请求带网关生成的运行令牌，proxy 校验后移除该令牌，再注入 provider 的上游认证。

provider 配置增加可选字段，旧配置按默认值解释：

```json
{
  "id": "openai-main",
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "secret",
  "api": "openai-responses",
  "upstreamApi": "openai-responses",
  "conversion": "none",
  "request": {
    "headers": { "X-Provider-Route": "default" },
    "params": { "reasoning_effort": "medium" }
  },
  "models": [{ "id": "gpt-example", "name": "Example" }],
  "enabled": true
}
```

- `api` 是 client-facing protocol，生成给 engine 的配置只使用它。
- `upstreamApi` 是上游协议，缺省为 `api`。
- `conversion` 只允许 `none` 或 `responses-to-completions`，缺省为 `none`。Agent 选择 Responses 且上游为 Chat Completions 时，代理按请求协议自动执行 Responses → Chat 转换；显式配置仍兼容旧设置。
- Chat Completions 请求继续直连上游，因此同一连接可供 Responses Agent 和 Chat Agent 复用。
- `request.headers` 和 `request.params` 在 proxy 请求边界合并；禁止覆盖路由、认证、`content-length` 等受保护字段，并限制键名、值大小和 JSON 深度。
- 路由、认证、`model`、消息/input、`stream` 和协议版本由 proxy/协议转换器控制；其余允许字段按“客户端请求值 → provider 配置覆盖值”合并，配置不能覆盖 `stream` 和正文必需字段。
- `apiKey`、敏感 header 和敏感参数在 API、日志、事件和页面回显中脱敏；页面只显示是否已配置。

旧 provider 没有新增字段时解释为 `upstreamApi = api`、`conversion = none`、空 `request`，因此无需迁移，也不改变当前 `schemaVersion: 1`。

## 协议转换规则

首期只实现 `Responses -> Chat Completions -> Responses`。请求映射包括 `input/instructions` 到 messages、`tools` 到 function tools、`text.format` 到 `response_format`、`max_output_tokens` 到 `max_tokens`；响应映射保留文本、tool call id/arguments、finish reason 和 usage。流式响应按事件状态机转换，不能把一段上游 SSE 原样转发成另一种协议。

以下情况必须返回 `PROTOCOL_CONVERSION_UNSUPPORTED` 并说明字段：computer/web search 等上游特有能力、无法安全表达的多模态输入、未知工具事件和不完整的状态依赖。禁止静默删除字段，禁止把 `stream` 默认改成 buffered response。

`previous_response_id` 只通过有界的进程内 response history cache 支持：合成 ID、TTL、最大条数和最大字节数均有限；重启后旧 ID 明确失败，不写入主 SQLite schema。无法保证上下文完整时返回可定位错误。

实现参考：[completion-to-response](https://github.com/NoahStepheno/completion-to-response)（请求、响应、SSE、function calling）、[Codex ResponsesToCompletions](https://github.com/virtualman333/Codex-ResponsesToCompletions) 和 [responses-proxy](https://docs.rs/crate/responses-proxy/latest)（reasoning、tool roundtrip、`previous_response_id`）。

## 配置、应用与页面

共享 schema 仍是唯一配置契约。`settings.ts` 集中解析 effective route，并负责：

1. provider 读取时填充默认值，保存时恢复脱敏密钥和敏感 request 字段；diagnostic secrets 包含这些字段。
2. 原生 engine 配置写入 proxy URL、运行令牌和 client-facing `api`，不再写真实上游地址和密钥。
3. provider 导入设置 `upstreamApi = api`、`conversion = none`；agent 配置 revision 自动覆盖新增字段。
4. `/api/providers/:id/test` 测试保存后的 effective route，覆盖 pass-through 和已配置转换；错误脱敏。

proxy 必须在 engine adapter 启动前 ready；配置保存沿用现有 revision/apply 生命周期，engine apply 后使用对应的代理地址和 client protocol。代理每次请求读取已保存的 provider 路由，保存后的新请求立即使用新配置，运行中的原生进程仍由现有 apply 机制控制。

代理监听地址和端口属于 system.json 的系统级配置，与网关监听配置分开保存，默认使用独立的 loopback 随机端口；修改后通过服务重启应用，网关端口无需跟随变化。Provider 的请求头、参数、密钥和上游地址不重启代理，保存后下一次请求直接读取新值。

共享资源页的 provider editor 增加“协议与代理”折叠区：client protocol、upstream protocol、conversion、headers/params 编辑器、转换能力提示、连接测试、effective route 和保存/应用状态。系统设置只展示 proxy 运行状态，不复制 provider 编辑入口。

## 统计与观测

Run 的 `usage` 仍以 engine 能可靠报告的用量为准；proxy 记录每个 LLM request 的 route、client/upstream protocol、conversion、model、status、latency、TTFT（可观测时）、stream、input/output/cache tokens、cost source 和 error category。缺失值为 `null` 或 `unavailable`，不能猜测为 0。

首期复用既有有界 `events` 记录 `llm.request.finished`，并可追加有界 JSONL sidecar 供较长窗口查询；不新增主 SQLite 表或改变 schema fingerprint。metrics 使用低基数标签：provider、route、protocol、conversion、outcome；不使用 requestId、runId、prompt 或原始错误作为标签。若无法可靠关联 Run，proxy 不伪造 run 归属。

## 安全与故障处理

- proxy 只接受 loopback 或受配置限制的本机来源，engine 令牌短期、随机且不持久化到 settings。
- upstream URL、header、参数和模型名做 allowlist/大小限制；禁止 SSRF 到本机管理端点，禁止 header 注入。
- 超时、取消、上游 4xx/5xx、SSE 解析错误和转换错误都映射为稳定错误类别；响应不回显 API key 或完整 prompt。
- 原生 provider 直连只保留在未启用 proxy 的开发/诊断路径，正式 engine apply 一律走 proxy。

## 取舍与后续边界

选择同进程 loopback proxy 是最小可部署单元，避免新增守护进程、认证服务和第二套配置源。它牺牲了独立扩缩容和跨实例共享缓存，但符合当前单可信环境边界。首期不做动态协议推断、任意 OpenAI 兼容协议、持久化 `previous_response_id`、账单级成本结算和多租户密钥隔离；这些能力只有在真实 provider 样本和指标证明需要时再另立 ADR。

## 实施验收清单

- [x] shared provider schema、脱敏、导入和乐观并发保持 version 1。
- [x] proxy lifecycle、loopback token、已保存路由、timeout 和 graceful shutdown。
- [x] pass-through Chat/Responses、Responses-to-Chat JSON/SSE、tool call、reasoning、usage 和错误映射。
- [x] unsupported 字段拒绝、`previous_response_id` 有界缓存、重启失效测试。
- [x] 四个 engine 只收到 proxy endpoint/client protocol；apply 失败不影响其他 Agent。
- [x] 页面可编辑 headers/params/conversion，测试 effective route，显示 proxy 状态。
- [x] `llm.request.finished`、Prometheus metrics、观测查询和敏感信息脱敏。
- [x] 本地兼容 provider、慢 SSE、错误响应、浏览器回归和网关集成验收；Windows/真实供应商仍需部署环境验收。
