# #10 · G0 可持续复现与剩余验收

2026-09-30；对应 [#10](https://github.com/yiwer/Skynet/issues/10)、AC-05/06/07/10。G0 **尚未通过**。本批把此前临时诊断纳入仓库回归，并补齐独立 Codex 附件行的服务器包恢复。所有会话、目录、读者、工具文件和模型响应均为合成；没有付费调用、真实员工材料或信任/沙箱绕过。

## 当前结果

| 组合（Windows x64，Node 24.12.0） | 自动采集与原生续聊 | 复杂材料 | G0 判定 |
| --- | --- | --- | --- |
| Claude Code CLI 2.1.281 | 普通 hooks 覆盖两个项目；接入前建两条旧会话，仅继续一条，服务器只出现该条且保留接入前/后的原始日期；删源 home 后服务器包同 UUID 续聊 | 实际 Write→Read 的文件字节、原件工具参数/结果及续聊历史；实际 Agent general-purpose 子会话和 `.meta.json` 按原位恢复，SendMessage 续用原子 ID 并携带旧任务和 Read 历史 | partial：这些路径已测，全部 compact/侧文件类型及支持环境未完成 |
| Codex CLI 0.157.1 | 普通信任流程；两条接入前会话仅继续一条、目录 mtime 不触发上传；服务器包恢复同 ID 上下文/工具结果 | 实际原生父/fork、PNG、工具历史及独立附件行精确回填；复杂材料实验中 hook 是模拟的 | partial：本机普通 workspace-write 退化为 read-only，实际 apply_patch 尚未通过 |
| Codex Desktop 26.924.2738.0 / backend 0.158.0-alpha.2.1 | 已测服务器包恢复后的后端上下文/工具历史；实际 Desktop 自动采集与 UI 续聊待验证 | 后端实际父/fork、PNG、附件行精确回填；不外推 UI 或附件业务语义 | partial：需要可正常操作的隔离 Windows 账号/VM与 Desktop |
| 当前全局 Codex CLI 0.159.2、其他版本/OS/远程环境 | 当前版本检查已拒绝冒充 0.157.1；没有该版本原生恢复验证 | 未验证 | 待验证，不新增支持声明 |

CUA 当前原生应用清单为 `apps=[]`，只有浏览器控制面。本次未创建 OS 账号、修改原有 Desktop、复制用户凭据或绕过包身份。后端创建 renderer 的旧诊断不构成 UI 验收。

## 附件恢复行为

`restore` 仍只接受已测的来源/目标版本、OS、架构与真实可执行文件；只创建全新私有目录。Codex `codex-attachments` 材料在创建目标前验证 UTF-8/JSON、字段类型、UUID、创建时间、所属原件、ID及 `(thread_id,type,key)` 唯一性，全包最多回填 128 行。损坏、重复、错归属或缺少父原件明确失败，已有目录不被使用。

全新目录保留 durable incomplete 标记；原生 app-server 在仅有本包原件的隔离 home 中通过 `thread/list`/`thread/read` 建立索引。初始化使用不可用的 loopback provider，不调用 `turn/start`，不继承模型密钥或宿主配置。原生进程退出后，只打开新目标的 `state_5.sqlite`：严格核验列、主键、外键、唯一索引和无触发器，在单事务中写入原 ID、所属 thread、type/key、原始 JSON 字符串和创建时间，外键检查及 FULL synchronous/checkpoint 完成后才写成功 receipt。失败保留 incomplete 标记，目标不能被当作成功恢复重新使用。

服务器原始包和便携附件原件保持不变。receipt 的 `attachmentRowsReconstructed` 表示行回填数量，`attachmentPayloadSemantics: unverified` 明确保留未知类型、payload 语义、外部文件/URL与 Desktop 使用方式的未验证边界；不访问附件指向的外部资源。原件中的历史缺口仍保留。原生 `attachment/list` 能列回 ID/时间/type/key/结构化 payload，是较窄的行恢复证据。

`tests/native-materials.test.ts` 覆盖两个已测运行时：实际生成父、fork、PNG、动态工具与独立附件 → 公开 collector/API → 服务器下载包 → 删除测试 source home → 产品 restore → 精确原件字节/父边界及 attachment/list → 同 fork ID 原生续聊。包含保持全部包/材料校验和有效的重复行、错 owner、非 JSON payload、负时间注入；每项在目标创建前拒绝。宿主 hook 在此材料实验中是模拟的。

## 复现

先执行 `npm ci`、`npm run typecheck`、`npm run build`。额外准备已测原生运行时和仓库外的官方 `node-pty` 终端测试依赖，然后在 PowerShell 设置：

```powershell
$env:SKYNET_CLAUDE_RUNTIME = 'ABSOLUTE_PATH_TO_CLAUDE_2.1.281_EXE'
$env:SKYNET_CODEX_CLI = 'ABSOLUTE_PATH_TO_CODEX_CLI_0.157.1_EXE'
$env:SKYNET_CODEX_RUNTIME = 'ABSOLUTE_PATH_TO_DESKTOP_BUNDLED_0.158.0-alpha.2.1_EXE'
$env:SKYNET_NODE_PTY_ROOT = 'ABSOLUTE_EXTERNAL_NODE_PTY_PACKAGE_ROOT'
npm run test:g0-native
```

该命令串行执行六项：两个 CLI 的旧会话边界、Claude 的 Write/Read 与子会话恢复、两个 Codex 后端的材料恢复。每项建独立临时目录和 PostgreSQL容器，结束时停止自己的服务与后台；证据 JSON和截图在打印的临时目录中。CLI 普通信任终端脚本只信任显示的测试项目和确切产品 hook，不写信任哈希。

`SKYNET_NATIVE_SCENARIO=ordinary|old-session|code-change|subagent` 可选择单个 Claude 场景；Codex CLI 支持 ordinary/old-session/code-change。Codex 的 code-change 需要已经按宿主正常流程配置的 Windows workspace-write 沙箱，显式设置 `SKYNET_NATIVE_CODEX_WRITES=1` 才加入整组。其确定性 provider 的模型目录使用原生 [model_catalog_json 配置](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/core/config.schema.json) 暴露实际 apply_patch 工具。当前提升权限环境中 runtime 返回 `writing is blocked by read-only sandbox; rejected by user approval settings`；测试保持失败，不将普通模拟 patch 记录算作实际改代码通过。

若全局 CLI 已升级，可在仓库外独立 npm prefix 安装官方 `@openai/codex@0.157.1`（不改全局安装），指向其中的原生二进制。测试的严格版本检查不可删。

## 验证与尚未解决项

本批类型检查、构建、两版原生附件恢复及各 CLI 增补场景通过，最终整组结果见下方记录。普通公开流程全量测试出现 15/17：安装与插件入口两项都返回本地 runtime unresponsive；原件/恢复/材料/搜索等其余 15 项通过。另一次 installed Claude code-change 也出现同类失败，`hQ60LH` supervisor 记录 `Invalid supervisor handshake`、两次重启、无 worker；后续安全探测两控制端口均 ECONNREFUSED。没有把未知超时归因于负载或附件改动，也不以单次重跑通过抹去失败。运行时修复继续由 [#14](https://github.com/yiwer/Skynet/issues/14) 跟踪。

G0 仍需：真实 Desktop 普通信任/自动采集、多项目、旧会话和 UI 服务器独立续聊；Codex 实际代码变更的普通沙箱环境；来源实际 compact/大输出及尚未覆盖侧文件/附件的支持组合。完整支持矩阵与每项原件对照完成后，才能签收 #10；其他发布门槛仍须独立通过。

最终六项原生增补回归全部通过：Claude 旧会话51.81s（`am35Jw`）、Write/Read10.37s（`T5UcDo`）、子会话25.96s（`iKyW27`）、Codex 旧会话13.41s（`fXHp3P`）、Desktop 后端材料8.53s（`Frh0VR`）、CLI 材料7.05s（`TTEPSP`）。证据在 `%TEMP%/skynet-test-<目录名>/` 的 `native-claude-<场景>-evidence.json`、`codex-cli-old-session-evidence.json`、`native-materials-<来源>-evidence.json`，材料测试另有 `native-attachment-readback.json`。这些耗时包含各自隔离基础设施和原生进程，不是 hook 性能指标。全量15/17的运行时失败仍待修复。

最终补充的材料/公开恢复两项行为回归 2/2 通过（15.08s/6.10s；材料证据 `tU13PB`），类型检查、构建与 `git diff --check` 通过。
