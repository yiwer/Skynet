# #6：Codex CLI 自动存档与服务器恢复

状态：Windows x64 / Codex CLI 0.157.1 的正常 hook 审核、两个项目的真实 CLI 活动、产品自动上传、Web 工具结果查看和只凭服务器包原生续聊均已通过合成环境实验。**#5 的 Desktop UI/G0 仍未通过，本票不替代该验收。** 真实会话内代码修改尚未在本环境演练；补丁格式的公开流程回归使用合成材料，不能冒充真实原生修改记录。

## 使用路径

采集沿用 #4 的设备绑定与后台，setup 增加 `source: "codex-cli"`。`nativeRoot` 指向自己的 Codex home 下 `sessions` 绝对目录；`sourceOs` 为实测 OS（本次 `win32`），`sourceVersion` 可登记初始 CLI 版本，实际上传以原件 `session_meta.payload.cli_version` 为准，避免升级后继续记录陈旧版本。同一 state 不允许切换 Agent 来源。省略 source 仍按现有 Desktop 行为处理。

```json
{
  "server": "https://your-skynet-host.example",
  "enrollmentCredential": "个人接入授权值",
  "source": "codex-cli",
  "nativeRoot": "C:/Private/CodexHome/sessions",
  "sourceVersion": "0.157.1",
  "sourceOs": "win32"
}
```

完成 setup 并启动后台后，将绝对产品命令注册为 CLI 的普通 `UserPromptSubmit` hook。Windows 示例命令为 `& 'NODE_EXE' 'ABSOLUTE_CLI_JS' hook --state 'PRIVATE_STATE'`；必须在宿主的正常 hook 审核页查看准确命令并批准。修改命令后须重新审核。本票未提供市场安装/登录自启，沿用 #4 的显式后台进程；对应安装票继续完成。

未触发真实活动的旧会话不扫描。一个正常 prompt 事件登记后，后台继续核对该原件的增长并上传，无需用户手动同步。来源和项目在 Web 中明确标为 Codex CLI，原件未知事件照常保留并显示解析缺口。

解析版本 `codex-jsonl-3` 支持消息、带 namespace 的 function call、工具结果字符串或完整 text block 数组，以及 custom tool call（包含 `apply_patch` 补丁输入）和对应结果。文字旁混有不支持的图片/音频时整行保持未解析缺口；不把一小段可读文字当完整事件。工具请求中的补丁只是请求，工具输出是返回记录，不把两者自动声明成已验证代码交付。

## 服务器包恢复

通过 Web 保存恢复包，使用自己的全新私有目录：

```powershell
node dist/apps/collector/cli.js restore `
  --package 'C:/Private/Downloads/SNAPSHOT.skynet-recovery.json' `
  --target 'C:/Private/Restore/new-codex-home' `
  --source-version '0.157.1' `
  --runtime 'ABSOLUTE_PATH_TO_INSTALLED_CODEX_EXE'
```

`--source-version` 为通用版本参数；原有 `--desktop-version` 继续兼容，两者若同时提供且不同则报错。包的 source 决定适配器：CLI 的源版本、原件 native runtime 版本、目标可执行文件 `--version` 和当前 Windows x64 组合必须完全匹配实测 0.157.1。其他组合不写目标；依然能下载保存原件，UI 会显示待验证。已有目录、符号链接/junction、损坏包等保持 #5 的拒绝语义。

成功状态 `prepared-cli` 表示原件已写入新的 native home；回执包含原员工、快照和原会话 ID。它不恢复配置、登录、工作区、依赖或关联附件。为这个新 home 独立配置所需登录/模型，按回执的原会话 ID 调用原生 `codex resume SESSION_ID`，或同版本支持的 `codex exec resume SESSION_ID PROMPT`。从提升终端启动本版本时，宿主自身提示使用官方 `--no-daemon` 独立模式；该参数不取消 sandbox、权限或 hook 信任。

## 可复现测试

```sh
npm ci
npm run typecheck
npm run build
npm test
```

普通回归覆盖两个项目、实际元数据版本覆盖陈旧 setup 值、source 绑定不可切换、Web 来源标签、工具结果数组、补丁文本、未知格式缺口；全部采用合成材料。

真实 CLI 集成测试需要显式指定已安装的 CLI 和在仓库外安装的 Microsoft node-pty 测试工具（不作为产品依赖）：

```powershell
$env:SKYNET_CODEX_CLI = 'ABSOLUTE_PATH_TO_CODEX_0.157.1_EXE'
$env:SKYNET_NODE_PTY_ROOT = 'PRIVATE_EXTERNAL_DIRECTORY_CONTAINING_PACKAGE_JSON_AND_NODE_MODULES'
npm run test:codex-cli-native
```

`tests/codex-hook-review.ts` 只通过原生终端 UI 按键完成生成目录的 folder review、准确 hook command 的单条审核和 `t` 信任动作，保存屏幕文本及按键原因。测试没有写 trusted hash、添加 trust-bypass 参数或设置 sandbox 禁用。Windows sandbox setup 提示被返回，不创建机器账户或修改宿主安全设置。node-pty 在独立测试子进程中运行，避免 ConPTY 句柄干扰测试进程退出。

原生运行全部使用新的用户/home/appdata 目录、无账号凭据的 loopback 确定性 provider 和普通只读 MCP fixture。MCP 仅读取测试生成的 TypeScript 文本，无代码写入与 shell 执行。两个真实 CLI 进程产生原生 JSONL，正常已信任产品 hook 执行；测试从不重放 hook 事件。产品后台完成上传后，在浏览器查看原工具结果。随后下载服务器恢复包、停止后台、校验绝对路径后仅删除本测试生成的源 home，再用公开 restore 命令和新 home 运行真实 CLI `exec resume`。原上下文标记及历史工具结果出现在续聊请求中；没有源数据库/配置/凭据复制路径。

2026-09-28 本机结果：Node 24.12.0、Windows x64、Codex CLI 0.157.1、PostgreSQL 17 隔离容器。类型检查、构建、普通公开流程 3 项测试及真实 CLI 集成测试通过。完整实验输出目录包含 `hook-review.txt`、`hook-review-controls.json`、`codex-cli-real-hook-web.png` 和 `codex-cli-native-evidence.json`，每次运行输出该目录。原生 CLI 实测覆盖消息/普通 MCP 工具请求与结果/原生续聊；不覆盖真实 `apply_patch`、附件/子会话/compact、其他 OS 或 CLI 版本。

同日集成 #7 后，三来源共同类型检查、构建、4 项普通公开流程测试全部通过；并重新运行 Desktop 内置后端恢复、Codex CLI 正常 hook/恢复、Claude CLI 正常 hook/恢复三个原生测试，3 项全部通过。Codex 测试源文件使用 `tests/native-codex-cli.test.ts` 命名，原生测试不纳入默认 CI。合并保留 Claude 的独立身份解析、跨来源会话隔离、可选版本参数及原有恢复步骤。

## hook 延迟

`hook` 入口现在只加载小型输入校验与原子落盘模块；setup、网络传输、恢复及 Zod 均由其他命令按需加载。仍以独占临时文件写入、fsync、rename 和适用 OS 的目录 fsync 提交本地队列，错误按原语义记录缺口并成功退出，不延迟到后台才确认事件。

同一 Windows/Node 环境下，经编译的公开 hook CLI 串行 200 次、包含进程创建和持久入队：P50 **56.9ms**、P95 **74.2ms**、最大 **105.3ms**，达到本次 P95≤100ms 测量条件。优化前同方式测得 P95 122.9ms。本次未包括宿主自身启动开销，不据此声明其他设备、负载或整个 G0/G1 性能通过。
