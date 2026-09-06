# UI 整改验收记录

日期：2026-09-06。范围：本轮视觉、Agent 消息 / Tool、人工交互、任务列表及观测 UI。

## 检查

- `pnpm --filter @agentbridge/web lint`：通过。
- `pnpm web:build`：TypeScript 与 Vite 构建通过。主包约 541 kB，仍有 Vite 500 kB 提示；消息和观测路由维持动态加载。
- `pnpm test:browser`：14 passed、2 skipped，49.4 秒；两项跳过为手机项目不适用的桌面内部滚动和已经单独运行的完整视口矩阵。
- 真实本地服务：OpenCode 1.18.29 状态 ready，SQLite，前端代理连接成功，页面无 JavaScript 异常。没有为了验收发起真实模型任务。

## 截图

`execution / tasks / observability-{light|dark}-{320|375|414|768|1024|1440|1920}.png` 共 42 张，均使用显式测试数据。另有审批、产物、运行中、字体放大与真实网关截图，总计 51 张。

- [任务列表，桌面浅色](tasks-light-1440.png)
- [Agent 执行与 Tool，手机浅色](execution-light-320.png)
- [执行页，平板深色](execution-dark-1024.png)
- [观测页，桌面深色](observability-dark-1440.png)
- [待审批，桌面](approval-desktop.png)
- [交付物，手机](artifacts-mobile.png)
- [运行中，手机](running-mobile.png)
- [放大字体，手机](enlarged-text-mobile.png)
- [真实开发网关首页](live-gateway.png)

浏览器检查不仅检测页面横向滚动，也检测可见操作是否越界。源码样式检查后目视复核了桌面、320px、1024px 深色和放大字体截图；放大字体暴露的顶栏裁切已修复。

## 覆盖与限制

覆盖：创建 / 审批 / 文件下载预览 / 停止 / 删除；安全 Markdown 与复制；累计输出覆盖及 64 KiB 展示预算；工具状态与空值；回复冲突保留输入及过期；URL 筛选、暂停更新、陈旧数据和失败保留快照；上翻与历史位置；中文 IME；键盘焦点、弹层关闭恢复、reduced-motion；主题随系统；任务行焦点稳定。

响应式矩阵在 desktop 项目运行一次；手机项目不重复该矩阵与桌面内部滚动用例。字体放大检查将根字号提升至 32px，不等同于所有浏览器原生缩放组合。

未覆盖：Windows 实机、NVDA / VoiceOver 人工验收、真实 OpenCode / Pi 模型任务、Office 和外部集成全链路；这些不因 UI 回归通过而标记完成。测试样本中的数值与执行内容不是生产指标。
