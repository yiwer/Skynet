# Skynet tracer-bullet tickets

状态：已按确认方案发布 52 张独立 Issue（#3—#54），正文、标签和依赖均已核验。来源为 GitHub [父 Issue #1](https://github.com/yiwer/Skynet/issues/1) 与 [父 Issue #2](https://github.com/yiwer/Skynet/issues/2) 的完整正文及评论（读取时均无评论）。本文保留拆分与发布时的任务图；当前 V1 实施状态与未通过的验收门槛见 [实施记录](v1-implementation.md)。

## 拆分约定

- 共 52 张：44 张端到端功能切片、1 张 S0 决策文档票、7 张验收/校准票。拆分时仓库没有产品代码，无需前置代码重构。
- **Tracer bullet**：每张功能票围绕一个可演示的用户行为，随票完成必要的数据持久化、接口、UI/MCP 和测试；每票按一个全新上下文可完成的范围限定。最初使用一名测试员工、一台设备和一个登记组合，后续扩展客户端与故障场景。
- T01 是 PRD 要求的 S0 文档工作；T08/T13/T19/T23/T31/T50/T52 是完成跨切片验收与试点的明确门槛。它们通过实际产品旅程提供证据。
- T01…T52 是本地方案编号；对应 GitHub 编号见发布索引。每张票已创建独立 Issue，使用 `ready-for-agent`，前置关系已转换成真实 Issue 引用和原生 blocking links。
- 父 Issue 保持不变；子票正文引用父 Issue，不通过编辑父 Issue 汇总任务。
- 依赖只表示必须先满足的条件。已移除传递性重复依赖；无前置票时可立即开始，之后只领取所有前置均完成的票。
- V1 的 G0→G1→G2→G3 门槛按既有验收要求推进。V2 产品代码依赖 T01 和 G2/G3 通过，可与 V1 的 G4 收尾并行；评估全员开放另依赖实际试点校准。
- 功能实现与自动化测试使用合成材料。真实客户端兼容性、Claude Code 分析链和试点性能必须实际验证，不能用替身或界面示例代替。每票仅声明实测支持的 OS/版本/环境，未登记的组合保持待验证。
- AC-32 的响应目标、实际部署环境和试点校准数据仍按父规格在对应验收票中落实；本拆分没有假定容量、工期或性能已达标。

2026-10-04 执行补充：上文保留最初发布的任务图。用户于 2026-10-03 要求开始 V2，并于 2026-10-04 调用 `implement-spec` 要求实现完整 V2，覆盖等待 G2/G3 才开始产品开发的顺序限制；各功能依赖继续按图推进，真实验收与试点签收单独记录。当前集成推进见 [V2 集成推进](v2-integration.md)。

## 发布时可领取

- [T01 / #3：对齐 V2 使用能力评估的领域与验收约定](https://github.com/yiwer/Skynet/issues/3)。
- [T02 / #4：从 Codex Desktop 新会话看到服务器原件](https://github.com/yiwer/Skynet/issues/4)。

## 发布索引

已核验 52 张 Issue 的正文与 `ready-for-agent` 标签，以及 83 条原生阻塞关系。

| 方案编号 | GitHub Issue | 标题 | 直接阻塞项 |
| --- | --- | --- | --- |
| T01 | [#3](https://github.com/yiwer/Skynet/issues/3) | 对齐 V2 使用能力评估的领域与验收约定 | 无 |
| T02 | [#4](https://github.com/yiwer/Skynet/issues/4) | 从 Codex Desktop 新会话看到服务器原件 | 无 |
| T03 | [#5](https://github.com/yiwer/Skynet/issues/5) | 只用服务器存档恢复 Codex Desktop 续聊 | [#4](https://github.com/yiwer/Skynet/issues/4) |
| T04 | [#6](https://github.com/yiwer/Skynet/issues/6) | 打通 Codex CLI 的自动存档与原生续聊 | [#5](https://github.com/yiwer/Skynet/issues/5) |
| T05 | [#7](https://github.com/yiwer/Skynet/issues/7) | 打通 Claude Code CLI 的自动存档与原生续聊 | [#5](https://github.com/yiwer/Skynet/issues/5) |
| T06 | [#8](https://github.com/yiwer/Skynet/issues/8) | 继续一条旧会话时完整同步且保留原始日期 | [#6](https://github.com/yiwer/Skynet/issues/6)、[#7](https://github.com/yiwer/Skynet/issues/7) |
| T07 | [#9](https://github.com/yiwer/Skynet/issues/9) | 保留压缩前原件、子会话与材料缺口 | [#6](https://github.com/yiwer/Skynet/issues/6)、[#7](https://github.com/yiwer/Skynet/issues/7) |
| T08 | [#10](https://github.com/yiwer/Skynet/issues/10) | 验收三客户端的采集与原生恢复（G0） | [#8](https://github.com/yiwer/Skynet/issues/8)、[#9](https://github.com/yiwer/Skynet/issues/9) |
| T09 | [#11](https://github.com/yiwer/Skynet/issues/11) | 通过 npm 和一个授权值完成正式接入 | [#10](https://github.com/yiwer/Skynet/issues/10) |
| T10 | [#12](https://github.com/yiwer/Skynet/issues/12) | 退出安装终端后仍自动采集并恢复后台 | [#11](https://github.com/yiwer/Skynet/issues/11) |
| T11 | [#13](https://github.com/yiwer/Skynet/issues/13) | 从插件市场接入同一个采集后台 | [#11](https://github.com/yiwer/Skynet/issues/11) |
| T12 | [#14](https://github.com/yiwer/Skynet/issues/14) | 修复、升级与卸载时保留未确认会话 | [#12](https://github.com/yiwer/Skynet/issues/12)、[#13](https://github.com/yiwer/Skynet/issues/13) |
| T13 | [#15](https://github.com/yiwer/Skynet/issues/15) | 验收员工无需日常操作的安装链（G1） | [#14](https://github.com/yiwer/Skynet/issues/14) |
| T14 | [#16](https://github.com/yiwer/Skynet/issues/16) | 断网后自动补传且不重复计数 | [#15](https://github.com/yiwer/Skynet/issues/15) |
| T15 | [#17](https://github.com/yiwer/Skynet/issues/17) | 确认丢失或服务崩溃后仍读取一致快照 | [#16](https://github.com/yiwer/Skynet/issues/16) |
| T16 | [#18](https://github.com/yiwer/Skynet/issues/18) | 采集失败时继续编码并看到缺口 | [#16](https://github.com/yiwer/Skynet/issues/16) |
| T17 | [#19](https://github.com/yiwer/Skynet/issues/19) | 跨设备复制或恢复时保持历史归属 | [#17](https://github.com/yiwer/Skynet/issues/17) |
| T18 | [#20](https://github.com/yiwer/Skynet/issues/20) | 停用账号或设备后拒绝后续访问 | [#11](https://github.com/yiwer/Skynet/issues/11) |
| T19 | [#21](https://github.com/yiwer/Skynet/issues/21) | 验收故障后的完整存档与正确统计（G2） | [#18](https://github.com/yiwer/Skynet/issues/18)、[#19](https://github.com/yiwer/Skynet/issues/19) |
| T20 | [#22](https://github.com/yiwer/Skynet/issues/22) | 用真实 Claude Code 分析一条会话并追溯证据 | [#21](https://github.com/yiwer/Skynet/issues/21) |
| T21 | [#23](https://github.com/yiwer/Skynet/issues/23) | 长会话分析后仍能回到原始证据 | [#22](https://github.com/yiwer/Skynet/issues/22) |
| T22 | [#24](https://github.com/yiwer/Skynet/issues/24) | 分析失败、超额或过期时仍可存档和重试 | [#22](https://github.com/yiwer/Skynet/issues/22) |
| T23 | [#25](https://github.com/yiwer/Skynet/issues/25) | 验收真实分析、证据与故障隔离（G3） | [#23](https://github.com/yiwer/Skynet/issues/23)、[#24](https://github.com/yiwer/Skynet/issues/24) |
| T24 | [#26](https://github.com/yiwer/Skynet/issues/26) | 在 Agent 中授权读取会话与准备导出 | [#20](https://github.com/yiwer/Skynet/issues/20) |
| T25 | [#27](https://github.com/yiwer/Skynet/issues/27) | 按员工、项目和原文搜索并定位证据 | [#26](https://github.com/yiwer/Skynet/issues/26) |
| T26 | [#28](https://github.com/yiwer/Skynet/issues/28) | 每天按北京时间阅读有证据的工作主题 | [#25](https://github.com/yiwer/Skynet/issues/25)、[#26](https://github.com/yiwer/Skynet/issues/26) |
| T27 | [#29](https://github.com/yiwer/Skynet/issues/29) | 连续查看周工作、项目进展与待继续事项 | [#28](https://github.com/yiwer/Skynet/issues/28) |
| T28 | [#30](https://github.com/yiwer/Skynet/issues/30) | 补传或人工更正后生成可追溯的新报告 | [#29](https://github.com/yiwer/Skynet/issues/29) |
| T29 | [#31](https://github.com/yiwer/Skynet/issues/31) | 从团队覆盖矩阵识别进展与采集异常 | [#28](https://github.com/yiwer/Skynet/issues/28) |
| T30 | [#32](https://github.com/yiwer/Skynet/issues/32) | 服务器重建后仍能查证报告并恢复会话 | [#30](https://github.com/yiwer/Skynet/issues/30) |
| T31 | [#33](https://github.com/yiwer/Skynet/issues/33) | 完成 V1 产品验收与运行证据（G4） | [#27](https://github.com/yiwer/Skynet/issues/27)、[#31](https://github.com/yiwer/Skynet/issues/31)、[#32](https://github.com/yiwer/Skynet/issues/32) |
| T32 | [#34](https://github.com/yiwer/Skynet/issues/34) | 查看同源、可重算的 Token 与基础用量 | [#3](https://github.com/yiwer/Skynet/issues/3)、[#25](https://github.com/yiwer/Skynet/issues/25)、[#26](https://github.com/yiwer/Skynet/issues/26) |
| T33 | [#35](https://github.com/yiwer/Skynet/issues/35) | 查看每条会话的组装依据与处理链路 | [#34](https://github.com/yiwer/Skynet/issues/34) |
| T34 | [#36](https://github.com/yiwer/Skynet/issues/36) | 按对话阅读会话并直达命中的原句 | [#3](https://github.com/yiwer/Skynet/issues/3)、[#25](https://github.com/yiwer/Skynet/issues/25)、[#27](https://github.com/yiwer/Skynet/issues/27) |
| T35 | [#37](https://github.com/yiwer/Skynet/issues/37) | 在对话中准确看到等待与并行活动 | [#34](https://github.com/yiwer/Skynet/issues/34)、[#36](https://github.com/yiwer/Skynet/issues/36) |
| T36 | [#38](https://github.com/yiwer/Skynet/issues/38) | 核查一次会话的任务类型、返工与提示词证据 | [#34](https://github.com/yiwer/Skynet/issues/34)、[#36](https://github.com/yiwer/Skynet/issues/36) |
| T37 | [#39](https://github.com/yiwer/Skynet/issues/39) | 按活动记录与泳道追查一天的对话 | [#37](https://github.com/yiwer/Skynet/issues/37)、[#38](https://github.com/yiwer/Skynet/issues/38) |
| T38 | [#40](https://github.com/yiwer/Skynet/issues/40) | 按人和会话查看用量与可核对产出 | [#38](https://github.com/yiwer/Skynet/issues/38) |
| T39 | [#41](https://github.com/yiwer/Skynet/issues/41) | 按任务类型复盘高投入或反复返工的会话 | [#37](https://github.com/yiwer/Skynet/issues/37)、[#38](https://github.com/yiwer/Skynet/issues/38) |
| T40 | [#42](https://github.com/yiwer/Skynet/issues/42) | 从提示词报表找到有证据的改进建议 | [#38](https://github.com/yiwer/Skynet/issues/38) |
| T41 | [#43](https://github.com/yiwer/Skynet/issues/43) | 从等待报表定位权限阻塞与并行工作 | [#37](https://github.com/yiwer/Skynet/issues/37) |
| T42 | [#44](https://github.com/yiwer/Skynet/issues/44) | 从团队概览和周工作视图下钻到使用报表 | [#29](https://github.com/yiwer/Skynet/issues/29)、[#31](https://github.com/yiwer/Skynet/issues/31)、[#40](https://github.com/yiwer/Skynet/issues/40)、[#42](https://github.com/yiwer/Skynet/issues/42)、[#43](https://github.com/yiwer/Skynet/issues/43) |
| T43 | [#45](https://github.com/yiwer/Skynet/issues/45) | 查看一名员工可展开核查的使用能力评估 | [#37](https://github.com/yiwer/Skynet/issues/37)、[#38](https://github.com/yiwer/Skynet/issues/38) |
| T44 | [#46](https://github.com/yiwer/Skynet/issues/46) | 切换评估周期、权重并查询历史版本 | [#45](https://github.com/yiwer/Skynet/issues/45) |
| T45 | [#47](https://github.com/yiwer/Skynet/issues/47) | 按等级分组浏览员工一览并进入画像 | [#46](https://github.com/yiwer/Skynet/issues/46) |
| T46 | [#48](https://github.com/yiwer/Skynet/issues/48) | 在员工画像串起使用数据、工作与最近活动 | [#29](https://github.com/yiwer/Skynet/issues/29)、[#39](https://github.com/yiwer/Skynet/issues/39)、[#46](https://github.com/yiwer/Skynet/issues/46) |
| T47 | [#49](https://github.com/yiwer/Skynet/issues/49) | 在画像中核查辅导方向、代表会话与周趋势 | [#48](https://github.com/yiwer/Skynet/issues/48) |
| T48 | [#50](https://github.com/yiwer/Skynet/issues/50) | 追加复核备注而不改动评估 | [#45](https://github.com/yiwer/Skynet/issues/45) |
| T49 | [#51](https://github.com/yiwer/Skynet/issues/51) | 更正推断后重算报表与评估并保留旧版本 | [#30](https://github.com/yiwer/Skynet/issues/30)、[#46](https://github.com/yiwer/Skynet/issues/46) |
| T50 | [#52](https://github.com/yiwer/Skynet/issues/52) | 复核试点评估参数并按版本发布 | [#33](https://github.com/yiwer/Skynet/issues/33)、[#47](https://github.com/yiwer/Skynet/issues/47)、[#49](https://github.com/yiwer/Skynet/issues/49)、[#51](https://github.com/yiwer/Skynet/issues/51) |
| T51 | [#53](https://github.com/yiwer/Skynet/issues/53) | 从团队汇总直达同版本的使用能力画像 | [#44](https://github.com/yiwer/Skynet/issues/44)、[#47](https://github.com/yiwer/Skynet/issues/47) |
| T52 | [#54](https://github.com/yiwer/Skynet/issues/54) | 验收 V2 完整旅程、性能与 V1 回归 | [#35](https://github.com/yiwer/Skynet/issues/35)、[#41](https://github.com/yiwer/Skynet/issues/41)、[#50](https://github.com/yiwer/Skynet/issues/50)、[#52](https://github.com/yiwer/Skynet/issues/52)、[#53](https://github.com/yiwer/Skynet/issues/53) |

## 已确认的拆分正文

以下保留确认时的完整交付描述、验收条件与方案编号；对应 GitHub 正文中的前置关系已替换为真实 Issue 引用，见上方发布索引。

## T01 · 对齐 V2 使用能力评估的领域与验收约定

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 71；验收：V2 S0。

### What to build

将已确认的 V2 范围落到 ADR、术语和受影响的需求说明，使后续实现能明确区分使用能力评估、整体绩效与排名。

### Acceptance criteria

- [ ] 记录 ADR-0004，补齐使用能力评估、员工画像、活动记录、对话视图、组装记录、两类等待与复核备注等术语。
- [ ] 对齐 V1 评分条款、验收说明、需求基线、历史说明和 V2 实现指引；保留原决定的版本背景，明确 V2 的覆盖范围。
- [ ] 把修订差异交用户确认；本票完成不代表 G2/G3 通过，不启动 V2 产品代码。

### Blocked by

None (can start immediately).

## T02 · 从 Codex Desktop 新会话看到服务器原件

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 16、US 17、US 21、US 53、US 54、US 55、US 65；验收：AC-05、AC-16。

### What to build

在一名测试员工、一台设备、一个登记的 Desktop/OS 组合上，完成一次绑定后自动捕获一条新会话；已认证用户能在最小会话页看到服务器保存的消息与工具结果。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 把最小可运行的 Linux 单机服务、持久化、设备绑定、上传、读取与 Web 会话页一并交付；只覆盖一条新会话的正常路径。
- [ ] 宿主活动触发采集，hook 不等待网络；员工归属由设备绑定决定。未登录不能读取，另一已认证测试用户可以读取同一存档。
- [ ] 用隔离账号与合成对话跑完整链路；服务重启后仍能读取相同原件，并能区分未提交与已持久化的材料。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

None (can start immediately).

## T03 · 只用服务器存档恢复 Codex Desktop 续聊

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 28、US 29、US 31、US 32、US 34、US 58；验收：AC-10、AC-11。

### What to build

员工从会话页导出可读材料或原生恢复包，在没有原设备会话的隔离 Desktop 环境中继续同一段工作。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 恢复包列出来源版本、材料清单、哈希与当前完整性；下载和导出都验证读取身份。
- [ ] 恢复前校验包和目标兼容性，损坏或不兼容明确失败，默认使用隔离位置而不覆盖已有会话。
- [ ] 只凭服务器导出完成实际原生续聊，核查预置上下文和工具历史；按 Agent/版本/OS 记录结果，文本粘贴和原机器 resume 不算通过。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T02：从 Codex Desktop 新会话看到服务器原件

## T04 · 打通 Codex CLI 的自动存档与原生续聊

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 5、US 16、US 17、US 18、US 21、US 30、US 34；验收：AC-05、AC-10。

### What to build

Codex CLI 用户正常开始会话后，能在同一平台查阅原件并从服务器恢复到隔离 CLI 继续对话。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 复用现有绑定、存档、查询和导出流程，为登记的 CLI 组合接入真实活动与原生材料。
- [ ] 在两个测试项目中自动采集消息、工具结果和可得代码变更，显示来源可提供及不可提供的内容。
- [ ] 从服务器包独立恢复续聊；对不支持的组合给出可见状态及原因，保存可复现实验。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T03：只用服务器存档恢复 Codex Desktop 续聊

## T05 · 打通 Claude Code CLI 的自动存档与原生续聊

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 5、US 16、US 17、US 18、US 21、US 30、US 34；验收：AC-05、AC-10。

### What to build

Claude Code CLI 用户使用相同平台完成自动存档、可读导出和隔离环境中的原生续聊。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 使用真实的 Claude 活动与原生材料接入已有产品链路，多个项目都被覆盖。
- [ ] 会话页保留用户消息、工具请求和结果、可得代码变更及来源信息；明确不可取得的字段。
- [ ] 仅从服务器包在隔离 CLI 中恢复上下文并继续对话，记录支持组合和失败边界。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T03：只用服务器存档恢复 Codex Desktop 续聊

## T06 · 继续一条旧会话时完整同步且保留原始日期

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 19、US 20、US 47；验收：AC-06、AC-14。

### What to build

员工接入后继续某条旧会话，平台同步该会话现存的完整上下文；其余未继续的旧会话保持未上传。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 三客户端样例各包含多条接入前会话；仅继续一条，服务器只收到该条及恢复必需的关联材料。
- [ ] 首次从现存原件开头同步，之后增量；目录时间变化不能成为历史导入资格。
- [ ] 会话页标明历史上下文与来源时间，旧活动不增加今日活动量；再次恢复仍能核查历史上下文。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T04：打通 Codex CLI 的自动存档与原生续聊
- T05：打通 Claude Code CLI 的自动存档与原生续聊

## T07 · 保留压缩前原件、子会话与材料缺口

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 21、US 22、US 23、US 27、US 45；验收：AC-07。

### What to build

员工的会话发生增长、compact、分支或截断后，用户仍能查看先前原件、关联子会话与附件，并知道哪些材料缺失。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 对增长、半行、重写、截断建立可追溯的快照代次，已存档字节不被新摘要或解析结果覆盖。
- [ ] 详情页能沿父子/分支关系读取原生可得材料；未知格式、读取失败或上游缺失显示缺口，半行不计成完整事件。
- [ ] 通过三客户端的合成材料变化验证查询、原件校验和导出；相同文本的两次真实活动仍保留两次。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T04：打通 Codex CLI 的自动存档与原生续聊
- T05：打通 Claude Code CLI 的自动存档与原生续聊

## T08 · 验收三客户端的采集与原生恢复（G0）

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应验收：G0；AC-05、AC-06、AC-07、AC-10。

### What to build

按登记的支持组合演练新会话、旧会话续用、复杂材料和服务器独立恢复，给出可用于后续安装工作的 G0 结论。

### Acceptance criteria

- [ ] 逐项覆盖 G0：三客户端、多项目、历史边界、compact/分支/子会话/附件与服务器独立原生续聊。
- [ ] 每个支持组合提供环境、步骤、实际结果、原件对照与恢复证据；未验证、部分支持和不支持分开记录。
- [ ] Codex 原生恢复不通过时保持门槛未通过并报告阻塞；不得用可读导出或修改范围代替。

### Blocked by

- T06：继续一条旧会话时完整同步且保留原始日期
- T07：保留压缩前原件、子会话与材料缺口

## T09 · 通过 npm 和一个授权值完成正式接入

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 1、US 2、US 4、US 5、US 6、US 7、US 8、US 9、US 13、US 55、US 69、US 70；验收：AC-01、AC-03、AC-04、AC-16。

### What to build

员工按安装页提供一个个人授权值并执行 setup，完成真实客户端识别、设备登记与必要信任，随后能查到第一条会话。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 安装页准确说明 Node、下载和后台权限前提；禁用 npm 安装脚本时仍能 setup，发行配置提供可信平台地址。
- [ ] 注册值换成用户受限存储中的设备凭据；无第二个员工 ID、项目列表或模型 Key 输入，日志与提示词不泄露授权值。
- [ ] 保留已有 hooks/插件配置，只修改自有条目；重复 setup 身份一致，已安装、待信任、后台运行、首次采集与已上传状态分别可见。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T08：验收三客户端的采集与原生恢复（G0）

## T10 · 退出安装终端后仍自动采集并恢复后台

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 8、US 10、US 11、US 12、US 26、US 46、US 70；验收：AC-04、AC-22。

### What to build

员工关闭安装终端、从图标打开 Desktop，并经历受支持的登录、重启或休眠后，采集仍恢复运行，状态可查询。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 后台以当前用户在稳定位置运行，设备凭据和启动不依赖安装终端环境；每个登记运行环境只有一个后台。
- [ ] 在声明支持的 OS/运行环境逐项验证登录、重启、休眠和崩溃恢复；被系统策略阻止时显示降级及处理方法。
- [ ] 从真实客户端产生活动，检查设备状态、持久队列和服务器原文，不以仅有进程存在作为成功。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T09：通过 npm 和一个授权值完成正式接入

## T11 · 从插件市场接入同一个采集后台

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 3、US 7、US 13、US 16、US 69；验收：AC-02。

### What to build

员工通过声明支持的 Claude/Codex 插件渠道完成绑定与信任；与 npm 或另一 Agent 插件并存时，共用身份和后台。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 每条声明支持的市场入口在干净环境中实际安装并产生可查询会话，前提、信任和首次采集状态准确。
- [ ] npm 与双 Agent 插件共用设备身份、后台和队列，同一活动只有一次统计。
- [ ] 安装不能依赖会被清理的插件缓存；记录渠道限制，内部发行可验收，不把公共官方目录上架作为完成条件。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T09：通过 npm 和一个授权值完成正式接入

## T12 · 修复、升级与卸载时保留未确认会话

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 6、US 13、US 14、US 15、US 70；验收：AC-03。

### What to build

员工可以修复接入、升级后台或移除一个安装入口；已有配置和未确认数据保持可恢复，完整卸载有明确行为。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 注入升级中断并恢复，设备身份与未确认载荷保留，可回退到可运行版本并最终同步。
- [ ] 重复修复不增加后台或 hooks；配置前后对照证明其他插件和用户配置不受影响。
- [ ] 移除一个插件保留其他入口仍使用的后台；完整卸载仅处理自有设置，并明确说明保留的数据与后续处理。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T10：退出安装终端后仍自动采集并恢复后台
- T11：从插件市场接入同一个采集后台

## T13 · 验收员工无需日常操作的安装链（G1）

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应验收：G1；AC-01…AC-04、AC-22。

### What to build

在声明支持的环境复现 npm、插件、信任和生命周期流程，确认员工接入后无需每日手动启动采集。

### Acceptance criteria

- [ ] 复跑禁用安装脚本、双渠道共存、旧配置保留、图标启动 Desktop、登录恢复、修复/升级/卸载。
- [ ] 实际安装步骤与页面一致，缺少前提或未信任不误报成功，授权值检查无泄露。
- [ ] 记录环境和安装健康检查耗时，将下载、前置安装、信任及大历史回填分别列出；提交 G1 证据与未解决项。

### Blocked by

- T12：修复、升级与卸载时保留未确认会话

## T14 · 断网后自动补传且不重复计数

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 24、US 25、US 26、US 43、US 46；验收：AC-08、AC-09。

### What to build

员工离线继续工作，恢复网络后会话自动补齐；用户能看到积压、最近成功时间与拒绝原因，重传不放大活动量。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 通过产品采集入口连续产生合成活动，断网、限流、错误凭据和服务器重启后持续重试并最终可查。
- [ ] 本地队列跨进程退出保留，只清理服务器已确认范围，使用受控退避而不阻塞正常编码。
- [ ] 同一活动重复投递十次仍只有一次逻辑统计；设备页能观察离线、积压、拒绝和恢复。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T13：验收员工无需日常操作的安装链（G1）

## T15 · 确认丢失或服务崩溃后仍读取一致快照

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 25、US 27；验收：AC-08。

### What to build

上传在持久化、提交或确认阶段被中断后，用户最终取得一致的会话快照与导出，系统不会报告虚假备份成功。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 覆盖原件落盘后提交前、提交后客户端推进前的崩溃，以及 ACK 丢失；重试返回已提交结果而不重复计量。
- [ ] 缺块、长度/哈希不符和同幂等键不同内容被明确拒绝，未完成快照不显示完整。
- [ ] 通过公开上传与查询/导出流程比对字节、清单和统计；已经提交的旧快照在新提交失败时仍可读取。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T14：断网后自动补传且不重复计数

## T16 · 采集失败时继续编码并看到缺口

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 26、US 27、US 43、US 46、US 70；验收：AC-09。

### What to build

磁盘满、无读取权限或原件提前消失时，员工继续使用 Agent；平台明确显示积压或采集缺口及可执行的修复提示。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 分别注入本地存储不足、读取拒绝和上游删除，记录 Agent 正常工作及 hook 不等待远端的证据。
- [ ] 设备页与会话页区分缺口、离线、待信任、无活动和同步中，不把失败状态显示为完整存档。
- [ ] 资源恢复后对仍可取得的材料继续补传；不可补回的范围保留缺口，未确认队列限额和告警可见。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T14：断网后自动补传且不重复计数

## T17 · 跨设备复制或恢复时保持历史归属

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 11、US 22、US 25、US 33；验收：AC-07、AC-11。

### What to build

同一员工使用多设备或另一员工恢复会话后，历史归属保持不变，新活动归属当前设备绑定的员工，重复历史不计两次。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 使用两名测试员工与多个独立运行环境，验证设备/来源实例身份而非本地用户名决定归属。
- [ ] 已确认谱系的复制、续聊和恢复保留来源并去重；无法确认的关系保持分离并提示。
- [ ] 通过会话查询、可见统计和再次导出核查历史与新增内容；相同文本的独立活动不能被误合并。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T15：确认丢失或服务崩溃后仍读取一致快照

## T18 · 停用账号或设备后拒绝后续访问

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 53、US 54、US 55、US 58、US 66；验收：AC-16。

### What to build

维护者能停用账号或设备；已认证用户继续按共享规则读取数据，被停用身份不能继续读取或上传。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] Web 提供账号/设备停用入口和可见结果，停用后的现有登录、下载及后续请求按对应身份拒绝。
- [ ] 设备上传身份不能代替 Web 读取身份，也不能伪造另一员工归属；停用一台设备不误停其他有效设备。
- [ ] 通过两名员工交叉读取、匿名读取、伪造归属和撤销后请求验证共享读取与写入边界。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T09：通过 npm 和一个授权值完成正式接入

## T19 · 验收故障后的完整存档与正确统计（G2）

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应验收：G2；AC-07…AC-09、AC-11。

### What to build

在已经通过安装门槛的三客户端链路上复现故障矩阵，确认会话原件、确认范围、归属和统计都可依赖。

### Acceptance criteria

- [ ] 覆盖断网、限流、凭据错误、重复提交、ACK 丢失、崩溃窗口、磁盘满、权限拒绝、源头丢失和文件代次变化。
- [ ] 核对多设备复制与恢复后的归属、去重、原件哈希、可读导出及恢复材料；界面明确展示所有缺口。
- [ ] 为每项保存可重复步骤和实际结果，全部通过后才给出 G2 通过结论；失败项继续阻塞后续分析门槛。

### Blocked by

- T16：采集失败时继续编码并看到缺口
- T17：跨设备复制或恢复时保持历史归属

## T20 · 用真实 Claude Code 分析一条会话并追溯证据

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 40、US 41、US 59、US 63、US 64；验收：AC-13、AC-18、AC-20。

### What to build

用户对一条已存档的短会话发起分析，在会话页看到目标、结果和阻塞，并从每个关键结论跳回原件。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 由独立 Claude Code 运行时调用已选千问按量入口，登记实际模型、运行时和预算配置；不能用其他 SDK 直连代替验收。
- [ ] 结构化结果区分记录已观察、用户/Agent 声称、模型推断和材料不足；自述测试通过而无工具证据不能标为已验证。
- [ ] 真实链路验证证据位置；另用带执行/外发指令的合成材料验证隔离，系统分析会话不回流为员工活动。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T19：验收故障后的完整存档与正确统计（G2）

## T21 · 长会话分析后仍能回到原始证据

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 40、US 62；验收：AC-18。

### What to build

长会话经分段提取和聚合后，用户仍能查到关键事实的原件位置，并知道哪些内容尚未分析完整。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 用含跨段事实和大工具输出的合成长会话运行真实分析链，结论引用稳定原件位置而非仅引用中间摘要。
- [ ] 详情页显示输入快照、处理范围和未完成/截断状态；部分结果不伪装成全文分析。
- [ ] 抽检预置关键事实与原句跳转；确定性替身验证失败分段，真实模型只验证结构、证据和行为边界。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T20：用真实 Claude Code 分析一条会话并追溯证据

## T22 · 分析失败、超额或过期时仍可存档和重试

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 52、US 60、US 61；验收：AC-15、AC-19。

### What to build

模型不可用、超时或预算耗尽时，员工原件继续同步；用户看到分析状态并可受控重试，旧任务不会覆盖新结果。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 运行页展示排队、失败、重试、输入/模型版本和可得用量；未知用量不记为零，并发、时间、输入与预算限额生效。
- [ ] 用重复领取、租约失效、旧 Worker 晚完成和新快照到达验证版本隔离与有限重试，增量触发可以去抖合并。
- [ ] 故障期间实际完成一次新原件上传、查询与导出；修复后从可见入口重试并取得新版本结果。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T20：用真实 Claude Code 分析一条会话并追溯证据

## T23 · 验收真实分析、证据与故障隔离（G3）

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应验收：G3；AC-13、AC-18…AC-20。

### What to build

给出真实 Claude Code 分析链可用且不会破坏存档的验收结论，作为 V2 产品代码的分析前置门槛。

### Acceptance criteria

- [ ] 实际验证短会话、长会话、结构化结果、原句证据及四类证据级别，记录运行时和模型版本。
- [ ] 复跑指令隔离、防递归、模型失败、预算、超时、租约与旧版本覆盖场景，存档和读取保持可用。
- [ ] 提交 G3 逐项证据；替身测试不能替代真实运行链；仅 G2 与 G3 均通过时才解除 V2 代码前置限制。

### Blocked by

- T21：长会话分析后仍能回到原始证据
- T22：分析失败、超额或过期时仍可存档和重试

## T24 · 在 Agent 中授权读取会话与准备导出

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 45、US 56、US 57、US 58、US 66；验收：AC-16、AC-17。

### What to build

已认证用户从 Claude/Codex 完成 MCP 授权，分页读取会话原文、定位证据并准备导出，结果与 Web 一致。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 通过目标客户端的真实 HTTPS MCP 授权连接个人账号，设备上传凭据不能充当查询凭据。
- [ ] 同一快照的分页原文、证据位置、完整性与导出信息在 Web/MCP 一致，大工具输出可完整获取。
- [ ] 验证账号撤销、匿名调用、响应大小限制及授权失败；查询登录故障不阻断已有采集。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T18：停用账号或设备后拒绝后续访问

## T25 · 按员工、项目和原文搜索并定位证据

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 39、US 40、US 44、US 45、US 56、US 57；验收：AC-12、AC-17。

### What to build

用户从 Web 或 MCP 按员工、日期、项目、Agent 和内容寻找会话，打开命中位置并继续读取完整上下文。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 组合筛选与分页覆盖所有匹配会话；项目不明时保留未归类，不影响采集或检索。
- [ ] 命中位置关联稳定快照和证据；大输出分段读取，导出保留全部内容。
- [ ] 用同词不同会话、跨页命中和历史代次样例验证查询与跳转，Web/MCP 返回相同来源。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T24：在 Agent 中授权读取会话与准备导出

## T26 · 每天按北京时间阅读有证据的工作主题

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 36、US 38、US 40、US 41、US 42、US 47、US 48、US 56、US 57、US 71；验收：AC-12、AC-13、AC-14、AC-17。

### What to build

管理者在员工日工作视图及 MCP 中，按项目和跨会话工作主题阅读前一天的目标、行动、结果与阻塞。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 每天北京时间 09:00 为前一自然日创建适当任务；显示排队/生成状态，不把触发时间当完成承诺。
- [ ] 报告使用真实存档及分析，关键结论可跳到证据；统计保留未知，事件归期基于来源时间。
- [ ] 合成跨午夜、多项目、跨会话主题验证报告内容、归期与 Web/MCP 版本一致；并发区间不当工时。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T23：验收真实分析、证据与故障隔离（G3）
- T24：在 Agent 中授权读取会话与准备导出

## T27 · 连续查看周工作、项目进展与待继续事项

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 37、US 38、US 39、US 40、US 48、US 56、US 57；验收：AC-12、AC-14、AC-17。

### What to build

管理者阅读上一周跨日延续的主题与项目参与情况，并从周工作视图或项目视图追到会话和日工作证据。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 每周一北京时间 09:00 汇总上一周周一至周日，多个日期的同主题保持关联。
- [ ] 周工作与项目视图展示参与员工、目标、推进、成果、阻塞及待继续事项，未归类项目仍可访问。
- [ ] 跨周边界和多员工/多项目样例验证内容与证据；MCP 返回同一周报告及版本。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T26：每天按北京时间阅读有证据的工作主题

## T28 · 补传或人工更正后生成可追溯的新报告

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 47、US 49、US 50、US 51、US 52；验收：AC-14、AC-15。

### What to build

用户追加说明、更正工作主题或请求重算后，受影响的日周报告更新，同时保留原报告、原件和更正历史。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 更正入口记录操作者、时间和原因，支持追加说明、改归类与可见的重算状态。
- [ ] 迟到数据和旧会话补传按来源日期更新已管理期间；不把旧活动计入今天，也不默认批量生成接入前报告。
- [ ] 并发更正、重新分析和旧任务晚完成时最新报告使用最新适用输入；Web/MCP 可读取历史版本，原件字节不变。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T27：连续查看周工作、项目进展与待继续事项

## T29 · 从团队覆盖矩阵识别进展与采集异常

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 36、US 39、US 42、US 43、US 46、US 71；验收：AC-09、AC-12、AC-13。

### What to build

管理者从员工×日期的覆盖矩阵查看方向、主题和阻塞，区分无活动与设备/采集/分析异常，并下钻到员工或项目。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 沿用选定的覆盖矩阵与检查器，活动统计只展示有定义的会话、轮次、工具、文件、可得 Token 和活动区间。
- [ ] 显示各设备的最近同步和覆盖，分别呈现无活动、离线、待信任、采集缺口及分析未完成。
- [ ] 用具有不同覆盖问题的合成员工验证状态及下钻；未知数值不填零，矩阵可在窄屏使用。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T26：每天按北京时间阅读有证据的工作主题

## T30 · 服务器重建后仍能查证报告并恢复会话

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 35、US 65、US 67、US 68；验收：AC-21。

### What to build

维护者在新环境恢复数据库和原件备份后，用户仍能查原文、报告历史、证据引用及原生恢复包，并看到真实备份状态。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 通过可重复的单机部署流程独立备份与恢复数据库、原件及清单，备份时的一致性边界明确。
- [ ] 恢复后走真实查询、报告版本、导出和原生续聊流程，检验缺引用或损坏可检测。
- [ ] 运行页展示存储占用、最近备份和恢复演练结果；原件默认不自动删除，接收成功与已有灾备分开表达。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T28：补传或人工更正后生成可追溯的新报告

## T31 · 完成 V1 产品验收与运行证据（G4）

### Parent

[Skynet PRD v1 #1](https://github.com/yiwer/Skynet/issues/1)。

对应用户故事：US 1、US 8、US 26、US 46、US 69、US 70；验收：G4；AC-01…AC-22。

### What to build

从员工接入到工作查阅、分析更正、MCP 和服务器恢复完整走通，形成 V1 可签收的实测材料。

### Acceptance criteria

- [ ] 核对 AC-01…AC-22 与 G0—G4，每项具备环境、步骤、实际结果、证据和未解决项；评分边界按已确认 V2 修订适用。
- [ ] 在登记负载下报告安装耗时、至少 200 次 hook 的 P50/P95/最大值及原文可见延迟；分别对照两分钟、100ms、60 秒目标。
- [ ] 验证各页 320—1920 px 和深色可读性、由第二人复现运维流程；门槛通过后记录获授权试点的连续五个工作日表现，缺少实测保持未完成。

### Blocked by

- T25：按员工、项目和原文搜索并定位证据
- T29：从团队覆盖矩阵识别进展与采集异常
- T30：服务器重建后仍能查证报告并恢复会话

## T32 · 查看同源、可重算的 Token 与基础用量

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 84、US 104、US 105、US 106、US 107、US 110、US 111、US 166、US 169、US 173、US 174；验收：AC-23、AC-24、AC-28。

### What to build

在已有存档上，用户筛选一个时间范围查看基础用量；Web、MCP 和导出得到相同的已知数值、未知会话数及口径。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 以会话数、用户轮次、工具调用、Token 输入/输出打通上传原件→计算→持久结果→报表表格、MCP 摘要与导出；UI 不使用脱离上传链的假数据。
- [ ] 支持本周、上周、接入至今和员工/Agent/项目筛选；显示北京时间范围、数据截至时间与口径，未知不计零、不进入比值或趋势。
- [ ] 通过公开上传契约注入合成原件，手工预期值核对会话/日/周/人的汇总、增量与全量重算一致；提供 MCP 口径查询。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T01：对齐 V2 使用能力评估的领域与验收约定
- T23：验收真实分析、证据与故障隔离（G3）
- T24：在 Agent 中授权读取会话与准备导出

## T33 · 查看每条会话的组装依据与处理链路

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 72、US 73、US 74、US 75、US 76、US 77、US 78、US 79、US 80、US 81、US 82、US 83、US 84；验收：AC-24、AC-25。

### What to build

用户在会话侧栏和数据处理页看到来源、去重原因、谱系决定与处理状态，能找出不确定谱系或链路积压。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 原件进入产品链时留下来源/代次/分块、去重条数与原因、谱系决定、完成时间和规则版本；无法确认时保持分离，原件不改写。
- [ ] 会话面板与可筛选的组装列表一致，数据处理页展示逐环节计数、原文可见延迟 P95、待确认原因、Token 覆盖率及口径。
- [ ] 注入重复分块、ACK 丢失、续聊复制、compact、子会话与补传，核对审计解释和已实现指标不重复；文本相同不等于同一活动。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T32：查看同源、可重算的 Token 与基础用量

## T34 · 按对话阅读会话并直达命中的原句

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 85、US 86、US 87、US 90、US 91、US 92、US 93、US 94、US 95、US 96、US 168；验收：AC-26。

### What to build

会话默认按对话展示，用户可展开工具调用、切回时间线或原件，并从搜索和证据链接定位到对应原句；MCP 可分页读取同一对话。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 消息顺序与原件一致且不改写；工具默认隐藏，下一条 Agent 消息标出隐藏调用数量，子会话可访问。
- [ ] 正确标识旧内容、补传、压缩、缺口、进行中和无工具佐证的自述；证据锚点与对话锚点分别定位并高亮。
- [ ] 长会话分页无重复遗漏；Web 与可选包含工具调用的 MCP 分页一致，搜索结果携带消息命中位置。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T01：对齐 V2 使用能力评估的领域与验收约定
- T23：验收真实分析、证据与故障隔离（G3）
- T25：按员工、项目和原文搜索并定位证据

## T35 · 在对话中准确看到等待与并行活动

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 88、US 89、US 108、US 126、US 171、US 175；验收：AC-24、AC-26、AC-29。

### What to build

用户在真实对话间看到等待回复和权限等待，以及同一员工期间是否在其他会话工作；缺少来源事件时显示未知。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 逐个客户端确认本轮结束、下一条用户消息和权限请求/决定的来源；最后回复后的空闲不计，没有事件的值保持未知。
- [ ] 等待回复达到十分钟高亮，权限等待单列；跨会话并行标记按同一员工的来源时间判断，Web/MCP 与导出一致。
- [ ] 覆盖阈值前后、跨午夜、相邻/重叠等待、迟到与重复事件，增量与全量重算一致；页面解释等待口径，不折算工时。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T32：查看同源、可重算的 Token 与基础用量
- T34：按对话阅读会话并直达命中的原句

## T36 · 核查一次会话的任务类型、返工与提示词证据

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 109、US 110、US 119、US 120、US 121、US 122、US 123、US 124、US 125；验收：AC-13、AC-23、AC-30。

### What to build

用户在会话内查看分析得到的任务类型、提示词要素、返工、追问和已验证/仅声称结果，每项均能回到来源并看到分析状态。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 扩展真实分析链输出，推断字段记录证据位置与分析版本；已验证结果必须有工具结果佐证。
- [ ] 会话可见结果与 MCP/指标查询同源，未完成或失败显示未完成，不以零或空白替代；代码变更、测试与会话内提交按原件口径核查。
- [ ] 确定性 Analysis 替身提供已知推断以精确验算，另用真实 Claude Code 链验证结构和证据；旧分析不覆盖新输入。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T32：查看同源、可重算的 Token 与基础用量
- T34：按对话阅读会话并直达命中的原句

## T37 · 按活动记录与泳道追查一天的对话

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 97、US 98、US 99、US 100、US 101、US 102、US 103、US 105、US 167、US 176；验收：AC-27、AC-29、AC-31。

### What to build

管理者按北京时间、员工、Agent、项目和事件类型筛选活动记录，在同源泳道图上查看节奏，并点击原句进入对话；MCP 可分页查询。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 事件覆盖开始/结束、提问/返工、回复/追问、长等待、三分钟及以上权限等待、压缩、缺口和离线补传；摘录截断显示省略号。
- [ ] 员工一行、会话按 Agent 着色，提问与返工点形可区分，长等待灰段与现在线来自同一数据；提供等价表格和键盘定位。
- [ ] 迟到事件按来源时间归期且标补传；列表、泳道、对话跳转和 MCP 分页一致，在窄屏及空范围可用。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T35：在对话中准确看到等待与并行活动
- T36：核查一次会话的任务类型、返工与提示词证据

## T38 · 按人和会话查看用量与可核对产出

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 104、US 105、US 106、US 107、US 108、US 109、US 110、US 111、US 112、US 113、US 114、US 166、US 174、US 176；验收：AC-23、AC-24、AC-28、AC-31。

### What to build

用户在用量与产出报表中查看真实投入、已验证结果和仅声称结果，按员工及会话下钻到证据。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 补齐 KPI、每人按 Agent 的 Token、独立量纲产出表、Token×已验证结果散点及每人每日小图。
- [ ] Token 未知的会话单列，人员固定按姓名；筛选员工时散点保留灰色参照，其他筛选与范围一致。
- [ ] Web/MCP/导出的会话、轮次、工具、Token、结果、代码变更、测试、提交逐项同源；图表与表格对等，验证未知、空数据及键盘交互。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T36：核查一次会话的任务类型、返工与提示词证据

## T39 · 按任务类型复盘高投入或反复返工的会话

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 108、US 115、US 116、US 117、US 118、US 174、US 176；验收：AC-23、AC-24、AC-28、AC-29、AC-31。

### What to build

用户从会话产效分布与复盘列表选择一个会话，看到分子、分母、同类任务参照及工作/等待/权限/缺口分段，并追到原句。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 按任务类型呈现产效分布与中位数；Token 未知不入比值，所有比值显示分子分母及同类任务提示。
- [ ] 按范围内已知 Token 的 P75、声称多于已验证或返工至少两次筛出会话；会话明细可排序，人员列表保持姓名顺序。
- [ ] 选中会话的分段条和明细来自同一原件/分析版本，缺少边界时显示未知；Web/MCP/导出及图表/表格一致。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T35：在对话中准确看到等待与并行活动
- T36：核查一次会话的任务类型、返工与提示词证据

## T40 · 从提示词报表找到有证据的改进建议

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 104、US 105、US 106、US 109、US 119、US 120、US 121、US 122、US 123、US 124、US 125、US 166、US 176；验收：AC-23、AC-28、AC-30、AC-31。

### What to build

用户查看提示词要素、返工与追问，比较上下文或长度与返工的关联，并从正反示例和个人写法建议回到原句。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 交付提示词 KPI、员工×要素热力表、上下文与下一轮返工对比、分开坐标轴的长度数量/返工图及任务类型构成。
- [ ] 正反示例均链接证据，个人写法建议标模型推断；相关关系不表述为因果，推断未完成不填零。
- [ ] 通过固定推断样例验证分母、首条/非首条与边界；Web/MCP/导出同源，人员按姓名、每图有表格、键盘和窄屏可用。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T36：核查一次会话的任务类型、返工与提示词证据

## T41 · 从等待报表定位权限阻塞与并行工作

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 105、US 106、US 126、US 127、US 128、US 129、US 130、US 166、US 171、US 175、US 176；验收：AC-23、AC-24、AC-29、AC-31。

### What to build

用户查看响应与等待的分布、时间段和最长权限请求，区分流程阻塞与其他会话活动，并得到可核查的允许列表建议。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 呈现等待中位数/P90、长等待占比、权限等待中位数及期间在别处工作占比，提供星期×小时热力图和按人分布。
- [ ] 最长权限请求可回溯证据，建议仅作为可审阅内容，不自动修改宿主权限；说明等待不等于怠工，不产生考勤或超时提醒。
- [ ] 未知事件不参与伪精确统计；Web/MCP/导出同源，分布表按姓名，图表均可切表格并通过键盘与窄屏验收。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T35：在对话中准确看到等待与并行活动

## T42 · 从团队概览和周工作视图下钻到使用报表

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 104、US 105、US 106、US 107、US 131、US 132、US 134、US 176；验收：AC-23、AC-24、AC-28、AC-31。

### What to build

管理者在现有覆盖矩阵上查看本周 KPI、趋势和人员汇总，从员工周视图的使用画像带着范围与员工筛选进入报表。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 加入规定的本周 KPI/每日趋势及人员汇总字段，覆盖状态仍可见，人员固定按姓名。
- [ ] 员工周视图呈现本周 Token、已验证结果、提示词、返工、等待及每日 Token 小图；报表跳转携带正确筛选。
- [ ] 概览、周视图、报表、MCP 和导出在同一范围数值一致；未知、图表表格、键盘与窄屏行为一致。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T27：连续查看周工作、项目进展与待继续事项
- T29：从团队覆盖矩阵识别进展与采集异常
- T38：按人和会话查看用量与可核对产出
- T40：从提示词报表找到有证据的改进建议
- T41：从等待报表定位权限阻塞与并行工作

## T43 · 查看一名员工可展开核查的使用能力评估

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 135、US 137、US 140、US 141、US 142、US 144、US 147、US 149、US 150、US 160、US 163、US 165、US 170；验收：AC-34、AC-35、AC-36、AC-38。

### What to build

先针对接入至今、默认方案，用户从已存档会话得到一名员工的六维能力、综合指数、等级与可信度，并逐层展开核查原值、样本、锚点和证据；MCP 返回相同版本。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 完整使用父规格定义的六维指标与固定锚点、任务类型校正和基线版本；同一结果包含强项、优先项、一句理由与固定建议库选择，并记录模型、指标、分析与输入范围，提供最小画像及 MCP 查询。
- [ ] 样本不足指标不计分，缺失维度权重重分配；指数取整后分档，可信度低时待定，覆盖缺口降级，无会话显示空状态，误差标估计值。
- [ ] 通过合成上传与固定分析验证锚点两端/截断、71.4与71.5、样本门槛、零值和未知；每维展示团队中位数参照但不用于评分，低于60分的维度默认展开。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T35：在对话中准确看到等待与并行活动
- T36：核查一次会话的任务类型、返工与提示词证据

## T44 · 切换评估周期、权重并查询历史版本

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 138、US 139、US 142、US 144、US 163、US 164、US 165、US 170；验收：AC-34、AC-35、AC-36。

### What to build

用户在本周、上周、接入至今与三套系统权重间切换，得到对应评估并可查询先前版本，不因切换改变原始维度。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 三个周期按北京时间且起点不早于接入日；默认、重产出、重质量使用父规格固定参数，不提供任意权重输入。
- [ ] 切换权重仅改变加权结果；模型参数、指标/分析/基线输入变化产生追加版本，旧结果可读且旧任务不覆盖新版本。
- [ ] 验证周界、没有工作日/会话、零权重与缺维度的组合，Web/MCP 同范围同版本一致；方法说明展示当前参数。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T43：查看一名员工可展开核查的使用能力评估

## T45 · 按等级分组浏览员工一览并进入画像

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 135、US 136、US 137、US 138、US 139、US 140、US 141、US 143、US 144、US 160、US 165、US 176；验收：AC-28、AC-31、AC-35、AC-38。

### What to build

管理者在员工一览按较好、一般、需提升、待定浏览员工卡片及理由，切换周期和方案后可进入同一结果的个人画像。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 展示人数、理由、指数/误差/可信度、六维得分、关键样本与覆盖警示；理由与画像使用同一结果。
- [ ] 分组内固定按姓名，卡片可键盘打开，包含方法、公平校正与用途说明；低可信度或无数据如实呈现。
- [ ] 验证多组合成员工的分组、排序、范围切换和跳转，查询及导出无名次字段/按分数排序参数；明暗主题、窄屏和表格可用。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T44：切换评估周期、权重并查询历史版本

## T46 · 在员工画像串起使用数据、工作与最近活动

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 103、US 145、US 146、US 151、US 152、US 153、US 157、US 159、US 160、US 165、US 170、US 176；验收：AC-23、AC-27、AC-31、AC-38。

### What to build

用户在一名员工的画像中连续查看使用规模、工作主题与阻塞、会话及最近活动，并在画像、日报和周视图间切换。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 页头展示设备/最近同步/接入信息，目录定位各节；使用数据包含规定的 KPI、三张每日图及 Agent/任务分布。
- [ ] 工作主题与阻塞读取对应日周报告，会话明细读取同范围指标；最近活动可跳到带员工与日期的活动记录。
- [ ] 画像、原报表与 MCP 返回一致范围及版本；未知和无数据明确，目录/跳转/图表表格在键盘及320—1920 px可用。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T27：连续查看周工作、项目进展与待继续事项
- T37：按活动记录与泳道追查一天的对话
- T44：切换评估周期、权重并查询历史版本

## T47 · 在画像中核查辅导方向、代表会话与周趋势

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 136、US 145、US 147、US 148、US 149、US 150、US 154、US 155、US 156、US 158、US 170、US 176；验收：AC-31、AC-35、AC-36、AC-38。

### What to build

用户从画像的一句总结、强项和优先提升项进入原始依据，查看沟通/等待方式、代表性会话以及上周到本周变化。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 按父规格确定强项/优先项和固定建议库，注明样本与短板数量；沟通方式含首条要素对照、返工/追问和提示词长度，等待内容来自同范围指标。
- [ ] 按父规格选择代表及返工较多会话并跳原句；维度参照与原始指标可核查，推断与未知有标识。
- [ ] 周趋势使用同模型口径及可追溯输入，无上周数据明确提示；验证建议确定性、会话选择并列条件、图表/表格与 MCP 一致。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T46：在员工画像串起使用数据、工作与最近活动

## T48 · 追加复核备注而不改动评估

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 161、US 172；验收：AC-16、AC-37。

### What to build

员工或管理者在画像追加背景说明，所有已认证用户能看到作者与时间，评估结果保持原样。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 备注采用追加式保存，记录平台身份和北京时间；同一共享读取规则适用于备注。
- [ ] 提交、重新读取和并发追加不丢失内容；备注不改变指标、指数、等级或模型输入版本。
- [ ] 对比追加前后 Web/MCP 评估版本与数值，验证未认证访问拒绝；评估变化和备注不触发通知或人事动作。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T43：查看一名员工可展开核查的使用能力评估

## T49 · 更正推断后重算报表与评估并保留旧版本

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 109、US 162、US 163、US 164、US 172、US 173、US 174；验收：AC-23、AC-28、AC-36、AC-37。

### What to build

用户更正任务类型、提示词要素或返工判定后，相关报表、个人评估与团队基线受影响结果更新，旧结果仍能查询。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 通过可见入口记录原值、新值、操作者和时间；原件字节不改变，更正关联原始分析证据。
- [ ] 按依赖重算受影响会话、期间和评估；同类任务基线变化影响的其他员工结果也有明确新版本。
- [ ] 并发更正、迟到原件、重新分析和旧任务晚完成时 Web/MCP/导出一致；全量与增量重算一致，评估变化不触发通知。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T28：补传或人工更正后生成可追溯的新报告
- T44：切换评估周期、权重并查询历史版本

## T50 · 复核试点评估参数并按版本发布

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 144、US 163、US 164；验收：评估开放门槛；AC-35、AC-36。

### What to build

在获授权的试点中复核初始参数，给出各维度与可信度分布、待定比例和调整依据；必要调整经用户确认后以新版本发布。

### Acceptance criteria

- [ ] 开发与自动化验证仅用合成会话；试点校准使用授权范围内的实际指标，登记样本、客户端覆盖、时间范围和已知偏差。
- [ ] 提交得分/可信度/待定分布、异常个例的可追溯依据及参数建议，不凭合成原型宣称现实效果已验证。
- [ ] 参数变化经用户确认后发布整体模型新版本，保留旧结果且可比较；未经试点复核不宣称已满足评估全员开放门槛。

### Blocked by

- T31：完成 V1 产品验收与运行证据（G4）
- T45：按等级分组浏览员工一览并进入画像
- T47：在画像中核查辅导方向、代表会话与周趋势
- T49：更正推断后重算报表与评估并保留旧版本

## T51 · 从团队汇总直达同版本的使用能力画像

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 133、US 134、US 143、US 170、US 176；验收：AC-28、AC-31、AC-38。

### What to build

团队概览的本周人员汇总增加使用能力列，显示接入至今的等级与指数，并直达对应员工画像。

**Tracer bullet：本票打通一条窄而完整的用户路径，以可运行、可演示的行为作为交付单位。**

### Acceptance criteria

- [ ] 汇总列使用接入至今的评估结果，明确其范围与本周活动字段的差别，链接携带对应员工与评估范围。
- [ ] 等级、指数、待定及覆盖警示与员工一览/画像相同，不新增按能力排序的人员列表。
- [ ] 用跨周、未知和待定样例验证点击、返回及 Web/MCP 版本一致，键盘和窄屏可用。
- [ ] 用合成会话通过公开产品入口验证完整用户路径，并提交可复现的演示步骤与结果；本行为涉及的持久化、服务查询、Web/MCP 及行为测试随本票一起交付。

### Blocked by

- T42：从团队概览和周工作视图下钻到使用报表
- T45：按等级分组浏览员工一览并进入画像

## T52 · 验收 V2 完整旅程、性能与 V1 回归

### Parent

[Skynet PRD v2 #2](https://github.com/yiwer/Skynet/issues/2)。

对应用户故事：US 105、US 143、US 171、US 172、US 173、US 174、US 175、US 176；验收：AC-23…AC-38；V1 回归。

### What to build

从存档进入组装、对话、活动、报表、画像和更正完成完整旅程，给出 V2 可发布的验收证据。

### Acceptance criteria

- [ ] 逐项验证 AC-23…AC-38，并复跑 V1 AC-01…AC-22 和 G0—G4；通过上传契约注入合成原件，不绕过产品路径填界面数据。
- [ ] 核对 Web/MCP/导出、增量/全量重算、未知/样本/版本以及不排名等守则；每张图的表格、键盘、明暗对比度、减少动效与320—1920 px适配完成验收。
- [ ] AC-32 先确认试点规模与响应目标，再记录报表、活动和画像的 P50/P95；未确认目标或未完成真实试点校准时保留未完成项，不虚构通过结论。

### Blocked by

- T33：查看每条会话的组装依据与处理链路
- T39：按任务类型复盘高投入或反复返工的会话
- T48：追加复核备注而不改动评估
- T50：复核试点评估参数并按版本发布
- T51：从团队汇总直达同版本的使用能力画像

## 用户故事覆盖索引

| 用户故事 | 对应票 |
| --- | --- |
| US 1 | T09、T31 |
| US 2 | T09 |
| US 3 | T11 |
| US 4 | T09 |
| US 5 | T04、T05、T09 |
| US 6 | T09、T12 |
| US 7 | T09、T11 |
| US 8 | T09、T10、T31 |
| US 9 | T09 |
| US 10 | T10 |
| US 11 | T10、T17 |
| US 12 | T10 |
| US 13 | T09、T11、T12 |
| US 14 | T12 |
| US 15 | T12 |
| US 16 | T02、T04、T05、T11 |
| US 17 | T02、T04、T05 |
| US 18 | T04、T05 |
| US 19 | T06 |
| US 20 | T06 |
| US 21 | T02、T04、T05、T07 |
| US 22 | T07、T17 |
| US 23 | T07 |
| US 24 | T14 |
| US 25 | T14、T15、T17 |
| US 26 | T10、T14、T16、T31 |
| US 27 | T07、T15、T16 |
| US 28 | T03 |
| US 29 | T03 |
| US 30 | T04、T05 |
| US 31 | T03 |
| US 32 | T03 |
| US 33 | T17 |
| US 34 | T03、T04、T05 |
| US 35 | T30 |
| US 36 | T26、T29 |
| US 37 | T27 |
| US 38 | T26、T27 |
| US 39 | T25、T27、T29 |
| US 40 | T20、T21、T25、T26、T27 |
| US 41 | T20、T26 |
| US 42 | T26、T29 |
| US 43 | T14、T16、T29 |
| US 44 | T25 |
| US 45 | T07、T24、T25 |
| US 46 | T10、T14、T16、T29、T31 |
| US 47 | T06、T26、T28 |
| US 48 | T26、T27 |
| US 49 | T28 |
| US 50 | T28 |
| US 51 | T28 |
| US 52 | T22、T28 |
| US 53 | T02、T18 |
| US 54 | T02、T18 |
| US 55 | T02、T09、T18 |
| US 56 | T24、T25、T26、T27 |
| US 57 | T24、T25、T26、T27 |
| US 58 | T03、T18、T24 |
| US 59 | T20 |
| US 60 | T22 |
| US 61 | T22 |
| US 62 | T21 |
| US 63 | T20 |
| US 64 | T20 |
| US 65 | T02、T30 |
| US 66 | T18、T24 |
| US 67 | T30 |
| US 68 | T30 |
| US 69 | T09、T11、T31 |
| US 70 | T09、T10、T12、T16、T31 |
| US 71 | T01、T26、T29 |
| US 72 | T33 |
| US 73 | T33 |
| US 74 | T33 |
| US 75 | T33 |
| US 76 | T33 |
| US 77 | T33 |
| US 78 | T33 |
| US 79 | T33 |
| US 80 | T33 |
| US 81 | T33 |
| US 82 | T33 |
| US 83 | T33 |
| US 84 | T32、T33 |
| US 85 | T34 |
| US 86 | T34 |
| US 87 | T34 |
| US 88 | T35 |
| US 89 | T35 |
| US 90 | T34 |
| US 91 | T34 |
| US 92 | T34 |
| US 93 | T34 |
| US 94 | T34 |
| US 95 | T34 |
| US 96 | T34 |
| US 97 | T37 |
| US 98 | T37 |
| US 99 | T37 |
| US 100 | T37 |
| US 101 | T37 |
| US 102 | T37 |
| US 103 | T37、T46 |
| US 104 | T32、T38、T40、T42 |
| US 105 | T32、T37、T38、T40、T41、T42、T52 |
| US 106 | T32、T38、T40、T41、T42 |
| US 107 | T32、T38、T42 |
| US 108 | T35、T38、T39 |
| US 109 | T36、T38、T40、T49 |
| US 110 | T32、T36、T38 |
| US 111 | T32、T38 |
| US 112 | T38 |
| US 113 | T38 |
| US 114 | T38 |
| US 115 | T39 |
| US 116 | T39 |
| US 117 | T39 |
| US 118 | T39 |
| US 119 | T36、T40 |
| US 120 | T36、T40 |
| US 121 | T36、T40 |
| US 122 | T36、T40 |
| US 123 | T36、T40 |
| US 124 | T36、T40 |
| US 125 | T36、T40 |
| US 126 | T35、T41 |
| US 127 | T41 |
| US 128 | T41 |
| US 129 | T41 |
| US 130 | T41 |
| US 131 | T42 |
| US 132 | T42 |
| US 133 | T51 |
| US 134 | T42、T51 |
| US 135 | T43、T45 |
| US 136 | T45、T47 |
| US 137 | T43、T45 |
| US 138 | T44、T45 |
| US 139 | T44、T45 |
| US 140 | T43、T45 |
| US 141 | T43、T45 |
| US 142 | T43、T44 |
| US 143 | T45、T51、T52 |
| US 144 | T43、T44、T45、T50 |
| US 145 | T46、T47 |
| US 146 | T46 |
| US 147 | T43、T47 |
| US 148 | T47 |
| US 149 | T43、T47 |
| US 150 | T43、T47 |
| US 151 | T46 |
| US 152 | T46 |
| US 153 | T46 |
| US 154 | T47 |
| US 155 | T47 |
| US 156 | T47 |
| US 157 | T46 |
| US 158 | T47 |
| US 159 | T46 |
| US 160 | T43、T45、T46 |
| US 161 | T48 |
| US 162 | T49 |
| US 163 | T43、T44、T49、T50 |
| US 164 | T44、T49、T50 |
| US 165 | T43、T44、T45、T46 |
| US 166 | T32、T38、T40、T41 |
| US 167 | T37 |
| US 168 | T34 |
| US 169 | T32 |
| US 170 | T43、T44、T46、T47、T51 |
| US 171 | T35、T41、T52 |
| US 172 | T48、T49、T52 |
| US 173 | T32、T49、T52 |
| US 174 | T32、T38、T39、T49、T52 |
| US 175 | T35、T41、T52 |
| US 176 | T37、T38、T39、T40、T41、T42、T45、T46、T47、T51、T52 |
