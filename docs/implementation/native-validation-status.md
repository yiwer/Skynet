# 原生客户端验收状态

日期：2026-09-30。对应 [V1 #1](https://github.com/yiwer/Skynet/issues/1)、[#4](https://github.com/yiwer/Skynet/issues/4)、[#5](https://github.com/yiwer/Skynet/issues/5) 与 G0。本文记录实际观察；**没有任何原生客户端支持组合通过验收**。

当前实现主线 `594fec8` 已集成#4–#33，Linux普通CI61/61通过；这不新增任何 Desktop/Task/真实千问支持声明。#32独立支线的两实际CLI从恢复服务器包续聊已验证1/1、13366.7888ms，使用隔离home与loopback合成模型；真实Desktop normal UI、信任、自动存档和服务器恢复续聊，以及普通Windows workspace-write、实际登录/重启/休眠完整链仍开放。最终评审修订仅跑隐藏非Task公开fixture、无头Web、冻结载荷导入与合成测量工具契约，未重复原生/Task/setup/maintenance/fullWindows或压力试验。所有门槛与现存/失效原件的准确索引见[唯一验收台账](v1-acceptance-ledger.md)，代码修订与对应固定源码测试见[修订记录](v1-review-fixes.md)。下文保留原诊断环境与历史限制，后续段落仅在明确验证的范围内更新。

## 实测环境

| 项目 | 观察到的版本 |
| --- | --- |
| Windows Codex Desktop MSIX | 26.924.2738.0 |
| Desktop 内置运行时 | 0.158.0-alpha.2.1 |
| 独立 Codex CLI | 0.157.1 |
| Claude Code CLI | 2.1.281 |
| Node / npm | 24.12.0 / 11.6.2 |

实验使用新建临时配置目录、合成材料和仅监听 loopback 的确定性模型替身，没有读取真实员工会话、复用其登录凭据或调用付费模型。

## 已完成的诊断

- Desktop 内置运行时以 app-server 模式在隔离 home 生成原生 JSONL；将该文件复制到空 home 后，按原 ID resume 并完成合成续轮。请求中保留先前上下文。这是后端机制诊断，未经过 Skynet 服务器导出，也未验证实际 Desktop 界面、真实模型、工具历史或附件恢复。
- 后续 #5 产品测试已越过直接复制阶段：真实内置后端生成消息及工具结果，经公开 collector/API 上传并下载恢复包，删除测试源 home 后，仅用下载包在新 home 恢复并原生续轮；原 ID、上下文和工具历史均保留。可复现脚本随仓库交付，见 [#5 记录](issue-5.md)。这仍不等于 Desktop 界面与自动 hook 采集通过。
- `hooks/list` 能列出用户定义、当前哈希和 `untrusted` 状态。一次诊断使用过宿主的信任绕过开关以观察原生事件格式；该结果仅用于输入契约研究，**不作为接入、信任或验收证据**。产品、演示与正常验收流程不得使用该开关或写入信任哈希。
- Codex CLI 0.157.1 已通过实际终端界面完成新建目录与单条测试 hook 的普通审核，定义详情显示 `Trusted`、事件列表显示 1 个 Active；独立 exec 随后 exit 0 并触发 UserPromptSubmit。提升权限终端不能启动共享 daemon，CLI 自身提示的 `--no-daemon` 独立运行模式可用；没有禁用 sandbox 或绕过 hook 信任。#6 后续已对真实产品 hook 重复正常审核并完成两个项目的自动存档、Web 工具结果查询及服务器包原生 CLI 恢复，见 [#6 记录](issue-6.md)。实验使用普通只读 MCP 与本机合成模型；真实代码修改、关联材料和完整 G0 仍待验证。
- Claude Code 2.1.281 普通 print 模式实际执行 Read 并触发六种 hooks；仅复制 JSONL 到新 home 和不同空工作区，令源原件不可用后，原生 resume 仍保留原 prompt、工具请求和结果。跨工作区的 SessionStart 可能先报告不存在的推导路径，后续 UserPromptSubmit 才给出实际路径。此处是机制诊断，产品链路由 #7 继续验证。
- #7 随后的产品链路已通过：普通 hooks 自动登记两个测试项目，后台同步并核对最终落盘哈希，认证 Web 与可读导出可查；删除测试源 home 后，公开恢复命令仅用服务器下载包建立新 home，真实 Claude CLI 以同一 UUID 续聊，模型请求保留原始消息与结构化工具结果。见 [#7 复现记录](issue-7.md)。该实验使用确定性本机模型，尚未覆盖关联材料与全部 G0。
- #11/#16 集成后补做 Claude 真实代码写入诊断：在两个隔离项目中，由实际原生 `Write` 创建 TypeScript 文件，再由 `Read` 读取；磁盘字节、服务器原件中的写入参数与工具结果均核验通过。普通安装模式 hooks 自动采集，删除测试源 home 后仅用服务器包恢复，同 UUID 续聊仍保留代码内容及写入/读取历史。证据为 `%TEMP%/skynet-test-tMf78z/native-claude-code-change-evidence.json`；临时生成器 `skynet-v1-implementation/prepare-claude-code-change-probe.mjs` 尚未纳入持续回归。只授权测试用 Read/Write 工具，未使用权限或信任绕过。模型仍为确定性替身，不代表 Codex 原生补丁、Desktop UI 或完整 G0。
- 后续实际 Claude `Agent` 建立 general-purpose 子会话并读取合成文件，正常安装 hooks 捕获父记录及子会话侧文件。仅从服务器包恢复新 home 后，通过当前版本的 `SendMessage` 继续原子会话，实际模型请求仍有旧任务、原 Read 调用与工具内容；诊断通过，并覆盖安装后台 worker 崩溃恢复。证据为 `%TEMP%/skynet-test-DRkifC/native-claude-subagent-evidence.json`。该版本未声明 `Agent.resume` 参数。当时发现的 `.meta.json` 被误列为另一 child、写入未验证映射目录的问题，已由 [#18](issue-18.md) 修复并通过原位精确字节恢复检查。实测 general-purpose 子会话可续用，其他子类型及全部侧文件不据此外推支持；临时生成器 `prepare-claude-subagent-probe.mjs` 尚未纳入持续回归。
- #8 与 #20 集成至 `ec65e04` 后，两个实际 CLI 各自补做旧会话续用诊断：先在两个项目创建原生会话，再登记设备和正常配置产品 hooks，只继续其中一个。服务器仅出现被继续的会话，原始用户消息早于可信接入时间、新轮次不早于接入时间；仅凭服务器包在删除测试源 home 后恢复，历史上下文与工具结果仍保留。两项均通过，仍使用确定性本机模型。执行脚本由既有原生测试生成，暂存于 `%TEMP%/skynet-v1-implementation/prepare-old-cli-probe.mjs` 与 `prepare-old-claude-probe.mjs`，尚未纳入持续回归；证据分别为 `%TEMP%/skynet-test-n27evs/codex-cli-old-session-evidence.json`、`%TEMP%/skynet-test-8BdX1P/native-claude-old-session-evidence.json`。这补充 CLI 历史边界实测，不代表 Desktop 或全部 G0 通过。
- Desktop 启动诊断已定位两个环境问题：隔离 profile 必须具有标准 `USERPROFILE/AppData/Roaming` 与 `Local` 目录，直接启动 MSIX 可执行文件还缺少包身份。修正目录并经官方 `Invoke-CommandInDesktopPackage` 做一次隔离包上下文诊断后，未修改安装版在约 3.93 秒创建 renderer 页面目标。此结果仅证明页面目标创建，未检查 DOM 完整加载、登录、信任或续聊，也不能替代普通测试账户的正常启动验收。原 Desktop 实例保持运行，诊断实例已关闭。

原始研究、脚本和合成证据保存在执行机器的 `%TEMP%/skynet-v1-implementation/`，供后续实现代理复用；这些临时文件不构成仓库内可持续复现的发布验收材料。

独立附件重建补充诊断：在删除源 home、仅从服务器包恢复的隔离目录，原生 `thread/attachment/add` 可重放保存的附件类型、键和 payload，重复调用保持一项，但会生成新的 ID 和创建时间。在关闭该测试原生进程后，仅调整新目标数据库中的原始 ID/时间，再启动原生后端可准确列回这些字段。证据为 `%TEMP%/skynet-test-EqV52M/attachment-replay-details.json` 与 `skynet-test-3LFjW3/attachment-identity-details.json`，复现说明 `skynet-v1-implementation/native-attachment-restore.md`。这只是测量版本下的兼容性路径诊断，产品尚未集成，未知附件类型、外部文件引用及 Desktop UI 仍未验证。

## 当前阻塞与补齐方式

#4 仍需一个能正常启动 Desktop 的隔离 OS 测试账号或专用测试机。通过宿主正常流程审查并信任采集 hook 后，创建含唯一上下文标记和无害工具结果的合成会话，验证自动入队、后台上传、另一测试用户读取、匿名拒绝及重启后的原件一致性。具体产品启动命令见 [首条存档链](issue-4.md)。

#5 后续还需从服务器包独立恢复至第二个隔离环境，在真实 Desktop 中打开并继续对话，核查历史上下文及工具记录。原设备 resume、复制文本和后端诊断均不能替代。三客户端的支持矩阵、G0 其他场景及 G1–G4 也保持待验证。

宿主行为依据：[官方 hooks 文档](https://learn.chatgpt.com/docs/hooks)、[官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)。文档说明机制，Skynet 支持能力仍取决于上述实际产品验收。

## 2026-09-30 可持续回归与附件行恢复

此前 CLI 旧会话、Claude Write/Read、general-purpose 子会话恢复诊断已纳入 `tests/native-claude.test.ts` / `tests/native-codex-cli.test.ts`；`npm run test:g0-native` 运行六项增补回归。产品已补齐两版 Codex 新目标原生 DB 的不透明附件行回填，严格验证版本、schema、owner 和唯一性，关闭 native 进程后事务写入原 ID/时间；原件字节和原生 list readback 已测。未知 payload 语义、外部资源与 Desktop UI仍待验证；此前“尚未集成”的独立附件诊断属于历史记录。当前全局 Codex 0.159.2 未据此声明支持；当前提升权限环境的原生 apply_patch 被宿主 read-only 沙箱拒绝，保持未通过。详细矩阵、复现命令与运行时失败边界见 [G0 增补记录](issue-10.md)。
