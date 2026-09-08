# AgentBridge 开发规范

更新日期：2026-09-05。适用于网关、引擎适配器及前端开发。先审阅 [完整设计基线](docs/design/README.md)，按统一术语、Domain、接口、页面和验收约束开展业务实现；分阶段施工不缩小完整前后端交付范围。赛题原始 schema 到位后补充契约测试，不能将设计中的假设视为已验证要求。

当前已实现四 Agent 网关、任务工作台、观测与 Electron；Web/Desktop 共用业务与启动管理。本地验证不能代替 Windows 沙箱验收。

## 1. 技术基线

| 范围 | 决策 |
| --- | --- |
| 前端 | React + TypeScript + Vite，单应用 |
| UI 组件 | shadcn/ui，底层选择 Base UI，配置 `base-nova` |
| 交互原语 | `@base-ui/react`；禁止新增 Radix 组件、依赖或 `asChild` 用法 |
| 样式 | Tailwind CSS 4 + `@tailwindcss/vite`，CSS 变量驱动主题 |
| 图标 | `lucide-react`，复用已安装图标 |
| 包管理 | pnpm 10.33.2 workspace，统一提交 `code/pnpm-lock.yaml` 和 `code/pnpm-workspace.yaml` |
| 网关 | 本次设计选择 TypeScript + Fastify，Node.js 24 LTS 为交付目标 |
| 领域与存储 | 纯 Domain 类型/转换，Application 编排；默认 SQLite 事务与迁移 |
| 首批引擎 | OpenCode、Pi，通过统一适配契约接入 |

shadcn 负责提供可维护的组件源码，Base UI 负责交互行为，Tailwind 负责样式。业务组件依赖本地 `components/ui`，不在业务页面重复封装底层交互。

shadcn 初始化版本为 4.21.0，本地 Node.js 为 22.23.0；包管理已统一为 pnpm 10.33.2，并在 packageManager 字段固定。具体依赖以 pnpm 锁文件为准；当前脚手架不能按赛题建议的 Node.js 18 环境直接假定兼容。交付时统一选择并验证 Node.js 版本，记录在 `INSTRUCTION.md`。

## 2. CLI 初始化与日常命令

以下初始化命令用于没有 `code/web` 的新目录；已有工程不要重复初始化。

```sh
# 在项目根目录执行，code 不存在时先创建
mkdir code
cd code
pnpm dlx shadcn@4.21.0 init --template vite --base base --preset nova --name web --no-monorepo --yes
```

本工程先由 CLI 创建，随后按 Base UI 选型通过 CLI 切换并重新生成按钮。最终配置为 `base-nova`，组件代码使用 `@base-ui/react/button`。上述命令是新工程的直接初始化方式；重建现有工程应使用已提交源码和锁文件，CLI 版本固定并不意味着远程模板与 registry 内容永久不变。

依赖在 workspace 根目录 `code` 安装，以下命令同时适用于 Bash 和 PowerShell：

```sh
corepack pnpm install --frozen-lockfile
pnpm web:dev
pnpm --filter @agentbridge/web typecheck
pnpm --filter @agentbridge/web lint
pnpm web:build
```

- 使用 `pnpm install --frozen-lockfile` 按统一锁文件安装；Corepack 根据 packageManager 选择固定版本。需要新增依赖时，后端用 `pnpm add -w <package>`，前端用 `pnpm --filter @agentbridge/web add <package>`，并审阅锁文件变化。
- 不混用 npm/yarn，不提交其他包管理器锁文件。pnpm 生命周期脚本按 workspace 的 onlyBuiltDependencies 明确放行，新增原生依赖时验证 Windows 安装行为。
- `typecheck` 使用 `tsc -b`，覆盖应用与 Vite 配置两个 TypeScript project reference。
- 前端 build 产物位于 `code/web/dist`；在前端目录运行 `pnpm preview` 仅用于本地检查构建结果。
- 格式化使用现有 Prettier 配置；在前端目录对本次修改文件执行 `pnpm exec prettier --write <files>`。
- 生产环境同源提供静态资源和 API；开发代理到实际网关地址，避免页面硬编码端口。

## 3. 组件管理与 Base UI 约束

先查现有组件，再读对应 Base UI 文档，通过 CLI 按需添加。命令在 `code/web` 执行，使用已安装的 CLI：

```sh
pnpm exec shadcn info --json
pnpm exec shadcn docs dialog
pnpm exec shadcn add dialog --dry-run
pnpm exec shadcn add dialog
```

- `info` 应显示 `base: base`、`style: base-nova`、`tailwindVersion: v4`。
- 文档必须选 Base UI 版本。不得从 Radix 示例复制 `Slot`、`asChild` 或不匹配的状态选择器。
- 组合渲染按对应组件的 `render` API 使用；不是把所有 Radix 属性机械重命名。
- 导航使用链接语义。按钮外观的链接使用 `<a className={buttonVariants(...)}>`，不要用 Base UI Button 渲染链接并覆盖其语义。
- 更新已有组件先执行 `pnpm exec shadcn add <component> --diff`；确认本地定制后再覆盖。不要批量安装全部组件或手工从网络复制 registry 源码。
- 保留组件的标题、描述、焦点管理、键盘操作和 ARIA 属性。Dialog 关闭后应恢复触发元素焦点。
- 图标按钮必须有可访问名称；需要解释的图标提供 Tooltip。表单输入绑定 Label，错误与输入关联。
- `components/ui` 可维护，但修改必须是通用组件需要。业务状态、API 调用、引擎名称不得进入该目录。

## 4. Tailwind CSS 与布局

入口为 `src/index.css`，Vite 使用 `@tailwindcss/vite`。使用 Tailwind 4 的 `@import "tailwindcss"`、`@theme inline` 与 CSS 变量；不沿用 Tailwind 3 的初始化教程，不额外生成无用途的 `tailwind.config.js` 或 PostCSS 配置。

- 语义颜色统一使用 `bg-background`、`text-foreground`、`text-muted-foreground`、`border-border` 等 token。新增状态色同时定义浅色和深色，不在每个页面写一套颜色。
- 动态状态用完整类名映射，不能拼接 `bg-${color}-500` 这类构建工具无法可靠发现的类名。
- 保留 `#root { isolation: isolate; }`，配合 Base UI Portal 的层叠布局。不要依赖任意大的 `z-index` 修复弹层。
- 排版以任务扫描、日志定位、指标比较为主；使用侧栏、表格、分隔线与紧凑工具栏。页面分区不包成层层嵌套的卡片。
- 使用固定字号与明确断点；长文件名、中文路径和错误信息需要换行或可展开。表格在窄屏允许局部横向滚动。
- 表单状态与数值不能仅靠颜色表达。趋势图提供单位、时间范围、图例和可读的数据摘要或表格。
- 保留可见焦点和减少动画偏好，不用加载动画遮掩失败或断线。

## 5. 代码分层与文件归属

按实际功能创建目录，不预先建立空模块。下列是文件归属规则，并不表示业务文件已经实现。

| 位置 | 职责与限制 |
| --- | --- |
| `code/web/src/App.tsx` | 应用组合入口；后续挂载任务与观测路由 |
| `code/web/src/components/ui/` | CLI 引入的通用组件；不请求 API |
| `code/web/src/components/` | 已出现复用需求的应用组件 |
| `code/web/src/features/tasks/` | 任务列表、分派、详情、轮次、交互和产物 |
| `code/web/src/features/observability/` | 总览、引擎工具、资源连接、异常调用链 |
| `code/web/src/lib/` | 有明确复用需求的 HTTP、事件连接和工具函数 |
| 网关协议接入层 | 校验、HTTP/SSE 序列化、兼容路由；不处理引擎原生事件 |
| 会话执行层 | 队列、状态、取消、收尾、快照与自动交互 |
| 引擎适配层 | 原生协议、会话映射、事件翻译和引擎能力差异 |

组件使用 PascalCase，普通变量与函数使用 camelCase，沿用脚手架文件风格。TypeScript 开启 strict；外部 JSON 先按 `unknown` 处理并在边界校验，不用 `any` 或类型断言掩盖缺失字段。

前端不导入 Node.js 进程模块、引擎 SDK、密钥配置或后端实现。两端只共享或生成引擎无关的协议类型。Domain 不依赖 HTTP、数据库或引擎 SDK；Application 调用领域转换并管理 I/O 与事务。路由、全局状态、图表等依赖在实际功能需要时再引入；不要预建通用仓储、事件框架和插件市场。

新增 Agent 必须实现统一适配契约、独立处理事件翻译和进程生命周期，再加入启动注册与契约测试。不得让现有网关路由或前端散布 `if (engine === ...)` 协议分支。

## 6. 任务与观测数据规范

单个前端应用提供 `/tasks`、`/tasks/:id` 和 `/observability`。任务详情属于任务工作台；观测模块提供整体指标、日志与调用链。

- 前端任务提交走应用 API，接受后返回 202；评测 `prompt_async` 按规范阻塞并返回 204。两者共用执行层队列。
- 浏览器关闭或 SSE 断线不取消任务。按钮置灰只改善交互，提交去重由服务端持久化 submissionId 保证；requestId 仅关联单次 HTTP 请求。
- 服务端快照是状态来源。按架构约定处理实例标识与 revision，断线补快照；不能仅凭 SSE 中出现 `idle` 就判定任务成功。
- 每个前端应用共享一条事件连接，组件卸载清理订阅；以 eventId 去重，保留窗口内回放，窗口外恢复快照。revision 是事务修订号，不能用于丢弃同一事务中的后续事件。
- 任务失败、取消、超时是不同终态；错误应显示可定位的错误码与 requestId，不输出密钥或完整堆栈。
- 页面区分加载、空列表、请求失败、未连接、数据陈旧和能力不支持。未采集的成本、token 或指标不能显示为 0。
- 指标单位、时间窗口、统计分母和采集时间明确；成功率、吞吐、排队与执行耗时分别计算，遵循架构中的指标定义。
- sessionId、runId、路径、prompt 不作为 metrics label；放入受控日志或 trace 关联字段，避免高基数。
- 只展示真实启用引擎。历史保留原 engineId，跨引擎对比只使用真实留存数据；不把默认持久化偷偷改为内存降级。
- 产物通过已登记 ID 获取，前端不传任意绝对路径读取服务器文件。

## 7. 安全、异常与跨平台

- `VITE_*` 会进入浏览器构建结果，仅允许公开配置。模型密钥、引擎凭证和权限策略由服务端保存。
- 模型输出、文件名、日志和产物均是不可信数据；默认按文本渲染。需要 Markdown 时关闭原始 HTML 或使用经过配置的净化方案。
- HTTP 输入、目录范围、产物下载和引擎返回值在边界校验。统一错误码，前端根据状态码与错误码处理，不解析自由文本推断状态。
- 引擎恢复不得自动重放可能已产生副作用的整轮任务。取消需要确认并处理迟到事件，完成事件只收尾一次。
- Windows 路径使用结构化 JSON 序列化与标准路径 API；不得靠字符串替换反斜杠。子进程按参数数组传参，不能把用户目录拼进 shell 命令。
- 环境变量的 PowerShell 写法为 `$env:AGENT_ENGINE = "opencode"`；Pi 为 `"pi"`。实际服务启动命令待网关实现后写入交付说明，并支持 `--engine` 覆盖环境变量。
- 自动权限和反问策略由网关配置统一管理；页面不是无人评测流程的必要参与者。

## 8. 验证与提交

前端提交至少通过 `pnpm typecheck`、`pnpm lint`、`pnpm build`，在 code/web 执行；也可从 workspace 根目录通过 --filter 指定前端。格式化仅覆盖本次改动文件。纯初始化阶段不为静态示例增加测试框架。

实现业务时按风险补充可运行验证：

| 变更 | 最小验证重点 |
| --- | --- |
| 任务 API 或执行层 | 接受与完成、逐会话串行、跨会话并发、失败与取消不误报成功 |
| 引擎适配器 | 同一契约套件分别跑 OpenCode/Pi，覆盖事件翻译、退出和超时 |
| SSE 或快照 | 断线重连、重复与迟到事件、缺口恢复、网关重启 |
| 权限或反问 | 自动回复、人工覆盖与并发回复只生效一次 |
| 交互组件或页面 | 键盘和焦点、桌面与窄屏、浅深色、错误与空状态 |
| 文档工具与路径 | 中文目录、空格、反斜杠，以及输出文件内容与结构 |

PR 说明具体问题、最终行为、验证结果与未验证环境。涉及协议、启动步骤、依赖或分层变更时同步更新文档。Windows 验收需在真实 Windows 10/11 环境执行，不能以 Linux 构建成功代替。

不提交密钥、`node_modules`、运行日志和测试产物。最终 `solution.zip` 的 `INSTRUCTION.md` 应包含双引擎无交互启动、完成判定与依赖安装步骤；本文不代替尚未完成的交付说明。

## 9. 官方依据

2026-09-05 核对以下官方文档，升级时重新核实对应 API：

- [shadcn CLI](https://ui.shadcn.com/docs/cli)：初始化支持显式指定组件底层，组件可通过 CLI 预览与添加。
- [shadcn Vite 安装](https://ui.shadcn.com/docs/installation/vite)：Vite、路径别名与 Tailwind 集成。
- [shadcn Base UI Button](https://ui.shadcn.com/docs/components/base/button)：Base UI 按钮与链接组合的语义约束。
- [Base UI 快速开始](https://base-ui.com/react/overview/quick-start)：安装包、无样式组件及 Portal 根节点隔离。
- [Tailwind CSS 的 Vite 集成](https://tailwindcss.com/docs/installation/using-vite)：官方 Vite 插件和 CSS 导入方式。
