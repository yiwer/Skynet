# Skynet

内部 Coding Agent 工作观察与会话存档平台。用户已确认整体设计，已完成 PRD v1.0、研究与架构文档，产品尚未实现。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [PRD v1.0](docs/requirements/PRD.md) | 首版实施与验收依据：71 条用户故事、实施决策、22 组验收场景与发布门槛 |
| [可行性与整体架构](docs/architecture/solution-design.md) | 推荐结构、Module 职责、可靠存档、分析、恢复与实施顺序 |
| [安装与运行设计](docs/architecture/installation-design.md) | npm / 插件市场两个入口、单 Key 绑定、共享后台与升级卸载 |
| [技术验证计划](docs/architecture/validation-plan.md) | 原生恢复、安装、可靠上传、模型分析与产品发布门槛 |
| [首版需求基线](docs/requirements/v1-scope.md) | 当前已确认范围、产品流程、实施待验证事项与验收样例 |
| [术语表](CONTEXT.md) | 领域术语及其边界 |
| [官方资料研究](docs/research/2026-09-24-agent-activity-observability.md) | Claude Code、Codex、MCP、插件、会话恢复与千问分析接入的事实依据 |
| [安装渠道研究](docs/research/2026-09-24-npm-onboarding-feasibility.md) | npm 生命周期、Claude/Codex marketplace、信任与单授权值的事实依据 |
| [访谈记录](docs/requirements/discovery.md) | 问题、回答及范围演进；其中历史建议不覆盖当前需求基线 |
| [完整会话存档决策](docs/adr/0001-preserve-full-session-records.md) | 存档、保留、恢复与历史采集边界 |
| [全项目采集与共享查看决策](docs/adr/0002-collect-all-projects-with-shared-authenticated-read.md) | 首版采集范围和认证后的查看范围 |
| [Claude Code 分析决策](docs/adr/0003-use-claude-code-for-server-analysis.md) | 服务端分析运行时与千问按量接入 |

首版不批量导入旧会话；接入后继续使用的旧会话同步完整记录。所有项目均覆盖，接入后离线积压正常补传。

已确认采用统一的本地采集后台，npm 和各 Agent 插件市场共用采集核心；服务端先按 Linux 单机、PostgreSQL、原件持久卷与独立 Claude Code 分析 Worker 设计。设计确认不代表已完成兼容性或恢复验证。

最先验证三种客户端入口的采集、原始存档及原生续聊恢复，尤其 Codex Desktop，再验证安装链与 Claude Code + 千问按量接口。实际员工 OS、规模和服务器配置在试点部署时登记，尚未作为已知事实。

PRD 已在本地完成；项目 issue tracker 尚未配置，因此未发布远端 issue 或应用 `ready-for-agent` 标签。
