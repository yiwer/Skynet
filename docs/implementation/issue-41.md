# #41 会话产效与有证据的复盘

公开原件上传 → 固定用量及洞察 → 会话产效 → HTTP / OAuth MCP / Web / 导出形成同一条路径。Web 入口为 `#efficiency`，复用产品主题、三种日期范围和员工 / Agent / 项目筛选。

## 行为与边界

- `GET /api/session-efficiency`、`GET /api/session-efficiency/export`、`POST /api/session-efficiency/recompute`；OAuth MCP `read_session_efficiency`。读取权限沿用个人读取凭据及 `archive:read`，设备凭据不具备读取权限。
- 会话按逻辑会话聚合所选归属片段。Token 为已知 input + output，任一片段未知则总分母未知；已知部分单独保留。产效为已验证结果数 / Token × 1,000,000，代码产出为实际增删行数 / Token × 1,000,000。原始分子分母同时返回，未知与零分母不计算比值。
- 同类任务分布仅对任务类型已知、分母有效的会话计算中位数、范围和真实散点。未知独立计数；图表有等价表格，散点可用键盘选中会话。
- 值得复盘条件严格为：Token 高于所选范围已知 Token 的 P75 且已验证结果为 0；或声称多于已验证；或非首条返工不少于 2 次。P75 使用线性插值，等于阈值不入选，未完成推断不当作 0。
- 首条与非首条复用固定原件消息身份，合并 native message 的多个文本块；压缩、截断、改写或未能证明历史起点时，返工保持未知。模型不能重建丢失的首条边界。恢复材料保持原员工 / 项目 / 日期归属。
- Agent 活动仅来自配对的原生 turn started / completed；等待回复复用统一等待算法并固定 `waitVersion`。区间按北京时间所选日期裁切，不把尾部空闲补作活动或等待。未完成轮次、无法识别的原件记录或采集缺口使总活动时长未知，但保留已知片段。当前来源不能证明权限等待时显示未知。
- 时间详情保存每个区间的证据，回到原始对话时携带固定等待版本。报告追加式保存，重新计算生成新版本，历史读取与导出不改写。
- 会话列表每页 20 条，全局排序后分页，未知值始终置后。后续页必须指定同一 `version`；范围不一致返回 409。默认每会话返回前 5 个时间片段；使用 `version + sessionId + segmentOffset` 每页读取 20 段，`segmentTotal` 与 `nextSegmentOffset` 说明完整范围。导出保留所有片段，100 轮 / 199 段会话经公开入口验证。
- 普通响应上限 80 KiB，完整固定导出上限 16 MiB；超过范围明确返回 413，不截断为看似完整的结果。页面按固定版本分页装载时间片段。
- 页面外部固定，内容独立滚动；筛选与下拉继承平台主题。指标定义折叠展示，未知有具体数据原因。320 / 768 / 1280 / 1920 明暗主题均验证，页面控件和散点命中区域至少 44px。

## 公开验证与复现

`tests/session-efficiency.test.ts` 五条公开 HTTP 用例覆盖 21 会话分页及未知排序、跨周裁切、未识别缺口、100 轮完整分段分页、严格 P75 / 三类复盘条件 / 原件首条排除 / 截断边界、原生轮次等待及历史固定结果。

`tests/session-efficiency-public.test.ts` 使用隔离 PostgreSQL、官方 Claude Code 2.1.281 运行时和 loopback 合成模型边界，经产品分析入口得到固定结果。验证 HTTP、OAuth MCP、导出等值，浏览器实际 JSON 下载、筛选、全局排序、键盘散点选择、原句链接、16 张顶部及详情响应式截图；不调用付费提供商或导入个人会话。

```powershell
$env:SKYNET_TEST_POSTGRES_BIN='C:/Users/yiwer/AppData/Local/Temp/ticket28-pg-0eb735e987dc48d186870e8a96801e01/bin'
$env:SKYNET_OPENSSL='D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH='D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME='E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
node --import tsx --test tests/session-efficiency.test.ts tests/session-efficiency-public.test.ts
```

外部证据：`E:/GenCode/Skynet-evidence/v2-2026-10-04/41-efficiency/`。有效 RED / GREEN 包括 `03` → `05` 公开缺失接口、`07` → `09` 复盘条件、`11` → `13` 原生时间、`18` → `20` 相同内容稳定版本、`22` → `23` 未知缺口、`24` → `26` 散点交互、`27` → `28` 长会话分页、`32` → `35` 截断首条边界；部分前置执行失败属于 fixture / 构建准备，不作为产品 RED。

已合入独立验收的 #42 集成提交 `3c51f7e`。最终集成构建 `36-integrated-build.txt` 通过；六项公开回归 `37-integrated-public.txt` 为 6/6，通过耗时 70.06 秒。`public-final/` 保存该次 16 张截图及固定报告。该验证不替代 #54 的千会话性能与完整发布验收。


独立复核补充：截断后追加完整原生轮次曾错误返回总活动时长 168,000ms；公开复现 `independent-truncate-timing.txt` 为 RED。现保留已知 Agent 60,000ms / 回复 108,000ms，同时记录“历史起点无法证明”的无时间缺口，总活动时长为未知。正式两条计时用例 `40-truncate-timing-green.txt` 为 2/2（29.48 秒），包含未截断与截断后追加、固定历史完整导出。合 #45 后构建 `38-assessment-merge-build.txt` 和 HTTP/MCP/Web/实际下载旅程 `39-assessment-merge-public.txt` 1/1（21.52 秒）通过。
