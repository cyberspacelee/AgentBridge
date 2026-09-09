# 安装、配置与验收

## 安装与启动

### Electron 桌面端

桌面基础包包括 Electron、工作台、网关和独立 Node/npm，不默认携带 Pi、OpenCode、Codex CLI 或 Grok Build。安装后的应用无需全局 Node/npm 即可启动网关、下载和运行受管 CLI。Windows 的 Pi bash 工具仍需要 Git for Windows；用户配置的其他 MCP 命令按其要求准备。

已下载 Windows 安装包时，先运行安装器完成应用安装，再打开 AgentBridge，按下文“安装、更新和卸载 Agent”配置所需 CLI 和模型；批量初始化可使用 PowerShell 脚本。以下 pnpm 命令用于从源码构建。

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

#### PowerShell 初始化（安装 exe 后）

将 [Initialize-AgentBridge.ps1](code/tools/Initialize-AgentBridge.ps1)、[initialize.mjs](code/tools/initialize.mjs) 和 [initialize.example.json](code/tools/initialize.example.json) 放在同一目录。脚本支持 Windows PowerShell 5.1 / PowerShell 7，使用安装目录自带的 Node/npm，无需额外安装它们，也无需重新打包桌面程序。`-ExePath` 指向安装后的 `agentbridge.exe`，不是下载的安装器。

先通过菜单或托盘退出 AgentBridge，复制示例为自己的配置文件，再运行：

```powershell
Copy-Item .\initialize.example.json .\initialize.json
$env:AGENT_OPENAI_BASE_URL = 'https://你的服务地址/v1'
$env:AGENT_OPENAI_MODELS = '你的模型ID' # 此示例只填一个模型 ID
$key = Read-Host 'API Key' -AsSecureString
$env:AGENT_OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $key).Password
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Initialize-AgentBridge.ps1 `
  -ExePath "$env:LOCALAPPDATA\Programs\AgentBridge\agentbridge.exe" `
  -ConfigPath .\initialize.json
Remove-Item Env:AGENT_OPENAI_API_KEY
```

安装路径按实际位置修改。默认写入 `%APPDATA%\AgentBridge\data`；`-DataDirectory` 指定的是其父目录，默认也读取 `AGENT_DESKTOP_DATA_DIR`。指定自定义目录后，桌面启动也需要设置同一 `AGENT_DESKTOP_DATA_DIR`。

| 参数 | 用途 |
| --- | --- |
| `-ExePath` | 必填，安装后的 `agentbridge.exe` 完整路径 |
| `-ConfigPath` | 初始化 JSON 路径，默认使用脚本同目录的 `initialize.example.json` |
| `-DataDirectory` | 桌面用户数据根目录，脚本在其 `data/` 子目录写入业务数据 |
| `-RuntimesPath` | 可选，已有 AgentBridge 的 `runtimes/` 目录；启用后不回退到联网安装 |

例如为新实例指定数据目录，并用同一目录启动桌面应用：

```powershell
$env:AGENT_DESKTOP_DATA_DIR = 'D:\AgentBridge-profile'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Initialize-AgentBridge.ps1 `
  -ExePath "$env:LOCALAPPDATA\Programs\AgentBridge\agentbridge.exe" `
  -ConfigPath .\initialize.json `
  -DataDirectory $env:AGENT_DESKTOP_DATA_DIR
if ($LASTEXITCODE -eq 0) {
  & "$env:LOCALAPPDATA\Programs\AgentBridge\agentbridge.exe"
}
```

此示例仍需先设置配置中引用的模型环境变量。`$env:` 赋值仅影响当前终端及其启动的进程；以后从快捷方式启动时，也需提供相同的 `AGENT_DESKTOP_DATA_DIR`。

示例使用当前 `schemaVersion: 1`，安装并启用 Codex（模型连接须使用 `openai-responses`）；`agents` 可仅列出需要初始化的 `pi`、`opencode`、`codex`、`grok`，其余保持停用。`enabled: false` 表示只安装、配置；`runtime: {"mode":"external","command":"C:\\工具\\codex.cmd"}` 表示检测并绑定已有 CLI。受管安装复用现有安装器，仅下载尚未安装或文件已丢失的 CLI，不自动更新已安装版本。旧版本的配置和数据库不迁移，请使用新数据目录按当前示例重新配置。

**复制已有 runtimes，免去重新下载**：源机器先退出 AgentBridge，将其 `%APPDATA%\AgentBridge\data\runtimes` 整个目录复制到 U 盘或本机备份目录。在目标机器执行同一脚本，增加 `-RuntimesPath`：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Initialize-AgentBridge.ps1 `
  -ExePath "$env:LOCALAPPDATA\Programs\AgentBridge\agentbridge.exe" `
  -ConfigPath .\initialize.json `
  -RuntimesPath 'D:\AgentBridge-backup\runtimes'
```

该路径下应直接包含 `codex\manifest.json`、`codex\versions\<UUID>\...` 等 Agent 目录，不能只提供 CLI 的单个 exe 或全局 npm 目录。脚本按配置中的受管 Agent 复制当前版本（含 node_modules）和版本清单，在目标机检查 `--version` 成功后登记；源文件保持原样。目标已登记的 runtime 保留，未登记的新副本先写临时目录，验证失败会清理，重试不会覆盖已有安装。源、目标应使用相同操作系统和 CPU 架构；脚本会检查系统对应的入口形式和实际可执行性。引用版本目录以外文件的链接、未完成的安装/回滚状态会被拒绝。

提供 `-RuntimesPath` 后，受管 runtime 缺失或不可用会报错，**不会回退到联网安装**。只复制 runtime，不复制个人认证、历史任务或会话；模型、Skill/MCP 配置仍由 `initialize.json` 提供。Skill 文件和本地 MCP 程序需另行准备，模型与远程 MCP 的使用仍可能需要网络。

在配置中填写资源，并在对应 Agent 的 `skillIds` / `mcpIds` 中填写其 ID，例如：

```json
{
  "skills": [{ "id": "office", "path": "./skills/office" }],
  "mcp": [{
    "id": "office-tools",
    "config": {
      "type": "remote",
      "url": "${OFFICE_MCP_URL}",
      "headers": { "Authorization": "Bearer ${OFFICE_MCP_TOKEN}" }
    }
  }]
}
```

以上字段合并进示例配置，不是独立配置。Skill 路径相对于配置文件所在目录，必须已有 `SKILL.md`；脚本登记目录，不下载技能。MCP 也支持 `{"type":"local","command":["C:\\Python\\python.exe","C:\\tools\\server.py"],"environment":{}}`，所需程序与依赖须已安装。字符串中的 `${变量名}` 从环境变量读取，缺失时在保存前失败；密钥最终按应用现有方式保存到数据目录。

脚本校验配置、保存资源、逐个安装/绑定 runtime，再启用指定 Agent，完成后关闭临时网关。安装或来源切换后的 CLI 不可用时会失败，不继续启用该 Agent。临时网关只监听 `127.0.0.1` 的自动分配端口，不覆盖已保存的网关监听配置，也不采用当前终端的 `AGENT_HOST`、`AGENT_PORT`、`AGENT_ENGINE`；新数据目录保留应用默认的 `127.0.0.1:6217`。

安装沿用已保存的系统网络配置（包括 npm 源）；继承环境模式下使用当前终端的代理环境变量。需要调整下载源时，可先打开目标实例，在“系统信息”保存网络与 npm 源设置，再退出应用执行初始化。已有系统代理密码若使用桌面密钥加密，独立脚本无法解密，会停止并保留原文件；这种实例请使用桌面管理页面。

初始化成功表示配置和 Agent 启动检查完成，不代表已经验证真实模型请求或所有 MCP 工具。错误返回非零退出码，保留已保存配置和已完成安装；修复环境或网络后可用相同配置重试。已有不同资源配置时拒绝覆盖，应在应用内编辑。实例运行时由数据目录锁拒绝初始化。

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
2. 每个模型可配置名称、上下文长度和最大输出长度。只支持 Chat Completions 与 Responses；Codex 只接受 Responses。
3. 在 Agent 详情选择允许使用的模型、默认模型、Skills、MCP 和默认交互策略，保存后启用。默认权限审批和提问均为 `auto`：权限自动批准，提问按首个选项或默认文本回答；需要人工处理时改为 `manual`。创建会话时可覆盖该策略，已创建会话的策略保持固定。
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
| `AGENT_LIMITS` | 超时、并发、会话数、事件保留等 JSON 配置，见 code/src/config.ts |
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

仅验证初始化脚本时运行 `pnpm exec tsx --test test/initialize.test.ts`。该测试校验示例配置、临时打包布局下的真实后端初始化、监听配置保留、重试、runtime 复制及失败处理，不下载官方 CLI，也不请求真实模型。Windows PowerShell 包装脚本仍需在安装后的 Windows 应用上验证。

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
