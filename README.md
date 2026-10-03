# Skynet

内部 Coding Agent 工作观察与会话存档平台。#4–#33 的代码、验收准备与最终评审修订已集成至代码基准 `83537e6`，两轴独立复核通过；该源码 Linux CI typecheck/build 与74/74普通测试通过。真实 Desktop、完整 Windows 生命周期、千问 PAYG、第二位操作者与连续五个工作日试点尚未验收，PR #55 已于 2026-10-03 合入 main；V1 发布验收仍未完成。验收入口见 [V1 验收台账](docs/implementation/v1-acceptance-ledger.md)，实现进度见 [V1 实施记录](docs/planning/v1-implementation.md)。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [首条存档链的实现与验证](docs/implementation/issue-4.md) | 本地合成演示、Linux 单机部署、公开接口、测试结果与尚未通过的 Desktop 条件 |
| [服务器导出与隔离恢复](docs/implementation/issue-5.md) | 可读导出、版本化恢复包、严格校验与新目录恢复；真实原生后端合成续聊已测，Desktop UI 仍待验收 |
| [Codex CLI 存档与恢复](docs/implementation/issue-6.md) | 正常 hook 信任、两个项目自动采集、公开导出及服务器包原生续聊；支持范围与 hook 延迟实测 |
| [Claude Code CLI 链路](docs/implementation/issue-7.md) | 普通 hooks、多项目采集、完整导出与服务器包原生续聊；单原件范围与未验证条件 |
| [旧会话续用与来源日期](docs/implementation/issue-8.md) | 仅同步宿主登记的旧会话、校验增量上传、历史上下文及来源日期；三来源公开流程与真实验收边界 |
| [G0 可持续回归与剩余验收](docs/implementation/issue-10.md) | 两个 CLI 旧会话、实际 Claude 代码/子会话、两版 Codex 附件行精确恢复；Desktop UI 与普通沙箱待补齐 |
| [npm 单授权值接入](docs/implementation/issue-11.md) | 内部离线 npm 包、自动检测与配置、私有共享身份/后台、真实 CLI 安装链；完整 G1 与 Desktop 仍待验收 |
| [当前用户后台与崩溃恢复](docs/implementation/issue-12.md) | 认证独占控制、共享后台、Windows 隐藏用户任务、真实 Claude 崩溃后自动采集；登录/重启/休眠及 Desktop 仍待验收 |
| [内部插件入口与共享后台](docs/implementation/issue-13.md) | 两个真实 CLI marketplace 接入、与 npm 共存、入口所有权和冻结材料补传；完整 G1 与 Desktop 市场 UI 仍待验收 |
| [修复升级卸载与保留证据](docs/implementation/issue-14.md) | 公开维护、真实旧载荷回退和冻结 drain；guardian/UTF-8已集成；Linux安装观测CI通过，后台控制focused修订已合入，旧Windows完整失败保留 |
| [后台控制响应与静默启动](docs/implementation/runtime-control-diagnosis.md) | 同步spawn阻塞移到Worker线程、异常线程与原生租约协调、隐藏动作及旧Task登记兼容；主线14/14定向通过，真实Task与完整Windows复核仍开放 |
| [账号与设备停用](docs/implementation/issue-20.md) | 显式维护权限、Web 停用、逐请求撤销校验及审计；保留共享历史读取，真实安装前置验收仍待通过 |
| [离线持久队列与补传](docs/implementation/issue-16.md) | 原件与关联材料先落盘再交付、跨进程退避、ACK 后清理、设备同步页面；完整 G2 仍待验收 |
| [崩溃与确认丢失后的快照一致性](docs/implementation/issue-17.md) | 持久上传键、事务提交、接入确认恢复及进程强杀回归；完整 G2 仍待验收 |
| [本地故障与采集覆盖缺口](docs/implementation/issue-18.md) | 真实 Linux 满盘/权限/删除故障、正常 Claude hooks、独立设备/会话/MCP 覆盖报告；故障恢复不抹去未核实范围 |
| [跨设备与独立材料历史归属](docs/implementation/issue-19.md) | 服务器验证完整前缀、冻结事件来源及原材料锚点；未独立采集材料保持上下文，完整 G2 仍待验收 |
| [短会话公开分析准备](docs/implementation/issue-22.md) | 实际隔离 Claude Code worker、Web/MCP 与原句证据；loopback 实测不替代真实千问 PAYG 或 G3 |
| [来源日期日报准备](docs/implementation/issue-28.md) | 09:00 自动入队、system 分析、持久分页版本、原员工/项目证据与 Web/MCP 一致；未知与 partial 明示，G3 尚未通过 |
| [周工作与项目准备](docs/implementation/issue-29.md) | 周一09:00自动入队、跨日主题及参与者、固定日报与项目计数、Web/MCP同版及原句；真实G3和运营验收仍开放 |
| [更正与迟到输入准备](docs/implementation/issue-30.md) | 说明、主题/显示项目归类和重算审计，日周项目自动新版、旧固定版与原件不变；真实运营验收仍开放 |
| [团队覆盖与来源统计准备](docs/implementation/issue-31.md) | 员工×日期覆盖、历史故障与当前连接、固定Token/文件/时间点区间及Web/MCP下钻；未知保留，真实门槛仍开放 |
| [服务器一致备份与独立恢复](docs/implementation/issue-32.md) | SQL 与全部原件同边界、fresh 服务器与冻结读者、两实际 CLI 合成续聊；异机/第二位操作者仍待验收 |
| [V1 验收台账与运营准备](docs/implementation/v1-acceptance-ledger.md) | #33 唯一 AC/G0–G4 验收索引、环境、复跑与原始 RED；准备不等于发布签收 |
| [最终评审修订](docs/implementation/v1-review-fixes.md) | 原字节完整性、冻结来源统计、固定读者竞态、响应式深色、载荷复用与有界测量；各阶段固定源码和真实验证边界 |
| [长会话分段与原件引用](docs/implementation/issue-23.md) | 有界提取与汇总、原 UTF-16 引用、失败和未处理范围；实际 Claude Code 的合成服务验证与真实千问验收分开 |
| [Agent 内授权读取](docs/implementation/issue-26.md) | HTTPS MCP / OAuth、共享原文与材料分页、完整导出；两个真实 CLI 正常授权与查询已测，完整发布门槛仍待验收 |
| [组合搜索与稳定证据定位](docs/implementation/issue-27.md) | Web/MCP 共用员工、日期、项目、来源及内容搜索，历史快照与未知项目可查；命中回到固定原件行与文字位置 |
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
