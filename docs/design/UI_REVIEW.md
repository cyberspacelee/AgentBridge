<!-- Hallmark · pre-emit critique: P4 H4 E4 S4 R4 V4 -->
# 会话与共享控件改动复审

日期：2026-09-08。按 Hallmark 的 modern-minimal / Workbench 规则审视本轮 diff，并沿用根目录 design.md。页面、表单、历史消息与诊断各有职责；不套用营销页的配图、宏结构轮换或大标题规则。

## 复审发现与修正

| 严重程度 | 位置 | 发现 | 修正 |
| --- | --- | --- | --- |
| major | App.tsx、index.css | 删除刷新后，旧的 `:last-child` 移动端规则误隐藏主题按钮 | 删除与 DOM 顺序绑定的隐藏规则，保留窄屏主题入口 |
| major | tasks.tsx | 历史链接拼接漏空格，当前会话选中态失效 | 使用 cn 组合类名，活动会话使用统一 accent |
| major | tasks.tsx | 会话列表收到快照后可能在鼠标或焦点下重排 | 保留原列表的固定顺序策略，离开列表后更新排序 |
| minor | index.css | 新会话 h1 未在 page-heading 下，继承成普通正文大小 | 将 h1 字号设为公共基础规则，桌面 24/32、窄屏 20/28 |
| minor | ui/input、input-group、select、textarea | 控件的圆角、底色和焦点环不一致 | 统一 6px 圆角、card 背景；焦点环 2px，组合输入内层不重复画环 |
| major | task.tsx | Questionnaire 单选切回选项后残留自定义文字，过期题目整题消失 | 控制自定义输入清空；过期后展示只读问题和未回答状态 |
| minor | agent-message.tsx | 正在执行工具时仍可能把思考内容标成“生成中” | 不从整条消息的完成状态推断 thinking 的活动状态 |

发现 0 critical · 4 major · 3 minor；上述问题均已修正。功能及截图验证结果见下方，不以修正记录冒充浏览器验收。

## 逐页组件审视

| 页面 / 边界 | 组件选择与结论 |
| --- | --- |
| 会话 `/tasks` | 用 InputGroup 直接开始对话，Select 选择就绪 Agent，Collapsible 收起模型/策略；历史列表用路由链接、ScrollArea、Pagination，窄屏 Sheet。名称由首条消息生成，可手填覆盖 |
| 会话详情 `/tasks/:id` | 官方 Message / Bubble 渲染角色与正文；thinking 与工具用 Collapsible；问答用 Questionnaire；停止/删除仍用 AlertDialog；文件和诊断沿用 Table / Dialog / ScrollArea |
| Agent 列表及详情 | 已有 Table、Tabs、Switch、Checkbox、Combobox、Dialog、Skeleton，继续复用；应用操作用 Rocket，加载服务器配置用具名文字按钮 |
| 共享资源 / resource-editor | 已有 Tabs、Table、Dialog、Field、Input、Combobox，保留资源引用和密钥处理；无需另造配置表单系统 |
| 运行观测 | 从直接使用 Recharts 容器和手写 tooltip 样式改为官方 ChartContainer / ChartTooltipContent；继续使用已有 Recharts 曲线、坐标轴及可访问采样表 |
| 系统信息 | 已用 Card / Collapsible / Skeleton；系统配置刷新为具名按钮，Header 不承担此操作 |
| 网络设置 | 已用 Card、Field、Checkbox、InputGroup、Collapsible、Dialog；重启使用 Power，不再使用刷新图标 |
| 网关设置 | 已用 Card / Field / Dialog；复用共享字段焦点和标题规则 |
| CLI 安装与版本 | 已用 Tabs / Badge / Field / Button；检查更新用 PackageSearch，与安装 Download、删除 Trash2 区分 |
| 全局导航 | 移动端沿用 Sheet，菜单沿用 DropdownMenu，提示沿用 Tooltip；路由链接与网格布局保留原生语义。折叠按钮移至桌面侧栏底部，移除重复品牌图标 |

业务组件继续负责 API、消息 part 分派、工具输出限额和审批权限语义；这些能力不是基础视觉组件的替代品。保留原有滚动位置、跟随输出和 SSE 快照逻辑，避免换消息组件时丢失行为。

## 数据与边界

- Pi thinking、OpenCode reasoning、Codex reasoning summary、Grok agent_thought_chunk 映射到 ReasoningPart。只显示引擎明确提供的内容，不推测隐藏思考。
- reasoning JSON 完整存入现有 text 存储家族，既有数据库无需重建；HTTP/SSE 与回读保留 reasoning 判别字段。
- Questionnaire 支持逐题、单选、多选和自由回答；保留失败后的填写内容及已回复结果。不提供后端契约不支持的跳过操作。
- 新增运行依赖仅为官方 Questionnaire 所需的 `@shadcn/react`。Recharts 保持原版本，未覆盖已有 shadcn Button/Card。

## 验证

- 后端 `pnpm typecheck`、前端 ESLint、TypeScript 与生产构建均通过，`git diff --check` 无错误。
- 单元及协议/存储测试：65 通过、6 跳过、0 失败；覆盖四种引擎的 reasoning 事件，以及消息存储和 API 回读。
- 浏览器共 82 项：最终 78 项通过、4 项跳过。完整运行先得到 76 通过、4 跳过、2 失败；两处失败均为旧测试未适配移动端历史抽屉（空状态匹配隐藏副本、未打开抽屉即查找会话）。修正定位后，相关流程及新增截图的 8 项定向回归全部通过。4 项跳过为移动项目中不重复运行的跨尺寸矩阵/滚动检查，相关检查已在桌面项目执行。
- 响应式矩阵覆盖 320、375、414、768、1024、1440、1920 px 与浅深色；另检查键盘焦点、IME、防止误提交、字体放大、reduced-motion、工具输出限额及独立滚动。
- 已人工查看桌面/窄屏的新会话、折叠导航、输入聚焦、思考展开、问卷选中、工具错误及观测截图；本轮复审没有遗留的 critical / major 问题。

代表截图：[新会话桌面](../../code/artifacts/ui/tasks-light-1440.png)、[320 px](../../code/artifacts/ui/tasks-light-320.png)、[输入焦点](../../code/artifacts/ui/qa/field-focus-desktop.png)、[思考内容](../../code/artifacts/ui/qa/reasoning-desktop.png)、[移动端问卷](../../code/artifacts/ui/qa/questionnaire-mobile.png)、[深色执行区](../../code/artifacts/ui/execution-dark-320.png)。

截图使用测试服务和明确的测试样本；未执行真实外部模型任务、Windows 实机及人工屏幕阅读器验收。

## 官方组件依据

[Message](https://ui.shadcn.com/docs/components/base/message)、[Bubble](https://ui.shadcn.com/docs/components/base/bubble)、[Questionnaire](https://ui.shadcn.com/docs/components/base/questionnaire)、[Chart](https://ui.shadcn.com/docs/components/base/chart)、[InputGroup](https://ui.shadcn.com/docs/components/base/input-group)、[Select](https://ui.shadcn.com/docs/components/base/select)。通过官方 CLI 添加源码，逐个核对 Base UI 的组合 API。
