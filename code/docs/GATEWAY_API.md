# AgentBridge 网关 API

Web 与 Desktop 使用同一个 Fastify 网关；桌面安装包自带 Node.js 和 server，无需另外安装服务。HTTP、SSE、Web 页面和文件下载均无需配对码、Cookie 或 Authorization。模型供应商和 MCP 自身需要的 API Key 仍在资源配置中填写。

## 启动与地址

- Desktop：启动应用，在“系统信息 → 网关服务”设置监听地址与端口，保存后点击“重启网关”。默认 `127.0.0.1:3000`；`0.0.0.0` 监听全部 IPv4 网卡，供局域网访问；也支持本机指定 IPv4/IPv6 和 localhost。端口范围 0–65535，0 自动分配；自动化建议固定端口。
- Web：在源码 code 目录运行 `pnpm start --host 0.0.0.0 --port 3000`（此前执行 `pnpm build && pnpm web:build`）。
- 局域网客户端使用 `http://<网关主机 IP>:<端口>`，主机防火墙应允许对应 TCP 端口。工作目录必须存在于网关主机上。
- 配置保存在业务数据目录的 `system.json` 的 `gateway: {host, port}` 中；`appliedGateway` 是已生效配置。Desktop 业务数据目录为 Electron 用户数据根目录的 `data/`，可由 `AGENT_DESKTOP_DATA_DIR` 指定根目录。
- 启动时优先级为 Web CLI `--host/--port` > `AGENT_HOST/AGENT_PORT` > 已保存配置 > 默认值。启动参数作为本次初始配置，运行期间可以通过页面/API 修改。保留环境覆盖会在下次启动时再次覆盖文件值。
- 保存不立即断开连接。重启可以等待任务完成或停止任务；同时应用已保存的网络代理配置。更换地址/端口后 desktop 自动重连；Web 用页面提供的新地址打开。端口占用或绑定失败时，服务内重启恢复此前监听配置，错误可从网关配置接口读取。若首次启动默认端口已被占用，可设置 `AGENT_PORT` 后启动安装程序，或退出应用后修改 `system.json` 的 gateway。
- 托盘可用时关闭桌面窗口，网关继续运行；显式退出应用会停止网关。独立运行 server 使用 Web 启动入口。

下文路径相对于 Base URL，例如 `http://127.0.0.1:3000`。在线文档为 `GET /api/docs`，示例脚本为 `GET /api/examples/evaluate.mjs`；两者随安装包离线分发。

## 通用约定

请求体使用 JSON 和 `Content-Type: application/json`，默认上限 1 MiB。成功响应通常为 JSON；无内容为 204；SSE 和文件下载另见下文。错误格式为 `{"code":"VALIDATION_ERROR","message":"..."}`，响应头 `X-Request-ID` 可用于日志定位。

| 状态码 | 含义 |
| --- | --- |
| 200 / 202 / 204 | 查询或操作成功 / 已受理异步操作 / 完成且无内容 |
| 400 | JSON、字段、工作目录或请求参数无效 |
| 403 | 请求来源或主机头不符合监听规则、路径/模型等操作限制；不表示需要网关登录 |
| 404 | 资源不存在 |
| 409 | 修订冲突、操作冲突、取消或系统配置操作失败 |
| 413 / 415 | 请求体过大 / 不支持的内容类型 |
| 429 / 503 | 限流、队列/连接上限或服务维护/不可用 |
| 502 / 504 | 引擎执行失败 / 超时 |

浏览器通过网关提供的同源页面访问；开发前端允许 `AGENT_WEB_ORIGIN`（默认 `http://127.0.0.1:5173`）。无鉴权不改变浏览器同源规则；普通 curl、Python、Node 客户端无需发送 Origin。绑定回环地址时 Host 必须是回环地址。目录约束、输入校验、资源限制和 Electron 沙箱仍生效。

## 发现与系统配置

| 方法与路径 | 请求 / 响应 |
| --- | --- |
| `GET /health/live` | `{ok, instanceId}`；网关进程与 HTTP 可用 |
| `GET /health/ready` | `{ok, engine}`；默认引擎健康；至少一个 Agent 就绪且存储健康时200，否则503 |
| `GET /api/runtime` | instanceId、storeId、engines、limits、capabilities；先核对目标引擎健康和能力 |
| `GET /api/system` | 版本、Node/npm 路径、maintenance、capabilities；gateway/network/restart 表示有共用启动管理器 |
| `GET /api/system/gateway` | `{settings, appliedSettings, revision, appliedRevision, restartRequired, url, urls, error}`；settings/appliedSettings 为 `{host,port}`；url 是本机连接地址，urls 包含当前可用网卡地址 |
| `PUT /api/system/gateway` | `{revision, settings:{host,port}}`，返回新的配置视图；revision 使用上一 GET 返回值 |
| `GET /api/system/network` | `{settings,hasPassword,revision,appliedRevision,restartRequired,protection,error}` |
| `PUT /api/system/network` | `{revision,settings}`；网络 settings 包含 npmRegistry、mode(environment/direct/manual)、proxyUrl、proxyUsername、noProxy、useSystemCa、caFile 和可选 proxyPassword；密码省略保留，空字符串清除 |
| `POST /api/system/network/test` | `{settings,url}`，用当前草稿测试连接，返回 `{status,durationMs,scope:"gateway"}` |
| `POST /api/system/lifecycle` | `{action:"restart"或"shutdown",mode:"wait"或"stop"}`，202 `{accepted:true}`；请求断线前受理，之后应等待新服务健康 |
| `GET /api/system/directories?directory=...` | 浏览主机目录；省略 directory 列出允许的根目录；返回 `{directory,parent,entries:[{name,path}],truncated}` |
| `POST /api/system/certificates` | `{pem}`，最多 2 MiB PEM CA 证书；返回 `{path}` |

端口配置例子（revision 替换为 GET 结果）：

```sh
curl http://127.0.0.1:3000/api/system/gateway
curl -X PUT http://127.0.0.1:3000/api/system/gateway \
  -H 'Content-Type: application/json' \
  -d '{"revision":"<revision>","settings":{"host":"0.0.0.0","port":3100}}'
curl -X POST http://127.0.0.1:3000/api/system/lifecycle \
  -H 'Content-Type: application/json' -d '{"action":"restart","mode":"wait"}'
curl http://127.0.0.1:3100/health/live
```

## Agent 与资源准备

首次启动无模型和 CLI 时不能执行评测；先配置资源、安装 CLI、启用目标 Agent，等待健康状态 ready。Agent ID 为 `pi`、`opencode`、`codex`、`grok`。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/settings` | 读取 `{settings,revision,...}`，模型/代理等密钥不回显 |
| `PUT /api/settings` | 提交 `{settings,revision}`；完整资源与 Agent 配置，revision 必须匹配 |
| `GET /api/agents` | `{agents:[...]}`，含启用、健康、活动任务、配置应用状态 |
| `POST /api/agents/:id/actions` | `{action:"enable"或"disable"或"stop"或"apply"}`，202 后轮询 Agent 状态 |
| `GET /api/engines/:id/models` | 目标 Agent 可用模型；任务 model 使用 `{providerID,modelID}` |
| `POST /api/providers/:id/test` | `{modelID}`，测试已保存供应商模型连接 |
| `POST /api/agents/:id/import` | `{file}`，只预览原生配置中的受支持资源 |
| `GET /api/runtimes` | `{runtimes:[...]}`，安装版本、来源、操作进度和错误 |
| `POST /api/runtimes/:id/actions` | `{action:"check"或"detect"或"install"或"update"或"uninstall"或"cancel"}`，202 后轮询 runtimes |
| `PUT /api/runtimes/:id/source` | `{mode:"managed"}` 或 `{mode:"external",command:"..."}`，202 后轮询 |

`disable/apply` 等待活动执行；`stop` 强停。CLI 安装完成不会自动启用 Agent。系统历史数据可由 `storeId` 标识，`instanceId` 在网关进程重启后改变。

## 推荐自动评测：提交后按 Run 轮询

```sh
curl -X POST http://127.0.0.1:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"submissionId":"case-001-attempt-1","engineId":"pi","directory":"/absolute/workspace","title":"评测 case-001","parts":[{"type":"text","text":"只回复 OK"}],"interactionPolicy":{"permission":"auto","question":"auto"}}'
```

202 返回 `{"submissionId":"...","taskId":"...","sessionId":"...","runId":"...","acceptedAt":"..."}`。`taskId` 与 `sessionId` 指向同一会话。

- `directory` 必填，为网关主机上的已存在绝对路径（Windows 例如 `C:\\work\\case-001`）。`engineId` 可省略使用默认 Agent；title 可选，最多 200 字符。
- `parts` 必填，1–16 个 `{type:"text",text:"..."}`，总文本不超过 128 KiB，不能全空白；可选 `model:{providerID,modelID}`，须属于所选 Agent。
- `submissionId` 必填，1–128 个字母、数字、下划线或短横线。同一操作/目标以相同 ID 和相同请求重试返回原结果，不重复执行；同 ID 不同输入冲突。每次新评测使用新 ID。提交结果不明时查询 `GET /api/submissions/:id?operation=create`；追加用 `operation=append&sessionId=...`，根据 status/result/error 对账，不盲目换 ID 重发。
- 轮询 `GET /api/runs/:runId`，响应 `{snapshot,detail:{run,messages}}`。run.state 为 queued/running/stopping 或终态 completed/failed/timed_out/cancelled。只把 completed 算成功。run 还包含 error、usage、时间戳、traceId、configRevision 和 runtimeVersion。
- 多轮任务使用 `POST /api/tasks/:sessionId/runs`，体为 `{submissionId,parts,model?}`，返回同样的 202；同会话串行，不重放旧执行。
- `GET /api/tasks/:id` 返回 `{snapshot,detail:{task,runs,messages,interactions,artifacts}}`。messages 中有 role、runId、parts；text part 的 text 是文本，tool part 包含 name/input/output/state，step-finish 包含 usage。usage 缺失字段为 null，不能当作零消耗。
- `GET /api/tasks`、`GET /api/tasks/:id/runs`、`GET /api/runs/:id/messages` 为分页 `{snapshot,items,nextCursor}`，通用参数 `limit=1..100`（默认20）、cursor；任务列表支持 q/status。cursor 应原样使用并保持筛选不变，409 时重查首页。

安装包自带的 Node 标准库评测脚本（无需第三方依赖）：

```sh
curl http://127.0.0.1:3000/api/examples/evaluate.mjs -o evaluate.mjs
node evaluate.mjs --url http://127.0.0.1:3000 --engine pi \
  --directory /absolute/workspace --prompt '只回复 OK' > result.json
```

源码脚本为 `code/tools/evaluate.mjs`。Node >=22.21；也可用安装包 resources/node 下的 Node 执行。stdout 只输出 JSON（run、messages、artifacts、各 ID），stderr 输出 submissionId/sessionId/runId 便于中断后对账。completed 退出码 0，其余终态、HTTP 错误及客户端超时为非 0。`--timeout` 默认 660000 毫秒。脚本超时不自动取消服务端任务，可用下文 abort；历史与产物保留供核对。脚本使用 auto 交互策略，验证人工审批时改用下文接口。

## 兼容评测协议

| 方法与路径 | 请求 / 响应 |
| --- | --- |
| `POST /session` | `{directory,engineId?,title?,interactionPolicy?}` → 200 `{id,title,created_at,status:"idle"}`，仅创建会话 |
| `GET /session/:id` | `{id,title,directory,created_at,status,message_count}`；status 为 busy 或 idle |
| `GET /session/status` | `{[sessionId]:{type:"busy"或"idle"}}`；idle 不能判断执行是否成功 |
| `POST /session/:id/prompt_async` | `{parts,model?}`；虽然名为 async，HTTP 会等待执行终态，成功204，失败502，超时504，取消409；不支持 submissionId 幂等 |
| `GET /session/:id/message` | 评测协议消息数组，每条 `{info,parts}`；info 含 id/sessionID/role/time；parts 含文本、工具调用和用量映射 |
| `POST /session/:id/abort` 或 `/stop` | 无请求体，取消该会话执行，200 `{ok:true}` |
| `DELETE /session/:id` | 删除会话，200 `{ok:true}`；评测结果采集完成后按需调用 |

`prompt_async` 应设置大于运行超时（默认600秒）的 HTTP 超时。人工交互模式下，在另一连接处理 permission/question，不能只等待 prompt 响应。

## SSE 与人工交互

```sh
curl -N 'http://127.0.0.1:3000/event?sessionId=<sessionId>'
curl -N 'http://127.0.0.1:3000/api/events?sessionId=<sessionId>'
```

`/event` 为兼容评测流，每帧 `data: {type,properties}`，没有 SSE event 行；`/api/events` 是应用流，帧含 `event: <type>` 和 `data: <AppEvent>`。AppEvent 包含 schemaVersion、eventId、revision、instanceId、occurredAt、type、可选 sessionId/runId、data。连接即收到 server.connected；每15秒 server.heartbeat；事件可见 session.created/updated/deleted、message.part.updated、run.updated/finished、permission.asked、question.asked、interaction.updated、artifact.updated、agents.updated（兼容流只映射其支持的事件）。

记录 SSE `id:`，断线后以 `Last-Event-ID` 请求头回放；没有游标从当前开始。收到 server.resync_required 时重新 GET 会话/Run 快照，不能假定保留窗口内所有事件仍可获取。SSE 连接数和慢消费者缓冲有上限。

| 方法与路径 | 请求 / 响应 |
| --- | --- |
| `GET /permission`、`GET /question` | 待处理交互数组，含 id/sessionId/runId/kind/title/questions/state |
| `POST /permission/:id/reply` | `{decision:"once"或"always"或"reject"}` → `{ok:true}` |
| `POST /question/:id/reply` | `{answers:[["第一题回答"],["第二题回答"]]}` → `{ok:true}` |

创建会话的 interactionPolicy 可设 `{permission:"manual",question:"manual"}`；自动评测通常使用 auto，但 auto 不代表某个原生 CLI 不支持的能力会自动出现。

## 产物与观测

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/artifacts/:id` | 产物元数据和当前可用状态 |
| `GET /api/artifacts/:id/content` | 流式下载，支持 Range；`?disposition=inline` 请求支持格式的预览；通过任务 detail 获取产物 ID |
| `GET /api/observability/overview` | 运行、用量、错误汇总 |
| `GET /api/observability/series` | 时序统计，参数 metric（rssBytes/heapBytes/activeRuns/queueDepth/completed/failed） |
| `GET /api/observability/errors` | 错误记录，支持 limit（1–100）、stage、code |
| `GET /api/observability/runs/:id` | 指定 Run 诊断 |
| `GET /metrics` | Prometheus 文本指标 |

overview/series/errors 的时间参数 from/to 使用 ISO8601，默认最近1小时，跨度最多7天；engine 可筛选 Agent。产物缺失、变化或越界时返回明确错误，不应从原始文件系统路径拼接下载 URL。
