# Issue #22：暂停中的分析实现草稿

2026-09-28，用户要求在下一个稳定节点停下。本票**未完成，未接入产品，不应合入 V1 交付分支**。此独立提交仅保存恢复工作所需的草稿；GitHub #22、#21 前置门槛和 G3 均保持开放。

## 已保存的代码

- `packages/contracts/analysis.ts`：目标、主题、活动、成果、阻塞、待继续和不确定项的候选结构，以及证据引用和状态类型。
- `apps/server/analysis.ts`：候选 PostgreSQL 任务/运行时/预算表、短会话输入准备、分页查询与逐字证据校验。主应用尚未注册迁移或 API。
- `apps/analysis/config.ts`：显式千问按量配置与独立凭据文件；单独标记仅限 loopback 的合成 fixture 模式。不会自动读取 `DASHSCOPE_API_KEY` 或用户 Claude 配置。
- `apps/analysis/native.ts`：候选独立 home/cwd、实际 Claude Code CLI 启动、工具禁用、固定上游传输和资源限制；尚未跑实际原生进程验证。
- `apps/analysis/worker.ts`：候选独立进程、持久排队、单并发、预算预留、截止时间和结果写入。尚未部署或运行。

草稿通过 TypeScript / Vite 构建；这不构成任务、预算、隔离、原生模型或端到端行为验证。没有新增分析测试，没有模型调用，没有读写真实员工材料或凭据。

## 恢复时的顺序

1. 重新读取 AGENTS、CONTEXT、ADR 0003、PRD、#22 和 #23/#24；合并当时 V1 主线。先审查草稿边界，再决定保留、修订或替换，不能直接把草稿视为可用模块。
2. 验证原生命令、结构化输出及限制。已有外部可行性实验位于 `%TEMP%/skynet-v1-implementation/analysis-readiness.md`；Windows / Linux Claude Code 2.1.281 的 loopback 实验只是可行性证据，不是本草稿的产品测试。
3. 完成公开 HTTP 发起/查询、Web 会话面板、MCP 查询同一结果，并从每条引用跳回 #27 的固定 snapshot/line/block/textOffset/parserVersion。
4. 通过公开存档→分析→查询→原件引用流程编写行为测试；拒绝不匹配原句、伪造事件、无证据结论。自述测试通过不能升级为已验证成果；目前草稿仅允许工具原文逐字匹配时标记“记录已观察”。
5. 用真实 Claude CLI + 明确标记的 loopback provider 验证隔离、恶意 Bash/外发请求无副作用、凭据与配置不继承、分析会话不回流采集、未知用量不记零，并验证失败期间上传/读取/导出持续可用。
6. 完成部署配置/独立 worker 镜像、实际 Linux 运行和清理。真实千问 PAYG 需要用户提供专用配置位置、模型及预算；已有问题尚待回答，不要猜测或试用现有环境密钥。

## 草稿尚需审查的具体问题

- 预算：按请求 UTF-8 字节上限和输出 token 上限预留人民币预算只是候选保守策略，必须验证指定千问模型、缓存/隐藏用量的价格上限与真实请求格式。CLI 内置美元估计不等于千问账单。尚无结算/受控退款。
- 传输：对消息、工具、非文本输入、请求路径/重定向、并发请求、响应大小、断流、超时与进程退出逐项验证。当前非文本检测是待替换/证明的简单检查，不能称安全边界已验收。
- 生命周期：当前心跳只有一个固定 worker ID；不同配置并存、旧配置排队、崩溃后的状态、退出时取消在途转发、资源清理、Windows 目录权限都未验证。#24 将扩展租约/重试，但第一条链自身也必须有可靠界限。
- 输入：当前只准备主原件全部已解析事件。未知行、未闭合末行、关联材料和不可解析范围必须可见；长会话不能静默截断后显示全文分析。
- #18 的动态 `captureStatus` 与不可变 `manifest.capture.gaps` 分开。分析输入应保留不可变缺口；动态健康观察若纳入，需要保存当时的观察版本，不能把恢复状态当原件完整证明。
- 认证、配置错误的可见状态、队列/结果容量、重算版本和并发请求幂等性尚无公开测试。

## 本分支附带的独立认证修复

提交 `88d4c7f` 与分析草稿无关，可单独合并：停用账号后的会话刷新触发 logout 时复位 loading，允许其他有效账号重新登录。真实 401 被暂缓到刷新进入 busy 后再释放，回归先失败、修复后通过；`tests/identities.test.ts` 1/1，6.25 秒。证据目录 `%TEMP%/skynet-test-la9Uox`。测试浏览器、服务器与 PostgreSQL 容器已关闭。

官方运行时参考：[非交互 Claude Code](https://code.claude.com/docs/en/headless)、[CLI 参数](https://code.claude.com/docs/en/cli-reference)、[千问 Claude Code 配置](https://platform.qianwenai.com/docs/developer-guides/clients-and-developer-tools/claude-code)。这些说明支持实施方向，不代替实际模型验收。
