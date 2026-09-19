# ADR-14：桌面运行时与打包链路重构

状态：已接受（2026-09-19）

## 背景

当前桌面应用由 Electron 主进程启动一个独立 Node 网关，并把 Node/npm 与网关依赖放在 `extraResources`。现有 Linux x64 产物约 172.5 MiB，其中 Node/npm 约 133.7 MiB，网关资源约 32.3 MiB。Node 运行时同时承担两件事：启动网关和在用户安装受管 Agent 时执行 npm。

这造成了重复运行时、较长启动链路和多套进程协议。前端、Web 启动器和桌面入口已经共享 HTTP/SSE 契约，迁移不应改变业务接口或再造一套桌面专用 API。

## 决策

### 1. 进程边界

- Electron 主进程只负责窗口、托盘、更新、可信 IPC、网络设置和网关生命周期。
- 网关在 Electron `utilityProcess` 中运行，继续监听随机 loopback 端口；renderer、Web 启动器和现有 Fastify 路由保持不变。
- 网关与主进程之间使用一个小型 host control transport：Node 子进程使用 IPC，utility process 使用 `process.parentPort`。业务请求仍走 HTTP/SSE，不把领域消息搬进 Electron IPC。
- Agent CLI 仍由网关生成子进程；进程组清理、审批、取消和恢复语义保持现状。

### 2. 打包

- `backend/dist`、生产依赖和 `web/dist` 作为单一 backend resource 随包交付，由 utility process 直接加载；桌面壳本身继续放入 `app.asar`。
- `extraResources` 只保留 backend resource、初始化模板、说明文件和平台资源；移除随包 Node/npm。
- 保留 `asar: true`、中英文 locale 和现有平台目标；不增加产物大小统计、阈值门禁或阻止发布流程。

### 3. Agent 运行时

- 基础桌面包不含 Node/npm。
- 受管 Pi/OpenCode/Codex 安装首次需要 npm 时，在 `AGENT_DATA_DIR/toolchain` 下载并校验固定版本的 Node；下载、解压、版本检查和临时目录替换必须是可恢复的。
- Grok 等独立二进制不需要 Node toolchain。
- Web/CLI 启动器继续使用环境提供的 Node/npm；只有缺少可用 npm 的桌面 utility process 触发懒下载。

### 4. UI/UX

- 保留 React、Vite、Base UI、Tailwind 和现有 semantic tokens，不引入第二套视觉系统。
- 会话工作台重组为 `SessionSidebar`、`ConversationView`、`ContextPanel`、`Composer` 四个清晰区域：宽屏显示右侧上下文，窄屏使用 Sheet；执行状态、审批和问题继续就地反馈。
- Agent、资源和系统设置沿用已有管理页面和状态契约，只改善信息层级、空/错误/加载状态和键盘路径。

## 明确修改范围

### 立即修改

| 文件 | 修改 |
| --- | --- |
| `code/src/host/control.ts` | 新增跨 child IPC/`parentPort` 的 host control 传输适配；统一连接、发送、监听和断开。 |
| `code/src/main.ts` | 使用 control transport 完成 ready、shutdown、drain、disconnect 和生命周期恢复。 |
| `code/src/gateway/system.ts` | 使用 transport 发送 host request，保留现有请求超时和错误映射。 |
| `code/src/engines/process.ts` | 用 transport 上报 Agent 进程组开始/结束。 |
| `code/host/supervisor.mjs` | 支持可注入的桌面进程工厂；保留 Web/CLI 的 Node child process 行为。 |
| `code/desktop/utility-process.mjs` | 新增 utility process 到 Supervisor child-like 生命周期接口的适配。 |
| `code/desktop/main.mjs` | 桌面使用 utility process、从 app 路径加载网关，移除随包 Node/npm 路径。 |
| `code/tools/desktop-prepare.mjs` | 不再下载或裁剪桌面 Node；只准备生产后端、前端和初始化资源。 |
| `code/desktop/builder.json` | 保留后端作为单一 resource，`extraResources` 移除 Node；桌面壳继续使用 ASAR。 |
| `code/src/runtime/runtimes.ts` | 增加按需 Node toolchain 下载、SHA-256 校验和原子安装；npm 安装前确保 toolchain。 |
| `code/src/config.ts` | 允许 utility process 初始使用 Electron Node，toolchain 就绪后由 RuntimeManager 更新路径。 |
| `code/web/src/...` | 按现有页面边界拆分工作台区域，统一会话上下文、Composer 和响应式面板。 |
| `docs/design/README.md` | 登记本 ADR。 |
| `docs/design/DESKTOP_FRAMEWORK.md` | 更新桌面进程与打包事实，避免继续描述随包 Node。 |

### 删除或不再使用

- 删除 `desktop-prepare` 中 Node 归档下载、解压和 Node manifest 字段。
- 删除 `builder.json` 中 `extraResources` 的 `node` 条目；backend resource 保留。
- 不新增打包产物门禁、体积趋势报表、发布阻断器或桌面专用业务 API。

## 生命周期设计

`Supervisor` 仍是网络配置、锁、重启、drain 和 host request 的唯一所有者。它接收一个可选的 `spawnBackend`，默认走 `child_process.spawn`；桌面传入 utility process 工厂。适配器提供 `pid`、`stdout`、`stderr`、`send`、`connected`、`once/on`、`kill` 等最小接口，因此停止、超时和错误恢复逻辑只有一份。

网关入口不再直接读取 `process.send`。transport 只传输以下控制消息：`ready`、`shutdown`、`drain`、`host:request`、`host:response`、`engine-started`、`engine-exited`。utility process 的 MessagePort 事件统一解包为同一消息形状。

## 验收

- `pnpm typecheck`、后端测试、Web 构建通过。
- Web 启动器仍能启动、重启、drain 和处理网络设置。
- Electron 开发和打包启动后端，renderer 仍只能通过安全 preload 访问桌面能力。
- 桌面重启、退出等待/强停、Agent 进程组清理、SSE、设置保存和更新代理行为保持有效。
- 首次安装受管 Node Agent 时才下载 toolchain，下载失败可重试且不会留下半成品。
- 最终验证关注功能和启动/安装路径；不把产物统计或体积阈值作为发布条件。
