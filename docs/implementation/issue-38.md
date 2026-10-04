# #38 会话分析与原件产出

本票扩展现有 `analysis_jobs`、Claude Code Worker 与逐字引文验证链。分析材料仍是不可信的历史原件；没有增加第二套模型运行器。`original-segments-insights-2` 提示版本进入配置哈希，旧 generic 结果保持可读，缺少 V2 字段时显示待生成新版分析，不自动转成零。

## 公开路径

1. 通过既有设备接入、分块上传、快照提交契约保存原件。
2. 通过 `POST /api/snapshots/:id/analysis` 提交分析；既有独立 Worker 领取有界任务。
3. `GET /api/snapshots/:id/insights` 与 OAuth MCP `read_session_insights` 调用同一个 `sessionInsightsService.read`。响应含推断、指标、原件计数和版本。后续报表可直接使用该服务和 contribution；不从 Web 反推数值。
4. `?version=<响应 version>` 读取追加式 `session_insight_revisions` 的固定视图；`?analysisId=<任务 ID>` 读取指定分析。版本不跨快照或分析身份，旧任务迟到完成不取代新输入的结论。
5. 会话侧栏的“会话洞察”显示任务类型、已验证/仅声称、返工、追问及逐提示词的四要素。结果、建议、原件计数与版本按需展开，原文链接定位到不可变输入的精确行/UTF-16 位置。系统已有侧栏单独滚动；没有新建外层滚动区。

## 结构与证据

`session-insights-1` 包括七种任务类型和 unknown、每条真实用户消息的目标/约束/上下文/验收、返工、每条 Agent 消息的澄清判断、成果与写法建议。系统/开发者消息和完整机器环境封套不算提示词。每个非未知任务类型和每项推断须携带逐字引用；提示词和追问还必须引用自身对应的角色事件。写法建议始终标为模型推断。

`verified` 要求结论文本与唯一引用的工具结果文本逐字相同；请求、用户/Agent 自述、无关工具输出都不能取得该状态。自述降为 `claimed`，其余不能确认的关联降为 `inferred`，保留 `classificationAdjusted`。模型只选择与解释事实，不计算确定性的代码/测试/提交计数。

每段引用映射回原始 event/UTF-16 偏移并通过原有归属与引用校验。分段结果按事件身份合并，保留全部可处理提示词和追问；冲突判断为 unknown。被切开的巨型提示词不能证明某个要素“没有”，只能保留有证据的出现或 unknown。漏段、失败段、缺 V2 输出、缺消息或大小上限不能形成完整会话计数。`pending`、`failed`、`legacy`、`stale`、`partial`、`unavailable` 与已完成的零明确区分。

## 原件计数

`recorded-output-4` 只处理已证实归属的接入后原事件，按 `origin.eventId` 去重。每项贡献携带原事件身份、员工、来源日期和源快照，后续跨快照聚合须再次按该身份去重，不能直接相加多个快照的总计。历史上下文不贡献新产出；未知归属不贡献猜测值。支持的原生记录版本为 Codex CLI 0.157.1 / 0.160.0、Claude Code CLI 2.1.281；其他来源或版本保持未知。

- 代码变更是原件中成功的 apply_patch 增/删行、Claude Edit 的 old/new 实际行差异，以及明确“创建文件”的 Write 文本行。Edit 用有界 Myers 最短编辑距离排除共同上下文，超过 20,000 总行或 200,000 步保持未知。Delete File 缺少旧文本、replace_all、覆盖式 Write、缺工具结果等保留未知或已知部分；不把调用意图当成应用成功。
- 测试只从执行工具的原生结果摘要解析：Node TAP `# tests/# pass/# fail`、Jest `Tests:`、Vitest `Tests … (N)`、pytest 终结摘要。只认单个一致摘要；未支持、重复/含糊、缺结果、纯自述不填零。
- 会话内提交需要直接 git commit 执行记录与匹配的原生提交哈希输出；不是通过 Agent 文本或外部仓库查询推测。
- 完整且受支持、可确认没有该类记录的范围为已知零。未知行、未闭合末行、关联材料、采集缺口或未知归属使完整性降级。每项保留 `complete`、有限原文引用与完整有界 contribution。超大响应明确拒绝，不静默截断计数。

## 验证与复跑

测试沿用 PRD Testing Decisions 2026-09-28 已确认的公开上传/查询、Web/MCP、Analysis 外部边界。`tests/session-insights.test.ts` 用固定外部推断运行真实队列、分段、验证、持久化与公开查询；没有直接向结果表写入测试结论。`tests/native-session-insights.test.ts` 另经实际隔离 Claude Code 2.1.281 进程连接合成 Anthropic loopback，验证真实 StructuredOutput 传输、引用、重启后固定版本、OAuth MCP 等值与浏览器交互。

本轮使用显式的 PostgreSQL 18.6 / OpenSSL / Git Bash / Claude EXE 环境变量，不改系统安装、用户凭据或个人 Agent 配置。命令：

```powershell
$env:SKYNET_TEST_POSTGRES_BIN = 'C:/Users/yiwer/AppData/Local/Temp/ticket28-pg-0eb735e987dc48d186870e8a96801e01/bin'
$env:SKYNET_OPENSSL = 'D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH = 'D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME = 'E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
node node_modules/tsx/dist/cli.mjs --test tests/session-insights.test.ts tests/native-session-insights.test.ts tests/analysis.test.ts tests/analysis-long.test.ts tests/analysis-queue.test.ts
```

本票没有启用生产分析 Worker、读取员工材料或调用千问 PAYG。真实运行时的合成 loopback 验证与真实提供商/试点签收分开记录；部署与远端 Issue 状态由集成流程处理。

### 2026-10-04 验证记录

已合并 `codex/v2` 的 `0044f3a` 基线；合并回归 16/16 通过，包括 Analysis、长会话、队列、Conversation 和 Metrics。最后的原件计数修正后，公开分析测试 4/4 与真实 Claude 测试 1/1 再次通过；`npm run build` 通过。

固定证据位于 `E:/GenCode/Skynet-evidence/v2-2026-10-04/38-analysis/`：`final-tests.log` 是合并回归，`final-public-regression.log` 是最终公开边界回归，`native-stable-layout.log` 是最终真实运行时、OAuth MCP 和 Web 验收。Edit 实际行差异、原事件去重、重复/混合测试摘要各有对应 RED/GREEN 日志。`native-final/insights-native-evidence.json` 保留合成请求、真实 Worker 结果与运行记录。

`native-final/` 包含 320、768、1280 宽度的明暗主题稳定截图及窄屏洞察面板截图。截屏完成有限动画后，测试确认桌面导航在视口内、关闭的窄屏抽屉完全移出视口、页面无外层滚动，并通过区域内部滚动访问窄屏洞察。页面支持键盘折叠和展开。旧的过渡中间帧截图不作为视觉验收依据。
