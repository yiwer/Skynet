# #7：Claude Code CLI 会话存档与原生续聊

已打通一条窄的公开产品链：设备绑定 → Claude 普通用户 hooks → 持久队列与后台 → 认证 Web/完整可读导出 → 服务器恢复包 → 新配置目录 → 同一原生会话继续对话。实测使用 **Claude Code 2.1.281、Windows 11 x64、Node 24.12.0、隔离 PostgreSQL 17 容器，以及仅监听 loopback 的确定性模型替身**。

这份记录不代表 G0、Issue #7 或 V1 已验收完成。#5 的 Desktop UI 前置仍未通过；本票只验证当前收到的一个 Claude 会话原件，附件、子会话、压缩及其他关联材料由后续完整性票处理，真实模型续聊另行验收。对该组合的整体支持状态仍为 `partial`，清单能力保持 `unverified`。

## 接入与正常采集

构建后，给公开 `setup` 命令的 JSON 增加 `source`。授权值仍从 stdin 提供，不进入命令行、hooks 或会话文本：

```json
{
  "server": "https://your-skynet-host.example",
  "enrollmentCredential": "个人接入授权值",
  "nativeRoot": "隔离 CLAUDE_CONFIG_DIR 下 projects 的绝对路径",
  "source": "claude-code-cli",
  "sourceVersion": "2.1.281",
  "sourceOs": "win32"
}
```

`node dist/apps/collector/cli.js setup --state PRIVATE_STATE` 完成绑定，`run --state PRIVATE_STATE` 保持后台运行。旧配置不提供 `source` 时仍按 Codex Desktop 处理；一个 state 绑定的来源不能被再次 setup 偷换。跨客户端共用单一正式安装与后台仍属于后续安装票。

在**隔离测试账户**的 Claude `settings.json` 中，按[官方 hook 配置](https://code.claude.com/docs/en/hooks)注册普通 command hook：`command` 为 Node 绝对路径，`args` 为 collector 编译产物绝对路径、`hook`、`--state`、私有 state 目录。实测事件为 SessionStart、UserPromptSubmit、PostToolUse、Stop、SessionEnd。宿主正常配置/信任流程仍须遵守；本实现没有授予信任、修改用户现有设置或使用任何权限绕过开关。正式安装自动配置属于 G1。

hook 只写本地事件。后台仅处理被这些活动登记的原件，不扫描未继续的历史。Claude 没有 Codex 的首行 `session_meta`：后台从完整原生消息验证 `sessionId`、`uuid`、`version`，检查所有可识别记录中的会话 ID，保留未知或损坏行的原始字节并显示解析缺口。来源版本采用实际原件记录值。

跨工作区恢复时，2.1.281 的 SessionStart 可能先报告一个尚不存在的推导路径，UserPromptSubmit 才改为实际原件路径。后台按最近宿主观察更新路径，保留首次活动登记时间，不把第一个路径永久当成会话身份。服务器的最新会话与快照幂等身份纳入设备、来源和原生会话 ID，两个客户端碰巧同 ID 也不会被折叠。

## 阅读与恢复

会话页显示 Claude Code CLI 来源、原生版本、消息、工具请求和结果及原件行号。Edit/Write 等工具的已记录参数原样显示，可核查会话内变更；不据工具名称推断实际测试通过。Claude 的工具结果也是 user-role 记录，解析器把它们单独标为工具结果，不当成用户轮次。混有未支持图片内容的整行不会冒充完整文本消息；全部原始字节仍可下载。

`/readable` 按 Claude 解析器导出全部可识别记录和完整原件文本；`/recovery` 返回带来源、快照、字节数及双重 SHA-256 校验的 Claude 恢复包。包中不携带输出路径、配置、登录状态或设备凭据。

```powershell
node dist/apps/collector/cli.js restore --package SERVER_DOWNLOAD --target NEW_CONFIG_DIRECTORY --runtime ABSOLUTE_CLAUDE_EXE
```

`NEW_CONFIG_DIRECTORY` 必须绝对、尚不存在且父目录真实存在，无符号链接或 junction。命令先校验包、原件 UUID/版本、完整 UTF-8 JSONL、目标 OS/架构和真实 `claude --version`，全部通过才创建目录。现有目录、损坏、未闭合末行、未测版本或平台均被拒绝，不覆盖已有状态。

恢复回执为 `prepared-claude-unverified`；`nativeHome` 是新的 `CLAUDE_CONFIG_DIR`，`rolloutPath` 是原样恢复的 Claude transcript。独立配置认证和环境后，将 `CLAUDE_CONFIG_DIR` 指向该目录，用 `claude --resume SOURCE_SESSION_ID` 继续。目标只包含原件和恢复回执；恢复不重建代码工作区，也不恢复登录状态。**该回执表示材料准备完成，不是完整找回验收通过。**

## 可复现验证

通用合成流程（不需要安装 Claude）包含在 `npm test`：

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

原生客户端测试独立显式运行，要求本机已安装上述精确版本、Git Bash、Docker 与 Playwright Chromium：

```powershell
$env:SKYNET_CLAUDE_RUNTIME = '已安装 claude.exe 的绝对路径'
node --import tsx --test tests/native-claude.test.ts
```

原生测试自行创建两个项目、source home、Claude 配置及设备身份，使用普通 `--print` 模式和默认工具权限。子进程环境采用明确白名单；真实用户的配置、会话、API keys、登录状态不会传入。替身让真实 Claude 执行无副作用的 Read；用量和回答为合成数据，不可用作真实分析链或实际计费证据。Windows 临时目录先转换为真实长路径，避免短文件名被宿主权限判断为工作区外；不会通过扩大权限解决这个差异。

测试自动证明：

- 两个项目均由真实宿主 hooks 登记；无需手工重放事件。后台取得两个会话最终异步落盘的准确哈希。
- 另一已认证用户能在 Web 核查真实工具请求、工具结果及原件，并下载可读导出与恢复包。
- 停止采集后，只删除本次测试创建且已校验边界的 source home；用**服务器下载包作为唯一恢复材料**调用公开 restore。
- 新目录里的原件与服务器原件逐字节一致。没有原机器的索引、数据库或配置作为回退。
- 新 home 和不同空工作区执行同 UUID 的原生 resume；实际续聊模型请求含原始用户文本、结构化 Read 调用及包含 marker 的历史工具结果。

2026-09-28：类型检查、构建、3 个通用公开流程测试及上述原生测试通过。原生证据保留于测试输出目录的 `native-claude-evidence.json`、`native-claude-web.png` 与原生 CLI 输出；本次结果目录为 `C:/Users/Administrator/AppData/Local/Temp/skynet-test-38lJRi/`，不包含真实员工数据。测试结束清理自建容器，保留证据文件。

通用回归额外覆盖未继续历史不扫描、路径纠正、同设备跨来源同 ID 分离、角色区分、多内容块原件行定位、未知/损坏行不丢失、损坏原件拒绝恢复且目标不创建。

## 当前缺口

- 本票交付时仅覆盖 8 MiB 单原件；后续 [#9](issue-9.md) 已加入有界分块以及已知关联附件、subagent、spilled tool results、file-history、压缩前材料。未知引用和原生映射仍显示缺口，不将摘要视为原件替代。
- 只验证 Windows x64 / Claude 2.1.281 的普通非交互 CLI 与合成模型组合。交互安装、插件市场、其他 OS/运行环境、真实模型及 G0 完整矩阵仍待验证。
- 本票没有执行 G3 的 Claude Code + 千问按量链，也没有声称后台启动性能、5 个工作日试点或整个 V1 达标。
