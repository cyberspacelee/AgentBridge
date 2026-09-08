# 接口与事件契约

网关只有一套消息、交互和事件契约，以 code/shared/contracts.ts 的 Zod 请求定义和共享类型为准。引擎适配器负责原生协议转换；HTTP、SSE、Web/Desktop 与评测直接使用共享对象。所有 schemaVersion 与数据库版本为 1，不兼容历史格式，不提供迁移。

## 1. 公共约定

- UTF-8 JSON；应用时间为 ISO 8601 UTC；字段与枚举遵循 [GLOSSARY](GLOSSARY.md)。
- 身份与允许访问范围在 HTTP 层处理，应用用例再次验证目标资源范围。默认单可信环境；浏览器仅访问本网关同源 API。
- 每个 HTTP 请求产生 requestId，并在响应 `X-Request-ID` 返回。`submissionId` 单独负责写入幂等，重试时不变。
- 未知字段、无效枚举、过长文本、非法路径和超限分页返回校验错误。原生引擎响应同样在适配器边界校验。
- 用户输入默认为纯文本 parts；不支持的图片、文件附件等输入显式拒绝，不能丢弃后继续运行。
- 默认模型可来自配置，但请求指定 model 时必须完整包含 providerID/modelID，无法支持就返回错误，不静默换模型。
- 接口只公开必要配置，不返回模型凭据、原生服务认证、任意环境变量或进程启动命令中的秘密。

应用输入限制初值：title 最多 200 个字符、parts 为 1..16 个 text 项、全部文本合计不超过 128KiB UTF-8、directory 最多 4096 个字符、submissionId 为 1..128 个字母/数字/下划线/连字符；单次 JSON body 上限 1MiB。directory 必须是网关主机上的绝对路径，创建前校验实际目录和配置允许范围。评测字段上限必须再次对照原文，不能自行缩小赛题合法输入范围。

## 2. 评测接口清单

| 方法与路径 | 已有需求 | HTTP 成功语义 |
| --- | --- | --- |
| POST `/session` | directory 必需，title 可选；创建原生会话后返回 `{id,title,created_at,status:"idle"}` | 200 |
| GET `/session/{id}` | 详情与 message_count | 当前快照 |
| DELETE `/session/{id}` | 取消执行、清理原生资源、删除记录 | `{ok:true}` 只在清理完成后返回 |
| GET `/session/status` | 所有会话的 `{sessionId:{type:"idle"|"busy"}}` | 运行状态投影，不是健康结果 |
| POST `/session/{id}/prompt_async` | parts、model、可选 agent:assistant；等待该 Run 终态 | completed 且最终快照已提交时返回无 body 的 204 |
| GET `/session/{id}/message` | 消息快照 | 正常完成时最后为 assistant，finish=stop，含 step-finish |
| POST `/session/{id}/abort` | 请求停止并等待确认 | 200 `{ok:true}`；取消活动执行与排队项 |
| POST `/session/{id}/stop` | abort 别名 | 使用同一用例 |
| GET `/event` | 全局 SSE，connected 与 15s 心跳 | 正确的 SSE 长连接 |
| GET `/permission` | 待处理权限 | 列表，可为空 |
| POST `/permission/{id}/reply` | once/always/reject | 已回复或明确冲突 |
| GET `/question` | 待处理问题 | 列表，可为空 |
| POST `/question/{id}/reply` | 每道问题对应答案 | 已回复或明确冲突 |

必须具备的事件类型：server.connected、server.heartbeat、session.status、session.idle、session.error、message.part.updated、question.asked、permission.asked。question/permission 在真实请求发生时发出；不能为了“全部必发”伪造用户交互。是否另需演示覆盖以赛题解释为准。

Message 使用顶层 id、sessionId、runId、role、created_at、completedAt、info.finish 和 parts。text 与 reasoning part 使用 content；reasoning 仅保留引擎明确返回的思考/摘要，不由正文猜测。SQLite type 列仍索引 text/tool/step 三个存储家族，reasoning 在 text 家族中保存完整 JSON discriminator，读取、HTTP 与 SSE 返回 reasoning；tool part 使用 tool、toolCallId、input、output、state.status/title 和时间；step-finish 使用 reason、usage。查询接口返回同一快照，SSE message.part.updated 的 properties 为 {sessionID,messageID,part}。只有最终 assistant 的 info.finish=stop 且包含 step-finish 才表示成功回复。

Interaction 直接使用 sessionID、created_at、permission/patterns、questions[].question、options[].label/description；回复为 {reply:once|always|reject,message?} 或 {answers:string[][]}。不接受 decision 等历史字段。默认交互策略统一来自 Agent 配置，初值 auto/auto；创建会话可显式覆盖。

Desktop 默认引擎来自 settings.defaultAgent；创建会话的 engineId 优先且会话创建后固定。独立命令行的 --engine 只覆盖本次进程默认值，不改写设置。默认端口 6217。标准评测请求应传入 model；网关所有提交入口额外支持省略 model 后继承本会话模型或所选 Agent 默认模型，未配置可用模型时失败，不静默更换显式指定模型。

## 3. 应用 API

以下应用契约作为完整版本设计；与评测接口共用领域用例，不互相发起内部 HTTP 调用。

| 方法与路径 | 请求或查询 | 返回与行为 |
| --- | --- | --- |
| GET `/api/agents` | 无 | 四个 Agent 的启用、健康、已保存/已应用配置修订、能力、活动数量 |
| POST `/api/agents/{id}/actions` | action: enable / disable / stop / apply | 202；按 Agent 排他执行、状态通过 agents.updated 和查询观察 |
| GET/PUT `/api/settings` | PUT: settings、revision | 读取脱敏配置；校验引用、乐观并发，保存不自动应用资源更改 |
| POST `/api/providers/{id}/test` | modelID | 对已保存连接发起一次受限模型请求 |
| POST `/api/agents/{id}/import` | file: 绝对路径 | 只读预览 providers、skills、mcp、warnings；不导入密钥 |
| GET `/api/runtime` | 无 | instanceId、storeId、engine、health、storage、models、limits、interactionDefaults、capabilities |
| GET `/api/tasks` | q、status、cursor、limit | TaskSummary 列表、nextCursor、snapshot 元数据 |
| POST `/api/tasks` | CreateTaskInput | 202 AcceptedRun；原生创建失败返回错误 |
| GET `/api/tasks/{id}` | 无 | TaskDetail：Run 概览、交互、产物索引、快照元数据 |
| POST `/api/tasks/{id}/runs` | SubmitRunInput | 202 AcceptedRun |
| GET `/api/tasks/{id}/runs` | cursor、limit | 按接收顺序查询轮次历史 |
| GET `/api/runs/{id}` | 无 | RunDetail 与该轮初始消息页 |
| GET `/api/runs/{id}/messages` | cursor、limit | 完整 Message 与 parts 的分页快照 |
| GET `/api/submissions/{id}` | operation、sessionId（按操作需要） | processing、accepted、rejected、indeterminate 及可公开结果 |
| GET `/event` | 可选 sessionId；Last-Event-ID | 全局或指定会话的应用事件 |
| GET `/api/artifacts/{id}` | 无 | 文件元数据、可用性、验证结果 |
| GET `/api/artifacts/{id}/content` | disposition=inline 或 attachment | 流式文件；inline 只允许受控文本 |
| GET `/api/observability/overview` | engine、from、to | agents: 所选范围各 Agent 的状态快照；health 仅在指定单个 Agent 时返回，否则为 null；配额、执行统计和异常提示 |
| GET `/api/observability/series` | metric、from、to、stepSeconds | 允许指标集合的时间序列、单位、实际覆盖范围 |
| GET `/api/observability/errors` | from、to、stage、code、cursor、limit | 可关联 Run 的近期异常 |
| GET `/api/observability/runs/{runId}` | 无 | 日志、可观察 spans、trace 完整性与保留状态 |
| GET `/health/live` | 无 | 网关存活，不调用模型 |
| GET `/health/ready` | 无 | 存储、初始化与引擎前提可用；未就绪为 503 |
| GET `/metrics` | 无 | Prometheus 文本格式 |

中止、删除和交互回复复用会话/交互控制用例与已有控制路由，前端直接使用共享请求类型。客户端不能直接依赖原生引擎 API。

### CreateTaskInput

```json
{
  "submissionId": "sub_client_generated_id",
  "title": "月度经营分析",
  "directory": "D:\\test_data\\reports",
  "parts": [{ "type": "text", "text": "分析目录中的工作簿并生成报告。" }],
  "model": { "providerID": "configured-provider", "modelID": "configured-model" },
  "interactionPolicy": { "permission": "auto", "question": "auto" }
}
```

title 可选；空白 title 由服务端生成普通任务标题。directory 与 parts 必需。engineId 缺省使用 defaultAgent。interactionPolicy 缺省使用 Agent 的已应用策略，允许请求覆盖 auto/manual；自动答案内容来自受控配置。

SubmitRunInput 包含 submissionId、parts、可选 model 与 agent；不得在追加轮次时改变 Session 的目录或引擎。

### AcceptedRun

```json
{
  "submissionId": "sub_client_generated_id",
  "taskId": "ses_opaque_id",
  "sessionId": "ses_opaque_id",
  "runId": "run_opaque_id",
  "acceptedAt": "2026-09-05T08:30:00.000Z"
}
```

接收返回值不携带“肯定仍在 queued”的承诺；极快任务可能在客户端收到 202 时已完成。acceptedResult 为幂等结果，当前状态通过 Run API 或事件查询。

同键同内容重试返回原接收结果；同键不同内容为 409。processing 可等待同一有界创建操作，超过 HTTP 等待预算时返回 409 CONFLICT，并携带 Retry-After 和指向 submission 查询的 Location；客户端查询 status 区分处理中与内容冲突，不能返回不含 runId 的假 AcceptedRun。indeterminate 不自动重新创建原生资源，客户端展示待核对并允许查看原因。

幂等窗口随 runtime.limits 公布，已有 Run 的接收记录保持保留；删除后的 tombstone 默认 7 天。在窗口之外可能已无记录，服务端不能证明这个键是否曾使用过，客户端须停止旧提交的自动重试并明确查询或发起新业务。相同 HTTP 请求的 requestId 不承担此保证。

### 快照与分页

```json
{
  "snapshot": {
    "storeId": "store_opaque_id",
    "instanceId": "instance_opaque_id",
    "revision": 42,
    "cursor": "store_opaque_id:108",
    "capturedAt": "2026-09-05T08:30:01.000Z"
  },
  "items": [],
  "nextCursor": null
}
```

TaskDetail 与 RunDetail 使用同一 snapshot 元数据，但携带 detail 而非 items。snapshot 的 revision/cursor 必须来自读取实体的同一数据库一致读事务。

分页默认 20、上限 100。历史列表按稳定的 createdAt/id 或 run sequence 排序，游标含排序锚点与查询条件摘要；改变筛选条件必须重置游标。任务实时状态改变可能导致筛选成员变化，前端使相关页面失效并重新读取，不把跨多个请求的分页假装成永久一致的历史时点。

## 4. 事件契约

领域事件持久化后直接通过 /event 推送；不存在评测 serializer 或第二份事件格式。

```json
{
  "schemaVersion": 1,
  "eventId": "store_opaque_id:109",
  "revision": 43,
  "instanceId": "instance_opaque_id",
  "occurredAt": "2026-09-05T08:30:02.000Z",
  "type": "message.part.updated",
  "sessionId": "ses_opaque_id",
  "runId": "run_opaque_id",
  "properties": {
    "sessionID": "ses_opaque_id",
    "messageID": "msg_opaque_id",
    "part": { "id": "part_opaque_id", "type": "text", "content": "正在读取工作簿。" }
  }
}
```

eventId 为 storeId 与持久化事件序号，逐事件递增；revision 为业务事务修订号，一次事务可产生多个事件并共用 revision。消费者按 eventId 去重，不能只按 revision 丢弃同一事务中的后续事件。

| 事件 | 含义与 payload |
| --- | --- |
| session.created / session.updated | 完整 TaskSummary 投影 |
| session.deleted | 已清理并删除的 sessionId；不携带旧消息正文 |
| run.accepted / run.updated / run.finished | 完整 RunSummary；finished 表示唯一终态 |
| message.updated | 完整消息 info |
| message.part.updated | 完整 part 快照；不发需要重复拼接的应用文本 delta |
| question.asked / permission.asked | 完整 Interaction |
| interaction.updated | 最新回复状态，不重复发送原生回复 |
| artifact.updated | 文件登记或检查状态变化 |
| agents.updated | Agent 启停、配置应用与可公开状态 |
| session.status / session.idle / session.error | 规范化会话状态或错误事实 |

server.connected、server.heartbeat、server.resync_required 为连接控制事件，不写业务日志、不带持久化 SSE id，不推进业务 cursor。connected 包含当前 instanceId/storeId、保留窗口最早和最新 cursor。

SSE 帧使用 `id:`（仅业务事件）与 `data:`，不发送命名 event 行；data 中的 type 标识事件。响应为 text/event-stream; charset=utf-8，禁止缓存和代理缓冲，15s 心跳。前端使用 EventSource.onmessage。

### 回放与快照恢复

1. 首次打开先连接事件流并有界缓冲，再读取快照 R 与 cursor C。
2. 应用快照，丢弃 cursor 不晚于 C 的缓冲事件，再按序处理剩余事件。
3. 重连携带 Last-Event-ID，服务端在保留窗口内从下一条回放，并接续实时流；切换过程不能漏发。
4. 游标过期、storeId 改变、缓冲超限或无法恢复时发送 resync_required，客户端重新走快照流程。
5. instanceId 改变使 runtime/健康缓存失效，并重新读取任务；持久化历史仍可存在，不重新提交业务。
6. 按 session 过滤后事件编号可能不连续，不能把编号间隔直接视作丢包。应用恢复依据服务端游标窗口与 resync_required。

删除会话后，回放不得重新泄露已删除消息。先删除对应敏感事件 payload 或推进回放保留边界；若旧 cursor 已无法无缺口恢复，明确要求 resync。不能只删除消息表却在事件表永久留下原文。

## 5. 错误与控制语义

统一 JSON body 为 `{code,message}`，requestId 放响应头。客户端根据 code 分支，不能解析中文或英文 message。

| HTTP | code | 使用条件 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | schema、目录、模型参数不满足要求 |
| 404 | NOT_FOUND | 资源不存在或不在允许范围 |
| 409 | CONFLICT | 幂等冲突、交互已被认领、资源状态不允许操作 |
| 410 | GONE | 提交标识已过期或资源已按策略移除；应用 API 使用 |
| 500 | INTERNAL_ERROR | 网关内部或状态存储失败 |
| 502 | BAD_GATEWAY | 引擎传输、执行或进程失败 |
| 503 | SERVICE_UNAVAILABLE | 未就绪、容量限制、正在停机 |
| 504 | TIMEOUT | 应用操作有界等待超时；评测超时映射待核对 |

Run 本身还有 error.category 与 stage，区分运行失败、超时、重启中断、停止未确认等原因；不为了增加内部分类扩张赛题固定错误码。

取消：先提交 stopRequest，再请求原生取消。HTTP 成功只表示操作定义的停止已确认；页面在等待期间显示 stopping。重复取消不重复记账。超时强停失败必须返回错误并保持不可用，不能返回虚假 ok。

删除：同一 Session 删除请求合并处理；成功后重复删除返回 NOT_FOUND，前端可将“已不存在”视为列表移除。删除开始后拒绝追加 Run，且不删除用户工作目录文件。

交互：reply 先原子认领再发往引擎。自动策略先于人工完成时人工请求返回冲突与可查询状态，不能覆盖已执行授权。始终存在自动与人工两种入口，但只有一个处理者生效。

## 6. 观测查询约束

overview 的统计单位是 Run，返回 completed、failed、timedOut、cancelled、queued、running，以及各自窗口。成功率为 completed/(completed+failed+timedOut)，分母为 0 时为 null；主动取消单列。

series 只接受预定义 metric key，禁止任意查询语言透传。返回 unit、from/to、availableFrom/availableTo、stepSeconds、points 和 gaps；无采样的点为 null。rate、累计 counter 和当前 gauge 分开表达，跨重启 counter reset 不连成增长线。

errors 和 trace 查询给出实际保留窗口、截断/采样标记与关联 runId。工具 span 只能来自真实可观察工具事件；不可观察的模型内部调用不伪造。

runtime.capabilities 描述模型列表、工具、费用、进程采样等实际可用能力；必需能力缺失会使对应验收失败，不能通过返回 false 把需求变成可选。


## 桌面运行时管理

受管安装契约定义在 `code/shared/runtimes.ts`，语义以 [运行时安装](RUNTIME_INSTALL.md) 为准。`GET /api/runtimes` 返回四个运行包视图；`POST /api/runtimes/:id/actions` 接受严格的 `{ action }`，动作有 `check`、`detect`、`install`、`update`、`uninstall`、`cancel`，返回 202 后轮询视图。逐 Agent 选择受管或外部来源；两种入口均拒绝覆盖修改外部 CLI；同一 Agent 的操作互斥，切换/卸载遵守现有生命周期准入。

Run 新增可空 `runtimeVersion`，保存实际运行 CLI 版本，当前数据库直接定义此列，不提供历史迁移。Web/Desktop 所有 HTTP、SSE、产物与指标接口无需配对码、Cookie 或 Bearer token。网关监听与重启、自动化评测接口见 [网关 API](../../code/docs/GATEWAY_API.md)。

系统与来源管理接口以 [Web/Desktop 统一运行](WEB_DESKTOP.md) 和 `code/shared/system.ts` 为准。
