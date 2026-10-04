# #45 一名员工可展开核查的使用能力评估

对应 PRD-v2 第 7 节、US 135/137/140/141/142/144/147/149/150/160/163/165/170 与 AC-34/35/36/38。本票开放接入至今、默认方案的一名员工画像；其他范围、方案及历史对照界面由 #46 接续。所有实现验证使用合成上传与固定的外部 Analysis 响应，不读取真实员工正文，不调用付费模型，不代替 #52 的模型校准与发布确认。

## 公开路径

- Web：登录后选择“员工”，进入 `#profile?employeeId=<id>`；选择员工按姓名排列。`&version=<sha256>` 可固定旧评估。
- HTTP：`GET /api/assessments/:id`、`GET /api/assessments/:id/export`、`POST /api/assessments/:id/recompute`。读取凭据可用；设备凭据和未认证请求不可读取。
- OAuth MCP：`read_assessment({employeeId,version?,inputOffset?})` 和 `read_assessment_model({version})`。结果与 HTTP 共用服务、版本和证据。
- `GET /api/assessment-models/:version` 读取完整参数；`GET /api/assessment-baselines/:version` 读取固定任务基线与输入样本。画像“计算规则与版本”可导出这两份文件。

结果中分析及洞察版本各按 32 项分页，`inputPage` 提供两类总数和 `nextOffset`。后续页必须携带同一 `version` 并将 `nextOffset` 作为 `inputOffset`；两类数组长度不同仍按同一 offset 分别继续。分数、模型和输入范围不随分页变化。完整导出保留全部引用，不静默截断；一般样本的一页读取、MCP 和完整导出逐字段相同。

## 计算与归属

`assessment-inputs.ts` 一次取得全团队固定用量与等待版本，再通过 `insights.readVersions` 读取已固定洞察；不逐员工重复准备原件。共享服务的当前读取仍核对原件哈希，评估层不另建原始材料扫描或 Token 协议。业务活动日期使用 `UsageEmployee.activeDates`，纯 Token 元数据日期不增加活跃天数；工作日按北京时间周一至周五计算。

`assessment-factors.ts` 把逻辑会话的项目切片按员工合并，提示词和回复按原始 eventId 去重。引用必须能唯一落在同一员工、接入后、所选来源日期中。复制历史、重复上传、恢复链和旧载体不产生新提示词、会话或产出。任务基线把同一逻辑会话的员工贡献合并，避免接续链重复成为多个团队样本。

首条/非首条边界还需当前原生叶子的 `messageHistoryComplete === true`。该共享确定性事实来自 #42 的服务器核验历史链；截断、改写、压缩及其后续追加不能凭模型的 `first` 标志重建已丢失的起点。边界未知时，首条要素覆盖、返工率、无返工会话占比均未知，首条/非首条样本只统计起点可信的会话；实际观察到的会话和提示词仍保留。旧固定洞察缺少字段时也不推为已知；固定旧评估保持原样可读。

完整实现 13 项指标、6 个维度及 PRD 固定锚点。单项原值未知和样本不足分别表示，不用零填补；维度取可计分项平均，再按默认权重 20/20/20/20/15/5 加权，缺失维度权重比例重分配。综合指数先取整再按 72/60 分档；低可信度等级待定。会话/提示词数量决定基础可信度，真实采集缺口降一级；未知 Token 本身不冒充采集缺口。误差为估计值 `round(26 / sqrt(N))`，无会话时指数与误差为空。

已结束样本需要所有当前原生叶子的最后一轮均为 `waiting-input`。它只说明当前处于轮次之间，不声称会话永久结束；后续 `task_started` 即移出已结束样本。缺少原生轮次边界时产出指标为未知，已知仍在进行中的样本不足则保持样本不足。已验证结果均值基线下限为 0.5；无有效同类产效比或中位数为零时不计该项。Token 为零不能作为产效比除数。

权限请求/决定时刻在当前支持的原生材料中不能完整核对，故权限等待中位数保持未知。等待回复采用 #37 固定区间，排除已观察到同员工其他逻辑会话活动的等待；边界或并行覆盖未知则不生成确定比率。正式客户端“待信任”状态尚无现行公开事实来源，不把“首次事件待确认”误当待信任；后续接入事实需由该字段的生产者提供并加入覆盖版本。

强项与优先项最多各两个；理由保留低于 60 分的维度总数。建议来自整体版本化的固定库，需求表达选择出现率最低的要素。最佳示例和返工较多会话可以下钻原件。团队维度中位数只作视觉参照；产出转化按规格使用同任务类型的实际团队基线，其余维度不受同事分数影响。

## 固定版本

`assessment_models` 保存整体参数，包括锚点、门槛、三个方案定义、分档、可信度、误差、固定建议和基线口径，当前标为 `initial-parameters`。本票界面只提供默认方案。`assessment_baselines` 保存任务均值/中位数、样本及其洞察版本；`assessment_revisions` 保存评估结果，均为追加写入。

每份结果绑定模型、基础指标、用量、等待、分析、洞察、基线、采集覆盖及员工接入后的北京时间范围。生成时间以 UTC 存储，在页面明确按北京时间显示。迟到原件、原生状态变化、重新分析或团队基线变化生成新版本；相同输入复用原生成时间。固定旧结果和基线在新输入到达、显式全量重算、服务重启后仍可读取，异步旧分析不能覆盖新评估。

跨服务组合使用 `reporting-frontier.ts` 的 `consistentReportingInputs(db, clock, read)`。在完整组合读取前后，分别以可重复读事务取得原件集合与 SHA-256、清单和谱系、批量归属修订、最新分析及适用目标、实际输入完整性、员工/设备/接入日期、真实缺口和北京时间日期的语义指纹。两端相同才绑定 `inputs.frontierVersion` 并保存组合评估；变化则从头读取全部输入，最多三次，仍在变化返回 409。它不以相近墙钟、原件数量或组件生成时间替代输入一致性；包含尚无业务事件的原件，也不把心跳时间或派生缓存写入当作输入变化。旧结果可不含该字段，固定版本读取仍原样返回。组件自身的有效固定版本可以独立保存，但未通过核验的组合结果不会发布。

## TDD 与公开验证

测试 seam 沿用 PRD 的 2026-09-28 用户确认：合成设备公开上传 → Reporting/Evidence、公开 Analysis 请求/外部执行边界、HTTP/OAuth MCP/Web。没有通过数据库查询断言评分；数据库用于隔离工作器配置，以及在跨服务并发测试中安排真实数据库发布边界的交错。产品正确性全部通过 HTTP 与固定导出断言，模型响应由测试外部执行器确定。

RED 依次验证缺少评估入口、只有空分数、缺少 MCP/画像、未知 Token 被误当采集缺口、原生结束边界未知被误记为样本不足、无会话仍显示空维度、纯 Token 日期被误算为活跃日、固定输入分页尚不存在。GREEN 覆盖：

- 6 维 13 项、锚点两端及上下截断、未知权限、任务基线下限/零中位数、缺失维度重加权、固定建议与代表性会话。
- 独立手算样本 `71.4 → 71/一般`、`71.5 → 72/较好`；使用真实整数 Token 记录改变团队基线，其他维度不变。
- 2 条首提示词不足与第 3 条达标；零结果的 0.5 轮次除数；采集缺口高可信度降为中；未知来源与真实零值不同。
- 恢复后只有新 `task_started`、没有新增业务消息也会更新当前叶子；结束后增量与全量相同，历史前缀不增加提示词或会话数。
- 35 项输入引用跨页无遗漏/重复；后续页要求固定版本；HTTP/MCP/完整导出一致；旧评估和旧基线冻结。
- 真实公开上传发生在用量读取与等待读取之间，以及原件数量不变但分析在读取期间完成，两种交错均先在旧实现失败，再经完整输入核验通过；固定等待引用必须属于同份用量输入，新分析必须进入该份评估，随后全量重算和历史读取相同。
- 截断原件先通过公开上传复现首条被错误计分，再核对首条/返工/无返工为未知；继续追加仍不恢复已丢失的起点，已知样本数、历史版本和全量重算保持正确。
- 真实 HTTPS OAuth/PKCE、浏览器登录、明暗主题 1440/390/320、低于 60 分维度默认展开、对话证据跳转、参数与基线下载、无会话空状态。外层文档不滚动，内容区内部滚动。

测试入口：`tests/assessment-public.test.ts`、`tests/assessment-model-public.test.ts`、`tests/assessment-journey.test.ts`、`tests/assessment-concurrency.test.ts`、`tests/assessment-history.test.ts`；合成 fixture 在 `tests/assessment-fixture.ts`。可复现命令：

```powershell
$env:SKYNET_TEST_POSTGRES_BIN='C:/Users/yiwer/AppData/Local/Temp/ticket28-pg-0eb735e987dc48d186870e8a96801e01/bin'
$env:SKYNET_OPENSSL='D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_ASSESSMENT_EVIDENCE_DIR='E:/GenCode/Skynet-evidence/v2-2026-10-04/45-assessment'
npm run build
node --import tsx --test --test-concurrency=1 tests/assessment-public.test.ts tests/assessment-model-public.test.ts tests/assessment-journey.test.ts tests/assessment-concurrency.test.ts tests/assessment-history.test.ts
```

原生 fixture 的 wire 名称和持久化范围核对官方 [Codex 0.157.1 protocol.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.157.1/codex-rs/protocol/src/protocol.rs) 与 [rollout policy.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.157.1/codex-rs/rollout/src/policy.rs)，未发明不存在的权限原始事件。0.160.0 Token 与元数据支持沿用 #40 的已验证实现。

外部证据目录为 `E:/GenCode/Skynet-evidence/v2-2026-10-04/45-assessment/`，保存构建/公开测试日志、明暗截图、320px 规则展开截图和版本清单。性能 AC-32 不由本票签收，统一由 #54 完成。

在包含 #40 的集成 `91544e8` 上完成：构建通过、六项公开行为 **6/6 通过（101.21 秒）**，类型检查与 `git diff --check` 通过。目视核对 1440 浅色、320 深色及 320 深色规则展开截图，未见外层溢出、遮挡或换行截断。记录仅说明上述合成公开行为，本票未部署、推送或关闭远端 issue。

独立审查随后发现初始候选 `73da7f0` 的跨服务输入交错缺口；该候选未据此视为完成。补充真实并发 RED 后修复语义输入核验，并接入 #42 独立验证的历史边界事实。最终包含集成 `3c51f7e`（#39、#42），评估相关公开回归 **9/9 通过（148.83 秒）**；新增两类并发与截断/追加回归，原有六项继续通过。最后一次集成只带入提示词图表触达范围、文档和对应测试，没有改变已验证的评估代码。最终证据见 `final-repaired-public.txt`、`final-repaired-build.txt` 与 `final-repaired/`，旧 RED 与独立审查记录保留。
