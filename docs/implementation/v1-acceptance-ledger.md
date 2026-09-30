# V1 验收证据台账

2026-09-30 恢复实施时的基线：`a4ca34c`。规格以 [PRD](../requirements/PRD.md) 与 [验收标准](../requirements/v1-acceptance.md) 为准；实现进度见 [实施记录](../planning/v1-implementation.md)。本表汇总已有证据与待完成事项，不能替代真实演练或负责人签收。

## AC 对照

| 验收 | 已有可复跑实现与证据 | 仍需完成 |
| --- | --- | --- |
| AC-01 单 Key npm 接入 | [#11](issue-11.md)：离线包、禁用安装脚本、一次 setup、两个 CLI 安装模式 | 完整 G1 环境登记与耗时复验 |
| AC-02 市场入口与共存 | [#13](issue-13.md)：真实双 CLI 市场、单身份后台、入口所有权、缓存不可用 | Desktop 正常入口与完整支持矩阵 |
| AC-03 修复升级卸载 | [#12](issue-12.md)、[#13](issue-13.md)、[#14](issue-14.md)：公开修复、中断升级、真实旧载荷回退、卸载及冻结 drain；guardian 崩溃恢复与中文path分块输入修订已合入 | recovery Windows 全量23/24：initial-install control无响应仍红；其他 OS、完整支持组合与第二人复现 |
| AC-04 图标启动与登录恢复 | [#12](issue-12.md)：受认证后台、监督器、隐藏用户任务、崩溃恢复 | Desktop UI、正常登录/重启/休眠及无安装终端环境 |
| AC-05 自动采集多项目 | [#6](issue-6.md)、[#7](issue-7.md)、[#11](issue-11.md)：真实 CLI 正常 hooks | Desktop UI 自动采集；三来源完整样例 |
| AC-06 仅接管被继续的旧会话 | [#8](issue-8.md)、[#10](issue-10.md)：两个真实 CLI 旧会话已纳入持续回归，目录 mtime 不触发上传、仅继续一条、来源日期保留 | Desktop 实测 |
| AC-07 文件代次与关联材料 | [#9](issue-9.md)、[#18](issue-18.md)、[#10](issue-10.md)：原件代次、Claude 原位子续用与 Codex 附件精确回填；[#19](issue-19.md) 主件及可独立资格材料的完整前缀、原材料行锚点与改写不确定性 | Claude 子代理不伪装独立主件；未知 payload/外部资源、Desktop UI、完整支持矩阵与 G0 |
| AC-08 离线与确认语义 | [#16](issue-16.md)、[#17](issue-17.md)：退避、ACK 丢失、崩溃窗口及幂等快照；[#19](issue-19.md) 快照与材料资格事件映射同事务提交，重试、较晚独立采集和再次恢复保持 eventId 不重复计活动 | 已通过安装前置的三客户端完整 G2 故障矩阵 |
| AC-09 本地故障与缺口 | [#18](issue-18.md)：真实 Linux ENOSPC/EACCES/ENOENT、动态故障与未核实范围 | Windows 等价场景、无法落盘且离线的边界实测 |
| AC-10 服务器独立原生续聊 | [#5](issue-5.md)、[#6](issue-6.md)、[#7](issue-7.md)：新 home、源材料不可用、同 ID 续聊 | Desktop 正常 UI 恢复续聊；完整材料兼容性 |
| AC-11 恢复校验与归属 | [#5](issue-5.md)、[#9](issue-9.md)、[#19](issue-19.md)：A→B→C 主件及正常独立资格的 Codex 材料恢复，原员工/设备/项目/日期、冻结来源映射、Web/MCP 统计和再次完整导出；真实 CLI 正常 hook 支线实测 | Desktop UI、完整支持组合与 G2 验收；未资格材料始终 context-only |
| AC-12 日周项目与证据 | [#27](issue-27.md)：搜索、稳定原件位置、跨页完整读取 | #28/#29 工作主题、日周与项目视图 |
| AC-13 证据分级与统计 | [#8](issue-8.md)、[#19](issue-19.md)：唯一事件及来源员工/项目/日期、历史或关联上下文与未知分类；[#22](issue-22.md) 四级结论、逐字引用及原材料锚点与输入语义位置区分 | 真实模型质量验收；#28/#31 完整统计与未知值，不把 context-only 捕获计活动 |
| AC-14 北京时间归期 | [#8](issue-8.md)：来源日期和可信接入边界 | #28/#29 定时日周任务；#30 迟到数据和受管理期间 |
| AC-15 更正与版本隔离 | 原始快照不可变 | #24 任务版本；#30 更正、历史报告与旧任务晚完成 |
| AC-16 认证撤销与共享读 | [#20](issue-20.md)：逐请求校验、共享读取、维护权限、审计 | 新增分析/报告/更正接口沿用边界并复验 |
| AC-17 MCP 真实授权与查询 | [#26](issue-26.md)、[#27](issue-27.md)：两个 CLI 正常 OAuth、自然到期刷新、分页及导出 | 日周报告与 Web 共用结果；实际部署域名 |
| AC-18 真实分析与长会话 | [#22](issue-22.md) 公开任务与独立 Claude Code worker；[#23](issue-23.md) 支线实际 Windows Claude Code loopback 分段提取/汇总、原 UTF-16 引用、Web/MCP/完整导出及失败/跳过范围通过 | #21/G2 前置；指定千问 PAYG 模型、专用配置、核实价格与预算及真实长会话质量实测；支线合成链不关闭 G3 |
| AC-19 分析失败隔离 | [#22](issue-22.md)：未配置/离线、有限输入、引用拒绝、deadline 失败、隔离实际 CLI；支线挂起超时期间上传/读取/导出正常 | #24 完整预算、重试、租约、晚完成和版本隔离；真实运行验收 |
| AC-20 指令隔离与防递归 | [#22](issue-22.md) 产品运行时禁用执行工具、hooks/auth/MCP 不继承，恶意材料及伪造引用在 Windows/Linux 实际 CLI loopback 公共链拒绝，无员工会话回流 | 真实千问 PAYG 模型与完整 G3 验收 |
| AC-21 服务器备份恢复 | 单机容器持久卷重启演练；ACK 明示单副本 | #32 独立一致备份、新服务器恢复、报告引用、损坏检测及运行状态 |
| AC-22 安装与性能 | [#11](issue-11.md)、[#12](issue-12.md)、[#18](issue-18.md)、[#14](issue-14.md) 的 200 样本 hook 实测；稳定维护 launcher 普通条件 P95 85.44 ms，保留长尾 | 并行满盘 P95 **111.35 ms** 超标记录保留；需优化/复验、安装两分钟与原文 60 秒指标、登记负载 |

## 门槛

| 门槛 | 状态 | 决定性未完成项 |
| --- | --- | --- |
| G0 / #10 | 未通过 | Desktop 实际 UI 自动采集和服务器独立续聊；当前环境 Codex workspace-write 被宿主退化为 read-only；全部材料/历史/工具样例支持矩阵 |
| G1 / #15 | 未通过 | fallback确定性崩溃恢复已修；Windows初次安装控制端点无响应仍需tight-loop诊断；Desktop图标与登录/重启/休眠、完整安装演练和第二人复现 |
| G2 / #21 | 未通过 | 可独立资格材料来源已集成但不替代门槛；在已通过安装的三来源上复跑完整故障矩阵、覆盖未知关系和支持组合 |
| G3 / #25 | 未通过 | #22 已为 loopback 准备；#23/#24，真实 Claude Code + 指定千问 PAYG 模型、核实价格与预算 |
| G4 / #33 | 未通过 | #28–#32、页面/性能检查、第二人运维复现、门槛通过后的五个工作日试点与负责人签收 |

门槛按顺序验收。代码或合成回归通过只证明所测行为，不解除尚缺真实条件的门槛，不关闭未验收票据。性能实测达不到目标时保留失败值和具体优化方案。

## 复现与外部条件

- 基线 [Linux CI](https://github.com/yiwer/Skynet/actions/runs/36400612859/job/108857308920)：类型检查、构建、17/17 普通测试通过。
- #19 主会话集成 `1665d08` 的 [Linux CI](https://github.com/yiwer/Skynet/actions/runs/36670850420/job/109745319778)：类型检查、构建、19/19 普通测试通过；该轮早于 #14 集成。
- 分析及材料资格集成 `f6ccbca` 的 [Linux CI](https://github.com/yiwer/Skynet/actions/runs/36675975531/job/109760915991)：28/28、0fail/0cancelled，100.38秒；早于 recovery 修订，与其 Windows24项是不同环境/源码/总数。
- 原生测试须显式选择本机安装的实测版本，使用隔离配置和合成材料；命令及证据见各票文档。loopback 模型应标记为替身，不作真实千问计费或质量证明。
- 外部研究与诊断在执行机 `%TEMP%/skynet-v1-implementation/`；进入最终验收的关键脚本与证据索引需成为仓库内可复跑材料，不能仅依赖临时目录。
- 需专用 Desktop 测试环境，以及包含千问 PAYG 模型/专用凭据的配置路径和测试预算。不得猜测现有环境 Key，也不得将真实用户的会话或登录凭据复制到测试目录。
- 五个工作日试点、第二人复现和产品负责人签收须有实际参与者与记录，不能由代理的合成测试填写通过。

## 2026-09-30 G0 增补集成

`497e8da` 通过 `3fb6454` 无冲突合入。六项真实安装二进制、loopback 合成模型的原生增补回归通过；这是已测技术行为，G0仍未签收。支线全量普通流程 15/17，安装/插件本地 runtime unresponsive 两失败保持记录，#14尚在修复；详见 [#10](issue-10.md)，不能把既有 a4ca34c 的 Linux17/17通过替代当前失败。

#14 的真实旧代码升级所需 a4 编译产物已复制至仓库外并确认后，才重新构建主线；没有提前覆盖其旧代码验证输入。

主线 `3fb6454` 类型检查、构建与 materials/recovery 两项集成回归 2/2通过（48.15s、40.28s；材料 Web 证据 `%TEMP%/skynet-test-F9g4Oq`）。本次没有重复执行全量17项，也不声明此前两个运行时失败已修复。

## 2026-09-30 #19 主会话归属集成

`261fee9` 已与 G0 集成，保留附件行重建回执、Claude 参数化旧会话 / 代码 / 子会话场景及主会话 A→B→C 归属链。类型检查、构建、diff 检查与跨设备 / 历史 / 材料 / MCP / 搜索六项集成通过；真实 Claude ordinary 跨设备及 subagent 原位子续用冲突回归通过。证据目录和复跑命令见 [#19](issue-19.md)。

这是主会话 tracer bullet 的已测行为。关联子会话/fork 从恢复材料独立成为主会话时的员工历史归属仍开放，关联材料的捕获来源不是新增员工活动；#19 全部 AC、G2 及所有发布门槛均未因此通过。未再次执行完整套件，保留原 Windows runtime / taskState 失败，由 #14 修复集成后再测。

## 2026-09-30 #14 全量故障记录保留

本节记录 recovery 合入前的 `f6ccbca` 状态，后续修订与仍红的 Windows control 回归见下节。

`d725e48` 通过 `14e29a8` 合入维护实现；旧载荷、普通安装、插件与真实 Claude 各自定向证据见 [#14](issue-14.md)。Windows 完整批次分别为 **23 pass / 1 cancelled**，以及 **22 pass / 1 installation fail / 1 cancelled**；后者暴露 fallback 后台崩溃恢复的真实问题。取消的 maintenance tracer 不视为通过，即使测试 body 后续保存了行为证据。并行负载与未提交诊断尝试均不能据此变成此主线源码的成功证明。

#14 后续九个自有差异已按完整 SHA 核对移至独立 `Skynet-wt-issue14-recovery`，本次主线合并前是干净的 `14e29a8`。fallback 启动 ownership 失败仍在诊断，stdin UTF-8 修订未合入。当前合并只从自身源码重新构建，不使用先前 ignored dist 的未提交修订，不重复整套绕过上述失败；待 #14 修复集成后再跑最新完整套件。G1/G2 与其他门槛均保持开放。

## 2026-09-30 #22 与 #19 材料扩展集成

#22 `2af8421` 经 `73bc1bd` 合入，随后 #19 材料扩展 `73c745e` 经 `b4a60ec` 合入；两次均无冲突。保留 #14 已提交维护源码、G0 附件重建/sourceEmployee 回执、主件 origin、材料首次资格冻结，以及分析原材料 raw 锚点与当前主原件 inputLocation 语义偏移的独立字段。关联原件未资格时不进入事件账本，已有 primary 活动分类不降级，未知时间和不确定谱系不伪造为零。

主线自身源码的 typecheck/build/diffcheck 通过，分析 / MCP / 历史 / 材料 / 跨设备 / 材料独立资格 / 搜索定向 **10/10**（72.18 秒）。证据：主件链 `rOCNli`、occurrence 重写 `DR4rpF`、历史 `8hVnGg`、材料公开整链 `us6Ouo`、已有 primary / 材料增长 / 拒绝 `cYsTRx`、材料保存阅读 `RpQYSX`、HTTPS OAuth MCP `hl8Ew2`、全分页搜索 `ckFHNx`；analysis 两项为原句/原锚点契约及未配置公开 API 回归。

此合并没有源码冲突，未重复跑相邻原生场景。实际原生证据明确来自各自实现分支：#22 `2af8421` 的 Windows `B3TxgX`、Linux `oc2IFY` 实际 Claude Code 公开 worker 整链；#19 `73c745e` 的 `Ba7caC` 实际 Codex CLI 0.157.1 服务器独立材料恢复→正常审核 UserPromptSubmit→历史/新增员工归属。均为明确 loopback 合成 provider，没有付费模型或 Desktop UI 验收。完整发布门槛 G0–G4、#22 的 PAYG 条件及 G2 完整故障矩阵继续开放。

## 2026-09-30 #14 recovery 集成

`1a8eb53` 合入最新分析/材料主线，只有文档进度冲突，保留双方证据；源码无冲突。支线 typecheck/build/diffcheck 通过；强制 Disabled task fallback 的 worker/监督器崩溃恢复与 UTF8 三字节分割中文path公开采集2/2通过（88.24秒）。该支线完整24项仍为23 pass /1 fail /0 cancelled（143.18秒），安装含确定性 fallback crash通过，maintenance初次安装出现1500ms控制无响应。定向新维护路径1/1通过（171.24秒）不能覆盖该全量红结果；此前23pass/1cancel与22pass/1fail/1cancel记录同样保留。

后续诊断指针 `%TEMP%/skynet-v1-implementation/runtime-control-diagnosis-readiness.md` 准备 role/action、connect/response/server event-loop 脱敏时序与最小化压力条件，tight red-capable loop 尚未完成，不能先假定CPU负载或调大timeout。G1/G2与全部V1门槛仍开放。

recovery 合并后主线自身 typecheck/build/diffcheck 与 control保护5/5通过（2.04秒）；只有文档冲突，不重复heavy/native。完整Windows24项红结果来自该recovery支线，源码无冲突不能将它改写为主线完整通过；此前f6ccbca Linux28/28同样是另一环境/提交的证据。
