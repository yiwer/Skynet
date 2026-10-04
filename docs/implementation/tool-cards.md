# #54 工具调用卡片与原文定位

2026-10-04。用户确认采用可折叠工具卡片，显示工具名、已有状态和耗时，展开参数与结果。本片接续已独立接受的阅读控件与标题修复，合入接受基线 `f50dc8dae2e1731916bf9310b7cb25c1ba940d4f`。

## 行为

- 对话中的工具调用和结果共用专门卡片，分别显示参数或结果。调用与结果各自保留原始位置，配对链接跳转并聚焦对应记录，不合并或重排中间的 Agent 消息。
- 工具名、状态、退出码、执行耗时和来源时间差只读取既有结构化 Trace；缺少的数据不补成成功或零。来源时间差与原生执行耗时分别标识。原件入口始终指向原记录，只有真实 Trace 行存在时显示 Trace 原件入口。
- 对话继续默认隐藏工具，启用显示后卡片默认折叠，当前原句锚点自动展开。时间线与事件原句阅读使用相同卡片，默认展开以保留原先可见的证据；这些接口未提供结构化 Trace，不从正文猜状态、耗时或名称。名称仍包含在原始参数正文里。原始 JSONL 和材料页面保持原文。
- 参数与结果等宽、保留换行、按原文分段。卡片折叠与链接至少 44 × 44 CSS 像素；主题使用现有变量，外层固定、阅读区域内部滚动。减少动画沿用平台仅允许淡入的规则，不旋转过渡箭头。
- 新公开旅程暴露原件定位缺陷：Codex 工具原句 URL 明确给出 `block=0`，而同一个已解析事件的 block 是省略值，原先返回 400。定位仅把省略值按第一个 block 0 比较，保留所有非零 block、行号、偏移、解析版本及字节。

## 公开验证

全部使用独立合成设备上传和真实 Chromium Browser，不接触生产资料，不调用模型。测试 `tests/tool-cards-public.test.ts` 包含实际原生 Codex 0.160.0 工具完成记录与 Claude 两个工具块，通过公开 HTTP 读取和原件下载验证。

| 范围 | 断言与证据 |
| --- | --- |
| 卡片格式 | 时间线公开 RED 找不到专用卡片；GREEN 对话、时间线、事件原句都有独立参数/结果区和原文入口 |
| 原时序与来源 | 真实 HTTP 消息顺序为 user → tool request → assistant → tool result → tool request；12ms 执行、15ms 来源时间差、退出 0、completed 均来自上传行；未匹配调用不编造状态与耗时 |
| 原件定位 | 公开 RED 为原句 GET 400；GREEN Codex 省略 block 与显式 0 同结果，错误 block 1 返回 400；Claude 同行真实 block 0/1 返回各自文本；两个完整下载与上传字节一致 |
| 视觉与交互 | 对话/时间线 × 320/390/768/1280/1920px × 双主题，共 20 态；外层横纵溢出均 false，当前卡片操作目标宽高至少 44px；Enter/Space、配对跳转和焦点、减少动画有效 |
| 不执行来源文本 | 工具结果中的 script 字面文本可读，window 未出现执行标记 |
| 兼容 | 既有 Trace/OAuth MCP 旅程覆盖上下文过滤、工具跨页/长文本、歧义 ID、不变原件、原生状态与子材料；既有阅读触控旅程再次检查共享导航、工具和 Trace 控件 |

证据目录 `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-tool-cards/`。保留初始格式 RED (`02-public-red.txt`)、实际原文 400 (`04-public-green.txt` 名称沿用原预期，内容为失败；`05-anchor-red.txt` 为精确 HTTP RED)、首次修复 GREEN (`07-anchor-green.txt`)。`08-matrix-trace.txt` 中既有 Trace 通过，新测试在矩阵完成后因不正确要求减少动画的总时长必须为 0 而失败；已核实平台把过渡属性限制为 opacity，修正为禁止 transform/all 过渡，不改产品规则来迁就断言。

`09-matrix-green.txt` 为完整新旅程 1/1，通过时间约 21.25 秒；`10-final-build.txt` 为合入接受基线后的 build。最终公开回归 2/2 通过（43.77 秒），截图和逐项尺寸位于 `11-final-public.txt`、`final-matrix/` 与 `reader-compatibility/`，文件哈希收录外部 manifest。

```powershell
$env:SKYNET_TEST_POSTGRES_BIN = 'E:/GenCode/Skynet-tools/postgresql-18.6/bin'
$env:SKYNET_OPENSSL = 'D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH = 'D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME = 'E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
npx tsx --test --test-concurrency=1 tests/tool-cards-public.test.ts tests/conversation-trace-public.test.ts
npx tsx --test --test-concurrency=1 --test-name-pattern='public conversation, source and trace controls' tests/reader-interactions.test.ts
```

## 边界

本片不增加 Markdown 渲染，不改变原件、模型、指标或 2,000 字符的分段预算。上述 20 态只签收工具阅读场景，不代替全部 AC31；未完成跨浏览器、全站视觉和完整 V2 性能验收。生产部署与 GitHub 关闭不由作者片执行。

视觉另记录一个既有共享布局问题：320px 时间线滚动时，inline 宽度的固定阅读导航右侧可能露出后方来源时间的尾部（`final-matrix/tool-timeline-320-dark.png`）。工具卡片未改变该导航规则；已交主任务安排独立窄修，未将该状态视为全页面视觉通过。
