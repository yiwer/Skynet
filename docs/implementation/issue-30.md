# #30 迟到输入与人工更正公开流程准备

状态：独立检查点 `80ee226` 已组合最新主线 `6d828bf`（含 #31 `519d59f`）；正式 G0–G4、真实千问 PAYG 与运营验收仍开放。只使用隔离原件、测试账号和 loopback 提供者，没有实际 Task/setup/maintenance 或真实员工配置。

## 产品行为

- 已认证用户在日工作中追加说明、更正工作主题、更正显示项目或请求重新分析。不可变更正记录保存 requestId、序号、认证操作者、提交时姓名、时间、原因与所引用原事件。说明单列显示，不能成为新活动或已核验交付。
- 显示项目支持把未归类项目活动归到明确项目，也可改回未归类。每个原事件以本日最新人工项目更正唯一分配；原件、原员工、来源日期、原项目与 eventId 不改。日报总计不变；新版项目分项冻结该显示分配。原件同一用户行可能涉及多项目，各项目用户轮次可重叠，不能相加当员工总轮次。
- HTTP `POST /api/daily-reports/:employeeId/:date/corrections` 使用严格鉴别合同：kind=`note/theme/project/reanalyze`，expectedRevision、UUID requestId 和原因必填；主题/项目必须引用本日该原员工同一原项目的已确认活动。伪造 actor、未知事件或其他来源被拒绝。过期或尚待生成的并发更正返回409；相同操作者和相同内容的 requestId 重放只保留一次，不重复重算。
- 更正使对应日报和包含该来源日的既有周/项目期间待刷新；新项目可正常列出与下钻。日、周、项目结论保留原句与分类标识，工作主题的人工覆盖另存原分析主题，项目的人工覆盖另附原来源项目。
- 迟到原件只检查已经管理的日报期间，按原来源日期刷新，不把旧会话背景计入今天，也不新建接入前历史日报。每 tick 公平检查20期间、归一化10期间，旧期间较多时需多个 tick；不声明60秒性能验收。
- 已建但尚无合格日报引用的项目期间，同样由有界公平的候选修订检查发现首条迟到活动，不依赖旧 day refs。周/项目每 tick 检查20期间、归一化2期间，事务冻结候选与日报选择；日报未追上当前来源输入时显式 `stale-input` 等待，不将旧计数描述为完整新输入。
- 当前输入指纹包括已确认事件数、精确 PostgreSQL carrier 时刻、原来源资格修订、当前 parser、运行时配置与分析目标版本。准备期间输入改变则不发布旧快照；generation/资格/配置/parser、原件散列和旧作业 fencing 仍由 #24 共享队列兑现。
- 人工重新分析为每个目标和更正 requestId 持久记录一次新 generation；同一更正轮询不反复建作业。每版仍遵守队列上限、有限尝试和共享预算预留；旧在途结果可保存为非适用历史，不能成为最新报告输入。
- 固定 report/work-view revision 只读取其冻结 payload，不用新更正、最新输入或新统计重解释旧版本。原件字节保持不变。

## 查询与处理边界

`GET /api/daily-reports/:employeeId/:date/corrections?offset=...` 与只读 OAuth MCP `read_report_corrections` 共用历史查询；最多20条/24KiB每页。日报最近8条、周/项目最近至多32条日更正展示，完整历史在对应日报分页读取。每个员工/日最多500次更正，主题/项目单次最多50个 eventId；超界明确拒绝，原件和既有历史不删除。原件下载、归属查询和分析预算均不因更正而覆写。

新增表 `report_corrections`（报告迁移锁7402128）和 `analysis_recomputations`（沿用分析7402122→7402123迁移及 queue协议3）；日报期间增加 source_revision/last_inspected_at，周/项目期间增加 candidate_revision/last_inspected_at（沿用7402131）。灾备需要完整数据库，以保存全部更正、目标 generation、统计及固定报告版本，不能只备最新 payload。#31 独立统计版本仍按其来源口径冻结，本票不将旧统计回填旧报告或把文件、Token自动猜分到人工显示项目。

## 验证记录

- 说明公开 RED：原接口404，要求202；实现后认证、操作者/原因、冲突、固定旧文本和重启通过。
- 迟到输入公开 RED：已经 ready 的零记录日报在接入后原件到达后仍为0；实现有界当前输入检查后变1，原2020背景不建历史报告。小套2/2 PASS，最终单次11.35s；后续接口补强小套2/2 PASS12.61s。
- 公开完整更正链 `tests/report-corrections-workflow.test.ts` **1/1 PASS（60.70s，总61.42s）**，fixture `3zQGHw`：Web说明、主题归类、未归类→明确显示项目、日报/周/原项目/新项目一致版本、计数唯一分配与原来源留存、OAuth MCP、更正历史、重启、旧固定响应与 raw 字节不变；确定性执行 seam 控制已 forward 的旧结果晚完成，旧结果保持非适用。
- 完整链前的三次失败保留：54.48s 测试误把首20项当全部项目事项，改为固定 revision 翻页；39.94s 第二次重算在首个待生成更正保存前提交，正确返回409，测试改为等该版本；55.15s 测试领取了另一原件的作业却在本原件列表查找，改为按实际 snapshotId 领取。未把失败运行算通过。
- 当前源码 `npm run typecheck`、`npm run build`、`git diff --check` 通过。后续真实 Claude 定向及 #31 主线接口组合结果追加于此。
- 增加人工显示项目 Web→原句和 OAuth MCP 固定同版后，实际 Claude2.1.281 **1/1 PASS（55.56s，总56.25s）**，`UdcLwG`。实际重新分析仍由独立 CLI 执行，调用只到合成 loopback；旧结果延迟完成的故障注入由上述普通执行 seam 证明，不冒称实际 CLI 延迟。两份安全 JSON 已 SHA256 核对复制到 `F:/GenCode/Skynet-evidence/v1-2026-09-30/issue-30/`。
- 组合最新主线时，只在 Web 导航回调与 MCP 测试有冲突；保留 #31 只读覆盖/统计/日报下钻与 #30 更正 body，并保留具名只读工具断言。组合 typecheck/build 通过，报告更正、材料资格及 OAuth MCP **6/6 PASS（98.50s）**，`MNxSTK`；来源统计与完整覆盖公开链 **4/4 PASS（10.76s）**，`uiJDz4`，覆盖证据直接写入持久目录。
- 最后追加空候选项目的首条 late 活动公开 RED **null≠1（23.81s）**；增加 candidate revision 检查及日输入一致性后，公开更正/迟到整链 **3/3 PASS（60.94s）**，`5dCgd0`：已有日周项目无需再次 POST 均从未知或0更新为1，2020背景未批量建日报，固定旧日周项目文本保持相同。该修订没有扩大真实 Task 或 UI 审查范围。
- 最终组合源码真实 Claude2.1.281 **1/1 PASS（54.37s，总55.11s）**，`xUlWpY`，6次合成 loopback 请求；最终审计/迟到 **2/2 PASS（12.09s）**，`lMisFn` / `sxW08n`，另校验 late raw 字节不变。上述组合、普通与原生 JSON 共7份已保存到持久 `issue-30/` 目录并与来源 SHA256 核对。最后 typecheck 通过。
- 最终来源日修订后，材料资格→日周项目与 OAuth MCP 定向 **2/2 PASS（24.11s）**，`WtuXtO` / `mrnkQi`；一般 invalid UTF8 的既有解析问题仍待统一修订，没有通过本票掩盖。所有本票创建的测试 worker/浏览器/私有容器由 fixture finally 关闭；原件 fixture 和安全证据保留，不删除其他容器、Task 或用户数据。

## 仍开放

G3 指定千问模型质量、价格/实际账单、负载和运营归期，Desktop 实际 UI 与完整支持矩阵、G2 故障矩阵、五日试点、第二人复现及负责人签收均未通过。合成结果和真实 Claude loopback 证明公开处理链，不代替这些验收。

## 主线组合验证

最终clean `c5d23c5` 无冲突合入 `6d828bf`；保留矩阵/来源统计/资格证明/日周项目引用，以及runtime/Task静默和诊断文档。主线自身typecheck/build/diffcheck与审计/迟到/完整更正/资格/source统计/覆盖/MCP/work公开组合 **12/12 PASS（56.26s，0fail/0cancel）**，完整链 `nUxLNy`55.32s、审计 `bjemQB`、迟到 `6G2Ijm`、资格 `jur5EB/rTGOXo`、覆盖 `pl3vSp`、工作视图 `k1YWQn`、MCP `AkjTV0`。六份安全JSON经私有字段检查和来源SHA核对保存于 durable `main-30/`及 `coverage-a1e041b4-99fa-4822-9c9c-6b2e5174429b/`；日志 `main-30-integration.log`，摘要 `main-30-evidence-summary.json`。

本次没有实际native/Task/setup/maintenance/完整Windows。54.37s实际Claude最终证据明确来自上述支线 `xUlWpY`；已有53/53 LinuxCI尚不含本次#30。全部历史RED、通用非法UTF8待修及G0–G4保持原状态。#32必须完整备份更正/重算/期间新列与固定报告，不只保存最新payload。
