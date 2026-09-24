# 员工端安装与运行设计

日期：2026-09-24。状态：设计已由用户确认并纳入 [PRD v1.0](../requirements/PRD.md)，尚未实现或发布安装包。用户目标是尽量做到 npm 安装后只配置一个授权环境变量；也接受各 Agent 插件市场安装。

关联：[整体架构](./solution-design.md)、[需求基线](../requirements/v1-scope.md)、[安装可行性研究](../research/2026-09-24-npm-onboarding-feasibility.md)。以下包名与命令是拟定产品接口，不是现在可直接安装的已发布产品。

## 1. 结论：两种安装入口，共用一次绑定与采集后台

推荐先验证的入口：**npm 安装 → 设置 `SKYNET_KEY` → `skynet setup`**。另一入口是 **Agent 插件市场安装 → 输入同一个个人授权值 → 一次初始化**。安装页按环境推荐其一，员工不需要把两种方式都安装一遍，不手改 Claude/Codex 配置。

不能跨环境保证“仅 npm install，之后设置变量，就已经开始采集”：

- npm 的安装脚本可能被跳过；不能把 `postinstall` 当作必执行初始化入口。[npm 安装脚本管理](https://docs.npmjs.com/cli/v12/commands/npm-install-scripts/)
- 安装完成后设置变量，不会再次执行安装脚本或启动尚不存在的进程。这是进程运行方式带来的工程限制。
- Codex 非托管 hooks 需要用户信任当前定义；安装器不能伪造信任记录或跳过宿主要求。[Codex 插件文档](https://developers.openai.com/plugins/build/plugins)
- 桌面应用、终端、用户后台任务可能具有不同环境；设计上不依赖 Codex Desktop 继承某个终端的 `SKYNET_KEY`。

因此把 `setup` 定义为正式接口，`postinstall` 至多显示下一步提示。可将安装与 setup 合并为安装页的一次复制操作；不能把仍需宿主确认的情形宣传为绝对零交互。

## 2. 安装人员看到的流程

### npm 路径的前提

此路径要求员工已经有可运行的 Node/npm 和目标 Agent。客户端推荐以受支持的 Node LTS 为基础，先验证 Node 24；无需 Python、编译器、数据库、Docker 或单独下载平台安装包。缺少 Node 时可选下面的插件预构建路线，或明确完成前置安装，不能隐瞒这一步。[Node 发布状态](https://nodejs.org/en/about/previous-releases)

以下 `@your-org/skynet-agent` 是占位名称。正式发行包必须可被员工读取；如果私有 npm registry 需要额外登录，应计入安装前提，不能隐瞒第二套凭据。

### Windows PowerShell

```powershell
npm install -g @your-org/skynet-agent
$env:SKYNET_KEY = '<从平台获得的个人接入 Key>'
skynet setup
```

### macOS / Linux

```sh
npm install -g @your-org/skynet-agent
export SKYNET_KEY='<从平台获得的个人接入 Key>'
skynet setup
```

Key 只用于初始化授权；setup 兑换并保存设备凭据，因此后续不用每天设置变量。示例中的占位符不得写成真实 Key 提交到仓库。

setup 自动完成：

1. 校验包内的部署信息和平台连接，识别 Key 对应的员工。
2. 检测 Claude Code、Codex CLI、Codex Desktop 的已支持配置与版本。
3. 将运行文件和状态放在稳定的用户数据目录，记录 Node 的绝对路径。
4. 安装对应 Adapter 提供的 hooks/plugin 配置，保留现有设置；不要求逐项目安装。
5. 注册并启动当前用户的采集后台，初始化本地持久队列。
6. 用独立的健康检查消息验证本地队列到服务器的往返；不把测试消息计为员工工作。
7. 显示各端的信任、重启和首次事件验证状态；仅在需要时引导到宿主原生确认入口。

示例输出只表达真正完成的步骤：

```text
身份绑定：已完成
本地后台：运行中
服务器连接：正常
Claude Code：已配置，等待下一次会话确认
Codex CLI / Desktop：需要在 Codex 完成 hooks 信任

完成提示中的一次信任操作后，照常使用 Agent 即可。
接入前未继续使用的旧会话不会批量上传。
```

“配置写入成功”“宿主已信任”“已经收到会话”“已备份到某个位置”是不同状态，不能用一个绿色“安装成功”代替。

### 插件市场路径

| 宿主 | 拟定员工流程 | 事实与验证范围 |
| --- | --- | --- |
| Claude Code | 添加公司 marketplace → 用户级安装 Skynet → 在敏感配置输入框填个人 Key → 执行一次 setup 导航 → 完成必要信任 | 官方 `userConfig` 支持遮蔽敏感输入；HTTPS archive source 可在支持版本中无需 git/npm 下载插件 |
| Codex CLI / Desktop | 添加公司 marketplace → 安装 Skynet → 运行一次 setup 导航并通过本地受控输入完成绑定 → 完成 hooks 信任 | 官方有插件安装入口，但不执行 Claude 的 `userConfig` 提示；具体 Desktop UI、初始化启动方式和所需依赖按版本验证 |

Claude 的 archive source 要求 v2.1.224 或以上。它解决下载插件的依赖，不自动提供运行程序：要实现无 Node/npm，需在发行包携带目标 OS/架构的预构建 collector，并验证执行权限、签名、升级及干净机器安装。Codex 不直接套用 Claude 的 archive 格式，单独验证其官方支持的来源。[Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces)、[Claude userConfig](https://code.claude.com/docs/en/plugins-reference)、[OpenAI 插件转换中的配置差异](https://developers.openai.com/plugins/guides/submit-claude-plugin)。

setup 导航可以是用户显式调用的 skill，但实际注册、自检和后台管理由确定性程序执行。Key 不作为聊天内容或 skill 参数交给模型；Codex 采用本地掩码输入/安装终端变量，不能声称与 Claude 输入框完全相同。直接运行随包 setup 程序是等价备用入口。

优先采用公司自有 marketplace，无需把公共官方目录审核当内部试点的前提。私有 Git/包下载若要求额外凭据，仍需计入安装步骤；已有公司认证或无需额外登录的发行地址更符合本项目目标。

npm 和插件入口共用稳定安装目录、设备身份、队列与协议。每个运行环境保存已注册入口清单；已安装 npm 后再装插件，或在两种 Agent 同时安装，不新增第二个后台。用户只为实际需要的宿主接入，不要求同时使用两个 Agent。

## 3. 一个变量怎样同时解决身份和服务器地址

### 首版选择：部署地址由管理员预先写入发行配置

这是内部自用产品，推荐为这一部署生成包含非敏感 `deployment.json` 的 npm 包及插件发行物：

```json
{
  "deploymentId": "company-skynet",
  "enrollmentOrigin": "https://skynet.company.example",
  "protocolVersion": 1
}
```

域名是示意占位。服务器地址、部署标识与必要公钥属于发行配置；**不能在包中放员工 Key、管理员凭据或模型 Key**。员工只填 `SKYNET_KEY`，无需另填地址、员工 ID、项目列表或模型配置。发行配置由管理员部署平台时生成，不要求每位员工修改。

`SKYNET_KEY` 对应平台已经登记的个人身份，用来换取该设备的长期接入凭据。服务端决定所属人员，忽略客户端自报的他人员工 ID。Key 可以有有效期和可登记设备数限制；每台设备获得独立凭据，可以单独停用。

设备凭据存于当前用户可访问的本地状态目录，Linux/macOS 限制文件权限，Windows 设置用户 DACL；后续可评估 OS 凭据存储。该文件不是发行包内容，不依赖 GUI 环境变量，不写入员工项目或宿主提示词。服务器仅保存可校验的凭据摘要。

设备上传凭据与 Web 登录、MCP 查询身份分别处理。所有 Web 登录用户仍按已确认需求共享查看全部数据，设备凭据本身不承担员工浏览器登录职责。

### 没有固定发行地址时的替代方案

通用包可以使用携带 HTTPS endpoint 的接入串，但必须明确其信任来自用户从已认证的平台页面取得它，不能声称“Key 自带公钥和签名就自证可信”。需要限制协议、重定向和凭据发送目标。首版不引入公共发现服务器，也不为支持多部署增加员工变量。

## 4. 客户端 Module 与 Interface

| Module | 对外 Interface | 隐藏的 Implementation |
| --- | --- | --- |
| Enrollment | `setup(key)`、`status()`、`repair()`、`uninstall()` | 身份绑定、安装状态、版本升级、现有配置合并、自检与回滚 |
| Agent Integration | `detect()`、`planInstall()`、`apply()`、`probe()`、`removeOwned()` | Claude/Codex 两个真实 Adapter、配置格式、可信流程、脚本引用与版本覆盖 |
| Local Capture | `recordHook()`、`observeActiveSession()`、`health()` | 会话登记、原件增量快照、原生子会话关联和来源验证 |
| Durable Delivery | `enqueue()`、`flush()`、`ack()`、`health()` | 落盘、重试、去重、网络退避、上传游标与积压管理 |
| User Runtime | `ensureRunning()`、`stop()`、`installAutostart()` | Windows/macOS/Linux 生命周期与 IPC、单实例锁和崩溃恢复 |

Agent Integration 是跨产品变化的 Seam；Claude 和 Codex 是真实的 Adapter。员工只使用 Enrollment 的小 Interface，内部配置复杂性集中在对应 Module。

## 5. 宿主接入策略

| 宿主 | 首选接入设计 | 必须验证的事项 |
| --- | --- | --- |
| Claude Code CLI | setup 安装用户级插件或 hooks 适配；由 command hook 给本地采集器记录事件 | 用户设置与已有 hooks 合并、工作区信任、当前 build 的事件及 transcript 路径 |
| Codex CLI | setup 注册用户级 hooks；需要时附带本地插件描述 | 精确定义信任、稳定 launcher、现有 config/hooks 保留、事件缺口 |
| Codex Desktop | 同一 Codex Adapter 检测其实际配置与 runtime，使用本地凭据和绝对命令路径 | 共享配置不等于自动证明支持；桌面端 hook 信任入口、重启加载、后台环境及全部事件需实测 |

npm 和 marketplace 是可选发行入口，plugin/hooks 是宿主集成方式，本地后台是可靠采集 Implementation。npm 路径自动完成支持的配置；marketplace 路径由用户在熟悉的宿主里选装，再完成一次绑定。支持的官方安装/配置路径优先；若某个宿主版本只允许 UI 安装，setup 提供定向一步引导，不直接伪造内部数据库。

不同时启用一份 Agent 的用户 hooks 和插件 hooks 造成重复采集；迁移入口时由安装登记处理所有权。服务端仍做幂等去重。同一物理电脑的 Windows 与 WSL 属于不同执行环境，不能合并到一个只看 Windows 路径的后台。

MCP 不承担全局监听。关键采集由宿主事件和原生记录实现，不要求模型主动调用上报工具，也不在编码路径中同步等待远端 MCP。

官方依据：[Claude 插件参考](https://code.claude.com/docs/en/plugins-reference)、[Codex hooks](https://learn.chatgpt.com/docs/hooks)、[Codex 插件打包](https://developers.openai.com/plugins/build/plugins)。具体自动注册范围见安装研究，尚未通过实机验证。

## 6. 本地后台与权限

后台以当前用户身份运行，不要求全机管理员权限；在用户登录会话可运行时工作。不能承诺电脑关机、用户已退出或 OS 禁止后台时仍可上传。

| 环境 | 设计目标 | 不作的默认假设 |
| --- | --- | --- |
| Windows | 当前用户登录触发的后台任务，立即启动一次；隐藏窗口，Node/脚本或预构建程序绝对路径 | 不假设已打开的 Desktop 继承 PowerShell 环境；不申请最高权限 |
| macOS | 用户级 LaunchAgent，保存稳定运行路径 | 不依赖交互 shell 的 nvm/PATH |
| Linux | 用户级 systemd；不支持时采用明确的用户会话后台降级 | 不假设所有发行版都有 systemd，或已经启用 linger |
| WSL / SSH / 容器 | 每个实际执行环境有自己的采集实例与身份登记 | Windows 上安装一次不能自动覆盖所有远程或容器内的进程 |

上述是待验证的 OS Adapter 设计，不是承诺全部企业设备策略允许自动注册。后台注册被限制时，安装界面明确显示降级状态，不静默宣称持续补传已就绪。

初版不依赖需要本地编译的 Node addon：hook 将事件写入唯一临时文件，刷新后原子发布到 spool；后台单写者整理队列和游标。需要更高吞吐时可在 Durable Delivery 内替换存储，不改变宿主命令和员工流程。

hook 只做短时本地持久化，不读整份 transcript、不执行模型分析、不等待网络。失败应让员工继续编码，同时通过独立健康检查呈现缺口；“不中断工作”不能被解释为“故障时仍保证零丢失”。

本地通讯优先使用当前用户受限的 named pipe / Unix socket；若使用 loopback HTTP，则需要本机令牌并限制监听地址。只能读取由 Agent Adapter 验证过的会话路径，不能用一条任意 IPC 请求让后台上传任意文件。

## 7. 历史边界与持续备份

初始化时不遍历并上传既有 transcript。采集器维护接入后通过宿主活动事件登记的会话集合：

1. 新会话开始：登记并跟踪原件。
2. 接入后继续旧会话：登记该会话，获取它的完整原件及必要的关联材料。
3. 其他旧会话：不纳入扫描与上传。
4. 已登记会话断网：按本地队列恢复补传。
5. 分支/子会话：依据明确父子关系登记，不能把整个历史目录都当关联文件。

文件修改时间本身不足以证明一个旧会话被员工继续使用。如果目标端缺少可靠激活信号，应显示其能力缺口并进入验证，不能为了提高“覆盖率”退化成全目录上传。

进入跟踪集合后，由后台增量保存原件。活动 hook 提供快速提示，后台定时核对已登记路径，减少文件监听漏事件和 SessionEnd 未执行造成的损失。

## 8. 升级、修复和卸载

| 操作 | 产品行为 |
| --- | --- |
| 重复 setup | 幂等检查、修复归属配置、补齐缺失步骤；不重复创建后台任务或 hooks |
| npm 更新 | 下次 `skynet setup`/`repair` 将新版部署到稳定运行目录；包文件更新不自动等于正在运行的后台已升级 |
| 插件更新 | 当前插件引用当前载荷，后台按版本兼容规则升级；自启不引用会被清理的 plugin cache 路径，旧插件不把后台降回旧版 |
| 后台升级 | 保留旧版本至新版本自检通过，迁移游标与队列，失败回退；未确认数据不得丢弃 |
| 宿主配置变更 | 只修复本产品拥有的条目，保留用户其他配置；冲突时报告，不能覆盖整份配置 |
| hook 定义变更 | 按宿主规则重新取得信任；保持稳定 launcher 减少无必要定义变化，但不承诺永不需要确认 |
| `skynet uninstall` | 停止自启和进程、移除自身配置、撤销设备凭据；未上传队列默认保留并显示位置，再指导/执行 npm 包移除 |
| 直接 npm uninstall | 不承诺清理用户后台和 hooks，因 npm 没有可依赖的卸载脚本；安装页清楚指示用 `skynet uninstall` |
| 仅卸载一个插件 | 该入口退出；其他已接入 Agent 仍使用共享后台。缺少通用卸载回调时，通过下次协调检查修正登记；完整停用使用明确的整体卸载入口 |

配置修改按“读当前文件 → 验证格式 → 仅合并本产品条目 → 保留备份 → 原子写入 → 检查结果”执行，并处理并发修改。回滚按字段与所有权处理，不能直接覆盖安装后用户新增的内容。

本地原件队列和设备身份不放在某一个插件的可回收数据目录中。已登记会话的现有上传积压与“未来是否启用该 Agent 采集”分别管理；停用某一宿主后不新增该宿主的会话，尚未确认的材料保留并清楚显示。宿主没有承诺生命周期回调时，不宣称仅点击卸载即可立即清理全部后台状态。

## 9. 易用性验收

- 干净的受支持环境只需要一个个人 Key；不要求填写第二个 endpoint 环境变量或手改 JSON/TOML。
- 从 npm 安装开始，到 setup 的健康检查成功目标不超过两分钟，另行记录宿主信任/重启所需交互；不含安装 Node、下载 Agent 和首次大体积旧会话上传。
- npm 安装脚本被禁用时，显式 setup 仍然有效；CLI 不依赖 postinstall 下载的额外程序。
- 验证应覆盖已有第三方 hooks、多个运行客户端、含空格的用户目录、npm 全局目录与 Node 管理器切换。
- Desktop 在终端变量之外启动、Agent 关闭后断网恢复、重新登录后自启分别验证。
- 插件单独安装、npm 后再装插件、双 Agent 并发、插件升级与卸载其中之一，均保持身份一致、单实例和无重复统计。
- 声称无需 Node/npm 的插件发行物必须在没有 Node/npm 的干净机器验证，不能只在开发机演示。
- `status` 同时显示配置、信任、首次事件、后台、队列与服务器状态，不将未验证的采集显示为成功。
- 本轮只制定验收条件，未安装、发布或测试真实采集插件。
