# Skynet

内部 Coding Agent 工作观察与会话存档平台。用户已确认整体设计，已完成 PRD v1.0 与 v2.0、研究与架构文档，以及 Web 平台原型。现已实现认证存档、导出与单原件恢复，并实测两个 CLI 的自动采集和服务器独立原生续聊；真实 Codex Desktop 界面与完整发布门槛仍待验收，V1 尚未完成。进度见 [V1 实施记录](docs/planning/v1-implementation.md)。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [首条存档链的实现与验证](docs/implementation/issue-4.md) | 本地合成演示、Linux 单机部署、公开接口、测试结果与尚未通过的 Desktop 条件 |
| [服务器导出与隔离恢复](docs/implementation/issue-5.md) | 可读导出、版本化恢复包、严格校验与新目录恢复；真实原生后端合成续聊已测，Desktop UI 仍待验收 |
| [Codex CLI 存档与恢复](docs/implementation/issue-6.md) | 正常 hook 信任、两个项目自动采集、公开导出及服务器包原生续聊；支持范围与 hook 延迟实测 |
| [Claude Code CLI 链路](docs/implementation/issue-7.md) | 普通 hooks、多项目采集、完整导出与服务器包原生续聊；单原件范围与未验证条件 |
| [旧会话续用与来源日期](docs/implementation/issue-8.md) | 仅同步宿主登记的旧会话、校验增量上传、历史上下文及来源日期；三来源公开流程与真实验收边界 |
| [PRD v1.0](docs/requirements/PRD.md) | 首版实施与验收依据：71 条用户故事、实施决策、22 组验收场景与发布门槛 |
| [V1 验收标准](docs/requirements/v1-acceptance.md) | 把 PRD v1.0 的 AC-01…AC-22 与 G0—G4 整理成可执行的验收步骤、证据与判定规则 |
| [PRD v2.0](docs/requirements/PRD-v2.md) | V2：数据报表、对话视图、活动记录、会话组装审计与员工使用能力评估；用户故事 72—176，验收场景 AC-23…AC-38 |
| [V2 实现提示词](docs/requirements/v2-prompt.md) | 交给实现 Agent 的 V2 工作说明；第六节守则第 1 条与 AC-28 已被 PRD v2.0 取代 |
| [Web 平台原型](prototypes/web-platform/README.md) | 可点击的界面原型，数据为合成；只作界面与口径参考，代码不进入产品 |
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

项目使用 [GitHub Issues](https://github.com/yiwer/Skynet/issues)。PRD v1.0 已发布为 [Issue #1](https://github.com/yiwer/Skynet/issues/1)，PRD v2.0 已发布为 [Issue #2](https://github.com/yiwer/Skynet/issues/2)，标签均为 `ready-for-agent`；工程技能配置入口见 [AGENTS.md](AGENTS.md)。
