# AC-32 独立首次读取分布运行器

本补丁仅增加测试与运行说明，不调整产品算法、缓存、容量上限或 3 秒 / 1 秒目标，也不表示 AC-32 已通过。正式命令会生成大量隔离环境，应在约定的测量窗口执行。作者只运行了 10 会话的小规模公开回归，尚未执行正式 1,000 会话、12 入口、每入口 20 次独立首次读取。

## 范围与测量边界

正式源态通过公开上传建立 10 人、4 周的 1,000 个逻辑会话，每人 20 个业务日、每日 5 个会话。每会话保留 20 轮用户、Agent、工具调用与结果，共 80,000 条业务事件、20,000 条用户消息、20,000 次工具调用、19,000 段等待，已知输入 / 输出 Token 为 2,000,000 / 500,000。来源为合成 Codex CLI 0.157.1；权限时刻保持未知。

20 个会话使用既有批准的 Analysis fixture seam：真实任务请求、队列、校验和持久结果，外部模型返回为确定性合成数据；980 个会话不补造推断。每个已分析会话保留全部 20 条提示词、20 条回复，并仅提取一项代表性已验证成果和一项声称成果。全部原始工具事件和确定性数值仍保留。源态准备使用公开 Analysis 作业的 `succeeded`、`applicable`、`processing.complete` 与 20 / 20 / 2 数量确认，不读取会话洞察或报表进行预热。普通 `assessmentFixture` 默认的 `/insights` 200 断言保持。

首次入口共 12 个：指标、用量与产出、会话产效、提示词、等待报表、等待明细、团队视图、指定员工周视图、能力人员列表、个人评估、员工画像和有内容日期的活动记录。活动日期取实际首个来源业务日期；周视图取有内容的一周。测量常用分页首页，导出的完整内容另作正确性检查，不将快速历史读取替换为 live 读取。

每个入口的每一个 cold 样本都启动独立 Node 子进程和全新、归属明确的 PostgreSQL fixture，从同一源态复制；前一入口生成的任何报表结果均不会进入下一入口。服务启动、恢复与文件校验在计时外。计时从公开 HTTPS 请求开始，到完整响应体接收并解析 JSON 为止；包括本地 TLS/HTTP 开销，不包含断言或浏览器绘制。cold 是新的应用与 PostgreSQL 进程，**不声称清空宿主操作系统文件缓存**。

每个 cold 后读取同一 live 入口一次得到 warm 样本。默认每入口 20 对，串行执行。P50 / P95 使用 nearest-rank；少于 20 条的 P95 为 `null`，不会作为通过值。重复环境、缺少任何入口、数据规模不同、缺少固定/全量/补传/历史检查、请求或断言失败均不能通过。诊断即使快速也只能得到 `diagnostic-not-acceptance`。每次子命令最多 20 分钟；测量阶段达到 4 小时后不再启动新样本，执行中样本仍受自身时限约束。达到界限保留缺失/失败，不补写成功。

## 原始状态隔离

Windows 已验证的 PostgreSQL 18.6 fixture 只有服务端工具，没有 `pg_dump` / `pg_restore`。native 模式先完成应用与 PostgreSQL 正常停止，再确认 `postmaster.pid` 不存在，复制停止的 owned cluster 和原件。每次恢复检查源态文件清单与 SHA-256；运行时主版本必须一致。复制到新的临时目录，使用新的 owner marker、进程与端口，不覆盖现有目录、不清理生产表。这个适配器只用于本机离线测试克隆，**不构成生产备份或灾备验收**。

Docker 模式用测试容器内的 `pg_dump` custom 格式和 `pg_restore --exit-on-error`，恢复到新建 owned fixture；本轮未在 Docker 实际执行该分支。恢复前后原件均核对完整文件清单与哈希。源态 bundle 含合成本地读取凭据和数据库密码，只保存在本机私有资料目录；公开证据使用 summary、observations 和单次 sample 文件，不上传 `source/`。

正常子进程在 finally 中关闭与删除自己的 fixture。协调器另保留精确 owner receipt，仅在该子进程已结束后补做归属校验和清理；marker 或容器归属不符时停止并记录清理失败，不扫描或停止其他实例。原始 bundle 保留供复现。

## 使用

先在待测固定工作树完成构建；正式执行要求干净源码。证据目录放在仓库外，使用新目录名：

```powershell
$env:SKYNET_TEST_POSTGRES_BIN='E:/GenCode/Skynet-tools/postgresql-18.6/bin'
$env:SKYNET_OPENSSL='D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH='D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME='E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
node --import tsx tests/ac32-performance.ts plan

# 只验证命令与小型公开克隆，不能验收性能。
node --import tsx --test --test-concurrency=1 tests/ac32-runner.test.ts tests/ac32-source-clone.test.ts

# 小数据逐入口检查；始终标为诊断，P95 不足样本时留空。
node --import tsx tests/ac32-performance.ts run E:/GenCode/Skynet-evidence/ac32-mini-new --mini --samples 1

# 正式测量：默认全部 12 入口，各 20 个独立 cold 和 20 个 warm。
# 只在已协调的空闲窗口执行；可能需要较长时间。
node --import tsx tests/ac32-performance.ts run E:/GenCode/Skynet-evidence/ac32-formal-new

# 完整 1,000 会话但仅一个入口/少量样本仍是诊断。
node --import tsx tests/ac32-performance.ts run E:/GenCode/Skynet-evidence/ac32-profile-diagnostic-new --entry profile --samples 1
```

`seed <new-directory> [--mini|--diagnostic]` 和 `sample <source-directory> <entry> <output-file> [--checks]` 用于窄复现；不要把手工重复使用应用实例的结果拼成独立 cold 分布。`summarize <observations.json>` 只计算既有观测的分布与完备性，不证明手工文件的真实性。真实证据须同时保留源码 SHA、源态 bundle hash、单次独立 PID/owner identity、实际 HTTP/正确性结果与环境。

## 验证与已知边界

作者证据位于 `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-ac32-measurement/`：命令范围、样本门槛、生命周期门槛均保留 RED→GREEN。`11-offline-clone-public.txt` 为公开上传→停止源库→两个独立克隆的回归：在第一个克隆补传/重算后，第二个仍得到原基线，源 bundle 未改变。`mini-all-1/` 的 12 个 sample 均完成 live、fixed、full、export、late、history、late-full；`summary.json` 明确为诊断，不能替代千会话性能验收。

合入集成 `64b7119` 后，`17-integrated-public.txt` 的 5 项公开回归全部通过（118.68 秒）：范围与分布三项、两个独立克隆、真实终止测量子进程后保留失败并清理精确归属数据库。`18-final-typecheck.txt` 与 `19-final-build.txt` 记录最终候选检查。先前 12 入口诊断发生在作者提交前，使用记录的基线 SHA 加未提交测试代码；它用于说明流程覆盖，不是干净固定源码上的正式性能结果。最终提交及各证据哈希见外部 `manifest.json`。

种子诊断发现两个既有容量边界，并未放宽：80 条业务事件的模型返回若包含 21 项 outcomes，扩展证据链接后触发 Analysis 的 60 KiB 上限（`no-validated-segment` 内部原因为 `Session inferences exceed bounded result`）。只提取代表性 outcomes 后，完整公共洞察投影仍为 **83,369 bytes**，超出 80 KiB，HTTP 413 提示读取分析与原文分页；其中 inferences 50,326 bytes、facts 32,104 bytes。见 `analysis-output-diagnostic.json`、`analysis-representative-diagnostic.json`、`insights-80k-capacity.json`。这些 413 不算成功；源态准备以另一个公开可验证的 Analysis 作业接口确认完成，报表若返回容量错误则正式样本失败。

完整 19,000 段等待的导出必须实测：运行器保留真实状态与响应字节数，并断言没有截短 intervals。若产品内部 16 MiB 消费者拒绝该规模，记录失败供产品修复，不减少回合数掩盖问题。尚未执行正式数据规模，因而本补丁也不声称该容量已通过。
