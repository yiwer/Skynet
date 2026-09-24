# npm 安装与单授权变量：采集器接入可行性研究

研究日期：2026-09-24。范围：Claude Code CLI、Codex CLI、Codex desktop 的员工端安装、注册与持续运行。本文是架构输入；不实现安装器，不修改本机 agent 配置，不读取真实会话或凭据。

**事实**表示官方文档已经建立的行为；**推断/建议**表示本产品设计；**待实测**表示仍需锁定 OS、版本与执行环境验证。OpenAI 部分采用 OpenAI Docs，只引用允许的官方文档域。

## 1. 可行性结论

**研究判断：可实现“npm 安装 + 一个 SKYNET_KEY + 一次 setup”，然后无需日常操作。不能把“npm 安装后才设置环境变量”直接等同于“已开始持续采集”。** 安装脚本可能未执行；已结束的脚本不会因未来出现变量而重跑；没有运行中的程序就没有检测者。后两项是由安装生命周期与进程环境机制得出的推断，依据见第 2、5 节。

建议将员工操作收敛为三项动作，并允许 Web 提供一次复制的 OS 专用安装片段：安装包、设置唯一接入变量、执行 `skynet setup`。Codex 的 hook 信任和 Claude 的工作区信任仍走官方流程。`skynet setup` 是**拟设计的项目命令**，目前并不存在；一段安装脚本不意味着可以跳过宿主信任。

用户后续已接受各 agent 的 plugin marketplace 作为可选安装入口；第 10 节补充其能力与限制。npm 路径并未被否定，两种入口可以调用同一 collector 核心。

## 2. npm 能分发程序，但 postinstall 不是可靠的注册入口

**事实：** npm `bin` 字段会在全局安装时创建可执行命令的链接，Windows 创建相应命令 shim；Node 脚本仍需要 Node 可用。[npm package.json / bin](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/)

**事实：** 本轮官方 Latest 文档为 npm 12.0.2。全局安装/npx 可用 `allow-scripts` 指定获准执行生命周期脚本的包；`ignore-scripts` 会阻止脚本，即使已有允许设置。`strict-allow-scripts` 还可使未获准脚本导致安装失败。[npm install v12](https://docs.npmjs.com/cli/v12/commands/npm-install/) 当前脚本审批文档明确依赖安装脚本默认阻止；全局安装的审批配置不同于项目 `allowScripts`。[npm install-scripts](https://docs.npmjs.com/cli/v12/commands/npm-install-scripts/)

**事实：** 生命周期脚本有明确触发时点，npm 并非环境变量监听器；当前文档还明确 npm v7 起没有可依赖的 uninstall 生命周期脚本。[npm scripts](https://docs.npmjs.com/cli/v12/using-npm/scripts/)

**建议：** npm 包在发布前准备好可运行产物，尽量不依赖安装期下载/编译/注册服务。`postinstall` 最多作为辅助入口；正式接入由显式 CLI 完成，不要求用户关闭 npm 的脚本保护。安装成功与接入成功分别报告。旧 npm、企业 npmrc、禁用 bin-links、Node 版本管理器和全局目录权限需要独立检测。

## 3. Claude Code：用户级 hooks 与插件均能作为入口

**事实摘要：** `~/.claude/settings.json` 的 hooks 作用于该用户各项目。交互会话中，设置文件的 hooks（包括用户文件）在接受目录/父目录的 workspace trust 前不会执行。当前 hooks 支持 exec form：`command` 配合 `args` 直接启动程序；Windows `.cmd` shim 不能按真正可执行文件直接启动，可使用 Node 二进制加脚本路径。[Claude hooks](https://code.claude.com/docs/en/hooks)

**事实：** `claude plugin install` 是官方 shell 安装入口，默认 user scope；已有会话要 reload 或重启才能加载该 shell 命令新安装的插件。插件可从本地 marketplace 分发，组织策略可能禁止来源。[Claude 插件安装](https://code.claude.com/docs/en/discover-plugins)

**建议：** 第一版 setup 可选择用户 hooks 或插件中的一种，避免二者同时注册导致重复采集。若优先极简接入，可由 setup 合并用户 hooks，引用产品自己的稳定入口；保留现有配置与备份，不覆盖其他 hooks。若用户偏好插件管理，npm 包可携带插件文件及 marketplace，由 setup 调用官方安装入口。两者都不能把“全项目配置”表述为“尚未取得宿主信任的会话也必定采集”。

## 4. Codex：配置、安装、信任是三个不同状态

**事实摘要：** 用户 hooks 可位于 `~/.codex/hooks.json` 或用户 `config.toml` 的 `[hooks]`；多个来源会合并。非 managed hooks 必须审查并信任精确定义，信任绑定当前 hash，新/变化定义会被跳过；CLI 提供 `/hooks`。项目不可信时，用户级 hooks 仍可加载，但其自身信任仍需满足。真正的 managed 来源由策略信任。[Codex hooks](https://learn.chatgpt.com/docs/hooks)

**事实：** `codex plugin marketplace add` 支持本地目录和 Git 来源；官方区分 marketplace 注册与 desktop 中安装/测试本地插件。个人 marketplace 可以登记本地插件，安装副本进入 cache；启用插件并不会自动信任其 hooks，web 安装也不部署脚本。[OpenAI 插件打包](https://developers.openai.com/plugins/build/plugins)

**事实：** desktop 的 Codex agents 继承与 CLI/IDE 相同的 agent 配置；这建立了用户配置方案的依据，但不构成所有历史 desktop build 的行为保证。[Codex developer settings](https://learn.chatgpt.com/docs/developer-settings)

**建议：** setup 只注册受支持配置/本地插件并展示确切 hook 定义，通过 `/hooks` 或目标 desktop 的实际官方 UI 完成信任。不直接写入伪造 trust 状态，不将普通 npm 包伪装成 managed deployment，也不把 trust bypass 加进默认启动命令。面板至少区分“文件已安装”“配置已登记”“待信任”“已收到本端自检事件”。

**待实测：** desktop 各 OS/build 的信任入口、CLI 完成信任后 desktop 是否共用、何时重新加载、插件更新是否触发重新审查。本轮没有找到可让 npm setup 跨全部 desktop 版本静默完成信任的官方保证。不能把现有某台 CLI 的行为外推全部桌面端。

## 5. 一个变量应只用于注册，不依赖所有 agent 继承它

**事实：** PowerShell 修改进程环境变量只影响当前会话，子进程继承环境；Windows 还区分 User/Machine 持久范围。[PowerShell 环境变量](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables?view=powershell-7.6) Node 子进程的命令查找取决于传入环境的 PATH 或父进程 PATH。[Node child_process](https://nodejs.org/api/child_process.html)

**推断：** 从图标启动或早已运行的 Codex desktop 不必是配置了 `SKYNET_KEY` 的 shell 的子进程，不能保证读到该变量；shell 中有 `node`/`skynet` 也不能证明 GUI 或登录任务能找到它们。重启 app 不是所有启动环境问题的通用修复。

**建议：** `skynet setup` 读取一次 `SKYNET_KEY`，完成身份注册后，将设备凭据与服务器配置保存到用户级受限存储；hook 只引用本地配置/IPC，不把 key 填进 command、项目文件或日志。注册时解析实际 Node 可执行文件、采集器入口的**绝对路径**并正确处理空格；Codex shell 命令与 Claude exec form 分别生成和测试。Node 安装路径被版本管理器移除后需要 repair；可后续评估自带 runtime，但这会改变包体与升级方案。

这里的单变量承诺是“员工只输入一个注册值”，不是“系统永远不保存本地配置”。若禁止任何凭据持久化，就需每次启动都传入变量，难以同时满足 GUI、自启与无日常操作。

## 6. SKYNET_KEY 如何同时解决身份与私有服务器路由

本节为**产品设计推断**，不是 npm、Claude 或 Codex 提供的现成功能。

无结构随机 key 只是一段不透明值；没有预配置映射/发现服务时，客户端不能凭它推导任意私有服务器 URL。可采用下列任一路径维持“一个变量”：

| 路径 | 如何找到服务器 | 必须满足的信任条件 |
| --- | --- | --- |
| 企业固定 bootstrap | 企业发行包/受控配置内置本企业 HTTPS 注册地址；key 在该地址兑换设备身份和配置 | 包/配置来源可信，HTTPS 正确验证，bootstrap 配置受控；换部署需维护该映射 |
| 携带路由的 enrollment token | 同一个 SKYNET_KEY 值编码 endpoint、组织标识、短期注册凭据等 | 来源由企业可信渠道提供；验证 endpoint 与已信任组织策略/签名信任锚，不能信任 token 自带的任意公钥；限制重定向和凭据目的地 |

Base64 包装不是加密，也不是签名。若采用可携带地址的值，客户端应在注册摘要显示目标企业域名；员工不必另填服务器变量，但不能把不可信 token 的地址当作天然可信上传目的地。

**针对本次内部自用的建议：** 采用管理员打包进 npm 发行物的非敏感 `deployment.json`，记录本企业 enrollment HTTPS origin；员工只输入 SKYNET_KEY。不需要公共多租户发现服务，携带地址的 token 仅作替代方案。此文件及其发行来源是路由信任配置，不能被不可信项目文件随意覆盖；它不包含长期服务端密钥。这是本项目设计推断，不是 npm 或 agent 的标准配置文件。

建议 SKYNET_KEY 是每员工/每次安装的短期注册凭据，兑换独立、可撤销的设备身份，服务端绑定 employee_id 与 device_id。它不应是模型 provider key，也不应直接拥有 Web 全量浏览/后台管理权限。一次注册失败必须能安全重试；重跑 setup 不应生成重复设备、重复 hooks。

## 7. 持续采集需要自己的进程生命周期

**事实：** Node 的 detached/unref/独立 stdio 能使特定子进程在父进程退出后继续运行；它们没有提供开机启动、崩溃监督或升级协调的完整保证。[Node child_process](https://nodejs.org/api/child_process.html)

**事实：** Windows Task Scheduler 支持登录触发可执行程序；具体用户权限/安全上下文必须按目标安装方式确定，不能从官方管理员示例推断无需权限。[Windows 登录触发示例](https://learn.microsoft.com/en-us/windows/win32/taskschd/logon-trigger-example--scripting-) Apple 官方文档支持由 launchd 管理用户 agent，用户 agent 对应登录用户，不是无人登录时的系统 daemon。[Apple launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)

**建议：** npm 负责 CLI 和程序分发；setup 负责登记用户级启动机制、启动 collector、写适配配置、健康检查。collector 独立维护本地持久队列、会话增量备份与上传；短 hook 只交付事件，失败可落入本地 spool。不能把每次 async hook 当作受监督的常驻服务，也不能只在 SessionEnd 才上传。

建议覆盖的生命周期职责：

- **启动/恢复：** 用户登录启动；重复启动采用单实例锁；agent 开始会话时可检查本地服务状态。设备关机/用户注销期间不是“在线采集”，再次启动后补传。
- **退出/更新：** 明确停止、尽量 flush 后退出；队列和凭据放在 npm 安装目录之外。升级先准备新版本再切换，验证 hook 配置/信任状态；不假定 npm update 会重启已运行进程。
- **卸载：** 提供明确的产品 teardown 命令，撤销/清理自己登记的 hooks、启动任务与设备凭据，再移除包；不能依赖不存在的 npm uninstall hook 清理。队列与原始备份保留/删除策略单独决定。
- **可观察性：** status/doctor 显示真实 runtime、adapter 信任状态、最后事件、队列积压、最后成功上传；“npm 安装退出码为 0”不是接入验收。

**待实测：** Windows 普通用户安装与任务政策、macOS 当前后台项目许可、Linux 用户服务、WSL/SSH 的实际执行环境，以及锁屏/休眠/注销行为。Linux systemd 当前手册本轮抓取失败，未据其推导无权限静默自启保证。Windows 与 WSL 内的路径、Node、agent 配置不能当作同一环境。

## 8. 最接近用户目标的安装路径

以下是**设计流程**，不是已发布命令或已测试脚本：

1. `npm i -g <发布后的组织包名>`：只取得分发文件与 CLI。Node/npm 已安装且满足版本是前提。为维持一次 key 输入，发行物应允许员工匿名读取，或公司已预配 registry 登录；若还要求员工另做 npm login，就要明确它是额外前置步骤。
2. 设置唯一用户输入 `SKYNET_KEY`，然后执行 `skynet setup`。Web 可根据 OS 生成一个连续安装片段，安装成功才进入 setup；不要把实际 key 放到命令参数或安装输出中。
3. setup 验证目标服务器/身份，登记设备与本地受限凭据，配置稳定路径、用户 hook 或插件及后台启动，输出必要的宿主信任操作。
4. 员工完成宿主官方信任；setup/doctor 验证每个已安装目标端的合成事件进入服务器。未安装的 agent 标为未接入，不能冒充验证成功；以后首次安装可重跑幂等 setup。
5. 此后登录自动运行、离线补传；日常不需要填写日报或手动同步。

**简化空间：** 在企业受管机器中，IT 可统一部署可信脚本与真正的 managed policy，使员工步骤更少；这是另一条部署渠道，不是公共 npm 安装自动得到的权限。

## 9. 实施前最小验证实验

所有实验使用隔离用户目录与合成会话，不读取员工真实数据。

| 实验 | 必须观察到的结果 |
| --- | --- |
| npm 默认审批、ignore-scripts、旧受支持 npm | 安装脚本不执行时 CLI/setup 仍可工作，或者明确指出缺失依赖；不靠关闭保护救场 |
| 安装完成后才配置 SKYNET_KEY | setup 前没有误报已接入；setup 后才能登记身份并开始服务 |
| Claude/Codex 已有复杂配置 | 幂等合并，仅修改本产品条目；重复 setup/升级/卸载不损坏用户条目 |
| Codex 新/变化 hooks | 未信任时显示待信任；通过官方流程后生效；升级不暗写信任 |
| CLI 与图标启动 desktop | 无 shell SKYNET_KEY/Node PATH 时，已登记配置与绝对路径仍可采集；未满足则清楚降级 |
| 登出登录、重启、休眠、collector 崩溃 | 启动/恢复符合目标 OS 约定；数据缺口和积压可见，不重复启动多实例 |
| 离线、更新中断、撤销设备 key | 本地队列可恢复且有界；升级可回滚；失效凭据停止上传并显示状态 |
| enrollment token 错误域名/签名/重放 | 不向非预期目的地发送注册凭据或会话内容，错误不被包装成连接成功 |

建议首个样机只验证“合成 hook → 本地队列 → 服务端 ACK”与完整安装/卸载周期，先证明无日常操作和不破坏原 agent 配置，再扩大真实采集字段。

## 10. 追加：plugin marketplace 可作为另一安装入口

本轮用户允许采用 agent plugin market。以下继续区分**已经文档化的宿主能力**与**本产品需要开发并验证的安装流程**；未实际安装插件。

### 10.1 分发和作用域

| 入口 | 已确认的官方能力 | 对内部部署的判断 |
| --- | --- | --- |
| Claude Code marketplace | user scope 可跨项目安装，shell 有 install/update/uninstall 入口。[Claude 插件安装](https://code.claude.com/docs/en/discover-plugins) | 可以发布企业 marketplace，让员工在 Claude Code 内选装；无需为每个仓库添加项目配置。 |
| Codex CLI / desktop marketplace | CLI `/plugins` 可安装、卸载、启停；新会话加载新技能/工具。[Codex 使用插件](https://learn.chatgpt.com/docs/plugins) 个人 marketplace 的选择写用户配置；安装副本位于 plugin cache。[OpenAI 插件打包](https://developers.openai.com/plugins/build/plugins) | 适合本机用户级部署；具体 desktop build 的重载和信任仍需测试。个人安装不能越过项目/组织策略，也不能代表远端机器已部署。 |

**事实：** Claude `archive` source 可直接用 HTTPS ZIP 分发，至少 v2.1.224，无须用户安装 git/npm；npm source 则使用 npm，取包时不执行安装脚本。[Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces) Codex 也文档化 npm source，但明确要求 npm CLI，并且不执行 lifecycle scripts；因此换成“npm 来源的插件”不会自动消除 npm 前提。[OpenAI 插件打包](https://developers.openai.com/plugins/build/plugins)

**建议：** 内部 marketplace 与公共官方目录分开考虑。此项目先验证企业自有来源；公开发布的审查不是内部可行性的前置步骤。OpenAI 公开提交指南明确提醒，依赖本地执行、任意本机文件或离线能力的核心功能可能需要专门审查，不能承诺未经审核即可公开上架。[OpenAI 提交转换指南](https://developers.openai.com/plugins/guides/submit-claude-plugin)

### 10.2 安装生命周期不能混同于会话 hooks

**事实：** Claude 在符合条件的缓存安装中会自动执行 npm/Bun 的锁定依赖安装，但使用 `--ignore-scripts`。另有 `command` source：用户接受后运行产生插件目录的本地命令，并可在后续会话重新运行；它有版本、策略与接受条件。[Claude 插件依赖](https://code.claude.com/docs/en/plugins-reference)、[Claude command source](https://code.claude.com/docs/en/plugin-marketplaces)

**事实：** Claude 的 `Setup` hook 由 `--init-only` 等特定启动方式触发；它不是“点击安装插件即执行”。实验性的 plugin Monitor 仅在受支持的交互 CLI 会话内随会话运行。[Claude hooks](https://code.claude.com/docs/en/hooks)、[Claude plugin reference](https://code.claude.com/docs/en/plugins-reference)

**未获官方保证：** 本轮查阅的两家 manifest、安装、更新、卸载文档没有建立通用的 `onInstall/onUpdate/onUninstall` 任意本地安装器回调契约。不能以没有找到资料断言永远不支持，但当前方案不能依赖它。已有 shell hook 能执行准备工作，不代表宿主替产品保证 daemon 注册、崩溃恢复和完整卸载。

**建议：** 显式 setup 承担一次注册与安装服务。SessionStart 可在信任完成后检查版本/连通性并做已授权的幂等恢复；不在每轮启动时联网下载依赖，不以自动运行 setup 绕过用户信任。卸载插件只移除该入口，不应未经核实就终止另一个入口仍使用的共享 collector。

### 10.3 授权值与宿主信任

**事实：** Claude `userConfig` 可在启用时请求值；敏感字段遮蔽输入并存入安全存储，hook 可从插件选项环境读取。OpenAI 不执行 Claude 的该提示/插值；其官方转换指南将 Codex 本地脚本配置指向显式环境变量或配置文件。[Claude userConfig](https://code.claude.com/docs/en/plugins-reference)、[OpenAI userConfig 边界](https://developers.openai.com/plugins/guides/submit-claude-plugin)

**建议：** 统一后端 enrollment 契约，入口各自适配：npm 使用 SKYNET_KEY；Claude 插件可用敏感输入框承接同一个注册值；Codex 插件调用产品 setup 的本地受控输入/配置流程。不要要求员工将 key 发到聊天里，也不要把 key 当 skill 参数让其进入会话历史。注册成功后共用设备凭据存储。

Codex 插件 hook 信任仍按第 4 节处理；Claude 工作区信任仍按第 3 节处理。授权数据采集、安装插件、允许执行具体 hook 和系统后台启动，是相关但不同的状态。

### 10.4 缓存目录不适合直接充当永久服务安装位置

**事实：** Claude 复制安装按版本分目录，旧目录有回收过程；`CLAUDE_PLUGIN_DATA` 跨升级保存，但最后一个 scope 卸载默认会删除它。Codex 从缓存副本加载，提供 `PLUGIN_ROOT` 与可写 `PLUGIN_DATA`。[Claude plugin cache/data](https://code.claude.com/docs/en/plugins-reference)、[Codex plugin paths](https://developers.openai.com/plugins/build/plugins)

**推断/建议：** hook 当次使用宿主传入的 plugin root 找当前适配器；OS 启动任务引用产品独立的稳定安装目录。setup 从插件或 npm 载荷将经校验的版本放入该目录，再协调切换。持久队列和共享设备身份由产品拥有，不依赖某一个插件的数据目录。不能把当前 cache 绝对路径写入永久自启配置，也不能声称缓存保留期等于服务支持期。

### 10.5 可以争取消除 Node/npm 前提，但必须交付真正的预构建程序

**事实：** Claude 的 plugin root 可引用随包二进制；OpenAI 转换指南也允许保留 helpers，并以包相对路径调用 bundled executable。[Claude plugin reference](https://code.claude.com/docs/en/plugins-reference)、[OpenAI bundled helpers](https://developers.openai.com/plugins/guides/submit-claude-plugin) Node 自身提供 SEA，把应用和 runtime 打包到单一可执行文件，面向未安装 Node 的机器；该能力当前标为 active development。[Node SEA](https://nodejs.org/api/single-executable-applications.html)

**设计判断：** 可使用平台预构建 collector，使员工无需另装 Node；Node SEA 仅是候选构建方法，不是已选实现语言。插件安装来源也必须不依赖 npm，才能同时消除 npm 前提。Claude HTTPS archive 具备直接文档依据；Codex 可先评估本地/Git marketplace 携带产物，不能把 Claude 的 archive source 当作 Codex 已支持。

**待实测：** Windows/macOS/Linux 与 CPU 架构选择、执行权限保留、签名/隔离标记、归档大小限制、动态库/原生模块依赖、升级回滚、插件包缓存复制，以及无 Node、无 npm 的干净机器从安装到运行全过程。分发目录允许包含文件，不等于所有平台会自动选择并信任正确二进制。

### 10.6 显式 setup skill 可做首次接入导航，日常采集由确定性程序完成

**事实：** Claude 可用 `disable-model-invocation: true` 让 setup skill 只由用户调用；Codex 可用 `allow_implicit_invocation: false` 并由用户显式选择 skill。[Claude skills](https://code.claude.com/docs/en/skills)、[Codex skills](https://learn.chatgpt.com/docs/build-skills)

**建议：** 提供 `/skynet:setup`（Claude 的拟定入口）及 Codex 的显式 setup skill，职责仅为找到随包程序、启动确定性的 setup/doctor、解释宿主待信任状态。实际命令执行仍受宿主工具权限影响；skill 不是原生安装回调，也不能保证 LLM 每次照做。因此保留直接运行随包 setup 程序的等价路径，并以程序状态/服务端 ACK 判断成功。

接入完成后，hooks → 本地队列 → collector → 服务器自动工作，不要求 LLM 每轮想起上传、不要求员工每天调用 skill。若产品变成“请 agent 主动总结并上报”，就偏离了已确定的无日常操作与实际活动证据目标。

### 10.7 本项目推荐与新增验收

**推荐：统一 collector 核心 + 两种可选安装入口。** 保留 npm + SKYNET_KEY + setup 作为可控基线；增加 Claude/Codex 各自适配的 marketplace 包，携带 setup、hooks 和同版本预构建载荷。用户选择熟悉的入口即可，不应被要求同时安装两套。

以下是需要实现的产品职责，不是宿主自带保证：

- 同一 OS 用户/执行环境只运行一个 collector，通过锁和 IPC 验证实例身份；两个入口共用 device_id、队列、凭据与稳定目录。
- 保存入口和适配器登记，重复 setup 幂等；避免 npm user hooks 与 plugin hooks 同时重复投递同一事件，服务端仍进行事件去重。
- Windows 与 WSL 等独立执行环境分别登记，不能为了“同机一个进程”遗漏实际运行在另一环境的 agent。
- 更新采用明确 owner 与兼容协议，旧新插件不能互相回滚 collector；卸载一个入口只解绑该入口，整体卸载提供明确的 teardown。
- 新增验收：仅插件安装、npm 后再装插件、双 agent 并发、插件升级时 collector 运行、卸载其中一个插件、无 Node/npm 机器、首次信任被拒绝、跨项目使用。全部以合成数据验证单实例、无重复、可恢复和退出可控。
