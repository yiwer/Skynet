# V1 implementation

工作分支：`implement/v1`。规格：[Issue #1](https://github.com/yiwer/Skynet/issues/1)、[PRD](../requirements/PRD.md)、[验收标准](../requirements/v1-acceptance.md)。

实现采用 [tracer-bullet ticket 图](tracer-bullet-tickets.md)，范围为 #4–#33；V2 的 #3 与 #34–#54 不在本次范围。每个实现任务使用独立 worktree，合并到同一草稿 PR。代码与合成测试通过不等同于真实客户端验收通过。

## 当前状态

- #4：合成输入的设备绑定→hook→后台→原件持久化→认证 Web 查询已实现，提交 `61a5337` 已合并；真实 Desktop 自动采集尚未验收。
- #5：认证完整可读导出、带清单与校验的原生包、全新目录恢复已实现，提交 `b8c49a1` 已合并。实际 Desktop 内置后端通过服务器下载包恢复上下文和工具历史；Desktop 界面验收仍未通过。
- #7：Claude CLI 两项目普通 hooks 自动采集、Web 查询及服务器包原生恢复已实现，提交 `ac66a80` 已通过 `ed4735d` 合并。实际 Claude 2.1.281 运行测试保留原 UUID、上下文和工具结果；模型为隔离确定性替身，单原件范围，G0 不由此通过。
- #6：Codex CLI 正常审核产品 hook、两项目自动采集和服务器独立恢复已实现，提交 `794a7e4` 已通过 `d979c83` 合并。三来源集成后类型检查、构建、4 项普通流程与 3 项原生测试通过；hook 快路径的 200 次进程启动与持久入队实测 P95 为 74.2 ms。真实代码修改和完整 G0 仍待验收。
- #8：旧会话完整接管、已确认前缀的增量上传及来源日期已实现，提交 `739b1c6` 已通过 `883e517` 合并。5 项公开流程与 3 项原生恢复回归通过；后续两个 CLI 的真实旧会话续用诊断也已通过，Desktop 及完整支持组合验收仍开放。
- #9：文件代次与关联材料正在实现，包括 Codex 原生分支明确引用的父原件；父材料作为上下文保存，不计为新活动。
- #11：正式 npm 单 Key 接入正在基于现有适配器实现，共用设备身份与后台，并分别显示配置、信任、首次事件和上传状态。G0 前置验收仍未通过，不因此宣称正式安装验收完成。
- #20：维护者停用账号/设备、逐请求撤销及操作审计已通过 `ec65e04` 合并；与 #8 集成的 6 项公开流程测试通过，可信接入边界保留。#11 安装前置验收仍未通过。
- #26：已开始实现个人 OAuth 授权的 HTTPS MCP 读取与导出，复用已合并的身份撤销边界；尚未完成真实客户端授权验收。
- #10、#12–#19、#21–#25、#27–#33：尚未完成；依赖与门槛继续按 ticket 图核查。
- G0–G4：未通过。原生恢复、真实分析、客户端 MCP 授权与五个工作日试点必须保留实测证据。
- [草稿 PR #55](https://github.com/yiwer/Skynet/pull/55) 已保存实现与规格关闭引用；保持草稿，尚无 ticket 通过验收或被关闭。
- 本地类型检查、构建、公开入口 E2E、Linux 容器持久卷重启验证及初次 GitHub CI 通过；[两路评审](../implementation/review-issue-4.md) 的可修复代码问题已在 `9ad3277` 修复，并通过 `920b92f` 合并，回归检查通过。

运行与复现见 [首条存档链](../implementation/issue-4.md)、[导出与恢复](../implementation/issue-5.md)、[Codex CLI 链路](../implementation/issue-6.md)、[Claude CLI 链路](../implementation/issue-7.md)、[旧会话与增量](../implementation/issue-8.md)。目前需补齐的外部条件见 [原生客户端验收状态](../implementation/native-validation-status.md)。

## 已确认的开发环境

- Windows，Node 24.12.0，npm 11.6.2。
- Docker Engine 29.2.0，Linux containers 可用；开发测试使用隔离容器和合成材料。
- 现有 Codex CLI、Claude Code 与 Desktop 安装不代表已有可用的隔离测试账号或已验证的支持组合。
- 测试不读取真实员工会话，不修改真实 Agent 配置，不将现有登录凭据复制到测试环境。

## 验收记录要求

每个 ticket 记录实现提交、实际运行命令、环境、测试结果、未解决项和后续依赖。门槛未通过时保持草稿，不关闭规格与未验收 ticket。
