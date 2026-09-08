# UI 组件统一规范与整改清单

基线：2026-09-07，React + shadcn/ui `base-nova` + Tailwind 4 + Lucide。

> 能用 shadcn/ui 的基础组件实现，就不自行造基础组件；业务组件基于 shadcn/ui 组合封装。

最新会话、thinking、Questionnaire、图表与控件复审见 [2026-09-08 改动复审](UI_REVIEW.md)。下方既有验收数据为上一轮记录。

## 组件边界

- 基础组件入口为 `code/web/src/components/ui`，只在此层对接 Base UI。业务组件复用已有 Status、IconButton、Choice、Failure、Blank，新增封装必须承载实际业务或重复组合。
- 业务页面禁止手写按钮、输入、选择、折叠、弹窗、菜单等基础交互，禁止 window.alert/confirm/prompt；路由链接保留链接语义。
- 组件层维护颜色、尺寸、焦点、禁用和状态变体；页面只调整布局。状态颜色来自 tokens.css，不能另写一套状态选择器。
- 字段使用 Field/FieldGroup/FieldSet/FieldLegend/FieldError，错误关联 aria-invalid 与 aria-describedby。请求错误保持可恢复的 Alert，不能用短暂 Toast 替代字段错误。
- 危险确认默认聚焦取消，提交期间禁止重复操作及关闭；失败保留弹窗，成功后关闭。删除文案明确数据范围及保留内容。
- Toast 在应用挂载一次，沿用 ThemeProvider；成功和短暂操作失败统一通过 Sonner。持续配置缺失、断线、待重启与陈旧数据使用 Alert，普通状态使用 Badge。
- 弹层使用 Base UI 的 render 组合 API，具有名称、说明和焦点恢复。不能由业务代码自行管理遮罩、焦点陷阱或层级。
- Markdown 正文表格、只读任务清单、复制降级用隐藏 textarea、原生下载链接属于内容/平台适配例外，不是可编辑业务控件。

## 选型

| 场景 | 组件及项目规则 |
| --- | --- |
| 按钮、图标操作 | Button；图标操作复用 IconButton + Tooltip |
| 单行、多行、组合输入 | Input、Textarea、InputGroup |
| 字段、字段错误 | Field、FieldGroup、FieldSet、FieldLegend、FieldError |
| 选择与搜索选择 | Select/Choice；模型与供应商使用 Base UI Combobox，支持键盘筛选 |
| 布尔、单选、多选 | Switch、RadioGroup、Checkbox；Agent 多题问答用 Questionnaire |
| 对话角色与气泡 | Message / MessageContent / MessageHeader、Bubble / BubbleContent |
| 图表 | ChartContainer / ChartTooltipContent，复用已安装的 Recharts |
| 即时反馈、持续提示、状态 | Sonner、Alert、Badge/Status |
| 危险确认、编辑及预览 | AlertDialog、Dialog |
| 侧面详情及移动导航 | Sheet；底部移动操作确有需求时使用 Drawer |
| 工具、输入、诊断、采样折叠 | Collapsible；多节高级配置按需使用 Accordion |
| 列表、独立信息卡 | Table；Card 只用于独立重复信息块，不包裹整个页面 |
| 更多操作、右键菜单 | DropdownMenu；ContextMenu 仅用于真实右键场景 |
| 标签视图、分隔、加载、分页 | Tabs、Separator、Skeleton、Pagination（保留游标语义） |
| 输出、日志、预览 | ScrollArea；ref/滚动事件绑定 viewport，保留跟随与历史位置 |
| 帮助及详情浮层 | Tooltip、Popover、HoverCard，按交互而非外观选择 |
| 其他按需组件 | Breadcrumb、Kbd、Calendar/DatePicker、Avatar、Progress；没有真实场景不安装，不伪造进度或导航层级 |

## 本轮改动点

| 状态 | 文件/边界 | 改动及验收 |
| --- | --- | --- |
| 已完成 | components/ui、package.json、pnpm-lock.yaml | 官方 CLI 添加 11 个 Base UI 风格组件，保留已定制组件，仅新增 sonner 运行依赖，复用现有主题 |
| 已完成 | workspace-ui.tsx | 通用危险确认、状态提示、搜索选择、可访问字段关联、复制 Toast；状态变体去重 |
| 已完成 | settings.tsx | 删除/卸载确认；编辑 Dialog；列表 Table/菜单；字段校验；保存 Toast 与持续 Alert 分离 |
| 已完成 | tasks.tsx | InputGroup 搜索、游标 Pagination、搜索选择、字段错误、缺失配置 Alert、路径 Tooltip |
| 已完成 | task.tsx | 停止/删除 AlertDialog、任务信息 Sheet、RadioGroup/Checkbox、禁用原因 Alert、ScrollArea 与预览 |
| 已完成 | tool-call.tsx | Collapsible 摘要/输入/诊断、Button trigger、ScrollArea 输出，保留失败展开和字节限额 |
| 已完成 | App.tsx、observability.tsx | 移动导航 Sheet、连接 Badge/Alert、全局 Toaster、陈旧 Alert、采样折叠与滚动 |
| 已完成 | index.css、eslint.config.js | 去除原生交互/状态重复样式，统一触控尺寸，静态规则阻止重新绕过组件层；ui-policy.test.ts 已通过 |
| 已完成 | browser.spec.ts、文档 | 取消/确认/失败/焦点、问答、模型筛选、复制、滚动、菜单、分页、桌面/窄屏/主题回归；最终 41 passed、3 skipped |

最终验收：前端类型检查、Lint、生产构建与组件边界规则测试通过；浏览器全量回归 41 passed、3 skipped（2.5 分钟）。跳过项为移动端不重复的两套截图矩阵和桌面内部滚动检查。主包约 646 kB，构建保留 500 kB 体积提示。截图和验证范围见 [验收记录](../../code/artifacts/ui/README.md)；未重新执行真实模型任务、Windows 实机或屏幕阅读器人工验收。

## 官方依据

通过项目锁定的 shadcn CLI 执行 search/docs/add --dry-run 并核对生成代码；不重新初始化 preset、不覆盖现有定制。

- [AlertDialog](https://ui.shadcn.com/docs/components/base/alert-dialog)、[Sheet](https://ui.shadcn.com/docs/components/base/sheet)、[Dialog](https://ui.shadcn.com/docs/components/base/dialog)
- [Combobox](https://ui.shadcn.com/docs/components/base/combobox)、[Checkbox](https://ui.shadcn.com/docs/components/base/checkbox)、[RadioGroup](https://ui.shadcn.com/docs/components/base/radio-group)、[Field](https://ui.shadcn.com/docs/components/base/field)
- [InputGroup](https://ui.shadcn.com/docs/components/base/input-group)、[Pagination](https://ui.shadcn.com/docs/components/base/pagination)、[Collapsible](https://ui.shadcn.com/docs/components/base/collapsible)、[ScrollArea](https://ui.shadcn.com/docs/components/base/scroll-area)
- [DropdownMenu](https://ui.shadcn.com/docs/components/base/dropdown-menu)、[Sonner](https://sonner.emilkowal.ski/)

注意：网站的 Base UI sonner 文档目前重定向到 Toast；本项目 CLI 仍提供 Sonner 注册项。本轮统一使用 Sonner，不同时维护两套 Toast。
