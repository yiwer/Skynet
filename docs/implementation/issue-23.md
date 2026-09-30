# #23 长会话仍回到原始证据

来源：[Issue #23](https://github.com/yiwer/Skynet/issues/23)，PRD US-40/62、AC-18、ADR-0003。本实现接入已提交的 #24 最终 `f2b9cf9`，保留队列迁移锁、原件/解析器/配置版本、租约与预算控制。真实千问 PAYG 质量、用量、AC-18/G3 和完整发布门槛仍未通过。

## Public trace bullet

合成不可变 Codex 原件含跨段目标、巨大工具输出头尾事实、未知行和未闭合末行 → 已认证用户 HTTP 发起 → 持久队列领取 → 隔离真实 Claude Code 2.1.281 分段提取 → 原句精确校验 → 汇总 → 持久结果 → 服务器重启 → Web/MCP 同一结果 → 原件完整字节导出。模型端是显式本地 Anthropic 兼容合成服务，没有付费或真实千问调用。

同一 tracer 提交坏引用段和超过段数的巨大输入：保留其他已验证提取，显示失败/跳过范围和 `complete:false`，失败的提供商用量保留未知。原件仍可查询和导出。

## 边界与证据

- `maxSessionBytes` 控制原件总字节，默认 1MiB、上限 8MiB；规范化 JSON 上限是其两倍，最多 4096 个已解析事件。原件 hash/长度与严格 UTF-8 在排队前验证。超过范围直接拒绝而不调用模型；原件不受影响。
- `maxInputBytes` 仍是每次提取/汇总输入限额，默认 64KiB、上限 128KiB。每段最多 256 个事件，稳定顺序扫描；巨大事件拆开时不切断 UTF-16 surrogate pair，保存原事件索引和原 UTF-16 偏移。
- `maxSegments` 默认 4、上限 16；规划最多 `min(maxSegments,max(1,maxRequests-1))` 段，尝试给汇总保留一个请求。CLI 可能每阶段发多个请求，实际共享限额耗尽会显示未完成，规划不保证所有阶段都能执行。
- `maxRequests` 默认仍为 3；操作员可显式设至 32。**全尝试**提取和汇总共用一次 AbortSignal、持久 `beforeForward` 请求计数、deadline/lease 和一次预算预留；没有每段新预算或超时。预算公式仍按全部请求的请求字节/输出 token/已验证定价上界计算。未知失败不退款，CLI 美元估计不等于千问账单。
- 每段输出局部引用映射到不可变输入的原事件和偏移，再对全文精确校验。汇总输入中的 events 仅包含已验证的原句；中间 findings 是无证据权威的推断材料。汇总只允许先前验证的完整引用元组，拒绝将摘要或未验证子串变为来源。
- 原员工、设备、historical/context、原 material/raw 位置与本次语义 inputLocation 均保留。原始 JSON 转义坐标不能加语义偏移；Web 保留原 JSON 锚点与“查看本次输入中的精确原句”两个链接，后者直接定位巨大事件末尾原句。
- `result.processing` 版本 `original-utf16-1`：`complete`、`aggregation` (`not-needed/succeeded/failed/limited`)、`omittedFindings`，以及连续原输入 `ranges`，包含 `start/end:{event,textOffset}`、`state:extracted/failed/skipped` 和原因。事件索引从 0 开始、end 的偏移为 exclusive。没有跳过/失败且汇总未受限才标完成。只完成已解析主原件范围；未知行、末行、关联材料和 capture gaps 单列，不能推断这些范围没有活动。旧结果没有 processing，不自动补成完整分析。
- 结果最多 28 个 items / 48KiB，汇总输入同样受 stage 限制，未进入汇总的 findings 计数可见。全部段失败或整体超时仍按有限队列重试/失败，不发布无原句结论；部分结果不可当作全文完成。

## 验证

本独立树基线 `9b90e7a`，先接入队列 checkpoint `3144b5c`，再合最终 #24 `f2b9cf9`；仅 public config/contract 冲突，保留双方字段，typecheck/build 通过。

- `node --import tsx --test tests/analysis-long.test.ts`：**3/3 PASS**。覆盖中文/emoji 巨大事件完整重组、原 UTF-16 偏移、坏段/跳过范围、全任务请求上限，以及汇总子串/伪引用拒绝。
- `node --import tsx --test tests/analysis-long-public.test.ts`：**1/1 PASS**, 5.825s，`skynet-test-eA9Jkv`。HTTP/Web/MCP/重启/精确 raw、原员工上下文与部分范围均验证；这一普通用例替换的是狭窄 native 调用 seam，不能作为真实运行时证据。
- `$env:SKYNET_CLAUDE_RUNTIME='C:/Users/Administrator/.local/bin/claude.exe'; node --import tsx --test tests/native-analysis-long.test.ts`：**1/1 PASS**, 13.228s，`skynet-test-6PLN80`。实际独立 CLI：完整 3 段 + 汇总 4 请求；坏段部分结果 4 请求；8 段 + skipped 9 请求，共 17 次本地合成服务请求；每任务与持久 attempt 计数一致，任务目录清空。
- 最终 #24 队列回归 **1/1 PASS**, 6.546s，`skynet-test-RmqdrS`。原先 oversized 用例以旧短 stage 限额构造，新功能正确返回 202；现在按新 **total session** 限额构造，仍要求 413、未分析。不是放宽实际传输/预算保护。
- 共享 native/prompt 短会话回归 `tests/native-analysis.test.ts`：实际 Windows Claude Code **1/1 PASS**, 30.410s，`skynet-test-lWCqg2`。恶意工具、原句校验、原材料引用、两次失败/超时、重启/Web/MCP 保持。
- 完整普通 Windows `npm test` **33 项：31 pass / 2 fail / 0 cancelled**, 237.078s；自己的 typecheck/build/diffcheck 先通过。#23 public 29.641s (`nJJS7Z`)、原句三项、#24 queue 20.773s (`DHlSRf`) 均通过。安装 `GbzZun` 73.131s 与插件 `j1GGMW` 72.607s 均失败于 **Local runtime unresponsive / 1500ms**；没有到未知来源扫描断言，不是先前 Linux cached-sweep race 的再失败，也未证明与历史 Windows 故障根因相同。
- 本轮完整维护 `XZRnZf` **PASS 236.150s**，stage complete 233.305s：prepared/switched 实际中断、异版本 upgrade、原来源禁采、rollback、uninstall、冻结 drain 与 Web/archive 完成。此普通套件使用当前 fixture，`legacyPerSourceFence:false`，不冒充此前实际 a4 载荷回归。

本轮只跑一份 ordinary suite，未并跑另一份 maintenance/a4/native；诊断代理暂停 heavy 压力复现，其他代理自然实现/静态检查与宿主负载不受控。外部证据 `%TEMP%/skynet-v1-implementation/issue23-windows-full-suite.log`、`issue23-windows-suite-observation.json`。结束后已向 runtime 诊断代理交接两个失败目录并解除压力暂停；没有盲目重跑、放宽断言或抬高 control/maintenance timeout。完整 Windows 测试仍红，不由定向 pass 覆盖。

首次 public fixture 没有 source timestamp，历史断言失败，补入明确历史时间；另一次正确原 JSON 锚点只显示巨大行开头，测试改为同时核对原 JSON 锚点和精确 inputLocation 链接，不编造 JSON 偏移。这些失败没有抹去真实引用边界。

独立 #14 Linux 状态观察修复见 [状态扫描验证](issue-14-status-observation.md)，其 Windows targeted pass 不覆盖主线已有 1500ms runtime-control 并发响应故障。#18 压力 P95 超过 100ms、Desktop/native 窗口、真实 PAYG 等门槛仍保持开放。
