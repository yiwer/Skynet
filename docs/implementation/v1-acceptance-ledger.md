# V1 验收证据台账

V1 尚未完成，AC-01…AC-22 与 G0…G4 均未整体签收。本台账是唯一验收索引；各票文档保留实验过程。本检查点整理材料，未执行新的产品测试。产品源码 `68ee347605db0a23578b62560c4df8f97057025a`，文档基线 `15021a40244d811887486173289376099eb87009`（2026-09-30）；#32 在独立树实施，尚未合入。

依据：[PRD](../requirements/PRD.md)、[V1 验收标准](../requirements/v1-acceptance.md)、[实施记录](../planning/v1-implementation.md)、[原生支持矩阵](native-validation-status.md)。[PRD v2 适用规则](../requirements/PRD-v2.md#与既有文档的关系) 已确认：使用能力评估与报表守则以 V2 为准，其余以 V1 为准。因此不能继续把全部自动评估写成永久禁止；本票不提前实现 V2 AC-23…38。V1 统计与四级证据仍须可追溯，Token 不是账单，事件区间不是工时；名次、榜单、按指数排序人员及自动人事动作仍在范围外。

## 环境与支持边界

“已验证”只指具体实验行为。loopback 是合成替身，不证明千问质量或计费；支持矩阵为 partial 的组合不因此成为完整 supported。

| 代号 | 实测版本 / 环境 | 已测范围与边界 |
| --- | --- | --- |
| W | Windows11 Pro 10.0.26200 x64，Node24.12.0/npm11.6.2；i7-14700K、28逻辑CPU、68,006,068,224 bytes内存 | 公开服务/headless Web/控制线程/hook快路径；自有状态与PG17容器。主机并发负载未控制，不外推其他OS或安装全量 |
| C | W + Claude Code2.1.281 | 实际CLI普通hooks、两项目、旧会话、Write/Read、子代理原位续用、服务器独立恢复；loopback |
| X | W + Codex CLI0.157.1 | 实际hooks/exec/history/fork/图片/附件行重建、独立材料资格；本机workspace-write被宿主退化为read-only，实际apply_patch未通过 |
| D | W + Desktop26.924.2738.0 / bundled backend0.158.0-alpha.2.1 | 仅实际backend app-server恢复；创建renderer不等于可用UI，正常UI采集/信任/恢复未测 |
| L | GitHub Ubuntu CI、Node24、自有PG容器，固定源码见各轮日志 | typecheck/build/普通回归，不覆盖Windows Task/Desktop/PAYG。Linux UID1000实际Claude短分析worker和ENOSPC/EACCES/ENOENT是独立实验 |
| B | #32支线Linux/amd64 helper Node24.21.0、PG工具17.11；W调用、PG17-alpine fresh target | 两原件对象（含ACK未成快照staged chunk）新库恢复；same-host/integrity-only，未合主线/未验收灾备 |

当前全局Codex0.159.2、其他版本/macOS/WSL/SSH/员工容器未由这些固定实验覆盖。Agent×版本×OS×能力的每格状态以原生支持矩阵为准。

## AC-01…22

复跑步骤R1…R8及证据E1…E8见下文。表内“已验证”不是整项签收；票据文档包含准确参数、原始环境和历史记录。

| 验收 | 环境与复跑步骤 | 已验证结果 / 证据 | 未解决项 |
| --- | --- | --- | --- |
| AC-01 单Key npm | W/C/X，R7；[#11](issue-11.md) --ignore-scripts/单次setup | 离线包、两CLI安装模式与前置错误；[#12](issue-12.md) launcher | 完整G1；安装开始到健康检查≤2分钟 |
| AC-02 市场共存 | W/C/X，R7；[#13](issue-13.md) 两市场、共存/缓存错误 | 实际CLI市场、单身份后台、入口所有权 | D正常入口、完整支持组合 |
| AC-03 修复升级卸载 | W，R2/R7；[#14](issue-14.md) 中断升级/旧载荷/冻结drain | guardian/UTF8定向；主线control/线程/旧Task元数据14/14、39.63s；E3 | 实际静默Task/完整Windows生命周期；历史红取消保留 |
| AC-04 图标登录恢复 | W/D，R7；[#12](issue-12.md) 无安装终端环境启动/登录/重启/休眠 | 认证supervisor/worker及崩溃恢复；旧Task精确所有权迁移纯测试 | 正常UI图标/登录/重启/休眠、实际Task无弹窗 |
| AC-05 自动多项目 | C/X/D，R3 ordinary；[#6](issue-6.md)/[#7](issue-7.md)/[#11](issue-11.md) 受信hooks | 两实际CLI多项目/工具记录；E4 | D自动UI采集、三来源完整样例/实际代码修改 |
| AC-06 仅继续旧会话 | C/X/D，R3 G0；[#8](issue-8.md)/[#10](issue-10.md) 两旧会话只继续一条 | 实际CLI持续回归，mtime不触发扫传、原日期保留；E4 | D及完整环境组合 |
| AC-07 代次材料 | C/X/D，R1/R3；[#9](issue-9.md)/[#18](issue-18.md)/[#19](issue-19.md) child/fork/附件/资格 | 原件代次、Claude原位子续用、Codex附件ID/time/type/key/payload回填、原材料前缀锚点；E2/E4 | 全材料/未知payload/外部资源/D；非法UTF8活动缺口修订 |
| AC-08 离线ACK | W/L、三来源，R1；[#16](issue-16.md)/[#17](issue-17.md) 丢ACK/崩溃/重试 | 幂等快照/退避，同事务原事件与材料资格映射，跨恢复不重复活动；E2 | G1后完整三来源G2矩阵 |
| AC-09 本地故障 | L/W，R5/R1；[#18](issue-18.md) 故障、[#31](issue-31.md) 覆盖观测 | UID1000实际ENOSPC/EACCES/ENOENT；收到日/小时故障保留，当前连接不填历史；E2 | Windows等价、无法落盘且离线边界 |
| AC-10 独立续聊 | C/X/D，R3；[#5](issue-5.md) server包→new home→same ID | 两CLI源材料不可用时恢复上下文/工具；E4 | D正常UI/完整材料；#32恢复服务器后的native链 |
| AC-11 校验归属 | W/C/X，R1/R3；[#5](issue-5.md)/[#9](issue-9.md)/[#19](issue-19.md) A→B→C | 损坏/非空目标拒绝，原owner/device/project/date/eventId/材料原锚点及完整导出；E2/E4 | D/G2组合；未资格材料仍context-only |
| AC-12 日周项目证据 | W/L/C，R1/R4/R6；[#27](issue-27.md)/[#28](issue-28.md)/[#29](issue-29.md)/[#30](issue-30.md) | HTTP/Web/OAuth MCP固定版本、分页、员工/项目下钻；主线#30及#31各12/12；E1/E2 | 真实模型质量/运营来源、Web溢出/深色修订 |
| AC-13 分级统计 | W/L/C，R1/R4；[#22](issue-22.md)/[#19](issue-19.md)/[#31](issue-31.md) 引用/资格/固定统计 | 四级结论，来源event去重、记录Token/基线/缓存、文件参数/时间点区间，缺项未知；E2 | PAYG抽检；通用0xFF/既存账本计数；V2守则按本文依据适用 |
| AC-14 北京归期 | W/L，R1/R4；[#28](issue-28.md)09:00/[#29](issue-29.md)周一/[#30](issue-30.md)迟到 | 已管理空日周项目首条迟到自动刷新；原来源日，接入前日期不批量建报告；E1/E2 | 真实调度负载、全部日期边界 |
| AC-15 更正隔离 | W/L/C，R1/R4；[#24](issue-24.md)/[#30](issue-30.md) 更正/并发/晚结果 | 审计说明/主题/显示项目、幂等重算；旧固定日周项目逐字不变、原件不变、晚结果非适用；E1/E2 | 实际运行/模型/操作、最终组合review |
| AC-16 认证共享读 | W/L，R1；[#20](issue-20.md) 撤销/冒充/新接口 | 每请求撤销、认证共享读、维护权限与审计；E1/E2 | #32接口/最终全表面审查、真实部署 |
| AC-17 MCP | C/X/W，R3/R1；[#26](issue-26.md)/[#27](issue-27.md) OAuth/到期刷新/分页/导出 | 两实际CLI正常HTTPS授权；报告/队列/覆盖同服务版本；E2/E4 | 实际HTTPS origin/G3、登录故障不阻采集复核 |
| AC-18 实际长分析 | C/L，R4；[#22](issue-22.md)/[#23](issue-23.md)/[#24](issue-24.md) 独立CLI分段聚合 | Claude2.1.281 loopback短长公开链、原UTF16引用/全job请求预算；E4 | G2前置、指定千问PAYG真实长质量 |
| AC-19 分析故障 | W/L/C，R1/R4；[#24](issue-24.md) 领取/租约/重启/新输入/超时 | 有限总attempts、并发/时间/输入/请求/预算caps、未知不退款；CLI两次停止，原件查导可用；E4 | 真计费上界/账单/G2/G3；#32旧claims fencing |
| AC-20 指令隔离 | C/L，R4；[#22](issue-22.md) Bash/外发/伪造引用 | 实际CLI只有StructuredOutput、无副作用、不继承hooks/auth/MCP、不回流采集；E4 | 指定PAYG模型、完整G3抽检 |
| AC-21 服务器灾备 | B，R8；[票#32](https://github.com/yiwer/Skynet/issues/32) 支线bbcb37b→70c3034 | fresh restore1/1，用例9.16s/总9.82s；stage3 paths/public/fault/Linuxvolumes4/4、总37.59s；两对象含staged ACK、restore-before-migrate；E7 | 未合入；完整冻结报告/OAuthMCP/实际双CLI续聊与最终组合灾备 |
| AC-22 性能运营 | W/L，R5/R7；[#11](issue-11.md)/[#12](issue-12.md)/[#14](issue-14.md)/[#18](issue-18.md) | ROOT200hook P50 52.53/P95 67.17/max137.34ms；另公开200原文可见P95 1161.15ms；E5 | 压力P95 111.35ms红；支持客户端/登记负载的安装≤2min和原文≤60s分布；第二人/五日 |

## G0…G4

| 门槛 | 状态 | 复跑 / 决定性剩余 |
| --- | --- | --- |
| G0 / #10 | 未通过 | R3；D正常UI采集/独立续聊、实际Codex workspace-write、完整材料/历史/工具矩阵 |
| G1 / #15 | 未通过 | R2后R7；真实静默Task/图标/登录/重启/休眠及完整安装环境，保留Windows全量红取消 |
| G2 / #21 | 未通过 | R1/R3/R5；G1后三来源完整故障矩阵、关系/材料未知与通用UTF8修订 |
| G3 / #25 | 未通过 | R4后真实PAYG；独立Claude、指定模型质量/引用/长范围、价格预算 |
| G4 / #33 | 未通过 | R1/R6/R7/R8；#32、最终Web/性能/review、第二人、前置通过后五日试点和签收 |

按门槛顺序验收；合成/代码回归不解除真实条件，#32阶段性结果与本票前置交付不代表完成。

## 可复跑入口

以下是配方，未在本轮执行。固定源码/清洁构建/隔离合成配置，记录OS/版本/source hash/负载；先保存脱敏证据再清理自有资源。不读用户既有会话/Key/登录配置。实际Windows Task/setup/maintenance/完整`npm test`仍HOLD，R1不替代完整套件。

**R1：公开非Task链。** Node24、Docker/PG可用时覆盖上传查导、归属、分析/长范围/队列、报告/更正/覆盖/MCP：

```powershell
npm ci
npm run typecheck
npm run build
node --test --test-concurrency=1 dist/tests/analysis.test.js dist/tests/analysis-queue.test.js dist/tests/analysis-long.test.js dist/tests/analysis-long-public.test.js dist/tests/archive.test.js dist/tests/consistency.test.js dist/tests/delivery.test.js dist/tests/history.test.js dist/tests/identities.test.js dist/tests/search.test.js dist/tests/material-primary.test.js dist/tests/material-qualification.test.js dist/tests/source-statistics.test.js dist/tests/team-coverage.test.js dist/tests/daily-reports.test.js dist/tests/work-views.test.js dist/tests/report-corrections.test.js dist/tests/report-corrections-workflow.test.js dist/tests/mcp.test.js
git diff --check
```

**R2：真实control HTTP caller与纯登记。** 2200ms同步spawn阻塞移出event-loop，线程异常等auth worker lease释放，不实际装Task：

```powershell
node --test --test-concurrency=1 dist/tests/control-spawn.test.js dist/tests/runtime-control.test.js dist/tests/autostart-registration.test.js
```

**R3：实际原生二进制。** 精确版本、独立home/合成provider，G0六项串行；ordinary及材料能力详见[#10](issue-10.md)/[#19](issue-19.md)：

```powershell
$env:SKYNET_CLAUDE_RUNTIME='ABSOLUTE_PATH_TO_CLAUDE_2.1.281_EXE'
$env:SKYNET_CODEX_CLI='ABSOLUTE_PATH_TO_CODEX_CLI_0.157.1_EXE'
$env:SKYNET_CODEX_RUNTIME='ABSOLUTE_PATH_TO_BUNDLED_0.158.0-alpha.2.1_EXE'
$env:SKYNET_NODE_PTY_ROOT='ABSOLUTE_EXTERNAL_NODE_PTY_PACKAGE_ROOT'
npm run test:g0-native
node --test dist/tests/native-mcp.test.js
$env:SKYNET_MATERIAL_SOURCE='codex-cli'
$env:SKYNET_MATERIAL_PRIMARY='1'
node --test dist/tests/native-materials.test.js
```

实际Codex代码写入仅在正常workspace-write环境显式`SKYNET_NATIVE_CODEX_WRITES=1`，不绕过trust/sandbox。bundled backend不是Desktop UI。

**R4：独立实际Claude CLI/loopback，非付费。** 保持显式Claude路径，逐条串行：

```powershell
node --test dist/tests/native-analysis.test.js
node --test dist/tests/native-analysis-long.test.js
node --test dist/tests/native-daily-reports.test.js
node --test dist/tests/native-work-views.test.js
node --test dist/tests/native-report-corrections.test.js
```

短分析另按[#24](issue-24.md)构建`Dockerfile.analysis`，显式`SKYNET_ANALYSIS_LINUX=1`/`SKYNET_ANALYSIS_IMAGE`，核对非root UID/runtime/image hash再跑同短测试，结束恢复变量。真实PAYG走专用配置，不把fixture别名/零价格当真实模型。

**R5：真实Linux本地故障。** [#18](issue-18.md)自有tmpfs/UID1000，登记200样本与并发故障条件：

```powershell
docker build -f tests/Dockerfile.native-local-faults -t skynet-native-local-faults:2.1.281 .
$env:SKYNET_FAULT_TEST_IMAGE='skynet-native-local-faults:2.1.281'
node --test dist/tests/native-local-faults.test.js
```

**R6：全页Web。** E6外部脚本支持sourceRoot/output，公开auth/upload/read创建单一fixture：

```powershell
$env:SKYNET_AUDIT_REPO='ABSOLUTE_CLEAN_BUILT_SOURCE_ROOT'
$env:SKYNET_AUDIT_OUTPUT='ABSOLUTE_NEW_DURABLE_EVIDENCE_ROOT'
node node_modules/tsx/dist/cli.mjs F:/GenCode/Skynet-evidence/v1-2026-09-30/web-audit/probe.mts
```

最终修订代理把可复现版移入仓库tests，在`pages()`加#30更正/历史/显示项目、#32合入后的运行页及登录/退出；320/375/760/1280/1920×light/dark×已有/空/错误、长无空格employee/project/256KB输出、原件完整导出。断言实际overflow/dark palette，截viewport/full-page，人工检查标签/键盘/焦点/原生控件对比度。外部脚本后加asset/capture guards尚未再实际运行，不算新增通过。

**R7：安装与性能。** HOLD解除、单次实际静默Task验证后，按#11–14登记≥2员工×≥2环境，复跑npm/市场/旧载荷/repair/upgrade/uninstall及正常登录/休眠。`node dist/tests/measure-installed-hook.js ABSOLUTE_OWNED_INSTALLED_SKYNET_LAUNCHER`保存≥200全样本/P50/P95/max。安装≤2min、事件→查询P95≤60s分别测；下载/信任/首次历史分别计。

E5正常hook的外部`performance/hook-baseline.mjs`固定main路径/产品68compiled；先审阅并登记实际source/build，再`node F:/GenCode/Skynet-evidence/v1-2026-09-30/performance/hook-baseline.mjs`。原文可见入口为`node F:/GenCode/Skynet-evidence/v1-2026-09-30/performance/raw-visibility-probe.mjs`，同样先核对固定own30源码/环境；独立核查脚本是`performance/verify-raw-visibility.mjs`。它们不装Task，不代表支持客户端或旧Linux满盘重测。完整Linux`npm test`依CI workflow执行，不推断Windows全量。

**R8：#32尚未合入。** 合入后取真实文档/CLI/hash再执行，不引用当前仓库不存在的入口。覆盖SQL exported snapshot+全部ACK staged chunks、raw/导出/报告引用、fresh PG restore-before-migrate、complete marker/receipt崩溃窗口、损坏拒绝、claims/预算fencing、恢复服务器独立native包、HTTP/Web/MCP容量/备份状态，区分same-host/off-host/未知故障域。

## 精简证据索引

外部相对路径统一基于`F:/GenCode/Skynet-evidence/v1-2026-09-30/`，不是仓库文件。原`v1-acceptance-inventory.json`的at09:55:18.277Z/head1c2814c快照不改；增量hash见`issue-33-preflight-inventory.json`，只核查已有文件，不产生行为证据。

| 代号 | 结果 / 来源 / 现存证据 |
| --- | --- |
| E1 当前CI | 产品68 [Linux CI](https://github.com/yiwer/Skynet/actions/runs/36697980515/job/109830431425) typecheck/build、**56/56，146.80s，0fail/0cancel**，`ci-68ee347-linux.log`。docs150 [CI36700854354](https://github.com/yiwer/Skynet/actions/runs/36700854354) completed/success、head15021a4；docs1c281 CI36698515617 success不重复计产品覆盖 |
| E2 当前公开主线 | #30 `main-30-integration.log`/`main-30-evidence-summary.json`/`main-30/`：12/12、56.26s；#31 `main-31-integration.log`/`main-31-evidence-summary.json`/`coverage-f611dad8-9b43-4b47-81a1-706c3231c67d/public-flow.json`：12/12、31.43s、5LAcc5；#30组合矩阵`coverage-a1e041b4-99fa-4822-9c9c-6b2e5174429b/public-flow.json`。旧报告不从latest账本回填 |
| E3 控制与资格已集成 | runtime b93ffeb→92e3711，main14/14、39.63s；rw1nib status8.04/stop2.19ms、2DhhCy exit17、zEh7J6/XwQOiK 2500ms drain见[诊断](runtime-control-diagnosis.md)，部分TEMP已失效。资格/周项目主线8/8、31.94s，`main-29-qualification-integration.log`/`main-29-qualification/`；旧件17,826,999bytes，raw64MiB、analysis8MiB；`caQOyh-legacy-material-qualification-evidence.json`/`wJq5or-material-qualification-evidence.json` |
| E4 实际native分支 | G0497e8da六项通过→3fb6454；#22 2af8421：B3TxgX(W)/oc2IFY(L)；#19 73c745e：Ba7caC正常Codex材料资格；#24 f2b9cf9：5Mze6i(W)30.9s/pvpq1E(L UID1000)32.1s；#29组合`issue-29/1hfWI0-work-view-public-evidence.json`；#30 `issue-30/xUlWpY-work-view-public-evidence.json`1/1、54.37s。无源码冲突合入复用分支证据，不冒称main再native；各票列详细hash/配方/边界 |
| E5 性能新实测 | `performance/hook-db721967-432e-4b2a-9f4f-cf7030ac2fb8/result.json`/`performance/hook-baseline.mjs`：W/product68，200/200唯一样本入spool，P50 **52.53**/P95 **67.17**/max **137.34ms**；无gap/原件读取/网络，Task0/provider0、hidden child≤3s。另`performance/raw-2c49f95d-db2e-444c-8e4d-a5d53195bd03/result.json`与`independent-verification.json`：own30 c5d23c5公开CLI hook→collector→服务器200/200可见，P50 **678.0862**/P95 **1161.1511**/max **1217.4754ms**、poll100ms、0missing/fail/timeout；总13.918s含准备cleanup。ROOT独立重算分布、200nonce/prefixSHA及11raw hash全部true；collector/server/packages与main68 relevant源码diff空，不是main执行。1员工/设备/会话、loopback服务器/PG512MiB1CPU、未配置分析、主机并发不控、Task/native/paid0；不代表登记试点/支持客户端AC22签收 |
| E5 故障路径新增 | `performance/enospc-result.md`、`performance/enospc-d320a115-3b17-4a86-98c3-b7f54f324c82/host.json`/`output/result.json`：product68冻结载荷，Linux WSL2/Node24.21/UID1000、1CPU/128MiB/pids64/networknone/root只读，自有2MiB tmpfs实际ENOSPC、前后free0。200/200顺序child exit0且精确storage诊断；P50 **52.027888**/P95 **72.561423**/max **106.325139ms**，spool0/gap无法落盘；sample SHA256 `0202523324d4343905aa9aefe3b1737f3225f4b3ce394daba94521d68107f60b`。owned容器已不存在；无产品优化/Task/setup/native/paid。不是旧四任务并行111.35ms条件，不能覆盖其红。复跑入口 `node F:/GenCode/Skynet-evidence/v1-2026-09-30/performance/hook-enospc-probe.mjs` |
| E6 当前Web/UTF8红 | `web-audit/run-2/result.json`/`web-audit/summary.json`/`web-audit/audit-handoff.md`：producta458、112captures、58overflow、0capture/page exceptions；56dark仍亮色。简化直接文字contrast min5.436/0fail非完整无障碍证明；21代表PNG人工核对+ROOT两张。`public-utf8-red-result.json`/`public-utf8-red.mjs`/`evidence-utf8-probe-result.json`：FF产生U+FFFD/gap0/额外活动；合法encoded U+FFFD控制与下载原hash通过；通用parser/既存origin待修 |
| E7 #32支线阶段 | bbcb37b `issue-32-backup-stage2-green.log`1/1，用例9.16s/总9.82s、4eBW26；`issue-32-stage2-public.json`：两对象296bytes/dump89662bytes/PG17.11/Node24.21/same-host/integrity-only/stagedSubmission200，`issue-32-stage2-helper-image.json`。随后heartbeat修订 `issue-32-heartbeat-reconcile-green.log`2/2、总19.81s：restore live_valid=false/真实heartbeat再true，历史观测不改。`backup-permission-preflight-result.json` UID1000访问1001私有0700/0600 EACCES→匹配1001读写成功；未放宽product权限。stage3 clean70c3034 `issue-32-stage3-green.log`4/4、总37.59s，paths/public/fault/Linuxvolumes；`issue-32-stage3-fault-public.json`/`issue-32-stage3-heartbeat-public.json`/`issue-32-stage3-linux-volumes.json`；named-volume app/helper UID1000保持目录0700/文件0600。加严格SQLerror枚举与raw非空目标拒绝后 `issue-32-crash-fence-final.log`1/1，用例32.09s/总32.74s。未合main，完整report/OAuthMCP/实际双CLI续聊未完 |
| E8 历史与失效 | 原inventory44份durable、main30/31收据SHA一致，17条旧TEMP不存在。`ci-9b90e7a-linux.log`红；`ci-0743d4d-linux.log`36/36、`ci-6089062-linux.log`45/45、`ci-0dc863a-linux.log`49/49、`ci-a4588a6-linux.log`53/53只证明各源码。早期基线17/17、1665d08的19/19、f6ccbca的28/28（100.38s）仍保留各票/CI记录 |

旧TEMP17条精确路径保留原inventory：native research/code-change/subagent/attachment、runtime diagnosis/reporting readiness、六G0原记录am35Jw/T5UcDo/iKyW27/fXHp3P/Frh0VR/TTEPSP、runtime summary ySaGHQ/main rw1nib、hook qZM0lv、local-fault txjgno、UTF8 finding。原因未知，不重造原日志。票据历史值保留，但失效原文件不能作为现存附件；新复跑不倒填旧run。

## 历史失败、取消与当前缺陷

后续绿色不改写下列红/取消，各票原记录不删除；表内聚合关键失败，其他中间诊断仍见票据。

| 来源 | 实际失败/取消 | 后续边界 |
| --- | --- | --- |
| G0 / [#10](issue-10.md) | Windows ordinary15/17 installation/plugin runtime unresponsive；hQ60LH supervisor handshake无worker | 六native成功是不同流程 |
| [#14](issue-14.md)早期Windows | 23pass/1cancel252.02s；22pass/1fail/1cancel250.47s；maintenance240s预算、fallback Task/directspawn不自动恢复 | 取消后body证据不算通过；guardian/UTF8后来2/2、88.24s |
| #14 recoveryWindows | 23pass/1fail/0cancel143.18s；initial-install1500ms无响应 | maintenance1/1、171.24s不覆盖该批；control5/5纯保护另算 |
| [#23](issue-23.md)Windows | 33项31pass/2fail/0cancel237.078s；installationGbzZun73.131s/pluginj1GGMW72.607s均1500ms；maintenanceXZRnZf236.150s过 | 不含后来的日报/最终runtime；不可合并所有失败原因或当旧payload proof |
| [控制诊断](runtime-control-diagnosis.md) | fresh Task压力8次2红，spawn2164.11/2011.15ms、TCP1.63/1.55ms、server arrival在spawn返回后约3ms | 正确caller2200ms旧RED→线程GREEN、main14/14；线程异常早替换三child RED→等auth lease释放GREEN。单existing-state40/0不同条件；无修后Task/fullWindows |
| [状态观测](issue-14-status-observation.md)/Linux9b90 | 27/28、106.54s，completed routing sweep被过早观测 | 6324d0a→9f06a49 CI29/29、111.125s；不同于Windows1500ms |
| [#18](issue-18.md)/[#14](issue-14.md)性能 | 并行故障200样本P50 58.16/P95 **111.35**/max186.85ms超过100目标；maintained200 P50 59.99/P95 85.44/max **1075.89ms**长尾 | earlier84.38/76.99及E5正常67.17不同负载，不称压力已修 |
| [#31](issue-31.md)/[#30](issue-30.md) | 初始9/10固定MCP tool数；更正404/迟到日0/项目null；完整workflow54.48/39.94/55.15s为分页首20/pending正确409/错claim snapshot | 后续命名契约10/10后12/12、#30主线12/12不删除原红 |
| Docker/backup前置 | daemon挂起导致29/material120s取消、进程343.89s；首次tool父目录0444 MODULE_NOT_FOUND、registry45.017s timeout | 非业务根因结论；后续tools smoke2.42s SQLcalls0不验收灾备 |
| E5 ENOSPC首测工具 | `performance/enospc-8fc2110b-7106-4cfc-8ef8-0a2267b1829b/`：Windows生成Linux launcher带`file:///F:/`，首样本module missing；清理matcher大小写错，ROOT独立确认owned容器不存在 | 仅1样本、无200分布，非产品延迟失败；改为Linux内product launcherText生成后以新owner复跑，原失败不混入指标 |
| #32支线 | status404 3.76s、CLI缺失；首dump/restore成功但错预期201（现有接口200）23.05s；旧heartbeat错误connected16.18s；permission首fixture错单独留存 | stage2 9.16s/WIP heartbeat2/2独立登记；UID匹配不是完整恢复 |
| 当前UTF8/Web | E6 FF额外活动gap0、58overflow/无dark；首测112次`__name`测量错保留`failed-measurement-run.json`，非产品失败 | strict分析/proof/统计不等于通用parser修复；run2成功测量不等于页面通过 |

[#18](issue-18.md)初始16/17 logout竞态、[#23](issue-23.md)时间戳/原锚点fixture错误等仍留原票。源修订、测试修订、环境失败与验收分别记账，当前56/56不覆盖历史。

## 需要真人、账号或连续运行的最少条件

1. 正常隔离Windows Desktop账号/环境（无需员工真实资料），声明支持OS/版本/信任/可写工作区；静默Task单次验证后登记完整安装/登录/重启/休眠生命周期。
2. 千问PAYG专用配置/凭据路径、明确模型ID、核实价格和授权预算，以及部署HTTPS origin；先G2再独立Claude质量/引用/长范围抽检，不读旧Key/猜模型。
3. 第二位操作者复现安装/修复/升级/卸载和#32新服务器恢复；登记备份故障域/试点负载，采集安装与原文可见延迟。
4. G0–G3通过后授权连续5个工作日试点，负责人核对验收产出物，在[Issue #1](https://github.com/yiwer/Skynet/issues/1)签收。

下一步：合入#32最终证据；独立Standards/Spec review后单一修订代理处理UTF8/Web/权限/性能，再按R1…R8更新实际结果与门槛。
