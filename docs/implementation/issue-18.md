# 本地故障与采集覆盖缺口（#18）

日期：2026-09-28。对应 [#18](https://github.com/yiwer/Skynet/issues/18)，US 26、27、43、46、70 / AC-09。此 tracer bullet 从真实宿主 hooks、受控本地故障、后台采集、服务器报告打通到设备页、会话页和 MCP。**G0–G4 仍 OPEN，以下限定流程通过不代表整个 V1 或跨平台可靠性通过。**

## 行为与边界

- 设备私有目录中的 `capture-health.json` 保存已观察的本地存储不足、权限拒绝、来源消失、队列配额、采集不可用和未登记 hook 等故障。报告仅带来源、原生会话 ID、故障类别和观察时间，不上传错误堆栈、源文件路径或凭据。首次/最后观察时间不是工作发生时间，也不是精确丢失字节范围。
- `collectOnce` 无法生成新快照时仍能上报独立采集覆盖。设备身份只能报告自身；活跃读取身份可共享查阅。服务器保留故障行，后续报告中省略旧行不会删除历史。故障解除记录 `recoveredAt`，保留 `unverified-range`，不宣称之前缺失的材料已经补齐。
- 已提交快照的 `manifest.capture.gaps` 是当时不可变材料事实；后续覆盖报告不修改快照、原件、恢复包或活动计数。会话查询在原件缓存之外动态读取本会话及来源级故障。尚无任何快照的失败会话仍在设备页可见。
- Web 设备页区分最近连接、报告过期、待确认积压与采集缺口；没有宿主事件时明确不能区分待信任和尚无活动，提示查看正常宿主信任与首次事件。健康连接、空队列、没有故障报告都不是完整备份保证。会话页显示独立覆盖与修复提示。
- HTTP：`GET /api/snapshots/:id/capture-status?offset=0`、`GET /api/devices/:id/capture-status?source=...&offset=0`。MCP：`read_capture_status(snapshotId, offset)`，与 HTTP 共用查询；每页最多 5 项，提供下一页位置。`read_snapshot` 只给覆盖概要与该工具入口，避免大报告挤占原文页。
- hooks 保持仅本地有界登记，不读原件、不联网、不等待交付。满盘/只读目录连 `hook-gap.json` 也写不进去时，hook 仍返回成功并输出不含内容的诊断警告。后台存活且身份可读取、网络可用时，内存中的故障可上报服务器，标记 `locallyPersisted=false`。**磁盘和网络同时失效后进程退出，无法保证这段新诊断已持久保存；不会声称保存成功。**
- 不自动扫描未登记旧会话。满盘期间完全丢失 hook 的会话需要之后正常续用产生新事件，才会按既定历史边界取回现存全文。原件已经被清理的未知范围保留缺口。未确认队列仍按 #16 保留，512 MiB / 1024 份配额和告警可见；不会删除待确认材料腾空间。
- 本机详细诊断最多 128 项；达到上限后保留既有行与来源级 `diagnostic-limit`，提示检查，不静默覆盖旧故障。失败的临时 JSON / blob 写入会清理本次唯一临时文件，避免反复 ENOSPC 留下可清理的残片；不清除冻结待确认内容。
- 与 #13 合并后，最后入口移除的来源保留 `capture=false`：不读取 spool / 原件，不生成新的采集缺口，不把旧故障当已恢复，仅交付此前冻结材料。覆盖报告标记 `captureEnabled=false`；正常本地状态继续保留 `disabled; frozen-delivery-only`。
- Claude `agent-ID.meta.json` 现在关联 ID，恢复到同一原生 `subagents` 目录，与 `agent-ID.jsonl` 相邻；仅 JSONL 产生 child lineage，metadata 不产生第二个子会话或活动。这是精确映射修复，不扩张到任意附件映射。

## 可复现检查

普通公开流程和既有存档回归：

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

`tests/local-faults.test.ts` 使用独立 PostgreSQL、公开 setup / hook / run / HTTP：主原件真实删除、进程间读取、本服务重启、原路径恢复、后续故障保留、无快照会话设备可见、分页、读取/设备凭据边界与动态缓存更新。`tests/mcp.test.ts` 验证 OAuth 后覆盖工具与 HTTP 一致；合成报告仅用于协议边界测试，不冒充真实 OS 故障。

真实 Linux 故障需要 Node 24 与 Claude Code 2.1.281 镜像。仓库提供隔离测试镜像配方，不是生产分析镜像：

```powershell
docker build -f tests/Dockerfile.native-local-faults -t skynet-native-local-faults:2.1.281 .
$env:SKYNET_FAULT_TEST_IMAGE='skynet-native-local-faults:2.1.281'
node --import tsx --test tests/native-local-faults.test.ts
```

测试以 UID 1000 运行，只有自己创建的 2 MiB `/fault` tmpfs 被填满；工作原件位于另一个 64 MiB tmpfs。使用真实 Claude CLI、正常用户 hooks、回环合成模型，未调用付费接口。先正常采集 A；实际 ENOSPC 时 B 完成会话、200 次 hook 成功返回但不虚构存档；释放空间并正常续用 B 后自动补齐精确字节。A `chmod 000` 产生 EACCES 时 B 仍可完成编码回合，权限恢复后自动恢复读取。暂停本测试 collector，A 正常新增一轮后删除自己的原件，再恢复 collector，产生 ENOENT；B 仍完成工作，服务器保留 A 旧快照及无法补回的范围。没有操作用户文件、真实 ACL、宿主磁盘配额或其他进程。

这证明的是 Linux 普通用户和隔离目录行为；不是 Windows DACL 等价验证，也不声称被拒绝读取的原件仍能让原生 Agent 自身续用。全盘满同时离线、突然断电、真实 Desktop 正常 UI 仍未验收。

Claude metadata 路径回归可在已有 Windows 2.1.281 环境额外设置 `SKYNET_CLAUDE_RUNTIME`，运行 `tests/materials.test.ts`。该检查使用合成材料、真实可执行文件版本校验与公开恢复 CLI，验证 JSONL/meta 原位精确字节；不将合成子会话计作新原生续聊验收。

## 本次证据

首次真实故障通过：`%TEMP%/skynet-test-7esp2e/native-local-faults-evidence.json`，六次真实会话/续聊完成，满盘 hook 200 样本 P50 59.36ms、P95 84.38ms、max 128.97ms。同目录 `fault-session-desktop.png` 与 `fault-device-mobile.png` 已视觉检查；1440px / 375px 无横向溢出。

普通删除/恢复和授权证据 `%TEMP%/skynet-test-WrrPTQ/local-fault-evidence.json`；MCP `%TEMP%/skynet-test-17IJMr`。既有 #9 材料、#16 离线交付、#17 进程强杀专项分别在 `%TEMP%/skynet-test-H1zH1g`、`skynet-test-492bXa`、`skynet-test-grWavd` 通过。

最终集成包含 #13 `5f59560`、公共 #27 `099db05`、认证产品修复 `88d4c7f` 与认证测试竞态修复 `b71786e`（本分支对应 `f33b068`、`fe5187c`、`26cbb32`、`5894df2`）。typecheck / build 通过。17 项全量检查最初 16 项通过，唯一失败为已经定位的认证测试并行详情 401 抢先注销；应用该测试修正后，认证专项通过，未改变身份边界断言。合并后插件入口禁采、真实版本校验的 Claude metadata 精确恢复、最终真实 Linux 故障四项一起复验全部通过。

最终原生故障 `%TEMP%/skynet-test-txjgno/native-local-faults-evidence.json`，会话/设备两张截图已核对；metadata 恢复 `%TEMP%/skynet-test-ZdHqVo`，入口禁采 `%TEMP%/skynet-test-mbc20q`，认证 `%TEMP%/skynet-test-Cs4iG6`。同批四项并跑时，满盘 hook 200 样本 P50 **58.16ms**、P95 **111.35ms**、max **186.85ms**；P95 高于 100ms 目标，**该压力条件的性能门槛未通过**。前一轮 `%TEMP%/skynet-test-nw8Awr` P95 76.99ms 与首轮 84.38ms 均保留，不用较快样本覆盖这次结果。所有 hook 和六个原生回合均成功返回，功能路径没有等待远端；不把功能通过解释为全场景延迟达标。

所有材料均为合成，不包含员工记录或付费模型响应。测试 finally 清理本票容器、后台和临时登录任务；证据目录保留用于审查。按本批稳定节点暂停，不开始 #19，后续继续处理性能条件及仍开放的 G0–G4。
