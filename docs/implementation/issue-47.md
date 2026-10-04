# #47 员工一览

对应 GitHub [#47](https://github.com/yiwer/Skynet/issues/47)、PRD v2 AC-28、AC-31、AC-35、AC-38。实现于 `codex/v2-47-people`，依赖 #46 的范围、方案和固定评估版本；独立验收后合入 `codex/v2`。

## 产品入口

- Web `#people`，导航“员工”。三种周期和三套方案沿用能力模型；四个等级显示人数、姓名和同一评估理由。
- 卡片包含指数、估计误差、可信度、六维得分、会话/提示词样本、已验证成果、返工分子分母和覆盖问题。无会话展示空状态；待定理由说明样本不足或采集覆盖不完整，不将强项文案当作待定原因。
- 每组按姓名及 ID 稳定排序。姓名和整张卡片支持键盘打开同一固定版本画像；表格呈现同一批员工和数值，HTTP/MCP/导出不提供名次或指数排序。
- “评估方法与口径”按需展开完整锚点、单项门槛、当前权重、缺维度重分配、同类任务校正和用途。业务页不使用原型合成数据；后台没有岗位字段时不生成虚构岗位。

HTTP：`GET /api/capability-people`、`POST /api/capability-people/recompute`、`GET /api/capability-people/export`。OAuth MCP：`list_capability`。查询仅接受 `period`、`preset`、`version`、`offset`；下一页必须固定版本，每页 20 人。Web 依照固定版本顺序读完各页；导出包含完整列表。后续新增员工不会改变已保存版本的成员或分页内容。

## 同一批输入与历史

`assessmentService.batch` 与单人读取使用同一个准备入口，一次准备全部员工的用量、洞察、等待和基线。相同范围的同时读取共享尚在进行的准备，不保留完成结果缓存；不同方案的准备排队，避免底层指标首次物化发生锁冲突。保留语义输入前沿校验，交错上传和分析完成时重试整批输入。批量结果中每张卡片引用该次实际保存的 `assessmentVersion`，不是另算一份分数。

一览追加保存其模型、输入前沿、用量、基线、成员和评估版本。普通读取最多 80 KiB；完整导出最多 16 MiB。固定历史不会拼接新员工、新设备或新分析。已验证量取同批用量，返工取同批提示词事实；不完整历史不能产生已知返工率。

## 回归中修复的问题

1. 六路同时打开员工一览曾返回“范围正在计算”409。公开并发用例先 RED，再通过共同准备入口修复；固定成员分页保持 20+2，新增第 23 人后旧版本仍有 22 人。
2. 新增员工调用基础迁移时，重复的 `ALTER TABLE` 独占锁与后台原件整理按不同次序持锁，触发 PostgreSQL 40P01。合并验证的两个独立沙箱均捕获原始错误，日志确认阻塞的实际 SQL。基础迁移改为同事务保存 SQL 内容版本，普通开户跳过已执行的 DDL；新迁移失败整体回滚。公开开户并发压力和原始完整场景通过。单独压力探测曾通过，并未将该次探测虚称为 RED；这是间歇竞态。
3. 待定卡片原先只展示强项/低分维度，未说明待定原因。公开断言 RED→GREEN 后修正共享评估结论，卡片与画像完全一致。原始数值、权重公式和历史结果均保留。

## 复现

使用项目要求的 Node 24 和隔离 PostgreSQL。Windows 无 Docker 时配置 `SKYNET_TEST_POSTGRES_BIN`，TLS fixture 使用 `SKYNET_OPENSSL`；数据库及合成账号由用例自行创建和清理，不读取生产数据。Analysis 的确定性替身仅位于既有确认边界，无付费请求。

```powershell
npm run build
node --import tsx --test tests/capability-people.test.ts tests/capability-people-public.test.ts tests/provision-concurrency.test.ts tests/assessment-concurrency.test.ts
```

公开旅程建立四组各一人的数据，经实际上传和 Analysis 流程读取；验证 HTTP、OAuth MCP、键盘打开画像/返回、卡片/表格、方案与周期切换、真实下载及固定历史。另覆盖 22 人分页、6 路并发、后续成员变化、重启、拒绝未认证/设备凭据及排序参数。320/768/1280/1920 明暗主题核验外层无滚动、内容区域滚动及 44px 控件。

外部证据：`E:/GenCode/Skynet-evidence/v2-2026-10-04/47-people/`，包含 RED/GREEN 输出、最终构建及公开旅程、稳定截图和 manifest。实际结果以 manifest 为准；本票不签收 AC-32 的 1,000 会话性能或真实试点。
