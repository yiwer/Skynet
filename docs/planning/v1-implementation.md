# V1 implementation

工作分支：`implement/v1`。规格：[Issue #1](https://github.com/yiwer/Skynet/issues/1)、[PRD](../requirements/PRD.md)、[验收标准](../requirements/v1-acceptance.md)。

实现采用 [tracer-bullet ticket 图](tracer-bullet-tickets.md)，范围为 #4–#33；V2 的 #3 与 #34–#54 不在本次范围。每个实现任务使用独立 worktree，合并到同一草稿 PR。代码与合成测试通过不等同于真实客户端验收通过。

## 恢复实施（2026-09-30）

用户要求继续剩余 tickets 直至 V1 完成。以干净的 `a4ca34c` 工作区恢复，沿用草稿 PR #55；该提交的 [Linux CI](https://github.com/yiwer/Skynet/actions/runs/36400612859/job/108857308920) 包含类型检查、构建和 17 项测试，全部通过。

G0 增补、#14 维护与 Windows guardian / stdin UTF-8 修订、#19 主会话与正常独立资格材料的归属，以及 #22 短会话分析公开流程准备已合入。#14 recovery 支线完整24项为23 pass /1 initial-install runtime-control fail；确定性 fallback 崩溃恢复通过，但无响应故障的 tight-loop 诊断继续交接，失败记录保留。每项由独立分支实施、合并代理集成。后续按依赖核查分析、报告和灾备；未通过的前置门槛继续保持开放，准备代码不等于验收通过。真实 Desktop 隔离环境、千问专用配置/模型/测试预算、第二人复现与五个工作日试点仍需实际条件，不以合成回归代替。

主会话归属集成提交 `1665d08` 的 [Linux CI](https://github.com/yiwer/Skynet/actions/runs/36670850420/job/109745319778) 已通过类型检查、构建与 19/19 普通流程回归；合并后的六项定向回归及真实 Claude 主会话、子会话续聊也通过。这是 #14 合并之前的 Linux 证据；Windows 安装/插件此前出现的后台无响应失败仍保留，不能据后续正常回归通过认定其根因已消除。

AC-01…AC-22 的已有证据和缺口集中列于 [V1 验收证据台账](../implementation/v1-acceptance-ledger.md)，在后续集成时更新。

此前顺序合并 #22 `2af8421`→`73bc1bd`、#19 材料扩展 `73c745e`→`b4a60ec`，无冲突。主线自身源码重新 typecheck/build/diffcheck 与分析/MCP/历史/材料/跨设备/材料独立资格/搜索定向 10/10 通过（72.18 秒），未重复原生或完整套件；支线实际 CLI 实测的来源与证据见各票和台账，不能把它们写为该次主线原生复跑。`f6ccbca` 的 [Linux CI](https://github.com/yiwer/Skynet/actions/runs/36675975531/job/109760915991) 随后28/28通过（100.38秒），该节点尚未含 recovery；不覆盖 Windows 全量失败。

## 上次暂停节点（2026-09-28）

当时按用户要求，本批收敛后停止继续实现。最后产品集成提交为 `cbb90b3`：#13 插件入口、#18 本地故障与缺口、#27 搜索已合入，并修复账号停用后刷新导致登录按钮持续忙碌的问题。暂停时 PR #55 保持草稿，规格与未验收票据未关闭。

类型检查、生产构建与最后三项集成检查（采集缺口、MCP、搜索）通过。#18 的全套 17 项最初通过 16 项，唯一认证测试竞态修正后，认证、插件禁采、Claude metadata 恢复及 Linux 原生故障四项复验通过；最终 Linux 全套结果以 [PR 检查](https://github.com/yiwer/Skynet/pull/55/checks) 为准。并行负载下满盘 hook 的 200 样本 P95 为 **111.35 ms**，未达到 100 ms 目标，性能门槛保持开放。

恢复工作时先处理 #14 修复/升级/卸载与 #19 跨设备历史归属，再接续 #22 的独立草稿；后续为长会话分析、预算与重试、日报/周报/项目、人工更正、覆盖矩阵和服务器备份恢复。G0–G4 均未通过，仍需真实 Desktop 界面采集及服务器独立续聊、登录/重启/休眠、指定千问模型与预算、五个工作日试运行和负责人签收。现有授权实现范围不因暂停改变。

## 当前状态

- #4：合成输入的设备绑定→hook→后台→原件持久化→认证 Web 查询已实现，提交 `61a5337` 已合并；真实 Desktop 自动采集尚未验收。
- #5：认证完整可读导出、带清单与校验的原生包、全新目录恢复已实现，提交 `b8c49a1` 已合并。实际 Desktop 内置后端通过服务器下载包恢复上下文和工具历史；Desktop 界面验收仍未通过。
- #7：Claude CLI 两项目普通 hooks 自动采集、Web 查询及服务器包原生恢复已实现，提交 `ac66a80` 已通过 `ed4735d` 合并。实际 Claude 2.1.281 运行测试保留原 UUID、上下文和工具结果；模型为隔离确定性替身，单原件范围，G0 不由此通过。
- #6：Codex CLI 正常审核产品 hook、两项目自动采集和服务器独立恢复已实现，提交 `794a7e4` 已通过 `d979c83` 合并。三来源集成后类型检查、构建、4 项普通流程与 3 项原生测试通过；hook 快路径的 200 次进程启动与持久入队实测 P95 为 74.2 ms。当前提升权限环境的实际 Codex apply_patch 被 read-only 沙箱拒绝，正常 workspace-write 环境与完整 G0 仍待验收。
- #8：旧会话完整接管、已确认前缀的增量上传及来源日期已实现，提交 `739b1c6` 已通过 `883e517` 合并。5 项公开流程与 3 项原生恢复回归通过；后续两个 CLI 的真实旧会话续用诊断也已通过，Desktop 及完整支持组合验收仍开放。
- #9：代次、精确关联材料、分块上传和 v2 恢复包已通过 `70befed` 合并，集成的 7 项普通测试通过。真实 Codex 后端分支经服务器包恢复后保留父文本、工具和图像；独立附件行回填与 Claude 子会话 metadata 原位续聊已在后续 #10/#18 补测；未知附件 payload 语义、外部资源与 Desktop UI 仍未验证。每件 64 MiB、集合 128 MiB 的边界和超限缺口明确显示。
- #10：G0 增补实现 `497e8da` 已通过 `3fb6454` 合并，六项原生回归通过：两 CLI 旧会话边界、Claude 实际 Write/Read 和子会话原位恢复续用、两版 Codex 父/fork/PNG/工具历史及独立附件行的精确原生 readback。新增 `test:g0-native` 和 [G0 记录](../implementation/issue-10.md)；G0 仍未通过真实 Desktop UI、当前环境 Codex 普通 workspace-write 及全部材料支持矩阵。支线全量普通测试 15/17，安装/插件 runtime unresponsive 的失败保留，由 #14 跟进。主线类型检查、构建和材料/恢复集成回归2/2通过，未复跑全部17项。
- #11：内部 npm 包、单 Key setup、受限中央身份、共享后台和分项状态已通过 `acd2f5b` 合并，集成 8 项普通测试通过。两个真实 CLI 均通过安装入口采集及服务器独立恢复；Codex 另覆盖交互终端和 exec。稳定 launcher 200 次 P95 为 71.59 ms。G0/G1 仍未通过；后续自启实现见 #12，真实登录仍待验收。
- #12：认证独占控制、监督器/采集进程、隐藏的当前用户 Windows 任务已通过 `198856b` 合并，集成 13 项普通测试通过。安装父进程退出、两类后台崩溃、离线积压及竞争启动均实测；Claude 安装模式恢复与稳定 hook P95 65.88 ms 通过。真实 Desktop 图标启动、重新登录/重启/休眠仍待验。
- #13：两个真实 CLI 的内部插件市场、npm/双插件共存、入口所有权与冻结材料补传已通过 `2111d75` 合并。分支 15 项普通测试通过，主线插件/运行时专项通过；缓存不可用后采集与服务器恢复实测通过。最后来源入口退出不再读取新增原件。控制响应关闭竞态已修；完整修复/升级/卸载已由 #14 集成。
- #14：`d725e48` 经 `14e29a8` 合入维护；`1a8eb53` recovery 现合入隐藏 Node guardian 和 streaming UTF8 修订。支线强制 Disabled task→fallback→worker/supervisor crash恢复与中文path分割输入2/2通过，新维护路径1/1通过（171.24秒）。该支线完整24项仍为23 pass /1 initial-install control fail（143.18秒），此前两轮取消/安装失败保留；未知控制端点故障继续独立tight-loop诊断，不用单跑pass覆盖红结果。见 [#14](../implementation/issue-14.md)；G1和真实生命周期仍开放。
- #16：原件与清单先持久入队、断网退避补传、配额和设备同步状态已通过 `4ce4170` 合并。集成 10 项普通测试通过；实现分支另通过两个 CLI 安装模式及 Desktop 后端的原生回归。离线后改写/删除源头、429、错误凭据及错误 ACK 均保留队列；G1/G2 仍开放。
- #17：持久上传键、同键异内容拒绝、注册确认丢失恢复与实际进程崩溃验证已通过 `f534f46` 合并；十次断连接丢 ACK 仍只有一个逻辑快照。整合时修复不同冷快照并发读取的忙碌问题，保留并行读取断言，并在 #12 合并后通过 13 项全量测试。
- #18：真实 Linux ENOSPC、EACCES、ENOENT 下的正常 Claude 回合、独立故障报告与恢复后补传已通过 `cbb90b3` 合并。设备/会话/Web/MCP 共享动态覆盖，已提交原件保持不可变；无法补回的范围仍显示缺口。Claude 子会话 metadata 关联与原位恢复已修。最终合并专项 3/3 通过；Windows 等价故障、同时离线全盘满和性能目标仍待验收。
- #19：主链 `261fee9` 与正常独立资格材料扩展 `73c745e` 已集成，后者通过 `b4a60ec` 合入。公开恢复包→Codex parent/child/fork 材料→正常宿主独立采集→Web/MCP/搜索/统计/完整导出保留原员工、项目、日期与原材料锚点，新后缀归当前设备。首次材料资格的 eventId/context 映射冻结，B 先续用、A 后采集、重试和 C 恢复不重复计活动；已有 primary 来源原样复用。未独立采集的材料始终 context-only，未知/改写/截断保留不确定性。Claude agentId 子代理不伪装为独立 UUID 主件；G2 和完整支持矩阵仍开放。见 [#19 记录](../implementation/issue-19.md)。
- #20：维护者停用账号/设备、逐请求撤销及操作审计已通过 `ec65e04` 合并；与 #8 集成的 6 项公开流程测试通过，可信接入边界保留。#11 安装前置验收仍未通过。
- #26：个人 OAuth 授权、HTTPS MCP、共享 Web/MCP 查询与分页导出已通过 `85a1533` 合并。两个真实 CLI 各完成 17 次 MCP 调用、正常授权及导出字节校验；后续自然等待 16 分钟，两者均无需重新登录即可自动刷新并重复通过读取。模型为确定性替身；实际域名部署及完整门禁仍开放。
- #27：组合内容搜索、历史代次和稳定原件定位已通过 `96c3d92` 合并。分支 14 项普通测试、两个真实 CLI 各 20 次 MCP 调用通过；合并后搜索/MCP/缓存 3 项回归通过，105 个独立会话跨 37 页完整命中。查询成员可跨重启继续，过期明确报错；320/375/1440px 布局已检查。
- #22：`2af8421` 经 `73bc1bd` 合入短会话公开分析准备：POST 持久任务→隔离实际 Claude Code worker→HTTP/Web/MCP 结果与证据引用，未知、四级结论、失败与输入覆盖明确显示。原材料 raw 锚点与当前输入的语义 quote 偏移分别保留，不能相加。分支实际 Windows/Linux CLI 公共整链使用显式 loopback fixture 通过；不证明真实千问计费或模型质量。#21/G2、真实 PAYG 模型、专用凭据、核实价格与预算仍待实际条件，#22/G3 保持开放；见 [#22 记录](../implementation/issue-22.md)。
- #10、#14–#15、#19、#21、#23–#25、#28–#33：尚未完成；依赖与门槛继续按 ticket 图核查。

#23 独立实现准备已基于 #24 最终 `f2b9cf9` 完成有界长会话 public trace：实际 Windows Claude Code 2.1.281 对本地合成服务分段提取/汇总，原 UTF-16 引用、跨段头尾事实、坏段与 skipped 范围、Web/MCP/原件导出定向通过，见 [#23 记录](../implementation/issue-23.md)。全尝试共享请求/租约/deadline/预算，不按段追加额度。支线完整 Windows 33 项为 **31 pass / 2 runtime-control fail / 0 cancel**，237.08s；新长会话/队列通过，维护 236.15s 通过，安装与插件 1500ms 无响应仍红并交接独立诊断。真实千问、质量和 G3 仍开放，等待集成复核。
- G0–G4：未通过。原生恢复、真实分析、客户端 MCP 授权与五个工作日试点必须保留实测证据。
- [草稿 PR #55](https://github.com/yiwer/Skynet/pull/55) 已保存实现与规格关闭引用；保持草稿，尚无 ticket 通过验收或被关闭。
- 本地类型检查、构建、公开入口 E2E、Linux 容器持久卷重启验证及初次 GitHub CI 通过；[两路评审](../implementation/review-issue-4.md) 的可修复代码问题已在 `9ad3277` 修复，并通过 `920b92f` 合并，回归检查通过。

运行与复现见 [首条存档链](../implementation/issue-4.md)、[导出与恢复](../implementation/issue-5.md)、[Codex CLI 链路](../implementation/issue-6.md)、[Claude CLI 链路](../implementation/issue-7.md)、[旧会话与增量](../implementation/issue-8.md)、[关联材料](../implementation/issue-9.md)、[单 Key 安装](../implementation/issue-11.md)、[共享后台](../implementation/issue-12.md)、[插件接入](../implementation/issue-13.md)、[维护](../implementation/issue-14.md)、[离线补传](../implementation/issue-16.md)、[提交一致性](../implementation/issue-17.md)、[故障与缺口](../implementation/issue-18.md)、[跨设备历史归属](../implementation/issue-19.md)、[身份停用](../implementation/issue-20.md)、[短会话分析](../implementation/issue-22.md)、[HTTPS MCP](../implementation/issue-26.md)、[组合搜索](../implementation/issue-27.md)。目前需补齐的外部条件见 [原生客户端验收状态](../implementation/native-validation-status.md)。

## 已确认的开发环境

- Windows，Node 24.12.0，npm 11.6.2。
- Docker Engine 29.2.0，Linux containers 可用；开发测试使用隔离容器和合成材料。
- 现有 Codex CLI、Claude Code 与 Desktop 安装不代表已有可用的隔离测试账号或已验证的支持组合。
- 测试不读取真实员工会话，不修改真实 Agent 配置，不将现有登录凭据复制到测试环境。

## 验收记录要求

每个 ticket 记录实现提交、实际运行命令、环境、测试结果、未解决项和后续依赖。门槛未通过时保持草稿，不关闭规格与未验收 ticket。
