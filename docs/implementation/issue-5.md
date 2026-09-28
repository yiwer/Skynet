# #5：服务器导出与隔离原生恢复

状态：认证导出、包校验、隔离恢复准备与真实原生后端合成续聊已实现并测试。**Desktop UI 打开/续聊与 #4 自动采集仍待验收，不能据此关闭 #5、解锁 G0 或宣布 V1 完成。**

本票的 tracer bullet 是：已认证读者从会话页下载可读材料或恢复包 → 使用公开 CLI 校验并写入全新隔离目录 → 相同版本的原生后端发现原会话 ID 并继续，保留历史上下文与工具结果。Web 同时显示来源、原生运行时、长度、哈希、材料范围和能力状态。

## 下载与恢复

登录会话页后选择“导出完整可读材料”或“下载恢复包”。导出内容来自当前选定的不可变快照，不受页面 100 条分页限制。可读 `.txt` 包含全部已解析记录和全部原件 JSONL 文本，包括未知与未闭合行；需要精确字节时使用原件或恢复包。三种下载均逐次校验读取凭据，没有公共下载 URL，响应禁止缓存。

恢复包 v1 是有大小限制的结构化 JSON，仅包含一个原件的 base64 字节、原始存档清单、快照/员工信息和整个结构的 SHA-256。原件自身的长度与 SHA-256 独立核对。包中没有可控制写入位置的路径、归档条目或链接。校验和检测损坏，不是来源的数字签名；应从已认证的服务器 HTTPS 入口下载并保管好包。

先构建 `npm ci; npm run build`。在 Windows x64 的独立测试账户或测试设备中执行（路径按实际文件位置替换）：

```powershell
node dist/apps/collector/cli.js restore `
  --package 'C:/Private/Downloads/SNAPSHOT.skynet-recovery.json' `
  --target 'C:/Private/Restore/new-codex-home' `
  --desktop-version '26.924.2738.0' `
  --runtime 'C:/Program Files/WindowsApps/OpenAI.Codex_26.924.2738.0_x64__2p2nqsd0c76g0/app/resources/codex.exe'
```

目标的父目录必须已存在、属于当前用户私有位置；在 Windows 核查其 ACL。目标目录必须全新，即使已有目录为空也拒绝使用；父路径的符号链接与 junction 被拒绝。CLI 检查包格式、清单校验和、原件长度/哈希、原生会话 ID、JSONL 闭合与 UTF-8/JSON 格式，再核对来源和目标 Desktop 版本、实际当前 OS/架构及实际运行时 `--version`。无匹配实验的版本/OS 组合在写入前失败。输入不符会给出具体错误且不改已有目标。

成功仅返回 `prepared-desktop-unverified`，并写入 `restore-receipt.json`，包含原员工、来源快照、会话 ID、原件位置、哈希与能力说明。任何中途文件写入错误均不返回成功；不完整的新目录有 `.skynet-restore-incomplete` 标记。选择另一个全新私有目录重试。恢复不会复制源配置、登录凭据、源数据库、代码工作区或运行进程，也不会改服务器历史归属。

**本票没有可声明已验收的 Desktop UI 操作流程。** 不要把后端测试命令当作真实 Desktop 验收。隔离测试账户中的正常 Desktop 打开、展示工具历史并继续对话，需按 #4/#5 的真实宿主流程补充证据后才可标记支持；不得通过粘贴原文、原设备 resume 或修改 hook 信任状态代替。

## 接口与适配边界

| 公开入口 | 结果 |
| --- | --- |
| `GET /api/snapshots/:id/readable` | 认证、纯文本、完整记录与原件文本导出 |
| `GET /api/snapshots/:id/recovery` | 认证、版本化结构化恢复包，最多 8 MiB 原件 |
| `GET /api/snapshots/:id` 的 `recovery` | 来源、原件清单、校验信息、实测目标与未验证条件 |
| `collector restore --package … --target … --desktop-version … --runtime …` | 与采集器绑定无关；包校验通过后仅写新隔离目标 |

`packages/recovery.ts` 管理包格式、校验和以及来源能力说明；`apps/collector/restore.ts` 管理目标校验与当前 Codex rollout 写入步骤。来源扩展应按 Agent 引入明确适配，不允许用任意路径解包替代验证。本票只有单 rollout 范围，附件、外部溢出内容、子会话关联材料、compact 完整性及跨设备谱系不声称通过；相关 G0 票继续处理。所有后端 fixture 能力描述均指相同版本的合成实验，不把来源清单 `capability=unverified` 改成完整备份。

## 可复现验证

普通合成用户流程不依赖原生客户端：

```sh
npm run typecheck
npm run build
npm test
```

真实原生后端测试需显式提供实测 Desktop 内置运行时，不读取用户登录或会话：

```powershell
$env:SKYNET_CODEX_RUNTIME = 'C:/Program Files/WindowsApps/OpenAI.Codex_26.924.2738.0_x64__2p2nqsd0c76g0/app/resources/codex.exe'
npm run test:native-recovery
```

2026-09-28 实测：Windows x64、Node 24.12.0、Desktop 安装包 26.924.2738.0、内置 runtime 0.158.0-alpha.2.1、PostgreSQL 17 隔离容器。类型检查、生产构建、普通公开流程 2 项测试与原生后端 1 项测试通过。

| 验证 | 实际结果 |
| --- | --- |
| 另一读者导出，匿名/设备凭据访问 | 读者可导出全员工材料；匿名与设备读取返回 401；历史员工归属保留 |
| 121 条会话内容 + 未知事件 | 页面只显示 100 条，可读导出与恢复包保留全部内容；字节原样相等 |
| Web 导出遇到 HTTP 503 | 显示错误，重新点击恢复下载；1440px/375px 无横向溢出 |
| 损坏字节/清单、未知包版本、非法路径字段、错会话 ID、半行 | CLI 明确失败，新目标未建立，服务器原件保持一致 |
| 版本/OS 不兼容、实际运行时不符、已有目标、junction 父路径 | 写入前拒绝；已有目标内容与目录项不变 |
| 真实后端只从服务器找回 | 原生生成合成上下文和动态工具调用/结果 → 公开采集入口模拟 hook 并上传 → HTTP 下载包 → 删除仅本测试生成的源 home → CLI 恢复到全新 home → native list/resume/turn 成功 |
| 原生历史与上下文 | 恢复前原件逐字节相等；未复制索引数据库/配置/凭据；续聊请求包含原用户标记、原工具调用、原工具结果；原 ID 保留至少两个 turn |
| Desktop UI/真实 host hook/真实模型 | 未验证。原生测试使用确定性的 loopback provider 和无副作用动态工具；没有 hook 配置、信任绕过参数或账号密钥 |

原生测试每次生成独立临时目录，输出 `native-recovery-evidence.json` 的位置；实验中删除的源 home 经绝对路径检查限定在该测试创建的目录，用户已有会话不被访问。证据摘要记录各断言、版本与未验证条件，不记录私密会话。

当前能力矩阵：

| Agent / 版本 / OS | 可读导出与包完整性 | 原生后端合成恢复 | 实际客户端原生续聊 |
| --- | --- | --- | --- |
| Desktop 26.924.2738.0 / runtime 0.158.0-alpha.2.1 / Windows x64 | 已测单原件 | 已测合成上下文与工具历史 | **待验证** |
| 其他版本 / OS / 附件与子会话集合 | 未作支持声明 | 恢复命令拒绝未登记组合 | 待后续来源票独立验收 |
