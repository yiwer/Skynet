# #54 阅读交互收口

2026-10-04。基于已接受集成 `0150b664249122edddb6a9af5ae4bcd473f3358e`，处理独立 AC31 实页审计中可复现的两项问题：阅读控件触控目标偏小，以及打开分析原句或切换阅读方式后会话标题退回项目名。

## 行为

- 共享导航、搜索、主题/退出、会话阅读方式、原件链接、工具调用/结果、Trace 与折叠内容的实际操作区域至少为 44 × 44 CSS 像素。字号、主题色、工具默认折叠与内部滚动保持现有产品设计。小屏顶部栏仍为 52px；导航列表单独滚动。
- 会话首条真实用户内容继续作为阅读标题，保存在当前 snapshot 对应的页面状态中。同一会话的对话、时间线、原件、分析引用和返回保留标题；新 snapshot 不显示前一会话的标题，退出登录清除标题。
- 直接打开时间线、原件或锚点时，仅在缺少标题的情况下通过既有有界对话首屏读取标题。该请求可取消；读取失败时仍可访问原件。普通对话首屏沿用本来就有的响应，不新增重复请求。
- 原件、分析、指标、行/块/文本偏移、工具配对和 Trace 数据未改。此次不增加 Markdown 渲染：原型正文也是转义的纯文本。未来增强阅读格式须另行保持跨段偏移、安全链接与原文复制语义。

## 公开验证

全部材料为合成原件，通过设备上传、已确认的确定性 Analysis seam 和真实 Chromium Browser 登录读取；没有生产写入、真实员工材料或付费模型调用。

| 路径 | 证据 |
| --- | --- |
| 触控尺寸 | 修复前实际 DOM 测量发现阅读标签 34px、全局 Trace 40px、逐条证据/Trace 20px 左右、导航 38px 等；聚焦的跳转正文入口独立 RED 为 38.39px；修复后断言每个可操作目标宽高均至少 44px |
| 断点与主题 | 320 / 390 / 768 / 1280 / 1920px，各浅色和深色；10 态外层横纵溢出均为 false，截图在过渡完成后采集；目视 320 深色、1280 浅色与触屏工具配对结果 |
| 键盘与触屏 | 跳转正文入口 Enter 后聚焦 main；Trace 与其子条目 Enter 展开；工具触屏展开、配对结果跳转、焦点和正文实际进入视口；导航 Escape 返回触发按钮；主题切换与减少动画 |
| 阅读身份 | 原 RED 在实际时间线已经切换后找不到会话标题，显示项目名；GREEN 覆盖对话→时间线→原件→对话→分析原句→返回、全新页直接锚点以及切换另一 snapshot |
| 迟到响应 | 只延迟一次真实 HTTP 响应，不伪造正文；对话仍加载时选择时间线，旧响应释放后仍为时间线，用户选择不被覆盖 |
| 既有来源旅程 | 原样 `material-primary` 的 A 材料→B 主会话→C、时间线原句、HTTP/Web/OAuth MCP 通过；原件下载与上传字节一致 |

外部证据：`E:/GenCode/Skynet-evidence/v2-2026-10-04/54-reader-interactions/`。保留触控和标题的 RED、后续 GREEN、真实尺寸 JSON、截图及文件哈希索引。初始只读生产审计在邻接 `54-ac31-interaction-audit/`，它保留修复前观察，不由此稿覆盖。

最终 `npm run build` 通过，正式新增三条公开浏览器旅程串行 3/3 通过（52.80 秒）；原样材料跨设备兼容旅程 1/1 通过（28.23 秒）。日志 `10-final-build.txt`、`11-final-reader-green.txt`、`08-navigation-compatibility.txt`；最终 10 态与原句/工具截图在 `final-green/`。这些时间只标记该次回归，不用于性能签收。

运行方式（串行，每个 fixture 只清理自己拥有的测试目录）：

```powershell
$env:SKYNET_TEST_POSTGRES_BIN = 'E:/GenCode/Skynet-tools/postgresql-18.6/bin'
$env:SKYNET_OPENSSL = 'D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH = 'D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME = 'E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
npx tsx --test --test-concurrency=1 tests/reader-interactions.test.ts
npx tsx --test --test-concurrency=1 --test-name-pattern='restored associated native transcript qualifies only' tests/material-primary.test.ts
```

一次额外兼容执行同时传入两份测试文件时遗漏 `--test-concurrency=1`，两项各用独立 fixture 并行通过；日志原样保留，该次不是性能证据。正式 runner 默认逐文件串行，后续命令均显式限定并发 1。

## 签收边界

CI 旧日志中的“点击时间线仍留在对话”本次未复现；原用例和受控迟到响应场景通过，不据此宣称已定位并修复那条 CI 失败的根因。已证明修复的是标题退化与上述操作尺寸。

这些阅读路径不代表全部 AC31：未遍历所有报表图表、空/错/加载态、tooltip、全部长会话尾页、跨浏览器或真实设备，也未完成全站对比度审计。整体 AC31 和 AC32 仍由完整 V2 验收分别决定。
