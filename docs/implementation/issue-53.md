# #53 团队到同版本使用能力画像

团队人员汇总增加「使用能力」列，显示等级、指数、可信度、待定理由和已有采集警示。列头明确标注「接入至今 · 默认」，与本页所选周、员工、Agent、项目的活动指标分开。人员顺序仍按姓名；没有样本不补分数。

## 固定数据与版本

`teamReportService` 在已有完整语义输入校验内，一次读取接入至今、默认方案的员工评估导出，然后保存列表版本与各员工的固定画像入口。HTTP、`read_team_report` MCP、导出和 Web 消费同一个团队投影，不按员工重复准备原件，也不把最新评估拼到旧团队版本。全量重算会传递到评估输入准备。

团队算法版本为 `team-report-2`。新增能力字段可选，旧版本仍可读取；旧组合未附评估时显示空值，不暗中查询当前分数。历史周工作视图继续使用原有周画像和报表链接，不额外计算能力列。

画像的 `version` 始终是固定 assessment 版本。完整画像票 #48 使用独立的 `profileVersion`，本票不复用这两个参数的含义。

## 往返导航

`apps/web/profile-navigation.tsx` 提供 `profileEntry`、`profileWithReturn` 和 `ProfileReturn`。团队入口带上员工与固定 assessment 版本，返回地址保存原期间、员工、Agent、项目、团队版本和覆盖日期页；员工一览入口保存列表周期、权重与版本。普通点击或键盘 Enter 会先固定当前浏览器历史项，因此浏览器返回与页面返回入口得到同一份列表。

返回目标仅接受有固定版本的本地 `#coverage` / `#people`，复用现有严格查询合同校验，拒绝外链、脚本、重复参数、嵌套返回以及无效范围。画像更换范围、权重或查看历史时保留返回入口。没有当前周活动的已选项目仍在筛选器中显示，不误呈现为「全部项目」。

## 公开验证

合成原件经公开上传与已确认的 Analysis 边界进入产品。新测试：

- `tests/team-capability.test.ts`：本周零活动而接入至今有评估，逐项比较员工一览和固定评估；覆盖警示、待定、空员工，后续上传、重启与历史导出一致。
- `tests/team-capability-journey.test.ts`：真实 OAuth MCP 与 Web；团队筛选 → 固定画像 → 显式返回 / 浏览器返回；不同周期和权重的员工一览；覆盖日期分页；拒绝非法返回地址；320/768/1280/1920 明暗模式下能力入口至少 44px、页面无外层滚动。

初始缺失能力字段的公开失败记录为 `02-public-red.txt`，通过为 `03-public-green.txt`。缺失 Web 能力列为 `05-navigation-red.txt`，导航通过为 `09-navigation-green.txt`。选中项目无本周活动时显示错误的公开失败为 `10-project-red.txt`，修复通过为 `12-project-green.txt`。

与既有团队、员工一览、复核备注一起运行的公开回归、真实隔离模型旅程、截图与最终提交信息保存在外部 `E:/GenCode/Skynet-evidence/v2-2026-10-04/53-navigation/manifest.json`。这些样例不替代 #54 的千会话性能验收。

```powershell
npm run build
# 使用已有 SKYNET_TEST_POSTGRES_BIN、SKYNET_OPENSSL、SKYNET_GIT_BASH、
# SKYNET_CLAUDE_RUNTIME 配置；合成 provider 只监听本机，不调用付费服务。
node --import tsx --test --test-concurrency=1 tests/team-capability.test.ts tests/team-capability-journey.test.ts tests/team-report.test.ts tests/team-report-journey.test.ts tests/capability-people-public.test.ts tests/review-notes-journey.test.ts
```

复现演示：上传历史周合成会话并完成分析 → 团队概览选择本周与员工/Agent/项目 → 对照活动为零、能力为接入至今 → 键盘打开能力画像 → 核对同版等级和指数 → 上传后续会话 → 返回仍显示原团队版本 → 员工一览切换上周与重质量 → 打开空员工画像并返回同一列表版本。
