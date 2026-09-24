---
status: accepted
---

# 服务端分析由 Claude Code 执行

用户要求平台使用 Coding Agent 完成会话提取、分析和总结，初始表述为 `ClaudeCode + QwenTokenPlanCn`。第三轮用户接受全部建议并给出千问AI平台接入文档，因此保留 Claude Code 分析运行时，按文档中的按量接口接入千问模型，以满足服务端自动分析用途。

这一选择需要承担 Agent 运行、工具范围、任务隔离和版本兼容的维护成本。平台需把分析任务与员工工作会话分开，以免把机器生成的分析工作计入员工活动或触发循环分析。

用户指定的[千问AI平台 Claude Code 文档](https://platform.qianwenai.com/docs/developer-guides/clients-and-developer-tools/claude-code)明确区分 Token Plan 与按量配置；后台分析采用按量 Anthropic 兼容入口 `https://maas.qianwenaiapi.com/apps/anthropic`。模型 ID、凭据和用量预算在部署时配置，尚未调用任何付费接口。原先关于套餐使用范围的研究保留为决策背景，不再反复要求用户确认已经接受的接入方向。
