# AgentBridge

AgentBridge 在同一个工作台管理 Pi、OpenCode、Codex CLI 和 Grok Build，提供 Electron 桌面应用和 HTTP/SSE 网关，支持连续对话、工具记录、交互审批、交付物和运行观测。后端使用 TypeScript、Fastify 和 SQLite，前端使用 React、shadcn Base UI 和 Tailwind CSS 4。

![AgentBridge 任务工作台](code/artifacts/ui/qa/lan-acceptance.png)

## 功能

- 四个 Agent 独立启用、停用、强停和应用配置，运行中的任务保持明确的生命周期。
- Web 与 Desktop 共用运行时管理；每个 Agent 可选择受管安装或外部 CLI，按需安装、检测、更新和切换来源。
- 共享 OpenAI 兼容模型连接、Skills 和 MCP，每个 Agent 独立选择引用与默认模型。
- 模型只支持 Chat Completions 或 Responses；Codex 要求 Responses。不使用登录、OAuth 或个人 CLI 认证。
- 一个任务保留连续会话；每次追加形成 Run，用于排队、超时、取消、诊断与用量归属。
- SQLite 保存历史和幂等结果，SSE 支持断线回放；同会话串行，默认全局最多并发 4 个执行。
- 桌面与手机布局、浅深主题、交付物下载预览、按 Agent 筛选观测。

## 快速启动

### Electron 桌面端

桌面安装包自带 Node.js 与 npm，运行网关和安装受管 CLI 不需要全局 Node/npm。首次打开后，进入 Agent 的“安装与版本”页签，按需安装官方最新稳定版，再配置模型并启用；安装不会自动启用。更新和卸载由用户点击触发，不在每次启动时自动升级。

Windows 安装后也可使用 [PowerShell 初始化脚本](INSTRUCTION.md#powershell-初始化安装-exe-后)，通过 JSON 配置模型、Skill/MCP 引用、CLI 安装与 Agent 启用；增加 `-RuntimesPath` 可复制已有 AgentBridge runtimes，免去重新下载。

从源码运行桌面端需要 Node.js **>= 22.21.0** 和 pnpm **10.33.2**：

```sh
cd code
pnpm install --frozen-lockfile
pnpm desktop:dev
```

`desktop:dev` 会构建前后端并准备内置运行环境。`pnpm desktop:pack` 生成当前平台的应用目录；`pnpm desktop:dist` 生成安装分发包，均输出到 `code/desktop-release/`，不会自动发布。准备好构建后，通过 `pnpm test:desktop` 运行桌面冒烟测试；详细步骤见[安装与验收](INSTRUCTION.md#electron-桌面端)。

托盘可用时，关闭窗口会隐藏到托盘，后台任务继续运行；菜单或托盘中的“退出”以及 `Ctrl/Cmd+Q` 才会退出应用。有任务时可选择取消、等待完成后退出或停止任务并退出。桌面数据保存在 Electron 用户数据目录下的 `data/`，可用 `AGENT_DESKTOP_DATA_DIR` 指定用户数据根目录；应用菜单可直接打开日志目录。

Web 与 Desktop 均在“系统信息 → 网络与代理”配置网络：可继承启动环境的代理、手动填写 HTTP/HTTPS 代理，或不使用代理。手动代理支持独立用户名、密码和绕过地址；本机回环连接始终直连。保存后重启服务生效；“测试连接”使用当前表单在独立进程中验证，不会修改运行中的网络配置。已保存密码不回显，留空保留，使用清除按钮删除。继承环境模式读取环境变量，不会自动读取操作系统代理或 PAC。

同一页面可配置 npm 源，提供官方源和 npmmirror 国内源快捷填入，也支持自定义 HTTPS 源（含仓库子路径）。保存并重启后，Pi、OpenCode、Codex 的版本查询、安装和更新统一使用该源，并保留包完整性校验；Grok 使用独立下载源，不受此设置影响。

系统证书选项和附加 CA 文件用于 Node 网关；附加 CA 也下发给支持 `NODE_EXTRA_CA_CERTS` 的 Agent，其他原生 CLI 是否采用取决于其证书支持。应用更新使用操作系统证书库，企业代理的根证书需安装到操作系统，单独选择附加 CA 文件不会改变更新器的证书信任。

### 源码 Web 模式

需要上述 Node.js 和 pnpm。新实例默认使用受管 CLI，与 Desktop 使用同一个安装与版本页面；也可逐个 Agent 绑定主机已有 CLI，先检测版本、协议和会话恢复能力再切换。外部来源不会被更新或卸载。

```sh
cd code
pnpm install --frozen-lockfile
pnpm build
pnpm web:build
pnpm start
```

打开 [Agent 管理](http://127.0.0.1:3000/agents)；先安装所需 CLI，再在共享资源中添加模型连接，给 Agent 选择模型并保存，然后启用。首次启动未配置模型时，四个 Agent 均停用，管理界面仍可访问。任务入口是 [任务工作台](http://127.0.0.1:3000/tasks)。

业务配置是 `AGENT_DATA_DIR/settings.json`（schemaVersion 3），系统网络配置是 `system.json`。不兼容历史配置或数据库，不提供迁移；请使用新的数据目录重新配置。原生配置单向生成到 `agents/<id>/`；Codex/Grok 的会话配置与上下文放在其下的 `sessions/<sessionId>/`。任务 cwd 始终是实际工作目录。不会复用或修改个人 `~/.codex`、`~/.grok`、Pi 或 OpenCode 配置。

保存资源更改后，受影响 Agent 显示“待应用”；应用时取消尚未开始的排队项，等待当前执行结束后重启该 Agent，随后尝试恢复原生上下文，不重放历史执行。停用也等待当前执行结束；“立即停止”会中断执行。原生导入只读预览已支持字段，密钥需重新填写。

详细配置、限制与 API 示例见 [安装与验收](INSTRUCTION.md)。CLI 来源、下载、更新和卸载流程见 [CLI 版本管理](docs/design/RUNTIME_INSTALL.md)。

## 局域网访问

Desktop 已内置同一个网关 server，在“系统信息 → 网关服务”设置监听地址 `0.0.0.0` 与固定端口，保存并重启后即可供局域网和评测脚本访问。默认监听 `127.0.0.1:3000`，支持自定义 IP、端口和 0 自动分配；界面显示当前访问地址，端口冲突时服务内重启恢复原配置。源码 Web 也可在 `code/` 中启动：

```sh
pnpm start --host 0.0.0.0 --port 3000
```

同一局域网的设备访问 `http://<服务器局域网 IP>:3000/tasks`，并确保主机防火墙允许 TCP 3000。前端构建由网关直接提供，不需要额外启动 Vite。

本机和局域网均无需配对、登录或网关 token；Web、Desktop、HTTP/SSE 和下载共用这一规则。完整[网关 API 文档](code/docs/GATEWAY_API.md)也随安装包提供于 `/api/docs`，含配置、任务、兼容评测、SSE、交互和产物接口；可下载 `/api/examples/evaluate.mjs` 运行自动化评测。

## 常用配置

| 配置 | 作用 |
| --- | --- |
| `AGENT_ENGINE` | 初始化默认 Agent，支持 `pi`、`opencode`、`codex`、`grok`；保存后由 settings.json 管理 |
| `AGENT_HOST` / `AGENT_PORT` | Web/Desktop 默认 `127.0.0.1` / `3000`；Web CLI > 环境变量 > system.json 已保存网关配置 |
| `AGENT_DATA_DIR` | 源码模式默认当前目录下 `.agentbridge`，存放 SQLite、日志和引擎数据 |
| `AGENT_DESKTOP_DATA_DIR` | 桌面用户数据根目录，业务数据位于其 `data/` 子目录 |
| `AGENT_MANAGED_RUNTIMES=false` | 仅初始化时选择外部来源，保存后由每个 Agent 的 runtime 配置管理 |
| `ENGINE_A_COMMAND` / `ENGINE_B_COMMAND` | 初始化外部来源时的 OpenCode / Pi 命令 |
| `CODEX_COMMAND` / `GROK_COMMAND` | Codex / Grok 可执行命令 |
| `ENGINE_A_PORT` | 托管 OpenCode 的内部端口，默认 0 自动分配 |
| `AGENT_OPENAI_BASE_URL` / `AGENT_OPENAI_MODELS` | 无 settings.json 时初始化的兼容服务地址 / 模型 ID |
| `AGENT_OPENAI_API_KEY` / `AGENT_OPENAI_PROVIDER` | 兼容服务密钥 / 供应商 ID，默认 compatible |
| `AGENT_OPENAI_API` | openai-completions（默认）或 openai-responses |
| `AGENT_MODEL` | 默认引擎的兜底模型，JSON 格式 `{"providerID":"...","modelID":"..."}`；请求指定的模型优先 |
| `AGENT_ALLOWED_DIRECTORIES` | 可访问工作目录的绝对路径 JSON 数组，默认空数组不限制目录选择 |
| `AGENT_LIMITS` | 超时、并发和事件保留等限制，详见安装说明 |

模型凭据只配置在服务端，不应提交到 Git。默认 SQLite 数据目录只允许一个网关实例持有写锁；启动多个实例时需分别配置数据目录和网关端口。

## 开发与验证

在 `code/` 下分别开启两个终端：

```sh
# 终端一：后端
pnpm dev --engine pi
```

```sh
# 终端二：前端，默认代理到本机 3000 端口
pnpm web:dev
```

前端开发入口为 `http://127.0.0.1:5173`。提交前检查：

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

Playwright 自动启动独立测试服务，覆盖桌面和手机视口。原生引擎测试需显式启用，见 [安装与验收](INSTRUCTION.md)。逐页截图、问题修复记录和验证边界见 [UI QA 报告](code/artifacts/ui/qa/README.md)。原生 CLI 与本地模型 fixture 的验证独立于真实模型业务验收；具体范围见交付文档，Windows 实机和外部办公链路需要对应环境。

## 仓库文件管理

源码、依赖锁文件、项目设计规范和经审查的 QA 证据纳入版本管理。依赖目录、构建输出、运行数据、认证配置和自动测试报告由 `.gitignore` 排除；交付用 `solution.zip` 按需生成，使用 GitHub Release 附件分发。

Hallmark 是可选的个人设计工具，本项目忽略其安装目录 `.agents/skills/hallmark/`、状态目录 `.hallmark/` 和当前仅记录该工具的 `skills-lock.json`。项目自有的共享技能可按需提交；若以后统一管理团队技能，应恢复跟踪相应技能锁文件并记录安装方式。`design.md` 是项目设计规范，继续保留。

## 常见问题

**`Pi prompt failed` / `BAD_GATEWAY`**：任务诊断和日志保留脱敏后的原生模型错误，先根据其后的 HTTP 状态、认证、模型 ID 或参数信息排查。核对 Agent 的已应用配置版本、模型引用和兼容 API 协议。

**`DISCOVERY_FAILED`**：产物扫描警告与模型请求错误分开处理。日志会记录权限错误、目录消失或扫描上限等具体原因；本轮模型仍可执行，但无法自动登记产物。Windows 目录排查见[安装说明](INSTRUCTION.md#模型失败与-windows-目录排查)。

**显示已连接或引擎就绪，但模型请求失败**：顶部连接状态表示浏览器的事件连接正常；引擎就绪表示进程和协议连接正常。模型认证、额度和供应商可用性需要真实请求验证。

**供应商或模型列表为空**：检查 Agent 的共享连接、模型引用与已应用配置。页面只列出管理配置中分配的模型，连接测试可验证供应商请求。

**重启后旧任务不能继续执行**：历史记录会保留，未完成执行不会重放。已启用 Agent 会尝试恢复原生会话；恢复失败时查看诊断，确认 CLI 版本、原生数据与配置仍可用。

## 目录与文档

| 路径 | 内容 |
| --- | --- |
| `code/shared/` | 前后端共享契约 |
| `code/src/domain/`、`code/src/runtime/` | 状态规则、任务执行和交互用例 |
| `code/src/engines/` | 四个原生 Agent 适配器与进程管理 |
| `code/src/gateway/` | HTTP、SSE 和评测接口 |
| `code/src/storage/`、`code/src/observability/` | SQLite 持久化、指标和观测 |
| `code/web/` | React 工作台 |
| `code/host/` | Web/Desktop 共用的 Node 启动、网络策略与退出管理 |
| `code/desktop/` | Electron 窗口、托盘、目录选择与分发配置 |
| `code/tools/` | Pi 交互扩展与源码打包脚本 |
| `code/test/` | 运行时、原生引擎与 Playwright 测试 |
| `code/artifacts/ui/` | UI 截图与 QA 记录 |

- [网关接口与自动化评测](code/docs/GATEWAY_API.md)
- [安装、配置与 API 验收](INSTRUCTION.md)
- [架构说明](ARCHITECTURE.md)与[开发约定](DEVELOPMENT.md)
- [设计文档索引](docs/design/README.md)
- [前端开发说明](code/web/README.md)
