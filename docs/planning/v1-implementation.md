# V1 implementation

工作分支：`implement/v1`。规格：[Issue #1](https://github.com/yiwer/Skynet/issues/1)、[PRD](../requirements/PRD.md)、[验收标准](../requirements/v1-acceptance.md)。

实现采用 [tracer-bullet ticket 图](tracer-bullet-tickets.md)，范围为 #4–#33；V2 的 #3 与 #34–#54 不在本次范围。每个实现任务使用独立 worktree，合并到同一草稿 PR。代码与合成测试通过不等同于真实客户端验收通过。

## 当前状态

- #4：开始实现 Codex Desktop 新会话入档的最小完整链路。
- #5–#33：等待前置 ticket；尚未完成。
- G0–G4：未通过。原生恢复、真实分析、客户端 MCP 授权与五个工作日试点必须保留实测证据。

## 已确认的开发环境

- Windows，Node 24.12.0，npm 11.6.2。
- Docker Engine 29.2.0，Linux containers 可用；开发测试使用隔离容器和合成材料。
- 现有 Codex CLI、Claude Code 与 Desktop 安装不代表已有可用的隔离测试账号或已验证的支持组合。
- 测试不读取真实员工会话，不修改真实 Agent 配置，不将现有登录凭据复制到测试环境。

## 验收记录要求

每个 ticket 记录实现提交、实际运行命令、环境、测试结果、未解决项和后续依赖。门槛未通过时保持草稿，不关闭规格与未验收 ticket。
