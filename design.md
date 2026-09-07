<!-- Hallmark pre-emit critique: Philosophy 5 / Hierarchy 5 / Execution 4 / Specificity 5 / Restraint 5 / Variety 4. Implemented app reviewed across light/dark desktop/mobile viewports. -->

# AgentBridge Design System

版本：1.1 · 2026-09-06。状态：视觉与 Agent UI 整改已落地，浏览器验证与适用范围见整改记录；不代表完整产品或双引擎业务已验收。

本文统一企业 Agent 网关的视觉与组件规则。页面行为以 [FRONTEND.md](docs/design/FRONTEND.md) 为准，领域与线上字段以 [DOMAIN.md](docs/design/DOMAIN.md)、[CONTRACTS.md](docs/design/CONTRACTS.md) 和 [共享类型](code/shared/contracts.ts) 为准。施工范围、现状证据和验收见 [整改方案](docs/design/UI_REMEDIATION.md)。后续页面共用本系统，新增规则先修改本文。

## 1. 产品与设计方向

基础组件选型、业务封装边界和本轮迁移清单统一见 [UI 组件统一规范](docs/design/UI_COMPONENTS.md)。能用 shadcn/ui 实现的基础交互必须复用组件层。

AgentBridge 是任务执行、人工决策、结果交付与故障定位的工作台。优先服务两个连续流程：业务使用者提交要求、处理审批、取得文件；运维使用者查看负载、定位失败 Run、回到任务。

- Genre：modern-minimal；应用结构：Workbench。中性灰白底、明确文字层级、细分隔线、紧凑表格。
- 品牌延续当前 AgentBridge 字标、Network 图标及绿色线索。绿色用于主命令与品牌，运行状态另设蓝色。
- 页面第一层回答“当前是什么任务 / 网关处于什么状态”，第二层提供操作，第三层才展示详细轨迹与原始数据。
- 卡片限于单个工具、审批、文件等有明确边界的对象。页面分区使用无外框区域或横向分隔，不堆卡片、不嵌套卡片。
- 一实例只显示当前启用引擎。企业感来自信息准确与操作可追踪，不新增租户、组织、计费、工作流画布或虚构 Agent 团队。

## 2. Provenance

用户指定 [Beautiful UI](https://beautiful-ui-five.vercel.app/) 为当前项目的公开设计参考；2026-09-06 该地址重定向至 [beautifului.dev](https://www.beautifului.dev/)。本系统由 AgentBridge 的既有设计和业务约束制定，参考组件的组织方式，不复制其品牌、示例业务或整站布局。

参考站 HTML/CSS 可确认：Inter 与 JetBrains Mono；浅色页面 `oklch(98.5% .001 286.376)`、蓝色强调 `oklch(62.6% .205 254.947)`；侧边组件索引加连续示例分区。参考组件包括工具摘要、审批、流式消息及代码块。[来源](https://www.beautifului.dev/)

本轮研究为静态 HTML/CSS 分析，未执行参考站脚本；不能据此宣称已验证动画、交互或实际视觉节奏。AgentBridge 保留已安装的 Geist，采用自己的颜色与尺寸。参考站的斜纹底、展示编号、负字距、较大圆角和装饰加载效果不进入工作台规范。

## 3. 色彩

以下为目标值，sRGB HEX 是精确值，避免实施时再次凭视觉选色。仅在 token 定义中写原始颜色，组件使用语义变量。浅深色使用相同的语义映射。

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--background` | `#FAFAFA` | `#141414` | 页面底色 |
| `--foreground` | `#171717` | `#F5F5F5` | 正文、标题 |
| `--card`, `--popover` | `#FFFFFF` | `#1C1C1C` | 工具面板、弹层、输入表面 |
| `--muted`, `--secondary` | `#F5F5F5` | `#262626` | 表头、用户消息、代码底色 |
| `--muted-foreground` | `#525252` | `#B3B3B3` | 时间、单位、说明 |
| `--border` | `#E5E5E5` | `#383838` | 装饰分隔，不作为唯一控件边界 |
| `--input` | `#737373` | `#858585` | 输入框、单选、多选边界 |
| `--primary`, `--ring` | `#047857` | `#34D399` | 主命令、品牌、焦点 |
| `--primary-foreground` | `#FFFFFF` | `#10251C` | 主按钮文字 |
| `--primary-hover` | `#065F46` | `#6EE7B7` | 主命令 hover / active |
| `--accent` | `#ECFDF5` | `#17382B` | 选中导航、选项背景 |
| `--accent-foreground` | `#065F46` | `#6EE7B7` | 选中导航文字 |
| `--info` / `--info-soft` | `#1D4ED8` / `#EFF6FF` | `#93C5FD` / `#172554` | 执行中、普通链接 |
| `--success` / `--success-soft` | `#166534` / `#F0FDF4` | `#86EFAC` / `#142B20` | 已完成、已就绪 |
| `--warning` / `--warning-soft` | `#92400E` / `#FFFBEB` | `#FCD34D` / `#302411` | 等待回复、待处理 |
| `--destructive` / `--destructive-soft` | `#BE123C` / `#FFF1F2` | `#FDA4AF` / `#351820` | 失败、删除、风险 |
| `--destructive-foreground` | `#FFFFFF` | `#351820` | 实心危险按钮文字 |

品牌强调应只占少量面积，不将整个侧栏、整条消息或整块图表染绿。链接同时有下划线或明确链接语义；状态同时有文字与图标。

图表沿用 Recharts。`--chart-1` 至 `--chart-5` 分别映射 info、success、warning、destructive、muted-foreground；每个指标保持固定色义，并有名称、单位和线型 / 点型，不能靠颜色猜测系列。禁止在 `.trend` 内重新定义固定绿色。

对比度已按上述不透明颜色计算：主按钮浅 / 深 5.48 / 8.38，次级文字 7.17 / 7.22，四组状态最小 5.72，输入边界最小 4.62。仅说明 token 配对符合目标，不代替实际页面验收；透明度、叠层、hover 和组件组合仍需检查。目标为正文 4.5:1、重要图形及控件边界 3:1。

## 4. 字体、尺寸与间距

保留本地 `@fontsource-variable/geist`；中文明确回退至系统字体，不依赖外网下载字体。

```css
--font-body: "Geist Variable", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif;
--font-heading: var(--font-body);
--font-code: ui-monospace, "Cascadia Code", Consolas, "Liberation Mono", monospace;
```

| 角色 | 字号 / 行高 | 字重 | 规则 |
| --- | --- | --- | --- |
| 品牌 | 16 / 24 px | 600 | 主导航可直接识别 AgentBridge |
| 页面标题 | 24 / 32 px | 600 | 窄屏 20 / 28 px；每页一个 h1 |
| 区域标题 | 16 / 24 px | 600 | 不使用宣传页大标题 |
| 正文、表格、按钮 | 14 / 22 px | 400 / 500 | 表头 500，关键标题 600 |
| Agent 长文 | 15 / 26 px | 400 | 阅读宽度最多 72ch，受容器约束 |
| 元信息、状态 | 12 / 18 px | 400 / 500 | 禁止 10 / 11 px 承担必要信息 |
| 代码、路径、ID | 13 / 20 px | 400 | 等宽；表格数字使用 tabular-nums |
| 指标数值 | 28 / 36 px | 600 | 单位降为 12 px；窄屏 24 / 32 px |

所有字距为 0，标题正体。不用 vw / cqw 缩放字体。长标题允许自然换行；无空格长词使用 `overflow-wrap: anywhere`，父容器 `min-width: 0`。

间距共用 Tailwind 的 4 px 刻度：4、8、12、16、24、32、48 px，对应 `gap-1/2/3/4/6/8/12` 等。控件内部 8 / 12，消息段落 12，消息之间 24，页面区块之间 24 / 32。桌面页面边距 24，窄屏 16。

圆角：普通控件 6 px，工具 / 审批 / 弹层 8 px；状态标签 4 px，圆点与头像可圆形。页面区块无圆角。阴影只用于浮层，不用于每张工具行。

尺寸：桌面按钮与输入默认高 36 px，紧凑图标按钮 32 px；触控操作区域至少 44 px。表头 36 px，任务行最小 56 px，工具摘要行最小 40 px。长内容允许行增高，图标、状态、操作列不被挤压。

## 5. 应用布局

统一壳层：左侧导航、顶部上下文、主内容；对应已有 FRONTEND 的左导航基线。只保留任务工作台与网关观测两个主入口。

| 宽度 | 导航 | 主内容 | 任务信息 |
| --- | --- | --- | --- |
| ≥ 1280 px | 208 px 侧栏 | 24 px 页边距，最大 1500 px | 280 px 右栏，默认收起，按需展开 |
| 1024–1279 px | 64 px 图标栏，有名称与 Tooltip | 24 px 页边距 | 按需打开信息弹层 |
| 768–1023 px | 顶栏菜单 | 24 px 页边距 | 按需打开信息弹层 |
| < 768 px | 56 px 顶栏 + 菜单弹层 | 16 px 页边距，单列 | 信息入口打开弹层 |

主内容列统一 `minmax(0, 1fr)`。桌面顶栏 56 px，展示面包屑、当前引擎、连接状态和主题。存储类型、Instance ID 放诊断信息；连接异常在当前可视区呈现，不要求滚至页尾。首屏直接进入任务列表。

主题提供浅色、深色、跟随系统三个选项，沿用 ThemeProvider 存储。只读引擎不会伪装成可切换的下拉框。

任务详情的空间顺序：

```text
主导航 | 任务标题 / 状态 / 刷新 / 停止 / 删除
       | 第 N 轮 · 执行记录  交付物  交互  诊断
       | 执行消息 / 本轮状态 / 耗时 / 跟随输出 / 专注阅读
       | 用户要求                         | 任务信息
       | Agent 正文                       | 引擎 / 模型
       |   工具摘要 -> 可展开输入、结果    | 工作目录
       |   待处理交互 -> 就地回复          | 用量 / 时间
       | Agent 结果 / 本轮文件入口         |
       | 新进度悬浮入口                   |
       | 紧凑追加输入条 / 发送             |
```

这是结构示意，不是应用截图。执行正文不包进大卡片，工具面板内部用小标题和分隔线分区。

执行消息是任务详情页的主工作区。执行页使用壳层分配的可用视口高度，消息区域 `min-height: 0; overflow-y: auto`，输入区作为同一 flex 列的固定兄弟元素，不覆盖最后一条消息。桌面轮次和标签共用一行，窄屏自然分行。任务信息默认收起；专注阅读收起任务标题、标签导航和信息栏，保留本轮状态、跟随开关、退出入口与追加输入。新进度入口悬浮于消息区底部，出现时不改变正文高度。输入条按内容增高，上限为 160 px 或 20dvh 中较小值，避免长草稿挤空消息区。窄屏同样由动态视口和 flex 分配剩余空间，不使用固定 `65svh`；输入区始终保持可达。

表格、代码块各自允许局部横向滚动；页面本身不可横向滚动。根节点可用 `overflow-x: clip` 作边界防护，但不能用它隐藏溢出的按钮或必要内容。窄屏任务列表改为单列紧凑行，标题、状态、模型和时间可读，其余字段在详情查看。四个详情标签在 320 px 仍须完整可用；长观测标签窄屏改为具名 Select。

## 6. 消息与执行过程

### 6.1 内容层次

按所选 Run 展示 Message，并保持消息和 parts 的服务端顺序。用户要求用窄幅中性背景；Agent 回答用无外框正文。角色、时间与复制操作共用统一消息头，避免每条消息配装饰头像。

| 内容 | 展示规则 | 数据来源 |
| --- | --- | --- |
| 用户消息 | 保留换行的纯文本，不解释成可执行内容 | `Message.role=user`、`TextPart.text` |
| Agent 消息 | 安全 Markdown；支持段落、列表、表格、引用、链接、代码 | `Message.role=assistant`、`TextPart.text` |
| 执行状态 | 一行状态、实际活动和耗时；无已知活动时显示“执行中” | `Run.state`、ToolPart |
| 生成结束 | 中性分隔信息，不一律显示绿色勾 | `step-finish.reason`、`Message.finishReason` |
| 本轮终态 | 完成 / 失败 / 超时 / 取消及真实原因 | `Run.state`、`Run.error` |

消息内标题从 h3 的视觉与语义层级开始，不能覆盖页面 h1。Markdown 代码块只有语言标签、复制与真实内容，不画假的终端标题栏。宽表格有局部滚动和表头，任务列表标记为只读，不暗示可执行操作。

原始 HTML、脚本、iframe、内联事件不执行；禁止 `dangerouslySetInnerHTML` 渲染模型内容。链接限制为有效的 http/https 或受控站内目标，外链新窗口使用 `noopener noreferrer`；拒绝 javascript/data/file 等地址。远程 Markdown 图片默认显示链接；已注册且可预览的图片可经 artifactId 受控加载。磁盘路径不自动转换成下载地址。

保留原始文本复制。渲染异常或未知 part 显示可读降级信息，不吞掉整条消息。未知 part 不解释为成功终态。

### 6.2 增量更新与滚动

当前实现是 SSE 触发失效、250 ms 合并后重取快照；本轮可沿用这一方式实现持续更新，不增加假的逐字播放。按 `message.id + part.id` 更新同一对象，累计文本和工具输出采用替换，不能再次拼接整个快照。

正在生成且 Markdown 尚未闭合时，先稳定展示最新文本；消息完成后切换完整 Markdown。已完成消息不随新 token 整体闪烁或重置。避免每次快照刷新重新挂载工具详情。

初次进入最新轮次可定位底部；用户距底部 ≤ 64 px 时跟随输出，上翻后暂停，显示“有新进度”入口。保留现有跟随开关作为用户偏好，开启时仍尊重主动上翻。切换历史轮次恢复该轮次位置，不滚动外层页面或抢焦点。

屏幕阅读器只播报状态变化与新消息完成，不逐字播报整段内容。断线保留最后快照并显示陈旧状态；未收到终态不能宣称完成。

## 7. Tool 调用与结果

### 7.1 摘要与展开

每次真实调用一个工具条目，稳定标识采用 `message.id + part.id`，诊断保留 `toolCallId`。摘要依次为展开箭头、工具图标、名称、可选目标、状态、耗时。图标用 Lucide，未知工具用 Wrench；目标只取已知 input 字段，未知输入不猜路径。

成功调用默认折叠，运行中保持紧凑摘要；失败首次出现展开错误并保留用户后续折叠选择。展开状态不随轮询丢失。连续工具可提供“工具调用 N 次”的汇总入口，但不得跨越正文 / 审批合并，不能隐藏失败或待处理操作。

展开后依次为“结果”“输入”“诊断”。结果优先，输入 JSON 和调用 ID 次级；不再要求先读原始输入才能找到结果。

| Tool 状态 | 摘要 | 展开内容 |
| --- | --- | --- |
| pending | 中性时钟 + 待执行 | 已知输入；“尚未开始” |
| running | 蓝色加载图标 + 执行中 | 累计输出；有 startedAt 才显示已用时间 |
| completed | 绿色 Check + 已完成 | 真实输出；空字符串显示“无文本输出” |
| failed | 红色 CircleAlert + 失败 | 当前 output 作为错误详情；不捏造独立 errorCode |
| cancelled | 中性 Square + 已取消 | 保留已收到输出，不标成成功 |
| interrupted | 红色 CircleAlert + 已中断 | 明确结果不完整 |

耗时只用 `startedAt / finishedAt`；缺失显示“未知”，运行中可以本地计时并标为已用时间。工具完成不代表 Run 完成，更不代表交付物校验通过。

### 7.2 结果类型与边界

| 结果 | 当前可实施方式 | 后续增强条件 |
| --- | --- | --- |
| 普通文本、命令输出 | 纯文本预览；不解析 HTML，不执行 ANSI 控制命令 | 无 |
| JSON 文本 | 对完整、有界字符串使用 JSON.parse；成功则格式化，失败回退文本 | 不用正则或工具名称猜 JSON 结构 |
| 文件 | 使用本轮 artifacts 列表和已有下载接口 | 当前只有 runId 关联，不声称由某个 tool 生成 |
| 结构化表格 | 当前保持文本 / JSON；Markdown 表格由消息渲染器处理 | 需要可信列定义、行结构和大小边界 |
| Diff | 纯文本保留真实补丁内容 | 需要结构化路径、before/after 或受校验 patch；不提供虚假“应用”按钮 |
| 搜索来源、引用 | 普通链接可读 | 需要明确 sourceId / URL / 标题 / 来源范围，才能显示引用编号和 Context 条目 |

工具首屏最多展示 12 行或 4 KiB 文本，取先达到的边界，明确“预览已省略”。展开完整视图采用最大 320 px 高的局部滚动；超过 64 KiB 的正文分段加载到视图，每段 16 KiB，不一次挂载全部 DOM。此为展示预算，不是服务端数据上限；复制当前已接收全文与展示省略分开说明。

当前 ToolPart 没有 `truncated`、结果媒体类型、产物关联或 stdout/stderr 字段。不能把客户端折叠叫“服务端截断”，也不能从路径伪造全文下载。若需要大输出的完整保留与下载，先扩展契约、存储和适配器；未提供时明确只能查看当前已接收内容。

## 8. 人工交互与输入

复用现有 InteractionRow 的提交路径，在执行记录中增加待处理交互区域。因 Interaction 当前只有 runId 关联，该区域放在本轮执行区内，不强行插入某条 Tool 后面。交互标签保留完整历史，标签显示待处理数量，并提供到对应表单的定位入口。

权限显示请求标题、策略和真实动作范围；提供“允许本次”“始终允许”“拒绝”。“始终允许”的作用范围需由适配器语义核实后写明，不暗示跨任务永久授权，不默认选中。问题依据 `multiple / allowCustom / options` 渲染单选、多选、文本，使用有 legend 的字段组。

pending 可提交，replying 显示“正在提交”并锁定操作，resolved 展示决定及处理时间，expired 显示失效且不可再提交。网络错误保留输入；并发回复冲突重取真实状态。多个可见入口共用同一 Interaction 状态，避免同时出现两套可提交表单。

追加输入沿用 FollowUp 与 submit。输入区只提供真实可用的引擎 / 模型上下文、文本输入与提交命令；不增加没有接口的附件、语音、@ 来源或 / 命令。Enter 换行，显式按钮或 Ctrl/Cmd+Enter 提交，中文输入法 composition 期间不触发提交。

执行期间提交称“提交新一轮”，明确进入排队，不暗示修改正在执行的请求。停止对应当前 Session 的 abort 语义，确认框说明实际影响范围；收到请求成功后继续等待真实 stopping / cancelled 状态。网络重试复用 submissionId，不自动重放失败工具或整轮任务。

## 9. 任务列表、交付物与观测

任务列表复用现有 Table、搜索、Select 和游标分页。桌面优先显示标题 / 目录、状态、引擎 / 模型、最近活动、轮次与耗时；模型和路径完整值可通过键盘访问的详情查看。新建任务为唯一主按钮，刷新和翻页使用图标。自动更新稳定保留正在操作的行与筛选。

交付物优先显示名称、类型、大小、可用性、检查结果、预览 / 下载。`availability` 与 `validation` 分列，分别显示 available、missing、changed、unavailable 以及 not_checked、passed、failed。Run 已完成只标“执行完成”，检查 passed 只标“文件检查通过”。未知检查范围不写“业务验收通过”。文本沿用 1 MiB 预览上限，Office 文件提供下载。

观测保留当前四个 URL tab 值 `overview / engine / tools / errors`，文案统一为“运行概览 / 引擎与资源 / 工具与用量 / 异常与调用链”。每页用指标带、趋势区域、表格；无卡片墙。时间范围、指标与错误筛选写入 URL，切换标签保留这些参数。

自动刷新采用 Switch，关掉后停止该观测视图的定时更新，手动刷新仍有效；不关闭全局事件连接。最新采集时间始终可见，超过两次预期刷新间隔加 5 秒标为陈旧。没有样本、未知、不支持、未采集、陈旧和真实零各有文字，不一律填 0。

现有接口未完整提供的缺失原因只能显示“未知”，不能凭前端推断“不支持”。图表保留真实阶梯趋势，不加平滑效果修饰原始数据；提供可读数据表或摘要。错误跳到准确 Run，返回时恢复观测筛选。

## 10. 状态、交互与可访问性

| 语义 | 状态映射 | 图标 |
| --- | --- | --- |
| 执行中，info | running、starting、replying | LoaderCircle；减少动态模式下静止 |
| 成功，success | ready、completed、resolved | Check |
| 需关注，warning | waiting_input、stopping、deleting | MessageSquare / Square / Clock |
| 失败，destructive | failed、timed_out、degraded、unavailable、interrupted | CircleAlert |
| 中性，muted | queued、pending、not_started、cancelled、expired | Clock / Square |

状态映射集中在 workspace-ui，文字以 GLOSSARY 为准。resolved 仅说明交互已处理，具体允许 / 拒绝仍需显示 reply，不把绿色处理完成误解为批准。未知状态显示原始状态名及中性样式。

控件覆盖默认、hover、focus-visible、active、disabled、loading、error、success；不适用的状态在验收中标 N/A。按钮加载不改宽度；禁用原因在邻近文字或可访问说明中给出。表单错误关联 `aria-describedby` 和 `aria-invalid`。

焦点环立即出现，2 px、offset 2 px；图标动作有 aria-label 和 Tooltip，hover 延迟 800 ms、键盘焦点立即可用。Dialog 有标题与必要说明，关闭恢复触发点焦点。可见焦点不能被粘性输入区遮住。

动效只使用 CSS 的颜色 / opacity，120–180 ms，无页面入场动画、文字 shimmer、弹跳或 hover 缩放。`prefers-reduced-motion` 停止加载旋转，状态文字继续呈现；禁止 transition-all。保存、复制、安装等即时反馈统一使用 Sonner；持续状态及可恢复错误使用 Alert，字段错误使用 FieldError，危险确认使用 AlertDialog。

页面只显示任务、结果、状态和决策相关文字，不将设计理念、功能介绍或快捷键教学搬进产品。状态为空、加载失败、断线保留数据、无匹配项、任务被删除、文件失效分别设计。

## 11. Exports

本文是设计规则的权威记录；CSS 运行时唯一来源为 [tokens.css](code/web/src/tokens.css)，已由 index.css 接入。以下保留映射规格。P1 已从原 index.css 整理 token，保留 Tailwind、shadcn、字体导入和组件样式；不维护两套互相覆盖的调色板。浮层遮罩补充 `--overlay: #00000040`，只用于真实弹层。

### tokens.css / shadcn 映射

复用第三节已有 shadcn token 名称，填入浅色 :root 与 .dark 两组完整值。附属 token 按下列关系赋值，CSS 变量保存完整 CSS 颜色值，不使用裸 HSL / OKLCH 通道。

```css
:root {
  --card-foreground: var(--foreground);
  --popover-foreground: var(--foreground);
  --secondary-foreground: var(--foreground);
  --sidebar: var(--card);
  --sidebar-foreground: var(--foreground);
  --sidebar-primary: var(--primary);
  --sidebar-primary-foreground: var(--primary-foreground);
  --sidebar-accent: var(--accent);
  --sidebar-accent-foreground: var(--accent-foreground);
  --sidebar-border: var(--border);
  --sidebar-ring: var(--ring);
  --chart-1: var(--info);
  --chart-2: var(--success);
  --chart-3: var(--warning);
  --chart-4: var(--destructive);
  --chart-5: var(--muted-foreground);
  --radius: 0.5rem;
  --radius-control: 0.375rem;
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### Tailwind v4

保留 index.css 已有 `@theme inline` 映射；字体从第四节 token 接入，将原 `--font-sans` 的字面字体替换为 `var(--font-body)`，`--font-mono` 指向 `var(--font-code)`。新增状态映射示意：

```css
@theme inline {
  --color-info: var(--info);
  --color-info-soft: var(--info-soft);
  --color-success: var(--success);
  --color-success-soft: var(--success-soft);
  --color-warning: var(--warning);
  --color-warning-soft: var(--warning-soft);
  --color-destructive-soft: var(--destructive-soft);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-primary-hover: var(--primary-hover);
  --font-sans: var(--font-body);
  --font-mono: var(--font-code);
}
```

已有 `--color-accent` 是 shadcn 的选中 / 悬停背景，不能因 Hallmark 的 accent 命名习惯将它误改为品牌实色；品牌实色用 `--primary`。

### DTCG

仅供设计工具交换的映射样例，当前不引入 token 构建管线。完整导出应由第三节全量值生成，不能维护另一份手写真相。颜色和尺寸使用结构化值。[格式依据](https://www.designtokens.org/tr/drafts/format/)

```json
{
  "light": {
    "primary": {
      "$type": "color",
      "$value": { "colorSpace": "srgb", "components": [0.0156862745, 0.4705882353, 0.3411764706], "alpha": 1, "hex": "#047857" }
    }
  },
  "font": { "body": { "$type": "fontFamily", "$value": ["Geist Variable", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "system-ui", "sans-serif"] } },
  "radius": { "control": { "$type": "dimension", "$value": { "value": 6, "unit": "px" } } },
  "duration": { "fast": { "$type": "duration", "$value": { "value": 120, "unit": "ms" } } }
}
```

## 12. 验收与变更

统一检查 320、375、414、768、1024、1440、1920 px，保留现有 390 px 测试；浅 / 深两主题，跟随系统、键盘、200% 缩放及 reduced-motion 都须可用。截图至少覆盖任务列表、执行中、工具失败、待审批、长 Markdown、交付物和观测。

本轮已完成源码对照、颜色配对、静态检查、构建和浏览器交互验证；三页面在七个宽度、浅深色下的截图，以及字体放大、审批和文件场景见 [验收记录](code/artifacts/ui/README.md)。键盘焦点和 reduced-motion 已自动检查，Windows 实机、屏幕阅读器人工验收及双引擎真实任务验收仍需分别进行。新增结构化 Tool 结果或来源引用先补字段与样本；各页面不得自行编造状态或另建主题。
