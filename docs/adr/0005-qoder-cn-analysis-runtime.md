---
status: accepted
---

# 通过 Qoder CN Agent SDK 执行分析任务

2026-10-04 用户提供 Qoder CN 专用 PAT、官方 CLI 文档，并确认接入方向为 Agent SDK + qoderclicn。增加 `qoder-cn` 分析后端，使用官方 `@qodercn-ai/qodercn-agent-sdk` 与匹配的独立 qoderclicn 进程。ADR-0003 的 Claude Code／千问按量后端继续可用；既有分析结果保留其原配置与版本，新后端不将 PAT 发往千问 Anthropic 入口。

分析任务继续消费有界原件片段，通过既有证据位置与结果 schema 校验后发布。SDK 运行在独立临时工作目录，禁用工具、宿主设置、会话持久化和记忆；模型选择回调执行租约与持久请求次数检查。固定 SDK 与原生运行时版本共同参与配置版本。

Qoder 的 Credits 与 Token 无固定换算关系，因此保留实际返回的 Credits，缺失保持未知；不能套用原人民币预留字段。Qoder 配置提供独立的持久请求次数额度，每次尝试预留最大允许次数，失败或中断不释放预留。该额度限制模型调用次数，不宣称人民币或 Credits 硬预算。初始部署要求实时模型目录确认免费模型，条件不再满足时停止该次请求，不自动切换模型。

依据：[官方 SDK 概述](https://docs.qoder.cn/cli/sdk/overview)、[认证](https://docs.qoder.cn/cli/sdk/authentication)、[模型选择](https://docs.qoder.cn/cli/sdk/model-policy)、[成本与用量](https://docs.qoder.cn/cli/sdk/cost-usage)。
