# #54 时间线固定导航遮挡

2026-10-04。在工具卡的真实 320px 暗色截图中，时间线滚动到工具调用时，顶部阅读导航右侧出现了下方来源时间的尾部。导航原为 inline-flex，只用内容宽度覆盖背景；底下完整宽度的事件内容继续从右侧及圆角处露出。

仅修改 `product-polish.css` 中时间线与原件阅读导航的直接子级规则：使用全宽 flex 背景并去掉该遮挡层的圆角。三个阅读标签自身的圆角、焦点、44px 操作区域、工具卡、主题和滚动容器保持既有行为；对话工具栏不受此选择器影响。

本片在独立 `codex/v2-54-reading-sticky` 分支实施，依赖工具卡候选 `79b15ad6543588b81f81abb4bfca301ec0184987`；工具卡候选保持冻结，没有将此后续修复混入该提交。

验证复用既有 `tests/tool-cards-public.test.ts`：公开合成原件上传、真实 Chromium 登录与两种阅读方式的 320/390/768/1280/1920px 双主题截图，同时保留控件尺寸、无外层滚动、键盘、配对跳转、原文定位及不变字节断言。低影响 CSS 变化不新增镜像实现测试。构建、运行日志、前后截图及哈希索引均在外部 `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-reading-sticky/`。

`01-build.txt` 构建通过；`02-public.txt` 公开旅程 1/1 通过（23.23 秒）。实际目视 `after/tool-timeline-320-dark.png`、`after/tool-timeline-390-light.png` 与 `after/tool-timeline-1280-light.png`：导航右侧不再露出下方时间，标签与卡片仍可读。20 态尺寸和外层无溢出断言保存在 `after/tool-public.json`；修复前截图独立保存为 `before-timeline-320-dark.png`。

此修复只处理已观测的遮挡缺口，不表示全站 AC31 已签收；未部署，也未修改生产资料。
