# #37 等待回复与并行活动

2026-10-04。对应 [GitHub #37](https://github.com/yiwer/Skynet/issues/37)、PRD-v2 AC-24/26/29。继承 #34 原始归属/可重算结果、#36 对话与 Trace，新增一条可公开访问的等待记录路径；不改原件、原有 conversation-2/3 游标及正文预算。全部材料与员工均为合成，未读取真实员工目录或写生产。

## 原生来源与边界

| 客户端 | 本轮结束与下一条用户消息 | 权限等待 |
| --- | --- | --- |
| Codex CLI / Desktop | Codex `rust-v0.160.0` 的 `event_msg.task_complete`（`turn_complete` 别名），`turn_id` 与有效时间；优先有效 `completed_at` 整数秒；字段缺失时使用行时间，显式无效值未知。配对原件顺序下一条业务 user；`task_started`/`turn_started`、`turn_aborted` 保留活动/中断语义。结束不是永久关闭会话。 | 当前 rollout 不持久化请求/决定，返回 `null` / `unknown` |
| Claude Code CLI | 已归档 transcript 可定位 user/assistant，但没有可信且已持久化的最终 Stop 边界；可发现一个待确认间隔，耗时保持 `null`，不以 assistant 时间猜结束。 | 请求 hook 没有可验证的请求/决定配对、标识及决定时刻，返回 `null` / `unknown` |

依据：[Codex 固定版本 protocol.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/codex-rs/protocol/src/protocol.rs)、[rollout policy.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/codex-rs/rollout/src/policy.rs)、[Claude hooks 官方文档](https://code.claude.com/docs/en/hooks)。Codex 的协议类型存在并不证明 rollout 记录该类型；`ExecApprovalRequest`、`RequestPermissions`、`ApplyPatchApprovalRequest` 在策略中不持久化。Claude Stop 可被阻止继续，回调时 transcript 也未必已落盘。没有创造 `permission_decision` fixture 或从工具执行结束猜用户批准时刻。

纯环境封套、系统/开发者内容、工具结果与 Claude 明确标识的 compact/meta 不是下一条用户回复。末尾结束事件没有后续真实 user 时不生成等待。重复 completion 不重复配对；同一 turn 的冲突结束时刻为未知。另一个 turn 仍活动时，一个 completion 不代表 Agent 已等待输入；中断不产生正常回复等待。时间倒序、缺失时间或归属不足保持未知；历史上下文不变成接入后等待。

## 计算、版本与接口

- `packages/native/waits.ts` 读取原生边界；`apps/server/wait-inputs.ts` 以原件 hash、快照和解释版本持久化轻量角色/时间投影，不重复保存消息正文。`wait_input_revisions` 只追加，重算可绕过缓存。
- `wait-dataset.ts` 读已提交原件并核验完整性；沿核验恢复链识别逻辑会话，子材料恢复保持子身份，未确认复制保持分离。原始员工/项目与事件资格来自现有不可变归属及追加资格证明。同一员工的所有 Agent/项目都参与并行检索，主报表筛选不会排除其他项目的证据。
- 等待按下一条 user 的原始 eventId 去重。同一逻辑会话的多快照、续聊、服务器验证恢复前缀不会变为其他会话，也不增加等待。不同逻辑会话的重叠等待分别保留；不合并成一个人的时间长度。
- 并行只取开区间 `(结束时间, 用户回复时间)` 内同员工其他逻辑会话的业务来源事件。恰在端点的相邻事件、其他员工、自己的恢复副本排除。`not-observed` 表示原件中未观察到，不表示人在空闲。每段最多三个可点击证据点，算法使用来源时间索引与同会话跳跃，避免逐段扫描全部事件。
- 报表仅本周、上周、接入至今，按北京时间跨日拆分。完整间隔 `durationMs` 决定 `>=600000` 的长等待；`durationInScopeMs` 与 daily 只计所选日期的交集。缺失值不填零；known 部分与 unknown 段数、来源缺口分开保存。权限次数/时长均为 `null`，不伪报零。
- `wait_revisions` 冻结计算口径、范围、全部并行证据输入、原件 hash、归属修订及逻辑会话解释。迟到/补传或资格变更生成新版本，旧版本可在重启、翻周后继续读取。增量与强制原件全量重算产出相同版本。日期筛选不使用上传时间。
- `GET /api/waits`、`POST /api/waits/recompute`、`GET /api/waits/export` 与 OAuth MCP `read_waits` 共用 `waitsService`。全部要求个人读取身份，设备凭据不能读取。支持 `snapshotId` 或报表 period/employeeId/source/project；每页25段，后续页必须传 `version`；导出是该固定版本的全部结果，不截断。重算不接受旧 version。
- 对话读取可带 `snapshotId + lines`（最多25行）取得独立标签，不改变现有对话分页。报表→对话使用 `waitVersion`；服务通过 `version + contextSnapshotId + lines` 仅取固定报表版本中对应原件的标签。原件结束锚点与用户对话锚点分别提供，不把未渲染的生命周期事件假装成对话消息。
- 单次计算限20,000快照、100,000业务事件、128 MiB主原件扫描预算；按员工或原件查询缩到相关员工及必要恢复谱系。页面/工具主体80 KiB，完整导出16 MiB。超过范围返回413，不悄悄截断总数。并发同范围计算返回409，可固定版本读取或重试。

## Web 路径

侧栏“响应与等待”提供三种时间范围、员工/Agent/项目筛选、已确认等待/未知、长等待与权限等待、按日表、分页明细、重算和固定版本导出。对话中在真实用户消息前呈现等待时长、长等待及并行提示；来源链接与规则按需展开，不为每条消息添加泛化说明。页面沿原型主题变量、按钮交互与现有布局，外层固定，报告内容/对话区域独立滚动。

这是 #37 的完整等待记录切片；PRD 的中位数/P90、星期热力图及完整响应分析由后续报表票按同源结果扩展，不用未知数据制作图表。

## 可复现验证

```powershell
$env:SKYNET_TEST_POSTGRES_BIN = 'C:/Users/yiwer/AppData/Local/Temp/ticket28-pg-0eb735e987dc48d186870e8a96801e01/bin'
$env:SKYNET_OPENSSL = 'D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_WAITS_EVIDENCE_DIR = 'E:/GenCode/Skynet-evidence/v2-2026-10-04/37-waits'
npm run build
node --import tsx --test --test-concurrency=1 tests/waits-public.test.ts tests/waits-edges.test.ts tests/waits-journey.test.ts
```

使用独立 PostgreSQL、临时 TLS CA、设备公开上传、个人 HTTP 读取、真实 OAuth/PKCE MCP 和 Playwright 浏览器，不插入私有统计表或调用内部帮助函数替代用户行为。测试会创建合成员工并从公开页面进入“响应与等待”，切换接入至今，翻26段记录的两页、进入对话、展开等待标记并跳到结束事件原件。

| 公开行为 | RED → GREEN |
| --- | --- |
| 原生结束→下一条真实用户、末尾空闲、权限未知 | 未实现端点404 → 一段600秒，环境封套不结束等待；原件hash/字节不变 |
| 599/600/601秒、午夜、迟到其他项目/Agent、其他员工、端点相邻 | 无报表查询400 → 阈值/按日总和正确；迟到并行更新当前版本，旧版本保持；恢复前缀不增加段数；全量=增量 |
| 重复/冲突结束、同时活动的轮次、中断、倒序、Claude未知 | 重复 completion 误生两段 → 仅一段；缺边界/冲突不生成确定耗时 |
| 下一条用户缺时间、不同会话重叠 | 未知间隔误丢失为0 → 保留未知；两个重叠会话独立计数并互有来源活动 |
| HTTP/MCP/导出/对话及重启 | MCP缺少工具 → OAuth读取与HTTP全字段相同；26段分页与全导出一致；固定版本重启可读；报表跳转对话标签使用同版本 |
| 布局与证据锚点 | 亮/暗1440、390、320截图与外层无滚动断言；等待来源展开与原件定位，浏览器无pageerror |

有效RED/GREEN日志、截图、浏览器JSON及SHA-256索引保存在上述外部证据目录。最终集成验证记录在收口段补充。

## 最终集成与边界回归

已将集成 `ec9b2d3`（#34/#35/#36/#38）合入本票；合并只解决 app/MCP 参数及侧栏路由接线，保留等待、组装、处理、洞察全部入口。`09-integrated-public.txt` 的七项公开集成中六项首轮通过，既有来源状态浏览器校验发现两个折叠区复用同一定位类；拆出独立等待区域后，`11-final-ui-green.txt` 两项定向公开旅程通过，包含 #36 全部上下文、长消息、工具跨页、原生状态、投递状态和 OAuth MCP 行为。组装公开旅程和真实隔离 Claude 洞察在本轮共同接口集成上也通过。

额外收口：完整续传到达后，当前逻辑会话覆盖可解除旧未完成前缀造成的未知，旧快照仍保留未知（`07-continuation-red/green.txt`）。有效完成事件配缺失用户时间时，页面不能把零个已确认间隔显示为零时长，`12-unknown-ui-red.txt` 复现后修正。重新核查官方 `TurnCompleteEvent` 的 `completed_at: Option<i64>` 为整数 Unix 秒；缺失可取 rollout 行时间，显式损坏值保持未知，`13-native-time-red.txt` 复现后修正，没有保留无法由该原生类型产生的浮点 fixture。上述边界与完整 OAuth/Web 旅程在 `15-final-boundaries-green.txt` **2/2 通过（31.40 秒）**；`14-final-build.txt` 的 TypeScript 与 Vite 构建通过。

最终亮/暗 1440、390、320 px，以及320/390的等待/并行来源展开和320的未知状态，共10张稳定截图已检查。截图等待侧栏最终边界并使用 `animations: disabled`；最窄宽度下筛选、长等待与并行提示自然换行，根文档没有横纵滚动，浏览器无pageerror。早期 `waits-report-narrow.png` 是响应式过渡中间帧，保留作过程记录，不计最终视觉证据。测试与图像SHA-256清单见外部 `manifest.json`。

本票未部署、推送或关闭远端票；由独立 merger 继续集成。AC-32 的千会话延迟由 #54 对集成版本继续验证，本票不以小型合成旅程声称达到该性能门槛。
