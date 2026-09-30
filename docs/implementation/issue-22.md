# Issue #22：短会话公开分析链

2026-09-30：产品实现准备已接通，**#22/G3 验收保持开放**。前置 #21/G2 未通过，专用千问 PAYG 配置位置、实际模型、价格上限及预算尚未提供。以下是实际 Claude Code 2.1.281 与显式合成 loopback 提供商的测试；没有付费请求，没有读取已有用户凭据、Claude 配置或员工材料。

## Tracer bullet

- 公开上传保存不可变原件后，读取凭据通过 `POST /api/snapshots/:id/analysis`（空 JSON）提交持久任务，返回 202。相同快照及完整配置身份的 queued/running/succeeded 任务复用 ID，failed 可重新提交。设备凭据不能发起分析。
- `GET /api/snapshots/:id/analysis?offset=0` 返回可用性、分页任务/结果；`GET /api/analysis/:id` 返回单任务。均逐请求认证。未配置/离线明确显示不可用，原件上传、列表、读取与完整导出继续。
- 独立 PostgreSQL worker 进程调用**实际 Claude Code CLI**，不以 SDK 直接模型调用代替。冻结快照 hash、parser/prompt/runtime/model/config 身份、全部已解析事件、覆盖范围及 #19 EventOrigin/eventId、原员工/设备/项目/日期/context。关联材料显式排除，不算零活动或当前员工新增工作。
- Web 会话分析面板显示队列/运行/失败/结果，每条原句跳到固定 snapshot/line/block/UTF-16 offset/parserVersion。原材料来源优先保留 #19 location/materialId 的原始 JSON 行锚点，不将语义偏移加到 JSON 转义文本；另保留 inputSnapshotId/inputLocation 定位本次主原件中的精确原句。该材料映射兼容性有契约测试，原材料→正常宿主主原件整链仍由 #19 后续测试负责。MCP `read_analysis` 返回同一服务的分页结果，沿 `nextOffset` 继续。结果在 API 服务重启后保持。
- 实质结论必须有逐字引用。observed 只允许单条 tool result 原文与结论全文相同，说明记录存在，不证明真实交付。其他 observed 按说话人降为 claimed/inferred；空输出、不存在事件、伪造原句不发布结果。insufficient、未知成本不替换成零。

## 有界运行与隔离

显式配置文件指定 PAYG 的固定 Anthropic 入口 `https://maas.qianwenaiapi.com/apps/anthropic`、真实模型、专用凭据文件和预算。支持通用新 `sk-ws-` / 早期 `sk-`，拒绝 Token Plan `sk-sp-` 及 Anthropic `sk-ant-`，不自动读取环境密钥。依据：[API Key](https://platform.qianwenai.com/docs/api-reference/preparation/api-key)、[团队套餐 FAQ](https://platform.qianwenai.com/docs/token-plan/team/token-plan-team-faq)。fixture 必须显式 mode=fixture、HTTP 127.0.0.1、零价格/预算、无 credentialFile；API/Web/MCP 显示合成，不能作为正式验收。

每次原生启动新建自有 home/cwd/tmp，子进程只收到允许的环境项，不继承宿主 hooks/auth/settings/MCP/collector 配置。使用 `--bare --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --permission-prompts none` 与 JSON Schema draft-7。实际 CLI 只广告 StructuredOutput；没有自动信任或跳过 sandbox 的参数。[官方非交互运行](https://code.claude.com/docs/en/headless)、[CLI 参数](https://code.claude.com/docs/en/cli-reference)提供部署参考。

随机认证的本地门只接受测得 HEAD `/api/hello`（本地返回）及 POST `/v1/messages` / `/v1/messages?beta=true`；beta 固定标记仅本地允许，上游始终固定 `/v1/messages`。完整请求 schema 固定模型、正输出限额、text/tool history、唯一固定 StructuredOutput schema；非文本、未知参数、任意 query/路径和重定向均拒绝。原始 Buffer 有界收集，fatal UTF-8 解码，逐请求同步计数。每 job 响应总量 2 MiB，CLI stdout/stderr 总量 256 KiB；进程退出/取消/超时同时中止在途 fetch、关连接、等待转发，再删除新建 owned 目录。

默认输入 64 KiB（含规范化事件与归属，配置上限 128 KiB），最多 3 请求（配置上限 5）、4096 输出 token、90 秒。超限整条拒绝，不截断为“全文分析”。引用补齐后结果最多 48 KiB，覆盖元数据最多 16 KiB，列表按 80 KiB 有界分页。全局单并发、100 个在途队列上限；token/deadline 条件写回，过期 running 失败，旧离线配置 queued 宽限后失败，混合活跃配置不能静默选择。

预算使用部署者**核实的 token/字节及模型价格保守上限**，包含缓存创建、隐藏输出等最高费用，必须附 pricingEvidence/pricingVerifiedAt。fixture 不认证这些假设，也不证明千问账单或硬人民币扣费上限。budgetId 持久累计，成功和未知失败都保留预留，不退款；CLI 美元估计不是实付人民币，后者保持 null/未知。真实验收需要专用账号提供商额度配合。#24 继续完整租约、有限重试、版本隔离/结算边界；#23 继续长会话分段聚合。本票未扩展这些范围。

## 可复跑与部署

```powershell
npm ci
npm run typecheck
npm run build
node --test dist/tests/analysis.test.js dist/tests/history.test.js dist/tests/identities.test.js dist/tests/materials.test.js dist/tests/mcp.test.js
$env:SKYNET_CLAUDE_RUNTIME = 'C:/absolute/owned/claude.exe'
node --test dist/tests/native-analysis.test.js
docker build -f Dockerfile.analysis -t skynet-analysis:test .
$env:SKYNET_ANALYSIS_LINUX = '1'
node --test dist/tests/native-analysis.test.js
```

本机第一次 Docker build 因自动继承宿主 `127.0.0.1:10808` proxy 连接失败；仅该 build 传空 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/http_proxy/https_proxy/all_proxy` 后成功，没有改用户/Docker 全局配置。Linux 测试使用生产 worker 镜像、UID1000、read-only、cap-drop、no-new-privileges、PID/内存/CPU限制；合成 provider 只监听测试数据库网络命名空间 127.0.0.1。测试数据库、工作目录、Web/MCP/browser 及进程均隔离，结束删除 owned 容器、停止进程，保留外部合成证据。

生产显式叠加 `deploy/compose.analysis.yml` 与 `deploy/compose.yml`。库外创建私有配置/专用凭据（node UID1000 可读），参考 `deploy/analysis.example.json` 填真实模型、核实价格及预算，设置 `SKYNET_ANALYSIS_CONFIG_FILE` / `SKYNET_ANALYSIS_CREDENTIAL_FILE`；workDirectory 用 `/data/analysis`。示例零价格/预算故意不能用于 PAYG 启动。默认 compose 不启分析，worker 不挂载 originals 或员工 collector 状态。

## 证据和开放条件

- TypeScript / Vite 通过。相关普通回归 6/6：analysis 两项、history、identities、materials、MCP，18.44 秒；外部目录 `skynet-test-Us4LZJ` / `UahxoW` / `UMXTjq` / `11C1L5`。
- Windows 真实 Claude Code 2.1.281 最终源版本公开链 1/1，16.90 秒；`%TEMP%/skynet-test-B3TxgX/analysis-public-evidence.json`。恶意模型 Bash/外发命令被 CLI 禁用，无 sentinel；仅 StructuredOutput、poison HOME hooks/auth 不继承，伪造 event9999 不发布结果，挂起超时清理，期间上传/列表/下载仍成功，分析不回流员工会话。关联材料标记为排除，未进入模型输入。
- Linux 非 root 生产 worker 镜像最终源版本公开链 1/1，43.19 秒；`%TEMP%/skynet-test-oc2IFY/analysis-public-evidence.json`。实际 CLI→PG→HTTP/Web/MCP→原件引用、重启持久性、UID1000 与恶意命令无副作用通过；镜像 ID `sha256:d70c42b2ea52c200427094d037ae213c2b360239e290bdb5d1527fe924f10036`。
- 最后凭据兼容、原件 hash 绑定和响应限额修订后，analysis/MCP 再验 3/3，11.60 秒；`%TEMP%/skynet-test-LLSI9E`。同轮 typecheck/build 通过。
- 最后材料原锚点与输入语义偏移区分的契约回归 2/2，2.77 秒；原材料 UTF-16 起点保持 123，不叠加输入事件偏移 1。最终 typecheck/build 通过。
- 初次运行实际发现草稿 Schema 2020-12 被 CLI 拒绝，以及 HEAD hello / beta / temperature 合同差异；初始 diagnostic 保留外部。已按实测固定 draft-7/窄 schema，不以 build-only 结果替代原生验证。
- **仍未验收**：#21/G2、真实千问 PAYG 模型/计费/专用配置/预算、非合成分析质量及实际生产运维。#22/G3 不关闭，fixture 不解除前置依赖。#23/#24 和后续员工/项目报告继续按规划处理。

旧暂停草稿及认证回归历史见 bb9b3fd / 88d4c7f；本文件替代暂停描述，不将旧 build-only 结果追记为原生通过。
