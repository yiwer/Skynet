# Qoder CN 分析配置与请求额度

本切片扩展已有公开 Analysis 配置、持久队列和运维页面。Qoder Agent SDK / qoderclicn 的实际执行适配由独立运行时切片提供，本文的测试不接触真实 PAT，不调用提供商。

Qoder 的 [Credits 文档](https://docs.qoder.cn/cli/sdk/cost-usage) 区分 Token 与 Credits，二者没有固定换算关系；Credits 字段缺失不等于零。配置中的三个 CNY 数值因此必须为零，只表示本模式不使用 CNY 预算算法，不表示提供商免费。SDK 1.0.50 与 CLI 1.1.64 固定；`origin=https://qoder.cn` 仅作提供商标识，由 SDK 执行，不复用 fixture HTTP 入口。

## 配置

以下为手动分析、仅允许免费模型的有限请求样例。路径对应专用 Qoder 镜像；专用 PAT 文件应由部署者另行配置，不能放进仓库、网页或公开配置。

```json
{
  "mode": "qoder-cn",
  "executable": "/opt/qodercn/qoderclicn",
  "runtimeVersion": "1.1.64",
  "sdkVersion": "1.0.50",
  "model": "qfmodel",
  "workDirectory": "/var/lib/skynet-analysis/jobs",
  "credentialFile": "/run/secrets/qoder-cn-pat",
  "budgetId": "qoder-cn-manual-1",
  "budgetCny": 0,
  "inputCnyPerMillion": 0,
  "outputCnyPerMillion": 0,
  "requestBudget": 6,
  "maxRequests": 2,
  "maxAttempts": 2,
  "requireFreeModel": true,
  "autoAnalyzeUpdates": false
}
```

`requestBudget` 必须是 1–1,000,000,000 的整数，至少能预留一次 `maxRequests`。`requireFreeModel` 在 Qoder 模式默认 true；运行时仍需逐次核对模型目录的 enabled、isFree 和 priceFactor，不能用此静态字段宣称任意模型免费。样例关闭自动分析。

读取配置时检查专用 `pt-` PAT 格式、文件长度和内容指纹。执行时 `readCredential` 再核对原指纹，变更的凭据不能静默附着到旧配置版本。公开配置不返回文件路径、PAT 或指纹，只保留配置 hash；Qwen PAYG 的既有专用 key 规则保持原样。Qoder 配置不能混入 fixtureOrigin 或 CNY Token 费率，其他模式不能携带 Qoder SDK/请求额度字段。

## 持久请求预留

`analysis_budgets.reserved_requests` 按 budgetId 保存累计预留，`analysis_attempts.reserved_requests` 保存本次预留。每次 claim 在已有队列事务锁中原子预留 maxRequests；超出 requestBudget 时不创建新 attempt、不转发，作业返回“请求额度已耗尽”。失败、租约丢失、进程重启和成功后未使用的预留均不退款。该值不是实际 Credits、账户余额或 CNY。

实际转发仍受已有 `allowForward` 持久计数、租约、截止时间、输入归属和当前 generation 检查约束。改变 model/config 或重新发起作业不会清零同一 budgetId 的历史预留。追加列迁移在原分析锁顺序内完成；旧 attempt 该列为 null，旧公开 payload 不新增请求额度字段。

公开新增字段只在适用时出现：config 的 sdkVersion/requestBudget/reservationRequests/requireFreeModel，attemptHistory 的 reservedRequests，operations.budgets 的 reservedRequests，以及结果 usage 可选的 providerCredits。现有 fixture/Qwen 的字段和金额预算继续保留。运维界面将 Qoder 请求额度、累计预留、已知请求次数和提供商 Credits 分开；缺失 Credits 显示未知，多个 attempt 仅部分已知时明确标注已知部分，不显示误导性的 ¥0。

## 公开验证

证据在 `E:/GenCode/Skynet-evidence/v2-2026-10-04/qoder-budget/`。

- `02-budget-red.txt` → `03-budget-green.txt`：配置/公开上传→HTTP 发起→Analysis queue→转发计数→失败→服务器重启→额度耗尽；公开请求预留保留且无凭据泄漏。
- `05-operations-red.txt` → `07-operations-green.txt`：租约丢失后旧 owner 不能转发，重试累计预留不退款；实际网页展示 2.25 Credits 与未知值，320/1280 双主题无外层溢出。四张截图在 browser/。
- `08-config-queue-regression.txt`：旧 durable queue（包含 fixture 与 Qwen 金额算术）和两个新公开场景 3 项通过；新增 CLI 负例的首轮把公开 `pt-` 前缀误当成完整秘密而失败，保留原日志，不算产品 RED。
- `09-config-validation-green.txt`：13 种配置负例通过真正 worker CLI 启动拒绝；不连接可用数据库或调用提供商。完整合成凭据仍逐项检查不泄漏。

本切片不能替代真实 SDK、提供商或生产部署验收；这些证据由运行时集成记录单独保存。
