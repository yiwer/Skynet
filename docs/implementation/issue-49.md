# 画像辅导、代表原句与周趋势（#49）

## 固定来源与查询

画像新增 `coaching`，随 `capability-profile-2` 一起追加保存。HTTP、导出与 OAuth MCP `get_capability_profile` 使用同一个投影，前端只展示这份结果。旧画像没有 coaching 时继续按原版本读取，不用当前分析补造历史内容。

`profileCoachingService` 从主评估的固定 `usageVersion` 读取贡献及固定洞察，再批量读取原生消息事实。它不重新发起分析，不逐员工读取原件。提示词按原生消息身份去重，Claude 同一行多个 text block 合为一条；按原员工、项目、客户端、逻辑会话、来源日期筛选，已核验恢复前缀不转移归属。截断及后续追加继承首条边界未知。

首条要素只取 `first === true`；团队按所有人的首条消息合并计数，不取员工百分比的平均。每项保留已知分子、分母与未知数。返工排除原生首条，追问按原生 assistant 消息计数并沿前一条真实 user 归属。无返工会话复用同一事实判定。长度使用合并文本的 Unicode 字符数（文本块之间一个换行），保留已知中位数与样本量；未归属原件、缺失消息或不完整消息前史使总体长度保持未知。Token 基线未知本身不使已完整记录的消息长度未知。

人工更正沿用固定 insight 版本，不覆盖原分析或原件。摘要保留 `correctionCount`，`correctionIds` 最多 16 项；完整审计沿固定 insight 查询。最多两个代表原句、三个等待证据与 24 个小时桶，避免把所有原始消息嵌入画像。

## 辅导及代表原句

结论、强项、优先项与固定建议库沿用能力模型。结论旁说明依据的会话数、提示词数和低于 60 分的维度数；强项与优先项可直接打开对应维度的原始值、锚点、样本及证据。没有新增评分阈值、员工排序或生成式评语。

评估与画像共同调用 `selectRepresentativeSessions`，避免两处选出不同示例：最佳示例须当前原生轮次结束等待输入、已验证结果大于零、返工为零，按已验证结果降序、已知 Token 升序、固定逻辑会话 ID 排序。未知 Token 排在已知值后。返工示例按 `返工 + 仅声称 − 已验证` 降序、逻辑会话 ID 排序，缺少相关推断时不补零。

最佳示例引用所选会话的真实首条提示词；返工示例引用实际返工消息，必要时引用相关仅声称结果。引用保留原事件归属、位置、原句及固定 insight 版本，点击进入精确原句。没有真实引用时不显示占位示例。推断与人工更正用短标签表示，详细口径按需展开。

## 等待与两周趋势

等待使用主评估固定的团队 `waitsVersion`，从中投影此员工的原始间隔。中位数、P90、至少 600 秒的比例、其他会话活动比例复用等待报表算法。按等待起点的北京时间小时合并每条间隔计算小时中位数，跨日不重复、不取各天中位数的平均；无样本桶为 null。末尾空闲不计。页面展示全部长等待比例，能力维度仍按模型排除已观察到并行活动的长等待，展开规则说明两者区别。

当前 Codex/Claude 原件没有可配对的权限请求和决定时刻，因此权限中位数与最长请求保持未知，不根据工具耗时或协议类型生成审批事件。

趋势固定上周和本周两个自然周的评估版本、周界、模型、方案、基线、来源前沿、用量与等待版本。画像所选周期不改变“上周→本周”的含义。整个组合由 `consistentReportingInputs` 的完整语义前沿前后核验保护，最多三次；两周与主评估还必须具有相同模型、团队任务基线和基础来源前沿。持续变化返回 409，不保存混合结果。翻到下一周、迟到上传、分析或更正后产生新画像；旧固定画像不移动周界。无上周会话明确提示；未知分数不画零点、不计算变化。

## 页面、预算与演示

按原型在工作内容之后提供双栏“怎么写提示词 / 怎么回应 Agent”，在最近活动之后提供哑铃周趋势。窄屏折成单列，外壳不滚动，内容在画像内部滚动。图表支持键盘、触屏点击、Escape 关闭详情及同值表格；新增控件至少 44 px。规则收在 details 中。

每个 HTTP 页面不超过 32 KiB，实际 JSON 文本 MCP 包装不超过 48 KiB。各部分最多 20 项，按真实字节预算减少并提供 nextOffset；固定游标可取回全部条目，完整导出仍保留全部内容。页大小不是固定 20。长原句中的引号、反斜线和换行也按实际转义计费。

可复现入口（仅合成材料，独立 PostgreSQL）：

```powershell
$env:SKYNET_TEST_POSTGRES_BIN='E:/GenCode/Skynet-tools/postgresql-18.6/bin'
$env:SKYNET_OPENSSL='D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH='D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME='E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
$env:SKYNET_COACHING_EVIDENCE_DIR='E:/GenCode/Skynet-evidence/v2-2026-10-04/49-profile-coaching/browser'
npm run build
node --import tsx --test tests/profile-coaching*.test.ts
```

浏览器旅程自动经公开上传和确定性 Analysis 创建两周材料、登录固定画像，打开结论的维度依据、协作图表与表格、等待详情、周趋势表格，触屏打开/关闭详情，跳代表原句、导出画像，再使用实际 OAuth MCP 比较完整同页内容。截图覆盖 1280/390/320 的浅深主题。

外部证据目录：`E:/GenCode/Skynet-evidence/v2-2026-10-04/49-profile-coaching/`。按切片保留 `01/03/05/07/09-*-red` 和对应 GREEN；`11-web-green.txt` 实际记录 MCP 预算失败，后续 `13-web-budget-green.txt` 才通过。`14-native-public.txt` 记录长度错误扩大未知的失败，`15-native-green.txt` 和 `18-native-restored-public.txt` 记录修复及恢复归属通过。`16-compatibility-public.txt` 三项失败来自旧测试假定第一页固定 20 或等于完整导出，已改为通过真实游标核对完整内容；其真实上传交错用例通过。最终集成结果见外部 manifest。

本票不执行付费分析，不发布试点参数，不代表 #52 真实试点或 #54 性能验收完成。
