# Agent 管理统一设计

状态：用户已确认，2026-09-07。本文替代旧基线中的单引擎、全局原生配置与按轮次阅读约定；按完整功能开发，不提供旧设置格式兼容或自动迁移。

## 范围与术语

管理 Pi、OpenCode、Codex CLI、Grok Build 四个执行引擎，每种引擎一个受管 Agent。注册表固定，启用状态动态持久化。Task 是 Session 的展示视图；Run 是一次提交触发的执行，保留排队、超时、取消、用量和产物归属。不新增 Turn 实体；原生 turn/session/item 标识留在适配器。

## 配置与所有权

`AGENT_DATA_DIR/settings.json` 是唯一管理配置源，包含 schemaVersion、defaultAgent、agents、providers、skills、mcp。agents 保存 id、enabled、model references、defaultModel、skillIds、mcpIds、interactionPolicy。模型连接只支持 OpenAI Chat Completions 与 Responses，包括名称、baseUrl、apiKey、模型列表。没有登录、OAuth、订阅或账号发现功能。

资源定义共享，启用引用归 Agent；没有 both、全局自动分发、用户原生配置目录编辑入口。保存时校验引用、重复项、默认模型归属与引擎协议支持。删除被引用资源须先解除引用。密钥脱敏返回，保持乐观并发 revision 校验。连接测试进行一次受限的真实模型请求，错误须脱敏。

适配器单向生成 `agents/<id>/` 内的原生配置。Pi 使用 PI_CODING_AGENT_DIR，Codex/Grok 在 `agents/<id>/sessions/<sessionId>/` 分别设置独立 CODEX_HOME/GROK_HOME；OpenCode 指定受管配置并控制配置发现。环境覆盖只施加于对应子进程。保持任务 cwd 不变，不写用户原生配置和任务仓库。生成文件不是第二配置源；更新不删除原生会话、缓存或插件数据。

Skills 通过显式配置路径加载，MCP 只下发选中项。项目说明文件保留项目语义，项目/用户自动发现的工具资源必须受控；不支持覆盖时必须明确限制，不能报告关闭成功。平台管理配置与系统强制约束冲突时失败并显示原因。原生配置导入只解析已支持的模型、skill、MCP 字段，预览并经普通保存生效，不持续双向同步。

## 生命周期与生效

期望 enabled 与实际 starting/ready/degraded/unavailable/stopping/disabled 分离。启用校验配置并启动握手；关闭立即拒绝新提交、取消排队项，允许当前执行及审批完成，然后停止 Agent。立即停止取消当前执行并在超时后终止进程树。停用不删除历史；重新启用尝试恢复原生上下文，不重放旧 Run。恢复、自动重启和调度均检查启用状态。

保存与应用分离：每个 Agent 有保存修订与已应用修订。使用中的配置保持不变；应用前停止接受新执行、等待当前执行结束，停止受影响进程、生成配置并重新启动。失败显示保存成功但应用失败；其他 Agent 不受影响。每次 Run 保存实际配置修订与选定模型。Agent 关闭/应用期间产生的会话创建和恢复操作也必须等待完成后停止进程，避免泄漏。

## 接入协议

Pi 保留逐会话 RPC，OpenCode 保留 HTTP/SSE。Codex 使用 app-server stdio：initialize/initialized、thread/start/resume、turn/start/interrupt、item 通知及服务端审批/提问请求。Grok 使用 ACP stdio：initialize、session/new/load/prompt/cancel/update、request_permission；认证只使用自定义 API Key 配置，不调用登录认证接口。接入要求相应协议和扩展可用，缺失时明确失败。

消息、工具、交互、完成状态统一映射到既有契约。只有原生终态确认后才结束 Run；拒绝审批、取消和失败不同于完成。成本或 token 未提供则 null；管理连接不配置计费单价，不能把原生默认零价格视为真实费用。协议解析、进程退出、请求超时、迟到事件、会话恢复和交互回传均覆盖测试。

## API 与页面

- `/api/settings`：共享资源、Agent 配置、修订与脱敏密钥。
- `/api/agents`：四个 Agent 的启用、健康、模型、能力、执行数、配置应用状态与目录。
- `/api/agents/:id/actions`：enable、disable、stop、apply；操作状态可通过 Agent 列表与 SSE 更新观察。
- `/api/providers/:id/test`：测试已保存连接及指定模型。
- `/api/agents/:id/import`：预览本机指定配置文件中的受支持资源；不写原生文件。
- 任务模型列表仅来自受管且已应用的模型配置；不能使用未授权模型引用。

主导航：任务、Agents、观测、系统设置。Agents 列表展示开关、健康、默认模型、活动数量及应用状态；详情以运行、模型、Skills、MCP 分页编辑，可测试模型和预览原生导入。共享资源在同一管理模块维护；系统设置显示网关目录、限制与连接状态。复用已有主题、Base UI、表格与表单，不引入新的视觉系统。

任务页默认展示整个 Session 的连续对话，各 Run 有状态和耗时分隔；执行历史筛选供诊断使用。交互就地可回复，交付物和诊断按执行筛选。新建任务选择启用且就绪 Agent，默认模型与策略由 Agent 提供。

## 验收

共享 schema、引用和密钥校验；四引擎生成配置与目录隔离；模型协议不匹配；真实连接测试成功/失败；Agent 启用、排队关闭、执行中关闭、强停、应用失败、重新启用与恢复；人工/自动审批与提问；多轮完整历史；桌面/移动、浅深色、键盘、错误和空状态。运行后端与前端类型检查、lint、构建、单元/集成/浏览器测试。真实模型和 Windows 环境的验证范围按实际证据记录，不将协议模拟测试写成真实模型验收。
