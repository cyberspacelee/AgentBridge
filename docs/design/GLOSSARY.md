# 统一术语

本表是文档、代码、数据库、API 和前端文案的命名依据。首次出现使用中文加英文，此后保持一致。

## 核心概念

| 中文 | 英文 / 代码名 | 定义 | 不得混同 |
| --- | --- | --- | --- |
| 网关 | Gateway | 提供协议、任务控制、数据和观测的 AgentBridge 服务 | 模型推理引擎 |
| 网关实例 | GatewayInstance / instanceId | 一次网关进程生命周期；重启生成新 ID | 持久化数据集或引擎进程 |
| 存储标识 | StoreIdentity / storeId | 一个数据目录的身份；重新初始化数据目录才变化 | instanceId |
| Agent 引擎 | AgentEngine / engineId | 带工具调用与执行循环的 Agent harness，例如 opencode、pi | provider、LLM model |
| 引擎适配器 | EngineAdapter | 对外实现统一契约，对内处理原生协议 | 路由控制器、工具业务 |
| 引擎进程 | EngineProcess / processGeneration | 适配器拥有的服务或 RPC 子进程及其代次 | GatewayInstance |
| 原生会话 | NativeSession / nativeSessionId | 引擎内部的上下文标识 | 网关 sessionId |
| 会话 | Session / sessionId | 固定工作目录、引擎绑定与交互策略的一组连续执行 | 一次 HTTP 请求、一次 Run |
| 任务 | Task / TaskView | Session 的用户视图，taskId 等于 sessionId | 独立可写 Task 聚合 |
| 执行轮次 | Run / runId | 一次已接受的用户要求，包含排队、执行及唯一终态 | 模型的一次调用或 tool step |
| 消息 | Message / messageId | 属于一个 Run 的用户输入或 Agent 输出 | SSE 事件 |
| 消息片段 | MessagePart / partId | 消息内的文本、工具展示或步骤结束片段 | Run 的唯一终态 |
| 工具调用 | ToolCall / toolCallId | 一次实际工具执行，包含输入、输出、状态与时间 | Agent 输出中提到某工具 |
| 交互请求 | Interaction / interactionId | 引擎提出并需要回复的权限或问题 | HTTP requestId |
| 权限请求 | PermissionRequest / permission | once、always、reject 决策请求 | 用户登录权限或 RBAC |
| 问题请求 | QuestionRequest / question | 有题目、选项或自由文本的反问 | 一律回答“是”的提示词 |
| 工作目录 | WorkspaceDirectory / directory | 网关主机上经过验证且实际传入引擎的目录 | 浏览器本机文件夹 |
| 产物 | Artifact / artifactId | 已登记、关联 Run、可验证访问的真实文件 | Markdown 中任意路径文本 |
| 产物检查 | ArtifactValidation | 格式、结构或明确业务规则的验证记录 | 文件存在即全部业务通过 |
| 模型引用 | ModelRef | providerID + modelID 的引擎无关标识 | engineId |
| 模型服务方 | Provider / providerID | 提供模型 API 的服务配置标识 | Agent harness |
| 请求标识 | RequestId / requestId | 一次 HTTP 请求的日志关联标识 | 提交幂等键 |
| 提交标识 | SubmissionId / submissionId | 同一业务提交在重试中保持不变的幂等键 | 每次重试重新生成的 requestId |
| 领域事件 | DomainEvent | 一次已提交业务变化的事实 | 原生事件原文、前端命令 |
| 事件游标 | EventCursor / eventId | 已提交事件流中的恢复位置 | 单一实体版本号 |
| 修订号 | Revision / revision | 存储中一次业务事务提交的单调递增编号 | 浏览器时间戳 |
| 快照 | Snapshot | 一致读视图下某 revision 的完整或分页投影 | 多次请求随意拼接的当前对象 |
| 执行轨迹 | ExecutionTimeline | Run 中实际可观察的消息、工具、交互和阶段 | 模型未公开的内部推理 |
| 调用链 | Trace / traceId | 用 spans 关联可测量的执行阶段 | 消息全文或 metrics label |
| 统计窗口 | ObservationWindow | 指标查询的明确起止时间 | Run 的执行期限 |
| 执行期限 | Deadline / deadlineAt | 从接收算起，含排队的绝对截止时间 | 仅 HTTP socket timeout |
| 接收 | Admission | 校验、配额、幂等认领和持久化成功 | 执行完成 |

## 状态与结果

| 名称 | 固定取值 | 含义 |
| --- | --- | --- |
| SessionAvailability | ready / unavailable / deleting | 是否可以接受新 Run、是否正在清理 |
| SessionStatus | idle / busy | 仅供赛题协议；存在非终态 Run 即 busy |
| RunState | queued / running / stopping / completed / failed / timed_out / cancelled | 唯一的执行状态机 |
| RunOutcome | completed / failed / timed_out / cancelled | 与 RunState 中终态一一对应 |
| TaskStatus | not_started / queued / running / waiting_input / stopping / completed / failed / timed_out / cancelled / unavailable / deleting | 服务端从 Session、Run 和 Interaction 派生 |
| InteractionState | pending / replying / resolved / expired | 待认领、回复中、已确认、执行已结束 |
| ToolCallState | pending / running / completed / failed / cancelled / interrupted | 工具调用自身状态；不能倒推 Run 必然成功或失败 |
| ValidationStatus | not_checked / passed / failed / unavailable | 检查状态；检查范围必须同时给出 |
| EngineHealth | starting / ready / degraded / unavailable / stopping | 引擎接收新会话的运行条件 |

固定中文文案：completed 为“执行完成”，failed 为“执行失败”，timed_out 为“已超时”，cancelled 为“已取消”。业务验证 passed 才能针对其明确检查范围显示“检查通过”，不能把 completed 翻译成“验收通过”。

`waiting_input` 是任务展示状态，Run 仍处于 running，执行期限继续计时。`idle` 不代表成功、健康或记录已删除。只有最终 assistant 的成功结束语义，加上适配器确认执行收敛，才能产生 completed。

## 格式和单位

- TypeScript 与应用 API 使用 camelCase；类型使用 PascalCase，枚举值使用上述小写字符串。
- 赛题 wire 字段保持原规范，如 `created_at`、`providerID`、`modelID`；序列化层完成转换，领域不跟随协议版本改名。
- 应用 API 中时间为 UTC ISO 8601 字符串，例如 `2026-09-05T08:30:00.000Z`；持久化可存整数 epoch milliseconds，转换集中实现。
- 耗时内部和应用 API 使用字段后缀 `Ms`；Prometheus 使用秒并带 `_seconds`。大小用 `Bytes`，资源比例 API 用 0..1，页面转换为百分比。
- 费用使用 `currency: USD` 与 `source: reported | estimated`；金额、token 缺失为 null，不用 0 冒充未知。成本估算附价格配置版本。
- 内部 ID 是不透明字符串；禁止从 ID 推算目录、原生会话或用户身份。原生 ID 不作为公开主键。
- 日志用 requestId、sessionId、runId、traceId 关联；metrics 标签不能包含这些 ID。
- 前端显示本地时区，查询边界转换为 UTC；不要把本地格式化时间传回服务端排序。

## 容易混淆的操作

| 操作 | 语义 |
| --- | --- |
| 接受提交 | 返回 submissionId、sessionId、runId；Run 可能尚在排队 |
| 重试 HTTP | 使用相同 submissionId，获取同一接收结果 |
| 重新执行业务 | 用户明确提出一次新要求，生成新 submissionId 和 runId；会重复副作用 |
| 取消会话执行 | 取消当前 Run 及已接受的排队 Run，不删除历史 |
| 删除会话 | 先停止执行并清理原生资源，再删除所属业务记录；默认保留用户工作目录文件 |
| 重启引擎 | 恢复接收能力；不自动重放 Run 或承诺恢复原生上下文 |
| 恢复页面 | 读取持久化快照并恢复事件位置；不启动 Agent |
| 回放事件 | 重发已提交事实，消费者按游标去重；不重新执行领域命令 |
