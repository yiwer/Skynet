# #36 对话阅读与来源状态

2026-10-04。基于已交付的对话、工具卡片、Trace 与精确原句锚点，补齐长消息隐藏调用计数、原生轮次状态和真实投递观察。所有实现与验证使用合成原件，没有读取真实员工材料或写入生产。

## 阅读与来源语义

- 默认读取升级为 `conversation-3`。一条长 Agent 消息跨多个文本段时，前面的隐藏工具调用数仅在首段出现；尾部未被下一条 Agent 消息承接的工具只在最后一页显示。原文、顺序、行/块/字符锚点及 2,048 UTF-16 字符的消息与 Trace 元数据预算保持不变。
- HTTP 查询参数与 MCP `read_conversation` 可显式传 `readingVersion: conversation-2`。原 v2 cursor 仍沿旧解释继续，包含旧的计数位置和 unknown 来源状态。v3 cursor 绑定阅读版本、原件、归属、显示方式及投递观察修订；新收据到达时旧 v3 cursor 返回 409，要求重新读取，防止一轮分页混用状态。
- `packages/native/turn-state.ts` 按原件顺序识别 Codex 的 `task_started` / `task_complete`（及其 `turn_*` 别名）、`turn_aborted`，只表达该快照中的本轮进行中、已结束或已中断。它不表示整个会话永久结束，不使用普通 assistant 文字、文件时间或上传延迟猜测状态。不同 turn ID 的结束不会关闭仍活动的另一个 turn；缺失标识保留未知。Claude 当前没有该项可确认原件事件时同样保留未知。
- 原生依据：[Codex rust-v0.160.0 protocol.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/codex-rs/protocol/src/protocol.rs) 与 [rollout policy.rs](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/codex-rs/rollout/src/policy.rs)。本轮事件在 rollout 中保留；权限等待能力不由本票推断。
- 对话页新增默认折叠的“来源状态”，以短标签呈现本轮状态、压缩、缺口、未完成末行及已记录离线补传；展开后提供来源行与事实时间。历史上下文保持原有消息标签；工具结果是否出现放在消息的原件信息展开区。遵循用户后续要求，不恢复逐条泛化免责声明。
- 子会话沿已保存材料链接阅读完整原文；时间线证据锚点与对话锚点保持分别定位和高亮。

## 投递观察与持久化

新增 `POST /api/delivery/receipts`，仅设备凭据可写。服务端根据 `snapshot_uploads` 验证设备、upload ID、snapshot ID 的绑定，追加保存到 `delivery_receipts`；相同正文幂等返回相同服务端接收时间，不同正文返回 409。观察不进入原件、manifest、活动计数或分析事实。

新采集器为每个冻结代次持久化连接观察，仅确实失败的连接尝试增加次数；429、5xx、认证拒绝及无效 ACK 不算断网。原件 ACK 后先冻结收据到独立 outbox，原件代次可正常退休；收据端点不可用或 ACK 丢失时，收据按持久退避独立重试，进程重启仍发送同一正文。客户端的捕获/确认时间与服务器收据时间分别保留，不将客户端时钟差声称为可信端到端延迟。

历史快照、直接上传原件以及旧采集器留下的 pending 代次如果没有逐上传观察，离线状态保持 `unknown`。仅新版从入队开始明确记录零次连接失败的代次才显示 `not-observed`；有真实记录的连接失败显示 `observed`。迁移不把不存在的观察填成零，也不从全局最后一次网络错误猜该错误属于哪份存档。采集器升级后才会产生新观察，旧收据不会补造。

## 验证与复现

```powershell
$env:SKYNET_TEST_POSTGRES_BIN = 'C:/Users/yiwer/AppData/Local/Temp/ticket28-pg-0eb735e987dc48d186870e8a96801e01/bin'
$env:SKYNET_OPENSSL = 'D:/DevEnv/Git/usr/bin/openssl.exe'
npm run build
node --import tsx --test tests/conversation-public.test.ts tests/conversation-trace-public.test.ts tests/delivery.test.ts tests/v2-public.test.ts
```

公开边界：设备上传与 collector CLI、HTTP Evidence/Reporting、真实 HTTPS OAuth MCP、Web 浏览器。各用例使用独立 PostgreSQL、原件目录及临时 TLS CA；迁移用例只移除合成队列的新增观察侧文件，以复现旧版本没有此文件的持久格式，不修改合成原件或冻结 manifest。

| 验收路径 | 结果 |
| --- | --- |
| 原文、工具默认隐藏、下一条 Agent 与长消息分页 | RED 为一条消息的 1 次工具调用被 8 段累计为 8；GREEN 为 1，文本拼接与原件一致，尾部工具只在最后一页出现；v2 解释仍可读取 |
| 旧内容、压缩、缺口、本轮状态与未知 | 旧内容标签、压缩/缺口/未完成末行来源事实保留；真实轮次事件由 unknown 变为准确的本轮状态；普通消息和无来源事件保持 unknown |
| 离线补传与迁移 | 断网冻结、原文件丢失、进程/服务重启后原件准确补传；429/503 不标断网；旧 pending 无观察 RED 曾为 not-observed，修正后为 unknown |
| 收据认证、持久幂等和补送 | 未认证/读取凭据不能写，其他设备与其他快照不能冒领；重复收据不增计；改写 409；原件 ACK 退休后收据端点故障与 ACK 丢失仍可独立补送 |
| Web、HTTP、MCP 与原句 | HTTP/MCP 每页相同；普通 5 页、展开 16 页、Trace 8 页；35,203 字节原件不变；混合用户内容不隐藏、工具跨页关联、搜索精确高亮、时间线/原件与子会话链接均可用 |
| 展示边界 | 超长 ISO 小数秒收据由误接受的 200 修正为 400；正常 Trace 与正文预算继续受控 |
| 浏览器 | 320/768/1280 px、浅/深主题，来源状态 Enter/Space 展开关闭、减少动效、子材料可读；无外层横纵滚动或 page error，六张来源状态截图已人工查看代表样例 |

组合公开回归 4/4 通过；来源状态完整公开旅程、元数据边界修复及迁移边界分别定向验证通过。既有 V2 旅程保留 24 张截图；新增六张截图及 JSON 报告在 `E:/GenCode/Skynet-evidence/v2-2026-10-04/36-conversation/`。该目录保存每个有效 RED/GREEN、最终构建与证据文件哈希索引。等待时长与并行活动由 #37 继续实现；完整 V2、真实客户端能力矩阵与 AC-32 性能由后续票签收。
