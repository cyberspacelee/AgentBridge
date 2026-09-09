# AgentBridge API — API Reference

版本：0.1.15 · OpenAPI 3.1.0
Base URL 为当前网关地址。无需 Authorization/Cookie；仅供受信任客户端，同源与目录访问约束仍生效。JSON 请求使用 Content-Type: application/json，默认最大 1 MiB。响应头 X-Request-ID 用于追踪。字段标记 required 为必填；null 与省略不同。[Markdown 文档（供 Agent 使用）](/api/docs.md) · [完整会话示例](/api/examples/session.md)。
获取地址：`GET /api/docs.md`（本文）、`GET /api/openapi.json`（机器定义）、`GET /api/docs`（网页）、`GET /api/examples/session.md`（完整会话示例）。
Base URL 示例：`http://127.0.0.1:6217`；以下路径相对此地址。无参数的操作明确标注“无”，不要构造额外请求体。请求表的“必填”针对所在对象；父对象可选不代表其内部必填字段可省略。响应表的“必返”表示字段存在，null 表示值可能为空。命名类型在文末数据模型中展开。
## 接口索引

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /api/examples/session.md | [完整会话：发现引擎与模型 → 创建 → 审批 → 完成 → 清理](#sessionlifecycle) |
| POST | /session | [创建会话](#createsession) |
| GET | /session/{id} | [查询会话](#getsession) |
| DELETE | /session/{id} | [删除会话](#deletesession) |
| GET | /session/status | [查询所有会话忙闲状态](#listsessionstatuses) |
| POST | /session/{id}/prompt_async | [提交消息并等待本轮结束](#promptsession) |
| GET | /session/{id}/message | [读取会话消息与工具轨迹](#listsessionmessages) |
| POST | /session/{id}/abort | [中止会话执行](#abortsession) |
| POST | /session/{id}/stop | [中止会话执行（abort 别名）](#stopsession) |
| GET | /permission | [查询待处理权限审批](#listpermissions) |
| POST | /permission/{id}/reply | [回复权限审批](#replypermission) |
| GET | /question | [查询待回答问题](#listquestions) |
| POST | /question/{id}/reply | [回答问题](#replyquestion) |
| POST | /api/tasks | [创建会话并提交首轮](#createtask) |
| GET | /api/tasks | [分页查询任务](#listtasks) |
| POST | /api/tasks/{id}/runs | [向已有会话追加一轮](#submitrun) |
| GET | /api/tasks/{id}/runs | [分页读取会话执行记录](#listtaskruns) |
| GET | /api/tasks/{id} | [读取任务详情](#gettask) |
| GET | /api/runs/{id} | [读取本轮结果](#getrun) |
| GET | /api/runs/{id}/messages | [分页读取本轮消息](#listrunmessages) |
| GET | /api/submissions/{id} | [查询幂等提交结果](#getsubmission) |
| GET | /event | [订阅会话事件（SSE）](#subscribeevents) |
| GET | /health/live | [检查进程存活](#liveness) |
| GET | /health/ready | [检查服务就绪](#readiness) |
| GET | /api/runtime | [读取引擎、模型与运行限制](#getruntimeinfo) |
| GET | /api/system | [读取系统信息](#getsystem) |
| GET | /api/system/gateway | [读取监听配置](#getgatewaysettings) |
| PUT | /api/system/gateway | [保存监听配置](#savegatewaysettings) |
| GET | /api/system/network | [读取网络配置](#getnetworksettings) |
| PUT | /api/system/network | [保存网络配置](#savenetworksettings) |
| POST | /api/system/network/test | [测试网络连接](#testnetwork) |
| POST | /api/system/lifecycle | [重启或关闭网关](#changelifecycle) |
| GET | /api/system/directories | [浏览工作目录](#listdirectories) |
| POST | /api/system/certificates | [保存 PEM CA 证书](#uploadcertificate) |
| GET | /api/settings | [读取资源配置](#getsettings) |
| PUT | /api/settings | [替换资源配置](#savesettings) |
| GET | /api/agents | [读取 Agent 状态](#listagents) |
| POST | /api/agents/{id}/actions | [启用、停用、停止或应用 Agent 配置](#actonagent) |
| GET | /api/engines/{id}/models | [查询 Agent 可用模型](#listmodels) |
| POST | /api/providers/{id}/test | [测试已保存模型连接](#testprovider) |
| POST | /api/agents/{id}/import | [预览原生配置导入](#previewnativeconfig) |
| GET | /api/runtimes | [查询 CLI 安装状态](#listruntimes) |
| POST | /api/runtimes/{id}/actions | [检查、检测、安装、更新、卸载或取消 CLI 操作](#actonruntime) |
| PUT | /api/runtimes/{id}/source | [绑定托管或外部 CLI](#bindruntimesource) |
| GET | /api/artifacts/{id} | [读取产物元数据](#getartifact) |
| GET | /api/artifacts/{id}/content | [读取产物内容](#downloadartifact) |
| GET | /api/observability/overview | [查询执行与资源汇总](#getoverview) |
| GET | /api/observability/series | [查询时序指标](#getseries) |
| GET | /api/observability/errors | [查询错误与警告日志](#listerrors) |
| GET | /api/observability/runs/{id} | [读取单轮诊断](#getrundiagnostics) |
| GET | /metrics | [读取 Prometheus 指标](#getmetrics) |
| GET | /api/docs.md | [下载完整 Markdown API 文档（供 Agent 使用）](#getapimarkdown) |
| GET | /api/docs | [打开 API 文档](#getapidocs) |
| GET | /api/openapi.json | [下载 OpenAPI 3.1 定义](#getopenapi) |
| GET | /api/examples/evaluate.mjs | [下载自动会话验证脚本](#getevaluationexample) |

## 调用示例

### sessionlifecycle

**GET /api/examples/session.md — 完整会话：发现引擎与模型 → 创建 → 审批 → 完成 → 清理**

#### 完整会话调用示例

网页：`GET /api/docs`；完整 Markdown：`GET /api/docs.md`；OpenAPI 3.1：`GET /api/openapi.json`。
以下命令使用 Bash、curl 和 jq；Base URL 替换为当前网关地址。接口无需 Authorization。

##### 1. 查询可用引擎与模型

```sh
BASE=http://127.0.0.1:6217
curl -sS "$BASE/api/runtime" | jq '{engine, engines, limits}'
curl -sS "$BASE/api/agents" | jq '.agents[] | {id, enabled, health, models}'
ENGINE=pi # 从已启用且 health.status=ready 的 Agent 中选择
curl -sS "$BASE/api/engines/$ENGINE/models" | jq '.models'
```

`/api/runtime.engine` 是默认引擎，`engines[]` 是引擎清单；只有目标 Agent 启用且就绪后才能创建会话。`/api/runtimes` 查询 CLI 安装状态，已安装不等于可执行。模型接口返回 `{models:[{providerID,modelID,name}]}`；记录所选模型的两个 ID。显式模型必须属于所选 Agent。

##### 2. 创建会话

```sh
WORKDIR=/absolute/workspace # 网关主机上已存在且允许访问的绝对路径
SESSION=$(curl -fsS -X POST "$BASE/session" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg dir "$WORKDIR" --arg engine "$ENGINE" \
    '{directory:$dir,engineId:$engine,interactionPolicy:{permission:"manual",question:"manual"}}')")
SID=$(printf '%s' "$SESSION" | jq -er '.id')
printf '%s\n' "$SESSION"
```

200 返回 `id/title/engineId/directory/interactionPolicy/created_at/status`。`directory` 必填；`engineId/title/interactionPolicy` 可选。省略引擎使用默认值，省略交互策略继承 Agent 已应用配置（初值为 auto）；本例显式使用人工审批。引擎、目录、交互策略创建后固定。

##### 3. 订阅事件

另开终端，替换会话 ID；保留此连接：

```sh
curl -N 'http://127.0.0.1:6217/event?sessionId=<SID>'
```

每帧 `data:` 是 JSON，业务帧还含 `id:`。关注 `permission.asked`、`question.asked`、`message.part.updated`、`run.finished`、`session.error`。断线时用 `Last-Event-ID` 请求头续传；收到 `server.resync_required` 后重新查询会话、执行、消息与待处理交互。

##### 4. 提交首轮消息

```sh
PROVIDER='<上一步的 providerID>'
MODEL='<上一步的 modelID>'
ACCEPTED=$(curl -fsS -X POST "$BASE/api/tasks/$SID/runs" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg provider "$PROVIDER" --arg model "$MODEL" \
    '{submissionId:"turn-001",model:{providerID:$provider,modelID:$model},parts:[{type:"text",text:"检查项目并运行测试；需要权限或信息时先询问我。"}]}')")
RID=$(printf '%s' "$ACCEPTED" | jq -er '.runId')
printf '%s\n' "$ACCEPTED"
```

202 返回 `submissionId/taskId/sessionId/runId/acceptedAt`，其中 `taskId=sessionId`。`submissionId` 和 `parts` 必填；`model` 可省略以继承会话或 Agent 默认模型。文本片段 1–16 个，总 UTF-8 文本不超过 128 KiB，不能全空白。

同操作、同会话下，使用相同 `submissionId` 和完全相同请求重试会返回原结果；不同输入返回 409。响应丢失时调用 `GET /api/submissions/turn-001?operation=append&sessionId=<SID>` 核对结果。

##### 5. 处理权限审批与问题

在原终端查询当前会话、本轮执行的待处理项：

```sh
curl -sS "$BASE/permission" | jq --arg sid "$SID" --arg rid "$RID" \
  '.[] | select(.sessionID==$sid and .runId==$rid and .state=="pending")'
curl -sS "$BASE/question" | jq --arg sid "$SID" --arg rid "$RID" \
  '.[] | select(.sessionID==$sid and .runId==$rid and .state=="pending")'
```

仅在实际收到交互后回复；路径使用 **Interaction.id**，不是会话 ID。

```sh
#### 替换为实际审批 ID；审阅 permission、patterns 后选择 once / always / reject
curl -fsS -X POST "$BASE/permission/<permission-id>/reply" \
  -H 'Content-Type: application/json' -d '{"reply":"once"}'
#### 按实际 questions 顺序、选项 label 和多选约束填写，每题对应一个数组
curl -fsS -X POST "$BASE/question/<question-id>/reply" \
  -H 'Content-Type: application/json' -d '{"answers":[["实际选项 label"]]}'
```

成功为 200 `{"ok":true}`。审批和问题可能出现多次；持续处理到本轮终态。`always` 的范围服从原生引擎；`reject` 拒绝本次权限，不等同于中止整个会话。问题数量/选项不符返回 400，重复/过期回复返回 409，交互不存在返回 404。

##### 6. 查询完成状态与输出

```sh
curl -fsS "$BASE/api/runs/$RID" | jq '.detail | {run, messages}'
curl -fsS "$BASE/session/$SID/message" | jq '.'
curl -fsS "$BASE/api/tasks/$SID" | jq '.detail.artifacts'
```

轮询 `detail.run.state`，同时继续处理人工交互。`queued/running/stopping` 尚未结束；`completed/failed/timed_out/cancelled` 是终态，仅 `completed` 成功。失败原因见 `run.error`，输出文本在 `messages[].parts[]` 的 `content`，工具输入输出在 tool part。`usage=null` 表示用量未知，不能当作零。执行成功先落库，产物可能仍在登记；通过 `artifact.updated` 或刷新详情获取后续产物，登记失败只记录产物警告。产物 ID 来自 `detail.artifacts`，下载用 `GET /api/artifacts/{id}/content`。

`session.status=idle` / `session.idle` 只表示空闲。若依据消息确认完成，最后助手消息须 `info.finish=stop` 且包含 `step-finish`；`tool-calls` 不表示本轮完成。

##### 7. 继续对话、中止或删除会话

```sh
#### 下一轮复用 SID，换新幂等键；本例继承上一轮模型
curl -fsS -X POST "$BASE/api/tasks/$SID/runs" -H 'Content-Type: application/json' \
  -d '{"submissionId":"turn-002","parts":[{"type":"text","text":"总结刚才的结果。"}]}'
#### 需要取消时：中止活动和排队中的执行，保留会话与消息
curl -fsS -X POST "$BASE/session/$SID/abort"
#### 完成结果采集后：删除会话及关联记录（会先停止执行）
curl -fsS -X DELETE "$BASE/session/$SID"
```

一次正常执行结束无需显式 close/end；保留会话即可继续对话。`abort` 与 `stop` 是别名，返回 200 `{"ok":true}`；删除也返回该响应，随后查询会话返回 404。SSE 由客户端关闭连接。

##### 另一种提交方式：prompt_async

`POST /session/{id}/prompt_async` 接受 `{parts,model?,agent?}`。虽然名称包含 async，HTTP 连接会等待本轮执行结束：204 成功且无响应体；502 执行失败；504 超时；409 取消。客户端 HTTP 超时应大于运行上限（默认 1800 秒，可在系统信息页配置）。人工模式必须用另一连接处理审批和问题。该接口没有幂等键；以上立即返回 runId 的接口更适合人工交互流程。

自动模式验证脚本：`GET /api/examples/evaluate.mjs`。Node.js >=22.21，无额外依赖；运行 `node evaluate.mjs --url http://127.0.0.1:6217 --directory /absolute/workspace --prompt '只回复 OK'`。

##### 任务期限配置

四个 Agent 默认共用 30 分钟任务总时限。从提交开始计算，包含排队和人工等待；持续输出不续期。`deadlineAt` 随本轮持久化，修改设置不会影响已提交的任务。

在“系统信息 → 任务超时”输入 1–1440 的整数分钟数并保存。API 使用 `GET /api/settings` 取得配置与 revision，然后通过 `PUT /api/settings` 完整提交并设置 `settings.runTimeoutMs`（毫秒）。新提交立即生效，无需重启；`GET /api/runtime` 的 `limits.runTimeoutMs` 返回当前生效值。配置优先级为 settings.json 中的值、AGENT_LIMITS.runTimeoutMs、默认 1800000。

评测脚本 `tools/evaluate.mjs` 默认读取生效时限并额外等待 60 秒，使用异步提交与轮询，避免 HTTP 长请求的响应头超时；显式 `--timeout` 仍可覆盖客户端等待时间。网关的兼容接口 `/session/{id}/prompt_async` 仍等待终态，区别于 OpenCode 原生同名接口；长任务客户端应优先使用 `/api/tasks/{id}/runs`。

详见[超时与完成处理](TIMEOUTS.md)。


路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | text/plain | string | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


## 会话

### createsession

**POST /session — 创建会话**

仅创建会话，不执行消息。记录返回的 id。需要人工审批时显式设置 interactionPolicy 为 manual；省略则继承 Agent 已应用策略。工作目录、引擎和策略在创建后固定。

路径/查询/额外请求头参数：无。

请求体：必填，Content-Type: application/json；类型：CreateSession。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| engineId | string | 否 | enum=["pi","opencode","codex","grok"] | 所用 Agent；省略使用当前默认 Agent。Agent 必须已启用且就绪，会话创建后不可更换。 |
| directory | string | 是 | minLength=1；maxLength=4096 | 网关主机上已存在、可访问且符合目录白名单的绝对路径；不是客户端本机路径。 |
| title | string | 否 | maxLength=200 | 会话标题。省略或空白时由首条消息生成（合并空白，截取前 80 字符）。 |
| interactionPolicy | object | 否 | additionalProperties=false | 创建后固定。省略继承 Agent 已应用策略；manual 需要客户端通过审批/问题接口回复。 |
| interactionPolicy.permission | string | 是 | enum=["auto","manual"] | — |
| interactionPolicy.question | string | 是 | enum=["auto","manual"] | — |

请求示例：


```json
{
  "directory": "/absolute/workspace",
  "engineId": "pi",
  "title": "会话示例",
  "interactionPolicy": {
    "permission": "manual",
    "question": "manual"
  }
}
```


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | SessionCreated | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 429 | application/json | Error | 请求或资源达到限制 |
| 500 | application/json | Error | 内部操作失败 |
| 502 | application/json | Error | 引擎执行或模型连接失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |

200 响应示例：


```json
{
  "id": "ses_001",
  "directory": "/absolute/workspace",
  "engineId": "pi",
  "title": "会话示例",
  "interactionPolicy": {
    "permission": "manual",
    "question": "manual"
  },
  "created_at": "2026-09-09T06:00:00Z",
  "status": "idle"
}
```


### getsession

**GET /session/{id} — 查询会话**

status=idle 仅表示当前空闲，不表示上一轮成功。message_count 为会话消息总数。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | SessionView | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 500 | application/json | Error | 内部操作失败 |


### deletesession

**DELETE /session/{id} — 删除会话**

无请求体。停止执行并删除会话及关联记录；先读取所需消息与产物。此接口用于最终清理；一轮正常完成后无需删除，可继续使用会话。没有独立的 close/end 接口。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Ok | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |

200 响应示例：


```json
{
  "ok": true
}
```


### listsessionstatuses

**GET /session/status — 查询所有会话忙闲状态**

查询所有会话忙闲状态

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Record<string, object> | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |

200 响应示例：


```json
{
  "ses_001": {
    "type": "idle"
  }
}
```


### promptsession

**POST /session/{id}/prompt_async — 提交消息并等待本轮结束**

名称虽为 prompt_async，HTTP 连接会等待本轮终态：成功 204（空响应）、失败 502、超时 504、取消 409。HTTP 超时应大于运行上限（默认 1800 秒，可在系统信息页配置）。manual 模式须在另一连接处理审批/问题。无需重新创建会话即可再次调用完成多轮对话。此接口无幂等键；需要立即返回 runId 和幂等重试请用 POST /api/tasks/{id}/runs。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：必填，Content-Type: application/json；类型：Prompt。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| parts | Array<object> | 是 | minItems=1；maxItems=16 | 1–16 个文本片段，不能全部为空白；以换行连接后的 UTF-8 总长度不超过 131072 字节（128 KiB）。请求字段为 text，响应文本字段为 content。 |
| parts[].type | string | 是 | const="text" | — |
| parts[].text | string | 是 | minLength=1；maxLength=131072 | — |
| model | object | 否 | additionalProperties=false | 省略时继承会话模型或 Agent 默认模型。显式模型必须属于当前 Agent；不会静默替换。 |
| model.providerID | string | 是 | minLength=1；maxLength=200 | — |
| model.modelID | string | 是 | minLength=1；maxLength=300 | — |
| agent | string | 否 | const="assistant" | 助手角色，仅支持 assistant；不是 Agent/引擎 ID。 |

请求示例：


```json
{
  "parts": [
    {
      "type": "text",
      "text": "检查项目并运行测试；需要权限或信息时先询问我。"
    }
  ]
}
```


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 204 | — | 无响应体 | 执行成功；无响应体。 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 429 | application/json | Error | 请求或资源达到限制 |
| 500 | application/json | Error | 内部操作失败 |
| 502 | application/json | Error | 引擎执行或模型连接失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |

### listsessionmessages

**GET /session/{id}/message — 读取会话消息与工具轨迹**

返回全部消息（不分页）。文本在 parts[].content。最终助手消息需 role=assistant、info.finish=stop 且含 step-finish；tool-calls 或单独 step-finish 不能判定成功。失败时仍可读取已有轨迹。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Array<Message> | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 500 | application/json | Error | 内部操作失败 |

200 响应示例：


```json
[
  {
    "id": "msg_001",
    "sessionId": "ses_001",
    "runId": "run_001",
    "role": "assistant",
    "created_at": "2026-09-09T06:00:01Z",
    "completedAt": "2026-09-09T06:00:02Z",
    "info": {
      "finish": "stop"
    },
    "parts": [
      {
        "id": "part_001",
        "type": "text",
        "content": "检查完成。"
      },
      {
        "id": "part_002",
        "type": "step-finish",
        "reason": "stop",
        "usage": null
      }
    ]
  }
]
```


### abortsession

**POST /session/{id}/abort — 中止会话执行**

无请求体。取消本会话活动与排队中的执行，未完成交互会过期；保留会话和已生成消息，后续仍可提交新一轮。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Ok | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |

200 响应示例：


```json
{
  "ok": true
}
```


### stopsession

**POST /session/{id}/stop — 中止会话执行（abort 别名）**

无请求体。取消本会话活动与排队中的执行，未完成交互会过期；保留会话和已生成消息，后续仍可提交新一轮。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Ok | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |

200 响应示例：


```json
{
  "ok": true
}
```


## 审批与问题

### listpermissions

**GET /permission — 查询待处理权限审批**

返回所有会话中 state=pending/replying 的对应交互，无过滤参数。按 sessionID 和 runId 在客户端筛选，仅回复 pending 项；也可从 SSE 接收 asked 事件。无待处理项时返回 []。

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Array<Interaction> | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### replypermission

**POST /permission/{id}/reply — 回复权限审批**

once 单次批准，always 的作用范围服从原生引擎，reject 拒绝。成功后继续等待本轮结果，不代表本轮已结束。重复、过期或执行已结束返回 409；重新查询，不要盲目重复批准。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | Interaction.id（不是会话 ID）；来自对应 GET 列表或 SSE asked 事件。 |

请求体：必填，Content-Type: application/json；类型：PermissionReply。
once 单次批准、always 按原生引擎作用范围批准、reject 拒绝；重复或过期回复返回 409。message 可选，最长 10000 字符。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| reply | string | 是 | enum=["once","always","reject"] | — |
| message | string | 否 | maxLength=10000 | — |

请求示例：


```json
{
  "reply": "once",
  "message": "允许本次操作"
}
```


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Ok | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 500 | application/json | Error | 内部操作失败 |
| 502 | application/json | Error | 引擎执行或模型连接失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |

200 响应示例：


```json
{
  "ok": true
}
```


### listquestions

**GET /question — 查询待回答问题**

返回所有会话中 state=pending/replying 的对应交互，无过滤参数。按 sessionID 和 runId 在客户端筛选，仅回复 pending 项；也可从 SSE 接收 asked 事件。无待处理项时返回 []。

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Array<Interaction> | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### replyquestion

**POST /question/{id}/reply — 回答问题**

answers 必须与 questions 顺序和数量一致；每题为字符串数组，遵循 multiple 和 allowCustom。格式/选项不符返回 400；重复、过期或执行已结束返回 409。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | Interaction.id（不是会话 ID）；来自对应 GET 列表或 SSE asked 事件。 |

请求体：必填，Content-Type: application/json；类型：QuestionReply。
answers 按 questions 顺序逐题回答，每题对应字符串数组；选项回答用 label。multiple=false 仅允许一项，allowCustom=false 不允许选项外文本。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| answers | Array<Array<string>> | 是 | maxItems=100；数组元素：maxItems=100；数组元素：maxLength=10000 | — |

请求示例：


```json
{
  "answers": [
    [
      "第一题选项 label"
    ],
    [
      "第二题回答"
    ]
  ]
}
```


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Ok | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 500 | application/json | Error | 内部操作失败 |
| 502 | application/json | Error | 引擎执行或模型连接失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |

200 响应示例：


```json
{
  "ok": true
}
```


## 任务与执行

### createtask

**POST /api/tasks — 创建会话并提交首轮**

立即返回已受理执行，不等待完成。按 runId 轮询 GET /api/runs/{id}；manual 策略同样需要审批/问题回复。相同幂等键和请求可安全重试。

路径/查询/额外请求头参数：无。

请求体：必填，Content-Type: application/json；类型：CreateTask。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| engineId | string | 否 | enum=["pi","opencode","codex","grok"] | 所用 Agent；省略使用当前默认 Agent。Agent 必须已启用且就绪，会话创建后不可更换。 |
| directory | string | 是 | minLength=1；maxLength=4096 | 网关主机上已存在、可访问且符合目录白名单的绝对路径；不是客户端本机路径。 |
| title | string | 否 | maxLength=200 | 会话标题。省略或空白时由首条消息生成（合并空白，截取前 80 字符）。 |
| interactionPolicy | object | 否 | additionalProperties=false | 创建后固定。省略继承 Agent 已应用策略；manual 需要客户端通过审批/问题接口回复。 |
| interactionPolicy.permission | string | 是 | enum=["auto","manual"] | — |
| interactionPolicy.question | string | 是 | enum=["auto","manual"] | — |
| parts | Array<object> | 是 | minItems=1；maxItems=16 | 1–16 个文本片段，不能全部为空白；以换行连接后的 UTF-8 总长度不超过 131072 字节（128 KiB）。请求字段为 text，响应文本字段为 content。 |
| parts[].type | string | 是 | const="text" | — |
| parts[].text | string | 是 | minLength=1；maxLength=131072 | — |
| model | object | 否 | additionalProperties=false | 省略时继承会话模型或 Agent 默认模型。显式模型必须属于当前 Agent；不会静默替换。 |
| model.providerID | string | 是 | minLength=1；maxLength=200 | — |
| model.modelID | string | 是 | minLength=1；maxLength=300 | — |
| agent | string | 否 | const="assistant" | 助手角色，仅支持 assistant；不是 Agent/引擎 ID。 |
| submissionId | string | 是 | pattern="^[a-zA-Z0-9_-]{1,128}$" | 幂等键：1–128 个字母、数字、下划线或短横线。同操作/目标、同键同请求返回原结果；不同请求返回 409。每次新执行使用新键。 |

请求示例：


```json
{
  "directory": "/absolute/workspace",
  "engineId": "pi",
  "title": "会话示例",
  "interactionPolicy": {
    "permission": "manual",
    "question": "manual"
  },
  "parts": [
    {
      "type": "text",
      "text": "检查项目并运行测试；需要权限或信息时先询问我。"
    }
  ],
  "submissionId": "turn-001"
}
```


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 202 | application/json | AcceptedRun | 已受理；通过查询接口确认最终结果。 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 410 | application/json | Error | 幂等提交对应的会话已删除 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 429 | application/json | Error | 请求或资源达到限制 |
| 500 | application/json | Error | 内部操作失败 |
| 502 | application/json | Error | 引擎执行或模型连接失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |

202 响应示例：


```json
{
  "submissionId": "turn-001",
  "taskId": "ses_001",
  "sessionId": "ses_001",
  "runId": "run_001",
  "acceptedAt": "2026-09-09T06:00:00Z"
}
```


### listtasks

**GET /api/tasks — 分页查询任务**

按创建时间和 ID 降序。保留 nextCursor 与原筛选；游标不匹配筛选返回 400，锚点已删除返回 409。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| limit | query | integer | 否 | minimum=1；maximum=100；default=20 | 每页条数。 |
| cursor | query | string | 否 | maxLength=2000 | 上一页 nextCursor；首请求省略。 |
| q | query | string | 否 | maxLength=300；default="" | 标题或 ID 的不区分大小写子串。 |
| status | query | string | 否 | enum=["queued","running","stopping","completed","failed","timed_out","cancelled","not_started","waiting_input","unavailable","deleting",""]；default="" | 精确匹配状态；空字符串表示全部。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 500 | application/json | Error | 内部操作失败 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| snapshot | Snapshot | 是 |  | — |
| items | Array<TaskSummary> | 是 |  | — |
| nextCursor | string \| null | 是 |  | 下一页游标；null 表示最后一页。原样传回并保持筛选条件一致；409 时重新读取首页。 |


### submitrun

**POST /api/tasks/{id}/runs — 向已有会话追加一轮**

路径 id 为已有 sessionId/taskId。同会话各轮串行执行；立即返回 runId，推荐在人工交互客户端中使用。每一新轮使用新 submissionId。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：必填，Content-Type: application/json；类型：SubmitRun。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| parts | Array<object> | 是 | minItems=1；maxItems=16 | 1–16 个文本片段，不能全部为空白；以换行连接后的 UTF-8 总长度不超过 131072 字节（128 KiB）。请求字段为 text，响应文本字段为 content。 |
| parts[].type | string | 是 | const="text" | — |
| parts[].text | string | 是 | minLength=1；maxLength=131072 | — |
| model | object | 否 | additionalProperties=false | 省略时继承会话模型或 Agent 默认模型。显式模型必须属于当前 Agent；不会静默替换。 |
| model.providerID | string | 是 | minLength=1；maxLength=200 | — |
| model.modelID | string | 是 | minLength=1；maxLength=300 | — |
| agent | string | 否 | const="assistant" | 助手角色，仅支持 assistant；不是 Agent/引擎 ID。 |
| submissionId | string | 是 | pattern="^[a-zA-Z0-9_-]{1,128}$" | 幂等键：1–128 个字母、数字、下划线或短横线。同操作/目标、同键同请求返回原结果；不同请求返回 409。每次新执行使用新键。 |

请求示例：


```json
{
  "parts": [
    {
      "type": "text",
      "text": "检查项目并运行测试；需要权限或信息时先询问我。"
    }
  ],
  "submissionId": "turn-002"
}
```


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 202 | application/json | AcceptedRun | 已受理；通过查询接口确认最终结果。 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 410 | application/json | Error | 幂等提交对应的会话已删除 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 429 | application/json | Error | 请求或资源达到限制 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |

202 响应示例：


```json
{
  "submissionId": "turn-002",
  "taskId": "ses_001",
  "sessionId": "ses_001",
  "runId": "run_002",
  "acceptedAt": "2026-09-09T06:00:00Z"
}
```


### listtaskruns

**GET /api/tasks/{id}/runs — 分页读取会话执行记录**

分页读取会话执行记录

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |
| limit | query | integer | 否 | minimum=1；maximum=100；default=20 | 每页条数。 |
| cursor | query | string | 否 | maxLength=2000 | 上一页 nextCursor；首请求省略。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 500 | application/json | Error | 内部操作失败 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| snapshot | Snapshot | 是 |  | — |
| items | Array<Run> | 是 |  | — |
| nextCursor | string \| null | 是 |  | 下一页游标；null 表示最后一页。原样传回并保持筛选条件一致；409 时重新读取首页。 |


### gettask

**GET /api/tasks/{id} — 读取任务详情**

读取任务详情

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 500 | application/json | Error | 内部操作失败 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| snapshot | Snapshot | 是 |  | — |
| detail | TaskDetail | 是 |  | — |


### getrun

**GET /api/runs/{id} — 读取本轮结果**

轮询 detail.run.state；completed/failed/timed_out/cancelled 均为终态，仅 completed 成功。失败原因见 error，输出见 detail.messages。manual 等待审批时仍为非终态，应继续处理交互。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 500 | application/json | Error | 内部操作失败 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| snapshot | Snapshot | 是 |  | — |
| detail | object | 是 |  | — |
| detail.run | Run | 是 |  | — |
| detail.messages | Array<Message> | 是 |  | — |


### listrunmessages

**GET /api/runs/{id}/messages — 分页读取本轮消息**

分页读取本轮消息

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |
| limit | query | integer | 否 | minimum=1；maximum=100；default=20 | 每页条数。 |
| cursor | query | string | 否 | maxLength=2000 | 上一页 nextCursor；首请求省略。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 500 | application/json | Error | 内部操作失败 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| snapshot | Snapshot | 是 |  | — |
| items | Array<Message> | 是 |  | — |
| nextCursor | string \| null | 是 |  | 下一页游标；null 表示最后一页。原样传回并保持筛选条件一致；409 时重新读取首页。 |


### getsubmission

**GET /api/submissions/{id} — 查询幂等提交结果**

用于提交响应丢失后的结果核对。检查 status/result/error，避免更换幂等键造成重复执行。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |
| operation | query | string | 是 | enum=["create","append"] | 原提交操作：create 创建任务，append 追加执行。 |
| sessionId | query | string | 否 | default="" | append 时传原 sessionId；create 时省略。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Submission | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 500 | application/json | Error | 内部操作失败 |


## 事件

### subscribeevents

**GET /event — 订阅会话事件（SSE）**

创建会话后、提交消息前建立连接。帧使用 id: 与 data:，没有 event: 行；data 是 JSON。控制帧无持久化 id，立即发送 connected，每 15 秒 heartbeat。收到 server.resync_required 时重读任务/消息/审批快照，更新游标；不能假设历史完整。连接/慢消费者缓冲有上限。

| type | properties |
| --- | --- |
| server.connected / server.heartbeat / server.resync_required | Snapshot 字段 + heartbeatMs:15000 |
| permission.asked / question.asked / interaction.updated | Interaction；按 sessionID/runId 匹配 |
| session.status | {sessionID,status:{type:"busy"或"idle"}} |
| session.idle | {sessionID}；空闲不表示成功 |
| session.error | {sessionID,error:Failure} |
| message.updated | Message 元数据（不含 parts） |
| message.part.updated | {sessionID,messageID,part:MessagePart} |
| session.created / session.updated | TaskSummary |
| session.deleted | {sessionID} |
| run.accepted / run.updated / run.finished | Run |
| artifact.updated | Artifact |
| agents.updated | AgentView[] |

业务 data 结构见 AppEvent，控制 data 结构见 ControlEvent。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| sessionId | query | string | 否 |  | 仅接收此会话的业务事件；省略接收全部。 |
| Last-Event-ID | header | string | 否 |  | 上次业务帧 id；断线后回放。无游标从当前时刻开始。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | text/event-stream | string | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |

200 响应示例：


```text
data: {"type":"server.connected","properties":{"storeId":"store_001","instanceId":"instance_001","revision":1,"cursor":"evt_001","capturedAt":"2026-09-09T06:00:00Z","heartbeatMs":15000}}

id: evt_002
data: {"schemaVersion":1,"eventId":"evt_002","revision":2,"instanceId":"instance_001","occurredAt":"2026-09-09T06:00:01Z","type":"session.idle","sessionId":"ses_001","properties":{"sessionID":"ses_001"}}


```


## 产物

### getartifact

**GET /api/artifacts/{id} — 读取产物元数据**

产物 ID 来自任务 detail.artifacts；返回当前 availability，缺失/变化会更新状态。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Artifact | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 500 | application/json | Error | 内部操作失败 |


### downloadartifact

**GET /api/artifacts/{id}/content — 读取产物内容**

返回校验过 SHA-256 的完整文件，最大 100 MiB；不支持 Range/206。响应 Content-Type 为产物媒体类型（inline 为 text/plain），Content-Disposition 提供文件名。产物变化返回 409；请使用 ID，不要从原始路径拼接 URL。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |
| disposition | query | string | 否 | enum=["inline","attachment"]；default="attachment" | inline 仅允许不超过 1 MiB 的 text/*，以 text/plain 返回；attachment 按产物媒体类型下载。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/octet-stream | string | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |


## Agent 与资源

### getsettings

**GET /api/settings — 读取资源配置**

读取资源配置

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | SettingsView | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### savesettings

**PUT /api/settings — 替换资源配置**

完整替换配置，revision 必须匹配 GET 结果；冲突返回 409。返回掩码密钥 ******** 可原样提交保留旧值。Agent 资源配置保存后对相关 Agent 执行 apply；runTimeoutMs 为 60000–86400000 毫秒，保存后立即用于四个 Agent 的新任务，无需 apply 或重启，优先于 AGENT_LIMITS.runTimeoutMs。省略时使用环境变量或默认 1800000 毫秒。

路径/查询/额外请求头参数：无。

请求体：必填，Content-Type: application/json；类型：object。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| settings | SettingsInput | 是 |  | — |
| revision | string | 是 |  | — |


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | SettingsView | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |


### listagents

**GET /api/agents — 读取 Agent 状态**

读取 Agent 状态

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| agents | Array<AgentView> | 是 |  | — |


### actonagent

**POST /api/agents/{id}/actions — 启用、停用、停止或应用 Agent 配置**

disable/apply 等待活动执行；stop 强制停止。202 后轮询 /api/agents 的 operation/error/health。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | enum=["pi","opencode","codex","grok"] | Agent ID。 |

请求体：必填，Content-Type: application/json；类型：object。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| action | string | 是 | enum=["enable","disable","stop","apply"] | — |


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 202 | application/json | AgentView | 已受理；通过查询接口确认最终结果。 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 500 | application/json | Error | 内部操作失败 |
| 502 | application/json | Error | 引擎执行或模型连接失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |


### listmodels

**GET /api/engines/{id}/models — 查询 Agent 可用模型**

查询 Agent 可用模型

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | enum=["pi","opencode","codex","grok"] | Agent ID。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| models | Array<ModelOption> | 是 |  | — |


### testprovider

**POST /api/providers/{id}/test — 测试已保存模型连接**

id 为配置中的 provider ID；使用已保存的凭据发起真实模型请求。失败返回 502 MODEL_CONNECTION_ERROR，耗时单位毫秒。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：必填，Content-Type: application/json；类型：object。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| modelID | string | 是 | minLength=1；maxLength=300 | — |


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 500 | application/json | Error | 内部操作失败 |
| 502 | application/json | Error | 引擎执行或模型连接失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| ok | boolean | 是 | const=true | — |
| durationMs | number | 是 |  | — |
| modelID | string | 是 |  | — |


### previewnativeconfig

**POST /api/agents/{id}/import — 预览原生配置导入**

file 为主机上已存在的绝对 JSON/TOML 文件路径，大小不超过 1 MiB。只预览支持的资源，不保存、不导入密钥；检查 warnings 后合并到 settings。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | enum=["pi","opencode","codex","grok"] | Agent ID。 |

请求体：必填，Content-Type: application/json；类型：object。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| file | string | 是 | minLength=1；maxLength=4096 | — |


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| providers | Array<object> | 是 |  | — |
| providers[].id | string | 是 | minLength=1；maxLength=100；pattern="^[a-zA-Z0-9_-]+$" | — |
| providers[].baseUrl | string | 是 | format="uri" | — |
| providers[].apiKey | string | 是 | default=""；maxLength=8192 | — |
| providers[].api | string | 是 | default="openai-completions"；enum=["openai-completions","openai-responses"] | — |
| providers[].models | Array<object> | 是 | minItems=1；maxItems=100 | — |
| providers[].models[].id | string | 是 | minLength=1；maxLength=200 | — |
| providers[].models[].name | string | 是 | default=""；maxLength=200 | — |
| providers[].models[].thinking | string | 是 | default="default"；enum=["default","off"] | — |
| providers[].models[].contextWindow | integer | 是 | default=128000；minimum=1024；maximum=10000000 | — |
| providers[].models[].maxTokens | integer | 是 | default=16384；minimum=1；maximum=1000000 | — |
| providers[].enabled | boolean | 是 | default=true | — |
| skills | Array<object> | 是 |  | — |
| skills[].id | string | 是 | minLength=1；maxLength=100；pattern="^[a-zA-Z0-9_-]+$" | — |
| skills[].path | string | 是 | minLength=1；maxLength=4096 | — |
| skills[].enabled | boolean | 是 | default=true | — |
| mcp | Array<object> | 是 |  | — |
| mcp[].id | string | 是 | minLength=1；maxLength=100；pattern="^[a-zA-Z0-9_-]+$" | — |
| mcp[].enabled | boolean | 是 | default=true | — |
| mcp[].config | object \| object | 是 | additionalProperties=false；additionalProperties=false | — |
| mcp[].config.分支1.type | string | 是 | const="local" | — |
| mcp[].config.分支1.command | Array<string> | 是 | minItems=1；maxItems=100；数组元素：minLength=1；maxLength=4096 | — |
| mcp[].config.分支1.environment | Record<string, string> | 是 | default={}；propertyNames={"type":"string","minLength":1,"maxLength":100,"pattern":"^[a-zA-Z0-9_-]+$"}；additionalProperties={"type":"string","maxLength":8192} | — |
| mcp[].config.分支2.type | string | 是 | const="remote" | — |
| mcp[].config.分支2.url | string | 是 | format="uri" | — |
| mcp[].config.分支2.headers | Record<string, string> | 是 | default={}；propertyNames={"type":"string","minLength":1,"maxLength":200}；additionalProperties={"type":"string","maxLength":8192} | — |
| warnings | Array<string> | 是 |  | — |


### listruntimes

**GET /api/runtimes — 查询 CLI 安装状态**

查询 CLI 安装状态

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| runtimes | Array<RuntimeView> | 是 |  | — |


### actonruntime

**POST /api/runtimes/{id}/actions — 检查、检测、安装、更新、卸载或取消 CLI 操作**

202 后轮询 /api/runtimes 查看 operation/progress/error。安装完成不会自动启用 Agent。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | enum=["pi","opencode","codex","grok"] | Agent ID。 |

请求体：必填，Content-Type: application/json；类型：object。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| action | string | 是 | enum=["check","detect","install","update","uninstall","cancel"] | — |


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 202 | application/json | object | 已受理；通过查询接口确认最终结果。 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| runtime | RuntimeView | 是 |  | — |


### bindruntimesource

**PUT /api/runtimes/{id}/source — 绑定托管或外部 CLI**

绑定托管或外部 CLI

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | enum=["pi","opencode","codex","grok"] | Agent ID。 |

请求体：必填，Content-Type: application/json；类型：object。
mode=external 时 command 必填；mode=managed 使用受管安装。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| mode | string | 是 | enum=["managed","external"] | — |
| command | string | 否 | minLength=1；maxLength=4096 | — |

请求示例：


```json
{
  "mode": "external",
  "command": "/usr/local/bin/pi"
}
```


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 202 | application/json | object | 已受理；通过查询接口确认最终结果。 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| runtime | RuntimeView | 是 |  | — |


## 系统

### liveness

**GET /health/live — 检查进程存活**

检查进程存活

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| ok | boolean | 是 | const=true | — |
| instanceId | string | 是 |  | — |


### readiness

**GET /health/ready — 检查服务就绪**

存储健康且至少一个 Agent ready 时返回 200，否则 503。engine 是默认 Agent 的健康状态。

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | object | 存储不健康或没有就绪的 Agent |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| ok | boolean | 是 |  | — |
| engine | EngineHealth | 是 |  | — |


### getruntimeinfo

**GET /api/runtime — 读取引擎、模型与运行限制**

读取引擎、模型与运行限制

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | RuntimeInfo | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### getsystem

**GET /api/system — 读取系统信息**

读取系统信息

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | SystemView | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### getgatewaysettings

**GET /api/system/gateway — 读取监听配置**

读取监听配置

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | GatewayView | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 429 | application/json | Error | 请求或资源达到限制 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |


### savegatewaysettings

**PUT /api/system/gateway — 保存监听配置**

revision 原样使用 GET 返回值。保存后调用 lifecycle restart 生效；port=0 自动分配，0.0.0.0/:: 监听全部对应网卡。改址后按 url/urls 重连。

路径/查询/额外请求头参数：无。

请求体：必填，Content-Type: application/json；类型：object。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| revision | string | 是 | minLength=64；maxLength=64 | — |
| settings | GatewaySettings | 是 |  | — |

请求示例：


```json
{
  "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "settings": {
    "host": "127.0.0.1",
    "port": 6217
  }
}
```


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | GatewayView | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 429 | application/json | Error | 请求或资源达到限制 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |


### getnetworksettings

**GET /api/system/network — 读取网络配置**

读取网络配置

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | NetworkView | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 429 | application/json | Error | 请求或资源达到限制 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |


### savenetworksettings

**PUT /api/system/network — 保存网络配置**

完整 settings 与上一 GET 的 revision 必填。保存后重启生效；proxyPassword 省略保留、空字符串清除。

路径/查询/额外请求头参数：无。

请求体：必填，Content-Type: application/json；类型：object。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| revision | string | 是 | minLength=64；maxLength=64 | — |
| settings | NetworkInput | 是 |  | — |


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | NetworkView | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 429 | application/json | Error | 请求或资源达到限制 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |


### testnetwork

**POST /api/system/network/test — 测试网络连接**

使用草稿 settings 测试，不保存。url 必须为不含凭据的 HTTP(S) 地址；返回目标 HTTP 状态和耗时（毫秒）。

路径/查询/额外请求头参数：无。

请求体：必填，Content-Type: application/json；类型：object。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| settings | NetworkInput | 是 |  | — |
| url | string | 是 | format="uri"；maxLength=4096 | — |


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 429 | application/json | Error | 请求或资源达到限制 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| status | integer | 是 |  | — |
| durationMs | number | 是 |  | — |
| scope | string | 是 | const="gateway" | — |


### changelifecycle

**POST /api/system/lifecycle — 重启或关闭网关**

wait 等待已有任务完成；stop 停止任务。202 后连接将断开，重启时等待新地址 /health/live。影响整个网关；结束单个会话使用会话 abort/delete。

路径/查询/额外请求头参数：无。

请求体：必填，Content-Type: application/json；类型：object。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| action | string | 是 | enum=["restart","shutdown"] | — |
| mode | string | 是 | enum=["wait","stop"] | — |

请求示例：


```json
{
  "action": "restart",
  "mode": "wait"
}
```


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 202 | application/json | object | 已受理；通过查询接口确认最终结果。 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 409 | application/json | Error | 修订/操作冲突、过期回复、执行取消；检查当前状态后重试 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 429 | application/json | Error | 请求或资源达到限制 |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |
| 504 | application/json | Error | 执行或系统操作超时 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| accepted | boolean | 是 | const=true | — |


### listdirectories

**GET /api/system/directories — 浏览工作目录**

只返回可见目录；最多 500 条、最多扫描 5000 个子项，达到上限时 truncated=true。parent 为 null 表示不能再向上浏览。

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| directory | query | string | 否 | maxLength=4096 | 主机绝对路径；省略列出允许的根目录。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | DirectoryView | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### uploadcertificate

**POST /api/system/certificates — 保存 PEM CA 证书**

pem 为有效的 CA 证书，最多 2 MiB；本接口 JSON 请求体上限 3 MiB。返回网关主机上的保存路径，可用于 caFile。

路径/查询/额外请求头参数：无。

请求体：必填，Content-Type: application/json；类型：object。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| pem | string | 是 | minLength=1；maxLength=2097152 | — |


| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 413 | application/json | Error | JSON 请求体超过大小限制（默认 1 MiB） |
| 415 | application/json | Error | 不支持的请求 Content-Type |
| 500 | application/json | Error | 内部操作失败 |
| 503 | application/json | Error | Agent/服务未就绪、维护中或连接已达上限 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| path | string | 是 |  | — |


## 观测

### getoverview

**GET /api/observability/overview — 查询执行与资源汇总**

查询执行与资源汇总

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| from | query | string | 否 | format="date-time" | 起始 UTC 时间（含边界）；省略为当前时间减 1 小时。 |
| to | query | string | 否 | format="date-time" | 结束 UTC 时间（含边界）；省略为当前时间。from ≤ to，跨度最多 7 天。 |
| engine | query | string | 否 | maxLength=100；pattern="^[a-zA-Z0-9_-]*$"；default="" | 按 Agent ID 筛选；空字符串表示全部。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Overview | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### getseries

**GET /api/observability/series — 查询时序指标**

查询时序指标

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| from | query | string | 否 | format="date-time" | 起始 UTC 时间（含边界）；省略为当前时间减 1 小时。 |
| to | query | string | 否 | format="date-time" | 结束 UTC 时间（含边界）；省略为当前时间。from ≤ to，跨度最多 7 天。 |
| engine | query | string | 否 | maxLength=100；pattern="^[a-zA-Z0-9_-]*$"；default="" | 按 Agent ID 筛选；空字符串表示全部。 |
| metric | query | string | 是 | enum=["rssBytes","heapBytes","activeRuns","queueDepth","completed","failed"] | 指标名称。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | Series | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### listerrors

**GET /api/observability/errors — 查询错误与警告日志**

查询错误与警告日志

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| from | query | string | 否 | format="date-time" | 起始 UTC 时间（含边界）；省略为当前时间减 1 小时。 |
| to | query | string | 否 | format="date-time" | 结束 UTC 时间（含边界）；省略为当前时间。from ≤ to，跨度最多 7 天。 |
| engine | query | string | 否 | maxLength=100；pattern="^[a-zA-Z0-9_-]*$"；default="" | 按 Agent ID 筛选；空字符串表示全部。 |
| stage | query | string | 否 | default="" | 阶段，空字符串表示全部。 |
| code | query | string | 否 | default="" | 错误码，空字符串表示全部。 |
| limit | query | integer | 否 | minimum=1；maximum=100；default=50 | 最多返回条数；按日志 ID 降序。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| items | Array<RuntimeLog> | 是 |  | — |
| from | string | 是 | format="date-time" | — |
| to | string | 是 | format="date-time" | — |


### getrundiagnostics

**GET /api/observability/runs/{id} — 读取单轮诊断**

读取单轮诊断

| 参数 | 位置 | 类型 | 必填 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- | --- |
| id | path | string | 是 | minLength=1；maxLength=300 | 资源 ID；使用创建/列表接口返回的值。 |

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 404 | application/json | Error | 资源不存在 |
| 500 | application/json | Error | 内部操作失败 |


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| run | Run | 是 |  | — |
| logs | Array<RuntimeLog> | 是 |  | — |
| spans | Array<object> | 是 |  | — |
| spans[].name | string | 是 |  | — |
| spans[].startedAt | string \| null | 是 | format="date-time" | — |
| spans[].finishedAt | string \| null | 是 | format="date-time" | — |
| spans[].state | string | 否 |  | — |
| coverage | string | 是 | const="gateway-and-observed-tools" | — |


### getmetrics

**GET /metrics — 读取 Prometheus 指标**

读取 Prometheus 指标

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | text/plain | string | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


## 文档

### getapimarkdown

**GET /api/docs.md — 下载完整 Markdown API 文档（供 Agent 使用）**

包含全部接口、参数/响应字段、必填、约束、错误码、示例与完整会话流程；与网页使用同一份 OpenAPI 定义。

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | text/markdown | string | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### getapidocs

**GET /api/docs — 打开 API 文档**

打开 API 文档

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | text/html | string | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### getopenapi

**GET /api/openapi.json — 下载 OpenAPI 3.1 定义**

下载 OpenAPI 3.1 定义

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | application/json | object | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


### getevaluationexample

**GET /api/examples/evaluate.mjs — 下载自动会话验证脚本**

Node.js >=22.21，无第三方依赖。node evaluate.mjs --url http://127.0.0.1:6217 --directory /absolute/workspace --prompt '只回复 OK'；脚本使用 auto 交互策略。

路径/查询/额外请求头参数：无。

请求体：无。

| HTTP 状态码 | Content-Type | 响应类型 | 说明 |
| --- | --- | --- | --- |
| 200 | text/plain | string | 成功 |
| 400 | application/json | Error | 请求格式、字段、参数或业务约束无效 |
| 403 | application/json | Error | Host/Origin 或路径、模型等访问约束不允许 |
| 500 | application/json | Error | 内部操作失败 |


## 数据模型

必返/必填针对当前对象。oneOf/anyOf 表示分支；Array<T> 为 T 数组；任意 JSON 仅用于原生工具输入等不固定结构。错误响应统一为 Error，code 的示例不穷尽所有业务错误码。

### Error




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| code | string | 是 |  | 稳定的机器可读错误码。 |
| message | string | 是 |  | 错误说明；不包含密钥。 |


### Failure




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| code | string | 是 |  | — |
| message | string | 是 |  | — |
| stage | string | 是 |  | 失败阶段，例如 gateway、engine。 |


### Ok




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| ok | boolean | 是 | const=true | — |


### Model




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| providerID | string | 是 | minLength=1；maxLength=200 | — |
| modelID | string | 是 | minLength=1；maxLength=300 | — |


### InteractionPolicy

permission/question 分别控制审批与问题：manual 等待客户端回复；auto 自动处理。创建后固定，省略则继承 Agent 已应用配置（初值均为 auto）。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| permission | string | 是 | enum=["auto","manual"] | — |
| question | string | 是 | enum=["auto","manual"] | — |


### CreateSession




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| engineId | string | 否 | enum=["pi","opencode","codex","grok"] | 所用 Agent；省略使用当前默认 Agent。Agent 必须已启用且就绪，会话创建后不可更换。 |
| directory | string | 是 | minLength=1；maxLength=4096 | 网关主机上已存在、可访问且符合目录白名单的绝对路径；不是客户端本机路径。 |
| title | string | 否 | maxLength=200 | 会话标题。省略或空白时由首条消息生成（合并空白，截取前 80 字符）。 |
| interactionPolicy | object | 否 | additionalProperties=false | 创建后固定。省略继承 Agent 已应用策略；manual 需要客户端通过审批/问题接口回复。 |
| interactionPolicy.permission | string | 是 | enum=["auto","manual"] | — |
| interactionPolicy.question | string | 是 | enum=["auto","manual"] | — |


### Prompt




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| parts | Array<object> | 是 | minItems=1；maxItems=16 | 1–16 个文本片段，不能全部为空白；以换行连接后的 UTF-8 总长度不超过 131072 字节（128 KiB）。请求字段为 text，响应文本字段为 content。 |
| parts[].type | string | 是 | const="text" | — |
| parts[].text | string | 是 | minLength=1；maxLength=131072 | — |
| model | object | 否 | additionalProperties=false | 省略时继承会话模型或 Agent 默认模型。显式模型必须属于当前 Agent；不会静默替换。 |
| model.providerID | string | 是 | minLength=1；maxLength=200 | — |
| model.modelID | string | 是 | minLength=1；maxLength=300 | — |
| agent | string | 否 | const="assistant" | 助手角色，仅支持 assistant；不是 Agent/引擎 ID。 |


### CreateTask




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| engineId | string | 否 | enum=["pi","opencode","codex","grok"] | 所用 Agent；省略使用当前默认 Agent。Agent 必须已启用且就绪，会话创建后不可更换。 |
| directory | string | 是 | minLength=1；maxLength=4096 | 网关主机上已存在、可访问且符合目录白名单的绝对路径；不是客户端本机路径。 |
| title | string | 否 | maxLength=200 | 会话标题。省略或空白时由首条消息生成（合并空白，截取前 80 字符）。 |
| interactionPolicy | object | 否 | additionalProperties=false | 创建后固定。省略继承 Agent 已应用策略；manual 需要客户端通过审批/问题接口回复。 |
| interactionPolicy.permission | string | 是 | enum=["auto","manual"] | — |
| interactionPolicy.question | string | 是 | enum=["auto","manual"] | — |
| parts | Array<object> | 是 | minItems=1；maxItems=16 | 1–16 个文本片段，不能全部为空白；以换行连接后的 UTF-8 总长度不超过 131072 字节（128 KiB）。请求字段为 text，响应文本字段为 content。 |
| parts[].type | string | 是 | const="text" | — |
| parts[].text | string | 是 | minLength=1；maxLength=131072 | — |
| model | object | 否 | additionalProperties=false | 省略时继承会话模型或 Agent 默认模型。显式模型必须属于当前 Agent；不会静默替换。 |
| model.providerID | string | 是 | minLength=1；maxLength=200 | — |
| model.modelID | string | 是 | minLength=1；maxLength=300 | — |
| agent | string | 否 | const="assistant" | 助手角色，仅支持 assistant；不是 Agent/引擎 ID。 |
| submissionId | string | 是 | pattern="^[a-zA-Z0-9_-]{1,128}$" | 幂等键：1–128 个字母、数字、下划线或短横线。同操作/目标、同键同请求返回原结果；不同请求返回 409。每次新执行使用新键。 |


### SubmitRun




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| parts | Array<object> | 是 | minItems=1；maxItems=16 | 1–16 个文本片段，不能全部为空白；以换行连接后的 UTF-8 总长度不超过 131072 字节（128 KiB）。请求字段为 text，响应文本字段为 content。 |
| parts[].type | string | 是 | const="text" | — |
| parts[].text | string | 是 | minLength=1；maxLength=131072 | — |
| model | object | 否 | additionalProperties=false | 省略时继承会话模型或 Agent 默认模型。显式模型必须属于当前 Agent；不会静默替换。 |
| model.providerID | string | 是 | minLength=1；maxLength=200 | — |
| model.modelID | string | 是 | minLength=1；maxLength=300 | — |
| agent | string | 否 | const="assistant" | 助手角色，仅支持 assistant；不是 Agent/引擎 ID。 |
| submissionId | string | 是 | pattern="^[a-zA-Z0-9_-]{1,128}$" | 幂等键：1–128 个字母、数字、下划线或短横线。同操作/目标、同键同请求返回原结果；不同请求返回 409。每次新执行使用新键。 |


### PermissionReply

once 单次批准、always 按原生引擎作用范围批准、reject 拒绝；重复或过期回复返回 409。message 可选，最长 10000 字符。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| reply | string | 是 | enum=["once","always","reject"] | — |
| message | string | 否 | maxLength=10000 | — |


### QuestionReply

answers 按 questions 顺序逐题回答，每题对应字符串数组；选项回答用 label。multiple=false 仅允许一项，allowCustom=false 不允许选项外文本。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| answers | Array<Array<string>> | 是 | maxItems=100；数组元素：maxItems=100；数组元素：maxLength=10000 | — |


### SettingsInput

整份替换，不是 PATCH。资源 ID 必须唯一，四个 Agent 各出现一次，引用必须存在；启用 Agent 需要可用默认模型。密钥传回 ******** 保留旧值，空字符串清除。保存后通过 Agent apply 生效。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| schemaVersion | number | 否 | default=1；const=1 | — |
| defaultAgent | string | 否 | default="pi"；enum=["pi","opencode","codex","grok"] | — |
| runTimeoutMs | integer | 否 | minimum=60000；maximum=86400000 | — |
| agents | Array<object> | 否 | default=[{"id":"pi","enabled":false,"runtime":{"mode":"managed"},"models":[],"defaultModel":null,"contextCompaction":"default","skillIds":[],"mcpIds":[],"interactionPolicy":{"permission":"auto","question":"auto"}},{"id":"opencode","enabled":false,"runtime":{"mode":"managed"},"models":[],"defaultModel":null,"contextCompaction":"default","skillIds":[],"mcpIds":[],"interactionPolicy":{"permission":"auto","question":"auto"}},{"id":"codex","enabled":false,"runtime":{"mode":"managed"},"models":[],"defaultModel":null,"contextCompaction":"default","skillIds":[],"mcpIds":[],"interactionPolicy":{"permission":"auto","question":"auto"}},{"id":"grok","enabled":false,"runtime":{"mode":"managed"},"models":[],"defaultModel":null,"contextCompaction":"default","skillIds":[],"mcpIds":[],"interactionPolicy":{"permission":"auto","question":"auto"}}]；minItems=4；maxItems=4 | — |
| agents[].id | string | 是 | enum=["pi","opencode","codex","grok"] | — |
| agents[].enabled | boolean | 否 | default=false | — |
| agents[].runtime | object | 是 | additionalProperties=false | — |
| agents[].runtime.mode | string | 是 | enum=["managed","external"] | — |
| agents[].runtime.command | string | 否 | minLength=1；maxLength=4096 | — |
| agents[].models | Array<object> | 否 | default=[]；maxItems=200 | — |
| agents[].models[].providerID | string | 是 | minLength=1；maxLength=100 | — |
| agents[].models[].modelID | string | 是 | minLength=1；maxLength=300 | — |
| agents[].defaultModel | object \| null | 否 | default=null；additionalProperties=false | — |
| agents[].defaultModel.分支1.providerID | string | 是 | minLength=1；maxLength=100 | — |
| agents[].defaultModel.分支1.modelID | string | 是 | minLength=1；maxLength=300 | — |
| agents[].contextCompaction | string | 否 | default="default"；enum=["default","enabled"] | — |
| agents[].skillIds | Array<string> | 否 | default=[]；maxItems=200 | — |
| agents[].mcpIds | Array<string> | 否 | default=[]；maxItems=100 | — |
| agents[].interactionPolicy | object | 否 | default={"permission":"auto","question":"auto"}；additionalProperties=false | — |
| agents[].interactionPolicy.permission | string | 是 | enum=["auto","manual"] | — |
| agents[].interactionPolicy.question | string | 是 | enum=["auto","manual"] | — |
| providers | Array<object> | 否 | default=[]；maxItems=50 | — |
| providers[].id | string | 是 | minLength=1；maxLength=100；pattern="^[a-zA-Z0-9_-]+$" | — |
| providers[].baseUrl | string | 是 | format="uri" | — |
| providers[].apiKey | string | 否 | default=""；maxLength=8192 | — |
| providers[].api | string | 否 | default="openai-completions"；enum=["openai-completions","openai-responses"] | — |
| providers[].models | Array<object> | 是 | minItems=1；maxItems=100 | — |
| providers[].models[].id | string | 是 | minLength=1；maxLength=200 | — |
| providers[].models[].name | string | 否 | default=""；maxLength=200 | — |
| providers[].models[].thinking | string | 否 | default="default"；enum=["default","off"] | — |
| providers[].models[].contextWindow | integer | 否 | default=128000；minimum=1024；maximum=10000000 | — |
| providers[].models[].maxTokens | integer | 否 | default=16384；minimum=1；maximum=1000000 | — |
| providers[].enabled | boolean | 否 | default=true | — |
| skills | Array<object> | 否 | default=[]；maxItems=200 | — |
| skills[].id | string | 是 | minLength=1；maxLength=100；pattern="^[a-zA-Z0-9_-]+$" | — |
| skills[].path | string | 是 | minLength=1；maxLength=4096 | — |
| skills[].enabled | boolean | 否 | default=true | — |
| mcp | Array<object> | 否 | default=[]；maxItems=100 | — |
| mcp[].id | string | 是 | minLength=1；maxLength=100；pattern="^[a-zA-Z0-9_-]+$" | — |
| mcp[].enabled | boolean | 否 | default=true | — |
| mcp[].config | object \| object | 是 | additionalProperties=false；additionalProperties=false | — |
| mcp[].config.分支1.type | string | 是 | const="local" | — |
| mcp[].config.分支1.command | Array<string> | 是 | minItems=1；maxItems=100；数组元素：minLength=1；maxLength=4096 | — |
| mcp[].config.分支1.environment | Record<string, string> | 否 | default={}；propertyNames={"type":"string","minLength":1,"maxLength":100,"pattern":"^[a-zA-Z0-9_-]+$"}；additionalProperties={"type":"string","maxLength":8192} | — |
| mcp[].config.分支2.type | string | 是 | const="remote" | — |
| mcp[].config.分支2.url | string | 是 | format="uri" | — |
| mcp[].config.分支2.headers | Record<string, string> | 否 | default={}；propertyNames={"type":"string","minLength":1,"maxLength":200}；additionalProperties={"type":"string","maxLength":8192} | — |


### Settings

已应用默认值的保存配置；API Key、MCP environment/headers 中非空密钥以 ******** 掩码返回。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| schemaVersion | number | 是 | default=1；const=1 | — |
| defaultAgent | string | 是 | default="pi"；enum=["pi","opencode","codex","grok"] | — |
| runTimeoutMs | integer | 否 | minimum=60000；maximum=86400000 | — |
| agents | Array<object> | 是 | default=[{"id":"pi","enabled":false,"runtime":{"mode":"managed"},"models":[],"defaultModel":null,"contextCompaction":"default","skillIds":[],"mcpIds":[],"interactionPolicy":{"permission":"auto","question":"auto"}},{"id":"opencode","enabled":false,"runtime":{"mode":"managed"},"models":[],"defaultModel":null,"contextCompaction":"default","skillIds":[],"mcpIds":[],"interactionPolicy":{"permission":"auto","question":"auto"}},{"id":"codex","enabled":false,"runtime":{"mode":"managed"},"models":[],"defaultModel":null,"contextCompaction":"default","skillIds":[],"mcpIds":[],"interactionPolicy":{"permission":"auto","question":"auto"}},{"id":"grok","enabled":false,"runtime":{"mode":"managed"},"models":[],"defaultModel":null,"contextCompaction":"default","skillIds":[],"mcpIds":[],"interactionPolicy":{"permission":"auto","question":"auto"}}]；minItems=4；maxItems=4 | — |
| agents[].id | string | 是 | enum=["pi","opencode","codex","grok"] | — |
| agents[].enabled | boolean | 是 | default=false | — |
| agents[].runtime | object | 是 | additionalProperties=false | — |
| agents[].runtime.mode | string | 是 | enum=["managed","external"] | — |
| agents[].runtime.command | string | 否 | minLength=1；maxLength=4096 | — |
| agents[].models | Array<object> | 是 | default=[]；maxItems=200 | — |
| agents[].models[].providerID | string | 是 | minLength=1；maxLength=100 | — |
| agents[].models[].modelID | string | 是 | minLength=1；maxLength=300 | — |
| agents[].defaultModel | object \| null | 是 | default=null；additionalProperties=false | — |
| agents[].defaultModel.分支1.providerID | string | 是 | minLength=1；maxLength=100 | — |
| agents[].defaultModel.分支1.modelID | string | 是 | minLength=1；maxLength=300 | — |
| agents[].contextCompaction | string | 是 | default="default"；enum=["default","enabled"] | — |
| agents[].skillIds | Array<string> | 是 | default=[]；maxItems=200 | — |
| agents[].mcpIds | Array<string> | 是 | default=[]；maxItems=100 | — |
| agents[].interactionPolicy | object | 是 | default={"permission":"auto","question":"auto"}；additionalProperties=false | — |
| agents[].interactionPolicy.permission | string | 是 | enum=["auto","manual"] | — |
| agents[].interactionPolicy.question | string | 是 | enum=["auto","manual"] | — |
| providers | Array<object> | 是 | default=[]；maxItems=50 | — |
| providers[].id | string | 是 | minLength=1；maxLength=100；pattern="^[a-zA-Z0-9_-]+$" | — |
| providers[].baseUrl | string | 是 | format="uri" | — |
| providers[].apiKey | string | 是 | default=""；maxLength=8192 | — |
| providers[].api | string | 是 | default="openai-completions"；enum=["openai-completions","openai-responses"] | — |
| providers[].models | Array<object> | 是 | minItems=1；maxItems=100 | — |
| providers[].models[].id | string | 是 | minLength=1；maxLength=200 | — |
| providers[].models[].name | string | 是 | default=""；maxLength=200 | — |
| providers[].models[].thinking | string | 是 | default="default"；enum=["default","off"] | — |
| providers[].models[].contextWindow | integer | 是 | default=128000；minimum=1024；maximum=10000000 | — |
| providers[].models[].maxTokens | integer | 是 | default=16384；minimum=1；maximum=1000000 | — |
| providers[].enabled | boolean | 是 | default=true | — |
| skills | Array<object> | 是 | default=[]；maxItems=200 | — |
| skills[].id | string | 是 | minLength=1；maxLength=100；pattern="^[a-zA-Z0-9_-]+$" | — |
| skills[].path | string | 是 | minLength=1；maxLength=4096 | — |
| skills[].enabled | boolean | 是 | default=true | — |
| mcp | Array<object> | 是 | default=[]；maxItems=100 | — |
| mcp[].id | string | 是 | minLength=1；maxLength=100；pattern="^[a-zA-Z0-9_-]+$" | — |
| mcp[].enabled | boolean | 是 | default=true | — |
| mcp[].config | object \| object | 是 | additionalProperties=false；additionalProperties=false | — |
| mcp[].config.分支1.type | string | 是 | const="local" | — |
| mcp[].config.分支1.command | Array<string> | 是 | minItems=1；maxItems=100；数组元素：minLength=1；maxLength=4096 | — |
| mcp[].config.分支1.environment | Record<string, string> | 是 | default={}；propertyNames={"type":"string","minLength":1,"maxLength":100,"pattern":"^[a-zA-Z0-9_-]+$"}；additionalProperties={"type":"string","maxLength":8192} | — |
| mcp[].config.分支2.type | string | 是 | const="remote" | — |
| mcp[].config.分支2.url | string | 是 | format="uri" | — |
| mcp[].config.分支2.headers | Record<string, string> | 是 | default={}；propertyNames={"type":"string","minLength":1,"maxLength":200}；additionalProperties={"type":"string","maxLength":8192} | — |


### NetworkInput




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| npmRegistry | string | 否 | default="https://registry.npmjs.org/"；maxLength=2048 | — |
| mode | string | 是 | enum=["environment","direct","manual"] | — |
| proxyUrl | string | 是 | maxLength=2048 | — |
| proxyUsername | string | 是 | maxLength=512 | — |
| noProxy | string | 是 | maxLength=4096 | — |
| useSystemCa | boolean | 是 |  | — |
| caFile | string | 是 | maxLength=4096 | — |
| proxyPassword | string | 否 | maxLength=4096 | 省略保留现有密码，空字符串清除；响应不回显。 |


### NetworkSettings




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| npmRegistry | string | 是 | default="https://registry.npmjs.org/"；maxLength=2048 | — |
| mode | string | 是 | enum=["environment","direct","manual"] | — |
| proxyUrl | string | 是 | maxLength=2048 | — |
| proxyUsername | string | 是 | maxLength=512 | — |
| noProxy | string | 是 | maxLength=4096 | — |
| useSystemCa | boolean | 是 |  | — |
| caFile | string | 是 | maxLength=4096 | — |


### GatewaySettings




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| host | string \| string \| string | 是 | format="ipv4"；pattern="^(?:(?:25[0-5]\|2[0-4][0-9]\|1[0-9][0-9]\|[1-9][0-9]\|[0-9])\\.){3}(?:25[0-5]\|2[0-4][0-9]\|1[0-9][0-9]\|[1-9][0-9]\|[0-9])$"；format="ipv6"；pattern="^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\|([0-9a-fA-F]{1,4}:){1,7}:\|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}\|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}\|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}\|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}\|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}\|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})\|:((:[0-9a-fA-F]{1,4}){1,7}\|:))$"；const="localhost" | — |
| port | integer | 是 | minimum=0；maximum=65535 | — |


### Usage

Token 用量与美元费用；null 表示未报告，不能当作 0。


| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| input | number \| null | 是 |  | — |
| output | number \| null | 是 |  | — |
| cacheRead | number \| null | 是 |  | — |
| cacheWrite | number \| null | 是 |  | — |
| costUsd | number \| null | 是 |  | — |
| source | string | 是 | enum=["reported","estimated"] | — |


### Snapshot




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| storeId | string | 是 |  | — |
| instanceId | string | 是 |  | — |
| revision | integer | 是 |  | — |
| cursor | string | 是 |  | — |
| capturedAt | string | 是 | format="date-time" | — |


### AcceptedRun




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| submissionId | string | 是 |  | — |
| taskId | string | 是 |  | 与 sessionId 相同。 |
| sessionId | string | 是 |  | — |
| runId | string | 是 |  | — |
| acceptedAt | string | 是 | format="date-time" | — |


### Run




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| sessionId | string | 是 |  | — |
| submissionId | string | 是 |  | — |
| sequence | integer | 是 |  | — |
| inputParts | Array<object> | 是 | minItems=1；maxItems=16 | — |
| inputParts[].type | string | 是 | const="text" | — |
| inputParts[].text | string | 是 | minLength=1；maxLength=131072 | — |
| model | Model \| null | 是 |  | — |
| state | string | 是 | enum=["queued","running","stopping","completed","failed","timed_out","cancelled"] | queued/running/stopping 为非终态；completed/failed/timed_out/cancelled 为终态，仅 completed 表示成功。 |
| acceptedAt | string | 是 | format="date-time" | — |
| deadlineAt | string | 是 | format="date-time" | 提交时保存的绝对截止时间，包含排队和人工等待；修改系统时限不改变已提交执行。Agent 确认成功后的产物登记单独计时。 |
| startedAt | string \| null | 是 | format="date-time" | — |
| finishedAt | string \| null | 是 | format="date-time" | — |
| stopReason | string \| null | 是 | enum=["user","timeout","deletion","shutdown"] | — |
| error | Failure \| null | 是 |  | — |
| usage | Usage \| null | 是 |  | — |
| traceId | string | 是 |  | — |
| configRevision | string \| null | 是 |  | — |
| runtimeVersion | string \| null | 否 |  | — |


### TextPart




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| type | string | 是 | const="text" | — |
| content | string | 是 |  | — |


### ReasoningPart




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| type | string | 是 | const="reasoning" | — |
| content | string | 是 |  | — |


### ToolPart




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| type | string | 是 | const="tool" | — |
| toolCallId | string | 是 |  | — |
| tool | string | 是 |  | — |
| input | 任意 JSON | 是 |  | 工具原生输入，JSON 任意值。 |
| output | string | 是 |  | — |
| state | object | 是 |  | — |
| state.title | string | 是 |  | — |
| state.status | string | 是 | enum=["pending","running","completed","failed","cancelled","interrupted"] | — |
| startedAt | string \| null | 是 | format="date-time" | — |
| finishedAt | string \| null | 是 | format="date-time" | — |


### StepPart




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| type | string | 是 | const="step-finish" | — |
| reason | string | 是 |  | — |
| usage | Usage \| null | 是 |  | — |


### MessagePart



分支类型：TextPart | ReasoningPart | ToolPart | StepPart。

### Message




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| sessionId | string | 是 |  | — |
| runId | string | 是 |  | — |
| role | string | 是 | enum=["user","assistant"] | — |
| created_at | string | 是 | format="date-time" | — |
| completedAt | string \| null | 是 | format="date-time" | — |
| info | object | 是 |  | — |
| info.finish | string \| null | 是 |  | 最终助手回复为 stop；tool-calls 不表示本轮结束。 |
| parts | Array<MessagePart> | 是 |  | — |


### Question




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| question | string | 是 |  | — |
| options | Array<object> | 是 |  | — |
| options[].label | string | 是 |  | — |
| options[].description | string | 是 |  | — |
| multiple | boolean | 是 |  | — |
| allowCustom | boolean | 是 |  | — |


### Interaction




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| sessionID | string | 是 |  | 所属会话 ID；注意此处为大写 ID。 |
| runId | string | 是 |  | — |
| kind | string | 是 | enum=["permission","question"] | — |
| title | string | 是 |  | — |
| questions | Array<Question> | 是 |  | — |
| permission | string | 是 |  | — |
| patterns | Array<string> | 是 |  | — |
| state | string | 是 | enum=["pending","replying","resolved","expired"] | — |
| policy | string | 是 | enum=["auto","manual"] | — |
| created_at | string | 是 | format="date-time" | — |
| resolvedAt | string \| null | 是 | format="date-time" | — |
| reply | PermissionReply \| QuestionReply \| null | 是 |  | — |
| error | string \| null | 是 |  | — |


### Artifact




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| sessionId | string | 是 |  | — |
| runId | string | 是 |  | — |
| relativePath | string | 是 |  | — |
| displayName | string | 是 |  | — |
| mediaType | string | 是 |  | — |
| sizeBytes | integer | 是 |  | — |
| modifiedAt | string | 是 | format="date-time" | — |
| digest | string | 是 |  | 文件 SHA-256。 |
| registeredAt | string | 是 | format="date-time" | — |
| availability | string | 是 | enum=["available","missing","changed","unavailable"] | — |
| validation | string | 是 | enum=["not_checked","passed","failed"] | — |


### TaskSummary




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| title | string | 是 |  | — |
| titleSource | string | 是 | enum=["user","generated"] | — |
| directory | string | 是 |  | — |
| engineId | string | 是 |  | — |
| interactionPolicy | InteractionPolicy | 是 |  | — |
| availability | string | 是 | enum=["ready","unavailable","deleting"] | — |
| createdAt | string | 是 | format="date-time" | — |
| updatedAt | string | 是 | format="date-time" | — |
| version | integer | 是 |  | — |
| status | string | 是 | enum=["queued","running","stopping","completed","failed","timed_out","cancelled","not_started","waiting_input","unavailable","deleting"] | — |
| lastRun | Run \| null | 是 |  | — |
| queuedCount | integer | 是 |  | — |
| messageCount | integer | 是 |  | — |


### TaskDetail




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| task | TaskSummary | 是 |  | — |
| runs | Array<Run> | 是 |  | — |
| messages | Array<Message> | 是 |  | — |
| interactions | Array<Interaction> | 是 |  | — |
| artifacts | Array<Artifact> | 是 |  | — |


### SessionCreated




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| title | string | 是 |  | — |
| engineId | string | 是 |  | — |
| directory | string | 是 |  | — |
| interactionPolicy | InteractionPolicy | 是 |  | — |
| created_at | string | 是 | format="date-time" | — |
| status | string | 是 | const="idle" | — |


### SessionView




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| title | string | 是 |  | — |
| engineId | string | 是 |  | — |
| directory | string | 是 |  | — |
| interactionPolicy | InteractionPolicy | 是 |  | — |
| created_at | string | 是 | format="date-time" | — |
| status | string | 是 | enum=["busy","idle"] | — |
| message_count | integer | 是 |  | — |


### Submission




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 |  | — |
| operation | string | 是 | enum=["create","append"] | — |
| target | string | 是 |  | — |
| digest | string | 是 |  | — |
| status | string | 是 | enum=["processing","accepted","rejected","indeterminate","gone"] | — |
| result | AcceptedRun \| null | 是 |  | — |
| error | Failure \| null | 是 |  | — |
| createdAt | string | 是 | format="date-time" | — |


### EngineHealth




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| status | string | 是 | enum=["starting","ready","degraded","unavailable","stopping","disabled"] | — |
| version | string \| null | 是 |  | — |
| message | string \| null | 是 |  | — |
| processes | integer | 是 |  | — |
| restarts | integer | 是 |  | — |


### EngineCapabilities




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| permissions | boolean | 是 |  | — |
| questions | boolean | 是 |  | — |
| recovery | boolean | 是 |  | — |


### ModelOption




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| providerID | string | 是 |  | — |
| modelID | string | 是 |  | — |
| name | string | 是 |  | — |


### AgentView




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 | enum=["pi","opencode","codex","grok"] | — |
| enabled | boolean | 是 |  | — |
| health | EngineHealth | 是 |  | — |
| directory | string | 是 |  | — |
| configFile | string | 是 |  | — |
| savedRevision | string | 是 |  | — |
| appliedRevision | string \| null | 是 |  | — |
| pendingChanges | boolean | 是 |  | — |
| operation | string \| null | 是 | enum=["enable","disable","stop","apply"] | — |
| error | string \| null | 是 |  | — |
| activeRuns | integer | 是 |  | — |
| queuedRuns | integer | 是 |  | — |
| models | Array<ModelOption> | 是 |  | — |
| capabilities | EngineCapabilities | 是 |  | — |


### RuntimeView




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 是 | enum=["pi","opencode","codex","grok"] | — |
| managed | boolean | 是 |  | — |
| executable | string \| null | 是 |  | — |
| detection | string | 是 | enum=["unknown","checking","present","missing","failed"] | — |
| detectedAt | string \| null | 是 | format="date-time" | — |
| compatibility | string | 是 | enum=["unknown","compatible","incompatible"] | — |
| usable | boolean | 是 |  | — |
| platform | string | 是 |  | — |
| installedVersion | string \| null | 是 |  | — |
| managedVersion | string \| null | 是 |  | — |
| latestVersion | string \| null | 是 |  | — |
| runningVersion | string \| null | 是 |  | — |
| checkedAt | string \| null | 是 | format="date-time" | — |
| checkError | string \| null | 是 |  | — |
| status | string | 是 | enum=["not_installed","installed","installing","uninstalling","failed"] | — |
| updateStatus | string | 是 | enum=["idle","checking","available","downloading","switching","failed"] | — |
| operation | string \| null | 是 | enum=["check","detect","install","update","uninstall","source"] | — |
| cancelable | boolean | 是 |  | — |
| progress | number \| null | 是 |  | — |
| downloadedBytes | number | 是 |  | — |
| totalBytes | number \| null | 是 |  | — |
| sizeBytes | number \| null | 是 |  | — |
| error | string \| null | 是 |  | — |
| source | string \| null | 是 |  | — |
| integrity | string \| null | 是 |  | — |


### RuntimeInfo




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| instanceId | string | 是 |  | — |
| storeId | string | 是 |  | — |
| engine | string | 是 |  | — |
| health | EngineHealth | 是 |  | — |
| engines | Array<object> | 是 |  | — |
| engines[].id | string | 是 |  | — |
| engines[].health | EngineHealth | 是 |  | — |
| engines[].enabled | boolean | 是 |  | — |
| engines[].defaultModel | Model \| null | 否 |  | — |
| engines[].interactionPolicy | InteractionPolicy | 否 |  | — |
| engines[].capabilities | EngineCapabilities | 是 |  | — |
| storage | string | 是 | enum=["sqlite","memory"] | — |
| models | Array<Model> | 是 |  | — |
| limits | Record<string, number> | 是 | additionalProperties={"type":"number"} | — |
| interactionDefaults | InteractionPolicy | 是 |  | — |
| capabilities | Record<string, boolean> | 是 | additionalProperties={"type":"boolean"} | — |


### SettingsView




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| settings | Settings | 是 |  | — |
| revision | string | 是 |  | — |
| dataDirectory | string | 是 |  | — |


### SystemView




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| storeId | string | 是 |  | — |
| version | string | 是 |  | — |
| nodeVersion | string | 是 |  | — |
| nodePath | string | 是 |  | — |
| npmPath | string \| null | 是 |  | — |
| capabilities | object | 是 |  | — |
| capabilities.gateway | boolean | 是 |  | — |
| capabilities.network | boolean | 是 |  | — |
| capabilities.restart | boolean | 是 |  | — |
| capabilities.directories | boolean | 是 |  | — |
| capabilities.certificates | boolean | 是 |  | — |
| maintenance | string | 是 | enum=["ready","draining","stopping"] | — |


### GatewayView




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| settings | GatewaySettings | 是 |  | — |
| appliedSettings | GatewaySettings | 是 |  | — |
| revision | string | 是 |  | — |
| appliedRevision | string | 是 |  | — |
| restartRequired | boolean | 是 |  | — |
| url | string \| null | 是 |  | — |
| urls | Array<string> | 是 |  | — |
| error | string \| null | 是 |  | — |


### NetworkView




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| settings | NetworkSettings | 是 |  | — |
| hasPassword | boolean | 是 |  | — |
| restartRequired | boolean | 是 |  | — |
| revision | string | 是 |  | — |
| appliedRevision | string | 是 |  | — |
| protection | string | 是 | enum=["os","file"] | — |
| error | string \| null | 是 |  | — |


### DirectoryView




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| directory | string \| null | 是 |  | — |
| parent | string \| null | 是 |  | — |
| entries | Array<object> | 是 |  | — |
| entries[].name | string | 是 |  | — |
| entries[].path | string | 是 |  | — |
| truncated | boolean | 是 |  | — |


### RuntimeLog




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| id | integer | 是 |  | — |
| occurredAt | string | 是 | format="date-time" | — |
| level | string | 是 |  | — |
| stage | string | 是 |  | — |
| code | string \| null | 是 |  | — |
| message | string | 是 |  | — |
| sessionId | string \| null | 是 |  | — |
| runId | string \| null | 是 |  | — |
| traceId | string \| null | 是 |  | — |


### Series




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| metric | string | 是 |  | — |
| unit | string | 是 | enum=["bytes","count"] | — |
| from | string | 是 | format="date-time" | — |
| to | string | 是 | format="date-time" | — |
| availableFrom | string \| null | 是 | format="date-time" | — |
| availableTo | string \| null | 是 | format="date-time" | — |
| points | Array<object> | 是 |  | — |
| points[].at | string | 是 | format="date-time" | — |
| points[].value | number | 是 |  | — |


### Overview




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| from | string | 是 | format="date-time" | — |
| to | string | 是 | format="date-time" | — |
| capturedAt | string | 是 | format="date-time" | — |
| instanceId | string | 是 |  | — |
| engine | string \| null | 是 |  | — |
| health | EngineHealth \| null | 是 |  | — |
| agents | Array<AgentView> | 是 |  | — |
| limits | Record<string, number> | 是 | additionalProperties={"type":"number"} | — |
| completed | integer | 是 |  | — |
| failed | integer | 是 |  | — |
| timedOut | integer | 是 |  | — |
| cancelled | integer | 是 |  | — |
| totalFinished | integer | 是 |  | — |
| accepted | integer | 是 |  | — |
| running | integer | 是 |  | — |
| queued | integer | 是 |  | — |
| successRate | number \| null | 是 |  | — |
| p50ExecutionMs | number \| null | 是 |  | — |
| p95ExecutionMs | number \| null | 是 |  | — |
| resource | object | 是 |  | — |
| resource.rss | number | 是 |  | — |
| resource.heapTotal | number | 是 |  | — |
| resource.heapUsed | number | 是 |  | — |
| resource.external | number | 是 |  | — |
| resource.arrayBuffers | number | 是 |  | — |
| resource.uptimeSeconds | number | 是 |  | — |
| resource.cpu | object | 是 |  | — |
| resource.cpu.user | number | 是 |  | — |
| resource.cpu.system | number | 是 |  | — |
| resource.eventLoop | object | 是 |  | — |
| resource.eventLoop.idle | number | 是 |  | — |
| resource.eventLoop.active | number | 是 |  | — |
| resource.eventLoop.utilization | number | 是 |  | — |
| resource.childProcessMemoryBytes | null | 是 |  | — |
| toolCalls | integer | 是 |  | — |
| toolErrors | integer | 是 |  | — |
| tools | Array<object> | 是 |  | — |
| tools[].name | string | 是 |  | — |
| tools[].calls | integer | 是 |  | — |
| tools[].failed | integer | 是 |  | — |
| usage | object | 是 |  | — |
| usage.reportedRuns | integer | 是 |  | — |
| usage.missingRuns | integer | 是 |  | — |
| usage.costUsd | number \| null | 是 |  | — |
| usage.input | number \| null | 是 |  | — |
| usage.output | number \| null | 是 |  | — |
| pendingInteractions | integer | 是 |  | — |
| http | object | 是 |  | — |
| http.requests | integer | 是 |  | — |
| http.errors4xx | integer | 是 |  | — |
| http.errors5xx | integer | 是 |  | — |
| http.scope | string | 是 | const="current-instance" | — |
| events | object | 是 |  | — |
| events.connections | integer | 是 |  | — |
| events.sentBytes | integer | 是 |  | — |
| events.droppedConnections | integer | 是 |  | — |
| events.retained | integer | 是 |  | — |
| events.oldestAt | string \| null | 是 | format="date-time" | — |
| storage | object | 是 |  | — |
| storage.healthy | boolean | 是 |  | — |
| storage.allocatedBytes | number | 是 |  | — |
| storage.sessions | integer | 是 |  | — |
| storage.runs | integer | 是 |  | — |
| unavailableSessions | integer | 是 |  | — |
| oldestQueuedAt | string \| null | 是 | format="date-time" | — |


### AppEvent




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| schemaVersion | integer | 是 | const=1 | — |
| eventId | string | 是 |  | — |
| revision | integer | 是 |  | — |
| instanceId | string | 是 |  | — |
| occurredAt | string | 是 | format="date-time" | — |
| type | string | 是 |  | — |
| sessionId | string | 否 |  | — |
| runId | string | 否 |  | — |
| properties | 任意 JSON | 是 |  | 由 type 决定；详见 /event 的事件表。 |


### ControlEvent




| 字段 | 类型 | 必填/必返 | 约束与默认值 | 说明 |
| --- | --- | --- | --- | --- |
| type | string | 是 | enum=["server.connected","server.heartbeat","server.resync_required"] | — |
| properties | object | 是 |  | — |
| properties.storeId | string | 是 |  | — |
| properties.instanceId | string | 是 |  | — |
| properties.revision | integer | 是 |  | — |
| properties.cursor | string | 是 |  | — |
| properties.capturedAt | string | 是 | format="date-time" | — |
| properties.heartbeatMs | integer | 是 | const=15000 | — |
