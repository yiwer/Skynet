# 当前用户后台与崩溃恢复

对应 [#12](https://github.com/yiwer/Skynet/issues/12)。本票的 tracer bullet 是：公开 npm 包和一次授权接入 → 安装终端退出 → 当前用户后台持续采集 → 进程崩溃后恢复 → 真实 Claude 两项目原文进入服务器与 Web → 只用服务器包恢复并原生续聊。G0、完整 G1 与其余发布门槛仍开放。

## 运行与所有权

`skynet setup` 使用 #11 的稳定用户目录、Node 绝对路径、共享设备身份和独立健康往返；后台和任务命令不包含 `SKYNET_KEY`。宿主 hooks 继续只做本地持久入队。#16 的不可变待确认材料、退避与 ACK 清理继续由唯一共享 worker 处理。

一个 supervisor 拥有一个 worker。两者分别绑定回环控制端点，以受保护状态目录中的随机令牌认证；worker 还需要所属 supervisor 的父子 IPC 握手。并发 `start` 通过 OS 监听所有权汇合到同一实例。进程号和磁盘心跳只供诊断，不用于判定存活或终止外部进程。网络慢、服务器离线或一次整理很久，不会因心跳文件过期而产生第二个写者。

supervisor 崩溃后旧 worker 收到 IPC 断开而退出；新 supervisor 如观察到仍在收尾的认证 worker，会请求停止并等它释放独占端点。只有自有 `ChildProcess` 可在停止超时后终止，绝不根据磁盘中复用的 PID 杀进程。端口冲突、身份不匹配和控制端点不响应都保留状态并报告不可用。旧版本没有这种握手的活跃 worker 需要先由原安装停止，不能猜测接管。

## 当前用户自启与状态

Windows 使用当前 SID 的 `Interactive`、`Limited` 计划任务：登录触发、隐藏 PowerShell、绝对 Node/launcher 路径、不需要最高权限。它的任务 action 对 supervisor 非零退出执行 1 秒起、最多 30 秒的退避重启；正常 `stop` 返回零并结束该次 action。额外登记了系统 `RestartOnFailure`，但不能仅凭该设置声称进程崩溃可恢复：本次故障实验发现它未按期恢复 Node，因而加入并实测上述 action 内的恢复循环。

已有任务只有 description、当前用户、权限和完整 action 均匹配才会复用或移除。任务被禁用、删除、改写、注册受策略限制或启动未建立控制所有权时，状态显示 `degraded` 与处理方法；不修改全局策略、不提升权限、不覆盖外部任务。macOS/Linux 暂未实现登录适配器，明确显示当前登录会话运行及手动 `start` 的降级说明。

公开命令：

```text
skynet status             # 后台控制存活、整理时间、服务器连接、各来源队列分别显示
skynet start              # 复用或启动当前用户的唯一共享后台
skynet stop               # 停止本次运行，保留身份、配置及未确认材料
skynet autostart-remove   # 仅移除本产品登记的自启；需要时另行 stop
```

`status.autostart.lifecycle` 将 `login`、`reboot`、`sleepResume`、`desktopIcon` 分别标为 `not-verified`。任务注册和手动执行成功不替代实际登录、整机重启、休眠唤醒或 Desktop 图标入口验证。停止本次运行不会自动删除自启，下次登录仍可启动；完整卸载与升级流程由 #14 接续。

## 验证

`tests/installation.test.ts` 通过公开离线 npm `--ignore-scripts`、生成的 npm shim、CLI、HTTP、Web 流程验证共享身份和两来源自动入库。新增断言覆盖：安装父进程退出、并发 start 无重复实例、未认证控制拒绝、直接启动 worker/来源写者拒绝、worker 崩溃、Windows supervisor 崩溃后无需 start 自动恢复、网络积压期间同一 writer 存活、服务恢复后补传、占用端点安全失败、遗留 PID 即使指向另一个活进程也不被终止、无 PATH/Key 启动、禁用任务显示降级。每项测试使用自己唯一临时任务，finally 校验所有权并移除、停止；不注销或重启真实用户。

真实 Claude Code 2.1.281 / Windows x64 的 npm 安装模式在 2026-09-28 通过，最终回归 34.44 秒。证据：`%TEMP%/skynet-test-yqxOmq/native-runtime-recovery.json` 与 `native-claude-evidence.json`。先终止本测试安装的 worker，supervisor 自动恢复且设备身份不变；随后真实 CLI 普通 hooks 自动捕获两个项目，Web 展示工具原文；删除本测试源 home 后，服务器包恢复字节完全一致，原生续聊保留工具历史。使用确定性回环模型，无付费调用、个人会话或凭据。

最终 Windows 任务 action 修复后的公开安装回归通过，73.13 秒；`%TEMP%/skynet-test-Ut2QZq/runtime-evidence.json` 记录两类进程崩溃恢复及离线补传，`installation-evidence.json` 记录双来源共用设备与配置保留。初次扩大故障覆盖时安装项超时，暴露了仅靠调度器重试的不足；其余 9 项普通流程已通过，随后修复并重跑安装链，没有放宽自动恢复断言。

最终 `npm run typecheck`、`npm run build`、`npm test` 全部通过；普通公开流程 **10/10**，全套 89.14 秒。该轮安装链证据 `%TEMP%/skynet-test-YM6qNx/{runtime,installation}-evidence.json`。测试完成后没有遗留本轮 Windows 任务或安装后台。

对最终安装稳定 launcher 连续测量 200 次：P50 **56.13 ms**、P95 **65.88 ms**、最大 **90.91 ms**，达到样机 P95≤100 ms。包含 Node 进程创建、launcher import 和本地持久入队；证据 `%TEMP%/skynet-installed-hook-latency-hpIpW5/latency.json`，不把宿主自身启动计入该值。

复现：

```powershell
npm run typecheck
npm run build
node --import tsx --test tests/installation.test.ts
$env:SKYNET_TEST_INSTALLER = '1'
$env:SKYNET_CLAUDE_RUNTIME = '<已安装 Claude Code 2.1.281 的绝对路径>'
node --import tsx --test tests/native-claude.test.ts
```

**未验证边界**：真实 Windows 登录/重启/休眠与 Desktop 图标启动；任务 action 自身被 OS 终止后的恢复；受限普通用户环境的注册策略；macOS/Linux 登录适配器。当前机器的 Windows 测试账号虽配置 `Limited` task，但不能据此宣称所有企业策略或普通账号通过。Codex Desktop 自动采集及界面原生恢复仍待独立验收。上述缺口不能用进程存在、注册成功或 Claude CLI 测试替代。

Windows 调度设置参考：[Microsoft RestartOnFailure](https://learn.microsoft.com/windows/win32/taskschd/taskschedulerschema-restartonfailure-settingstype-element)。产品能力以实际记录为准。
