# #39 活动记录与对话节奏

本票沿用原件、原始事件归属、原生轮次和版本化会话分析，增加一个共用活动查询。Web、OAuth MCP 和 JSON 导出读取同一追加式 `activity_revisions`，不在前端重算活动。没有读取真实员工材料或开启生产分析 Worker。

## 公开入口与版本

- `GET /api/activity`：按北京时间 `date` 及可选员工、Agent、项目、事件类型查询；设备上传凭据不能读取。
- `POST /api/activity/recompute`：用相同筛选完整重算，并核验原件；相同输入得到相同版本。
- `GET /api/activity/export`：导出同一固定版本完整有界数据。
- OAuth MCP `list_activity`：相同契约和服务。每页最多 25 项；后续页必须同时保留筛选和 `version`。默认 `section=events`，泳道完整集合按 `section=lanes` / `nextLaneOffset` 查询，来源和分析版本按 `section=inputs` / `nextInputOffset` 查询。`total`、`laneItemCount`、`inputCount` 分别明确各集合大小，单次响应上限 80 KiB；超过上限明确拒绝，不返回伪完整结果。
- Web `#activity?date=YYYY-MM-DD&employeeId=...` 使用日范围、主题筛选、固定版本翻页及导出。`activityLink({date, employeeId})` 提供给员工画像的最近活动入口；画像页面由其专属票接线。

活动版本保留不可变原件 hash、归属 revision、parser、最新适用 Analysis 版本及 `waitVersion`。固定页不受晚到原件、模型结果或投递记录改变；实时读取产生新版本。对话链接携带相同等待版本，点击跨日长等待的用户回复时仍查询该版本的同一原生边界。数据截至时间包含服务端收到原件与投递记录的时间，不拿接收时间替代来源活动日期。

`waitDataset` 提供一次有界原件读取和解析回调，并使用批量 `attributionRevisions`。`materializeWaits(client, originals, scope, clock)` 由持有 repeatable-read 事务和已验证精确原件集合的调用方使用，物化等待版本但不自行 COMMIT。`waitsService` 和活动均走此边界，后续会话产效可绑定精确来源集合。

## 事件和来源边界

列表保留时间、原员工、逻辑会话、Agent、项目、逐字摘录以及精确行、block、UTF-16 原文位置。摘录以 Unicode 字符截断，附省略号；原文不改写。按 `origin.eventId` 去重，确认恢复保留旧员工和来源日期，不把多快照前缀算成新活动。

原生 `session_meta` 有可信创建时间、同一源会话身份且不早于设备接入时，可记录会话开始，包括没有用户消息的空会话。`task_started` / `task_complete` 是本轮开始和结束；后者绝不声称会话永久关闭。永久结束和权限请求/决定在当前来源支持范围内未知，不通过普通回复、进程退出或上传空闲猜测；不生成三分钟权限等待的假事件。这遵循 PRD US175 / AC29，未知能力在折叠来源信息中可见。

长等待只取原生本轮结束至下一条真实用户消息，满十分钟；保留同员工其他会话活动的并行证据。跨午夜保留同一原生区间，泳道按当天可见部分显示，不折算工时。压缩、采集缺口和缺失来源时间分别保留；未定日期不落到上传当日。新完整快照可解决旧缺口，但旧固定活动版本仍可查询。

返工和追问只能来自最新适用、完整覆盖该条事件的模型分析。每项带逐字引用、原事件归属和 Analysis / Insights 版本；首条提示词保持提问，即使模型把它标为返工。没有完成或适用分析时不猜测、不填零。旧输入的结果迟到完成不能给新快照标返工。

仅有来源时间和提交时间差不证明离线。认证采集器的投递记录中确有断连尝试时，消息标“补传”；离线事件使用 `firstDisconnectedAt`，补传事件使用 `acknowledgedAt`，同时附不可变活动版本内的完整投递观察及 revision。`capturedAt` 不是恢复连接时间；缺记录保持未知。投递事件链接采集链路，不能伪装成一条用户原句。

## 展示与可访问性

每名员工一行，按姓名排序；会话按 Agent 着色，提问实心点、返工空心点、长等待灰段，当前日期有现在线。记录区间表示已观察到的来源边界，永久结束未知。泳道与表格使用同一完整分页集合，键盘焦点显示相同提示，Enter 跳原文，Escape 收起提示。

复用现有原型的设计令牌和页面壳；活动区域内部滚动，筛选留在顶部。支持 320 / 768 / 1280 / 1920 px、明暗主题、空范围、窄屏日期控制。截图在导航过渡和 ResizeObserver 稳定后取得，禁用截图动画；实际 SVG 员工标签在 320 px 仍保持可读大小。按需展示分析和投递依据，不增加营销、测试或成段说明文字。

## 验证与复跑

测试沿用 PRD 2026-09-28 已确认的公开上传、HTTP 查询、OAuth MCP、Web 和 Analysis 外部边界。合成原件先经上传协议保存，再由真实服务计算、持久化与查询；不直接写业务结果表。返工/追问测试使用确定性的 Analysis 外部边界替身，通过真实队列、引文验证和结果提交；本票不把替身说成真实模型结果，#38 的隔离 Claude 原生链证据仍由 #38 台账保留。

```powershell
$env:SKYNET_TEST_POSTGRES_BIN = 'C:/Users/yiwer/AppData/Local/Temp/ticket28-pg-0eb735e987dc48d186870e8a96801e01/bin'
$env:SKYNET_OPENSSL = 'D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_ACTIVITY_EVIDENCE_DIR = 'E:/GenCode/Skynet-evidence/v2-2026-10-04/39-activity'
npm run build
node node_modules/tsx/dist/cli.mjs --test tests/activity-public.test.ts tests/activity-inferences.test.ts tests/activity-journey.test.ts tests/waits-public.test.ts tests/waits-edges.test.ts tests/waits-journey.test.ts
```

公开旅程包括两员工姓名排序、32 条活动的 25/7 固定分页、OAuth MCP 对照、晚到变为 33 条且旧页不变、重启后旧页不变、图表/33 项表格一致、键盘原文跳转、刷新获得第 34 条，以及八张稳定主题截图。HTTP 另覆盖多快照去重、恢复员工归属、缺口解决、纯会话创建、跨日 600000 ms 等待（59000 / 541000 ms）、同等待版本对话定位及认证断连/补传记录。首条返工、实时刷新、补传时间、分页边界均有先失败后通过的回归。

证据目录为 `E:/GenCode/Skynet-evidence/v2-2026-10-04/`，`activity-*-red.log` / `*-green.log` 保存纵向切片；`39-activity/evidence.json` 保存固定版本、页数、截图、计算的文字对比度和浏览器错误。CSS 文字颜色通过浏览器 sRGB 转换计算，检查 4.5:1（大字 3:1）；OS 弹出的下拉选项、禁用态及完整辅助技术兼容性不由这个计算替代人工验收。

AC32 的 1000 会话最终性能验收由 #54 集中处理，本票未声称通过。归属 revision 已批量准备，但 `waitDataset` 内逐快照完整性、origins、waitInput 及 Insights 的再次核验仍需计时；不能绕过原件可读性、SHA-256、归属变化或历史版本以换取速度。


### 2026-10-04 收口记录

功能提交 `0305771`，共享等待物化边界提交 `fb2f5de`；已合入独立验收后的 #40/#43 集成 `91544e8`，以及纯部署/进度文档 `f7bc457`。窄接线冲突保留两个服务的 migration、HTTP 与 MCP 入口，没有修改对方业务算法。

`npm run build` 通过。最终八个测试文件 11/11 通过（47.70 秒）：活动公开查询 3、模型推断边界 1、活动 Web/OAuth MCP 1、原等待公开/边界/旅程 4、等待统计公开/旅程 2。额外等待统计测试保护共同物化接口不会改变已经集成的 #43。证据为 `activity-final-build.log` 与 `activity-final-regression.log`。

#40 同事独立只读核对 API 与 320/1280 截图，确认固定等待导航和未知来源处理；指出首条返工与 Escape 后，分别取得 `activity-first-rework-red.log` 和 `activity-tooltip-red.log`，修正后 `activity-review-green.log` 2/2 通过，并包含在上述最终 11 项回归中。八张主题截图的文字对比度最低浅色 4.76:1、深色 6.21:1，浏览器错误列表为空。早期切换主题过渡帧的即时计算不作为对比度验收；最终计算发生在有限动画完成后的稳定截图之后。

本工作树不部署、不关闭远端 Issue。合并与发布由独立集成流程执行；原生权限与永久会话结束仍按来源支持边界保留未知，完整 AC32 性能和真实用户签收不在本票虚报完成。

### 2026-10-04 导航修复

线上操作发现快速修改日期并点击「应用」会回退日期。新增公开浏览器回归使用两个来源日期、各自两条合成活动，在同一浏览器任务中发出日期 change 和按钮 click：RED 记录 change 后 hash 为 `2026-10-05`，apply 后回退 `2026-10-06`。修复从当前 URL 合并新的筛选，并仅在已呈现的同一 hash 上允许显式刷新，避免用尚未更新的 React 状态覆盖新导航。

复现同时发现首次读取的竞争：组件先初始化筛选，挂载 effect 又生成同值的新对象，可能导致两个读取争用同一计算锁并返回 409。筛选现在按 hash 直接派生并保持稳定引用；项目表单的状态同步不再重新生成查询。公开浏览器检查首次进入当前日只发起一次活动请求，并仍验证日期、页面范围和活动原句一致。此改动不涉及服务端查询、归属、指标或版本算法。

`tests/activity-navigation.test.ts` 的固定版本与当前版本两种入口 **2/2 GREEN（31.94 秒）**。合入最新集成 `ea1b6ca` 后，构建通过；该文件与完整 `tests/activity-journey.test.ts` 共 **3/3 通过（51.91 秒）**，继续覆盖 OAuth MCP、旧版分页与导出、晚到更新、图表/表格、键盘原文跳转和八种尺寸/主题截图。证据为 `39-activity/navigation-{red,green,cold-red,cold-green,final-build,final-public}.txt` 及 `navigation-final-browser/`。首次冷导航锁冲突确有时序依赖，因此也保留一次未复现的运行记录，不将单次通过当作根因验证。
