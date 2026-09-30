# #9 复杂材料、代次与关联原件

本票扩展 #4—#8 的单文件范围。公开路径为：已登记会话原件/关联材料变化 → 后台分块上传 → 全部字节校验和持久化后提交 → Web 历史、谱系、缺口和材料阅读 → 可读导出或服务器恢复包 → 全新目录恢复。G0、Desktop UI、真实模型以及整个 V1 验收仍未通过；MCP 使用同一查询/导出契约，由 #26 集成。

## 捕获与代次

`manifest.capture` 是可选扩展；没有此字段的旧快照继续可读。`generation`、`revision`、`change` 和 `previousSnapshotId` 保留增长、重写、截断及仅材料变化。增长/材料变化沿用代次，非前缀重写和截断产生新代次。所有已提交原件不可变，半行保留原字节，不算完整事件。已确认身份的原件暂时截成空文件也留存，显示身份无法重读的缺口，不能作为恢复候选。

宿主登记只赋予主会话资格。关联父子会话只作上下文，不创建新主会话、不计入主会话活动；相同文本的两条来源记录仍是两次活动。`history_base` 的字节和序号边界写入谱系，原生 JSONL 中全部字段及字节保留，绝不重排、裁剪或用摘要代替。此前材料消失时保留已存档版本，并明确标记源头缺失。

## 精确来源范围

| 来源 | 自动选取范围 | 限制与缺口 |
| --- | --- | --- |
| Claude Code CLI | 已登记 UUID 对应的 `subagents`、`tool-results`；同 ID 的 orphaned/superseded 前原件；`projects` 根对应的 `image-cache/UUID`、`uploads/UUID`；来源明确引用的 `file-history/UUID/backup`；内嵌图像 | 仅这些已知映射，不扫描其他会话。临时图像需 setup 显式给出 `nativeTempRoot`，按项目编码和会话 ID 选取。未知外部引用/原生映射不宣称可恢复。 |
| Codex Desktop / CLI | 原生 metadata 的 fork/history/parent 引用和结构化 `spawn_agent` 返回的 child ID；只读原生 `state_N.sqlite` 精确查询这些 ID 的 `rollout_path`，递归父链最多 32 项；仅选中 ID 的 `thread_attachments` 行；主原件内嵌图像 | 不上传 SQLite 全库，不从目录变化推定资格，不跟随任意消息文本里的路径。附件 payload 原样保存成独立 JSON；已测版本的隔离数据库行回填见 #10；未知附件类型的业务语义和外部文件映射仍未验证。父原件内嵌图像保存在父原件中。 |

每个路径都验证配置根边界、所有路径段的 symlink/junction、常见凭据文件名和硬链接；读取前后检查文件身份。拒绝 auth、credentials、settings/config、`.env`、session-env、shell-snapshots 等配置/凭据文件。file-history 同时检查原始文件名。已知引用缺失、读取失败、危险路径、超限和无法解释的格式都记录缺口。未知 JSONL 行始终保留，详情仍显示未解析数量。

每件上限 **64 MiB**，一个快照的主原件与关联材料合计 **128 MiB**、最多 128 件；单次上传块为 **8 MiB**。`POST /api/artifacts/assemble` 只组装同设备已持久化且 hash/长度相符的块，最终 hash 校验通过才允许提交。#8 的 append 后缀也使用此分块机制。超限主件保留 pending 错误和上次快照；超限关联件显示 size-limit，已保存旧版本不会被删除。这不是无限体积或低内存流式实现：目前在限定内存范围内读取、校验与导出，磁盘保留/清理由后续票处理。

## 查询、导出、恢复

- `GET /api/snapshots/:id/history?offset=0`：同设备/来源/原生 ID 的不可变快照，100 条分页及 `nextOffset`。
- `GET /api/snapshots/:id/materials/:materialId`：只能下载此快照清单中的材料，精确字节，需读取凭据。
- `GET .../materials/:materialId/view?offset=0`：32,768 字符分页；文本/JSONL 惰性显示，二进制显示 base64，不执行材料里的脚本或指令。关联材料不计活动。
- 可读导出包含全部主原件、全部关联材料、代次、谱系和缺口；二进制材料使用 base64。完整字节以恢复包及原件下载为准。
- 有 capture 清单时恢复包为 v2，携带每项材料 base64 与清单；逐件校验长度、SHA-256 和整包 metadata 校验和。v1 单件包保持读写兼容。任一宣称材料缺失则拒绝包，不生成不完整的成功包。
- 恢复只创建全新目标。Codex 父/子原件从自身原生 ID/时间推导位置，拒绝缺失父链、错误字节边界和运行时混用；Claude 已知 session/config sidecar 写入精确位置。无法验证原生映射的材料完整保存于 `skynet-associated/ID/artifact`，回执列出位置与未验证映射。原件中的绝对路径不会被静默改写，工作区、账号和配置不在恢复范围。

## 可复现验证

```powershell
npm ci
npm run typecheck
npm run build
npm test

# 以下为自备已安装原生运行时的隔离测试；不使用真实登录、数据或付费请求。
$env:SKYNET_CODEX_RUNTIME = 'ABSOLUTE_PATH_TO_MEASURED_DESKTOP_BUNDLED_CODEX_EXE'
node --import tsx --test --test-concurrency=1 tests/native-materials.test.ts
```

`tests/materials.test.ts` 经真实 PostgreSQL、公开 setup/hook/run、HTTP、Web 覆盖三来源增长/半行/重写/compact/空截断、旧快照哈希、同文本两条接入后活动、父上下文不增计活动、精确 SQLite 附件行、10 MiB Claude 工具材料及大 Codex append、关联字节丢失/篡改/非法路径、源删除后保留旧材料、超限 pending、历史和材料的桌面/375px Web 阅读。截图检查确认无移动横向溢出，脚本内容按纯文本显示。

2026-09-28：`npm ci`、类型检查、构建和 6 个普通 E2E 通过；Codex CLI、Claude CLI、Desktop 内置后端三条既有原生恢复回归也通过。新增 `tests/native-materials.test.ts` 用真实 `0.158.0-alpha.2.1` app-server 生成父会话（合成工具结果与有效 PNG）、fork 及独立附件，公开采集并下载服务器包，删除测试创建的 source home 后恢复到新 home。实际同 fork ID 续聊请求保留父用户文本、工具调用/结果、PNG；父原件逐字节相同，原生 `thread/read(parent)` 成功。

该运行时首次 `thread/list` 未列出还没有自有 turn 的空 fork；按 ID `thread/resume` 成功，fork 的 `thread/read` 返回自有 turn，继承上下文通过实际 provider 请求核验。独立附件行已保存在包中，原生数据库回填未验证。宿主事件在这个 fork 实验中为合成调用，因此它不证明 Desktop 普通 hook 或 Desktop UI。所有模型响应由确定性 loopback provider 生成，无信任或权限绕过。

隔离证据：`C:/Users/Administrator/AppData/Local/Temp/skynet-test-VtljDf/native-materials-evidence.json`、同目录的生成父/分支原件与 native read 结果；合成 Web 证据在 `skynet-test-FZoJ7f/materials-{desktop,mobile}.png`（测试会打印当次新路径）。原生格式研究笔记为外部 `skynet-v1-implementation/associated-material-research.md`。这些诊断不是产品恢复依赖，恢复只使用服务器下载包。

2026-09-30 补充：独立附件行的产品恢复现已在 Codex CLI0.157.1及 Desktop 内置0.158.0-alpha.2.1测到原 ID/时间/type/key/payload 的精确原生 readback；更早的“回填未验证”表述属于当时结果。未知附件业务语义、外部资源和 Desktop UI仍未验证。复现与边界见 [#10](issue-10.md)。
