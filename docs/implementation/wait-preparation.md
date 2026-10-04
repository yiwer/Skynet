# #54 等待来源批量准备

这份补丁优化等待报告、活动和画像共用的 `waitDataset`。公开小负载的后续读取从约 2.3–2.7 秒降至约 0.55–0.59 秒，原有 1,000 ms 断言通过。它不是 AC-32 完整验收：10 人、4 周、1,000 会话以及全部最终报表的首次 P95 ≤ 3 秒、后续 P95 ≤ 1 秒仍由 #54 持续验证。

## 公开诊断

同一脚本使用公开分块/快照上传，创建 3 名合成员工、36 个会话、每会话 80 条真实格式用户消息。HTTP 等待报告必须准确返回 2,844 个等待、2,844,000 ms，第一页 25 条；同时核对员工范围、重复版本、固定历史以及完整重算一致。没有执行模型或使用员工材料。

诊断用计时装饰器调用真实 PostgreSQL 与 `RawStore.read`；SQL 次数只解释瓶颈，不充当测试断言。CPU 采样与查询不记录参数、密钥或原文。

| 测量 | 改前（`c2c80b6`） | 批量实现后 |
| --- | ---: | ---: |
| 一次首次读取 | 2,704 ms | 805 ms |
| 三次后续读取 | 2,347 / 2,299 / 2,691 ms | 579 / 553 / 593 ms |
| 后续原件归属 SQL | 108 次 / 4,725 ms | 3 次 / 286 ms |
| 后续缺失证明 SQL | 108 次 / 963 ms | 18 次 / 228 ms |
| 后续派生投影读取 SQL | 108 次 / 186 ms | 3 次 / 70 ms |
| 后续 fresh 原件读取 | 108 次 / 6,340,788 bytes | 108 次 / 6,340,788 bytes |

SQL 累计包含三次请求，可能包含后台队列检查，不等于单请求关键路径。改前 CPU 7.80 秒采样中 idle 6.01 秒，支持数据库往返是这一小负载的主要问题。Windows 共享机器上三次 warm 样本最大值只是本次小负载的 P95，不替代正式性能分布。

证据位于 `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-wait-preparation/`：`01-baseline.*` 保留 RED，`01-cpu-summary.json` 为原始 CPU 汇总，`02-batch.*` 保存同阈值 GREEN、完整 SQL 和 raw 计数。

## 接口和不变量

- `waitInputBatch(client, identities, full)` 一次查询已有投影，在同一事务中按 100 项写入新投影。`read(identityWithVerifiedBytes)` 的 bytes 必须来自本次已验证原件，`flush()` 必须在 COMMIT 前调用。完整重算不读取旧投影；算法版本、内容键、单项 `waitInput` 接口保持原语义。
- `eventOriginsBatch(q, snapshotIds, materialId?)` 一次读取选中来源的有效归属，原始与副本本地行号保持区分。单项 `eventOrigins` 保留包装，材料查询仍限于指定材料。
- `verifySnapshotsIntegrity(q, raw, snapshotIds, unavailable?)` 批量准备事件 ID，将缺失证明的失败映射回每个受影响的已选副本。既有证明扫描仍每 1,000 个事件一组；旧数据修复仍使用原有逐目标上限。单项证明、材料证明、全局后台修复和可选故障回调继续保留。
- `waitDataset` 在每次请求中以最多 4 个读取任务验证原件 SHA。这里只在本次准备过程中暂存 bytes，不存在跨请求原件缓存。故障分来源保留，存储之外的异常仍向上抛出。
- 所选原件仍受 20,000 个 / 128 MiB、100,000 条消息和原有响应上限约束。来源大小、恢复链、材料归属、同员工全部项目/Agent 并行上下文、未知来源与日期语义不变。固定版本继续返回冻结结果。

## 验证

`04-semantics.txt`：10/10 公开语义回归通过，涵盖等待边界、跨午夜、重复/晚到、全量重算、原件 hash/missing 故障、恢复副本归属、材料、旧完整性账本与固定历史。

`06-batch-boundaries.txt`：101 个原始来源跨 100 项写入边界、恢复副本、旧账本缺失证明、故障传播、恢复、迟到新增与固定历史通过。预证明迁移状态只用最小 ledger fixture 安排，结果全部从公开 HTTP 断言。`05-batch-boundaries.txt` 保留测试设计中范围选取过窄的失败，不作为产品 RED；性能 RED 是 `01-baseline.txt`。

```powershell
$env:SKYNET_TEST_POSTGRES_BIN = 'E:/GenCode/Skynet-tools/postgresql-18.6/bin'
$env:SKYNET_OPENSSL = 'D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH = 'D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME = 'E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
node --import tsx --test --test-concurrency=2 tests/waits-public.test.ts tests/waits-edges.test.ts tests/source-isolation.test.ts tests/evidence-integrity.test.ts
node --import tsx --test tests/wait-preparation.test.ts tests/waits-journey.test.ts
$env:SKYNET_WAIT_PREPARATION_EVIDENCE = 'E:/GenCode/Skynet-evidence/v2-2026-10-04/54-wait-preparation/local.json'
$env:SKYNET_WAIT_CPU = '1'
node --import tsx tests/wait-preparation-performance.ts
```

性能脚本显式运行，不进入默认 `*.test.ts` 扫描。3,000 / 1,000 ms 正式性能目标没有放宽，没有部署或开启生产工作进程。
