# #29 周工作与项目进展公开流程准备

状态：基于组合主线 `0743d4d` 的独立准备，已组合材料资格修订 `1c41d21`；正式 #29、G3 与全部 V1 门槛仍开放。公开链路使用合成原件和隔离分析环境；真实 Claude Code loopback 不代替千问模型质量、PAYG 或实际运营周一 09:00 验收。

## 已实现行为

- 周一北京时间 09:00 将上一周周一至周日持久入队；重启后仍能发现最近到期周。首次部署只从最近到期周开始，不从旧会话回填多年历史。停机追补每 tick 至多四周，游标只前进到已建期间末尾；后台每次处理两个视图。
- 周工作引用固定员工、来源日期的日报版本；项目视图支持 1–31 日跨周区间及多员工，同一原项目按日期组织目标、推进、会话内成果、阻塞和待继续事项。空项目保留「未归类项目」，未解析或无已确认活动时保留材料不足。
- 入队直接经过日报共享 `analysis.request(snapshotId,null,{trigger:'scheduled'})` 创建目标。管理者不用逐会话配置或手动申请分析。配置、原件散列、parser、generation、租约、有限尝试和预算仍由 #24/#23 负责。
- 相同原项目的相同主题文字连接跨日事项，并显式标为推断关联；未关联事项按员工、日期、分析和内容保留独立。结论继续保留 claimed/inferred/observed/insufficient 与原始引用，不把声称成果改成已核验交付。
- 来源日期、原员工和原项目不随当前上传者改变；历史/材料背景单列。参与者必须有该范围的已确认原活动。完整输入处理只指选定的已知输入，按日设备覆盖及未到达活动仍未知。

## 版本与接口

- `GET/POST /api/work-view?kind=weekly|project&subject=...&from=...&to=...`、`GET /api/work-views`、`GET /api/work-projects` 与 Web「周工作与项目」共享服务。周 subject 是员工 UUID、起始日期必须周一且终止周日；项目 subject 是原项目完整字符串（允许空）。HTTP 拒绝 clock、actor 或未知字段，所有读写认证。
- MCP `read_work_view`、`list_work_views`、`list_work_projects` 只读同一服务及不可变版本。分页使用 `offset` 和固定 `revision`；每页至多20事项且约80KiB，MCP96KiB护栏保留。
- 每版冻结 `dailyRevision/dailyVersion/originalEventHash` 和日报链接、原始分析引用及输入范围。`#daily?employeeId=...&date=...&revision=...` 打开所引用的固定日报；继续点原句进入 raw/material 锚点，语义 inputLocation 不加到原材料 JSON 坐标。
- 准备日报之后，事务以 REPEATABLE READ 一次选择所有日报版本。全局 try-advisory lock 防止多视图占满连接池；持久 generation/refreshPending/refresh_daily 兑现忙碌期间请求，过期生成回滚。手动请求刷新选定日报，旧周/项目版本不重解释。#30 接续迟到输入自动刷新、人工更正及覆盖期间传播。
- 日报新增冻结的 `coverage.projectStatistics/projectStatisticsComplete`（最多100项目 / 16KiB），共用原统计投影。周统计求和固定日报统计；项目只求和同日报版本内相应原项目计数，绝不把其他项目或最新账本混入旧版。旧日报没有逐项目计数或超界时返回未知。文件、原生 token、区间和人工工时仍为 null，待 #31。
- 当前项目候选、日报原活动及逐项目计数共用 `effective_event_origins`。日报冻结 `coverage.qualificationRevision`；周/项目每个日引用保留实际及预期资格修订。可信证明改变期间资格、或引用日报出现新版时，既有周/项目自动转待刷新；未追上资格的日报显示 `stale-qualification`，不能把旧计数当新版完整结果。原材料 owner/project/date/eventId、原件和固定旧报告都不改写。
- 一版至多处理50员工/日输入、500事项和2MiB事项输入。超界标 partial、显示范围，仍可打开固定日报；缺失日报、前接入或未到日期、unknown raw、关联材料、长分析失败/跳过/省略均不推成零。没有项目输入的计数是 null。来源元数据超过56KiB时明确413并要求缩短区间；项目和期间列表按48KiB分页，不默默删掉来源版本。

## 验证

隔离 Windows Node24、PostgreSQL17、私有 HTTPS/OAuth、headless Web；所有新增 child `windowsHide:true`。没有真实 Task 安装、maintenance 或压力循环，没有真实员工数据、用户配置或付费 provider。

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 公开跨周 fixture `tests/work-views.test.ts` **2/2 PASS（20.82s）**，证据 `%TEMP%/skynet-test-bRZZKd/work-view-public-evidence.json`：4原件、2员工、3项目含空项目、两周来源边界、同主题跨日、项目5活动/30事项20+10分页、原员工与项目精确计数、自动 system 任务、固定日报引用、HTTP/OAuth MCP同版、Web日报→原句、重启和raw字节不变。
- 相同公开路径实际 Claude Code2.1.281 **1/1 PASS（24.70s，总25.41s）**，证据 `%TEMP%/skynet-test-gFh4Zc/work-view-public-evidence.json`；四个原生分析请求均仅到隔离 loopback。fixture 的业务结论由确定性提供者产生，不是实际千问质量证据。
- 可信内部 `reportClock` 只控制报告自然日/周调度；测试从合成未来周日推进至周一09:00及下一周，正常登记设备和公开上传原件，没有回写 enrollment/event/provenance/预算时钟或直接插业务事件。它证明排程政策和跨周行为，不声称真实经过两个运营周。
- 首轮 **1 pass /1 fail（23.75s）** 在项目列表暴露错误 SQL：读了不存在的 snapshots.project；已改为 manifest 项目字段，保留失败记录，没有把最初失败当通过。
- 日报、长范围、OAuth MCP与周/项目小批 **6/6 PASS（17.04s）**，最新普通证据 `C47NHq`，长范围 `91ywKj`，MCP `Rt6v1t`。
- 加入运行时离线期间的自动恢复后，公开 **2/2 PASS（32.17s）**，`DIMgqv`；实际Claude同链 **1/1 PASS（31.18s，总31.91s）**，`du6LJQ`。离线先保存无结论版本，worker恢复后由后台更新，未再POST申请周报；旧离线版仍可读。未知原件范围仍使本版partial。
- 最后元数据边界后的一轮初始化被 Docker engine 全局无响应阻断：**1 pass /1 cancelled**，public120s超时，进程总343.89s，尚未到私有sandbox初始化返回。独立 `docker ps` 同样无响应，backend显示error-dialog；不是周报业务断言失败。仅live核对 Name/ParentProcessId/CommandLine/CreationDate后的本轮Node与Docker CLI被终止。恢复后核对唯一待建 `skynet-test-93c69580-f2cb-49c5-a08e-4827de40b443` 不存在，没有触碰其他容器或数据。
- engine恢复后最终元数据边界源码的同一公开测试 **2/2 PASS（30.09s）**，`%TEMP%/skynet-test-zj0csr/work-view-public-evidence.json`。该结果不改写前次初始化超时。旧 TEMP 资料有缺失，原因未知；以上历史运行结果保留，当前可用的组合证据另存持久目录。
- 组合 `1c41d21` 后，`npm run typecheck`、`npm run build` 通过；材料资格、跨周项目、日报与 OAuth MCP 定向 **6/6 PASS（58.63s）**。材料证据 `04AMYa`、周/项目证据 `AEsO22`：材料先被 B 保存为背景，A 经正常采集证明接入后活动，新日报由0变1，原项目与包含该日的既有周报无需再次 POST 即自动更新；原员工/项目/日期及材料锚点保留。
- 组合源码真实 Claude 自动周/项目链 **1/1 PASS（29.11s，总29.78s）**，`1hfWI0`，四次 loopback 请求；Web/MCP、重启、系统任务、来源日和 raw 字节同样验证。没有真实 Task 或付费调用。
- 固定版本响应追加逐字校验后，材料公开链 **1/1 PASS（9.44s，总17.24s）**，`FD77yr`：旧周和项目固定 revision 的 HTTP 文本与资格证明前完全相同，不仅计数相同。
- 四份安全 JSON 已复制至 `F:/GenCode/Skynet-evidence/v1-2026-09-30/issue-29/`，文件名为 fixture ID 加原证据文件名；每份与来源 SHA256 核对一致。目录只保存合成结果，不含测试私钥、员工凭据或用户配置。

复跑：

```powershell
npm run typecheck
npm run build
node --import tsx --test tests/work-views.test.ts
$env:SKYNET_CLAUDE_RUNTIME='C:/Users/Administrator/.local/bin/claude.exe'
node --import tsx --test tests/native-work-views.test.ts
```

## 接续与门槛

#19 后资格 material 的有效分类已由 `1c41d21` 组合，项目候选和日报投影使用同一分类，资格变化传播至既有周/项目；旧日报/周/项目版本仍冻结。#30 负责自动迟到/更正，#31 完整统计与覆盖，#32 灾备。真实千问模型/配置/价格/预算、Desktop UI、负载与运营09:00、第二人复现、五日试点和负责人签收保持开放；#29 准备不关闭 G0–G4。
