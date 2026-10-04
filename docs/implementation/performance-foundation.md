# 批量指标输入：性能基础修复

本补丁辅助 #54，不代表 AC-32 完成。用户确认的目标保持为 10 名员工、近 4 周 1,000 个会话，各最终报表、活动和画像首次读取 P95 ≤ 3 秒、后续 P95 ≤ 1 秒。本轮只测基础指标的一个首次读取样本和连续后续读取；后续读取尚未达标，不关闭 #54。

## 复现与变更

合成数据经公开分块和快照上传接口进入：10 名员工、1,000 会话、80,000 业务事件、20,000 用户轮次、20,000 工具请求、输入 Token 2,000,000、输出 Token 500,000。没有直接写业务表、读取真实员工原件或预先 ANALYZE 表。原始诊断约 20.5 MB 的 Codex 0.157.1 数据覆盖四周。

公开 RED 的首次读取为 14,869 ms；相同原始诊断的首次/第二次为 13,465 / 13,973 ms。EXPLAIN 显示每个快照的标量归属表达式各自扫描 80,000 条 `event_integrity`，共 1,000 次。新批量查询将该扫描降为 1 次。随后去掉 1,000 次投影读取和逐项写入，并减少查询返回的无用事件字段。

保留的变更：

- 一次取所选快照的归属版本，保留 base 与 effective 事件并集、资格最大 revision、完整性最大 revision 和本快照 override 最大 revision 之和。
- 派生原件投影一次批量查询，新投影按 100 项批次写入；同次解析的 evidence 用于完整性判断，避免重复解析原件。
- 每个候选原件在使用投影前仍调用 `raw.read`，验证可读性与 SHA-256。完整重算绕过已存投影；历史结果保持追加式、按原版本读取。
- 后台修复先检查持久队列中是否存在无效证明；为空时不联结所有原生记录。部分索引仅覆盖无效证明，有待修复记录时仍走原有修复和原件验证逻辑。
- 保留既有 `effective_event_origins` 规则。探索性改写该视图的报表查询没有稳定收益，未纳入补丁；没有增加整个筛选范围的结果缓存。

## 后续调用约定

`apps/server/qualification.ts`：

```ts
attributionRevisions(q, snapshotIds: string[]): Promise<Map<string, string>>
```

调用方先确定有界、已授权的快照集合，传同一个事务连接。每个返回值与原 `attributionRevision(q, id)` 的三项最大值之和相同；单项 API 保留。报表计算使用 repeatable-read，不把事务前后两个批次当同一输入。

`apps/server/metric-inputs.ts`：

```ts
metricInputBatch(client, identities, full): Promise<{
  read(identityWithVerifiedBytes): MetricInputFacts;
  flush(): Promise<void>;
}>
```

Identity 包含 `snapshotId`、`attributionRevision`、`hash`、`source`、`sourceVersion`，可选 `materialId` / `manifest`。`manifest` 只由已存主原件传入，材料不冒充主原件；本补丁不改变原生版本或初始用量基线支持。调用方必须先验证原件再 `read`，在同一个事务 COMMIT 前 `flush`。`full=true` 跳过持久投影，事务内重复计算可复用本次结果；数据库并发冲突交由原指标事务重试，不能当作原件缺失。

仍使用单项归属表达式的入口，需要在各自公开边界下逐项改造，不能因本补丁通过就视为批量验收通过：

| 入口 | 后续注意事项 |
| --- | --- |
| `wait-dataset.ts` | 当前在原件循环内取 revision；等待/活动汇总应复用批量接口，保留恢复链与原归属。 |
| `session-insights.ts` | 单会话读前后分别检查归属；#40 的 readMany 需同一批输入和版本，不循环调用 1,000 次单会话 read。 |
| `analysis.ts` / `analysis/queue.ts` | 包含任务陈旧性检查、目标刷新和候选任务选择；多目标队列不能直接复制报表接线，须保留晚到结果与重试规则。 |
| `archive-query.ts` / `conversation.ts` | 单快照前后检查仍有用途；批量调用时需重新审视事务和原文锚点一致性。 |

#40/#45 已收到以上接口；#39 活动应从共同输入准备计算，避免再做逐会话归属/原件重扫。

## 验证和剩余项

在已合入 #35/#37/#38 的集成基线上，`npm run build` 与 11 项公开语义回归通过：Metrics、增量指标、材料资格和证据完整性。测试覆盖归属晚到、损坏字节、合法重写、恢复前缀、原件存储故障、已知零/未知、并发范围、全量重算和固定结果。材料资格的浏览器测试同步为当前产品导航：进入时间线，再使用“采集来源”原文链接；没有修改产品 UI。

严格性能回归为显式命令 `npm run test:metrics-performance`，不在默认 `npm test` 扫描范围内。该命令保留 3,000 / 1,000 ms 断言；目前应视为未完成验收，不能通过放宽阈值取得 GREEN。全部测试只创建自有 PostgreSQL 沙箱。

```powershell
$env:SKYNET_TEST_POSTGRES_BIN = 'C:/Users/yiwer/AppData/Local/Temp/ticket28-pg-0eb735e987dc48d186870e8a96801e01/bin'
$env:SKYNET_OPENSSL = 'D:/DevEnv/Git/usr/bin/openssl.exe'
npm run build
node node_modules/tsx/dist/cli.mjs --test tests/metrics.test.ts tests/metrics-incremental.test.ts tests/material-qualification.test.ts tests/evidence-integrity.test.ts
npm run test:metrics-performance
```

证据目录：`E:/GenCode/Skynet-evidence/v2-2026-10-04/`。`performance-public-red.*` 为公开 RED；`performance-bulk-plan.json` 保存一次完整性扫描的计划；`performance-correctness-final.log` 为 11/11 语义回归；`performance-foundation-final.json` 保存最终数据集、环境、全部时延与 P50/P95。中间 SQL/CPU 诊断仅保存在该目录，没有调试日志或性能探针进入服务代码。

最终采样服务代码对应 `4096511`，已经集成 #35/#37/#38（最新文档基线 `526e1ea`）。Windows、Node 24.21.0、PostgreSQL 18.6，i5-13500H / 16 逻辑 CPU / 34.1 GB 内存；没有为本次采样独占机器。全部 11 次读取的上述五项总计正确：

| 条件 | 样本数 | 实测 |
| --- | ---: | ---: |
| 首次读取 | 1 | 4,199 ms（不能称首次 P95） |
| 后续读取 P50 | 10 | 2,180 ms |
| 后续读取 P95 | 10 | 3,284 ms |
| 原件上传阶段 | 1 | 43,875 ms |

这组最终结果没有达到确认的目标。中间诊断曾测得首次约 2.9–3.3 秒、单次后续约 1.5–1.8 秒；最终集成后的读取和上传均更慢，现有证据不能把差异确定归因为集成行为或共享机器负载，不能择取较快的中间样本宣称完成。完整 AC-32 仍需受控条件下的重复首次样本，以及全部最终报表、活动和画像的测量。

后续成本包括完整事件查询、组装和输入哈希。任何范围结果复用必须继续验证原件可读性/哈希、归属变化、元数据和所有相关输入，不能只以快照数量或过期时间判定有效。#54 应在各最终业务查询完成后统一测量和优化。
