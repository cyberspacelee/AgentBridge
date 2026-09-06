# AgentBridge

TypeScript/Fastify + SQLite 网关，OpenCode/Pi 引擎，React + shadcn Base UI + Tailwind CSS 4 工作台。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm web:build
pnpm start --engine pi
```

访问 http://127.0.0.1:3000/tasks 和 http://127.0.0.1:3000/observability。模型鉴权和办公工具准备见上级 `INSTRUCTION.md`。开发分别运行 `pnpm dev --engine pi` 和 `pnpm web:dev`。

分层：`shared` 为应用契约，`src/domain` 为状态规则，`src/runtime` 为会话/执行/交互用例，`src/storage` 为 SQLite 和事务事件，`src/engines` 为适配器与进程，`src/gateway` 为 HTTP/SSE/评测映射，`src/observability` 为指标，`web` 为前端，`tools` 为共用办公工具。测试引擎仅位于 `test/`，不注册进生产入口。

新增引擎实现 `EngineAdapter`，在 `src/main.ts` 注册并扩展 `src/config.ts` 的引擎枚举，复用运行时与 HTTP 路由，不改网关业务逻辑。引擎原生事件在适配器边界转换为共享 Message/Interaction，再由网关 serializer 输出评测协议。

`pnpm test` 检查网关；`pnpm test:browser` 检查桌面/手机流程。当前验证范围和外部缺口见设计目录的 `DELIVERY.md`，不将测试引擎通过写成实际评测通过。
