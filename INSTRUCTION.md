# 安装、配置与验收

## 安装与启动

### Electron 桌面端

桌面基础包包括 Electron、工作台、网关和独立 Node/npm，不默认携带 Pi、OpenCode、Codex CLI 或 Grok Build。安装后的应用无需全局 Node/npm 即可启动网关、下载和运行受管 CLI。Windows 的 Pi bash 工具仍需要 Git for Windows；用户配置的其他 MCP 命令按其要求准备。

Windows 可下载 `AgentBridge-<版本>-windows-x64-deploy.zip`，解压后由 PowerShell 一次完成安装 EXE、导入 JSON/Skill、安装或复制 CLI 和启用 Agent。也可单独运行 EXE 手动安装，再在应用中配置。以下 pnpm 命令用于从源码构建。

源码构建需要 Node.js >= 22.21.0 和 pnpm 10.33.2，在 `code/` 执行：

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

此命令会构建前后端、下载并校验内置 Node 运行环境，再打开桌面工作台。首次准备构建和首次安装 CLI 需要网络。修改源码后重新运行命令会重新构建。

```sh
# 当前主机平台与架构的应用目录
pnpm desktop:pack

# 当前平台分发包：Windows NSIS、macOS DMG/ZIP、Linux AppImage
pnpm desktop:dist

# 仅准备构建，再运行桌面冒烟测试
pnpm desktop:prepare
pnpm test:desktop
```

应用目录和分发包输出到 `code/desktop-release/`；本地命令不自动发布。GitHub Actions 的 Desktop 工作流在 PR 中只上传 Artifacts；手动运行或推送与 `code/desktop/package.json` 版本一致的 `v*` 标签，会在三平台全部成功后创建 GitHub Release，附带安装包和更新元数据。已有 Release 不覆盖，发布下一版本前需同步更新 `code/package.json` 和桌面版本号。桌面冒烟测试需要图形环境，Linux 无显示器环境可使用 `xvfb-run -a pnpm test:desktop`。分发配置包含三个平台，不代表 Windows/macOS 已完成实机验收或安装包已经签名、公证和发布。

#### PowerShell 一键安装与初始化

脚本支持 Windows PowerShell 5.1 / PowerShell 7。部署 ZIP 已包含安装 EXE、[Initialize-AgentBridge.ps1](code/tools/Initialize-AgentBridge.ps1)、[initialize.mjs](code/tools/initialize.mjs)、配置示例和本说明；初始化工具也随 EXE 安装到 `resources/initialization/`。目标机不必提前安装 AgentBridge、Node、npm 或 pnpm。将自己的配置和资源放在解压目录：

```text
deploy/
  AgentBridge Setup <版本>.exe
  Initialize-AgentBridge.ps1
  initialize.mjs
  initialize.example.json
  INSTRUCTION.md
  settings.json       # 已配置好的业务配置，schemaVersion: 1
  system.json         # 可选：系统配置，schemaVersion: 1
  runtimes.zip        # 可选：同操作系统、同 CPU 架构的 AgentBridge runtimes
  skills.zip          # 可选：Skill 目录及附件；也支持 skills/ 目录
```

在该目录执行一条命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Initialize-AgentBridge.ps1 -Start
```

脚本自动识别同目录唯一的 `AgentBridge*.exe` 安装器（不包括 `agentbridge.exe`），以当前用户静默安装到 `%LOCALAPPDATA%\Programs\AgentBridge`，等待安装成功，再使用内置 Node/npm 初始化。安装期间不启动工作台；指定目录已有 `agentbridge.exe` 时复用，不重装或升级。自动导入同目录 `settings.json`、可选 `system.json`、`skills.zip`/`skills/`、`runtimes.zip`/`runtimes/`；同类 ZIP 和目录同时存在时需显式指定。缺少 runtime 包时联网安装配置中指定的受管 CLI；提供 runtime 包时只使用本地包，不回退下载。

脚本将已登记的 Skill 及附件复制到业务数据目录并改写引用，再按 `settings.json` 的 `enabled` 值启用 Agent。`-Start` 只在全部成功后启动桌面应用；不加此参数时，完成后自行打开应用即可。部署 ZIP 不包含真实凭据、用户配置或办公 Skill，需要自行提供。已有应用必须先通过菜单/托盘退出；安装器失败、JSON/资源校验失败或初始化失败均返回非零退出码，不执行 `-Start`。

自定义安装位置或存在多个安装器时：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Initialize-AgentBridge.ps1 `
  -InstallerPath '.\AgentBridge Setup 0.1.16.exe' `
  -InstallDirectory 'D:\Apps\AgentBridge' `
  -SettingsPath .\settings.json -Start
```

已安装应用只需初始化时使用 `-ExePath 'D:\Apps\AgentBridge\agentbridge.exe'`，不同时传 `-InstallerPath`/`-InstallDirectory`。`initialize.mjs` 优先从脚本目录读取，没有时使用安装目录的 `resources/initialization/initialize.mjs`。静默参数遵循 [NSIS 文档](https://nsis.sourceforge.io/Which_command_line_parameters_can_be_used_to_configure_installers)：`/S /currentuser /D=安装目录`，`/D` 必须放最后，路径含空格也不加内层引号。

| 参数 | 用途 |
| --- | --- |
| `-InstallerPath` | 可选，AgentBridge NSIS 安装器 EXE；未指定时自动寻找脚本同目录唯一的安装器 |
| `-InstallDirectory` | 可选，应用安装绝对路径；默认 `%LOCALAPPDATA%\Programs\AgentBridge`，与业务数据目录分开 |
| `-ExePath` | 可选，跳过安装并使用已有 `agentbridge.exe`；不能填写下载的安装器 |
| `-SettingsPath` | 业务配置 JSON；默认优先使用脚本同目录的 `settings.json`，没有时使用 `initialize.example.json`。原参数 `-ConfigPath` 仍可用 |
| `-SystemPath` | 可选，默认自动读取同目录 `system.json`；没有时沿用目标系统配置，新实例使用默认值 |
| `-RuntimesPath` | 可选，默认自动读取同目录 runtimes ZIP 或目录；有本地包时不回退到联网安装 |
| `-SkillsPath` | 可选，默认自动读取同目录 Skill ZIP 或目录；统一存入 `data/skills/<资源ID>/` |
| `-DataDirectory` | 桌面用户数据根目录，默认 `AGENT_DESKTOP_DATA_DIR` 或 `%APPDATA%\AgentBridge`；业务数据位于其 `data/` 子目录 |
| `-RunTimeoutMinutes` | 可选，1–1440 的整数分钟数；显式覆盖导入配置中的任务时限并持久化，四个 Agent 共用。省略时保留导入值；旧配置无此字段时沿用目标已保存值或默认 30 分钟 |
| `-Start` | 初始化成功后用本次数据目录启动应用 |

默认安装结果：

```text
%APPDATA%\AgentBridge\data\
  settings.json       # 保留资源、模型和 Agent 配置，Skill 路径改为目标机绝对路径
  system.json         # 导入的监听地址、代理、npm 源和证书设置
  skills/
    office/
      SKILL.md
      assets/...
  runtimes/
    codex/
      manifest.json
      versions/<UUID>/...
```

**准备 settings.json**：使用数据目录中的真实配置文件，不要把 `GET /api/settings` 返回的带掩码视图当作部署文件。保留需要启用 Agent 的 `enabled: true`、模型和 Skill/MCP 引用。联网模式会为文件中列出的受管 Agent 安装 CLI，即使该 Agent 停用；不需要安装的 Agent 可从部署文件的 `agents` 中移除。提供本地 runtime 包时，停用且源包和目标目录均无 runtime 的 Agent 会跳过；停用但已有 runtime 的受管 Agent 仍会复制或复用，保持停用。Codex 的模型连接必须使用 `openai-responses`。外部来源保留 `runtime: {"mode":"external","command":"目标机上的命令或绝对路径"}`，启用前检测并绑定，不能把源机器路径当作可搬运程序。

**准备 runtimes.zip**：退出源实例后压缩其 `data/runtimes/`。ZIP 可以包含顶层 `runtimes/`，也可以直接包含 `pi/`、`opencode/`、`codex/`、`grok/`。受管 Agent 目录必须包含完整 `manifest.json` 和 `versions/<UUID>/`（含 node_modules）；仅提供单个 CLI exe 或全局 npm 目录不可用。脚本只复制当前已登记版本，在目标机检查 `--version`；源文件保持原样。已启用的 Agent 缺少可用 runtime 时初始化失败，不回退到下载。

**准备 skills.zip**：ZIP 可以包含顶层 `skills/`，也可以直接包含多个 Skill 目录。每个目录需有 `SKILL.md`，附件、模板和脚本一并保留。推荐目录名与 settings 中的 Skill `id` 一致，也支持使用原 `path` 的末级目录名；两者匹配到不同目录时会报错，避免绑定错资源。例如 `id: "office"`、`path: "C:\\source\\skills\\office"` 配合 `skills/office/SKILL.md`，安装后自动改为 `%APPDATA%\AgentBridge\data\skills\office`。未在 settings 中登记的 Skill 不会自动添加。脚本只改写 Skill 的目录引用，不改写 Skill 文件正文或 MCP 命令中的源机器绝对路径。

例如，把 `skills/office/SKILL.md` 和附件放在脚本旁，在 settings 的 `skills` 中加入 `{"id":"office","path":"skills/office","enabled":true}`，并在所需 Agent 的 `skillIds` 中加入 `"office"`。模型可设置 `"thinking":"off"`（需要模型支持），Agent 可设置 `"contextCompaction":"enabled"`；省略时均使用默认行为。配置里的 `${变量名}` 由初始化程序读取环境变量展开，不需在脚本中硬编码密钥。

**准备 system.json**：使用当前数据目录的系统配置文件，要求 `schemaVersion: 1`、`applying: false`。导入采用保存的 `gateway`、`network`，并将它们设为下次启动生效值，不沿用源实例的运行错误或旧生效状态。npm 源、代理和证书按当前项目规则校验。桌面加密的 `encryptedPassword` 不能跨机器导入；部署文件需移除 `network` 和 `appliedNetwork` 中的该字段，必要时在 `network.proxyPassword` 填写密码或 `${变量名}`。CA 文件和本地 MCP 程序需在目标机提前准备，路径必须适用于目标机。

ZIP 先解压到临时目录，支持普通文件和目录；绝对路径、`..` 越界、重复路径、符号链接、Windows 特殊设备名等会被拒绝。每个 ZIP 最多 200,000 个条目、展开大小最多 8 GiB，处理结束后清理临时目录。Windows 的普通 runtimes ZIP 不依赖 Unix 符号链接；如果来源是其他平台的含链接目录，请使用对应平台运行环境，不能直接搬到 Windows。

Windows ZIP 解压和清理使用扩展长度路径，支持临时目录、版本 UUID 和深层 `node_modules` 拼接后超过 260 字符的路径，无需修改注册表。版本 UUID 是 runtime 清单引用的目录名，不要手动删改。旧版脚本若在临时目录创建 Pi/OpenCode 文件时报 `Open` 路径错误，请替换更新后的 `Initialize-AgentBridge.ps1`；改短临时目录只能缓解路径长度问题。单个文件名/目录名的文件系统长度限制仍然适用。

相同文件可重复执行：已登记 runtime 保留，同内容 Skill 复用；已有不同业务配置或同 ID 的不同 Skill 内容会拒绝覆盖，改用新数据目录或在应用中管理。显式提供 `-SystemPath` 或自动发现同目录 `system.json` 时会应用所提供的系统设置。错误返回非零退出码，保留已保存配置和已完成安装，且不执行 `-Start`；修复后可以重试。原生模型真实请求、额外 MCP 依赖及外部办公服务仍需在目标环境验证。

离线 runtime 在未登记的 `versions/<UUID>/` 中复制并执行版本检查，验证完成后才写入清单；检查后不再移动可执行文件目录，避免 Windows 的文件占用导致 `rename copy-... -> versions/...` 报 `EPERM`。旧部署包遇到该错误时，替换脚本旁的 `initialize.mjs` 后用原命令重试即可，已成功导入的 Agent 会跳过，无需删除数据目录。

临时校验网关仅监听 `127.0.0.1` 的自动分配端口，不覆盖导入的监听地址和端口，也不采用当前终端的 `AGENT_HOST`、`AGENT_PORT`、`AGENT_ENGINE`。正常启动 Desktop 仍遵循下文环境变量优先级。实例运行时由数据目录锁拒绝初始化；目标实例已保存的加密代理密码无法由独立脚本解密时，请用新数据目录，或通过桌面页面操作。

若指定 `-DataDirectory 'D:\AgentBridge-profile'`，业务数据写入 `D:\AgentBridge-profile\data`；`-Start` 会给此次启动传入同一根目录。以后从其他终端或快捷方式打开时，也需设置相同的 `AGENT_DESKTOP_DATA_DIR`；脚本不会修改系统级环境变量。

**在线初始化**：没有指定 `-RuntimesPath` 且脚本旁没有 runtimes 包时，联网安装配置中列出的受管 Agent；没有指定 `-SkillsPath` 且脚本旁没有 skills 包时，只登记 settings 中已有的 Skill 路径（相对路径以配置文件所在目录为基准）。可复制 [initialize.example.json](code/tools/initialize.example.json) 为 `settings.json`，设置 `AGENT_OPENAI_BASE_URL`、`AGENT_OPENAI_API_KEY`、`AGENT_OPENAI_MODELS` 后执行上述一键命令。模型变量只填一个模型 ID；变量缺失时失败。MCP 资源仍在 settings 的 `mcp` 中配置，并通过 Agent 的 `mcpIds` 引用。脚本不下载 Skill，也不安装本地 MCP 的依赖。

#### 安装、更新和卸载 Agent

1. 在 Agent 管理中打开需要的 Agent，进入“安装与版本”。进入页签会检查官方最新稳定版，也可手动检查；页面分别显示已安装版本、当前运行版本、最新版本、查询时间、占用和操作进度。
2. 点击“安装最新版”。应用记录本次实际安装版本与来源，不把 CLI 版本固定在桌面应用内。安装完成后，配置模型并主动启用 Agent；未安装或不可用的程序不能启用。
3. 有新版时点击“更新到最新版”。下载期间原版本可以继续服务；切换前停止新提交、取消排队任务并等待当前任务和审批结束。下载阶段可以取消，切换阶段按完整操作完成。安装或切换失败保留错误，并尽可能保留或恢复原版本。
4. 点击“卸载”并确认。程序会等待当前任务和审批结束、停用 Agent 后删除受管程序；需要立即结束任务时使用“立即停止”。删除失败可重试，完成前保持停用。

卸载保留模型配置、API Key、原生会话、任务历史、用户工作目录和产物，不删除个人 CLI。重新安装不会自动启用或重放历史任务。停用不卸载，安装不启用，启动应用不自动升级 CLI；断网时已安装的可用版本仍可使用，最新版本查询失败会明确标注缓存结果。协议检查失败的新版不能作为可用程序启用。

#### 窗口、退出和数据目录

托盘可用时，关闭窗口只是隐藏，任务继续执行。点击托盘或应用菜单的“打开工作台”可返回。菜单/托盘“退出”或 `Ctrl/Cmd+Q` 才会退出应用；仍有任务时，提供“取消”“等待任务完成后退出”“停止任务并退出”。等待退出会拒绝新的任务提交；如有人工审批，可重新打开工作台处理。没有托盘时关闭窗口进入退出流程。

桌面用户数据根目录在开发和分发环境中统一为下列位置，业务数据放在其 `data/` 下；主题等桌面偏好写入同级 `desktop.json`：

| 平台 | 默认用户数据根目录 |
| --- | --- |
| Windows | `%APPDATA%\AgentBridge` |
| macOS | `~/Library/Application Support/AgentBridge` |
| Linux | `$XDG_CONFIG_HOME/AgentBridge`，未设置时为 `~/.config/AgentBridge` |

设置 `AGENT_DESKTOP_DATA_DIR` 为绝对路径可覆盖根目录，例如指定 `/home/me/AgentBridge` 后，配置位于 `/home/me/AgentBridge/data/settings.json`。应用菜单的“打开日志目录”可直接定位日志。

Web 默认 `.agentbridge`，Desktop 默认用户数据目录下的 `data/`；两者使用同一当前数据格式。不同实例使用不同目录。不兼容历史数据，不提供迁移。备份完整的业务数据目录应先显式退出应用；同一数据目录只允许一个网关写入。桌面内置网关默认 `127.0.0.1:6217`，在“系统信息 → 网关服务”配置监听地址、端口，保存并重启后可供本机或局域网调用；无需额外安装 server。完整接口与自动化评测示例见[网关 API](code/docs/GATEWAY_API.md)，运行中可访问 `/api/docs`。

### 源码 Web 模式

需要 Node.js >= 22.21.0、pnpm 10.33.2。Windows 的 Pi bash 工具需要 Git for Windows；路径须使用实际绝对路径，配置不会展开 `~` 或 shell 变量。

在 `code/` 执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm web:build
pnpm start
```

浏览器访问 `http://127.0.0.1:6217/agents`，无需配对码。新 Web/Desktop 实例均默认受管来源；在“安装与版本”按需安装，或输入主机已有 CLI 命令并验证切换。Pi/OpenCode 开发依赖用于开发验证，不决定业务实例的来源。详情见 [CLI 版本管理](docs/design/RUNTIME_INSTALL.md)。

首次无配置启动时四个 Agent 均停用。前端与管理 API 仍可访问；就绪状态不代表模型连接、额度或凭据验证通过。

配置完成后，常用页面如下；路径相对于当前网关地址，Web 与 Desktop 共用：

| 页面 | 路径 |
| --- | --- |
| 新会话 | `/conversations` |
| 历史会话 | `/conversations/history` |
| 会话详情 | `/conversations/<sessionId>` |
| Agent 管理 / 共享资源 | `/agents` / `/agents/resources` |
| 运行观测 / 系统信息 | `/observability` / `/settings` |

新会话选择已启用的 Agent、模型和网关主机上的工作目录后提交。旧页面 `/tasks` 会跳转到会话页面；HTTP API 仍使用 `/api/tasks`，不随页面路径改名。

开发时在 `code/` 分别打开两个终端运行 `pnpm dev --engine pi` 和 `pnpm web:dev`，访问 `http://127.0.0.1:5173`。Vite 默认代理到 `127.0.0.1:6217`；正式 Web 模式由网关直接提供已构建前端，无需启动 Vite。

## 管理配置

1. 在“共享资源”中添加 OpenAI 兼容连接：供应商 ID、Base URL、API Key、协议及模型列表。Base URL 填 API 根路径，例如 `https://api.example.com/v1`，不填具体请求端点。
2. 每个模型可配置名称、上下文长度、最大输出长度及默认/关闭思考。关闭思考需要供应商和模型支持。只支持 Chat Completions 与 Responses；Codex 只接受 Responses。
3. 在 Agent 详情选择上下文压缩（默认/启用）、允许使用的模型、默认模型、Skills、MCP 和默认交互策略，保存后启用。默认权限审批和提问均为 `auto`：权限自动批准，提问按首个选项或默认文本回答；需要人工处理时改为 `manual`。创建会话时可覆盖该策略，已创建会话的策略保持固定。
4. 修改已启用 Agent 的配置后，点击应用。页面分别显示保存修订与已应用修订；保存不会改变正在执行的进程配置。
5. 连接测试会向已保存的供应商发送一次最多 64 个输出 token 的请求，超时 30 秒。它可能产生模型费用。

业务配置唯一来源是数据目录下的 `settings.json`。文件包含 `schemaVersion: 1`、`defaultAgent`、四项 `agents`、`providers`、`skills`、`mcp`。每个 Agent 保存 CLI 来源 `runtime`、模型引用、默认模型、Skill/MCP 引用和默认交互策略。删除被引用的资源前须解除引用。网络与网关监听配置单独保存在 `system.json`，不放入初始化 JSON。

密钥只在服务器保存；API 返回掩码，保留掩码表示不改，清空表示移除。POSIX 新建配置文件权限为 0600，目录为 0700。保存使用 revision 乐观并发控制，冲突须刷新后重新编辑。

### 目录与原生资源

```text
<AGENT_DATA_DIR>/
  settings.json
  state.sqlite
  logs/
  system.json  # 网关监听、网络与 npm 源设置及生效状态
  host.log     # 启动管理器的脱敏诊断（有记录时创建）
  runtimes/    # 受管 CLI、安装清单及临时下载目录
  skills/      # 初始化脚本导入的 Skill 目录及附件
  backups/    # 切换运行时所需的原生状态备份
  agents/
    pi/        # settings.json、models.json、mcp.json、sessions/
    opencode/  # opencode.json、独立 XDG 配置/数据/缓存
    codex/     # config.toml、sessions/<sessionId>/ 原生 HOME
    grok/      # config.toml、sessions/<sessionId>/ 原生 HOME
```

原生配置由管理配置单向生成。不要手工编辑生成文件，不复用个人 CLI 配置或认证。任务 cwd 始终是用户选择的实际项目目录；项目说明文件保留。模型、Skill、MCP 的管理引用独立于项目目录。

Skills 登记包含 `SKILL.md` 的本地绝对目录，保留原文件和附件。任务工作目录与 Skill 目录在 Desktop 使用系统选择器，在 Web 浏览服务器目录并受 AGENT_ALLOWED_DIRECTORIES 限制。MCP 支持 stdio 命令数组、环境变量以及远程 HTTP URL、请求头。只向选中的 Agent 分配已启用资源；Pi 的 MCP 扩展随受管 Pi 安装，外部 Pi 需具备可解析的扩展依赖，不提供任意插件安装页面。

Codex/Grok 每个会话有独立的托管 HOME，加载前检查原生 Skill 发现结果并关闭未分配的 Skill。项目原生配置如果引入与管理配置冲突的设置，会拒绝创建或恢复并显示文件路径。Grok 项目 `.mcp.json` 在托管模式中也会被拒绝。先把所需资源导入管理页面并移除冲突配置，再重试；不会自动改写项目文件。

原生导入支持 JSON 或 TOML 中已识别的模型、Skill、MCP 字段，先预览再通过普通保存确认。凭据不导入，未知字段显示警告或忽略；不是个人目录挂载或双向同步。

### 生命周期

- 停用：立即拒绝新任务和追加请求，取消尚未开始的排队项，等待当前执行与审批结束，然后停止进程。
- 立即停止：取消排队和当前执行，原生取消超时后终止拥有的进程树；Agent 保持停用。
- 应用：停止接收新执行、取消排队项、等待当前执行结束，再生成配置并重启该 Agent；其他 Agent 可继续工作。
- 启用：校验已保存配置并启动协议握手。失败显示错误；修复配置后可重试。
- 网关重启或 Agent 重启：尝试恢复持久化原生上下文，绝不重放旧 Run。恢复失败的会话显示不可用，历史仍保留。
- 删除任务：清理该任务的网关记录与可定位的托管原生会话数据，不删除用户工作目录和交付文件。

一个任务对应一个 Session，连续对话默认展示完整历史。每次提交创建 Run，承担排队、超时、取消、用量与交付物归属；没有额外 Turn 实体。默认沿用上次仍可用的模型，否则使用当前 Agent 默认模型。每个 Run 记录实际配置修订及可取得的 CLI 运行版本。无法取得的 token 或费用显示未知。

## 启动参数与环境

源码 Web 启动器只读取启动工作目录的 `.env`，已有进程环境变量优先。CLI 的 host/port/engine 参数覆盖对应环境变量。Desktop 使用 settings.json 的默认 Agent；Web 显式 --engine 或 AGENT_ENGINE 仅覆盖本次进程的默认值，会话 engineId 优先且创建后固定。两种入口均按 Web CLI host/port > AGENT_HOST/AGENT_PORT > system.json 的 gateway > 默认 127.0.0.1:6217 初始化监听设置。Desktop 不加载 `.env`；更改桌面数据位置使用 `AGENT_DESKTOP_DATA_DIR`。

| 配置 | 范围 |
| --- | --- |
| `AGENT_HOST` / `AGENT_PORT` | 默认 127.0.0.1 / 6217 |
| `AGENT_DATA_DIR` | 源码模式默认当前目录下 .agentbridge，多个实例必须分开 |
| `AGENT_DESKTOP_DATA_DIR` | 桌面用户数据根目录，业务数据位于其 data/ 子目录 |
| `AGENT_MANAGED_RUNTIMES=false` | 仅首次初始化为外部来源，默认受管；之后逐 Agent 管理 |
| `AGENT_ENGINE` / `--engine` | Web 本次进程的默认 Agent；无 settings.json 时也用于初始化，Desktop 忽略 |
| `ENGINE_A_COMMAND` / `ENGINE_B_COMMAND` | OpenCode / Pi 命令，仅初始化外部来源时读取 |
| `ENGINE_A_PORT` | OpenCode 内部端口，默认 0 自动分配 |
| `CODEX_COMMAND` / `GROK_COMMAND` | Codex / Grok 命令 |
| `AGENT_ALLOWED_DIRECTORIES` | 允许的绝对目录 JSON 数组，空数组不限制 |
| `AGENT_LIMITS` | 超时、并发、会话数、事件保留等 JSON 配置；runTimeoutMs 默认 1800000，被页面保存的时限覆盖；artifactTimeoutMs 默认 30000，见 code/src/config.ts |
| `AGENT_STORAGE=memory` | 显式使用临时数据库，进程退出丢失网关历史；配置文件仍持久化 |

源码 Web 可用以下环境变量初始化模型连接；模型变量仅在尚无 `settings.json` 时生效，页面保存后由文件管理。它们不负责下载 CLI；新受管实例仍需安装所选 Agent，或通过 PowerShell 初始化完成安装和启用：

```dotenv
AGENT_ENGINE=codex
AGENT_OPENAI_PROVIDER=company
AGENT_OPENAI_BASE_URL=https://api.example.com/v1
AGENT_OPENAI_API=openai-responses
AGENT_OPENAI_MODELS=model-one,model-two
AGENT_OPENAI_API_KEY=replace-with-your-key
```

不要把真实密钥提交到 Git。当前 settings、runtime 清单、事件的 `schemaVersion` 和 SQLite 数据库版本均为 **1**；历史格式一律拒绝，不提供兼容或迁移，不覆盖原文件。源码 Web 使用新的 `AGENT_DATA_DIR`，Desktop 使用新的 `AGENT_DESKTOP_DATA_DIR`，再按当前示例重新配置。

局域网可运行 `pnpm start --host 0.0.0.0 --port 6217`，Desktop 也可在网关服务页面保存相同监听设置。Web、HTTP/SSE、产物与指标均无需网关鉴权；外部脚本直接调用桌面监听地址。修改地址/端口重启后 desktop 自动重连，Web 使用新地址打开。

系统网络、网关配置、重启和证书接口及平台边界见[Web/Desktop 统一运行](docs/design/WEB_DESKTOP.md)。

### 网络、npm 源与证书

Web 与 Desktop 均在“系统信息”配置网络，保存后重启网关生效。可继承启动环境的代理、手动填写 HTTP/HTTPS 代理，或选择直连；继承模式不会读取操作系统代理或 PAC。本机回环连接始终直连。手动代理用户名、密码单独填写；已保存密码不回显，留空保留，使用清除按钮删除。“测试连接”只验证当前表单，不修改已生效配置。

npm 源可选官方 `https://registry.npmjs.org/`、国内 `https://registry.npmmirror.com/`，或自定义 HTTPS 仓库（允许子路径，不允许内嵌凭据、查询参数或片段）。它用于 Pi、OpenCode、Codex 的版本查询、安装与更新；Grok 使用独立下载源。运行时使用 `system.json` 中的 npm 源，不能通过终端的 `npm_config_registry` 覆盖。

系统证书和附加 PEM CA 用于 Node 网关，附加 CA 也传给支持 `NODE_EXTRA_CA_CERTS` 的 Agent；原生 CLI 是否采用取决于自身实现。桌面应用更新使用操作系统证书库，企业根证书需安装到操作系统。源码依赖安装 `pnpm install` 不读取应用的 `.env` 或 `system.json`，其代理和源需在终端或 pnpm 配置中设置。

## API 与验证

管理 API：`GET/PUT /api/settings`、`GET /api/agents`、`POST /api/agents/:id/actions`、`POST /api/providers/:id/test`、`POST /api/agents/:id/import`。动作请求例如 `{"action":"enable"}`，可选 `enable`、`disable`、`stop`、`apply`；HTTP 202 表示已接收，通过 Agent 状态或 `agents.updated` 事件追踪结果。完整请求与响应示例见[网关 API](code/docs/GATEWAY_API.md)，运行后可访问 `/api/docs`。

运行时管理 API：`GET /api/runtimes` 返回四个运行时状态；`POST /api/runtimes/:id/actions` 请求例如 `{"action":"install"}`，可选 `check`、`detect`、`install`、`update`、`uninstall`、`cancel`，通过轮询状态跟踪后台操作。`PUT /api/runtimes/:id/source` 接受 `{"mode":"managed"}` 或 `{"mode":"external","command":"绝对路径或命令"}`。外部来源可检测版本、查询最新版本及准备受管安装；切换需显式提交，不能覆盖更新或卸载外部程序。桌面网关和 Web server 提供相同的无鉴权接口，评测脚本可直接调用。

在 `code/` 执行常规检查：

```sh
pnpm typecheck
pnpm --filter @agentbridge/web typecheck
pnpm --filter @agentbridge/web lint
pnpm test
pnpm build
pnpm web:build
pnpm exec playwright install chromium
pnpm test:browser
```

浏览器测试自动启动独立测试网关，覆盖桌面和手机视口；默认端口 3010，可用 `AGENT_BROWSER_PORT` 调整。它与 Electron 冒烟测试 `pnpm test:desktop` 分开运行。

仅验证初始化脚本时运行 `pnpm exec tsx --test test/initialize.test.ts`。该测试校验示例配置、system 导入、Skill 搬运和冲突保护、runtime 复制、初始化重试及重启后 Agent 就绪；使用本地 CLI 协议替身，不下载官方 CLI，也不请求真实模型。Windows 下还会运行 PowerShell ZIP、安装器命令模拟、同目录资源发现和完整导入测试；其他平台可设置 `AGENT_TEST_POWERSHELL` 为 `pwsh` 路径启用相同检查。仅检查 ZIP 可执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File test/initialize-zip.ps1`；安装器命令模拟使用 `test/initialize-install.ps1`。桌面发布 CI 在 Windows 下使用 PowerShell 5.1 执行最终 EXE 安装、JSON/Skill 导入和桌面启动检查；真实 CLI 与业务配置仍需在目标环境验收。

原生 CLI 验证通过环境变量单独运行；先确保对应 CLI 可执行，Pi/OpenCode 可使用项目开发依赖，Codex/Grok 需另行准备。生命周期检查不发送模型请求，模型协议检查使用本地测试服务，不调用收费模型：

```sh
AGENT_NATIVE_SMOKE=pi pnpm exec tsx --test test/native.test.ts
AGENT_NATIVE_SMOKE=opencode pnpm exec tsx --test test/native.test.ts
AGENT_NATIVE_MODEL=pi pnpm exec tsx --test test/native.test.ts
AGENT_NATIVE_MODEL=opencode pnpm exec tsx --test test/native.test.ts
AGENT_NATIVE_RPC=codex pnpm exec tsx --test test/native-rpc.test.ts
AGENT_NATIVE_RPC=grok pnpm exec tsx --test test/native-rpc.test.ts
```

PowerShell 使用 `$env:变量名="值"` 设置对应变量后执行测试命令。原生 CLI 验证不等于供应商业务验收；Windows 实机、真实付费模型、Office/Outlook/WeLink 等链路需在目标环境验证。办公能力通过分配的 Skill/MCP 提供，网关不内置办公脚本。

## 模型失败与 Windows 目录排查

优先查看任务诊断中的脱敏错误、Agent 已应用版本以及连接测试结果。已就绪只代表 CLI 与协议可用。模型 ID、API 协议、Base URL、凭据、上下文限制都必须与供应商一致。

Windows 使用存在的绝对路径，检查服务账户对工作目录、数据目录及 Git Bash 的权限。产物扫描的 DISCOVERY_FAILED 与模型请求错误分开报告；目录权限或扫描上限导致无法登记文件，不代表模型执行成功或失败。原文件丢失、内容变化或越界时，下载接口明确返回错误。

## 任务超时设置

Pi、OpenCode、Codex 和 Grok 默认共用 **30 分钟**任务总时限。在“系统信息 → 任务超时”输入 1–1440 的整数分钟数，点击“保存超时设置”；无需重启，对新提交的任务立即生效。保存冲突时草稿保留，刷新系统配置后可选择保留分钟数再保存。任务详情显示本轮时限和截止时间。

时限从提交开始计算，包含排队和等待审批，持续输出不会重置。已提交任务保留自己的 deadlineAt；Agent 确认成功后，产物扫描和校验使用单独的 30 秒期限，产物警告不会把成功任务改成超时。

设置保存在业务数据目录的 settings.json 顶层 runTimeoutMs（毫秒）。优先级为页面/初始化写入的值 > AGENT_LIMITS.runTimeoutMs > 默认 1800000。旧配置没有此字段时无需修改。Desktop 不加载 .env，推荐页面设置或初始化配置。

初始化示例：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Initialize-AgentBridge.ps1 `
  -ExePath 'D:\Apps\AgentBridge\agentbridge.exe' `
  -SettingsPath .\settings.json -RunTimeoutMinutes 30 -Start
```

此参数用于初始化新实例，不绕过已有配置冲突保护。已有实例应通过页面修改；重复初始化且导入配置未写 runTimeoutMs 时保留目标已保存的时限。部署包中的 initialize.example.json 显式使用 1800000。

评测脚本默认读取网关时限并加 60 秒余量，使用异步提交与轮询；`--timeout` 可覆盖脚本自身等待时间。模型服务、代理和原生 CLI 内部的超时属于独立层，网关配置不能覆盖远端服务限制。详细机制、改动范围和验证场景见[超时与完成处理](code/docs/TIMEOUTS.md)。
