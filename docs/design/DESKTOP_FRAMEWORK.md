# 桌面端选型：Tauri 与 Electron

状态：Electron 桌面端、受管 CLI 安装与三平台构建配置已实现；Linux 已实际打包验证，Windows/macOS、签名和线上更新仍待目标环境验收。更新日期：2026-09-08。
代码基线：`origin/master` 的 `731d4d7386295abb21696a9053b7494f5da5ca55`，分支 `research/desktop-tauri-vs-electron`。

## 建议

**AgentBridge 首版桌面端采用 Electron，复用现有 React、TypeScript 网关与四个 CLI 适配器。** 已实现独立 Node 后端、沙箱窗口、托盘、原生目录选择和按需运行时管理。包体积优化采用生产依赖闭包、平台分包、locale 裁剪与默认不携带 CLI；Electron/Node 的基础成本仍存在，实测见下文。Tauri 保留为资源预算无法满足时的替代选项，没有建立双框架工程。

本文按“Windows 10/11 优先、保留 Linux 开发能力、用户安装后可运行本地 Agent”评估；前两项来自现有设计基线，安装体验是本次分析假设。尚未明确的包体积、内存、离线安装和 macOS 支持要求，可能改变结论。

若桌面端最终只连接远程网关，或完整应用实测表明 Electron 无法满足明确的资源预算，则重新评估 Tauri。若仅需桌面入口而无安装、托盘、文件选择和生命周期管理需求，现有浏览器工作台已经可用。

## 选型时的代码约束（基线 commit）

| 现状与依据 | 对桌面化的影响 |
| --- | --- |
| [后端依赖](../../code/package.json)为 TypeScript、Fastify，要求 Node.js >= 22.21.0；[存储](../../code/src/storage/sqlite.ts)直接使用 `node:sqlite` | 后端不能直接放进 WebView；需兼容 Node 运行时，或承担后端重写成本 |
| [主入口](../../code/src/main.ts)组合 Store、SessionRuntime、四个适配器和 HTTP 服务 | 可以保留整个业务后端，仅新增桌面启动与生命周期控制 |
| [前端 API](../../code/web/src/lib/api.ts)使用相对 URL 和 `EventSource("/api/events")`；[网关](../../code/src/gateway/server.ts)同时提供静态前端 | 桌面窗口加载网关的同源地址即可复用 HTTP/SSE；改成 `file://` 或自定义协议需额外适配 |
| [进程管理](../../code/src/engines/process.ts)用 cross-spawn，Windows 通过 `taskkill /T /F` 终止引擎进程树 | 两个框架都要管理网关及其后代进程，关闭窗口不能替代受控退出 |
| Pi/OpenCode 来自项目依赖，Codex/Grok 当前依赖主机命令；[Pi 适配器](../../code/src/engines/pi/adapter.ts)还加载 `tools/*.mjs` 扩展 | 安装包必须携带或明确安装运行时、扩展和依赖，不能只打包前端与网关 JS |
| [配置](../../code/src/config.ts)默认端口 3000，校验不允许 0，数据目录相对 cwd | 桌面启动需要端口发现、稳定用户数据目录和独立于安装路径的工作目录 |
| [启动脚本](../../code/tools/start.mjs)先加载环境，再用 `process.execPath` 启动 Node | Electron 的可执行文件不能直接当普通 `node` 使用；代理和 CA 环境也要在后端启动前注入 |

## 对比

| 维度 | Electron | Tauri 2 | 对 AgentBridge 的判断 |
| --- | --- | --- | --- |
| 后端复用 | 可用 `utilityProcess` 承载 Node 后端，也可启动独立 Node [E1] | Rust 壳启动 Node sidecar，业务后端仍可复用 [T1] | Electron 更贴近当前技术栈；Tauri 不要求重写 Rust 后端，但增加 Rust 工具链和 sidecar 分发 |
| 前端复用 | Chromium 渲染现有 React 应用 [E1] | 系统 WebView 渲染现有 React 应用 [T2] | 两者都能复用；Electron 渲染引擎版本更可控，仍需平台验收 |
| 包体积 | 携带 Chromium 和 Node 运行时 | 默认复用系统 WebView，但本项目仍需 Node、后端依赖与 CLI [T1][T2] | Tauri 有壳体积优势；不能拿空壳大小代表完整 AgentBridge |
| 内存与启动 | 多进程壳开销需要测量 | 系统 WebView 加 Node sidecar，同样有多进程开销 | 需包含网关、全部 Agent 和后代进程；不能据框架名称断言总内存或任务速度 |
| Windows 安装 | 浏览器引擎随应用交付 | 依赖 WebView2，可选择在线安装、离线安装或固定运行时 [T3] | 离线交付时 WebView2 成本必须计入；不能默认目标机器已安装 |
| 本地能力 | 窗口、托盘、菜单、对话框由 Electron API 提供 [E1] | 通过 Tauri API、插件和 capabilities 控制 [T4] | 常规桌面能力不是决定因素；Agent 执行权限仍归后端 |
| 安全边界 | 隔离 renderer，通过窄接口调用桌面能力 [E2] | 限制 WebView 可调用的 commands 和插件权限 [T4] | 两种框架均不能自动保护已有 HTTP API，也不自动沙箱化 Agent CLI |
| 应用更新 | 内置 autoUpdater 有 Windows/macOS 支持，Linux 需另行选择更新方式 [E4] | 官方 updater 插件使用签名更新构件 [T5] | 均需发布构件、签名和更新流程；应用更新不等于 CLI 版本管理 |

当前没有团队 Rust 熟练度数据，不据此断言 Tauri 难以维护；可以确定的是仓库现在没有 Rust 工程。

## 体积优化：检索结论与本地证据

2026-09-08 再次 fetch 后，`origin/master` 仍为上述基线。方案结合最新 [Agent 管理](AGENTS.md)、[运行时安装更新](RUNTIME_INSTALL.md)、[设计基线](README.md)与[安装说明](../../INSTRUCTION.md)，以及下列官方资料分析。尚无明确 MB 上限，暂同时关注首次下载与安装后磁盘占用；内存单独计量。

必须区分四个指标：安装器文件大小、首次完成所需 Agent 安装的总下载量、安装后占用、运行时内存。在线安装器、延迟下载、压缩和裁剪影响的指标不同，不能都称为“应用变小”。

### 本地体积抽样

以下为现有 Linux 开发目录的 `du` 磁盘占用与文件检查，包含开发工具、可能残留的依赖和已存在构建输出；不是按锁文件重装后的生产依赖闭包，也不是 Windows 交付大小。pnpm 的链接关系和文件系统分配会影响统计，不将各项简单相加推算安装包。

| 对象 | 本次观察 | 可采取的行动 |
| --- | --- | --- |
| `code/node_modules` | 约 1.1 GiB | 禁止整目录复制进安装包，按运行入口收集实际生产依赖 |
| `code/web/dist` | 约 1.5 MiB | 前端已有 Vite 构建；优先避免重复携带 React、图标库、Vite 和前端源码 |
| `code/dist` | 约 656 KiB | 网关自身 JS 较小；后端压缩不能消除 Electron 与 CLI 二进制成本 |
| `code/artifacts` | 约 12 MiB | QA 截图与验收记录留在仓库，不进入用户安装包 |
| OpenCode 两个程序路径 | `opencode-ai/bin/opencode.exe` 与平台包 `opencode-linux-x64-baseline/bin/opencode` 均为 184,666,240 bytes，约 176.1 MiB；SHA-256 相同、inode 不同 | 发布构件检查是否重复携带；验证后只保留选定的受管程序及所需资源 |

OpenCode 两份程序的 SHA-256 均为 `ca6c0e1f42be3120595bf6848937e7586ec862c87fa7aa111e89c7cc6e9a4650`。其本地 `postinstall.mjs` 会从平台包链接或复制程序到入口目录，因此这是有依据的裁剪候选。这里只证明当前 Linux 文件相同，不证明 Windows 必然重复，也不承诺压缩后能节省相同大小。发布时仍需验证资源查找、版本命令、协议握手和工具执行，不能仅凭同名删除文件。

### 优化的优先级

| 顺序 | 方法 | 实际收益与限制 |
| --- | --- | --- |
| 1 | 收紧应用 `files`，只带桌面入口、前端构建和必要运行文件 | 减少下载和磁盘占用。electron-builder 会自动收集生产依赖；只有前端文件白名单并不能阻止整个后端依赖树进入包，需同时控制应用 manifest [B1] |
| 2 | 生产依赖与构建依赖分开，运行资源去重 | 不带测试、Playwright、TypeScript、Vite、构建缓存和重复 CLI；保留运行时动态加载资源、许可证和通知。不要笼统删除所有 Markdown，Agent 的提示与技能也可能是 Markdown |
| 3 | 按平台和架构单独发布 | Windows x64、arm64 分包，不把所有平台 CLI 收进一个构件。裁剪需同时考虑 CPU 指令集与 Linux libc，不能只按文件名猜平台 [B3] |
| 4 | 仅保留产品支持的 Electron locale | 初期可验证 `zh-CN` 与 `en-US`，减少 locale 文件；不影响系统中文字体、输入法，也不移除 Chromium 核心 [B2] |
| 5 | 前端沿用 Vite；壳层按需打包，后端先保留模块布局 | bundling 可减少 JS 加载开销和冗余代码；后端 pino worker、动态模块与 `import.meta.dirname` 路径需独立验证，首版不为微小 JS 体积收益强行打成单文件 [E5] |
| 6 | Agent 运行包按需安装 | 用户只使用部分 Agent 时，可减少首次下载与未使用程序的占用。需要实现受管安装，全部安装后的总占用不保证更小；安装不能隐式启用 Agent |
| 7 | 后续应用差分更新 | 适用构件可减少更新传输量，不减首次完整安装体积，也不免除完整包回退、下载缓存和临时磁盘空间 [B5] |

**以下不作为主要瘦身手段：** ASAR 不压缩，只归档；不能把 `asar` 开关作为压缩收益。[E6] electron-builder 官方明确指出 `maximum` 通常没有显著体积差异，却增加构建时间，首版保持 `normal`。[B2] `nsis-web` 只把主构件放到安装时下载，不自动减少同架构的总下载或安装后占用。[B3] 不为减体积关闭沙箱、删除未知 Chromium DLL/资源、用旧版 Electron 或维护定制 Chromium。

Electron 本身仍携带 Chromium；上述措施主要消除应用与运行包冗余。若裁剪后的“Electron + 必需运行时 + 网关”已超过产品预算，按需 Agent 下载也无法解决基础成本，应转向 Tauri + 同一 Node 后端做等功能比较。

## 推荐的最小架构

```text
Electron main（窗口、单实例、启动/退出、必要的原生操作）
  +-- BrowserWindow：现有 React 页面
  |     +-- 同源 HTTP/SSE --> 127.0.0.1:<实际端口>
  +-- 独立后端进程：现有 Fastify + SessionRuntime + SQLite
        +-- Pi / OpenCode / Codex / Grok CLI 及各自工具进程
```

前端继续使用现有 API；桌面 IPC 只处理选目录、显示文件位置等确有需要的原生操作。SQLite 和任务调度留在后端进程，避免同步存储操作阻塞窗口主进程。网页版本继续使用现有启动方式。

结合外部 CLI 的运行需求，本次实现使用一套受管的独立 Node 同时承载网关和需要 Node 的 CLI。Node 24 LTS 是仓库的交付目标，实施时固定受测补丁版本；不增加第二套供网关使用的独立 Node。桌面与后端通过父子控制消息传递就绪地址及退出请求，前端业务继续走 HTTP/SSE。资源布局保持网关的模块、worker 和扩展查找语义。

**这是运行兼容性的选择，有额外 Node 磁盘成本。** Electron 内置 Node 无法从官方分发包中单独裁掉。`utilityProcess` 能承载网关，但不会自动在 PATH 提供 `node`、`npm` 或 `npx`。如果运行依赖清单证明可完全省去独立 Node，再验证 `utilityProcess.fork` 中的 `node:sqlite`、ESM、pino worker 和代理/CA 行为，并只保留一条生产启动路径。[E1] 不把 `ELECTRON_RUN_AS_NODE` 包装成通用 CLI 运行环境；这还影响 RunAsNode fuse 的安全配置。[E7]

Tauri 的可行替代架构是“Rust 窗口壳 + 固定版本 Node sidecar + 原有网关 + 同源 WebView”。由 Rust 侧启动受管 sidecar，不向页面开放任意 shell 命令。无需把整个后端迁到 Rust，也无需把所有 HTTP/SSE 改成 Tauri commands。[T1][T4]

## 已实现的引入方案

### 构建和资源边界

采用 Electron 44.2.0、electron-builder 26.15.3、electron-updater 6.8.9 和 Node 24.20.0，构建依赖固定在 pnpm 锁文件中。Agent CLI 独立从官方 latest/stable 解析；应用依赖固定不等于要求用户固定 CLI 版本。builder 默认网页已进入 v27，本项目使用 v26 schema 与配置，不套用 v27 的 `asar`/`nativeModules` 语法。[B4]

| 位置 | 实际职责 |
| --- | --- |
| `code/desktop/main.mjs` | 单实例、系统用户目录、托盘、窗口、网关子进程、退出和应用更新 |
| `code/desktop/preload.cjs`、`security.mjs` | 最小目录选择桥接、主题/侧栏偏好、受管页面来源与请求凭据边界 |
| `code/tools/desktop-prepare.mjs` | 官方 Node SHA-256 校验、目标平台资源准备、pnpm production deploy、链接越界/非运行依赖检查 |
| `code/desktop/builder.json` | ASAR 桌面壳；真实目录中的 Node/npm、网关、静态前端与 Pi 扩展；只保留中英文 locale |
| `code/src/runtime/runtimes.ts` | 官方运行包解析、安装、取消、校验、探测、切换、回滚与卸载 |
| `code/web/src/pages/runtime-installer.tsx` | Agent 详情“安装与版本”页签，版本、容量、错误和进度 |
| `.github/workflows/desktop.yml` | Windows NSIS、Linux AppImage、macOS DMG/ZIP；上传构件，版本标签或手动 publish 触发 Release |

桌面应用 manifest 仅声明 electron-updater。后端通过 `pnpm deploy --prod` 生成可搬移依赖闭包；Pi/OpenCode/pi-mcp-adapter 已从根包生产依赖移到源码开发依赖，基础包不含四个 CLI、测试、截图或构建工具。Node/npm 与后端放在 `extraResources`，不依赖系统全局 Node/npm，也不让外部 CLI 读取 ASAR 内的脚本。[E3][B1]

builder v26 的过滤器会排除复制来源根目录下的 `node_modules`，因此资源映射从 `.desktop-stage` 同时选择 `backend/**/*` 和 `node/**/*`，保留嵌套依赖目录。验收将整个应用复制到仓库外，保留相对软链、检查全部链接边界并清除 Node 模块搜索环境，防止打包缺依赖时借用开发目录产生假通过。

### 运行与安全边界

Electron 在 `127.0.0.1:0` 启动独立 Node 网关，等待 IPC 就绪消息再打开已有 `/agents` 页面；HTTP/SSE 业务接口保持同源。桌面默认数据位于系统 appData 下的 `AgentBridge/data`，不写安装目录，`AGENT_DESKTOP_DATA_DIR` 可覆盖桌面数据根目录。网页模式仍用原有启动命令与主机 CLI。

每次启动生成随机 token，只由主进程为受管窗口、精确网关 origin 注入 Authorization；API、SSE、静态资源、产物、metrics 均校验。token 不暴露给 renderer 或 CLI 子进程，也不会随外链发送。桌面网关收紧 Origin 校验，拒绝 Web 开发 origin 例外。renderer 启用 sandbox/contextIsolation，关闭 nodeIntegration，拒绝权限请求、webview、不可信导航和 IPC；HTTP/HTTPS 外链交由系统浏览器。产物使用原生保存对话框，不自动运行下载文件。[E2]

关闭窗口隐藏到托盘，任务继续；显式退出有活动任务时可取消、等待完成或停止并退出。等待时暂停新提交，保留审批回复能力。受控退出通过 IPC 清理后端和引擎；后端丢失父 IPC 时退出，主进程追踪引擎进程组作为异常清理补充。随机端口变化后通过小型本地偏好文件恢复主题和侧栏状态，不保存网页认证会话。

### 桌面网络配置

“系统信息 → 网络与代理”提供继承启动环境、手动 HTTP/HTTPS 代理、不使用代理三种模式。手动模式将代理地址与用户名、密码分开输入，可配置绕过地址、系统 CA 和附加 CA 证书文件；回环地址始终绕过代理，保证内置网关和本机 Agent 通信。继承模式读取进程环境变量，不自动读取操作系统代理设置或 PAC。

网络设置保存在桌面用户数据目录，通过受信任窗口的 IPC 访问，返回值仅报告是否保存密码。省略密码保留原值，显式清除才删除。保存不改变运行中的连接，重启后在 Node 网关启动前应用；测试连接使用当前表单启动隔离 Node 请求，支持 HTTP/HTTPS 测试目标并显示状态与耗时，不要求先保存或重启。桌面网络设置独立于共享模型资源，源码 Web 模式继续使用启动环境和现有 `.env` 配置。

系统证书开关与附加 CA 配置作用于 Node 网关及隔离连接测试；附加 CA 通过 `NODE_EXTRA_CA_CERTS` 下发给支持该变量的 Agent，不保证所有原生 CLI 都采用。应用更新走 Electron 网络栈与操作系统证书库，企业根证书须安装到操作系统；附加 CA 文件不会改变更新器的证书信任。

### CLI 按需安装

默认不下载 OpenCode、Pi、Codex、Grok。用户在 Agent 详情进入“安装与版本”，安装官方最新版、检查更新、更新或卸载。安装不启用 Agent；配置模型后另行启用。已安装版本可离线启动，检查更新失败不破坏旧版本。每次动作重新解析 latest，动作内固定实际构件并记录来源/完整性信息；无当前平台构件或握手失败时明确报错，不静默降级。

npm 安装禁用生命周期脚本，限定官方 registry，核验 package-lock；OpenCode 直接安装对应 CPU/libc 的官方平台包，避免 wrapper postinstall 复制出第二份大二进制。Pi 的 MCP 依赖随 Pi 安装。Grok 直接下载官方 GCS 构件，固定对象 generation 并检查官方 MD5；不执行会修改个人 shell 的安装脚本。Grok 的 MD5 用于传输完整性，信任来源依赖 HTTPS 官方对象元数据，不能称为签名或 SHA-256 发布验证。

下载期间旧版继续服务；切换或卸载时拒绝新任务、取消未执行队列、等待当前任务结束。先停止原生进程，再备份完整原生目录和会话绑定，探测/恢复成功才保留新版本；失败或中途退出恢复旧版及快照。卸载只删受管程序，保留模型配置、原生会话、历史与产物。详细接口和状态见 [RUNTIME_INSTALL](RUNTIME_INSTALL.md)。

### 应用更新与平台分发

菜单“检查应用更新”使用 electron-updater，用户确认下载后再确认重启，重启前复用任务退出策略。GitHub 更新源来自 builder 配置，生产发布必须同时提供对应安装包和 latest*.yml/blockmap。macOS 还需要 ZIP 更新负载及有效签名；只有 DMG 无法完成 Squirrel.Mac 更新。[B7]

默认 workflow 上传构件；推送匹配桌面版本的 `v*` 标签，或手动勾选 `publish`，在三平台全部成功后发布 GitHub Release。发布 job 单独获得 contents:write，构建和 PR 检查保持只读；已有 Release 不覆盖。流程不注入签名证书。Windows/macOS 构建、安装、中文/空格路径、Git Bash、权限和进程清理尚须在目标系统验收；Linux AppImage 构建及解包程序实测通过。已配置更新入口不等于已验证跨版本线上更新。若需正式分发，补齐平台签名/公证和两个版本之间的更新保留数据检查。

## 实测与边界

2026-09-08，Linux x64：基础包运行时不需要 PATH 中的开发 Node/npm；打包后实际网关使用 `resources/node/bin/node`，四个 Agent 初始均未安装。沙箱窗口、目录 IPC、主题与 SQLite 跨随机端口重启保留、SSE、托盘和退出均通过真实 Electron 测试。测试脚本为 `code/test/desktop-smoke.mjs`，截图位于 `code/artifacts/desktop/`。

四个 CLI 均真实安装、执行版本命令与适配器协议握手、再卸载，未提交付费模型请求；[记录](../../code/artifacts/desktop/runtime-install-smoke.json)为本次下载到的版本，不是准入白名单。

| Agent | 本次版本 | 安装后程序大小（bytes） |
| --- | --- | ---: |
| Pi | 0.85.1 | 215,296,378 |
| OpenCode | 1.18.29 | 184,667,503 |
| Codex | 0.153.4 | 334,978,735 |
| Grok | 1.0.13 | 166,079,904 |

本次 Linux x64 AppImage 为 **172.5 MiB**，解包程序为 **442.1 MiB**（按常规文件逻辑字节、去重 inode、不跟随软链计量），其中 Node/npm 约 133.7 MiB，后端资源约 32.3 MiB。完整大小、SHA-256 与检查条件见 [桌面验收记录](../../code/artifacts/desktop/verification.json)。按需安装可避免首次下载四套程序；全部安装后的总占用仍需加上相应程序、原生状态、模型资源与缓存。npm 安装阶段有 500ms 周期的 staging 大小检查，不提供文件系统级硬配额；网络下载阶段只有 Grok 提供可计算的字节百分比，npm 显示不确定进度。

没有同机 Tauri 等功能构件或完整多 Agent CPU/内存性能基准，不能声称 Electron 更快、更省内存，也不把协议握手当作全部模型/工具业务验收。后续比较须计入同一 Node、CLI、数据规模与 WebView2 安装前提。Windows/macOS 和线上签名更新属于剩余发布验收边界。

## 官方依据

以下官方文档于 2026-09-08 查阅；应用构建依赖已锁定并用于本次构建，Agent CLI 则记录每次从最新版解析到的实际版本并验证运行兼容性。

- [E1：Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)与 [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)。
- [E2：Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)。
- [E3：Electron ASAR 限制](https://www.electronjs.org/docs/latest/tutorial/asar-archives)。
- [E4：Electron autoUpdater 平台支持](https://www.electronjs.org/docs/latest/api/auto-updater)。
- [E5：Electron 性能建议与代码打包](https://www.electronjs.org/docs/latest/tutorial/performance)。
- [E6：Electron ASAR 格式，不压缩](https://github.com/electron/asar)。
- [E7：Electron Fuses 与 RunAsNode](https://www.electronjs.org/docs/latest/tutorial/fuses)。
- [B1：electron-builder 文件与外部资源收集](https://www.electron.build/docs/contents/)。
- [B2：electron-builder 配置，locale 与 compression](https://www.electron.build/docs/configuration/)。
- [B3：NSIS 单架构与 Web Installer](https://www.electron.build/docs/nsis/)。
- [B4：electron-builder v27 变更](https://www.electron.build/docs/migration/v27-breaking-changes/)。
- [B5：NsisUpdater 与差分下载](https://www.electron.build/docs/api/electron-updater.class.nsisupdater/)。
- [B6：Electron Forge CLI 的 pnpm 打包要求](https://www.electronforge.io/cli)。
- [T1：Tauri 外部二进制与 sidecar](https://v2.tauri.app/develop/sidecar/)。
- [T2：Tauri WebView 与平台版本](https://v2.tauri.app/reference/webview-versions/)。
- [T3：Tauri Windows 安装与 WebView2 分发](https://v2.tauri.app/distribute/windows-installer/)。
- [T4：Tauri capabilities](https://v2.tauri.app/security/capabilities/)。
- [T5：Tauri updater 插件](https://v2.tauri.app/plugin/updater/)。

- [B7：electron-builder v26 自动更新与 macOS ZIP 要求](https://www.electron.build/v26/docs/features/auto-update/)。
