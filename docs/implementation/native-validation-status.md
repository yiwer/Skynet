# 原生客户端验收状态

日期：2026-09-28。对应 [V1 #1](https://github.com/yiwer/Skynet/issues/1)、[#4](https://github.com/yiwer/Skynet/issues/4)、[#5](https://github.com/yiwer/Skynet/issues/5) 与 G0。本文记录实际观察；**没有任何原生客户端支持组合通过验收**。

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
- `hooks/list` 能列出用户定义、当前哈希和 `untrusted` 状态。一次诊断使用过宿主的信任绕过开关以观察原生事件格式；该结果仅用于输入契约研究，**不作为接入、信任或验收证据**。产品、演示与正常验收流程不得使用该开关或写入信任哈希。
- 干净 Desktop profile 的两个启动探针均退出 `1`。实际 MSIX 入口程序曾打开独立 loopback 调试端口，但没有页面 target；另一启动器立即退出。未取得进一步错误日志，原因尚未确定。没有修改启动安全要求，也没有影响用户现有 Desktop。

原始研究、脚本和合成证据保存在执行机器的 `%TEMP%/skynet-v1-implementation/`，供后续实现代理复用；这些临时文件不构成仓库内可持续复现的发布验收材料。

## 当前阻塞与补齐方式

#4 仍需一个能正常启动 Desktop 的隔离 OS 测试账号或专用测试机。通过宿主正常流程审查并信任采集 hook 后，创建含唯一上下文标记和无害工具结果的合成会话，验证自动入队、后台上传、另一测试用户读取、匿名拒绝及重启后的原件一致性。具体产品启动命令见 [首条存档链](issue-4.md)。

#5 后续还需从服务器包独立恢复至第二个隔离环境，在真实 Desktop 中打开并继续对话，核查历史上下文及工具记录。原设备 resume、复制文本和后端诊断均不能替代。三客户端的支持矩阵、G0 其他场景及 G1–G4 也保持待验证。

宿主行为依据：[官方 hooks 文档](https://learn.chatgpt.com/docs/hooks)、[官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)。文档说明机制，Skynet 支持能力仍取决于上述实际产品验收。
