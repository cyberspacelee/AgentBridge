# AgentBridge Design System

版本：1.4 · 2026-09-09。整体风格已同步到 Web 与 Electron 共用前端；本轮验收见 docs/design/UI_DIRECTION.md。历史截图仅对应其记录日期。

本文统一企业 Agent 网关的视觉与组件规则。页面行为以 [FRONTEND.md](docs/design/FRONTEND.md) 为准，领域与线上字段以 [DOMAIN.md](docs/design/DOMAIN.md)、[CONTRACTS.md](docs/design/CONTRACTS.md) 和 [共享类型](code/shared/contracts.ts) 为准。施工范围、现状证据和验收见 [整改方案](docs/design/UI_REMEDIATION.md)。后续页面共用本系统，新增规则先修改本文。

## 1. 产品与设计方向

基础组件选型、业务封装边界和本轮迁移清单统一见 [UI 组件统一规范](docs/design/UI_COMPONENTS.md)。能用 shadcn/ui 实现的基础交互必须复用组件层。

AgentBridge 是 Agent 配置、任务执行、人工决策、结果交付与故障定位的工作台。优先服务三个连续流程：管理员连接模型、配置并启用 Agent；业务使用者提交要求、处理审批、取得文件；运维使用者查看可用性、定位失败执行、回到任务。

### 整体风格

**安静、清晰、有秩序的 Agent 工作空间。** 采用具有桌面工具感的现代极简风格：暖灰导航、纸白内容面、石墨灰文字、松绿色强调。通过稳定布局、留白和文字层级建立专业感。沿用 AgentBridge 字标、Network 品牌图标与 Lucide 线性图标。

会话以阅读与输入为中心，管理以扫描与配置为中心。所有页面共用表面层级、标题起点、控件尺寸与交互反馈；通过内容组织区分页面职责。风格关键词为克制、柔和、精确、内容优先。

- 导航退居背景，主内容保持连续。用背景层级与细分隔组织空间，避免双侧栏长期挤占正文。
- 松绿集中在品牌、主要动作和焦点；选中项使用低饱和背景，正常历史状态降低强调，异常和待回复优先突出。
- 页面标题、正文、辅助信息保持明确主次。避免到处粗体、过密小字、重复标题和图标按钮堆叠。
- 控件适度圆角，表格和列表平直连续。阴影只用于浮层，不使用渐变、玻璃效果、装饰光晕或卡片套卡片。

风格形成依据与本轮截图问题见 [整体设计方向记录](docs/design/UI_DIRECTION.md)；本文为统一规则的权威来源。

### 页面职责与交互约束

| 页面 | 首要判断 | 首屏内容 | 次级内容 |
| --- | --- | --- | --- |
| 会话 | 要完成什么、与哪个 Agent 对话 | 历史会话、新会话输入、Agent 与必填目录、当前对话 | 模型与策略、执行记录 |
| Agent 管理 | 谁可用、缺什么配置 | Agent 状态、模型、配置入口 | 进程、路径、修订号 |
| 共享资源 | 哪些连接可复用 | 资源列表、添加、逐模型测试、引用关系 | 协议参数、原生配置导入 |
| 运行观测 | 谁异常、怎样定位 | 各 Agent 健康与异常入口 | 趋势、资源、调用链 |
| 系统信息 | 网关运行在哪里 | 实例与服务器目录、带单位的运行限制 | 配置版本 |

- Agent 详情默认进入模型配置；模型、Skills、MCP、运行标签写入 URL。共享资源入口携带来源 Agent 和标签，保存后可返回继续分配。
- Agent 列表、Agent 选择器、详情标签各承担一种导航职责，不把资源类别与具体 Agent 混排。手机不通过导航换行增加层级。
- Agent 草稿仅包含资源引用和交互策略，按网关实例与 Agent 保存在 sessionStorage，支持切页和刷新恢复。密钥及资源表单不持久化到浏览器；关闭已修改的资源表单须确认。
- 服务端配置变动不能静默覆盖草稿。同一字段冲突时明确提示；保存继续使用后端 revision 校验，失败保留输入。停用状态由生命周期操作控制，不能被旧草稿覆盖。
- 配置状态为未保存、已保存待应用、应用中、已生效或失败。使用固定操作栏集中保存、保存并应用／启用、撤销；异步请求受理不显示完成提示，最终状态来自 Agent 快照。
- 没有可用 Agent 时，任务空状态提供配置入口；没有兼容模型时提供模型连接入口；搜索无结果与首次无数据使用不同文案。
- MCP 使用命令、独立参数和键值行编辑；服务器目录明确标注归属。技术标识、数值单位、错误原因与操作范围必须准确。
- 完整对话下，任务状态和执行状态分层呈现；单次执行状态放在对应分隔处。用量和诊断明确当前统计范围，不能用最近一次执行冒充整段对话。
- 手机顶栏保持单行；Agent 主操作可达，正文不被多层标题推到首屏下方。表格可转为有标签的行，长路径和密钥不撑开布局。

### 设计验证

参考 [Vercel 的 design.md 实践](https://vercel.com/blog/how-our-agents-build-on-brand-pages-with-design-md)：判断原则归本文，重复布局与行为归现有组件／CSS，可检查失败归测试。固定首次配置、草稿离开与恢复、外部配置冲突、应用失败、资源返回、长对话审批和手机操作场景，以相同数据与视口保留前后截图。人工评估下一步是否可发现、信息是否有主次、状态是否可信；不新增独立设计评测平台。

- Genre：modern-minimal；应用结构：Workbench。暖灰导航、纸白阅读面、石墨灰文字、松绿主动作；浅深色具有一致的表面层级。
- 品牌延续当前 AgentBridge 字标、Network 图标及绿色线索。绿色用于主命令与品牌，运行状态另设蓝色，已完成历史使用低强调中性样式。
- 页面第一层回答“当前是什么任务 / 网关处于什么状态”，第二层提供操作，第三层才展示详细轨迹与原始数据。
- 卡片限于单个工具、审批、文件等有明确边界的对象。页面分区使用无外框区域或横向分隔，不堆卡片、不嵌套卡片。系统设置页按用户要求使用 shadcn Card 分组下载源、代理、证书、连接测试与实例信息；Collapsible 收起证书、连接测试、程序路径和运行限制，统一保存与重启操作，不嵌套 Card。
- 一实例展示四个 Agent 的真实启用和健康状态；任务固定绑定一个 Agent。企业感来自信息准确与操作可追踪，不新增租户、组织、计费、工作流画布或虚构 Agent 团队。

## 2. Provenance

用户指定 [Beautiful UI](https://beautiful-ui-five.vercel.app/) 为当前项目的公开设计参考；2026-09-06 该地址重定向至 [beautifului.dev](https://www.beautifului.dev/)。本系统由 AgentBridge 的既有设计和业务约束制定，参考组件的组织方式，不复制其品牌、示例业务或整站布局。

参考站 HTML/CSS 可确认：Inter 与 JetBrains Mono；浅色页面 `oklch(98.5% .001 286.376)`、蓝色强调 `oklch(62.6% .205 254.947)`；侧边组件索引加连续示例分区。参考组件包括工具摘要、审批、流式消息及代码块。[来源](https://www.beautifului.dev/)

本轮研究为静态 HTML/CSS 分析，未执行参考站脚本；不能据此宣称已验证动画、交互或实际视觉节奏。AgentBridge 保留已安装的 Geist，采用自己的颜色与尺寸。参考站的斜纹底、展示编号、负字距、较大圆角和装饰加载效果不进入工作台规范。

## 3. 色彩

以下为目标值，sRGB HEX 是精确值，避免实施时再次凭视觉选色。仅在 token 定义中写原始颜色，组件使用语义变量。浅深色使用相同的语义映射。

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--sidebar` | `#F3F4F2` | `#181B19` | 导航与应用底层 |
| `--background` | `#FCFCFA` | `#202421` | 连续主内容面 |
| `--foreground` | `#202622` | `#EDF0EC` | 正文、标题 |
| `--card`, `--popover` | `#FFFFFF` | `#282D29` | 工具面板、弹层、输入表面 |
| `--muted`, `--secondary` | `#F3F4F2` | `#282D29` | 表头、用户消息、代码底色 |
| `--muted-foreground` | `#646D66` | `#A7B0A9` | 时间、单位、说明 |
| `--border` | `#DEE3DD` | `#3B443D` | 装饰分隔，不作为唯一控件边界 |
| `--input` | `#7B857D` | `#7F8D82` | 输入框、单选、多选边界 |
| `--primary`, `--ring` | `#286047` | `#92CEAA` | 主命令、品牌、焦点 |
| `--primary-foreground` | `#FFFFFF` | `#18281E` | 主按钮文字 |
| `--primary-hover` | `#214E3B` | `#A6DABA` | 主命令 hover / active |
| `--accent` | `#E5ECE5` | `#303D33` | 选中导航、选项背景 |
| `--accent-foreground` | `#286047` | `#92CEAA` | 选中导航文字 |
| `--info` / `--info-soft` | `#1D4ED8` / `#EFF6FF` | `#93C5FD` / `#172554` | 执行中、普通链接 |
| `--success` / `--success-soft` | `#166534` / `#F0FDF4` | `#86EFAC` / `#142B20` | 已完成、已就绪 |
| `--warning` / `--warning-soft` | `#92400E` / `#FFFBEB` | `#FCD34D` / `#302411` | 等待回复、待处理 |
| `--destructive` / `--destructive-soft` | `#BE123C` / `#FFF1F2` | `#FDA4AF` / `#351820` | 失败、删除、风险 |
| `--destructive-foreground` | `#FFFFFF` | `#351820` | 实心危险按钮文字 |

品牌强调应只占少量面积，不将整个侧栏、整条消息或整块图表染绿。链接同时有下划线或明确链接语义；状态同时有文字与图标。

图表通过官方 shadcn ChartContainer / ChartTooltipContent 组合现有 Recharts。`--chart-1` 至 `--chart-5` 分别映射 info、success、warning、destructive、muted-foreground；每个指标保持固定色义，并有名称、单位和线型 / 点型，不能靠颜色猜测系列。禁止在 `.trend` 内重新定义固定绿色。

对比度按本版不透明颜色计算：主按钮文字浅 / 深 7.36 / 8.55，hover 文字 9.47 / 9.81；次级文字相对主内容面 5.21 / 7.06；输入边界相对输入表面 3.82 / 4.03。必要元信息不额外降低透明度。仅说明 token 配对符合目标，不代替实际页面验收；透明度、叠层、hover 和组件组合仍需检查。目标为正文 4.5:1、重要图形及控件边界 3:1。

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
| Agent 长文 | 桌面 15 / 26 px，窄屏 16 / 26 px | 400 | 对话列最大 800 px，正文不超过 72ch，并受容器约束 |
| 元信息、状态 | 12 / 18 px | 400 / 500 | 禁止 10 / 11 px 承担必要信息 |
| 代码、路径、ID | 13 / 20 px | 400 | 等宽；表格数字使用 tabular-nums |
| 指标数值 | 28 / 36 px | 600 | 单位降为 12 px；窄屏 24 / 32 px |

所有字距为 0，标题正体。不用 vw / cqw 缩放字体。长标题允许自然换行；无空格长词使用 `overflow-wrap: anywhere`，父容器 `min-width: 0`。

间距共用 Tailwind 的 4 px 刻度：4、8、12、16、24、32、48 px，对应 `gap-1/2/3/4/6/8/12` 等。控件内部 8 / 12，消息段落 12，消息之间 24，页面区块之间 24 / 32。桌面页面边距 24，窄屏 16。

圆角：按钮与普通输入控件 8 px，工具 / 审批 8 px，组合对话输入面与弹层 12 px，状态标签 4 px；圆点与头像可圆形。页面分区与连续列表保持平直，不把普通按钮变成胶囊。阴影只用于浮层，不用于每张工具行。

尺寸：桌面按钮与输入默认高 36 px，紧凑图标按钮 32 px，导航与侧栏底部操作行高 40 px；触控操作区域至少 44 px。图标采用 Lucide 线性风格，常规 16 px，主要导航可用 18 px。表头 36 px，任务行最小 56 px，工具摘要行最小 40 px。长内容允许行增高，图标、状态、操作列不被挤压。

## 5. 应用布局

统一壳层：单一左侧栏、顶部上下文、连续主内容。主入口为会话、Agent 管理、共享资源、运行观测；系统信息为辅助入口。会话模块将主导航与历史合并进同一侧栏，取消主导航之外常驻第二根历史栏的设计。

| 宽度 | 导航 | 主内容 | 任务信息 |
| --- | --- | --- | --- |
| ≥ 1280 px | 272 px 统一侧栏，可收为 64 px | 24 px 页边距，管理页最大 1500 px，对话列最大 800 px | 280 px 右栏，默认收起；正文不足 720 px 时使用弹层 |
| 1024–1279 px | 默认 64 px 图标栏，可展开统一侧栏 | 24 px 页边距，对话随可用宽度收缩 | 按需打开信息弹层 |
| 768–1023 px | 顶栏入口打开统一导航 Sheet | 24 px 页边距 | 按需打开信息弹层 |
| < 768 px | 56 px 顶栏 + 统一导航 Sheet | 16 px 页边距，单列 | 信息入口打开弹层 |

主内容列统一 `minmax(0, 1fr)`。桌面顶栏 56 px，仅展示当前上下文、必要操作、低强调连接状态与主题。引擎和模型靠近对话标题或输入区，存储类型、Instance ID 放诊断信息。连接异常在当前可视区升级为明确提示，不要求滚至页尾。不重复堆叠“会话 / 完整对话 / 对话”等同义标题。

侧栏从上到下为品牌、主模块导航、当前模块上下文、底部辅助操作。会话上下文包括新会话、搜索、状态筛选和按更新时间分组的历史列表。历史区域独立滚动，主导航与底部操作固定可达。图标栏提供直接打开历史的入口；窄屏的主导航与历史入口打开同一个 Sheet，并定位相应区域，不叠加两个导航抽屉。

系统信息与折叠操作位于侧栏底部。展开时使用“图标 + 文字”整行按钮，统一行高、左右缩进与图标起点；收起时使用居中的图标与 Tooltip，操作含义和焦点状态保持清楚。折叠操作保留 aria-expanded、可访问名称和布局偏好。

主题提供浅色、深色、跟随系统三个选项，沿用 ThemeProvider 存储。新会话以简短标题和组合输入面为视觉中心，下接 Agent、目录和高级设置，避免排列成多个同等强调的大表单区。默认选择就绪的默认 Agent，也可选择其他就绪 Agent；已创建会话不允许更换引擎。必填工作目录在首次提交前始终可发现，标题、模型与策略放在“模型与会话设置”。Header 不提供与当前内容无关的刷新。

任务详情的空间顺序：

```text
统一侧栏（272 px） | 当前会话标题 / 状态 / 必要操作
品牌与主导航      | 对话 / 交付物 / 交互 / 诊断 · 执行筛选
新会话与搜索      | 连续正文（最大 800 px）       | 按需任务信息
按时间分组的历史  | 用户要求 / Agent 回答        | 引擎 / 模型
  标题            | 工具摘要 -> 展开结果与输入   | 工作目录
  Agent / 时间    | 待处理交互 -> 就地回复       | 用量 / 时间
  活动或异常状态  | 本轮文件 / 新进度入口        |
系统信息          |                              |
收起侧栏          | 追加输入 / 模型上下文 / 发送  |
```

这是结构示意，不是应用截图。执行正文不包进大卡片，工具面板内部用小标题和分隔线分区。

执行消息是任务详情页的主工作区。执行页使用壳层分配的可用视口高度，消息区域 `min-height: 0; overflow-y: auto`，输入区作为同一 flex 列的固定兄弟元素，不覆盖最后一条消息。桌面执行筛选和标签共用一行；窄屏降低筛选控件宽度，标签文字保持单行，避免多层工具栏挤占正文。任务信息默认收起；专注阅读收起任务标题、标签导航和信息栏，保留本轮状态、跟随开关、退出入口与追加输入。新进度入口悬浮于消息区底部，出现时不改变正文高度。输入条按内容增高，上限为 160 px 或 20dvh 中较小值，避免长草稿挤空消息区。窄屏同样由动态视口和 flex 分配剩余空间，不使用固定 `65svh`；输入区始终保持可达。

表格、代码块各自允许局部横向滚动；页面本身不可横向滚动。根节点可用 `overflow-x: clip` 作边界防护，但不能用它隐藏溢出的按钮或必要内容。窄屏任务列表改为单列紧凑行，标题、状态、模型和时间可读，其余字段在详情查看。四个详情标签在 320 px 仍须完整可用；长观测标签窄屏改为具名 Select。

## 6. 消息与执行过程

### 6.1 内容层次

默认展示完整对话，执行筛选仅在用户选择后限制 Message 范围，并保持消息和 parts 的服务端顺序。消息使用官方 shadcn Message，用户要求用 Bubble secondary；Agent 回答用无外框正文。角色、时间与复制操作共用统一消息头，避免每条消息配装饰头像。

| 内容 | 展示规则 | 数据来源 |
| --- | --- | --- |
| 用户消息 | 保留换行的纯文本，不解释成可执行内容 | `Message.role=user`、`TextPart.text` |
| 思考过程 | 官方公开的 reasoning/thinking 内容，默认折叠、可展开；不推测未提供的内容 | `ReasoningPart.content` |
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

## 9. 历史会话、管理列表、交付物与观测

历史会话复用路由链接、ScrollArea、搜索、Select 和游标分页，不采用多列表格。按本地日期组织“今天 / 昨天 / 更早”时间组；标题优先，最多两行，Agent 与更新时间为次级。当前项同时使用选中背景和字重，完整名称通过键盘与指针可访问。已完成记录使用中性图标与文字，执行中、失败和待回复保持明确状态色。时间分组仅组织当前已加载页，不暗示已加载所有历史。

搜索无结果与首次无会话使用不同文案。切换历史会话保留搜索、状态和分页参数，切换对话标签不清除历史筛选；新会话入口明确回到创建视图。自动更新稳定保留正在操作的行与筛选，不在鼠标或焦点下重排。

Agent 与共享资源使用连续表格或列表，以名称、可用性和操作为主，模型、路径与版本为次级；完整值通过可访问详情查看。统一页面标题起点、工具栏间距与列对齐。系统设置保持单层 Card 分组、字段标签和集中保存反馈，低频配置使用 Collapsible。

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

状态语义映射集中在 workspace-ui，文字以 GLOSSARY 为准。上表表示语义色；历史列表中的 completed 使用中性低强调呈现，仍显示“已完成”和 Check，不改变领域状态，也不降低异常及待回复的显著性。resolved 仅说明交互已处理，具体允许 / 拒绝仍需显示 reply，不把绿色处理完成误解为批准。未知状态显示原始状态名及中性样式。

主操作使用实心松绿按钮，同一操作区域只突出一个主动作；次级操作使用中性弱底色或描边，辅助操作使用文字或具名图标按钮。危险操作在明确动作和确认处使用红色强调，必要入口不依赖 hover 才出现。

控件覆盖默认、hover、focus-visible、active、disabled、loading、error、success；不适用的状态在验收中标 N/A。按钮加载不改宽度；禁用原因在邻近文字或可访问说明中给出。表单错误关联 `aria-describedby` 和 `aria-invalid`。

焦点环立即出现，2 px、offset 2 px；图标动作有 aria-label 和 Tooltip，hover 延迟 800 ms、键盘焦点立即可用。Dialog 有标题与必要说明，关闭恢复触发点焦点。可见焦点不能被粘性输入区遮住。

动效只使用 CSS 的颜色 / opacity，120–180 ms，无页面入场动画、文字 shimmer、弹跳或 hover 缩放。`prefers-reduced-motion` 停止加载旋转，状态文字继续呈现；禁止 transition-all。保存、复制、安装等即时反馈统一使用 Sonner；持续状态及可恢复错误使用 Alert，字段错误使用 FieldError，危险确认使用 AlertDialog。

页面只显示任务、结果、状态和决策相关文字，不将设计理念、功能介绍或快捷键教学搬进产品。状态为空、加载失败、断线保留数据、无匹配项、任务被删除、文件失效分别设计。

## 11. Exports

本文是设计规则的权威记录；CSS 运行时唯一来源为 [tokens.css](code/web/src/tokens.css)，已由 index.css 接入，目前仍为旧版值。本版实现时按第三节同步该文件及既有组件样式；下方为目标映射，不表示代码已更新。不维护两套互相覆盖的调色板。浮层遮罩补充 `--overlay: #00000040`，只用于真实弹层。

### tokens.css / shadcn 映射

复用第三节已有 shadcn token 名称，填入浅色 :root 与 .dark 两组完整值。附属 token 按下列关系赋值，CSS 变量保存完整 CSS 颜色值，不使用裸 HSL / OKLCH 通道。

```css
:root {
  --card-foreground: var(--foreground);
  --popover-foreground: var(--foreground);
  --secondary-foreground: var(--foreground);
  /* --sidebar 在浅深色主题内分别使用第三节值，不与 card 共用。 */
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
  --radius: 0.75rem;
  --radius-control: 0.5rem;
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
  --radius-sm: calc(var(--radius-control) / 2);
  --radius-md: var(--radius-control);
  --radius-lg: var(--radius);
  --radius-xl: var(--radius);
}
```

已有 `--color-accent` 是 shadcn 的选中 / 悬停背景，不能因 Hallmark 的 accent 命名习惯将它误改为品牌实色；品牌实色用 `--primary`。

### 2026 官方实践与本项目样式边界

检索日期：2026-09-08。依据 shadcn/ui 当前官方文档、2026 年 CLI 更新及 Tailwind CSS v4 文档。下列文件归属和限制是 AgentBridge 的工程选择；官方提供主题、组合与层叠机制，不规定本项目配色、侧栏宽度或页面结构。

| 层级 | 唯一职责 | 修改位置 |
| --- | --- | --- |
| 设计规则 | 风格、语义、尺寸、状态与验收依据 | 根目录 design.md |
| 运行时 token | 浅深色值、字体、圆角和动效值 | `code/web/src/tokens.css` |
| Tailwind 接入与壳层 | `@theme inline` 映射、基础元素、共享布局与断点 | `code/web/src/index.css` |
| 基础控件 | Button、Input、Select、Dialog 等的尺寸、变体与交互状态 | `code/web/src/components/ui/` |
| 业务组合 | 状态、工具结果、消息、目录选择等已有业务语义 | `code/web/src/components/` |
| 页面 | 内容、数据与布局，选择已有控件变体 | `code/web/src/pages/` |

**1. 使用语义 token 和前景 / 背景配对。** shadcn 推荐 CSS 变量主题；同一组件使用 `bg-primary text-primary-foreground` 等语义类名，浅深色覆盖对应变量。项目保持 `cssVariables: true`，页面不写临时 HEX 或各自一套 `dark:bg-*` 色板。`components.json` 记录生成配置，实际定制颜色以 tokens.css 为准。[shadcn Theming](https://ui.shadcn.com/docs/theming)

**2. Tailwind v4 使用 CSS 主题接口。** 需要生成 utility 的设计值通过 `@theme` 暴露；映射其他 CSS 变量时使用 `@theme inline`，普通运行时变量保留在 `:root` / `.dark`。保持当前 CSS 入口，不为主题增加一份 v3 风格 JS 配置。Web/Desktop 共用同一前端入口与 token 文件。[Tailwind Theme variables](https://tailwindcss.com/docs/theme)

**3. 统一组件变体，按真实复用提取。** 基础控件的颜色、字号、圆角和交互状态由其 `variant` / `size` 负责；沿用现有 CVA 与 cn，不新增替代库。页面的 `className` 主要处理宽度、排列、间距。跨页面重复的结构优先组合已有 React 组件；同一文件内简单布局无需为少量重复另造抽象。官方允许局部 utility 覆盖，本项目对基础控件外观采用更严格的集中管理规则。[shadcn Button](https://ui.shadcn.com/docs/components/base/button)、[Tailwind Managing duplication](https://tailwindcss.com/docs/styling-with-utility-classes#managing-duplication)

**4. 明确 CSS 层叠归属。** 元素默认值放 `@layer base`，确需共享的布局类放 `@layer components`，局部布局用 utility。自定义 utility 确有需要时使用 `@utility`。`@apply` 可用于既有共享布局，但不把所有 utility 包装成另一套 CSS 类。避免在文件末尾反复追加同名规则、通过深层选择器修改控件内部或依赖 `!important` 修补；普通未分层声明会压过分层声明，调整时先确认真正生效来源。[Tailwind Adding custom styles](https://tailwindcss.com/docs/adding-custom-styles)

**5. 暗色模式只使用一个状态来源。** ThemeProvider 控制根节点 `.dark` 与系统偏好；业务组件消费同名语义 token。Tailwind 的 `dark:` 机制本身有效，基础组件确有独立状态差异时可集中使用；业务页不再实现第二个主题开关或重复计算系统主题。[Tailwind Dark mode](https://tailwindcss.com/docs/dark-mode)

**6. 尺度和生成结果都要可检查。** 字体、行高、间距、圆角、控件高度和断点使用本规范的有限尺度。颜色等动态分支映射到完整静态类名，不拼接 `bg-${color}-500`；Tailwind 按源码文本检测类名。来自运行时的真实动态数值可使用受控 CSS 变量，不因框架扫描限制改动业务数据。[Tailwind Detecting classes](https://tailwindcss.com/docs/detecting-classes-in-source-files)

**7. 2026 preset 用于可复现配置，现有定制按差异维护。** CLI v4 提供 preset 和项目上下文能力；2026 年 4 月起 `apply --only theme` / `--only font` 可局部应用 preset。当前已有 base-nova、Base UI、Geist 和自定义状态色，本次按确定的 token 更新，不重新初始化或整包覆盖控件。以后引入 registry 组件先核对 Base UI、图标和语义 token，再审查 diff。`shadcn info` 检出的 preset 含 fallback 时不能当作自定义主题的精确备份。[CLI v4](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4)、[Partial Preset Apply](https://ui.shadcn.com/docs/changelog/2026-04-partial-preset-apply)

### 当前工程的实现边界

已通过本地 CLI 核对：Vite、Tailwind v4、base-nova / Base UI、Lucide；项目已具备单一 token 文件、ThemeProvider、CVA 变体与基础组件边界 ESLint 规则。无需新增主题框架。

- 本版浅深色 token 已同步到 tokens.css；页面通过语义类消费，不补局部颜色。
- index.css 已映射 `--radius-md: var(--radius-control)` 对应 8px，`--radius-lg` / `--radius-xl: var(--radius)` 对应 12px。其他较大派生圆角仅在确有对应组件需求时使用。
- index.css 的共享规则已统一到 components 层并合并同级重复选择器；响应式布局优先在调用点使用 utility，避免与控件内置 utility 争夺显示方式。
- 当前 ESLint 主要限制绕过基础组件，并未自动检查全部颜色、间距与圆角规则。沿用现有检查和浏览器测试，增加与实际改动对应的断言；不能把 lint 通过当作全局风格一致的证明。
- 代表性验收应同时展示 Button / Input / Select / Tabs / Badge 的主要状态，以及侧栏、历史、对话、管理表格和设置表单。浅深色、窄屏、键盘和错误状态共用同一检查清单。

### Electron 窗口与滚动基线（2026-09-09）

Web 与打包后的 Electron 加载同一份生产 CSS、字体和控件，不引入桌面专用色板。保留原生标题栏、窗口按钮、系统菜单与快捷键；窗口初始隐藏，在 ready-to-show 后展示。nativeTheme.themeSource 与持久化的浅色 / 深色 / 跟随系统同步；系统主题变更同步更新窗口底色。主进程启动背景的两个颜色常量镜像 tokens.css 的 background，并由包体冒烟检查一致性，避免跨进程增加主题生成管线。[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)、[nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme)

Electron 底部提供 32px 最小高度的状态栏，显示唯一一处网关事件连接和应用版本；异常说明仍在内容上方展开。状态栏不随正文滚动，也不覆盖输入区。Web 保留顶栏连接状态，二者复用同一事件状态源。

主内容使用原生滚动，scrollbar-gutter: stable both-edges 在经典滚动条环境预留两侧空间，保持居中且避免列表长短变化导致跳动；系统叠加滚动条仍遵循平台行为。scrollbar-color 消费现有语义 token，保留默认滚动条宽度与系统高对比适配。历史、消息等已有 Base UI ScrollArea 保留原生滚动能力，统一 12px 轨道和清晰滑块，不叠加第二条原生滚动条，不全局隐藏滚动条，不拦截滚轮模拟滚动。[MDN scrollbar-gutter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-gutter)、[scrollbar-width](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-width)、[Base UI Scroll Area](https://base-ui.com/react/components/scroll-area)

验收覆盖 Linux 实际目录包、760×560 内容视口、浅深色与跟随系统、侧栏切换、滚动区、状态栏、重启后的偏好恢复。Windows/macOS 窗框与系统菜单由对应操作系统绘制，需在目标平台实测，不从 Linux 截图推断一致外观。

### DTCG

仅供设计工具交换的映射样例，当前不引入 token 构建管线。完整导出应由第三节全量值生成，不能维护另一份手写真相。颜色和尺寸使用结构化值。[格式依据](https://www.designtokens.org/tr/drafts/format/)

```json
{
  "light": {
    "primary": {
      "$type": "color",
      "$value": { "colorSpace": "srgb", "components": [0.1568627451, 0.3764705882, 0.2784313725], "alpha": 1, "hex": "#286047" }
    }
  },
  "font": { "body": { "$type": "fontFamily", "$value": ["Geist Variable", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "system-ui", "sans-serif"] } },
  "radius": { "control": { "$type": "dimension", "$value": { "value": 8, "unit": "px" } } },
  "duration": { "fast": { "$type": "duration", "$value": { "value": 120, "unit": "ms" } } }
}
```

## 12. 验收与变更

统一检查 320、375、414、768、1024、1440、1920 px，保留现有 390 px 测试；浅 / 深两主题，跟随系统、键盘、200% 缩放及 reduced-motion 都须可用。截图至少覆盖任务列表、执行中、工具失败、待审批、长 Markdown、交付物和观测。

本版只完成设计文档调整与基础颜色配对计算，单侧栏、时间分组、底部按钮及新表面样式均待实现和截图验收。验收需覆盖展开 / 收起导航、同一 Sheet 的历史入口、搜索后切换会话、长标题、输入区与按需任务信息，确认没有必要操作被遮挡。旧版静态检查、构建、浏览器交互与截图见 [历史验收记录](code/artifacts/ui/README.md)，这些结果不证明本版设计已实现。Windows 实机、屏幕阅读器人工验收及真实引擎任务验收需分别记录。新增结构化 Tool 结果或来源引用先补字段与样本；各页面不得自行编造状态或另建主题。

## 2026-09-08 会话与控件复审补充

页面 h1 统一桌面 24/32、窄屏 20/28，区域 h2 16/24，弹窗标题 18/28，均正体。普通输入与下拉统一 36 px 高、8 px 圆角和 card 背景，组合对话输入面使用 12 px 圆角并随文本增高，窄屏操作目标至少 44 px；文本输入窄屏 16 px 防止缩放。聚焦采用 1 px 语义边框加 2 px ring 色外环，焦点指示与相邻背景对比至少 3:1，InputGroup 只由外层绘制焦点，选中值本身不增加常驻边框；失焦后恢复普通边框，错误状态保留红色和文字。

问题使用官方 Questionnaire，支持逐题、单选、多选、自由回答与上一题；服务端不允许跳过的题目不展示 Skip。审批仍为本次允许、始终允许、拒绝，不能套用问卷后改变授权语义。
