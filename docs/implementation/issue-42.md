# #42 提示词分析

实现路径为公开原件上传 → 固定用量/洞察输入 → 提示词报表 → HTTP、OAuth MCP、Web 与 JSON 导出。没有另建原文副本，没有导入原型运行时代码或示例数据。

## 行为与边界

- `GET /api/prompt-report`、`GET /api/prompt-report/export`、`POST /api/prompt-report/recompute`；OAuth MCP `read_prompt_report`；Web `#prompts`。读取凭据与 OAuth scope 沿用产品读取权限，设备凭据不能读报告。
- `period` 仅本周、上周、接入至今。员工、Agent、项目筛选对整页生效；姓名固定排序。`version` 固定报告，`usageVersion` 可固定来源；固定版本范围不匹配返回 409。Web 支持 `#prompts?period=since-enrollment&version=<version>`。
- 报告以 `usageVersion` 固定全部指标、归属与洞察版本；新 `SessionInsights.messageFactsVersion` 指向不可变原件元数据。`readMessageFacts(await readVersions(keys))` 批量读固定长度/身份/顺序，不读取新原文。旧洞察没有该可选字段时仍可读，长度覆盖保守未知。
- `insight-input-2/messages-2` 在现有批量原件核验/解析时提取消息元数据，不逐员工再扫原件。元数据不存消息正文。当前读取仍核验原件，报告历史版本在原件临时不可用时保持可读；从原件重算绕过投影缓存。
- 同一原件行中的 Claude 多个文本块合为一条 native message，文本以换行拼接后按 Unicode 字符计数。恢复、重复上传、续聊沿原事件身份、原员工、原项目和北京时间来源日期去重。纯机器上下文不计提示词。
- 首条由原件顺序确定，不采信模型的返工标记来决定首条。压缩、重写、未解析或缺口不能建立新的首条排除。首条从返工分母剔除；无法建立顺序的样本为未知。
- 四要素和返工分别有完整有效分母；缺失、冲突或不完整推断为未知。只使用当前有效 leaf 洞察；不会把旧分析套在刚追加、尚未分析的消息上。一个 native message 的多文本块中任一肯定证明要素出现，只有完整全部否定才证明没有。
- 无返工按所选范围逻辑会话，完整推断且所有非首条返工已知后统计。追问为澄清次数 / 回复推断完整的提示词数；未回复或回复推断未知的提示词单列。每个比率返回分子、有效分母、未知数。
- 上下文比较按前一条提示词上下文 → 当前后续提示词返工。前条可在当前员工/日期筛选外，只作关联，不增加范围内计数。未知前条单列。页面直接标注“相关不等于因果”。
- 长度段为 ≤15、16–30、31–60、61–120、>120 字。数量和返工率各自独立图及坐标，未知比例显示破折号。任务构成按模型任务类型归组，未知独立列出。
- 正例为至少三要素、下一条已知未返工；反例为存在缺失要素、下一条已知返工。前后原句均固定引用，最多各三条，结果不表示因果。每人一条建议来自当前实际模型输出，缺少可归属引用时不生成模板建议。
- 每图提供等价表格；柱、热力格、任务段支持键盘焦点提示与 Escape 收起；外层固定，内容内部滚动。明暗主题采用平台 token，320/768/1280/1920 均验证。

## 公开测试与复现

`tests/prompt-report.test.ts` 覆盖未分析但可读的实际长度、固定历史/重启、设备凭据拒绝、重复与恢复原归属、Claude 多块合并、压缩重写未知首条。

`tests/prompt-report-model.test.ts` 使用隔离 PG18.6、真实 Claude Code 2.1.281 运行时和明确 loopback 合成模型边界，经公开 analysis API 完成两个人的模型分析。原件五条提示词，首条故意返回 rework=true：上下文 2/4（1 未知），返工 1/2（1 未知，首条不计），无返工 0/1（1 未知），追问 1/4（1 未知）；前条有上下文组 1/1、无上下文组 0/1，另有未知配对。验证原句定位、从原件重算、OAuth MCP、JSON 导出、实际浏览器下载、全部图表切换/键盘及响应式截图。无付费提供商调用，无生产或个人材料写入。

```powershell
$env:SKYNET_TEST_POSTGRES_BIN='C:/Users/yiwer/AppData/Local/Temp/ticket28-pg-0eb735e987dc48d186870e8a96801e01/bin'
$env:SKYNET_OPENSSL='D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH='D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME='E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
node --import tsx --test tests/prompt-report.test.ts tests/prompt-report-model.test.ts
```

外部证据目录：`E:/GenCode/Skynet-evidence/v2-2026-10-04/42-prompts/`。`01-native-red` → `03-native-green`；`05-model-red` → `07-model-green`；`08-public-red` → `10-public-green`；`12-compaction-red` → `13-compaction-green`。`04-model-red` 是合成 fixture 失败，修正后 `05` 才是预期行为 RED；不作为有效 TDD 失败证据。共享洞察/用量回归 `15-shared-green` 为 8/8（60.39 秒）。最终文件、截图与合入检查见同目录 `manifest.json`。

本票不宣称全局 AC32 性能目标完成；千会话全链路性能由 #54 汇总验证。

## 2026-10-04 收口

功能提交 `c3375b7`；已合入集成分支 `b6ee0d0`（#39 活动），仅合并 App 路由及 MCP 服务接线冲突，保留两个公开服务。构建通过。主票四个公开用例 4/4 通过（`17-complete-green.txt`，40.99 秒）；随后补齐全部图表等价表格和任务段键盘提示的屏内断言，`18-task-tooltip-red` → `21-task-tooltip-green` 1/1 通过（21.85 秒）。

合入后的 `23-integrated-green.txt` 为 3/3（19.84 秒）：提示词真实隔离分析 + OAuth MCP + Web + 实际 JSON 下载及固定链接、活动推断首条边界、活动 Web/MCP 固定版本旅程。`22-integrated-build.txt` 为最终构建。仅有既存 bundle 大小和依赖注释警告。

最终截图见外部 `42-prompts/integrated/`，含 320/768/1280/1920 明暗主题的顶部和底部（16 张）；已目视 1280 浅色与 320 深色，外部页面不滚动。`public/` 保留合入前完整旅程证据。未部署或关闭远端 ticket；由独立 merger 交付集成。
