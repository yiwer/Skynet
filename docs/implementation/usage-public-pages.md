# Usage 公开分区读取（V2 #54 容量第二片）

原量合成范围为 10 员工、4 周、1,000 会话、80,000 业务事件、19,000 等待段和 20 个已分析会话。此前 `/api/usage-output` 虽只截会话为 20 行，却仍携带全部员工每日数据等集合，首读稳定返回 413。本片只改变公开传输投影和 Web 读取，不改变领域计算、固定版本身份、原始字节验证或完整存储。

## 公开合同

`UsageOutputPage` 保留为已有完整内部值；`usage.complete`、其它报表组合及 `/export` 继续使用它。新增 `UsageReadingPage` 带 `readingVersion: usage-page-1`，HTTP 与 `read_usage_output` 使用同一个投影。

- `totals`、`outputs`、来源完整性、版本与范围均描述**完整固定结果**；数组是否已读全只能看 `pages[section]`，不能使用数组长度或顶层 `nextOffset` 推断其它集合完整。
- 八个固定 section：`sessions`、`employees`、`daily`、`dailyOutputs`、`employeeDaily`、`employeeActiveDates`、`employeeUnknownReasons`、`unknownReasons`。每区给 `total/offset/nextOffset`。
- 员工 summary 保留完整合计、五类产出及最多三类 Agent 合计；每日点、活跃日期与原因按 employeeId 放在独立扁平 section。它们不再重复进入员工行。
- 显式 section（包括 offset=0）必须携带 version。无 section 的旧 offset 仍代表 sessions；后续 offset 同样必须固定 version。日期、员工、来源、项目与固定周仍经原完整版本范围校验。
- 正常默认页先分配会话至多 20 项、其它集合至多 100 项，再按实际 UTF-8 JSON 与 MCP 文本 envelope 收缩到 **32 KiB / 48 KiB**。未获空间的非请求部分可为 0 项、nextOffset=0，继续读取时必须固定 version。请求部分有数据时至少推进一项。
- 单条会话本身不能容纳时明确返回 413，并给固定版本、section 和 offset；不删 snapshotIds、原句来源或 insightVersions。完整固定导出仍保留全部引用。已有 16 MiB 存储/导出边界、原件数/字节限制完全保留。
- 完整值及 version 未变。旧固定完整 payload 读取时才投影，不重写历史。重算不能带旧版本或分页部分。

## Web

图表只从首响应的固定 version 收集 section；不再为画图自动调用 `/export`。分区数、顺序、版本和 offset 均核对后才发布完整图表；中止和晚到响应不能写入新范围。KPI 可先展示完整合计，集合仍在加载时不显示为零。员工 Agent 条使用已有完整 Agent 合计；会话散点保留全部团队参照。会话表在已完整读取的选中集合内每页 20 行，最后一页和键盘返回已覆盖。用户主动导出仍走原完整下载路径。

保留相同 hash 导航幂等修复。用量页筛选、图表切换、口径、分页及表格链接统一至少 44px；320/390/768/1280/1920 明暗模式均为内部滚动。

## 已确认公共 seam 与证据

沿 PRD 已确认的公开上传、HTTP、真实 OAuth MCP、下载和 Web 边界验证；仅使用自有隔离原件/数据库和合成模型输出。外部证据在 `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-usage-pages-*`。

- `usage-pages-capacity.test.ts`：原 413 RED → 有界首页 GREEN；同一 1k/80k/19k 原量的八分区 HTTP/MCP 完整重组逐字段等于既有完整固定 export；最大实测 MCP envelope 36,349 B。1,000/20,000/2,000,000 输入/500,000 输出合计不变；20 已验证、980 未知不变。选员工保留 100 selected + 900 参照；非法版本范围、section0无版本、越界页、迟到、全量重算、重启及旧版读取均验证。全部链 64.96 秒（功能测试，不是 AC32）。
- `usage-output-public.test.ts`：旧 Web 误把首屏当完整的真实浏览器 RED → 分区读取 GREEN；真实隔离 CLI 分析、OAuth MCP、固定完整导出、图表/表格/键盘仍一致。
- `usage-pages-web.test.ts`：27 会话，故意延迟旧版本分区后切换员工；新范围保持 5 选中/22 参照，另员工会话表末页 2 项；无自动 export、无页面错误。触控尺寸原 RED（32/24/36px）→ 44px GREEN，十种尺寸主题截图。
- `usage-pages-boundaries.test.ts`：真实更正改变当前洞察引用但不改旧页；自有原件缺失/哈希不一致使本人 unknown，健康员工完整、团队参照仍在，恢复后原结果全等。300 个深度一的已确认原件副本构成单条超大引用，明确 413，员工 summary 可独立读取，完整引用导出未丢。首版测试误构造 300 层链被既有 128 层保护正确拒绝，保留日志，未放宽该限制。
- 原 Usage 原生版本/恢复材料/归属公开用例和 V2 Web/MCP 旅程按新传输合同保留业务断言；下载比较完整固定 export，分页比较固定页，不再把它们误当同一 JSON 形状。
- 末轮原 CLI/Web 用例曾出现缺少一个参照；公开响应证实服务端也只有一个来源。只读核对自有失败 fixture：该合成 peer 原件时间 `15:55:08.581Z`，服务端接入 `15:55:08.587Z`，确实早 6ms，持久归属为 historical。修复样本前提为从公开返回的 enrolledAt 推导 +60s，并核对 after-enrollment；没有修改产品来源规则、等待阈值或参照断言。原失败与 `54-usage-pages-peer-source-diagnosis.json` 均保留；修复后真实 CLI/Web 全旅程 1/1 通过。

本片不解决会话产效的大结果存储、完整等待大下载或其它公开报表容量；没有调整 AC32 数据和 3s/1s 门槛，未作全入口 P95 通过声明。
