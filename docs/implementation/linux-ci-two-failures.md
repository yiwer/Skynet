# #54 Linux CI 的两处剩余失败

2026-10-04。输入为集成 `79f24e1` 的两片真实 Linux CI 产物，共 235 tests、233 pass、2 fail、0 skip。原始失败保留在外部 `ci-79f24e1-shard2/tests.txt`；本片不把本地复测称为新一轮 Linux CI 通过。

两个原用例在独立作者树、原始源码上均失败：`assessment-model-public.test.ts` 的零产出场景得到 `insufficient` 而不是 `unknown`；`v2-public.test.ts` 从用量页面返回会话时找不到固定洞察链接。证据目录为 `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-linux-two-failures/`，`02-original-reproduction.txt` 保留本地原样 0/2 结果。

## 评估 fixture 的日期

公开响应排除了丢会话、随机 UUID 排序与员工归属问题：三会话、45 条提示词都在。默认 fixture 从执行当下时刻开始生成来源事件；15 轮长等待跨度约 2.5 小时，晚间执行跨过北京时间午夜。本次来源日期为 10 月 5 日与 6 日，累计 Token 的已知部分仍为 3000，但前一业务日期没有可归属 Token，三会话整体均带未知。因此产效比指标实际只有 0 个 Token 已知样本，样本不足是该输入的正确结果，未触达本测试意图验证的“三个 Token 已知会话、同类任务产效比基线为零”。

默认合成来源起点固定在未来工作日北京时间 10:00，不改变 15 轮、长等待时长、样本门槛、模型和原评分断言。新增公开前提断言：三个会话、一个活动日、未知 Token 会话数为 0，合计输入 Token 3000。显式日历边界测试仍可覆盖 `fixture.base`。`05-time-green-navigation-probe.txt` 中原零产出/恢复/历史完整用例已 GREEN，导航失败仍 RED，证明两者独立。

## 用量页面的重复读取

`03-public-observations.txt` 与 `04-navigation-dom.txt` 显示 API 有正确的固定 `insightVersion` 链接，浏览器实际显示 409“该指标范围正在计算”，没有会话表格。`05-time-green-navigation-probe.txt` 捕获一次普通导航在 7ms 内发出两条完全相同的 `usage-output?period=this-week&offset=0`；第二条返回 409。不是过时链接选择器。

导航同步挂载 `UsageMetrics` 后，初始 effect 已开始读取；随后到达的真实 `hashchange` 再以等值新对象设置 query，取消浏览器第一条读取并启动第二条。服务端第一条计算仍持有范围锁，第二条遇到既有并发保护。本片仅让该页面按规范化查询参数同步 hash：等值选择保留原状态，不重新启动 effect；不同筛选仍正常更新。没有修改服务端锁、事务、重试、缓存、响应容量或期限。

原完整 V2 公开旅程保留原文逐段、工具、原句/搜索跳转、恢复、固定版本、导出与 HTTPS OAuth MCP 全部断言。新增同一页面 hash 的 Codex 筛选与恢复全部 Agent 两步，验证幂等修复不阻断真实范围变化；也明确初次读取结束后不得出现“重试指标”。`07-navigation-green.txt` 完整旅程 1/1 PASS，19.266 秒。

## 验证边界

`08-focused-regression.txt` 的 9/9 定向用例全部通过（131.803 秒）：评估原始指标、零产出与样本门槛、71.4/71.5 分档、原生多文本块更正、三方案、零权重/未知、固定历史、北京周界，以及用量 Web/HTTPS OAuth MCP/导出。`07` 的完整 V2 旅程另为 1/1。保留旧 CI 与本地诊断失败，不作通过计数。

构建、最终定向回归、文件散列与确切作者提交记录在同目录 `manifest.json`。所有测试串行，使用隔离 PostgreSQL 与合成材料；没有模型付费请求、生产写入或本机真实采集队列修改。临时诊断只在外部日志保留，源码没有诊断输出。两项原期望都未修改，也没有通过增加 timeout、自动重试点击或删断言掩盖失败。
