# AgentBridge 安装、运行与验收

AgentBridge 提供统一任务网关、OpenCode/Pi 适配器、任务工作台和网关观测。全部 JavaScript 依赖由 **pnpm 10.33.2 workspace** 管理，安装入口为 `code/`，唯一锁文件为 `code/pnpm-lock.yaml`。

本地已验证 Linux、Node 22.23.0、Python 3.13.5。Windows 10/11、实际模型任务和赛题样本尚未验收。本包为当前实现的可复现候选交付件，不代表已通过全部评测。

## 1. 环境准备

安装 Node.js 22.23.0、Python 3.13、pnpm 10.33.2。Windows 使用 PowerShell 和 NTFS 工作目录；Pi 的 bash 工具需要安装 Git for Windows，并确保 `bash.exe` 可用。Outlook 场景另外需要已安装且可启动的 Outlook。安装期间需要访问 npm/PyPI 和引擎二进制下载源。

已有 Corepack 时，可用以下命令启用固定 pnpm：

```powershell
corepack enable
corepack prepare pnpm@10.33.2 --activate
pnpm --version
```

在解压后的 `code/` 目录执行：

```powershell
pnpm install --frozen-lockfile
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r tools\requirements.txt
pnpm build
pnpm web:build
pnpm exec opencode --version
pnpm exec pi --version
```

Linux/macOS 将 Python 两条命令替换为：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r tools/requirements.txt
```

本地 Debian 缺少 ensurepip 时已使用 `uv venv --python /usr/bin/python3 .venv` 和 `uv pip install --python .venv/bin/python -r tools/requirements.txt` 验证。Windows 的依赖安装仍需在目标系统独立执行。

引擎固定为 `opencode-ai@1.18.29` 与 `@earendil-works/pi-coding-agent@0.85.1`，通过项目本地命令启动。workspace 已放行必要的 esbuild/OpenCode 安装脚本，不需要交互式 `pnpm approve-builds`。不要使用 `--ignore-scripts` 跳过 OpenCode 安装。

## 2. 模型配置

模型引用可在每次 HTTP 请求的 `model` 中指定，或通过 `AGENT_MODEL` 配置默认值。模型名称必须存在于所选引擎中。模型凭据使用引擎支持的服务端环境变量，例如供应商的 `OPENAI_API_KEY`；不写入前端、日志或交付包。

OpenCode 使用其官方 provider 配置和环境变量。Pi 默认隔离个人配置，读取 `AGENT_DATA_DIR/pi/` 下的配置；需要自定义 provider/base URL 时，将准备好的 Pi 配置目录通过 `ENGINE_B_CONFIG_DIR` 指定。Pi 的模型注册格式以锁定版本的 `node_modules/@earendil-works/pi-coding-agent/docs/models.md` 为准。模型配置文件可包含秘密，不应提交到源码或打包。

不要用“引擎就绪”推断模型鉴权成功：就绪检查验证进程和协议连接，真实模型请求必须另外验收。

## 3. 启动服务

两引擎分别启动评测。**CLI `--engine` 优先于 `AGENT_ENGINE`，默认 opencode**。停止当前实例后再切换；默认一个数据库仅允许一个网关持有写锁。

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
AGENT_ENGINE=pi pnpm start
```

CLI 通道同样有效：

```sh
pnpm start --engine pi --host 127.0.0.1 --port 3000
```

工作台 `http://127.0.0.1:3000/tasks`；观测 `http://127.0.0.1:3000/observability`。生产构建由同一个网关提供页面。开发时分别运行 `pnpm dev --engine pi` 和 `pnpm web:dev --host 127.0.0.1 --port 5173`，前端代理到 3000。

## 4. 配置表

| 配置 | 默认 / 说明 |
| --- | --- |
| `AGENT_ENGINE` | opencode 或 pi |
| `AGENT_HOST` / `AGENT_PORT` | 127.0.0.1 / 3000 |
| `AGENT_WEB_ORIGIN` | 开发页面来源，默认 http://127.0.0.1:5173；另允许同源写请求 |
| `AGENT_DATA_DIR` | 当前目录下 `.agentbridge`；SQLite、日志和引擎内部数据 |
| `AGENT_STORAGE` | 默认 SQLite；显式 `memory` 时重启丢失网关历史 |
| `AGENT_MODEL` | JSON：`providerID`、`modelID`；请求值优先 |
| `AGENT_ALLOWED_DIRECTORIES` | JSON 绝对路径数组；空数组允许任意可访问工作目录 |
| `AGENT_LIMITS` | JSON，见下方限制；未知字段应避免使用 |
| `AGENT_QUESTION_ANSWER` | 无选项反问的自动回答文本 |
| `AGENT_TOOLS_PYTHON` | 默认项目 `.venv` 下的 Python；可指定其他已准备环境 |
| `ENGINE_A_COMMAND` | opencode；pnpm 会优先解析本地版本 |
| `ENGINE_A_URL` | 未设置时托管 127.0.0.1:4096；设置时连接外部 OpenCode 服务 |
| `ENGINE_A_USERNAME` / `ENGINE_A_PASSWORD` | 原生服务 Basic Auth；托管模式无密码时生成进程私有密码 |
| `ENGINE_B_COMMAND` | pi；pnpm 会优先解析本地版本 |
| `ENGINE_B_ARGS` | JSON 参数数组；只用于受信任部署配置 |
| `ENGINE_B_CONFIG_DIR` | 指定 Pi 配置目录，默认隔离个人全局配置 |
| `BRAVE_SEARCH_API_KEY` | 共用搜索工具的服务端密钥，可选 |

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

stdout 和 `.agentbridge/logs/` 输出 JSON 日志，按 10 MiB/天轮转，保留当前文件及 5 个历史文件。SQLite 错误日志最多保留 10,000 条。正文和密钥不进入常规请求日志。

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

办公工具检查：Windows 为 `.\.venv\Scripts\python.exe -m unittest discover -s tools -p "test_*.py" -v`；Linux 为 `.venv/bin/python -m unittest discover -s tools -p 'test_*.py' -v`。

原生 smoke 不发起模型调用，验证创建、RPC/HTTP、强停、恢复和删除。PowerShell：

```powershell
$env:AGENT_NATIVE_SMOKE = "opencode"
pnpm exec tsx --test test/native.test.ts
$env:AGENT_NATIVE_SMOKE = "pi"
pnpm exec tsx --test test/native.test.ts
Remove-Item Env:AGENT_NATIVE_SMOKE
```

真实引擎与本地模型响应 fixture 的集成测试：验证人工审批前不会写文件、审批后实际执行 write 工具、工具状态和最终 assistant/step-finish 快照。无需外部模型密钥；模型响应由测试 HTTP 服务生成，不用于评估模型能力。OpenCode 测试使用 4096 端口，运行前停止占用该端口的测试实例。

```powershell
$env:AGENT_NATIVE_MODEL = "opencode"
pnpm exec tsx --test test/native.test.ts
$env:AGENT_NATIVE_MODEL = "pi"
pnpm exec tsx --test test/native.test.ts
Remove-Item Env:AGENT_NATIVE_MODEL
```

浏览器测试使用仅在测试服务器中注册的可控引擎，验证真实网关、数据库、SSE、文件下载及前端操作。它不替代真实模型成功执行验收。

`python tools/pack.py` 生成上级目录 `solution.zip`，顶层为 `INSTRUCTION.md` 和 `code/`。源码、统一锁文件、工具、测试与设计文档包含在包中；不包含 node_modules、.venv、密钥、日志、数据库和浏览器测试产物。

尚需补充的外部验收：两版赛题原始协议、Windows 10/11 干净安装、真实模型配置、10 个样本双引擎运行、Outlook 环境、WeLink 租户/发送接口及搜索密钥。WeLink 发送尚未实现，不能将其计为已通过。
