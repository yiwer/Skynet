# #31：团队覆盖矩阵与来源统计

此实现完成一条窄的公开 tracer bullet：绑定设备上传合成原件 → 持久来源归属与按日观测 → 员工×日期矩阵 → 选中日期统计 → Web / OAuth MCP → 原件位置 → 重启读取固定统计版本。使用 V1 已选的 C 矩阵及 inspector 结构；没有评分、排名或工时。

## 服务与口径

- `GET /api/team-coverage?date=YYYY-MM-DD&offset=0`：七个北京时间日期、每页十名员工。活动、采集观测、安装配置、宿主确认、当前连接及报告状态分别返回。历史日期不使用当前 heartbeat 回填；没有观测为未知，没有已观察活动不证明没有工作。
- `GET /api/team-coverage/:employeeId/observations?date=...&offset=0`：每页二十条服务器收到的观测。`device_coverage_observations` 每设备 / 来源 / 服务器收到日 / 小时保存一条；保留该小时曾出现的缺口、待提交原件及故障代码。后来的健康报告不会抹去缺口。客户端 `checkedAt` 不能改变服务器观测所属日期。
- 新版 installed worker 发送有界 installation observation，仅含来源、配置布尔值与宿主事件是否已观察，排除路径、配置、凭据。旧客户端字段缺失为未知。已配置且没有宿主事件显示“宿主信任/首次事件待确认”，不声称已证实未信任，也不声称所有 hook 已受信任。
- `GET /api/work-statistics/:employeeId?date=...&revision=...&offset=0`：不可变 `work_statistic_revisions`，引用每页二十项；翻页固定 revision。统计版本包含精确原件 / 材料 hash、原 eventId、资格 revision 与提取器版本。既有版本不因晚到资格或后续活动改写。
- MCP `read_team_coverage`、`read_coverage_observations`、`read_work_statistics` 调用相同服务，以独立 OAuth 读取授权访问。设备 / enrollment / 普通 reader 凭据不会当作 MCP token。

事件统计共用 `effective_event_origins`，原员工、原设备、原项目及北京时间来源日期不变。唯一记录按 eventId，用户轮次按原件 / 材料行，工具调用按解析 block，会话按原设备 / Agent / 原生会话 ID。历史或关联上下文与未知归属分开。关联材料只有原设备正常 primary 的独立资格才能成为活动，恢复员工不获得原来源的历史计数。

文件只取已支持的结构化参数：Claude Code 2.1.281 的 Read / Write / Edit `file_path`，Codex CLI 0.157.1 的有边界 apply_patch 文件头。按原设备 / 原项目 / 逐字路径去重，不读文件，不把正文或 shell 文本中的路径当作文件证据；其他工具使完整性为未知。

Token 为来源记录量，不是计费账单。Codex 使用原件中的累计计数及前驱基线求非负差值，重复累计值不再次加总；缓存输入属于输入子集，推理输出属于输出子集。缺少前驱、累计重置、不一致或缺失分项保持未知。Claude 同一 message.id 只计一次，已知输入为普通输入加缓存读取与写入，缺失缓存分项不填零。版本不在已测范围或原件 UTF-8 损坏，不宣称完整 Token / 文件统计。

辅助 Token 没有业务 eventId，不通过 snapshot_events 的最大资格版本直接授活动。原材料需再次验证：来源 material 的精确字节前缀、同一原设备 / 来源 / 原生会话的正常 primary、服务器登记边界；sourceSnapshotId 指向父件时读取原材料，不误读父件主 raw。跨员工恢复前缀保留来源归属，恢复员工只得到自己的 suffix 差值。

活动区间仅由原来源时间点组成，相邻点不超过十分钟合为一段，孤立点为零跨度；按来源自然日分开，不推断持续劳动，不计算人工工时。

有界规范化：每请求最多 10000 已确认事件、32 原件 / 材料、128 MiB 校验字节；最多保存 10000 引用，展示 40 个路径及 50 个区间，超界明确不完整。原件上传与完整导出不裁剪。既有日报 / 项目工作视图的冻结统计不会由当前账本回填；后续新报告可显式绑定统计 revision / version。

## 验证

命令（独立 `Skynet-wt-issue31`）：

```powershell
npm run typecheck
npm run build
node node_modules/tsx/dist/cli.mjs --test tests/source-statistics.test.ts tests/team-coverage.test.ts tests/daily-reports.test.ts tests/mcp.test.ts tests/material-primary.test.ts
```

首条公共用例通过（4.705s），随后扩展原材料资格和原件锚点用例通过（5.215s）。扩展后的十项定向回归初轮 9/10：唯一失败是旧 MCP 测试把工具数固定为 14，而新工具数为 17。改为逐项检查公开工具及只读注解后，单项 MCP 回归通过（6.457s）。最终验证结果在下方交付记录补充。

公共用例验证：认证拒绝 / 日期拒绝；三名合成员工的活动与缺口、宿主确认待核对、旧客户端未知；孤立时钟 fixture 模拟当前断连；历史未知不由今日心跳回填；已恢复报告保留收到时的缺口；原件上传 / 恢复 suffix 的原归属；原材料 sourceSnapshotId 父件陷阱；晚到正常来源资格使当前统计形成新版本、旧版本保持不变；原 Token 基线及未知分项；文件和 Token 精确 raw / material 锚点；损坏 UTF-8 的辅助统计不可用但原件与查询仍可用；OAuth MCP / Web 一致；证据跳转；重启。

外部稳定证据目录 `F:/GenCode/Skynet-evidence/v1-2026-09-30/coverage-bf5995a4-ad9f-448f-be68-cc18117e4284/` 含 public-flow.json 及 320 / 375 / 760 / 1280 / 1920 PNG。五种宽度没有横向溢出，320 退出按钮不拆字，inspector 首层保留一句口径、详细定义可展开。所有浏览器和子进程隐藏运行，没有 Windows Task 安装循环，没有真实账号 / 用户配置 / 付费模型请求。

## 验收边界

此处使用合成公开上传及已测 native 记录 schema，没有新宣称实际付费 provider、Desktop UI 或全页深色主题验收。G2 / G3 与完整 G4 仍由总验收台账跟踪。历史观测始于本功能部署，之前为未知；观测点不证明整天完整。完整 Token 兼容与计费账单不在本条 tracer 范围，缺失维持未知。
