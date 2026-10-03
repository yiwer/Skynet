# 材料先恢复、原来源后独立采集的资格修订

材料首次资格映射保留事件身份，原来源后来通过正常宿主独立采集可追加可信资格证明。原员工、设备、项目、来源日期、事件 ID、原材料坐标和原字节不改；先前已发布的日报与分析引用也不改。B 的恢复回执、复制上传或伪造接入时间不能给 A 证明原来源活动。

## 公开 trace bullet

`tests/material-qualification.test.ts` 从已绑定 A 设备正常宿主采集 parent 及 child 上下文，B 用公开恢复包建立材料 receipt 并正常宿主采集 child；B-first 时 A 原事件为历史。先冻结 A 的零已确认活动日报和 B 的历史分析，再由 A 原设备正常宿主采集完全相同的 child bytes：接入前事件仍历史，接入后原事件只计 A 一次。B 和后来的载体复用相同 ID、原员工/项目/来源日及材料原句。

基线公开红测 `material-qualification-red-v2.log`：5.81 秒，接入后事件实际仍 `historical`。最初 receipt 漏 `snapshotId` 导致不同事件 ID 的 fixture 失败另存 `material-qualification-red.log`，不作为产品红测。

当前 API、OAuth MCP、Web、搜索所用 EventOrigin 与统计采用同一有效分类；Web 同时链接原材料原句与正常采集资格原件。可读导出随资格版本更新，raw/recovery 包保持字节身份。测试读取缓存中的 B 载体后提交 A 证明，再立即读取 B detail/可读导出，避免仅新快照或重启后看似正确。

## 保存方式与版本边界

- `event_qualifications` 追加原事件资格、可信设备登记时间、正常采集主件及行/block、精确原记录 hash、单调 `revision`。仅相同原 device/source/session 且已验证材料/原生前缀的正常主件可追加；恢复主件与外来副本无权证明原来源。重复采集不追加重复证明。
- `archive_event_origins`、`snapshot_events`、`material_events` 的基准身份与映射不改。`effective_event_origins` 保留全部原字段，仅 overlay 当前 `context`，另公开 `base_context / qualification_revision / proof_snapshot_id / proof_line / proof_block / proof_enrolled_at`。
- `EventOrigin.qualification` 可选 `{ revision: string, proofSnapshotId, proofLine, proofBlock, enrolledAt }`。已有历史分析/日报 JSON 原样保存，不能重新解释其旧引用。当前 snapshot detail 与 readable export 缓存加入映射事件的最大资格 revision，不能按 snapshot/day 永久缓存旧分类。
- `AnalysisInput.attributionRevision` 来自一次 origin rows 读取的最大证明 revision；目标同时版本化 snapshot/config/parser/资格。request 在 archive → queue 锁顺序下校验准备输入与当前资格，旧准备输入返回 409，不能挂到新 generation。运行中的旧任务可完成为历史结果，但 `applicable=false`，后续模型请求被 durable revision/generation 检查拒绝；排队旧版本由正常 sweep 过期。队列协议升级为 3，prompt identity 为 `original-segments-qualification-1`；保留既有队列迁移 7402123-before-DDL 和预算/租约/总次数边界。
- 日报后台发现期间资格 revision 改变后刷新，包含旧版 `ready` 期间；最新有效来源分类选日/员工/项目与计数。新 analysis 输入的 qualification revision 随 coverage.inputs 保存。明确指定旧 revision 的日报保持原 payload/引用，报告版本不原位改写。

## 已提交旧数据的后台补齐

初次迁移持久化 `qualification_reconcile.cutoff`。服务 ready 后每秒最多处理两个 cutoff 前已提交、正常原设备 primary；持久游标按 committed_at/id 推进，不扫描原生宿主目录，也不导入未资格会话。使用已验证 source/material 映射、服务端设备登记边界和原件 hash，逐 1000 映射事件取精确完整原始行；每页及 UTF-8 验证之间让出事件循环，不再次整体展开无关 JSON。支持存档原有 64MiB 单件边界，独立分析仍维持 8MiB 总原件上限。

损坏 UTF-8 不凭替换字符创建精确证明：原件/原归属保留，`qualification_reconcile_gaps` 保存缺口，统计/Web 显示未完成资格校验数量。后台错误保留游标、回滚该批，并显示 `qualificationError`；后续正常 poll 可重试。此处没有修改 `readEvidence/readClaudeEvidence` 的一般解析；普通解析、周报及统计的替换字符缺口仍由 `%TEMP%/skynet-v1-implementation/analysis-utf8-integrity-finding.md` 交独立修订，不能写成全局损坏 UTF-8 已修。

大件公开测试用 17,826,999 字节 primary：B 先恢复材料，A 原设备已正常提交同字节但无 proof。测试仅用数据库 trigger 模拟前一 schema 的“无资格追加”，所有原件、主件、receipt、映射、旧日报由公开流程产生。重启后台补齐首尾原事件，无 collector 重新上传；再次重启 proof revision 幂等，原 raw hash/IDs/归属/日期和旧日报不变。模型输入依然 413，零分析任务/调用。该升级 fixture 是合成前一行为 seam，不宣称运行了实际历史发行 payload。

## Windows 验证台账

静态 `npm run typecheck`、`npm run build`、`git diff --check` 通过。测试使用自有 PostgreSQL 容器、inline app、hidden CLI/Docker 和 headless Web；没有 Task、真实安装/maintenance 压力、真实账号或付费模型。

- 初始完整 trace **1/1 PASS 8.34 秒**，`NEnsNQ/material-qualification-evidence.json`；相关材料/日报/队列/长会话定向 **9/9 PASS 40.38 秒**，`material-qualification-regressions.log`，material `KgCHdz/OZUS4E`、queue `nCNOKF`、long `hKmMgi`。
- 增 ready 日报自动刷新/Web proof 链接：首次列表链接在证据页隐藏导致 30 秒 locator 失败，随后按正常导航修正测试；`oEJoZI` 完整 trace **1/1 PASS 9.43 秒**。
- 旧大件最初错误预期 422，实际既有总字节拒绝码 413，未修改产品上限。随后后台证明已写入，但当前 detail 缓存仍历史的红测保留 `psnawr/legacy-qualification-failure.json`，两条 after-enrollment proof revision 3/4 与旧 API origin 同存。修正缓存后 **2/2 PASS 19.92 秒**，`PCHng1` 与 `DivseW`。
- 公开 request origin-read 被暂挂、A 实际正常采集提交 proof、旧 request 返回 409 的竞争测试已通过，`6WNlyj` 首条 **9.79 秒**；该轮第二个 legacy fixture parent 上传返回 500，`material-qualification-race-green.log` 保留，尚待脱敏错误诊断，不能覆盖为全轮通过。
- 后续加损坏 UTF-8 精确资格反例的批次卡在自有 `docker run` 创建容器（`skynet-test-c3882c06-f73d-4bbf-971e-2c42d3d23b83`），**0 pass / 2 cancelled**，两条各在 fixture 前 120 秒取消，总374.41秒；`material-qualification-final-trace.log` 保留。root随后独立验证 Docker version/ps 均5000ms超时，确认为全局 engine不可用；不把取消归为业务断言失败。
- Docker 恢复后当前最终源码 **2/2 PASS 21.59 秒**，`material-qualification-after-docker-recovery.log`：`ns3QUr` 完整公开 trace 含 origin-read 暂挂→实际 A 采集→旧 request409、旧 forward禁止、B缓存/导出即时刷新、ready日报自动新版本、OAuth MCP/Web；`3OohvX` 大件17,826,999字节首尾资格/两次重启幂等、原raw相同、8MiB analysis413/零job，附损坏 UTF-8 原件analysis422、不授精确proof及可见gap。此前单次 parent500底层原因未知，脱敏 `onError` 已随测试保存，后续通过不覆盖其记录。
- 最终相关非 Task 回归 **13/13 PASS 70.65 秒**，`material-qualification-final-regressions.log`：材料 `CEz5pf/2l3Igh`、队列 `CxIUXN`、长范围 `o6SuO1`、跨设备 `pwg5o0/u6VebY`、历史 `0evrob`、OAuth MCP `N7gr7b`，另含日报并发和配置缺失行为。不是完整 Windows suite 或实际 native/provider验收。
- 游标持久化保留 PostgreSQL 微秒字符串（不经 JavaScript Date 截断），在长无关 padding 中也每 1000 完整行让出执行；该最终修订定向 **2/2 PASS 22.42 秒**，`material-qualification-final-cursor.log`，`wJq5or/caQOyh`。静态 typecheck/build/diffcheck 通过，之后仅记录文档。

复现命令（先构建自身源码，测试 fixture 同时包含 inline app 与 hidden compiled server）：

```sh
npm run typecheck
npm run build
node --import tsx --test tests/material-qualification.test.ts
node --import tsx --test --test-concurrency=1 tests/material-primary.test.ts tests/daily-reports.test.ts tests/analysis-queue.test.ts tests/analysis-long-public.test.ts tests/analysis.test.ts tests/mcp.test.ts tests/cross-device.test.ts tests/history.test.ts
git diff --check
```

日志在 `%TEMP%/skynet-v1-implementation/`，测试 JSON 在 `%TEMP%/skynet-test-<上述ID>/`；不含 provider/设备凭据。当前 scoped 验证不覆盖 prior issue23 全 Windows 33 项中的 31/33 runtime-control 失败，也不覆盖此前 maintenance/control/性能失败。G2/G3、真实千问/PAYG质量、Desktop UI、完整 G0–G4 与压力性能继续开放。
