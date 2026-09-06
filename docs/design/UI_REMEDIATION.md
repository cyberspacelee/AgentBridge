<!-- Hallmark pre-emit critique: Philosophy 5 / Hierarchy 5 / Execution 4 / Specificity 5 / Restraint 5 / Variety 4. App implementation and browser verification recorded below. -->

# 企业 Agent 网关 UI 整改方案

日期：2026-09-06。设计规范见根目录 [design.md](../../design.md)。用户确认开始整改后，P1–P5 已在本轮 UI 范围完成：静态检查、构建及 14 项浏览器用例通过，2 项手机重复 / 桌面专用用例按设计跳过；51 张截图已归档。[验收证据](../../code/artifacts/ui/README.md)

## 1. 实施前基线

本节及第二节保留整改前审阅结果，行号为当时定位，不是修改后代码行号。当前实现与原计划差异见第七节。

审阅了三条业务路由、应用壳、共享 UI、主题、API 更新链路、消息类型和双引擎工具映射。当前目录及 code 子目录均无 Git 元数据，因此本次用文件路径定位，不提供 commit 基线。

| 页面 / 能力 | 当前实现 | 处理原则 |
| --- | --- | --- |
| `/tasks` | tasks.tsx；搜索、状态、游标分页、新建 Dialog | 收敛列表密度、移动端与字段优先级 |
| `/tasks/:id` | task.tsx；执行、交付物、交互、诊断四标签 | 重点提升消息阅读、Tool 结果与待处理操作可见性 |
| `/observability` | observability.tsx；指标带、Recharts、表格 | 保留信息架构，统一颜色、筛选恢复与数据新鲜度 |
| 组件 | Base UI 版 shadcn、Lucide、Status / IconButton / Choice / Failure | 继续复用，避免新增一套 Agent 组件框架 |
| 样式 | index.css；中性主题 + 局部 emerald / rose / amber | 将局部色值归到语义 token |
| 字体 / 动效 | 本地 Geist；Tailwind 4 刻度；tw-animate-css | 补中文回退；只保留必要状态动效 |

### Pre-flight 证据

- 字体：[index.css](../../code/web/src/index.css) 第 4、10 行；只有 Geist 加泛型 sans-serif。
- 主题与间距：同文件第 50 行起的 :root、第 86 行起的 .dark；组件使用 Tailwind 4 的间距刻度。
- 技术栈：[package.json](../../code/web/package.json)、[components.json](../../code/web/components.json)，React 19、Vite、Tailwind 4、base-nova、Lucide；没有前端 Markdown 依赖或专门的动效引擎。
- 已有设计：[FRONTEND.md](FRONTEND.md) 已要求左导航、就地交互、安全 Markdown、底部跟随与状态恢复；部分尚未反映到实现。
- 扫描前无根 design.md、独立 tokens.css 或 Hallmark 历史记录。现有已检索的前端资源为 Vite / React 占位 SVG，应用品牌实际用 Network 图标加文字。

## 2. 问题与优先级

P1 先建立一致的视觉基础，P2 / P3 修复高频 Agent 阅读与决策体验；编号代表施工顺序，表内严重度代表使用影响。

| ID | 严重度 | 证据 | 问题与目标 | 阶段 |
| --- | --- | --- | --- | --- |
| UI-01 | 高 | task.tsx:358，Execution 文本分支 | Agent Markdown 直接显示字符串；增加安全正文、表格与代码渲染 | P2 |
| UI-02 | 高 | task.tsx:361，Tool 分支；contracts.ts:117 | 输出已有状态和时间但未显示耗时；结果统一 pre、无摘要或展示预算 | P2 |
| UI-03 | 高 | task.tsx:155、Execution 与 InteractionRow | 待处理交互在单独 tab，执行视图看不到回复表单；增加本轮就地入口及数量 | P3 |
| UI-04 | 中 | index.css:160 | running、ready、completed 同绿；改为执行蓝、成功绿，集中状态映射 | P1 |
| UI-05 | 中 | App.tsx 顶部 nav；FRONTEND.md 第 1 节 | 实现为顶部导航，原设计为左导航；落地同一工作台壳层及移动菜单 | P1 |
| UI-06 | 中 | index.css:152、170、195 | 10 / 11 px 小字、65svh 消息滚动、局部图表绿色；统一字号、滚动布局与图表 token | P1 / P2 |
| UI-07 | 高 | task.tsx:314 | follow 开启后每次更新 scrollIntoView；没有检测用户上翻和新进度入口 | P2 |
| UI-08 | 高 | task.tsx:628，Artifacts；contracts.ts:180 | 文件列表只显示校验，未呈现 availability；区分文件失效与检查结果 | P4 |
| UI-09 | 中 | observability.tsx:107、170 | 范围、指标、阶段与 code 在本地 state；切 tab 只保留 tab 参数 | P4 |
| UI-10 | 中 | observability.tsx:111、168；api.ts:126 | 5 秒自动更新，没有暂停控件；采集时间未带陈旧判断 | P4 |
| UI-11 | 中 | theme-provider.tsx；App.tsx 主题按钮 | provider 支持 system，当前按钮只有两态切换；暴露一致的三选项 | P1 |
| UI-12 | 中 | task.tsx step-finish 分支 | 所有结束原因都用 Check；生成停止、Run 完成与验收状态应分层 | P2 |

以上为源码可确认的差距，不将潜在移动端问题表述为已经截图复现的缺陷。

## 3. 参考站如何落到项目

参考取自用户提供的 [Beautiful UI](https://www.beautifului.dev/)，链接定位其对应组件示例。这里只采用交互结构，目标视觉以 design.md 为准。

| 参考 | AgentBridge 落点 | 取舍 |
| --- | --- | --- |
| [Tool Chips](https://www.beautifului.dev/#tool-chips)、[Task Rows](https://www.beautifului.dev/#task-rows) | Tool 摘要、真实状态与耗时 | 用可展开行容纳长工具名，失败可立即定位 |
| [Streaming Text](https://www.beautifului.dev/#streaming-text)、[Code Block](https://www.beautifului.dev/#code-block) | Agent 正文与代码 | 真实快照持续更新、安全 Markdown、代码复制 |
| [Approval Card](https://www.beautifului.dev/#approval-card) | 权限 / 反问的本轮就地表单 | 保留 once / always / reject 与原状态机 |
| [Prompt Bar](https://www.beautifului.dev/#prompt-bar) | FollowUp 输入区 | 只呈现已有输入和提交能力 |
| [Sidebar Nav](https://www.beautifului.dev/#sidebar-nav)、[Records Table](https://www.beautifului.dev/#records-table) | 应用导航与任务列表 | 简化到两个主模块，强调扫描效率 |
| [Thinking](https://www.beautifului.dev/#thinking-state)、[Context Cards](https://www.beautifului.dev/#context-cards)、[Diff Table](https://www.beautifului.dev/#diff-table) | 执行活动；未来结构化来源 / Diff | 无真实字段时不生成推理链、引用数量或可应用补丁 |

## 4. 数据能力分界

| 能力 | 当前数据 | 实施判断 |
| --- | --- | --- |
| Markdown、代码复制 | TextPart.text | 前端可做；采用成熟解析器 |
| Tool 状态、名称、输入、输出、耗时 | ToolPart 字段齐备；时间可为 null | 前端可做，未知值明确显示 |
| 正文持续更新 | App 一条 SSE -> revision -> useQuery -> TaskDetail | 保留现有快照替换，先不改为逐 delta 存储 |
| 审批 / 反问就地展示 | Interaction.runId、questions、state、reply | 前端可做；只关联到本轮，无法精确关联到某次 Tool |
| 文件可用性与下载 | Artifact.availability、validation、artifactId | 前端可做；下载服务仍是最终可用性判定 |
| 结构化表格、stderr、Tool 产物、来源引用 | ToolPart.output 仅 string | 单独扩展契约后再做专属结果视图 |
| reasoning / 进度百分比 | MessagePart 只有 text、tool、step-finish | 不显示虚构思考内容、完成率或步骤计划 |
| 大输出服务端截断 / 全文下载 | 没有 truncated / outputArtifactId | 客户端预览限额先做；可靠全文保留另补契约与后端 |

双引擎证据：[OpenCode adapter](../../code/src/engines/opencode/adapter.ts) 将 output/error 映射成单个字符串；[Pi adapter](../../code/src/engines/pi/adapter.ts) 使用累计 partialResult/result 更新相同 ToolPart。界面不能自行拆出不存在的 stdout / stderr 或把每个快照追加成新调用。

未来契约增强应提供受验证的输出类型、截断标记、来源或 artifactId 关联，并同步 shared/contracts、双适配器、持久化、序列化与测试。未知类型继续以文本降级。此增强独立排期，不阻塞当前统一设计。

## 5. 分阶段施工

### P1：统一 Token 与应用壳

状态：verified（浏览器范围）。依赖：本文与 design.md。

文件：修改 `code/web/src/index.css`、`App.tsx`、`components/workspace-ui.tsx`；新增 `code/web/src/tokens.css`。主题三选项先复用 Choice；必要时仅为暴露 resolvedTheme 修改 theme-provider。基础按钮确有颜色 / 尺寸缺口才修改对应 `components/ui` 文件。

动作：集中浅深色变量，补中文 / 等宽字体，改状态颜色映射；建立左导航与响应式菜单、顶栏连接状态；统一标题、表格、控件尺度。核对现有 Button 的 `primary/90` 与其他透明 hover，改用命名 hover token。迁移 token 不覆盖 Tailwind 导入，不批量重装 shadcn preset。

验收：三路由共享品牌、导航、标题与主命令；状态不混绿；暗色图表 / 链接不残留浅色硬编码；浅 / 深 / 系统切换正确，320 px 菜单及必要操作可用。

### P2：消息渲染与 Tool 结果

状态：verified（浏览器范围）。依赖：P1。

文件：修改 `pages/task.tsx`、`index.css`、`web/package.json` 与 `code/pnpm-lock.yaml`；新增 `components/agent-message.tsx`、`components/tool-call.tsx`，仅承载真正独立的渲染职责。Execution 继续拥有 Run 与滚动，不创建通用 renderer registry。

动作：TextPart 接入安全 Markdown，支持 GFM 表格与只读任务清单；工具结果优先、摘要耗时、原始输入折叠、复制、展示限额；稳定 key 与累计覆盖；上翻暂停和新进度入口；修正 step-finish 语义。

依赖选择：[react-markdown](https://github.com/remarkjs/react-markdown) 提供 React Markdown 渲染和组件定制；[remark-gfm](https://github.com/remarkjs/remark-gfm) 补充表格等 GFM 语法。实施时在 pnpm lock 锁定验证过的版本；不手写 Markdown 解析器，不引入 rehype-raw 或整套聊天 SDK。语法高亮不是第一阶段必需，先保证代码原文、滚动、复制。

验收：中文长文、未闭合代码块、宽表格、恶意 HTML / URL、未知 part、零输出工具、运行 / 失败 / 中断均正确；重复快照不重复内容；快照更新不重置展开；用户读历史时不会被拉到底部。

### P3：人工决策与输入闭环

状态：verified（浏览器范围）。依赖：P2。

文件：主要修改 `pages/task.tsx` 和 `index.css`；将已有 InteractionRow 提取到 `components/interaction-row.tsx`，供执行区和交互历史复用。只有验证提交状态需要共享时才提升到 Task，不另建状态管理框架。

动作：执行区呈现本轮待处理交互，标签显示待处理数；完善单选、多选、自定义输入与错误关联；确认后呈现真实回复及时间；输入区与滚动布局配合；禁用原因可读，中文 IME 下不误提交；核对 always 与 abort 的真实作用范围后落文案。

验收：手动权限、单 / 多选、自定义答案、自动回复记录、replying、过期、并发抢答都可验证；始终最多一套活跃回复表单；失败保留输入；审批完成不会被解释为业务通过。

### P4：列表、文件与观测一致性

状态：verified（浏览器范围）。依赖：P1；P2 / P3 完成后执行整体验收。

文件：修改 `pages/tasks.tsx`、`pages/task.tsx`、`pages/observability.tsx`、`index.css`；仅按暂停刷新需求向 `lib/api.ts` 的 useQuery 增加最小启停能力，默认行为保持一致并检查全部调用方。

动作：任务列优先级和窄屏呈现；文件 availability / validation 分列；观测 URL 状态、自动刷新开关、采集时间与陈旧提示、图表可读摘要。暂停要同时抑制观测页面的定时 clock 和 revision 重取；不能只停计时器却仍被全局 SSE 驱动刷新。保留错误到 Run 的深链与返回参数。

验收：任务搜索 / 筛选 / 游标与新建正常；missing / changed 文件不显示可正常预览；后端下载失败仍可读；观测刷新后 URL 筛选恢复；关闭自动刷新后保持快照，手动刷新有效；缺失费用不显示 0，空成功率不显示 100%。

### P5：回归与证据归档

状态：verified（Linux Chromium，14 passed / 2 skipped，49.4 秒）。依赖：P1–P4。

文件：按场景扩展现有 `code/test/browser.spec.ts` 与 `browser-server.ts` 测试数据；调整 `playwright.config.ts` 的必要视口覆盖。不新建 Storybook、测试框架或独立演示产品。

在 code 目录执行现有检查：

```bash
pnpm --filter @agentbridge/web lint
pnpm --filter @agentbridge/web typecheck
pnpm web:build
pnpm test:browser
```

若 P4 修改共享 API 查询逻辑，补覆盖暂停、恢复、切 URL 与失败保留数据的检查；若后续修改契约 / 引擎，额外运行 `pnpm test` 及对应真实引擎验收。现有 browser-server 使用测试引擎，浏览器通过不能证明真实引擎兼容。

## 6. 验收场景清单

| 场景 | 最小断言 / 证据 |
| --- | --- |
| 视觉一致性 | 三路由、浅深色；320 / 375 / 414 / 768 / 1024 / 1440 / 1920 px 截图，保留 390 px 回归 |
| 字体与溢出 | 中英文混排、200 字符连续路径、长任务名、200% 缩放；无页面横向溢出或裁掉操作 |
| 正文安全 | HTML 不执行、危险协议不可导航、外部图片不自动加载、GFM 表格局部滚动 |
| Tool 输出 | pending / running / completed / failed / cancelled / interrupted、null 时间、空输出、超过 64 KiB 输出；省略标识与复制范围正确 |
| 增量与滚动 | 同一快照重复两次、累计文本 A -> AB、断线再连接；不重复追加、不丢展开、不抢历史滚动 |
| 人工交互 | 运行中出现请求，不切 tab 即可处理；once / always / reject、单选多选、自定义、replying / expired / 冲突 |
| 追加与取消 | 中文组合输入不误发、网络结果不确定时复用 submissionId；停止等待真实状态，不重放工具 |
| 文件 | available / missing / changed / unavailable 与三种 validation；下载失败、超预览上限 |
| 观测 | URL 恢复、暂停 / 手动刷新 / 恢复、stale、unknown / 真实零、错误到指定 Run 返回 |
| 可访问性 | 键盘完整路径、Tooltip 名称、Dialog 焦点恢复、radio legend、错误关联、状态播报不过量、reduced-motion |

阶段完成必须同时具备对应实现与检查结果。截图使用显式测试数据，不能充当真实引擎业务执行证据。截图和检查摘要归档于 [code/artifacts/ui](../../code/artifacts/ui/README.md)。

## 7. 本轮交付与边界

已完成：统一 token、侧栏与响应式导航、三态主题、状态配色、安全 Markdown、代码复制、工具摘要 / 耗时 / 输出预算、滚动保持、就地审批、输入错误关联、文件可用性、稳定任务行、观测 URL / 暂停 / 陈旧状态、采样表格与诊断返回路径。

实际落点：新增 tokens.css、agent-message.tsx、tool-call.tsx；复用 task.tsx 内的 InteractionRow，没有为两个互斥标签另建状态框架。复制与耗时提到 workspace-ui 复用。useQuery 增加可选查询标识以在滚动时间窗刷新时保留快照；暂停直接冻结本页时间窗与 revision，不关闭全局 SSE。

仅新增并锁定 react-markdown 10.1.0、remark-gfm 4.0.1；保留现有 Base UI、React Router、Recharts 和 pnpm。没有更改后端契约或引擎行为。高亮、结构化 Diff、引用来源及大输出下载依然按原方案延后；always 的授权范围沿用引擎策略，界面不承诺跨任务永久授权。

验证范围为 Linux Chromium、显式 BrowserEngine / 路由测试数据，以及真实 OpenCode 网关启动与页面连接。Windows、人工屏幕阅读器、真实双引擎任务及全部外部集成未在本轮重新验收。
