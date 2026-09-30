# #19 主会话与独立资格材料恢复后的历史归属与去重

2026-09-30。已打通一条完整的主会话 tracer bullet：员工甲设备 A 正常存档 → 服务器恢复包 → 员工乙设备 B 的隔离原生 CLI 恢复与续聊 → 再次服务器恢复包 → 员工甲设备 C 续聊 → HTTP / Web / MCP 核查原始员工、项目、来源日期、唯一活动及完整导出。

随后补齐了可获得正常宿主独立采集资格的 Codex parent / child / fork 材料历史归属，见文末“材料独立资格扩展”。**Claude 原生子代理的 agentId 与父 sessionId 不同，仍保持关联上下文，不能伪造独立主会话资格。G2 完整故障矩阵、三客户端完整 G0、真实模型、性能与 V1 发布验收不由本票的定向验证替代。**

## 主会话归属

恢复回执增加 `restoredFrom { snapshotId, hash, byteLength }`。采集后台只为回执中精确匹配的主原件路径、来源和会话 ID 提交此声明，不扫描其他会话。Windows 短路径经已有安全路径校验规范化；声明不是写入授权。

服务器在快照事务中核对本数据库已提交来源快照、来源类型、原生会话 ID、长度、SHA-256 与完整逐字节前缀。不存在、身份不同、字节缺损或篡改的声明返回 409。客户端不能提供员工归属；写入仍由有效设备凭据绑定。另一个服务器没有对应已提交快照时不能接受此声明。原件从不改写。

`archive_event_origins` 保存每个已确认事件的 `eventId`、原始员工 ID、设备 ID、项目、来源日期、接入前后分类及不可变原件位置；`snapshot_events` 记录该事件在每个版本中的位置。A → B → C 沿用逐事件来源，所以 A 与 B 的历史分别保留，不会把整个 C 文件改归 C。展示名称可变化，身份使用员工 ID，与本地用户名或同名员工无关。

同设备增长或仅材料变化沿用未变完整行的原始事件。Claude 原生 UUID、Codex 工具 call ID 只有在**整条原生记录字节完全相同**时才确认同一次 occurrence；映射按设备、来源和原生会话限定，并保存已验证恢复带来的外部原始归属。同 UUID 但内容变化不会覆盖老事件。没有稳定 ID 的非前缀重写保持分离并提示可能重复；截断不会删除已观察历史。重复恢复声明也核对目标设备已记录的未变后缀，避免材料修订重复计入其新增活动。

缺少可校验声明的复制保持独立；相同原生 ID、文本、工具结果、文件名或用户名均不足以跨设备合并。详情、MCP 与统计公开关系状态和不确定性，不暗示已确认所有历史。

## 查询与统计口径

- HTTP `GET /api/snapshots/:id`、`.../evidence` 与 MCP `read_snapshot / read_location` 的事件包含 `origin`。引用保留原始快照、行与 block；它可能早于当前设备最近一次快照。
- Web 显示当前上传设备员工、每条证据的原始员工和项目、已核对的来源快照以及不确定关系。搜索按同一条事件的原始员工及项目组合匹配；未知原件行与关联材料只能按上传设备员工及清单项目匹配，搜索结果说明这一边界。
- HTTP `GET /api/activity-statistics?offset=0` 与 MCP `read_activity_statistics` 共用全库唯一事件账本，按原始员工 ID、北京时间来源日期分组，50 行分页。用户轮次按原始原件行；工具调用按已解析工具请求 block。只把来源时间明确、原始设备接入后的事件计为活动，历史上下文与时间 / 接入边界未知分开保留。关联材料不计新增活动。
- 统计还显示未确认跨设备关系快照数（含未声明关系的独立新会话）与重写 / 截断后仍有不确定性的快照数。未确认重复没有被自动合并。快照详情的计数是该版本包含的唯一记录，可能来自多名员工；全库去重统计负责跨版本汇总。两者都不是工时、评分或排名。
- 可读导出保留每条原始来源、全部未知行及关联材料；原件下载与恢复包保持精确字节。恢复包中的当前上传员工不代替逐事件历史员工；再次恢复通过当前服务器快照引用继续核验归属。

## 关联材料与未完成边界

只把关联材料放入恢复目录不会创建员工活动。材料 HTTP / Web / MCP 阅读及可读导出核查已验证主会话链中相同材料的 hash / 长度，保留最早已确认的捕获员工、设备、来源快照与材料 ID。材料发生变化时返回 `changed-context-uncertain`、`previousSource` 与说明，不能把整份内容归为当前员工或此前员工；它始终是 `countedAsActivity=false`。

主会话初次实现没有完成独立材料续用；后续扩展现已按“已提交来源快照 + 精确材料 hash / 长度 / 原生会话身份 + 完整前缀”校验正常独立采集的原件。回执本身仍不赋予侧件采集资格，也不能把关联内容的捕获员工当成新增员工活动。旧材料事件保留来源材料员工及项目，新增后缀归当前设备员工。

复用现有材料契约时，应保留不变的关联原件，仅在正常宿主登记后创建新主件；不能靠批量扫描、只比文字或自动计入所有父子材料补齐本票。未知材料映射和 Codex Desktop UI 仍沿用 #9 / G0 的未验证记录。

## 持久化与升级

快照、事件来源账本与 occurrence 映射一起事务提交，同设备 / 来源 / 会话序列由事务锁保护，重试仍遵循 #17 的持久上传键。读取旧版本不改写原件或重新按当前设备接入时间解释历史。

升级启动对缺少来源账本的旧快照按原提交顺序回填，每 100 份一事务，已提交批次可继续；回填不会选较新的快照作为旧记录的前缀来源。首次升级需要维护窗口，并保留足够时间读取既有原件。缺失或损坏原件不会生成虚假的成功账本。该派生账本及 `snapshots.provenance` 必须与原始数据库一起备份，原件卷仍独立备份。

外部隔离升级实验用实际 `a4ca34c` 已编译旧产品公开 API 创建三份快照，随后启动本版本自动迁移：A 两个增长版本计两条，另一员工设备的无证明复制保留两条独立记录，旧行引用最早 A 快照，重启结果不变。没有修改数据库行来伪造迁移状态。

## 验证与复现

```powershell
npm ci
npm run typecheck
npm run build
node --import tsx --test tests/cross-device.test.ts tests/mcp.test.ts tests/materials.test.ts tests/history.test.ts

# 显式选择真实已安装 CLI；隔离 homes、普通 hooks、确定性 loopback provider，无付费请求。
$env:SKYNET_CLAUDE_RUNTIME = 'ABSOLUTE_PATH_TO_CLAUDE_2.1.281'
node --import tsx --test tests/native-claude.test.ts
```

公开合成测试覆盖两名员工与 A / B / C 独立采集状态、相同 OS 用户、同名员工 ID 分离、完整前缀证明、未知复制、同文字独立活动、来源项目组合搜索、拒绝伪造员工 / 不存在快照 / 更长前缀、重试及服务器重启、稳定 UUID 重写 / 变化字节、重复原生记录、来源日期、Web 桌面及 375px 无横向溢出、可读与恢复包完整字节。MCP 使用实际 HTTPS OAuth 授权，核对与 HTTP 一致的混合归属事件、统计、证据定位及关联材料来源；材料变化不重复新增用户轮次。

真实 Claude CLI 2.1.281 / Windows x64：普通 hooks 自动存档两个项目，删除该实验创建的原始 A home，以服务器包在新的配置目录 B 原生恢复并续聊，再由服务器 B 包创建 C 配置目录续聊。B 与 C 正常 hooks 入队，后台单次运行收取实际原件；全部 A / B 原始事件 ID、员工、项目保留，B / C 新轮次归其当前设备。实际 provider 请求仍有 A 工具历史。只使用合成 loopback 模型响应，未读取真实用户数据或调用付费模型。

原生证据：`%TEMP%/skynet-test-oZy4xL/native-cross-device-evidence.json`（10.50 秒）；此前顺序运行 `nJHj7W` 也通过。旧版迁移：`%TEMP%/skynet-test-g3E5sB/legacy-migration-evidence.json`，脚本与旧版只读复制在 `%TEMP%/skynet-v1-implementation/issue19-legacy-migration-probe.mjs` / `issue19-legacy-dist-a4ca34c`，依赖目录 junction 已移除。

普通完整回归两次均为 18/19：第一次历史分页测试因新统计分页按钮产生歧义，现已限定原件分页按钮与快照 URL；第二次仅旧安装测试硬断言 Windows 任务 `Running`，实际 `Ready`，由 #14 跟进准确状态对照。原生并发实验最初也暴露测试错误地要求最近 A 快照 ID；现已核对每条事件的真正原始不可变引用。上述失败保留记录，不声明本分支完整普通套件已全绿。最终有意义的定向回归结果由下方追加。

最终类型检查、构建、`git diff --check` 通过；定向回归 **6/6**（96.12 秒）：跨设备主链 `NO9rbc`、稳定 occurrence 重写 `38sAfW`、旧会话来源日期 / 分页 `M1YjaM`、安装链 `hS7GIA`、关联材料 / 历史阅读 `A7Okr7`、真实 HTTPS OAuth MCP `8vgrNU`。新增材料来源链接使旧材料测试的历史快照链接选择产生歧义，测试已限定历史列表，不改变产品历史导航。最终截图含去重与归属说明，375px 布局无横向溢出；截图人工检查未发现内容遮挡。完整集成后的普通套件与 #19 剩余子材料续用边界由后续批次继续，不能用这次定向通过替代发布验收。

## 主线集成

`261fee9` 与已集成的 G0 `497e8da` 合并，按 merge-conflict 技能保留恢复器的附件行重建、`sourceEmployee` 和新增 `restoredFrom`，同时保留 Claude 的 ordinary / old-session / code-change / subagent 参数化场景、实际 Write / Read 与子会话断言，以及主会话 A→B→C 跨设备验证。B 查询明确限定主会话 ID，避免子会话场景选中其他会话。

主线类型检查、构建、`git diff --check` 通过，跨设备 / 历史 / 材料 / MCP / 搜索集成 **6/6**（20.82 秒），证据目录分别为 `AiKAdA`、`kBPSvi`、`1LS5MS`、`Gx511X`、`jVGFjy`、`3uiazq`。真实 Claude ordinary 原生恢复与跨设备续聊通过，证据 `icUAFL/native-cross-device-evidence.json`（15.34 秒）；subagent 场景的原位子续用与主会话跨设备回归也通过，证据 `kSKsyk/native-claude-subagent-evidence.json` 及同目录跨设备记录。这验证合并保留了两个场景的行为，**不证明独立子会话事件归属已经补齐**。

未重复完整普通套件，也没有绕过或删除既有 Windows runtime / taskState 失败；#14 集成后再跑最新完整套件。#19 关联子会话/fork 单独续用的归属，以及 G2 完整故障矩阵继续开放。

## 材料独立资格扩展

2026-09-30，在 `1665d08` 后的独立 worktree 实现。上节“关联子会话/fork 单独续用开放”记录的是主件合并时的边界；本节补齐可以通过正常宿主事件独立采集的原生材料，G2 完整矩阵仍开放。

公开 tracer bullet：A 正常采集主件及结构化关联的 parent/fork 原件 → 服务器完整恢复包 → 公开 CLI `restore` 把相同材料字节放回原生目录并生成回执 → B 正常宿主登记该材料 → 后台提交完整原件和新后缀 → HTTP、Web、HTTPS OAuth MCP、搜索、可读及恢复导出 → C 再恢复 B 的主件。创建目录、保存回执或后台扫描本身都不使材料获得采集资格。

`restoredFrom` 增加可选 `materialId`。收集器只匹配回执中规范化安全路径、来源、材料原生会话 ID、JSONL 角色及完整前缀；未知映射不能据此授予归属。服务器核查当前数据库中已提交快照及材料清单、材料 hash / 完整长度、允许的原生 placement / transcript 角色、原件自身身份和每个前缀字节。客户端员工字段仍被拒绝；单靠相同 session ID、名称、文本、改写后相同 UUID 或截短前缀均不足以继承归属，原件从不被改写。

材料事件只在**独立资格成立且来源校验成功**时进入事件账本。未独立采集的关联材料始终是上下文，不产生任何账本条目。旧材料此前只有上下文捕获证据时，来源日期仍保留；有时间的记录分类为历史或关联上下文，时间未知仍为未知，不把捕获当成来源员工接入后活动，也不把“历史”解释成所有事件都早于接入。材料此前已独立主件采集的逐事件来源及活动分类则原样复用，不降级为历史。新增后缀由当前接入设备员工承担，按原生来源日期分类。

`material_qualifications` 与 `material_events` 冻结每份已资格材料的首次事件映射，和快照、`archive_event_origins`、`snapshot_events` 同事务提交。B 首先续用 A 的上下文后，A 再通过正常宿主独立采集完全相同的原件，也复用冻结记录；B 重试和 C 恢复不会改事件 ID、分类、归属或重复增加活动。已有 primary 的复用只选择不晚于原材料快照提交时刻的证明，避免未来快照重新解释历史。

恢复的关联材料随父主件增长时，服务器沿已验证父主件链逐份核对该材料的完整原生前缀：A 前缀仍指 A，B 新保存的上下文部分指 B 原材料，后来 C 独立采集的新后缀指 C。若材料重写、截断或不再满足完整前缀，保持独立并公开不确定性，不悄悄去重。相同材料定位及材料前缀历史两次遍历各限定 32 层，primary 候选按设备 / source / session / hash 索引先找精确命中，每段最多读取 32 个候选，总字节校验设 128 MiB 上限；达到上限会返回未确认/可能重复说明，不假装已扫描所有历史。

`EventOrigin` 保持现有字段，并增加可选 `materialId / textOffset / location / webPath`。有 `materialId` 时 `line / block` 指**原材料**，不是原快照的 primary 行。`location.kind='material'` 使用原材料原始 JSONL 行起点的 UTF-16 偏移；它不能加上解析事件语义文字的 quote 偏移。主件来源也提供原始 raw 行链接。HTTP/MCP 共用该定位入口，Web 可以点击原材料证据，搜索附带 `origin`，可读导出保留相同锚点，统计用户轮次区分原快照 / 材料 / 行。完整恢复导出的源字节不变。

支持与验证：

- 确定性公开测试覆盖 Codex parent / child / previous transcript 角色及 fork 上下文、A 上下文→B 独立主件→A 较晚资格→B 重试→C、已有 primary 复用、A→B 材料增长→C、未知时间、同一事件 ID、来源项目、context-only 零新增活动、精确材料锚点，以及伪造员工 / 快照 / 材料 / hash / length / 原生身份 / placement、变化字节与截断拒绝。Web 点击材料位置与实际 OAuth SDK 的 `read_snapshot / read_location` 内容一致；不是直接改数据库证明验收。
- Windows x64 Codex CLI **0.157.1** 真实 runtime：实际创建 parent 与原生 fork，保留 parent image、工具历史、附件行；删除实验 source home 后，服务器包公开 CLI 恢复，正常 TUI hook review 后用 `exec resume` 续用 parent，实际 `UserPromptSubmit` 独立采集 B，旧事件指原材料及 A，新 suffix 指 B。确定性 loopback provider，无真实账户、配置、用户原件、付费请求。证据 `%TEMP%/skynet-test-Ba7caC/native-materials-codex-cli-evidence.json` 与 `native-material-primary-details.json`，15.11 秒；此前 `PgHkDx` / `wbxpkZ` 也通过。
- 真实 Claude 子代理仍使用父 `sessionId` 与单独 `agentId`，不属于可伪装成独立 UUID 主件的原件。短 agentId 的材料声明会因原生身份不符被拒绝；原位 `SendMessage` 续用及上下文保全沿用 G0 的已测场景，不宣称独立 primary 活动资格。Codex Desktop app-server 后端的 fork 恢复不等于 Desktop UI 验收；本次正常独立资格证明限测得的 CLI。

最后类型检查、构建、`git diff --check` 通过。定向集成 **8/8**（76.04 秒）：主件 A→B→C `t1NaA7`、稳定原生 occurrence 重写 `HcTH6e`、三来源旧会话与日期 `65aSkP`、材料→primary 公共整链 `8Cl5Jd`、已有 primary / 增长 / 拒绝 `87N1WJ`、材料保存与阅读 `JM2f1r`、HTTPS OAuth MCP `MODdx1`、搜索全部分页 `1raP2n`。材料原件链接截图人工查看内容与定位一致，无遮挡。新增 placement 拒绝后的最终材料回归 **2/2**（14.29 秒）：`fNuvGt` / `LUx4iN`。

实验初期暴露的失败没有被包装为成功：合成 package 需符合原生 metadata 与显式 source-version；全局 CLI 已升级 0.159.2，最终改用先前保留的官方 **0.157.1** 二进制，未修改全局安装。真实续用起初被正常 CLI 的 Git 工作区检查拒绝，随后只对实验新工作区正常 `git init`，未跳过 Git 或 hook trust 检查。公开 OAuth fixture 的 state 与表单编码错误已修正。完整普通套件与完整 G2 不由这些定向结果替代。

复现材料公开与正常 CLI 资格测试：

```powershell
$env:SKYNET_CODEX_CLI_RUNTIME = 'ABSOLUTE_PATH_TO_PINNED_CODEX_0.157.1'
node --import tsx --test tests/material-primary.test.ts

$env:SKYNET_CODEX_CLI = $env:SKYNET_CODEX_CLI_RUNTIME
$env:SKYNET_NODE_PTY_ROOT = 'ABSOLUTE_PATH_TO_OWNED_TEST_ONLY_NODE_PTY_PREFIX'
$env:SKYNET_MATERIAL_SOURCE = 'codex-cli'
$env:SKYNET_MATERIAL_PRIMARY = '1'
node --import tsx --test tests/native-materials.test.ts
```

不提供已测 runtime 的普通跨平台 CI 使用明确标记的合成 receipt fixture；Windows 实测通过公开 CLI 从真实服务器恢复包生成 receipt。新增资格表及映射必须与数据库事件账本一起备份；仍独立备份原件卷。没有修改 main、推送、创建 PR、合并分支或删除 worktree。
