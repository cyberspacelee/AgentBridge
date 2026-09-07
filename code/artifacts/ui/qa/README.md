<!-- Hallmark pre-emit critique: Philosophy 4, Hierarchy 4, Execution 4, Specificity 4, Restraint 5, Variety 3. -->
# 逐页 QA 与问题记录

## 2026-09-07 配置页面

补充验证：同供应商配置两个模型，分别保存 32000/4096 与 200000/16384 的上下文/最大输出限制；重新编辑第二个模型并刷新后保留独立数值，删除行与取消编辑在桌面/手机均通过（配置页专项 2 passed）。后端完整回归 23 passed / 4 skipped；另外启用两个原生引擎的本地模型测试，验证正常工具调用及 401 拒绝，任务错误和运行日志均包含拒绝原因并隐藏测试密钥，数据库与事件记录读取后仍保留错误详情。目录消失的产物扫描警告保留 ENOENT/路径且不阻止模型执行；另检查 Windows EPERM 文本、网络底层原因、stderr 截断及凭据脱敏。Windows 实机的原始失败原因尚待部署更新后复测，未启动常驻服务。

新增 `/settings`，覆盖兼容模型增删改、密钥掩码与保留、Skill 目录启停、OpenCode MCP 配置和 Pi 插件目录/安装入口。桌面 1440 × 1000、手机 390 × 844 的保存、刷新、编辑和删除流程通过，截图检查无横向溢出。浏览器完整回归 33 passed / 3 skipped，后端 19 passed / 4 skipped；另外分别启用两个原生引擎的本地模型测试，均完成真实进程的工具调用和手动权限交互。临时本地 Pi 插件完成安装、实际加载和卸载验证。第三方 MCP/subagent 插件及真实供应商未逐一验收。

构建、前端 lint 和差异格式检查通过。此轮曾通过 <http://127.0.0.1:3000/settings> 验证真实页面入口，托管 OpenCode 使用 4097，避免占用已有的 4096 服务；验证服务已按要求停止。下文旧局域网地址和临时目录属于历史验收记录，不表示目前仍有服务运行。

截图：[模型桌面](settings-models-desktop.png)、[模型手机](settings-models-mobile.png)、[表单桌面](settings-model-form-desktop.png)、[表单手机](settings-model-form-mobile.png)、[MCP 桌面](settings-mcp-desktop.png)、[MCP 手机](settings-mcp-mobile.png)、[Pi 插件桌面](settings-pi-desktop.png)、[Pi 插件手机](settings-pi-mobile.png)。使用隔离测试数据，未显示真实密钥。

## 2026-09-06 历史验证

日期：2026-09-06。页面测试数据为隔离测试引擎和显式样本；另对真实 Pi 0.85.1 网关完成浏览器检查，并在修正认证配置后完成真实模型最小请求验证。

结果：累计记录的 17 项功能/布局和局域网兼容问题已修复并复测。本轮完整回归与修正后的定向复测合并覆盖 31 个通过的浏览器用例、3 个按项目规则跳过的用例；最后的布局与任务流程定向回归为 7 passed / 1 skipped。后端测试 17 passed / 4 skipped，补充的双引擎观测复测 2 passed；前后端构建、前端 lint、`git diff --check` 均通过。

局域网入口：<http://192.168.8.211:3000/tasks>。服务监听 `0.0.0.0:3000`，Pi 0.85.1 和 OpenCode 1.18.29 同时就绪，沿用独立 SQLite 数据目录 `/tmp/agentbridge-ui-qa-live.No4Dx9`，保持运行供检查。`--engine pi` 指定未显式选引擎时的默认值，新任务可独立选择任一引擎。

已用上述局域网 IP 完成 Chromium 检查：真实非安全 HTTP 上下文下，页面、SSE、侧栏、观测选择器和友好 404 正常；提交测试请求到达后端并按预期拒绝不存在的工作目录，没有调用真实模型，页面无 JavaScript 异常。复制降级在桌面/手机回归中通过实际复制粘贴验证。另一个局域网设备的连通性由用户验收。

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
