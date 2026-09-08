# AgentBridge

本目录是 pnpm workspace 安装和命令入口。项目介绍、OpenAI 兼容模型配置、局域网访问及常见问题见[根目录 README](../README.md)，完整配置和 API 调用见[安装与验收](../INSTRUCTION.md)。

源码开发需要 Node.js >= 22.21.0、pnpm 10.33.2。在本目录安装依赖后，可选择 Electron 桌面端或 Web 网关：

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

桌面端命令：

| 命令 | 用途 |
| --- | --- |
| `pnpm desktop:dev` | 构建前后端、准备内置 Node/npm 并启动 Electron |
| `pnpm desktop:pack` | 生成当前平台、当前架构的应用目录，输出到 `desktop-release/` |
| `pnpm desktop:dist` | 生成当前平台分发包，输出到 `desktop-release/`，不自动发布 |
| `pnpm desktop:prepare` | 仅准备桌面构建和运行文件 |
| `pnpm test:desktop` | 构建准备后，在图形环境运行 Electron 冒烟测试 |

桌面基础包不包含 Pi、OpenCode、Codex、Grok CLI。在 Agent 的“安装与版本”页签按需安装官方最新版、检查更新或卸载；安装不启用，卸载保留模型配置、原生会话、任务历史和产物。最终桌面包自带 Node/npm，用户无需全局安装它们。托盘可用时关闭窗口继续后台运行；显式退出时可等待任务结束或停止任务。数据位于 Electron 用户数据目录的 `data/` 下，可通过 `AGENT_DESKTOP_DATA_DIR` 指定根目录。

源码 Web 模式：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm web:build
pnpm start
```

服务注册 Pi、OpenCode、Codex CLI 和 Grok Build。无模型配置时四个 Agent 均停用；在 `/agents` 添加兼容模型连接并按 Agent 分配、保存和启用。`--engine` 只提供首次初始化的默认值；settings.json 保存后是唯一配置源，不复用个人 CLI 目录。

访问 http://127.0.0.1:3000/tasks、http://127.0.0.1:3000/observability 和 http://127.0.0.1:3000/settings。支持当前目录 `.env`，变量见 [.env.example](.env.example)。开发分别运行 `pnpm dev --engine pi` 和 `pnpm web:dev`。

分层：`shared` 为应用契约，`src/domain` 为状态规则，`src/runtime` 为会话/执行/交互用例，`src/storage` 为 SQLite 和事务事件，`src/engines` 为适配器与进程，`src/gateway` 为 HTTP/SSE/评测映射，`src/observability` 为指标，`web` 为前端，`tools` 为 Pi 交互扩展和打包脚本。办公能力通过 skill/MCP 接入。测试引擎仅位于 `test/`，不注册进生产入口。

`host/` 为两种入口共用的 Node 启动与网络管理，`desktop/` 只提供 Electron 系统集成。新实例均默认受管 CLI；每个 Agent 可检测并绑定外部命令。浏览器直接使用相同管理页面，无需配对。Web/Desktop 均可在“系统信息 → 网关服务”配置监听地址和端口。接口文档与自动评测脚本见 [网关 API](docs/GATEWAY_API.md)，运行后可通过 `/api/docs` 阅读。详见[统一运行方案](../docs/design/WEB_DESKTOP.md)。历史配置与数据库不兼容，不提供迁移。

四个内置 Agent 通过 /agents 独立管理，配置与个人 CLI 目录隔离。新增引擎实现 `EngineAdapter`，在 `src/main.ts` 注册，同步更新配置与共享契约中的引擎枚举以及前端选项。引擎原生事件在适配器边界转换为共享 Message/Interaction，再由网关 serializer 输出评测协议。

`pnpm test` 检查网关；先执行 `pnpm web:build` 和 `pnpm exec playwright install chromium`，再通过 `pnpm test:browser` 检查桌面/手机流程。当前验证范围、截图及剩余限制见 [UI QA 报告](artifacts/ui/qa/README.md)。
