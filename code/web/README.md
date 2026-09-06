# AgentBridge Web

React + TypeScript + Vite + shadcn/ui (Base UI) + Tailwind CSS 4.

包含任务列表、任务分派、多轮执行记录、人工交互、交付物、诊断，以及网关概览/引擎与资源/工具与用量/错误四个观测视图。数据来自真实 HTTP/SSE，测试引擎仅用于自动化检查。

从 workspace 根目录 code 安装依赖并启动前端：

```sh
pnpm install --frozen-lockfile
pnpm web:dev
```

提交前在本目录执行 `pnpm typecheck`、`pnpm lint`、`pnpm build`。

组件按需通过 `pnpm exec shadcn add <component>` 引入，保持 `components.json` 中的 `base-nova` 配置。前后端共享 code/pnpm-lock.yaml。

详细约束见 [开发规范](../../DEVELOPMENT.md)，分层与业务契约见 [架构设计](../../ARCHITECTURE.md)。
