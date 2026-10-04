# 会话洞察的有界阅读

一份普通的 20 轮合成会话包含 20 条提示词、20 条回复、两项代表性模型成果和 20 次原生测试结果。分析成功且全部引用有效，但模型推断与原件统计合并后为 83,369 字节，旧 `/insights` current 读取超过 80 KiB 后返回 413；旧固定版本分支又没有相同响应限制。本片修复读取方式，不删减原件、推断、事实贡献或引用，不修改 AC32 的 1,000 会话数据与性能门槛。

## 公开 Interface

`GET /api/snapshots/:id/insights` 与 OAuth MCP `read_session_insights` 共用 `sessionInsightsService.page`。保留既有嵌套字段，新增 `readingVersion: session-insights-page-1` 和 `pages`：

```json
{
  "version": "完整洞察的固定版本",
  "pages": {
    "prompts": {"total": 20, "offset": 0, "nextOffset": 6}
  }
}
```

`state`、`metrics`、`facts.*.value` 与 `complete`、分析/归属/更正版本始终表示**完整固定投影**。数组表示当前页，不能用数组长度替代 `pages[section].total`。每部分最多 20 项，并根据真实序列化结果收缩页长，使 JSON 不超过 32 KiB、MCP 文本封套不超过 48 KiB；不拆改单项或其引用。单项本身无法容纳时明确返回 413，不返回不能前进的续页。

可分页部分：`prompts`、`replies`、`outcomes`、`suggestions`；`codeChanges` / `tests` / `commits` 各自的 `Evidence` 与 `Contributions`；`appliedCorrections` 与 `pendingCorrections`。默认页预览各部分，指定部分时只返回该部分的条目，其他部分仍提供总数与续页位置。

后续页使用第一页的 `version`、对应 `section` 与 `pages[section].nextOffset`，例如：

```text
/api/snapshots/<snapshotId>/insights?version=<version>&section=prompts&offset=6
```

任何显式 `section` 都必须携带 `version`，包括预览页零条时返回的 `nextOffset: 0`；`offset > 0` 也必须有部分和版本。错误部分/越界位置为 400，版本不属于快照为 404，固定版本与指定分析不匹配为 409。`analysisId` 与 `version` 的读取使用同样的输出预算。引用保留输入快照、原始归属、精确行/块/文本偏移、逐字摘录和来源链接；完整集合可以沿固定页重组。

## 完整聚合与历史

内部 `read` / `readMany` / `readVersions` 仍返回完整 `SessionInsights`。分页方法不向报表、画像、提示词分母或更正验证提供不完整数组；新的读取标识不改变已有完整洞察版本。原有原件字节、解析记录数和处理范围上限保留。

当前读取仍验证原始字节；固定页沿不可变保存版本读取。新分析、更正和迟到记录不插入旧版本的后续页。更正以完整服务器投影验证 `expectedVersion` 和目标原事件；最后一页提示词与第一页具有相同验证流程。固定历史仍可读，原件下载逐字节不变。

## Web

会话侧栏按完整总数显示提示词、回复、成果与事实来源，按钮续读同一个版本。提示词更正选择器也能继续加载未显示的提示词；加载同版页面保留草稿，新版仍走原有冲突确认。刷新或切换后，中止旧分页请求并核对结果版本，防止迟到响应混入新内容。统计值和未知状态不取决于已加载条目数。

原有侧栏内部滚动保持。分页按钮、折叠入口和原句链接至少 44px，支持键盘、触控、320—1280 宽度明暗主题。本片没有新增外层滚动区或演示说明。

## 验证

沿 PRD 2026-09-28 已确认的上传、Reporting、Analysis 外部替身与 Web/MCP Seam。`tests/insights-paging-fixture.ts` 保留普通 20 轮、80 条业务记录和全部工具结果，经真实上传、队列、引用校验与保存进入；没有直接写分析结果表或改变 AC32 fixture。

- HTTP：原始 413 RED → 分页 GREEN。取齐 20 提示词/20 回复/两成果/24 原件引用/20 独立贡献，共 60 tests；每页 32/48 KiB；末页更正、完整 19 次后续提示词分母、迟到、重启、固定历史和原件字节。
- MCP：原完整大对象超过实际封套预算 RED → OAuth 授权后所有固定页与 HTTP 等值 GREEN。
- Web：原界面误显示首批 6 条为完整总数 RED → 完整总数、键盘与触控续页、末页更正、旧原句、固定版重载 GREEN。真实旧页延迟与刷新交错另作回归。

新分页三项与既有洞察四项、更正跨端一项合计 8/8 通过（135.09s）。独立静态复核指出 section 的 offset=0 同样要固定版本，补充公开 RED 后一并收紧查询合同；最终 HTTP/MCP/Web 三项再次通过（55.80s），包含刷新期间真正迟到的分页响应。证据位于外部 `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-insights-paging-*`。PG18.6 使用持久隔离工具路径，所有 fixture 自有数据库清理。本片不代表 AC32 性能或完整 V2 验收通过，也未部署或调用付费提供商。

独立复核进一步以公开 Browser 重现：已载 20 条提示词、选择末页返工并填写草稿后，同一不可变洞察版本刷新把已载集合替换为首屏，导致选择器失去末页目标。正式回归先复现 `rework:76 → task-type` 的 RED（20.50s）。修复仅在 snapshot、洞察版本与阅读版本均相同时保留已有分页集合；新版继续替换读取视图，编辑器仍以旧版本保留草稿并要求显式核对。新公开旅程 GREEN（18.11s），同时验证手动刷新、分析页刷新触发的洞察刷新，以及新版末页加载后核对并提交；没有修改服务器、更正 CAS 或固定版本合同。
