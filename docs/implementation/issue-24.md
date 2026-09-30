# #24 分析队列与故障隔离准备

状态：实现准备，G2 与真实 PAYG/G3 均未验收。没有专用真实配置、模型、价格证据和预算，不会调用付费模型。

## 接口与边界

- `analysisService.request(snapshotId, actorId, { trigger })` 创建冻结输入版本。内部 `actorId=null, trigger='scheduled'|'incremental'` 明确记录 system；HTTP 人工请求始终记录认证读者。日报可直接创建未人工请求过的合格目标，源员工归属只来自 EventOrigin。
- `prepareAnalysisInput` 检查原件哈希、字节长度和严格 UTF-8，再冻结全部已解析事件、EventOrigin、activity context 和覆盖缺口。损坏字节拒绝进入模型，原件不变。短输入大小超限明确拒绝；#23 负责有界长输入计划。
- `executeAnalysis(config,input,signal,beforeForward)` 是 #23 执行接缝。所有分段和聚合共享同一次 job attempt 的 signal 与 beforeForward；每次请求必须通过数据库当前 token/owner/lease/deadline 与请求计数检查。不能为每个 chunk 重建预算、租约或重置请求上限。中间摘要不能成为原件引用。
- 每个输入/配置 generation 持久限制最多 1–3 次尝试。全局事务序列化领取与预算预留；混用配置暂停领取。失效租约有限重试，旧 token 不能转发或发布；新快照会使排队/等待重试旧版本过期，已运行旧版本完成只保留历史，不覆盖最新适用结果。
- parser 与唯一在线配置改变同样推进目标版本并使旧排队任务过期；状态投影核对输入、parser、配置和 generation。旧队列协议的未运行任务迁移为过期；数据库协议 guard 拒绝旧代码直接改写当前任务状态、token 与尝试数。它隔离旧实现，不是数据库管理员的权限边界。
- 服务端独立轮询已跟踪目标、去抖最新快照准备，上传 ACK 不等待解析或分析；独立 worker 不挂载原件、不读取用户配置。定时报告可创建新目标，不要求逐会话人工请求，也不自动将接入前旧史当当前活动。
- 每次尝试预留预算；失败、失联和超时用量未知时保留预留。提供商实付保持 null，CLI 估计不作为人民币账单。队列页和 MCP `read_analysis_operations` 使用同一有界投影，不携带全部生成结果。

## 已验证的 tracer bullet

`npm run typecheck`、`npm run build` 通过。最终 `node --test dist/tests/analysis-queue.test.js dist/tests/analysis.test.js dist/tests/mcp.test.js`：4/4 通过（9.3 秒）。公开上传、认证请求和任务状态覆盖并发重复请求/领取、失效租约、持久请求次数、迟到旧 token、服务重启、有限总尝试、排队旧输入零尝试、运行旧输入非适用历史、system 调度、混合 worker 暂停、UTF-8 损坏拒绝与原始字节完整导出，以及自动增量去抖、parser/配置改变、新版本不消费旧排队任务、输入超限、正金额预留耗尽与未知失败不退款。隔离 PostgreSQL 故障注入仅在测试中直接修改租约，不提供产品故障接口。预算算术使用测试自建的合成专用凭据与假价格，只执行队列数据库操作，没有 CLI 或网络调用，不代表真实计费验证。

外部证据：`%TEMP%/skynet-test-eXNtHr/analysis-queue-evidence.json`。分析/队列/MCP/材料/旧会话定向普通回归 6/6 通过（18.3 秒）；身份/恢复回归 2/2 通过（8.7 秒）。OAuth MCP 和 Web 使用相同队列投影。没有重跑或掩盖 #14 Windows 全量分支中独立记录的维护失败。

实际 Claude Code 2.1.281 Windows CLI 最终探针 1/1 通过（30.9 秒），证据 `%TEMP%/skynet-test-5Mze6i/analysis-public-evidence.json`。只连接显式合成 loopback，恶意 Bash/外发指令没有副作用，无继承用户 hooks/auth/config；错误引用与挂起各在两次总尝试后失败，超时请求用量未知，原件仍可同步/查询/导出；公开 Web 队列、原件跳转及 OAuth MCP 同状态。Linux 非 root UID1000 镜像相同故障探针的最终复验进行中。

最终重跑曾真实发现 Web 重启迁移与在线 worker 的 PostgreSQL `40P01` 死锁：队列事务先锁 targets 再访问 jobs，迁移先获得 jobs DDL 锁再等待 targets。受控复现让旧实现稳定在 2.8 秒失败（迁移持有 jobs AccessExclusiveLock 同时被 claimant 阻塞），加入相同队列 advisory lock **在任何 DDL 之前**后，队列回归与原始 Windows native 复现通过。没有调大超时。重启会等当前短队列事务完成，而不会持有相反次序的关系锁。原先真实失败与这个 red/green 过程均保留，不算先前通过。

首次真实 Windows 探针在已经成功生成结果后，由旧测试错误假定原始 raw 引用仍返回 `events` 而失败。原件引用契约 #19 已有 `raw/material` 与独立 `inputLocation`；测试已改为分别验证原锚点和本次输入精确原句。该失败记录保留在 `%TEMP%/skynet-test-rVDioo/initial-analysis-diagnostic.json`，不算通过。

## 可复跑

普通队列测试使用自己的 PostgreSQL Docker 容器，不读取外部 DATABASE_URL。真实客户端测试只用显式 loopback fixture，不读取现有 Key。

```powershell
npm ci
npm run typecheck
npm run build
node --test dist/tests/analysis-queue.test.js dist/tests/analysis.test.js dist/tests/mcp.test.js
$env:SKYNET_CLAUDE_RUNTIME='C:/Users/Administrator/.local/bin/claude.exe'
node --test dist/tests/native-analysis.test.js
docker build --build-arg HTTP_PROXY= --build-arg HTTPS_PROXY= --build-arg ALL_PROXY= --build-arg http_proxy= --build-arg https_proxy= --build-arg all_proxy= -f Dockerfile.analysis -t skynet-analysis:issue24 .
$env:SKYNET_ANALYSIS_LINUX='1'
$env:SKYNET_ANALYSIS_IMAGE='skynet-analysis:issue24'
node --test dist/tests/native-analysis.test.js
```

剩余外部条件：G2 未通过；真实千问 PAYG 专用配置、模型、价格证据和预算未提供。部署方仍需核验真实计费上界、配置后执行真实请求验收，合成 fixture 不认证计费换算；#24/G3 保持开放。长会话分段属于 #23，日报自动创建目标属于 #28，本票仅提供共享任务/预算/版本接缝。
