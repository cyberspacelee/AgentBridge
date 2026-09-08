# 安装、配置与验收

## 安装与启动

### Electron 桌面端

桌面基础包包括 Electron、工作台、网关和独立 Node/npm，不默认携带 Pi、OpenCode、Codex CLI 或 Grok Build。安装后的应用无需全局 Node/npm 即可启动网关、下载和运行受管 CLI。Windows 的 Pi bash 工具仍需要 Git for Windows；用户配置的其他 MCP 命令按其要求准备。

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

应用目录和分发包输出到 `code/desktop-release/`；命令不自动发布。 GitHub Actions 的 Desktop 工作流默认只上传 Artifacts；手动运行时勾选 `publish`，或推送与 `code/desktop/package.json` 版本一致的 `v*` 标签，才会在三平台全部成功后创建 GitHub Release，附带安装包和更新元数据。已有 Release 不覆盖，发布下一版本前需更新桌面版本号。桌面冒烟测试需要图形环境，Linux 无显示器环境可使用 `xvfb-run -a pnpm test:desktop`。分发配置包含三个平台，不代表 Windows/macOS 已完成实机验收或安装包已经签名、公证和发布。

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

桌面数据独立于源码模式的 `.agentbridge`，不会自动迁移个人 CLI 配置或源码运行数据。备份完整的业务数据目录应先显式退出应用；同一数据目录只允许一个网关写入。桌面内置网关仅监听本机随机端口，供桌面窗口访问；局域网使用下方的源码 Web 模式。

### 源码 Web 模式

需要 Node.js >= 22.21.0、pnpm 10.33.2。Windows 的 Pi bash 工具需要 Git for Windows；路径须使用实际绝对路径，配置不会展开 `~` 或 shell 变量。

在 `code/` 执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm web:build
pnpm start
```

浏览器访问 `http://127.0.0.1:3000/agents`。Pi 0.85.1、OpenCode 1.18.29 和 Pi MCP 扩展 2.32.1 随源码开发依赖及锁文件安装，不进入桌面基础包。Codex、Grok 使用主机现有 CLI，通过 `CODEX_COMMAND`、`GROK_COMMAND` 指定命令或可执行文件绝对路径。此前记录的源码原生验证版本为 Codex 0.153.4、Grok 1.0.5，不限制桌面按需安装的版本。默认源码模式的“安装与版本”页签只显示主机 CLI 信息，不更新或卸载它们。受管安装实现见 [版本管理方案](docs/design/RUNTIME_INSTALL.md)。

首次无配置启动时四个 Agent 均停用。前端与管理 API 仍可访问；就绪状态不代表模型连接、额度或凭据验证通过。

## 管理配置

1. 在 Agents 的共享资源中添加 OpenAI 兼容连接：供应商 ID、Base URL、API Key、协议及模型列表。Base URL 填 API 根路径，例如 `https://api.example.com/v1`，不填具体请求端点。
2. 每个模型可配置名称、上下文长度和最大输出长度。只支持 Chat Completions 与 Responses；Codex 只接受 Responses。
3. 在 Agent 详情选择允许使用的模型、默认模型、Skills、MCP 和默认交互策略，保存后启用。默认权限审批和提问均由人工处理。
4. 修改已启用 Agent 的配置后，点击应用。页面分别显示保存修订与已应用修订；保存不会改变正在执行的进程配置。
5. 连接测试会向已保存的供应商发送一次最多 64 个输出 token 的请求，超时 30 秒。它可能产生模型费用。

配置唯一来源是 `AGENT_DATA_DIR/settings.json`。文件包含 `schemaVersion: 2`、`defaultAgent`、四项 `agents`、`providers`、`skills`、`mcp`。每个 Agent 保存模型引用、默认模型、Skill/MCP 引用和默认交互策略。删除被引用的资源前须解除引用。

密钥只在服务器保存；API 返回掩码，保留掩码表示不改，清空表示移除。POSIX 新建配置文件权限为 0600，目录为 0700。保存使用 revision 乐观并发控制，冲突须刷新后重新编辑。

### 目录与原生资源

```text
<AGENT_DATA_DIR>/
  settings.json
  state.sqlite
  logs/
  runtimes/    # 桌面受管 CLI、安装清单及临时下载目录
  backups/    # 切换运行时所需的原生状态备份
  agents/
    pi/        # settings.json、models.json、mcp.json、sessions/
    opencode/  # opencode.json、独立 XDG 配置/数据/缓存
    codex/     # config.toml、sessions/<sessionId>/ 原生 HOME
    grok/      # config.toml、sessions/<sessionId>/ 原生 HOME
```

原生配置由管理配置单向生成。不要手工编辑生成文件，不复用个人 CLI 配置或认证。任务 cwd 始终是用户选择的实际项目目录；项目说明文件保留。模型、Skill、MCP 的管理引用独立于项目目录。

Skills 登记包含 `SKILL.md` 的本地绝对目录，保留原文件和附件。桌面端的任务工作目录与 Skill 目录支持系统目录选择。MCP 支持 stdio 命令数组、环境变量以及远程 HTTP URL、请求头。只向选中的 Agent 分配已启用资源；Pi 的 MCP 扩展在桌面端随 Pi 安装，在源码模式由项目开发依赖提供，不提供任意插件安装页面。

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

源码 Web 启动器只读取启动工作目录的 `.env`，已有进程环境变量优先。CLI 的 host/port/engine 参数覆盖对应环境变量。业务配置保存后，以 settings.json 为准。桌面模式自行设置本机监听地址、随机端口和业务数据路径，不使用此启动器加载 `.env`；更改桌面数据位置使用 `AGENT_DESKTOP_DATA_DIR`。

| 配置 | 范围 |
| --- | --- |
| `AGENT_HOST` / `AGENT_PORT` | 默认 127.0.0.1 / 3000 |
| `AGENT_DATA_DIR` | 源码模式默认当前目录下 .agentbridge，多个实例必须分开 |
| `AGENT_DESKTOP_DATA_DIR` | 桌面用户数据根目录，业务数据位于其 data/ 子目录 |
| `AGENT_ENGINE` / `--engine` | 无 settings.json 时的默认 Agent，支持四个 ID |
| `ENGINE_A_COMMAND` / `ENGINE_B_COMMAND` | OpenCode / Pi 命令，默认项目本地 CLI |
| `ENGINE_A_PORT` | OpenCode 内部端口，默认 0 自动分配 |
| `CODEX_COMMAND` / `GROK_COMMAND` | Codex / Grok 命令 |
| `AGENT_ALLOWED_DIRECTORIES` | 允许的绝对目录 JSON 数组，空数组不限制 |
| `AGENT_LIMITS` | 超时、并发、会话数、事件保留等 JSON 配置，见 code/src/config.ts |
| `AGENT_STORAGE=memory` | 显式使用临时数据库，进程退出丢失网关历史；配置文件仍持久化 |

无人值守首次启动可使用以下初始化配置。只有尚无 settings.json 时生效，初始化所选 Agent；页面保存后不再由这些变量覆盖：

```dotenv
AGENT_ENGINE=codex
AGENT_OPENAI_PROVIDER=company
AGENT_OPENAI_BASE_URL=https://api.example.com/v1
AGENT_OPENAI_API=openai-responses
AGENT_OPENAI_MODELS=model-one,model-two
AGENT_OPENAI_API_KEY=replace-with-your-key
```

不要把真实密钥提交到 Git。旧 settings 格式与旧数据库不提供自动迁移；启动时遇到旧数据库会明确拒绝并保留文件。使用新的 AGENT_DATA_DIR，按新设计重新配置。

局域网可运行 `pnpm start --host 0.0.0.0 --port 3000`。系统面向受信任环境，尚无用户认证或多租户隔离，公网访问需要部署层访问控制。

## API 与验证

管理 API：`GET/PUT /api/settings`、`GET /api/agents`、`POST /api/agents/:id/actions`、`POST /api/providers/:id/test`、`POST /api/agents/:id/import`。动作请求为 `{"action":"enable|disable|stop|apply"}`，HTTP 202 表示已接收，通过 Agent 状态或 `agents.updated` 事件追踪结果。完整任务、交互和事件契约见 [接口设计](docs/design/CONTRACTS.md)。

运行时管理 API：`GET /api/runtimes` 返回四个运行时状态；`POST /api/runtimes/:id/actions` 接受 `{"action":"check|install|update|uninstall|cancel"}`，通过轮询状态跟踪后台操作。安装类操作只允许受管运行时，源码默认的主机 CLI 不可变更。桌面网关请求凭据由桌面壳注入，外部浏览器或脚本不能直接复用其随机端口调用管理接口。

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

原生 CLI 验证通过环境变量单独运行，使用本地模型协议服务，不调用收费模型：

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
