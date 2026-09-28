# #27：按内容找到会话并打开原文证据

对应 [Issue #27](https://github.com/yiwer/Skynet/issues/27)、AC-12 / AC-17。打通公开上传 → 员工、项目、Agent、日期与内容组合搜索 → 固定快照命中 → 分页上下文 → 完整导出。Web 与 MCP 共用 `archive-query` / `archive-search`；本票不宣告 G0—G4 或整个 V1 通过。

## 使用与口径

登录 Web，在“搜索会话与原文”填写条件并点击“搜索存档”。姓名、项目是包含匹配；内容是不区分大小写的字面量，正则符号没有特殊含义。日期是命中原文的 `Asia/Shanghai` 来源日期，不是上传或接入日期。未知来源日期不匹配日期条件，关联材料没有可证实的事件日期，也不匹配日期条件。

默认搜索各设备 / Agent / 原生会话的最新已提交快照。勾选“包含历史快照与代次”可检索改写前的记录及每次修订；“仅未归类项目”保留项目未知会话的入口。同词的独立会话不合并。

每份匹配快照显示一个首个命中，顺序为已解析原文、原件 JSONL、文本关联材料。原件检索包含未知格式、元数据和未闭合末行；这些命中明确显示“原始格式”，不会变成已解析业务活动。二进制附件不做 OCR 或文件内容推断，仍可完整导出。

点击结果打开 `snapshotId + 原件行 / Claude block + UTF-16 文字位置`。URL 保存定位，刷新后重新登录仍可打开。已解析引用含解析版本；按原件行和 block 解析定位，忽略已过时的事件序号；解析版本改变会明确报错，保留原件行供下载核查，不静默跳到另一条事件。关联材料引用不可变 material ID，未知行引用原件行号。每页至多 2,048 个文字单元，不切开 surrogate pair；“继续读取原文”“上一段原文”“查看前文”可展开上下文。搜索跳转先读取摘要元数据，不把整份大输出塞进页面。已有完整原件、可读材料和恢复包导出不裁剪。

## 共享接口

| 入口 | 参数与结果 |
| --- | --- |
| `GET /api/search` / MCP `search_sessions` | `content`、`employee`、`project`、`projectState=all/unclassified`、`source`、`from/to=YYYY-MM-DD`、`history=latest/all`、`limit=1..10`、`cursor`；返回 `hits`、`nextCursor`、`complete`、本页 `scanned` 和范围说明 |
| `GET /api/snapshots/:id/location` / MCP `read_location` | 固定 `snapshotId` 与命中 `location`；event / raw / material 三种位置；返回 `next` 继续上下文 |
| 既有完整导出 | `prepare_export` / `read_export` 与 Web 下载复用原件及恢复契约；搜索不会改写内容 |

Web location 的字段放在查询参数；MCP 将其放入 `location` 对象。`hits` 为空仍可能有 `nextCursor`，只有 `complete=true` 才表示本次候选集合全部检查完毕。不能把第一页或已显示的命中数当全局总数。

## 持久性与资源边界

第一次搜索通过一个 PostgreSQL MVCC 查询确定有序候选 snapshot ID 集合，保存于可丢弃的 `archive_search_scans` 表。这样在途事务晚提交、上传新版本、服务器重启不会改变后续页面成员。分页绑定筛选指纹；改变筛选后必须重新搜索。此表不保存认证状态，每次 Web / MCP 请求仍重新认证并检查账号 active。

- 查询成员保留 15 分钟；过期返回 410，重新搜索即可，原件不受影响。最多同时保留 128 次查询；新查询会清理过期状态，容量不足返回 429。
- 单次候选集合最多 100,000 份；超过则显式返回 413，要求缩小员工、项目或 Agent 范围，不返回静默截短结果。候选 SQL 的每条语句有 5 秒上限。
- 每页最多检查 8 份快照，达到 128 MiB 读取预算后在快照边界暂停；考虑单份材料集合最多 128 MiB，单页读取量低于 256 MiB。最多返回用户指定命中数，并以约 7 KiB 命中载荷预算提前分页；一个命中至少保留完整元数据。
- 每个服务进程一次执行一项搜索 / 原件行读取。忙时明确返回 429，重试同一位置；不会排入无限内存等待队列。文件完整性错误使本页失败，不能跳过损坏证据后声称搜索完成。
- 全文直接来自已持久化不可变材料；不另建可能丢字的归一化索引。这是 V1 有限资源的顺序检索方案，大规模吞吐与目标容量仍归 #33。

## 复现与证据

```powershell
npm ci
npm run typecheck
npm run build
node --import tsx --test tests/search.test.ts tests/mcp.test.ts
npm test

# 指向明确安装的测试客户端及独立 node-pty 测试目录，沿用 #26 的正常授权路径。
$env:SKYNET_CODEX_CLI = 'C:/path/to/codex.exe'
$env:SKYNET_CLAUDE_RUNTIME = 'C:/path/to/claude.exe'
$env:SKYNET_NODE_PTY_ROOT = 'C:/path/to/test-pty-harness'
npm run test:mcp-native
```

`tests/search.test.ts` 创建隔离 PostgreSQL、原件与身份，105 个同词独立会话均通过公开上传和提交入口产生，跨 37 页全部找到。验证首个空命中页、查询期间新快照、历史代次、未归类、北京时间午夜、Claude block、未知和未闭合原件行、附件、emoji 大输出续读、完整导出哈希、Web/MCP 一致、解析版本拒绝及停用即时失效。另以隔离库内的延后提交事务模拟旧时间戳晚可见故障；这条故障注入不算原生采集验收。游标跨服务重启保持相同成员，模拟过期返回 410。Playwright 在 320 / 375 / 1440 宽度验证无横向溢出，保存截图并检视。

已有完整普通测试 12 项全部通过；增加持久成员与定位版本后进行针对性及最终整合回归，结果见下述最终记录。真实 Codex CLI **0.157.1** 与 Claude Code **2.1.281** 已各完成正常 HTTPS DCR / PKCE 授权和 **20 次** MCP 调用，包括搜索两页、三个独立匹配及按命中位置读取精确原文后缀。验证模型实际收到结果，没有依赖仅服务端或 SDK 成功。模型是确定性 loopback；没有付费调用，没有关闭 TLS 验证，没有修改用户客户端配置或全局证书库。

初次完整回归：`%TEMP%/skynet-test-cBj8QC/search-evidence.json`；持久成员、在途事务与过期回归：`%TEMP%/skynet-test-B4BMNH/search-evidence.json`；真实 MCP：`%TEMP%/skynet-test-SQXBme/native-mcp-evidence.json`。

最终合入公共分支 `198856b`（#12 当前用户后台、#17 确认一致性、查询缓存有界等待修复）后，typecheck / build 与全部 **14 项**普通测试通过，97.96 秒。搜索最终证据：`%TEMP%/skynet-test-bJzbct/search-evidence.json` 与 `search-{320,375,1440}.png`，截图已视觉复核。同期一致性证据 `skynet-test-ZfWuvw`、离线补传 `skynet-test-XNgDAr`、实际 npm 安装 / 后台生命周期 `skynet-test-prSNvt`。最终两真实 CLI 各 **20 次**调用再次通过：`%TEMP%/skynet-test-1zx8Gq/native-mcp-evidence.json`；此次含持久查询集合与原件行 / block / 解析版本定位。

正常 Desktop UI、真实千问分析、目标部署证书及五工作日试点仍待对应任务验收。
