# 任务超时与完成处理

## 配置与生效范围

Pi、OpenCode、Codex、Grok 默认共用 30 分钟（1800000 毫秒）的网关任务总时限。系统信息页提供“任务超时”表单，接受 1–1440 的整数分钟数，支持保存、恢复默认、输入校验和冲突后保留草稿。

优先级：settings.json 顶层 `runTimeoutMs` → 启动环境 `AGENT_LIMITS.runTimeoutMs` → 默认 1800000。新字段可选，已有 schemaVersion=1 配置不需要迁移。显式环境覆盖保持有效，直到页面或初始化配置保存自己的值。API 允许 60000–86400000 的整数毫秒数；页面按整数分钟输入。

页面通过现有 GET/PUT `/api/settings` 和 revision 乐观锁保存，密钥掩码保持原有处理。时限保存无需重启或 Agent apply，立即用于新提交任务。其他 Agent 资源修改仍需 apply。运行信息、观测页面返回当前有效值。

每轮提交时将期限写入 Run.deadlineAt，任务详情显示这份快照。计时包含排队、执行和人工等待；业务输出与连接心跳都不延长期限。更新设置不会修改已经排队或执行中的任务。

## 执行与收尾

网关负责期限到期后的停止：先取消原生执行，未确认时尝试停止对应进程，仍无法确认则报告 STOP_UNCONFIRMED，不能声称安全停止。排队到期与执行到期采用不同错误阶段。

原生引擎返回成功后，必须检查本轮最终助手消息的 finish=stop，再同步落库 completed。终态只写一次，迟到的结果不能覆盖已经接受的取消或超时。

成功落库后登记产物。扫描和校验受独立 `AGENT_LIMITS.artifactTimeoutMs` 控制，默认 30000 毫秒，可设置 100–600000。文件流支持中止；到期或文件错误只产生 artifact/ARTIFACT_CHECK_FAILED 警告，不改变执行成功状态。客户端在 completed 后可能继续收到 artifact.updated，应刷新详情获取产物。初始文件清单扫描同样有界；清单失败保留诊断且允许模型任务继续。

## 引擎通信

| 引擎 | 网关通信与完成依据 |
| --- | --- |
| Pi | stdio RPC；等待 agent_settled 和最终助手消息 |
| Codex | stdio RPC；等待对应 turn/completed 和成功状态 |
| Grok | ACP stdio；等待 session/prompt 最终返回。长请求不另设执行计时器，进程断开仍拒绝等待者；普通 RPC、初始化和停止确认继续限时 |
| OpenCode | 原生 prompt_async 提交立即返回，SSE 推送实时内容；轮询 session/status 和关联本轮 parentID 的消息核对最终结果，不以旧消息或 idle 单独判成功 |

OpenCode 提交响应丢失时先查询本轮消息确认接受情况，不自动重发 POST。连续查询失败会进入现有隔离/停止流程。SSE 临时中断会进行至多三次连续重连，恢复期间读取待处理权限与问题并按原生 ID 去重；轮询负责补齐最终结果。无法恢复时报告引擎通信异常，保留任务历史，禁止自动重跑。网关重启仍沿用现有的原生会话恢复机制，中断轮次不自动重放。

生成的 OpenCode provider options 将 timeout/headerTimeout/chunkTimeout 设为 false，使本地原生请求服从网关的任务期限，避免独立的默认 5 分钟限制提前中断。新版本首次启动会生成配置；运行中更换后端代码应重启。远端供应商、反向代理和其他 CLI 内部限制不受网关设置控制，仍须按原始错误定位。

此次保留 HTTP/SSE/stdio，不引入 WebSocket。传输替换不能解决期限归属与完成状态问题。

## PowerShell 与自动化调用

`Initialize-AgentBridge.ps1 -RunTimeoutMinutes 30` 在初始化时显式覆盖导入值，并写入同一份 settings.json。省略参数时保留导入字段；旧导入配置无此字段时保留目标已保存值。已有业务配置不同仍拒绝覆盖，应在页面修改或选择新数据目录。示例部署配置显式使用 1800000。

tools/evaluate.mjs 默认先读取网关有效时限，再增加 60 秒客户端等待余量；--timeout 可显式覆盖。评测通过立即返回 runId 的接口提交、短请求轮询终态并收集 SSE 事件，避免客户端再次遇到同步 HTTP 请求的 5 分钟响应头限制。

注意：AgentBridge 对外兼容接口 `/session/{id}/prompt_async` 保留“等待本轮终态”的既有语义；OpenCode 原生同名接口才是立即返回。外部长任务客户端应使用 `/api/tasks/{id}/runs`。

## 改动范围与验证

- shared/settings、config、settings：默认值、保存校验与原生配置。
- runtime/sessions、runtime/artifacts：有效期限快照、停止诊断、成功先落库与可中止产物收尾。
- engines/rpc、grok、opencode：统一长任务计时、异步提交、状态核对、SSE 恢复与审批去重。
- gateway、observability、web：接口有效值、设置表单、任务详情快照。
- PowerShell/Node 初始化器、评测工具、部署示例与 Windows 初始化测试。
- API、安装说明及生成的完整 API 文档。

回归覆盖默认 30 分钟、保存与持久化、无效输入、配置冲突、已有任务期限不变、Grok 无重复计时且进程退出可清理、OpenCode 提交响应丢失不重放、旧消息不误判、取消、上游错误、SSE 恢复与审批去重，以及成功后收尾跨过执行期限。页面在桌面和移动视口验证保存、刷新持久化、恢复默认和并发修改后的草稿保留。初始化测试覆盖超时参数校验、重复初始化保留配置；Windows 测试验证 PowerShell 5.1 参数传递，发布流水线另外验证最终安装包的安装、初始化和启动。
