# AgentBridge 安装、运行与验收

AgentBridge 提供统一任务网关、OpenCode/Pi 适配器、任务工作台和网关观测。全部 JavaScript 依赖由 **pnpm 10.33.2 workspace** 管理，安装入口为 `code/`，唯一锁文件为 `code/pnpm-lock.yaml`。

本地已验证 Linux、Node 22.23.0、Python 3.13.5，Pi 和 OpenCode 均完成真实模型最小请求验证。Windows 10/11、完整办公任务和赛题样本尚未验收。当前功能与启动入口见 [README](README.md)，逐页验证记录见 [UI QA 报告](code/artifacts/ui/qa/README.md)。本包为当前实现的可复现候选交付件，不代表已通过全部评测。

## 1. 环境准备

安装 Node.js 22.23.0、pnpm 10.33.2。Windows 使用 PowerShell；Pi 的 bash 工具需要安装 Git for Windows，并确保 `bash.exe` 可用。安装期间需要访问 npm 和引擎二进制下载源。办公 skill/MCP 的外部依赖按其自身说明安装。

已有 Corepack 时，可用以下命令启用固定 pnpm：

```powershell
corepack enable
corepack prepare pnpm@10.33.2 --activate
pnpm --version
```

在解压后的 `code/` 目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm web:build
pnpm exec opencode --version
pnpm exec pi --version
```

引擎固定为 `opencode-ai@1.18.29` 与 `@earendil-works/pi-coding-agent@0.85.1`，通过项目本地命令启动。workspace 已放行必要的 esbuild/OpenCode 安装脚本，不需要交互式 `pnpm approve-builds`。不要使用 `--ignore-scripts` 跳过 OpenCode 安装。

## 2. 模型配置

模型引用可在每次 HTTP 请求的 `model` 中指定，或通过 `AGENT_MODEL` 配置默认引擎的兜底值。工作台新建任务支持选择引擎、供应商和模型；后续轮次默认沿用上次的模型。模型名称必须存在于所选引擎中。模型凭据使用引擎支持的服务端环境变量，例如供应商的 `OPENAI_API_KEY`；不写入前端、日志或交付包。

OpenCode 使用其官方 provider 配置和环境变量。Pi 默认隔离个人配置，读取 `AGENT_DATA_DIR/pi/` 下的配置；需要自定义 provider/base URL 时，将准备好的 Pi 配置目录通过 `ENGINE_B_CONFIG_DIR` 指定。Pi 的模型注册格式以锁定版本的 `node_modules/@earendil-works/pi-coding-agent/docs/models.md` 为准。模型配置文件可包含秘密，不应提交到源码或打包。

不要用“引擎就绪”推断模型鉴权成功：就绪检查验证进程和协议连接，真实模型请求必须另外验收。

### 配置页面与 env

`/settings` 可添加、编辑、禁用和删除 OpenAI 兼容供应商及模型，支持 Chat Completions 和 Responses。密钥保存在 `AGENT_DATA_DIR/settings.json`（POSIX 权限 0600），接口仅返回掩码；保留掩码表示不更改，清空表示移除密钥。配置更新带版本校验，冲突时刷新后重新编辑。

启动时自动加载当前工作目录 `.env`，已有进程环境变量优先。见 [env 示例](code/.env.example)。`AGENT_OPENAI_BASE_URL`、`AGENT_OPENAI_MODELS`（逗号分隔）、`AGENT_OPENAI_API_KEY`、`AGENT_OPENAI_PROVIDER` 可配置两个引擎共用的兼容模型；`AGENT_OPENAI_API` 默认为 `openai-completions`，也可设为 `openai-responses`。同名供应商 env 优先于页面配置。供应商列表仍在新建任务时选择。

OpenCode 自动读取用户原生 JSON/JSONC 配置及认证，也可在页面指定额外配置文件。Pi 页面可选择用户 `~/.pi/agent` 或其他目录，直接复用该目录的模型、认证、skills 和插件；`ENGINE_B_CONFIG_DIR` 优先于页面选择。页面添加的模型通过扩展注册，不改写用户的 `models.json`。

Skills 管理登记本地目录，支持两个引擎或单一引擎、启用/禁用和移除引用，保留原目录和附件；目录内容遵循原生 `SKILL.md` 格式。原生配置已加载的资源仍由原生配置管理。OpenCode MCP 支持 stdio 命令数组与环境变量，或远程 HTTP URL 与请求头。MCP 的环境变量和请求头保存后均被掩码。

Pi 插件页调用锁定版本的 `pi install/remove`，支持 `npm:`、`git:`、HTTPS 或本地绝对路径；写入当前显示的 Pi 配置目录。选个人目录时安装/卸载也作用于该目录。Pi 的 MCP/subagent 由插件提供，插件的配置格式、RPC 兼容性和能力以插件自身文档为准；网关不内置 MCP 客户端或 subagent 调度器。

Pi 配置和插件变更对新建任务生效；OpenCode 变更需重启网关并新建任务，页面显示待重启状态。外部 `ENGINE_A_URL` 服务需在其部署端应用配置。重启会终止运行中的任务并使旧会话不可继续，先完成当前任务。内置 Office 工具及 Python 依赖已移除，办公任务需要自行接入 skill 或 MCP。

### 配置使用示例

在 `code/.env` 中配置一个兼容服务，以下地址、模型 ID 和密钥需替换为实际值。Base URL 填 API 根路径，通常以 `/v1` 结尾，不填 `/chat/completions`；无鉴权的本地服务可省略密钥。

```dotenv
AGENT_OPENAI_BASE_URL=https://api.example.com/v1
AGENT_OPENAI_PROVIDER=company
AGENT_OPENAI_MODELS=model-one,model-two
AGENT_OPENAI_API=openai-completions
AGENT_OPENAI_API_KEY=replace-with-your-key
AGENT_MODEL={"providerID":"company","modelID":"model-one"}
```

`.env` 相对启动时的工作目录读取，不自动向父目录查找；修改后重启进程才生效。路径变量必须填写实际绝对路径，不会执行 shell 的 `$HOME` 或 `~` 展开。只创建配置文件不会启动服务。

| 设置 | 优先级与范围 |
| --- | --- |
| 网关启动参数 | CLI 的 engine/host/port 高于对应环境变量；进程环境高于 `.env` |
| 共用兼容供应商 | env 同名供应商覆盖页面项；页面删除或禁用该项不移除 env 配置 |
| 兼容服务密钥 | `AGENT_OPENAI_API_KEY` 优先，否则回退到 `OPENAI_API_KEY`；显式空字符串表示无密钥 |
| Pi 配置目录 | `ENGINE_B_CONFIG_DIR` > 页面目录 > `AGENT_DATA_DIR/pi` |
| OpenCode 额外配置文件 | 页面非空路径传给托管子进程的 `OPENCODE_CONFIG`，否则继承该环境变量；原生全局/项目配置仍由 OpenCode 合并 |
| 模型选择 | 新建任务选定的模型优先；`AGENT_MODEL` 只为默认引擎提供兜底，不自动指定供应商可用列表 |

页面“模型”中添加供应商时，名称填 `company`，通过“添加模型”为同一供应商登记多个模型。每行独立填写模型 ID、上下文长度和最大输出长度，例如一个模型配置 32000/4096，另一个配置 200000/16384。保存、刷新或修改供应商地址时保留各模型的独立数值；删除行后保存才生效，至少保留一个模型。URL、模型 ID、协议和密钥应与供应商一致。供应商名称只能使用字母、数字、下划线或连字符；名称在编辑时保持不变。清空密钥后，兼容服务会收到用于无鉴权服务的占位值 `not-required`。页面新建模型默认上下文为 128000、最大输出为 16384，也可通过下述 API 的模型字段 `contextWindow`、`maxTokens` 指定。这些值声明模型限制，不会扩大供应商实际支持的上下文。

本地 Skill 目录示例：

```text
/absolute/path/company-skills/
  office/
    SKILL.md
    scripts/
    references/
```

在“Skills”中登记 `/absolute/path/company-skills`，选择 `OpenCode + Pi` 或单一引擎。`SKILL.md` 按原生格式提供名称、描述和任务说明，脚本与附件留在原目录。移除引用只停止网关显式加载该目录；若原生配置也引用了它，仍须在原生配置中移除。网关不下载或自动编写 Skill 文件。

OpenCode MCP 本地连接表单分别填写命令数组和环境变量对象，例如：

```json
["node", "/absolute/path/office-mcp/server.mjs"]
```

```json
{"OFFICE_WORKSPACE":"/absolute/path/documents"}
```

远程连接填写 `https://mcp.example.com/mcp`，请求头可填 `{"Authorization":"Bearer replace-with-token"}`。这些示例不包含 MCP 实现，必须准备实际可用的服务；页面保存成功只表示配置已写入，不表示 MCP 连接或办公功能已通过验证。OAuth 登录等操作仍由原生服务处理。

Pi 插件来源支持 `npm:package-name@version`、`git:github.com/owner/repo@tag` 或本地包绝对路径。先保存 Pi 配置目录，再安装插件；以页面显示的“当前目录”为准，特别注意环境变量可能覆盖输入值。安装调用原生包管理器，可能下载依赖并执行包的安装脚本；卸载遵循 Pi 的原生语义，本地包只移除引用。安装失败会返回错误，安装操作最长等待 120 秒。插件需兼容 Pi 的 RPC 模式，其工具调用在手动权限模式下仍须经网关审批。

### 配置管理 API

| 接口 | 请求与结果 |
| --- | --- |
| `GET /api/settings` | 返回 `settings`、`revision`、`restartRequired`、本地默认路径、实际 Pi 目录、环境来源标志和已安装 `packages`；敏感字段为掩码 |
| `PUT /api/settings` | 请求 `{"revision":"上次读取的值","settings":{...完整配置...}}`；成功返回更新后的视图 |
| `POST /api/settings/pi/packages` | 请求 `{"action":"install或remove","source":"插件来源"}`；完成后返回更新后的配置视图 |

`PUT` 是整个网关配置的替换，不是局部 PATCH。读取最新视图后修改其中的 `settings`，保留其余字段并带回 `revision`；从相应数组移除条目即为删除。供应商密钥、MCP 环境变量及请求头的 `********` 表示保留原值，不能用于一个没有旧值的新字段。版本冲突返回 409，输入不合法返回 400；失败时应先处理错误，不应假定变更已经生效。

一个完整 `settings` 对象示例（路径和服务必须先存在）：

```json
{
  "piConfigDirectory": "",
  "opencodeConfigFile": "",
  "providers": [{
    "id": "company",
    "baseUrl": "https://api.example.com/v1",
    "api": "openai-completions",
    "apiKey": "replace-with-your-key",
    "models": [{"id":"model-one","name":"Model One","contextWindow":32000,"maxTokens":4096}],
    "enabled": true
  }],
  "skills": [{"id":"office","path":"/absolute/path/company-skills","engine":"both","enabled":true}],
  "mcp": [{
    "id": "office",
    "enabled": true,
    "config": {"type":"local","command":["node","/absolute/path/office-mcp/server.mjs"],"environment":{}}
  }]
}
```

页面登记的配置和个人原生文件分别管理；删除网关供应商不会删除个人配置、认证或模型缓存。POSIX 文件权限不等于加密，备份 `settings.json` 时按密钥文件处理。办公能力迁移后不再执行原来的 `tools/office.py`，也无需安装旧的 Python requirements；由所选 Skill/MCP 提供文档生成、编辑与校验能力。

## 3. 启动服务

服务同时注册 Pi 和 OpenCode，新任务可独立选择引擎，无需重启。**CLI `--engine` 优先于 `AGENT_ENGINE`，默认 opencode**，仅决定未显式选择时的默认引擎。下列启动方式任选其一；默认一个数据库仅允许一个网关持有写锁。

PowerShell，OpenCode：

```powershell
$env:AGENT_ENGINE = "opencode"
$env:AGENT_MODEL = '{"providerID":"<provider>","modelID":"<model>"}'
pnpm start
```

PowerShell，Pi：

```powershell
$env:AGENT_ENGINE = "pi"
$env:AGENT_MODEL = '{"providerID":"<provider>","modelID":"<model>"}'
pnpm start
```

Linux/macOS：

```sh
AGENT_ENGINE=opencode pnpm start
# 或以 Pi 为默认引擎，并复用已有的个人配置
ENGINE_B_CONFIG_DIR="$HOME/.pi/agent" AGENT_ENGINE=pi pnpm start
```

CLI 通道同样有效：

```sh
pnpm start --engine pi --host 127.0.0.1 --port 3000
```

工作台 `http://127.0.0.1:3000/tasks`；观测 `http://127.0.0.1:3000/observability`；配置 `http://127.0.0.1:3000/settings`。生产构建由同一个网关提供页面。开发时分别运行 `pnpm dev --engine pi` 和 `pnpm web:dev --host 127.0.0.1 --port 5173`，前端代理到 3000。

## 4. 配置表

| 配置 | 默认 / 说明 |
| --- | --- |
| `AGENT_ENGINE` | 默认引擎 opencode 或 pi，新任务可覆盖 |
| `AGENT_HOST` / `AGENT_PORT` | 127.0.0.1 / 3000 |
| `AGENT_WEB_ORIGIN` | 开发页面来源，默认 http://127.0.0.1:5173；另允许同源写请求 |
| `AGENT_DATA_DIR` | 当前目录下 `.agentbridge`；SQLite、日志和引擎内部数据 |
| `AGENT_STORAGE` | 默认 SQLite；显式 `memory` 时重启丢失网关历史 |
| `AGENT_MODEL` | 默认引擎的兜底模型，JSON：`providerID`、`modelID`；请求值优先 |
| `AGENT_ALLOWED_DIRECTORIES` | JSON 绝对路径数组；空数组允许任意可访问工作目录 |
| `AGENT_LIMITS` | JSON，见下方限制；未知字段应避免使用 |
| `AGENT_QUESTION_ANSWER` | 无选项反问的自动回答文本 |
| `AGENT_OPENAI_BASE_URL` / `AGENT_OPENAI_MODELS` | 兼容服务 URL / 逗号分隔的模型 ID |
| `AGENT_OPENAI_API_KEY` / `AGENT_OPENAI_PROVIDER` | 服务端密钥 / 供应商名称，默认 compatible |
| `AGENT_OPENAI_API` | openai-completions 或 openai-responses |
| `ENGINE_A_COMMAND` | opencode；pnpm 会优先解析本地版本 |
| `ENGINE_A_URL` | 未设置时托管 127.0.0.1:4096；设置时连接外部 OpenCode 服务 |
| `ENGINE_A_PORT` | 托管 OpenCode 端口，默认 4096；已有服务占用时可改为其他空闲端口 |
| `ENGINE_A_USERNAME` / `ENGINE_A_PASSWORD` | 原生服务 Basic Auth；托管模式无密码时生成进程私有密码 |
| `ENGINE_B_COMMAND` | pi；pnpm 会优先解析本地版本 |
| `ENGINE_B_ARGS` | JSON 参数数组；只用于受信任部署配置 |
| `ENGINE_B_CONFIG_DIR` | 指定 Pi 配置目录，默认隔离个人全局配置 |

`AGENT_LIMITS` 支持：`runTimeoutMs=600000`、`startupTimeoutMs=30000`、`abortTimeoutMs=10000`、`maxConcurrentRuns=4`、`maxQueuedPerSession=16`、`maxSessions=100`、`maxSseConnections=100`、`maxArtifactDownloads=2`、`maxEvents=100000`、`maxEventBytes=134217728`、`eventRetentionMs=86400000`、`maxPartBytes=1048576`。执行总预算包含排队与交互等待。未知配置键会被拒绝。

该版本面向受信任的单实例评测/本地环境。权限默认为自动放行；不包含多租户认证与网络边界隔离。未经部署侧认证配置，不要直接暴露到公网。

## 5. 自动评测调用

1. `GET /health/ready` 返回 200 后创建会话。
2. `POST /session`，body 为 `{"directory":"D:\\test_data\\case","title":"case"}`。
3. 连接 `GET /event`，接收 `server.connected` 及每 15 秒一次心跳。
4. `POST /session/{id}/prompt_async`，body 为 `{"parts":[{"type":"text","text":"任务要求"}],"model":{"providerID":"...","modelID":"..."}}`。
5. 此请求阻塞到对应轮次完成，成功后返回 **204**。失败/超时/取消不会返回成功 204。
6. `GET /session/{id}/message` 获取消息快照。成功判定为最后一条 assistant、`info.finish="stop"`、parts 中包含 `step-finish`。
7. `POST /session/{id}/abort` 或 `/stop` 停止当前及排队轮次；`DELETE /session/{id}` 删除会话与网关记录，保留工作目录文件。

`GET /session/status` 返回全量 idle/busy。`GET /question`、`GET /permission` 返回待处理项。回复接口为 `POST /question/{id}/reply`（`{"answers":[["answer"]]}`）和 `POST /permission/{id}/reply`（`{"decision":"once|always|reject"}`）。原始通用规范的字段如与上述不同，需要在评测 serializer 中对齐；尚未获得的 myagent 1.1 八个别名未伪造实现。

应用 API 位于 `/api/`，创建/追加任务返回 202；`submissionId` 是提交幂等键。SSE 应用流 `/api/events` 带命名事件和持久化 cursor，可通过 `Last-Event-ID` 回放；过期 cursor 返回 `server.resync_required`。浏览器会重新取快照。

## 6. 观测与恢复

观测页面包括执行结果/排队/P50/P95、引擎状态/进程/重启、网关 RSS/堆/事件循环、工具失败、Token/费用及缺失覆盖、错误下钻、HTTP 状态、SSE 连接/字节/背压断开、SQLite 和事件保留量。`GET /metrics` 提供 Prometheus 格式。引擎子进程内存目前为未知。

stdout 和 `.agentbridge/logs/` 输出 JSON 日志，`time` 使用 UTC ISO 8601 格式（例如 `2026-09-07T08:30:00.123Z`）。文件按 10 MiB/天轮转，保留当前文件及 5 个历史文件。SQLite 错误日志最多保留 10,000 条。正文和密钥不进入常规请求日志。

### 模型失败与 Windows 目录排查

任务“诊断”和日志通过 `runId`、`sessionId` 关联。模型失败保留 Pi 的 `errorMessage`/RPC 错误以及 OpenCode 的原生错误、上游 HTTP 状态和错误原因；进程启动/退出失败保留退出码、信号和有界 stderr 摘要。错误文本保留受支持的诊断字段，配置中的兼容服务密钥和常见凭据格式会脱敏，过长文本截断；不输出完整请求、认证头或整个上游响应对象。

`DISCOVERY_FAILED` 是模型执行前的产物目录扫描警告，不等同于模型鉴权失败，也不会单独阻止模型执行。新日志在原提示后追加具体异常，例如 `EPERM`/`EACCES` 权限错误、`ENOENT` 文件或目录消失，或超过 10000 条扫描项的上限；路径按运行网关的机器解析。Windows 上优先选择专用任务目录，避免使用整个盘符或包含无权访问目录的根目录。扫描失败时无法建立可靠的执行前清单，本轮不会自动登记产物，不把已有文件误认成新产物。

`BAD_GATEWAY` 表示引擎未成功完成，查看其后的具体原因：401/403 应检查认证和模型权限；404 应检查 Base URL、API 协议和模型 ID；上下文或输出参数被拒绝时，按实际供应商限制调整对应模型。成功保存配置只表示文件写入成功，无法证明服务端接受这套参数。

更新源码后先在 `code/` 执行 `pnpm build` 和 `pnpm web:build`，再由部署方重启服务并创建新任务。历史记录不会自动补回之前丢弃的错误信息。Windows 可读取数据目录下 `logs/gateway*.log`，或在页面按失败任务查看诊断；若配置了 `AGENT_DATA_DIR`，日志位置以该目录为准。跨机器问题仍需在目标 Windows 环境复测；本地模拟 Windows 错误文本和本地模型服务的检查不能替代 Windows 实机验收。

同会话串行执行，不同会话最多并发 4 轮。原生上下文异常时终止当前轮次；可恢复的上下文有界重建，旧轮次保持失败，不自动重放。网关重启保留历史，将未完成轮次记为失败；跨网关重启的旧会话上下文标为不可用，需新建任务。此版本不声称能清理主进程被强杀后所有逃逸的子进程。

## 7. 检查与交付物

在 `code/` 执行：

```sh
pnpm typecheck
pnpm --filter @agentbridge/web lint
pnpm test
pnpm build
pnpm web:build
pnpm exec playwright install chromium
pnpm test:browser
```

办公 skill/MCP 的验证按所安装集成的测试说明执行。

原生 smoke 不发起模型调用，验证创建、RPC/HTTP、强停、恢复和删除。PowerShell：

```powershell
$env:AGENT_NATIVE_SMOKE = "opencode"
pnpm exec tsx --test test/native.test.ts
$env:AGENT_NATIVE_SMOKE = "pi"
pnpm exec tsx --test test/native.test.ts
Remove-Item Env:AGENT_NATIVE_SMOKE
```

真实引擎与本地模型响应 fixture 的集成测试：验证人工审批前不会写文件、审批后实际执行 write 工具、工具状态和最终 assistant/step-finish 快照。无需外部模型密钥；模型响应由测试 HTTP 服务生成，不用于评估模型能力。OpenCode 测试默认使用 4096 端口；若已占用，用 `ENGINE_A_PORT` 选择其他空闲端口，例如 Linux/macOS 的 `ENGINE_A_PORT=4097 AGENT_NATIVE_MODEL=opencode pnpm exec tsx --test test/native.test.ts`。测试会临时启动并清理测试进程。

```powershell
$env:AGENT_NATIVE_MODEL = "opencode"
pnpm exec tsx --test test/native.test.ts
$env:AGENT_NATIVE_MODEL = "pi"
pnpm exec tsx --test test/native.test.ts
Remove-Item Env:AGENT_NATIVE_MODEL
```

浏览器测试使用仅在测试服务器中注册的可控引擎，验证真实网关、数据库、SSE、文件下载及前端操作。它不替代真实模型成功执行验收。

`python tools/pack.py` 生成上级目录 `solution.zip`，顶层为 `INSTRUCTION.md` 和 `code/`。源码、统一锁文件、工具、测试、`.env.example` 与设计文档包含在包中；不包含实际 `.env`、node_modules、.venv、密钥、日志、数据库和浏览器测试产物。Python 仅为该可选打包脚本所需，不是网关运行依赖。

尚需补充的外部验收：两版赛题原始协议、Windows 10/11 干净安装、真实模型配置、10 个样本双引擎运行、Outlook 环境、WeLink 租户/发送接口及搜索密钥。WeLink 发送尚未实现，不能将其计为已通过。
