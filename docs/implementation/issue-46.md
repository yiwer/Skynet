# #46 评估周期、固定权重与历史版本

对应 PRD-v2 第 7 节，US 138/139/142/144/163/164/165/170，AC-34/35/36。在 #45 已有的单员工评估上开放三周期、三套固定权重、历史查询和当前参数说明。

## 公开使用

- Web 员工画像 `#profile?employeeId=<id>`：周期为接入至今、本周、上周；方案为默认、重产出、重质量。选择保存在 hash，可刷新或分享。`version` 固定历史结果；“查看当前评估”保留周期和方案并读取当前输入。
- `GET /api/assessments/:id?period=this-week&preset=重质量`、`POST /api/assessments/:id/recompute` 和 `/export` 共用相同选择。省略选择保留 #45 的接入至今/默认行为。
- `GET /api/assessments/:id/history?period=since-enrollment&preset=默认`：筛选可省略，每页 20 条，用 `nextCursor` 续读。元数据包括自然周、方案、范围、生成时间、指数、等级、可信度、模型与结果版本。
- OAuth MCP `read_assessment` 支持同样的周期、方案和固定版本；`list_assessment_history` 返回同份分页历史。`read_assessment_model` 继续提供整体参数版本。
- 固定版本与显式选择不符返回 409；任意权重、自定义日期、不属于所选范围的历史游标返回 400。未认证或设备凭据不能读评估。

## 范围与计算

本周和上周采用北京时间周一至周日，使用 ISO 自然周标签，跨年周同样处理。有效起点为员工接入日与周起点中较晚者；工作日分母只计截至生成日已到达的周一至周五。整周早于接入时 `range.empty=true`、`range.from=null`，显示空范围而不制造倒置日期。无会话时指数、误差为空，等级待定。

`assessmentInputs` 对所选周期一次准备全团队用量和等待；周评估再取得一次全团队接入至今数据作为固定口径的任务基线，不逐员工重复扫描。洞察引用合并后批量读取。接入至今评估复用同一份用量。全套读取由 #45 的 `consistentReportingInputs` 核验前后完整语义输入集合，结果继续绑定 `frontierVersion`。

权重采用 PRD 固定参数。切换方案只改变权重、有效权重与加权结论，不改变指标原值、样本、锚点、证据、维度分数或团队维度中位数；模型与底层输入版本不因选择方案改变。重质量的协作节奏权重为零，仍保留该维度的实际得分。缺失维度不计权重，剩余权重重分配；零有效总权重不生成指数。

任务基线始终取团队接入至今的同类任务已结束样本，选择周期不把基线改成该周。基线固定文档保存其用量与洞察版本。未完整观测的首条边界、权限等待和来源未知沿用 #45 的明确状态。

## 追加存储与历史分页

模型、基线和结果均追加保存。`storeAssessment(db, content, clock)` 在输入工作完成后仅持久化固定结果；相同内容复用原生成时间。它按员工串行发布，`assessment_revisions.ordinal` 顺序与该员工的提交顺序一致。历史游标绑定员工、筛选、首次读取的最大已提交序号和下一页位置，新结果不会挤入原分页范围。

历史排序使用数值序号，不按序号字符串排列。历史列表只读取元数据，不重扫原件。旧 #45 结果没有 `selection` 时，历史元数据按接入至今/默认兼容；原 payload、哈希和固定读取不被改写。当前读取按当前来源重新计算，不以最近插入的历史行代替当前评估，因此旧工作晚到不覆盖新输入的当前结果。

## 界面

沿原型使用分段周期与方案控件，主题、焦点与选中状态一致；320px 下分行排列。历史版本按需展开，明确展示周期、方案与北京时间。计算规则展示当前方案权重和本次有效权重，完整模型仍可导出。外层固定，内容区独立滚动；没有新增营销或泛化说明文本。

## TDD 与证据

使用 PRD 中预先确认的公开 seam：合成上传、公开 Analysis 与固定外部执行响应、HTTP、OAuth MCP、Web。周期接口先返回 400；历史接口先返回 404；浏览器先缺少周期控件，再逐步通过对应回归。

`tests/assessment-scope.test.ts` 覆盖：

- 三套方案的独立预期指数 73/68/75；维度、原值与输入保持相同，固定版本与错配选择校验。
- 缺维度时默认指数 60、重质量指数 50，零权重维度保留 100 分但不进入加权；接入前整周无工作日、无会话且不评分。
- 北京时间周日 23:59:59 到周一 00:00:01，跨年自然周 2030-W01/W02；上周、本周和接入至今样本分别正确，团队基线仍含两个会话、已验证均值 1.5。
- 25 条历史按 20+5 分页，分页中产生第 26 条不插入已有页面；历史筛选、权限、固定读取与服务重启。

`tests/assessment-scope-journey.test.ts` 使用真实 HTTPS/OAuth PKCE/MCP 和浏览器登录，逐字段核对 HTTP/MCP/导出，切换三个周期与权重，展开当前参数，打开历史并刷新保持固定，再返回当前看到新增会话。截图覆盖 1280/390/320 明暗主题和 320 深色参数展开，检查外层无溢出、无页面异常。

可复现命令：

```powershell
$env:SKYNET_TEST_POSTGRES_BIN='C:/Users/yiwer/AppData/Local/Temp/ticket28-pg-0eb735e987dc48d186870e8a96801e01/bin'
$env:SKYNET_OPENSSL='D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH='D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME='E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
node --import tsx --test --test-concurrency=1 tests/assessment-scope.test.ts tests/assessment-scope-journey.test.ts tests/assessment-public.test.ts tests/assessment-model-public.test.ts tests/assessment-journey.test.ts tests/assessment-concurrency.test.ts tests/assessment-history.test.ts
```

证据在 `E:/GenCode/Skynet-evidence/v2-2026-10-04/46-assessment-scope/`，包含 RED、GREEN、构建日志、浏览器截图和版本清单。全部材料为合成数据；没有调用付费模型或更改生产部署。

最终合入集成 `90a9b8e925f77465d18dc5058a66b457da3d3d79` 后，`npm run build`（含 TypeScript 检查）通过，上述七个公开测试文件共 14/14 通过，耗时 222.27 秒；`git diff --check` 通过。最终浏览器证据位于 `integrated-browser/`，已目视核对 1280 浅色、320 深色及 320 深色参数表，分段选择、历史入口和参数列均可用，文档外层未滚动。

独立审查补充触控命中尺寸验收：六个新分段按钮原为 32px 高，历史展开入口为 29.1875px，低于 PRD 的 44px 要求。修复按钮、历史入口、员工选择和返回当前链接的命中尺寸；正式浏览器旅程增加各控件及历史条目的实际矩形断言，覆盖三种宽度、两种主题。`touch-red.txt` 保留失败尺寸，修复后 build 与旅程 1/1 通过（20.24 秒），截图在 `touch-browser/`，320 深色已重新目视核对。
