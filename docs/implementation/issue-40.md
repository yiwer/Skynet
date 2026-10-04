# #40 用量与可核对产出

本票对应 PRD-v2 US 104–114、166、174、176 与 AC-23/24/28/31。所有测试员工、原件、工具输出和模型响应均为合成材料；没有读取个人会话正文、修改生产或调用付费模型。

## 一条固定来源的报表

`usageOutputService` 读取固定 `MetricsPage`，批量准备这些逻辑会话的原件计数、适用分析及原生轮次状态，然后追加 `usage_output_revisions`。HTTP `/api/usage-output`、`/api/usage-output/export`、`POST /api/usage-output/recompute`、OAuth MCP `read_usage_output` 与 Web 共用该服务。设备凭据不能读取报表。后续页必须传同一 `version`，每页 20 个归属分片；固定版本与范围不匹配时拒绝读取。普通响应最多 80 KiB，完整导出最多 16 MiB，不静默截断图表。

范围统一为本周、上周、接入至今，以及员工、Agent、项目。选员工时 `totals` 与 `employees` 只包含该员工；`sessions` 中 `selected=false` 的其他员工分片只用于散点灰色参照。其他筛选作用于整页。人员按姓名及员工 ID 稳定排序，不提供名次或指标排序。

会话按已核实的原生身份与恢复链合并。一个逻辑会话可按 `employeeId/project` 分成多条 `UsageSession`；会话数和未知会话数按 `sessionId` 去重，其余可加指标使用原始事件归属。代码、测试、提交贡献按 `kind/eventId` 去重，结果条目按状态与原文引用事件/偏移/逐字内容去重。恢复前的贡献仍属于原员工及原来源日期，历史上下文不产生新产出。父原件与子材料即使共享原 snapshotId，也按 source/sourceSessionId 区分贡献，恢复子材料不删除父会话的当前叶子。引用跨员工、日期或项目而不能唯一归属的结果使该项保持未知，同时保留其他已知贡献。

每类产出保留 `known`、可空 `value`、`unknownSessions` 及独立的增/删、通过/失败数量。完整原件没有该类行为为已知零；没有适用分析、部分分析或不支持的记录为未知。已验证结果和仅声称结果是模型提取，沿用 #38 的证据核对；代码行、测试和会话内提交沿用 `recorded-output-4`，不根据 Agent 自述生成确定性计数。全量重算绕过派生输入缓存；同一原件/归属/分析输入的结果与增量版本逐字段相等，旧版本在新输入到达及服务重启后仍可读取。

## 共享输入契约

`sessionInsightsService(db, archive, analysis, raw)` 新增批量接口，供 #39/#41/#45 复用，不再每个维度单独扫描原件：

```ts
const report = await usage.export({ period: 'since-enrollment' });
const keys = [...new Map(report.sessions.flatMap(row => row.insightVersions)
  .map(key => [`${key.snapshotId}/${key.version}`, key])).values()];
const frozen = await insights.readVersions(keys);
const current = await insights.readMany(keys.map(key => key.snapshotId));
// 显式重算只用于当前输入：
const rebuilt = await insights.readMany(keys.map(key => key.snapshotId), { full: true });
```

`readMany` 共享一次有界原件准备、批量归属与适用分析查询，以可重复读事务保存派生事实；并发写同一投影时重试整次事务。每次当前读取仍验证原件哈希/大小，缓存不掩盖原件缺失或损坏。`readVersions` 只读取指定快照/版本对，保留请求顺序；找不到任一对时返回 404。显式 `analysisId` 的旧分析读取不误命中 `inferences=null` 的当前 stale 投影。

`UsageSession.insightVersions` 绑定所有贡献输入；`latestCarrierSnapshotIds` 是该逻辑会话当前原生叶子，用于判断当前轮次，不以旧已完成快照覆盖后来重新开始的输入。已核实的恢复叶子替代祖先。每个洞察带 `sourceState.version='native-turn-state-1'` 与原生 turn 状态。下钻链接携带 `insightVersion`，会话侧栏读该固定版本。

`UsageEmployee.daily` 为 `{date,inputTokens,outputTokens,includedSessions,excludedSessions,activeSessions}[]`。未知 Token 会话从趋势排除，但保留排除数量；`activeSessions` 只算业务事件，纯 Token 元数据日期不增加活动日。`activeDates` 是具有业务事件的来源日期，消费方按自身定义选取工作日。`MetricsPage.employeeDaily` 使用 `{employeeId,days}[]` 同源序列，避免每个日期重复携带全套员工汇总和姓名而突破响应上限。

## 原生版本与覆盖修正

Token 原生支持为 Codex CLI 0.157.1 / 0.160.0、Claude Code CLI 2.1.281；其他版本与 Codex Desktop 保持未知。`native-recorded-statistics-2` 依据官方 [0.160.0 protocol.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/codex-rs/protocol/src/protocol.rs) 中累计计数初始化和 SessionMeta 结构扩展支持。只有完整 UTF-8/JSONL、唯一匹配身份的起始头、创建时间不早于设备接入、没有恢复/父历史/压缩/截断/缺口，且服务器观测链连续的新会话才可把第一笔累计计数的基线定为零。缓存输入属于输入子集，不重复相加；恢复、旧历史、无起始头、计数回退仍保留未知和可确认后续差值。重写后追加不能重新取得零基线，`metric-input-3` 将连续性证明纳入投影身份。

依据官方 [rollout policy.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/codex-rs/rollout/src/policy.rs)，`native-input-2` 识别有明确结构的 turn_context、reasoning、Token、生命周期元数据，以及与已解析消息逐字匹配的旧 user_message/agent_message 副本。未识别业务记录、损坏数据、不能匹配的消息仍保留缺口。事件解析器和 eventId 坐标未改。当前组装解释发布 `assembly-2/origin-1/native-input-2`，旧固定组装/指标/分析版本仍可读。

## 页面与公开验证

页面提供五项 KPI、每人按 Agent 堆叠输入 Token、各列独立比例尺的产出表、输入 Token × 已验证结果散点、每人每日输入小图和会话明细。未知 Token 独立列；结果未知单列入口；已知部分与未知会话数量同时显示。散点、Agent 图和每日图的鼠标/键盘提示等价，Escape 关闭；图与表切换保留精确值。页面显示数据截至时间并提供可展开的指标口径。表格及图表区域内部滚动，根页面固定，主题控件沿用产品设计令牌。

RED 依次覆盖：0.160 首笔累计 Token 未知、缺少 HTTP 报表、缺少 MCP 工具、缺少当前叶子、千会话响应 413、重写后错误恢复零基线、旧分析读取错误命中 stale、并发投影 40001。GREEN 通过真实公开上传、原件恢复、固定版本导出、隔离 Claude Code 2.1.281 + loopback Anthropic fixture、实际 HTTPS OAuth/PKCE MCP 和 Playwright Web 路径。

可复现命令：

```powershell
$env:SKYNET_TEST_POSTGRES_BIN='C:/Users/yiwer/AppData/Local/Temp/ticket28-pg-0eb735e987dc48d186870e8a96801e01/bin'
$env:SKYNET_OPENSSL='D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH='D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME='E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
node --import tsx --test --test-concurrency=1 tests/usage-output.test.ts tests/usage-output-public.test.ts tests/v2-public.test.ts
```

外部证据目录：`E:/GenCode/Skynet-evidence/v2-2026-10-04/40-usage/`，含 RED/GREEN、构建日志、320/768/1280/1920 × 明暗截图、公开固定报表与千会话诊断。测试使用隔离 PostgreSQL 18.6，不接触用户数据库。10 人/4 周/1000 会话/80,000 业务事件探测已从 413 恢复为完整成功响应；两轮诊断冷读约 11.33/16.15 秒，热读分别 4.19/4.80 和 5.82/6.73 秒，同主机存在其他隔离测试。该样本未达到 AC-32，不作性能签收；后续性能工作归 #54。

最终功能提交 `8d260c1` 以 `a9ef329` 合入根 `a531cb5`。合入后构建通过（`34-integrated-build.txt`）；本票三项核心公开行为与实际 Claude/HTTPS OAuth MCP/Web 旅程共 **4/4 通过，60.91 秒**（`35-integrated-green.txt`）。原 V2 公开兼容旅程与用量 Web 旅程在并发修复后 **2/2 通过，41.53 秒**（`29-final-public.txt`）；历史/伪造/截断/迟到分析 **4/4 通过**（`19-history-green.txt`）；组装、原件完整性及增量指标的九项关联行为通过（`27-regression.txt` 中原 Web 并发失败已由后续修复验证）。最终八张截图与固定报表在 `integrated/`；已目视 1280 浅色和 320 深色。分支交独立 merger，本票没有部署、推送或关闭远端 issue。
