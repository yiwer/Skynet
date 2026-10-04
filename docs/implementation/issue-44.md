# #44 团队概览与员工周使用画像

团队概览保留 V1 员工×日期覆盖矩阵，并在同一范围内呈现使用 KPI、每日趋势和姓名顺序的人员汇总。员工周工作视图增加使用画像，三个报表链接携带员工、原周日期、Agent、项目和各自固定来源版本。

## 交付边界

- 本周 / 上周 / 接入至今，以及员工 / Agent / 项目，作用于整页业务指标与活动。设备采集观测仍描述设备和来源；按项目筛选不声称能证明该项目连续采集。
- KPI：活跃人数/总人数、已知 Token 与未知会话数、已验证结果/仅声称、代码增删行、响应等待中位数。每日 Token、验证结果、代码趋势有等价表格、可聚焦的 44px 详情入口和 Escape 关闭；无来源的 Token 不补成零。
- 人员汇总包括会话、Token、验证结果、代码、提示词、返工分子/有效分母/未知、等待及覆盖状态。人员按姓名，不按得分或 Token 排名。能力入口由 #53 接入，不放占位分数。
- 周视图的画像沿用原周一至周日语义。可以读取历史周，但通用报表的实时入口仍只有三个期间；`week` 必须与固定版本匹配，不能成为任意实时日期范围入口。
- 覆盖矩阵每页 7 天，默认显示所选期间最后 7 天。更早/更晚日期必须固定团队版本；页面 KPI、期间趋势与人员汇总总计不随矩阵翻页变化。单次 HTTP / MCP / 导出投影不超过 80 KiB。10 人、4 周公开样例已覆盖该边界。

## 同源与持久化

`apps/server/team-report.ts` 每次组合只准备一份用量导出、一份绑定该用量版本的提示词报告、一份相同范围的等待报告，不按员工重复准备原件。`team_report_revisions` 保存完整组合；固定版本读取和覆盖日期翻页不读取最新指标。导出与 MCP `read_team_report` 返回相同的页投影，沿 `coverage.nextDateOffset` 读取其他覆盖日期。

共享 `consistentReportingInputs` 在完整读取前后比较语义输入，最多三轮。仅本模块额外纳入覆盖使用的成员/设备启用状态、心跳有效性及过期判定、采集观测、日报状态。额外输入在前后各自的 REPEATABLE READ 中获取；不传回调的评估服务保持原指纹协议。持续变化返回 409，不保存混合组合。

每日产出沿现有贡献事件的去重结果，按原员工/原来源日期聚合。矩阵的轮次、工具及 Token 列使用该团队版本冻结的员工每日指标，避免旧矩阵与另一份实时统计拼接。V1 侧栏仍可打开各自的原文、统计与日报版本。

HTTP 入口：

- `GET /api/team-report`、`GET /api/team-report/export`
- `GET /api/team-report/weekly?week=<周一>&employeeId=<员工>`
- `POST /api/team-report/recompute`、`POST /api/team-report/weekly/recompute`

重算复用公开上传的原件全量路径；未变输入与增量计算同值同版本。旧组合在补传、健康观测更新、服务重启和跨周以后仍可读取。缺失/未分析保持未知，权限等待未持久化时显示未知。

## TDD 与验证

公开失败及修复记录在外部 `E:/GenCode/Skynet-evidence/v2-2026-10-04/44-team/`，不包含个人真实原件。

- `03-public-red`：缺少团队 HTTP 入口；`05-public-green`：不变输入重复读取版本漂移，追到等待报告 scope 键顺序并修复 canonical identity；`06-public-green` 通过。
- `07-week-red` → `09-week-green`：历史周读取、过滤、拒绝非法/不匹配周。
- `10-coverage-red` → `11-coverage-green`：组合保留覆盖矩阵与缺口。
- `13-journey-red`：缺少来源日期产出；`17-journey-green` 暴露无间隔时固定等待页丢失所选员工；修复后真实模型/OAuth/Web 路径通过。
- `20-recompute-red` → `21-recompute-green`：公开全量重算与固定版本一致。
- `22-frozen-day-red` → `23-frozen-day-green`：矩阵日列来自同一固定输入。
- `25-shared-green` 暴露旧 V1 首次 hash 导航同值重复请求导致计算锁 409；前端避免无效同值状态更新，`30-http-legacy-green` 4/4 通过。
- `27-window-red`：10 人、4 周返回 413；`28-window-green`：7 天覆盖投影、后续页固定版本及上限测试通过。
- `31-window-journey`：真实隔离 Claude Code + 合成 loopback provider，筛选、下载、OAuth MCP、周画像和三张报表跳转、覆盖翻页/键盘一致，1/1 通过。24 张截图覆盖 320/768/1280/1920、明暗及团队顶部/底部/周视图，均无外层滚动。
- 集成最新 V2 后构建与最终回归结果见同目录 `32-integrated-build.txt`、`33-integrated-green.txt` 和 `manifest.json`。

复现环境：Node 24.21.0、隔离 PostgreSQL 18.6、OpenSSL、真实 Claude Code 2.1.281；模型请求只发测试创建的本机合成服务，无付费供应商请求。

```powershell
npm run build
# 使用仓库已有的 SKYNET_TEST_POSTGRES_BIN / SKYNET_OPENSSL /
# SKYNET_GIT_BASH / SKYNET_CLAUDE_RUNTIME 配置运行隔离环境。
npx tsx --test tests/team-report.test.ts tests/team-report-journey.test.ts tests/team-coverage.test.ts tests/assessment-concurrency.test.ts
```

演示：上传合成会话并完成分析 → 团队概览选择期间/员工/Agent/项目 → 对照 KPI、趋势表与覆盖矩阵 → 导出当前版本 → 点击人员“周工作” → 使用画像进入用量、提示词或等待报告 → 对照同一固定范围 → 接入至今下翻阅更早覆盖日期，期间总计保持不变。

本票未把少量样例耗时当作 AC-32 签收。10 人、4 周、1000 会话首读/后续 P95 的最终整体验证仍属 #54。

独立审查指出导出与文本入口的实际命中区域仍小于 44px。正式浏览器旅程补充五类入口在四种宽度/两种主题的尺寸断言，`34-touch-red.txt` 复现后，仅扩展导出、口径链接、完整报表、员工周工作与口径 summary 的真实命中区域，不改变文字层级、指标或版本。后续构建及完整旅程证据为 `35-touch-build.txt`、`36-touch-green.txt`。
