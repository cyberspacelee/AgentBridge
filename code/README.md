# AgentBridge

本目录是 pnpm workspace 安装和命令入口。项目介绍、模型认证、局域网访问及常见问题见[根目录 README](../README.md)，完整配置和 API 调用见[安装与验收](../INSTRUCTION.md)。

需要 Node.js >= 22.21.0、pnpm 10.33.2。在本目录执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm web:build
pnpm start
```

启动前应配置所用引擎的模型认证。服务同时注册 Pi 和 OpenCode，新任务可选择引擎、供应商和模型；`--engine pi` 仅改变默认引擎。Pi 默认读取隔离配置，复用个人配置时需设置 `ENGINE_B_CONFIG_DIR`。

访问 http://127.0.0.1:3000/tasks、http://127.0.0.1:3000/observability 和 http://127.0.0.1:3000/settings。支持当前目录 `.env`，变量见 [.env.example](.env.example)。开发分别运行 `pnpm dev --engine pi` 和 `pnpm web:dev`。

分层：`shared` 为应用契约，`src/domain` 为状态规则，`src/runtime` 为会话/执行/交互用例，`src/storage` 为 SQLite 和事务事件，`src/engines` 为适配器与进程，`src/gateway` 为 HTTP/SSE/评测映射，`src/observability` 为指标，`web` 为前端，`tools` 为 Pi 交互扩展和打包脚本。办公能力通过 skill/MCP 接入。测试引擎仅位于 `test/`，不注册进生产入口。

新增引擎实现 `EngineAdapter`，在 `src/main.ts` 注册，同步更新配置与共享契约中的引擎枚举以及前端选项。引擎原生事件在适配器边界转换为共享 Message/Interaction，再由网关 serializer 输出评测协议。

`pnpm test` 检查网关；先执行 `pnpm web:build` 和 `pnpm exec playwright install chromium`，再通过 `pnpm test:browser` 检查桌面/手机流程。当前验证范围、截图及剩余限制见 [UI QA 报告](artifacts/ui/qa/README.md)。
