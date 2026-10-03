# Windows 本机接入与 npm 分发记录

日期：2026-10-03。目标平台：`https://skynet.91boy.cn`。本轮由用户明确授权安装本机采集器并测试，使用现有个人身份“Skynet 管理员”。完成了普通 Windows 环境中的 npm 安装、设备绑定、当前用户任务和合成存档链；**真实 Codex hooks 信任、真实 CLI 自动采集、Codex Desktop、登录/重启/休眠仍未验收**。

## 分发渠道核对

本轮查询 GitHub Releases API 返回 HTTP 200、发行列表为空；公共 npm 的 `@skynet/agent` 返回 404，`npm whoami` 返回 `ENEEDAUTH`。没有发布 GitHub Release 或公共 npm 包。

根目录 `package.json` 是私有服务端/前端源码包，未提供 `skynet` bin 和部署配置。因此直接 `npm install -g github:yiwer/Skynet` 不能完成员工接入。已有 `pack-agent` 才是员工发行入口：打包编译后的采集器、共享模块和 zod，提供 `skynet` 命令，并内置非敏感 `deployment.json`。包保留 `private: true`，没有 postinstall 和模型凭据。

本轮生成并安装的发行物：

| 字段 | 值 |
| --- | --- |
| 包名 / 版本 | `@skynet/agent` / `0.2.1` |
| 部署标识 | `skynet-91boy` |
| 平台地址 | `https://skynet.91boy.cn` |
| 本机 tarball | `E:/GenCode/Skynet-evidence/v2-2026-10-03/local-onboarding/release-0.2.1/skynet-agent-0.2.1.tgz` |
| 大小 | 1,218,006 bytes |
| SHA-256 | `2631bd905125fd4d0c6121be43147a25af6896963ac21440e7d9dc228f6fd4a2` |
| 采集器源码基准 | `e96e863987a5ca0c0445740fd892c8b57604aef3`；本轮未修改采集器源码 |
| 安装方式 | `npm install -g --offline --ignore-scripts --no-audit --no-fund <tarball>` |

发行目录的 893 个文件已检查，不含本次个人接入凭据或读取凭据。安装目录与凭据/本地队列分别存储。

后续可以把这个 tarball、校验文件与说明上传至已验证的 GitHub Release，员工下载后核对 SHA-256，再使用上述 npm 命令安装；也可让 npm 直接读取可信 HTTPS tarball URL。[npm 安装接口](https://docs.npmjs.com/cli/v11/commands/npm-install/)支持包归档与远程包地址。此路径不要求公共 npm registry 发布，仍需一次个人接入授权。

若选择公共 npm registry，需要先确定有发布权的 scope/包名、完成维护者 npm 认证、调整发行包的 `private` 设置并建立正式版本发布流程。本轮没有这些发布权限，不能把本地 tarball 称为已发布 npm 包。现有可用产物与缺口也记录在证据目录的 `release-manifest.json`、`SHA256SUMS.txt`。

## 本机最终状态

| 项目 | 实测值 |
| --- | --- |
| Node / npm | 24.21.0 / 11.19.0 |
| 检测到的 Codex CLI | 0.160.0 |
| 检测到的 Codex Desktop | 26.930.3748.0 |
| Claude Code | 未检测到，本轮未配置 |
| 标准 npm 安装目录 | `C:/Users/yiwer/AppData/Roaming/npm/node_modules/@skynet/agent` |
| 标准私有状态目录 | `C:/Users/yiwer/AppData/Local/Skynet` |
| 设备 ID | `9df093f5-77a8-46f8-b56e-da20e9ed13ac` |
| 运行版本 | 0.2.1 |
| 后台与平台连接 | `running` / `connected` |
| 正式当前用户任务 | `Skynet-929bb0c9796782b518cf53d5`，`registered` / `Running` |
| 任务权限与窗口 | 当前用户 `Interactive` / `Limited`，Hidden |
| 当前会话降级启动 | 无，`fallback: null` |
| 状态目录 ACL | 受保护，仅当前用户 SID 有访问条目 |

后续日常管理应在**从 Windows 正常启动的 PowerShell**中执行：

```powershell
skynet status
```

如果该终端尚未重新加载 npm 全局命令路径，可使用明确入口：

```powershell
node "$env:APPDATA/npm/node_modules/@skynet/agent/dist/apps/collector/cli.js" status
```

当前设备已绑定，正常使用不再需要设置 `SKYNET_KEY`。维护凭据保留在用户原有受限文件 `C:/Users/yiwer/.ssh/skynet.91boy.cn-operator.json`，没有写入发行包、宿主 hooks、仓库或验收输出。

## MSIX 环境差异与恢复

第一次从当前 Codex MSIX 环境内运行 setup 时，Windows 将逻辑 `%LOCALAPPDATA%/Skynet`、`%APPDATA%/npm` 重定向到：

```text
C:/Users/yiwer/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/Skynet
C:/Users/yiwer/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Roaming/npm
```

安装记录与 hooks 中保存了逻辑路径，计划任务却在包外启动。包外只读探针确认逻辑 launcher 当时不存在，LocalCache 中的 launcher 存在；Node 本身可运行。第一次任务未取得后台控制所有权，产品正确显示 `degraded` 并启动当前会话后台，没有将其记为自启通过。

恢复采用标准包外安装，没有为此改动采集器源码：

1. 固定校验旧任务 description、完整 action 和私有元数据后，停止并移除该任务；通过公开命令停止其共享后台。
2. 在包外预检标准目标目录和同名 npm 命令均不存在。使用 Hidden / Limited 的一次性当前用户任务执行固定脚本，不提升权限、不改系统策略。
3. 先建立仅当前用户可读写的状态目录，再复制旧私有状态；907 个文件逐一核对长度和 SHA-256。保留原目录作为恢复副本。
4. 在包外正常运行离线 npm 安装和 setup。最终设备 ID、`identity.json` 字节、现有 hooks 字节均保持不变；正式任务直接建立了监督进程与工作进程的认证控制关系。
5. 移除本轮所有探针、安装和验证的一次性任务，仅保留正式采集器任务。

脚本及证据保存在 `E:/GenCode/Skynet-evidence/v2-2026-10-03/local-onboarding/`：`probe-outside-msix.ps1`、`outside-probe.json`、`install-outside-msix.mjs`、`migration-copy-inventory.json`、`outside-setup-evidence.json`。

**仍存在 Desktop 路径边界**：在 MSIX 包内解析 hooks 保存的逻辑 AppData 路径，仍会指向已停止但保留的旧虚拟副本；普通 PowerShell 中解析的是标准安装目录。因此不能根据包外合成链通过而宣称 Codex Desktop 自动采集已可用，也不要在 Codex 内反复运行 setup 重新启动旧副本。没有删除恢复副本或创建循环 junction。真正的 Desktop hook 执行上下文仍需正常宿主信任后实测；若确认其从 MSIX 环境执行，应另行实现并验证能在两个执行上下文之间稳定寻址的受控安装路径，迁移时继续保留身份、队列与配置所有权。

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

## 真实宿主后续步骤

普通 Windows PowerShell 运行 `codex`，进入宿主正常 `/hooks` 界面，审查本产品的确切命令并完成必要信任。随后在独立测试目录开启普通新会话，核对平台是否收到该会话和本机 status 的确认上传记录。不能手工写入信任摘要，也不能以本轮人工合成事件的 `host-event-observed` 状态代替全部 hooks 已被信任。

本机 CLI 0.160.0 高于既有实测基线 0.157.1；本轮只验证该版本被正确检测及合成存档链，不声称 0.160.0 的所有原生事件、Token 统计或原生恢复已验证。Desktop 必须先解决/核实上文执行上下文和路径问题，再通过其正常界面完成信任与真实事件检查。登录、重启、休眠、Desktop 图标入口继续保持 `not-verified`，完整 G0/G1 不因本记录改为通过。
