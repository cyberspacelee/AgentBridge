<!-- Hallmark pre-emit critique: Philosophy 4, Hierarchy 4, Execution 4, Specificity 4, Restraint 5, Variety 3. -->
# 逐页 QA 与问题记录

## 2026-09-08 配置与工作台体验整改

本次按用户任务重新组织界面。设计判断和状态规则归入 `design.md`，交互由现有 shadcn 组件承担；前后截图与行为测试分别记录，不以测试通过代替设计验收。

- Agent 默认进入模型配置，首次无模型时提供直接操作；共享资源独立导航，并携带来源 Agent 与标签返回。
- 引用与策略草稿按实例保存在当前浏览器会话，切页、刷新和远端冲突均保留输入。资源密钥不进入浏览器缓存，关闭已修改的资源表单需确认。
- 保存、应用与启用集中在底部操作栏。异步受理不代表生效，操作中的锁定与最终失败均由状态快照确认，去掉遮挡操作栏的配置成功浮层。
- MCP 使用命令、参数与键值行；模型连接可以选择具体模型测试并在行内查看结果；系统信息使用带单位的运行限制。
- 完整对话与单次执行的状态、错误和用量范围分开；手机顶栏收紧为 56px，任务标签与执行筛选合并为一行。
- 观测接口的全部范围返回各 Agent 状态，单值 health 为 null，禁止用默认 Agent 冒充整体健康。无执行样本和真实零值分别呈现。

同一全停用、无模型配置下的对比：[Agent 手机整改前](redesign-before-agent-390.png) / [整改后](redesign-agents-pi-390.png)，[观测桌面整改前](redesign-before-observability-1440.png) / [整改后](redesign-observability-1440.png)。另记录实际入口的 1440、390、320px 下五类页面，共 15 张 `redesign-*.png`；均为同一隔离预览实例，无真实密钥。几何检查无横向溢出、顶栏为 56px，浏览器无页面异常。

交互截图使用隔离测试引擎：[首次启用失败手机](agent-activation-failed-mobile.png)、[草稿恢复桌面](agent-draft-desktop.png)、[运行配置手机](agents-runtime-mobile.png)。这里验证的是界面状态处理，不将模拟失败当成真实模型供应商验收。

验证结果：后端完整回归 34 passed / 1 failed / 6 skipped，失败项为错误文案更新后的旧断言；改为检查 CONFLICT 错误码后，配置模块 3 项复测通过，合计覆盖 35 个通过用例。浏览器完整回归 46 passed / 2 failed / 4 skipped，两个失败均定位到资源标签退出面板短暂残留；共享层隐藏 inert 面板后，Agent／任务／观测标签流程 6 项定向复测通过，合计覆盖 48 个通过用例。类型检查、前后端构建、前端 lint 与 `git diff --check` 通过。6 项原生 CLI 集成测试本轮按默认条件跳过，4 项手机矩阵跳过项已由桌面项目执行跨视口矩阵。

预览使用独立数据目录和全停用配置，仅检查配置与状态，未写入真实模型凭据或启用 Agent。验证服务已按要求停止。

## 2026-09-08 统一 Agent 管理

本次替代旧配置页面的模型、Skill、MCP 和个人目录约定：`/agents` 管理四个 Agent 与共享资源，`/settings` 只展示系统诊断。Pi 任意插件安装和个人原生目录挂载入口已移除。下面较早的配置页、插件页、地址与启动命令仅为历史记录。

完整回归：后端 35 passed / 6 skipped，浏览器 44 passed / 4 skipped；跳过项按测试环境定义记录。Pi/OpenCode 的原生生命周期和本地模型工具流程、Codex/Grok 的原生模型与重启恢复分别单独通过。四个 CLI 均验证选中 Skill 可见、未选中项目 Skill 不可见；具体原生与外部验收边界见 [交付记录](../../../../docs/design/DELIVERY.md)。类型检查、lint、前后端构建及差异格式检查通过。

新增管理流程覆盖模型连接编辑、模型分配、Skill/MCP 引用、保存/应用、停用/启用、错误与配置冲突。多次执行默认连续显示，切换执行筛选后只保留对应消息；已修正筛选切换时重复挂载对话的问题。桌面/手机截图人工检查无内容遮挡或横向溢出。

截图：[Agent 列表桌面](agents-list-desktop.png)、[Agent 列表手机](agents-list-mobile.png)、[运行详情桌面](agents-runtime-desktop.png)、[运行详情手机](agents-runtime-mobile.png)、[模型表单桌面](agents-model-form-desktop.png)、[模型表单手机](agents-model-form-mobile.png)。数据均来自隔离测试配置。

另用实际生产入口与全停用配置检查桌面 1440x1000、手机 390x844：四个 Agent 开关、系统设置和页面请求正常，无 JavaScript 错误或横向溢出。预览启动在 `http://127.0.0.1:3000/agents`，使用 `/tmp/agentbridge-preview.jjWOGJ` 独立数据目录，不复用旧数据库或个人模型配置；实际进程是否仍运行以当前环境为准。

## 2026-09-07 配置页面

补充验证：同供应商配置两个模型，分别保存 32000/4096 与 200000/16384 的上下文/最大输出限制；重新编辑第二个模型并刷新后保留独立数值，删除行与取消编辑在桌面/手机均通过（配置页专项 2 passed）。后端完整回归 23 passed / 4 skipped；另外启用两个原生引擎的本地模型测试，验证正常工具调用及 401 拒绝，任务错误和运行日志均包含拒绝原因并隐藏测试密钥，数据库与事件记录读取后仍保留错误详情。目录消失的产物扫描警告保留 ENOENT/路径且不阻止模型执行；另检查 Windows EPERM 文本、网络底层原因、stderr 截断及凭据脱敏。Windows 实机的原始失败原因尚待部署更新后复测，未启动常驻服务。

新增 `/settings`，覆盖兼容模型增删改、密钥掩码与保留、Skill 目录启停、OpenCode MCP 配置和 Pi 插件目录/安装入口。桌面 1440 × 1000、手机 390 × 844 的保存、刷新、编辑和删除流程通过，截图检查无横向溢出。浏览器完整回归 33 passed / 3 skipped，后端 19 passed / 4 skipped；另外分别启用两个原生引擎的本地模型测试，均完成真实进程的工具调用和手动权限交互。临时本地 Pi 插件完成安装、实际加载和卸载验证。第三方 MCP/subagent 插件及真实供应商未逐一验收。

构建、前端 lint 和差异格式检查通过。此轮曾通过 <http://127.0.0.1:3000/settings> 验证真实页面入口，托管 OpenCode 使用 4097，避免占用已有的 4096 服务；验证服务已按要求停止。下文启动配置和临时目录属于历史验收记录，不表示目前仍有服务运行。

截图：[模型桌面](settings-models-desktop.png)、[模型手机](settings-models-mobile.png)、[表单桌面](settings-model-form-desktop.png)、[表单手机](settings-model-form-mobile.png)、[MCP 桌面](settings-mcp-desktop.png)、[MCP 手机](settings-mcp-mobile.png)、[Pi 插件桌面](settings-pi-desktop.png)、[Pi 插件手机](settings-pi-mobile.png)。使用隔离测试数据，未显示真实密钥。

## 2026-09-06 历史验证

日期：2026-09-06。页面测试数据为隔离测试引擎和显式样本；另对真实 Pi 0.85.1 网关完成浏览器检查，并在修正认证配置后完成真实模型最小请求验证。

结果：累计记录的 17 项功能/布局和局域网兼容问题已修复并复测。本轮完整回归与修正后的定向复测合并覆盖 31 个通过的浏览器用例、3 个按项目规则跳过的用例；最后的布局与任务流程定向回归为 7 passed / 1 skipped。后端测试 17 passed / 4 skipped，补充的双引擎观测复测 2 passed；前后端构建、前端 lint、`git diff --check` 均通过。

验证时服务监听 `0.0.0.0:3000`，Pi 0.85.1 和 OpenCode 1.18.29 同时就绪，使用独立 SQLite 数据目录。`--engine pi` 指定未显式选引擎时的默认值，新任务可独立选择任一引擎。

已通过局域网访问完成 Chromium 检查：真实非安全 HTTP 上下文下，页面、SSE、侧栏、观测选择器和友好 404 正常；提交测试请求到达后端并按预期拒绝不存在的工作目录，没有调用真实模型，页面无 JavaScript 异常。复制降级在桌面/手机回归中通过实际复制粘贴验证。另一个局域网设备的连通性由用户验收。

启动命令：在 `code/` 执行 `AGENT_DATA_DIR=/tmp/agentbridge-ui-qa-live.No4Dx9 ENGINE_B_CONFIG_DIR=/home/cyberspace/.pi/agent pnpm start --engine pi --host 0.0.0.0 --port 3000`。

验收追踪：初次启动遗漏 `ENGINE_B_CONFIG_DIR`，独立临时 Pi 配置无认证信息，用户提交任务触发 `No API key found for the selected model`，网关将其概括为 `Pi prompt failed`。健康检查仅验证 Pi 程序可启动，不能证明模型调用成功。现已接入本机已有 Pi 配置并重启，默认模型为 `opencode-go/deepseek-v4-flash`；直接 Pi 请求和局域网网关任务均返回 `OK`。网关验证运行 `ee75c017-a287-4526-bc89-16f3efa58013` 状态为 `completed`、错误为空，未调用工具。历史失败记录保留，需重新提交任务验证后续执行。

本轮真实验证：通过局域网页面的新建表单分别选择 Pi 和 OpenCode，供应商选择 `opencode-go`、模型选择 `deepseek-v4-flash`，两项任务均返回 `OK`，状态 `completed`、错误为空，浏览器无 JavaScript 异常。Pi 任务 `a7d988ac-d852-45ab-8d49-607364b26e58`，OpenCode 任务 `35625e57-2468-4bd3-92d2-4f1f3fbe610f`。目录接口实际读取 Pi 27 个模型、OpenCode 97 个模型，只返回供应商 ID、模型 ID 和显示名称，不返回凭据。未逐一验证目录中所有模型的额度和可用性。

本轮布局：顶部仅保留事件连接状态，引擎健康状态保留在观测页。移除应用页脚，应用固定为视口高度；任务分页固定于内容区底部，空态填满剩余空间，长列表、执行输出与详情在各自区域滚动。320 × 640 等紧凑视口中，统计与列表确实放不下时允许标签内容区内部滚动，页面根节点、顶部和侧栏不随之滚动。

## 截图索引

本目录包括逐页视口截图、前轮长页补充截图、真实网关截图和前轮总览拼图。原 `../` 目录中的页面/主题矩阵和审批、执行截图已更新；总览拼图及旧 `-full` 文件保留为历史对比。

本轮证据：[空列表桌面](fixed-list-empty-desktop.png)、[少量数据桌面](fixed-list-short-desktop.png)、[长列表桌面](fixed-list-many-desktop.png)、[空列表手机](fixed-list-empty-mobile.png)、[模型选择桌面](engine-model-selection-desktop.png)、[模型选择手机](engine-model-selection-mobile.png)、[无模型手机](model-empty-mobile.png)、[交付物空态](empty-artifacts-mobile.png)、[交互空态](empty-interactions-mobile.png)、[工具空态](empty-tools-mobile.png)、[异常空态](empty-errors-mobile.png)、[真实 Pi 模型选择](live-pi-model-selection.png)、[真实 OpenCode 模型选择](live-opencode-model-selection.png)、[Pi 完成](live-pi-completed.png)、[OpenCode 完成](live-opencode-completed.png)。

| 页面 / 状态 | 桌面证据 | 手机证据 |
| --- | --- | --- |
| 任务列表 | [1440 浅色](../tasks-light-1440.png) | [320 浅色](../tasks-light-320.png) |
| 任务执行 | [1440 浅色](../execution-light-1440.png) | [320 浅色](../execution-light-320.png) |
| 交付物 | [1440](artifacts-light-1440.png) | [320](artifacts-light-320.png) |
| 交互记录 | [1440](interactions-light-1440.png) | [320](interactions-light-320.png) |
| 诊断 | [1440](diagnostics-light-1440.png) | [320](diagnostics-light-320.png) |
| 运行概览 | [1440](../observability-light-1440.png) | [320](../observability-light-320.png) |
| 引擎与资源 | [1440](engine-light-1440.png) | [320 全页](engine-light-320-full.png) |
| 工具与用量 | [1440](tools-light-1440.png) | [320](tools-light-320.png) |
| 异常与调用链 | [1440](errors-light-1440.png) | [320](errors-light-320.png) |
| 创建与校验 | [表单](create-desktop.png) | [表单](create-mobile.png)、[校验错误](create-invalid-mobile.png) |
| 空结果 | [桌面](tasks-empty-desktop.png) | [手机](tasks-empty-mobile.png) |
| 侧栏 / 导航 | [收起](sidebar-collapsed.png)、[1024 展开](sidebar-expanded-1024.png) | [导航弹窗](navigation-mobile.png) |
| 任务信息 | [收起](task-info-collapsed.png) | [320 × 640 弹窗](task-info-mobile.png) |
| 引擎选择 | [下拉菜单](engine-select-desktop.png) | [下拉菜单](engine-select-mobile.png)、[请求失败](engine-error-mobile.png) |
| 真实服务 | [Pi 就绪](live-pi.png)、[OpenCode 未连接](live-opencode.png) | 未作真实手机设备验收 |

总览：[桌面](gallery-light-1440.png)、[手机浅色](gallery-light-320.png)、[手机深色](gallery-dark-320.png)。长页面先审查首屏，再查看同名 `-full.png`；下拉菜单和弹窗仅截视口，避免全页截图改变浮层布局。

## 验证清单

| 页面 / 状态 | 功能验证 | 视觉验证 |
| --- | --- | --- |
| 全局导航 | 桌面收起/展开、刷新记忆、手机菜单、主题、路由 | 内容区居中、折叠图标居中、顶栏和按钮对齐 |
| 任务列表 | 搜索、状态、分页、空结果、刷新、创建表单与校验 | 桌面表格、手机任务行、搜索图标、空态、弹窗 |
| 任务详情 | 轮次、执行输出、工具展开、跟随、追加、停止、删除、信息面板 | 四个标签页、长文本、信息面板、弹层和操作栏 |
| 交付物 / 交互 / 诊断 | 下载预览、文件不可用、审批与回答冲突、过期、调用链 | 有数据/空态、图标文本、窄屏表格 |
| 观测四个视图 | Pi/OpenCode 筛选、URL 恢复、时间/指标/异常筛选、暂停/刷新、错误保留快照 | 四个子视图、下拉层、图表、指标、异常行 |
| 异常路径 | 非法标签参数、网络失败、空数据、浏览器前进后退 | 错误提示、空态与返回入口 |

基础页面矩阵：320、375、414、768、1024、1440、1920，浅色/深色。六个详情/观测子视图分别覆盖 320、375、414、768、1440，浅色/深色。额外检查 320 × 640 信息弹窗、字体放大、键盘焦点与 reduced-motion。

逐页检查使用点击、输入、回车、选择和浏览器前进/后退。几何断言检查页面横向滚动、可见操作是否越界、搜索图标和折叠导航图标的中心、宽屏内容中心及弹窗边界。截图复核包括首屏、长页面下部、深浅主题、有数据/空态/异常，以及展开后的控件。

探索检查发现了搜索无法回车提交、搜索历史不同步、非法 tab 空白和长路径弹窗问题，均加入回归。复核截图未见操作控件越界、文本重叠或文件名/工具名被挤碎的问题。真实 Pi 浏览器检查没有 JavaScript 异常。

## 问题与修复

| 编号 | 问题与原因 | 修复 / 复测结果 |
| --- | --- | --- |
| QA-01 | 桌面侧栏无控制，1024–1279px 强制折叠 | 增加收起/展开按钮、可访问名称、提示和本地状态记忆；跨页面、刷新、1024 展开及手机导航通过 |
| QA-02 | 观测仅显示当前引擎，历史统计未过滤 | 增加全部/Pi/OpenCode 选择；统计、工具、用量、趋势、异常按会话引擎过滤；URL 恢复、切换后失败不保留其他引擎快照通过 |
| QA-03 | 搜索图标使用固定顶部距离，控件高度变化后偏上 | 搜索按钮随输入框等高、图标垂直居中；桌面/手机中心偏差小于 1px |
| QA-04 | 搜索仅首次读取 URL，前进/后退后值不同步 | 按 URL 查询值同步输入草稿；前进、后退后输入和结果一致 |
| QA-05 | 非法详情 tab 导致空白 | 校验标签参数，非法值回退执行记录；浏览器断言通过 |
| QA-06 | 搜索框回车不发起查询 | 表单增加真正的搜索提交按钮；回车和点击统一走提交逻辑，搜索、空结果、分页、状态筛选通过 |
| QA-07 | 手机交付物文件名被挤碎，异常列表多列难读 | 窄屏使用带字段标签的行布局；文件、状态、操作和调用链链接完整可见 |
| QA-08 | 长路径下任务信息弹窗可能超过屏幕 | 限制到 90svh 并允许内部滚动；320 × 640 居中和边界、Escape 后焦点恢复通过 |
| QA-09 | 手机顶栏控件紧贴屏幕顶部 | 恢复上下 8px 留白；主题和刷新按钮、品牌、连接状态无重叠 |
| QA-10 | 320px 工具用量表把短工具名拆行 | 工具名占整行，下方并排三个统计字段；浅色/深色截图复核通过 |
| QA-11 | 局域网 HTTP 没有 `crypto.randomUUID`，任务无法提交 | 使用 HTTP 也可用的 `getRandomValues` 生成 128 位随机提交 ID；创建操作、提交 ID 格式和局域网后端校验通过 |
| QA-12 | 局域网 HTTP 没有 Clipboard API，复制按钮抛异常 | 使用原生复制降级并恢复焦点；桌面/手机实际复制粘贴、失败提示和原安全上下文复制回归通过 |
| QA-13 | 未知根页面显示 JSON 错误 | 浏览器访问未知页面展示友好 404 和返回入口；HTTP 状态仍为 404，API/资源的 JSON 404 不受影响 |
| QA-14 | 顶部“已连接”和“就绪”并排，状态层级重复 | 顶部只保留事件连接状态，观测页显示所选引擎健康状态；桌面、手机截图通过 |
| QA-15 | 页脚占据高度，整页滚动 | 移除应用页脚并使用视口高度；长列表、详情和输出内部滚动，分页位置不随数据量变化 |
| QA-16 | 新建任务只能使用启动引擎，供应商和模型需要手填 | 增加引擎、供应商、模型三级下拉；后端按会话引擎路由创建、执行、审批、取消、删除及恢复；模型沿用到后续轮次。加载失败、无模型、切换清空旧选择、两个真实引擎完成请求均通过 |
| QA-17 | 空列表和少量数据使页面下部留白失衡 | 任务、交付物、交互、工具与异常空态填满剩余区域；0/1/50 项列表的分页纵向位置一致，320 × 640 的内容可达性复测通过 |

## 引擎数据范围

观测选择器过滤当前网关存储中的引擎历史，不改变已有任务绑定的引擎。生产入口同时注册 Pi/OpenCode；新建任务的选择器决定其执行引擎。未连接的引擎仍可查看已有历史；健康状态显示未连接，版本/进程数显示未知。没有数据时显示零或空态，不伪造实时结果。

HTTP、SSE、SQLite、网关进程内存等是本实例指标，页面单独标识。选择任一当前注册引擎可查看本实例内存趋势；仅有历史记录而未注册的引擎不返回本实例的内存趋势。无法关联会话或执行的全局日志仅在“全部引擎”下显示。

后端测试使用 Pi 一轮、OpenCode 两轮的不同样本，验证统计、工具、用量缺失数、异常和趋势的隔离，并检查非法参数、未知引擎及无数据情况。

## 剩余问题与限制

| 项目 | 状态 / 影响 |
| --- | --- |
| 趋势仅保存本进程最近约 1 小时 | 已记录，未改采样持久化。选择 24 小时或 7 天可查询保留执行历史，但不能恢复更早或重启前的趋势采样 |
| 初始 JS 包约 543 kB | 构建通过，仍有 Vite 500 kB 提示；本轮没有调整依赖或拆包 |
| 真实模型与外部链路 | 两个引擎各完成一次真实模型请求；未逐一验证全部模型、Office 和外部服务全链路 |
| 实机及辅助技术 | Chromium 模拟视口通过；未进行 Windows 实机、NVDA/VoiceOver、移动设备键盘和触摸实机验收 |

`pnpm test:browser` 的 3 项跳过是手机项目不重复两套视口矩阵及桌面内部滚动测试；这些用例在 desktop 项目已执行。`pnpm test` 的 4 项跳过是需显式开启的原生引擎测试，不计为已通过。

复现：在 `code/` 执行 `pnpm web:build`、`pnpm test:browser`、`pnpm test`。本轮最后的针对性回归使用 `pnpm exec playwright test --grep 'empty task and observation|fixed workspace|task assignment|every detail'`。Playwright 自动启动隔离测试服务并在完成后关闭；局域网验收使用的 3000 端口服务有意保留。

## 2026-09-08：统一网关契约（0.1.8）

引擎适配器、SQLite、会话/任务查询、SSE 与 Web/Desktop 使用同一 Message、Interaction 和事件结构。统一 `/event`，移除评测 serializer 和旧应用事件入口；消息使用 created_at、info.finish、text.content、tool.state.status/title；权限回复使用 reply/message，问题保留选项描述。配置与数据库版本统一为 1；不兼容历史、不迁移。Desktop 忽略 AGENT_ENGINE，使用保存的默认 Agent；会话 engineId 可覆盖；默认端口 6217。

验证：后端 64 项通过、6 项原生环境用例默认跳过；另行运行真实 Pi、OpenCode CLI 与本地模型夹具，均完成工具调用、人工权限、会话恢复及失败检查；Codex/Grok 协议转换测试通过。前后端类型检查、lint 和构建通过。浏览器 72 项通过、4 项按平台跳过；覆盖 desktop/mobile、人工问题与权限、消息和工具状态、运行历史、网关设置。Electron 开发模式冒烟通过，包括全新数据目录、窄窗口导航、统一 SSE、网关重启/端口切换、外部 HTTP 访问，以及继承 AGENT_ENGINE=grok 时仍采用配置默认 Pi。

以上原生模型测试使用本地 HTTP 模型夹具，不等同于真实远端模型服务评测。打包验证由同一提交的 Desktop 工作流与安装目录冒烟另行记录。
