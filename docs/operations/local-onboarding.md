# Windows 本机接入与 npm 分发记录

日期：2026-10-03。目标平台：`https://skynet.91boy.cn`。本轮由用户明确授权安装本机采集器并测试，使用现有个人身份“Skynet 管理员”。最终采集器为 **0.2.4**：普通 PowerShell 和 Codex MSIX 共用同一私有状态、设备身份和后台；完成六条 hooks 的原生逐条授信，并修复默认共享后台方式启动的 Codex CLI 0.160.0 来源识别。用户 22:11:49 的真实会话已自动补传，平台下载与本机原件逐字节一致，详见本文末尾。**Codex Desktop 本体的来源识别与图标入口、登录/重启/休眠仍未验收**。

## 分发渠道核对

本轮查询 GitHub Releases API 返回 HTTP 200、发行列表为空；公共 npm 的 `@skynet/agent` 返回 404，`npm whoami` 返回 `ENEEDAUTH`。没有发布 GitHub Release 或公共 npm 包。

根目录 `package.json` 是私有服务端/前端源码包，未提供 `skynet` bin 和部署配置。因此直接 `npm install -g github:yiwer/Skynet` 不能完成员工接入。已有 `pack-agent` 才是员工发行入口：打包编译后的采集器、共享模块和 zod，提供 `skynet` 命令，并内置非敏感 `deployment.json`。包保留 `private: true`，没有 postinstall 和模型凭据。

本轮生成并安装的发行物：

| 字段 | 值 |
| --- | --- |
| 包名 / 版本 | `@skynet/agent` / `0.2.4` |
| 部署标识 | `skynet-91boy` |
| 平台地址 | `https://skynet.91boy.cn` |
| 本机 tarball | `E:/GenCode/Skynet-evidence/v2-2026-10-03/local-onboarding/release-0.2.4/skynet-agent-0.2.4.tgz` |
| 大小 | 1,218,790 bytes |
| SHA-256 | `140bf5a879ef631307a3727004d811d37270203f1a177d37c7c4738a659a850f` |
| 采集器源码基准 | `236a71e127c4b570224f6422165ec617b559007b` |
| 安装方式 | `npm install -g --offline --ignore-scripts --no-audit --no-fund <tarball>` |

发行目录的 893 个文件已检查，不含本次个人接入凭据或读取凭据。安装目录与凭据/本地队列分别存储。0.2.1、0.2.2、0.2.3 归档均保留，没有覆盖已生成的 tarball；最终包证据为 `release-0.2.4-manifest.json`。

后续可以把这个 tarball、校验文件与说明上传至已验证的 GitHub Release，员工下载后核对 SHA-256，再使用上述 npm 命令安装；也可让 npm 直接读取可信 HTTPS tarball URL。[npm 安装接口](https://docs.npmjs.com/cli/v11/commands/npm-install/)支持包归档与远程包地址。此路径不要求公共 npm registry 发布，仍需一次个人接入授权。

若选择公共 npm registry，需要先确定有发布权的 scope/包名、完成维护者 npm 认证、调整发行包的 `private` 设置并建立正式版本发布流程。本轮没有这些发布权限，不能把本地 tarball 称为已发布 npm 包。

## 本机最终状态

| 项目 | 实测值 |
| --- | --- |
| Node / npm | 24.21.0 / 11.19.0 |
| 检测到的 Codex CLI | 0.160.0 |
| 检测到的 Codex Desktop | 26.930.3748.0 |
| Claude Code | 未检测到，本轮未配置 |
| 标准 npm 安装目录 | `C:/Users/yiwer/AppData/Roaming/npm/node_modules/@skynet/agent` |
| 唯一活动私有状态目录 | `C:/Users/yiwer/.skynet/state` |
| 设备 ID | `9df093f5-77a8-46f8-b56e-da20e9ed13ac` |
| 运行版本 | 0.2.4 |
| 后台与平台连接 | `running` / `connected` |
| 正式当前用户任务 | `Skynet-bb51b1a2de1d59ae029edef4`，`registered` / `Running` |
| 任务权限与窗口 | 当前用户 `Interactive` / `Limited`，Hidden |
| 当前会话降级启动 | 无，`fallback: null` |
| 状态目录 ACL | 受保护，仅当前用户 SID 有访问条目 |

普通 Windows PowerShell 与当前 MSIX 中的 npm 安装均已升级为 0.2.4，以下命令在两个上下文中返回同一状态目录、设备和后台实例：

```powershell
skynet.cmd status
```

如果该终端尚未重新加载 npm 全局命令路径，可使用明确入口：

```powershell
& "$env:APPDATA/npm/skynet.cmd" status
```

使用 `.cmd` 入口可避免 PowerShell 选择 npm 的 `.ps1` shim；不需要修改执行策略。当前设备已绑定，正常使用不再需要设置 `SKYNET_KEY`。维护凭据保留在用户原有受限文件 `C:/Users/yiwer/.ssh/skynet.91boy.cn-operator.json`，没有写入发行包、宿主 hooks、仓库或验收输出。

最终命令检查发现：MSIX npm 更新后，包外标准 npm 包及 shim 路径缺失，但稳定目录中的后台持续正常。已在包外使用同一校验通过的 0.2.3 tarball 离线重装本产品 npm 入口并启用 `--bin-links=true`，没有重新 setup、登记设备或重启采集后台。此后包外和 MSIX 均用上述明确的 `skynet.cmd status` 命令实测成功，返回相同设备、0.2.3、运行中的同一个后台；证据为 `standard-shim-status.json`、`msix-shim-status.json`。所有临时验证任务已移除，最终清单见 `final-owned-tasks.json`。

## MSIX 环境差异与恢复

第一次从当前 Codex MSIX 环境内运行 setup 时，Windows 将逻辑 `%LOCALAPPDATA%/Skynet`、`%APPDATA%/npm` 重定向到：

```text
C:/Users/yiwer/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/Skynet
C:/Users/yiwer/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Roaming/npm
```

安装记录与 hooks 中保存了逻辑路径，计划任务却在包外启动。包外只读探针确认逻辑 launcher 当时不存在，LocalCache 中的 launcher 存在；Node 本身可运行。第一次任务未取得后台控制所有权，产品正确显示 `degraded` 并启动当前会话后台，没有将其记为自启通过。

最初恢复采用标准包外 0.2.1 安装：

1. 固定校验旧任务 description、完整 action 和私有元数据后，停止并移除该任务；通过公开命令停止其共享后台。
2. 在包外预检标准目标目录和同名 npm 命令均不存在。使用 Hidden / Limited 的一次性当前用户任务执行固定脚本，不提升权限、不改系统策略。
3. 先建立仅当前用户可读写的状态目录，再复制旧私有状态；907 个文件逐一核对长度和 SHA-256。保留原目录作为恢复副本。
4. 在包外正常运行离线 npm 安装和 setup。最终设备 ID、`identity.json` 字节、现有 hooks 字节均保持不变；正式任务直接建立了监督进程与工作进程的认证控制关系。
5. 移除本轮所有探针、安装和验证的一次性任务，仅保留正式采集器任务。

脚本及证据保存在 `E:/GenCode/Skynet-evidence/v2-2026-10-03/local-onboarding/`：`probe-outside-msix.ps1`、`outside-probe.json`、`install-outside-msix.mjs`、`migration-copy-inventory.json`、`outside-setup-evidence.json`。

随后复核发现：逻辑 AppData 路径仍会让 MSIX 内的 hooks 落到旧虚拟副本，因此包外安装本身没有完成双上下文接入。最终作了以下受控修复与迁移：

1. Windows 新安装默认使用用户根目录下的 `.skynet/state`；优先识别其中有效的 installation 与 identity，兼容有效旧安装。损坏记录明确报错，不静默回退或创建另一身份。默认 setup 可在同一路径继续合法的空目录、enrollment、identity 中间态；空的新目录不能遮蔽旧设备身份。显式 `--state` 的完整安装 status/setup 与 identity-only setup 走共享安装分支，旧单来源接口仍兼容。
2. `tests/state-location.test.ts` 三项窄回归、全仓 `tsc --noEmit` 均通过，另由独立 subagent 复核首次 setup 重试边界。仅编译 collector 与共享模块，没有调用 Vite 或覆盖前端审计产物。
3. 用 Hidden / Limited 一次性任务在包外执行 `migrate-stable-state.mjs`。先核对源设备、launcher、唯一正式任务和后台归属，再持有源/目标安装锁，停止自有任务和后台，保护目标 ACL 后复制。909 个文件逐一核对长度与 SHA-256，迁移前的完整清单保存在 `stable-migration-copy-inventory.json`。
4. 仅重写本产品的 launcher/runtime 指针和精确拥有的 hooks；原身份、原件和队列字节保留，然后通过正常 `upgrade --state` 从 0.2.1 升至 0.2.3。身份文件 SHA-256 始终为 `3a0e103275668d95436e49e80f70a9570729fd677ebb8aed9a7957369415df39`。
5. 标准 npm 与 MSIX 虚拟 npm 安装均升级为 0.2.3。两边默认 status 确认同一设备和后台实例；hooks 的绝对路径现在直接指向 `.skynet/state`。标准 AppData 和旧 LocalCache 状态均保留为停止的恢复副本，没有删除或建立 junction。全部一次性任务已移除，只保留新正式任务。

首个一次性任务使用 PowerShell `-File` 入口时在进入 Node 脚本前退出，未创建目标目录或改变源；改为已验证的固定 `-EncodedCommand` 入口后迁移成功，没有修改执行策略。完整阶段、目录、任务与包哈希证据见 `stable-migration-evidence.json`；两个执行上下文的状态见 `stable-outside-status.json`、`stable-msix-status.json`。

## 本轮定向验证

只创建一个明确标记的合成会话和一个没有登记活动的诱饵原件，放在独立目录，没有扫描导入用户既有会话、运行真实付费模型、注销、重启或休眠。通过安装器生成的确切 hook 命令输入合成事件，不把人工输入当成宿主已授信的自动触发。

| 检查 | 结果 |
| --- | --- |
| 重复 setup | 同一设备、同一监督进程和工作进程，没有第二套后台 |
| 安装 hook → 本地后台 → 真实 HTTPS 平台 | 通过 |
| 相同合成 hook 重复执行 | 不增加快照 |
| 原件追加后不再发送新 hook | 已登记路径自动增量上传 |
| 未登记诱饵原件 | 未上传 |
| 初版与增量原件下载 | SHA-256 与本地原字节分别完全一致 |
| 初版快照不可变性 | 增量后重新下载仍与初版字节相同 |
| 线上对话与工具显示 | 4 条对话消息，工具调用/结果可展开 |
| 工具输出中的 script 字面量 | 作为文字显示，没有执行，页面无错误 |
| 私有状态 ACL | 仅当前用户，受保护继承 |
| 正式任务的本次启动 | Running、registered，无 fallback，后台控制关系吻合 |

合成会话 ID：`a3e61d8c-c79a-472d-987a-9cc3f06ca411`。快照共两版：

| 版本 | 快照 ID | 本地与平台共同 SHA-256 |
| --- | --- | --- |
| 初版 | `0696856c-af97-49e6-b450-a0410cb8e97e` | `339904266953c9f2dec0f36614545b8564073f9ec1a14bcb507a7695a9ed12d1` |
| 增量 | `5510f7bb-b049-43ae-8037-3333caedb61f` | `7c7795393bd6573bf8afc2731a50c58c79d223e2c1d174f9b8bdd8ab4cf292e7` |

[在平台查看合成会话](https://skynet.91boy.cn/#5510f7bb-b049-43ae-8037-3333caedb61f?view=conversation)。结果与截图分别为证据目录下的 `onboarding-test-evidence.json`、`final-status.json`、`production-synthetic-conversation.png`。首次包外浏览器检查因 Playwright 默认路径仍指向未安装位置而失败；随后显式使用已经安装的 Chromium 实际路径，对同一个合成会话完成验证，没有再新增会话。

## 原生 hooks 与无模型 CLI 验证

使用本机 Codex CLI 0.160.0 的原生 PTY `/hooks` 界面，逐条查看并信任六条 Skynet 命令：PreToolUse、PostToolUse、SessionStart、SessionEnd、UserPromptSubmit、Stop。没有选择 Trust all，也没有手写信任摘要。随后通过原生 `hooks/list` 只读核对，六条均为 enabled / trusted，warnings/errors 为空；命令全部指向 `C:/Users/yiwer/.skynet/state/skynet-launcher.mjs` 和该目录内的 codex inbox。该 CLI 版本列出六种已配置事件，未列出安装器 JSON 中的 PostToolUseFailure。

从当前 Desktop 启动的子进程继承了 `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop`。前两个无模型会话的原生 metadata 为 `source=cli`、`originator=Codex Desktop`；它们的真实 SessionEnd hooks 已进入稳定 inbox，但路由按现有边界保留为 unclassified，不猜测 Desktop 身份。会话 `01a101b7-99d8-7e81-8a8a-a5ad3c39db08` 和 `01a101b9-6184-7963-a4c3-c1cfc7708048` 的原事件继续保留，证据见 `native-empty-events.json`。

随后仅在新 CLI 子进程环境中移除上述继承变量，未改系统/宿主配置，也没有设置伪造的来源值。CLI 自身产生 `source=cli`、`originator=codex-tui`。在独立合成项目目录中打开普通空会话，仅执行 `/quit`：无用户模型提示、无模型 turn、无付费调用。真实 SessionEnd 自动触发 hooks，后台将原生原件上传至平台：

| 字段 | 实测值 |
| --- | --- |
| 原生会话 | `01a101ba-6189-7083-aa59-057d873fcc17` |
| 来源 / 原生版本 | codex-cli / 0.160.0 |
| 平台快照 | `a704cc1f-afbc-4798-b125-24693add0f71` |
| 原件大小 | 22,481 bytes |
| 本地原件与平台下载共同 SHA-256 | `2ad3960b0b2f712a244daba04c916ec1b905cd0575703afbb086e6563578fae0` |

[在平台查看原生空会话](https://skynet.91boy.cn/#a704cc1f-afbc-4798-b125-24693add0f71?view=raw)。此前合成会话两版快照也重新下载验证，仍与最初哈希相同。结果见 `stable-native-verification.json`、`native-hooks-current.json`、`stable-final-status.json`。

这证明了正常 CLI 0.160.0 的 SessionEnd 自动接入链与原件完整性，未验证该版本所有原生事件、Token 统计或恢复。实际 Desktop UI 来源识别、登录、重启、休眠和 Desktop 图标入口仍保持 `not-verified`；完整 G0/G1 不因本记录改为通过。后续 Desktop 验收应基于其真实来源证据补充路由与原生 UI 测量，不能将继承 Desktop 标识的 CLI 空会话当成 Desktop 全量验收。

## 默认共享后台 CLI 修复与真实会话补传

用户报告约 22:10 的 CLI 会话在平台缺失。核对原生 metadata、普通 PowerShell 进程与本机队列后，确认真实会话开始于 22:11:49；默认 Codex CLI 0.160.0 通过共享 app-server daemon 运行，原件记录 `source=vscode`、`originator=codex-tui`。旧路由只接受 `cli/codex-tui` 和 `exec/codex_exec`，将这批真实 hooks 保留在 inbox。此前空会话验证使用 `--no-daemon`，没有覆盖默认启动方式。

修复仅增加实测的 `vscode/codex-tui` 精确组合，没有将所有 `vscode` 会话归类为 CLI 或 Desktop。新增 `tests/codex-runtime-routing.test.ts` 使用公共 hook 命令、真实监督进程与工作进程、隔离 HTTP/数据库验证：修复前仅 daemon TUI 明确失败；修复后三种 CLI 来源上传且下载原字节一致，四种扩展、Desktop 与未知来源保持未识别。RED/GREEN 日志及哈希清单保存在 `E:/GenCode/Skynet-evidence/cli-routing-2026-10-03/`。

从固定 Git `236a71e127c4b570224f6422165ec617b559007b` 构建 0.2.4，先更新 MSIX npm，再在包外更新标准 npm 并执行正常 `upgrade --state`。设备身份、hooks 文件字节和正式任务名称均保持不变，无须重新配置凭据或重新授信。后台自动处理当时保留的 10 条用户事件（包括后来到达的 SessionEnd），没有重放会话或修改原件。两个先前来源不明的空会话事件仍按原字节保留。

| 字段 | 实测值 |
| --- | --- |
| 用户原生会话 | `01a1021b-5c62-7d11-b3bb-bdb0998f4e5a` |
| 原生开始时间 | 2026-10-03 22:11:49（北京时间） |
| 项目目录 | `C:\Windows\System32` |
| 平台提交时间 | 2026-10-03 22:22:25（北京时间） |
| 平台快照 | `03bf40a8-008d-4dfb-b091-8010372c1f2b` |
| 原件大小 | 106,317 bytes |
| 升级前、升级后与平台下载共同 SHA-256 | `0efa7692784020f5ea2dead09df32b949e722039d9d32c865ab81583971cc437` |
| 包外及 MSIX 命令状态 | 0.2.4 / running / connected，同一后台 |

[在平台查看这次真实会话](https://skynet.91boy.cn/#03bf40a8-008d-4dfb-b091-8010372c1f2b?view=conversation)。证据位于接入目录的 `upgrade-0.2.4-evidence.json`、`upgrade-0.2.4-outside-status.json`、`upgrade-0.2.4-msix-status.json`、`upgrade-0.2.4-final-tasks.json`；临时升级任务均已移除，仅正式采集任务保持 Running。独立生产 API 核对结果为 `cli-routing-2026-10-03/production-session-green.json`。本轮修复与回归没有发起额外模型调用。
