# #28 北京时间日报公开流程准备

状态：独立实现提交5399481已集成主线准备，尚不代表 #25/G3、#28 或 V1 验收通过。没有真实千问专用配置、模型、价格证据和预算，测试只使用隔离合成原件与显式 loopback provider。

## 公开链路与归属

- 北京时间每天 09:00 将前一自然日的已接入员工期间持久入队，首次部署不从旧会话回填多年日报；停机追补每批最多 31 日。入队不保证 09:00 已生成。每次后台轮询最多处理 10 个期间，按最近处理时间公平排队。
- 无需管理者逐会话申请：日报直接调用 `analysis.request(snapshotId,null,{trigger:'scheduled'})`，发起者是 system，来源员工仍由不可变 EventOrigin 决定。#24 的配置、generation、有限重试、预算与租约逻辑原样保留；只有 succeeded 且 applicable 的分析进入当前报告。
- 先冻结原员工、来源日期及 after-enrollment 的唯一 eventId，再选包含这些事件的不可变主原件。恢复到 B 的 A 旧活动仍归 A 原项目/来源日；B 新后缀只计 B。历史、未知时间/接入边界、仅保存的关联材料不被推为当天活动。
- 目标、主题、行动、成果等保留原分析分级与原句引用。只有本日、本员工及相应原项目的活动引用能支持本项；旧日期、历史材料和其他项目引用单独展示，原始 raw/material 锚点及 inputLocation 不互相换算。
- 相同项目的相同分析主题文本可跨会话呈现。单主题的事项归类显式标为推断；同一分析/项目出现多个主题时，不任意关联到首个主题。缺少类别不代表目标、成果或阻塞为零。主题质量仍须真实 G3 样本核查。

## 持久版本、统计与覆盖

- `/api/daily-reports`、`GET/POST /api/daily-reports/:employeeId/:date` 与 Web「日工作」使用同一服务。MCP `list_daily_reports`、`read_daily_report` 读取同一版本；翻页须固定 revision，旧版本可读，重启不丢失结果。写接口认证并拒绝客户端 trigger/身份声明，MCP 保持只读。
- 元数据事务使用 REPEATABLE READ；日报全局 try-advisory 锁避免多个报告占满共享连接池后等待嵌套分析。公开刷新递增持久 generation，忙碌时保留 refreshPending；较新请求触发序列化冲突时，旧事务回滚，由后台继续处理，不能覆盖新请求。原件与存档 ACK 不等待报告工作。
- 不可变版本包含原 eventId 集合散列、事件总量、输入 snapshot/hash、analysisId/configurationHash/parserVersion/generation 与原句。返回 eventId 的显式 sample，非完整清单。最多处理 10000 活动事件、100 个主原件，超界显示未完整处理，不无界读取文件。
- 基础记录、用户轮次、工具调用直接共用 `provenance.ledgerCountProjection`，按唯一事件与原件/材料行计数，和存档统计 activity 列一致。历史/关联上下文及未知单列；未确认复制可能重复，不把相同文字当同一活动。
- 原生 token、文件、活动区间、按日设备覆盖及人工工时保持 null/unknown；当前设备在线不能证明此前某日完整覆盖。完整统计与故障分类由 #31 接续，区间不会换算人工工时。
- 未解析行、未闭合末行、capture gaps、未分析关联材料或 #23 processing 不完整/失败/跳过/省略，均使日报 partial；成功任务不表示全文覆盖。报告保留处理范围概要并引用原 analysisId，失败或过时分析没有结论。没有本日引用时仍显示有定义的已知统计及材料不足，不把有效但不完整的分析误标成运行时不可用。

## 验证与失败记录

Windows Node 24 / 隔离 PostgreSQL 17、独立真实 Claude Code 2.1.281。没有付费请求、真实员工数据、真实用户配置、Desktop UI 验收或测试数据库篡改来证明日报归属。

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 合并 #24 应用提交 `06a9cfc` 后，分析、队列、日报、MCP、跨设备、材料独立资格与历史定向 **11/11**（19.49 秒）；证据 `gZjL1C`（queue）、`kTCeCE` / `RXtbrU`（主链与重写）、`ip5R8e`（history）、`IBXsuX` / `wtUc6L`（材料）、`kn5X5t`（OAuth MCP）。新增并发收敛后的日报 **3/3**（13.44 秒），包括八名员工同时公开刷新与持久队列排空。
- 实际原生日报 **1/1**（21.90 秒），`%TEMP%/skynet-test-zrbse8/daily-public-evidence.json`：8 个会话、2 个项目、24 个本日事项，20+4 分页；生产 scheduler 注入明确次日09:00时钟，从公开上传原件自动建期间和 system 分析，无 report/analysis POST；原员工→B恢复、新后缀、来源跨午夜、背景/未来引用排除、统计与存档一致、partial 覆盖、原件逐字节、持久旧版本、重启、OAuth MCP、Web 与可点原句均通过。注入时钟是确定性调度测试，不是实际等到第二天 09:00 的运营观测。
- 并发连接池/generation 收敛后，同一最新原生整链 **1/1**（61.00 秒、总进程64.68秒）再次通过，最终证据 `%TEMP%/skynet-test-u4wfh5/daily-public-evidence.json`；与并行任务共享执行机，保留更慢实测，不视为延迟/性能验收。
- 较早 `sZlCPK` / `zcwz2D` / `I6XlGH` 分别证明公开触发、生产调度与 24 项分页；它们在最终 partial/并发改动前，不替代最新证据。
- 初次 `giso03` 因测试错误假定原 raw 锚点返回解析 events 失败；修为 raw 文本与原引用校验，失败不算通过。`UxsgSm/daily-report-diagnostic.json` 暴露「有效分析但无本日引用」错误显示 unavailable；已改为 partial，保留该失败。没有重跑 Windows 完整安装套件绕过先前真实失败。

复跑：

```powershell
npm ci
npm run typecheck
npm run build
node --import tsx --test tests/daily-reports.test.ts tests/analysis.test.ts tests/analysis-queue.test.ts tests/mcp.test.ts tests/cross-device.test.ts tests/material-primary.test.ts tests/history.test.ts
$env:SKYNET_CLAUDE_RUNTIME='C:/Users/Administrator/.local/bin/claude.exe'
node --import tsx --test tests/native-daily-reports.test.ts
```

## 仍开放

#25/G3 实际千问模型质量、用量/预算条件与前置 G2，实际运营09:00与负载、完整长会话 #23 范围集成、周报/项目 #29、迟到材料/更正与受管理期间 #30、完整统计/覆盖 #31、备份 #32、五个工作日与负责人签收均未通过。#19 材料先作上下文、后在原设备正常独立采集时的活动资格分类仍属独立最终规格审查，不在本票中改写事件或旧报告。代码和 loopback 实测不解除 G0–G4。
