# 修复、升级、回退与完整停用（#14）

对应 [#14](https://github.com/yiwer/Skynet/issues/14)，需求 US 6、13、14、15、70 / AC-03。该 tracer bullet 从员工的公开 npm / 插件脚本开始，在离线积压期间强制中断真实升级，再修复、回退、查询原件、完整停用和补传。设备身份和冻结载荷不重建，第三方 hooks / 用户配置不恢复成旧整文件。

## 员工操作

```text
skynet status
skynet repair

# 先取得本部署较新发行包；必须从新包，而非旧版本运行升级。
node "<新包或插件>/dist/apps/collector/cli.js" upgrade
skynet rollback

# 移除一个入口，保留其他入口和共享设备。
skynet entry-remove --entry claude-plugin

# 完整停用后再通过原安装渠道移除 npm / marketplace 包。
skynet uninstall
node "<status 显示的稳定 launcher>" drain
```

插件使用其 `scripts/skynet.cjs` 执行相同命令。个人 Key 仅首次绑定使用本地受控环境变量，不进入命令参数或对话；修复、升级、回退和卸载复用私有身份。宿主正常信任流程仍须员工完成。卸载 npm 包或市场缓存没有可靠 teardown 回调，因此先执行产品卸载 / entry-remove。

维护者的内部打包命令增加显式发行版本：

```text
node dist/apps/collector/cli.js pack-agent --output NEW_DIRECTORY --origin HTTPS_ORIGIN --deployment ID --version 0.2.0
node dist/apps/collector/cli.js pack-plugins --output NEW_DIRECTORY --origin HTTPS_ORIGIN --deployment ID --version 0.2.0
```

同版本 setup 复用已有已验证 runtime，登记另一个入口；旧包拒绝降级。较新版本需显式 upgrade。插件 manifest、入口描述及 npm 载荷版本一致。同版本 repair 不新增来源、不添加第二套定义；所有入口移除后仍可修复冻结材料交付。完整 uninstall 后 repair 保持停用。停用状态允许升级恢复工具，仍不会重新接入；重新采集需要显式 setup。

## 持久边界与恢复

- 新 runtime 写入独立目录，子进程验证模块依赖和安装状态 schema，再生成可执行载荷 SHA-256。旧 runtime 不覆盖。
- `upgrade.json` 在停止旧 writer 前持久写入 `prepared`，稳定 launcher 与安装登记原子更新后写 `switched`，认证的新 writer 建立后写 `complete`。进程在任一未完成阶段消失，下次 repair 校验旧载荷并回退。未确认 manifest / blob / 上传键和身份始终位于另一私有状态目录。
- rollback 仅回退代码，保留当前来源、入口登记、配置 ownership 和 capture fence。成功升级后新增插件或退出来源不会被旧 installation 备份覆盖；旧 runtime 必须能解析当前登记。无法验证旧 payload、journal 不属于当前 runtime、launcher 被修改或控制端点状态模糊时，保留材料并报告人工检查，不能据 PID 删除或停止别的进程。
- 稳定 launcher 在回退旧代码后仍保留较新 `maintenanceRuntime` 提供 status / repair / uninstall；普通 hooks 和持续采集使用选定活动版本。新工具与旧 runtime 的控制注册均保留原角色端口范围。候选端口先实际绑定验证，跳过被占用或 Windows 保留的候选，并同时持有两把端点 lease 直至新注册落盘。
- 控制端点只有认证的自有响应才允许 stop；明确 401 / 403 可跳过无关端点并另选候选。超时、持续 reset、错误 JSON、500 / 503 等模糊状态不替换注册。CLI start / stop 等待安装锁，配置写入采用 OS 独占锁，进程强杀不会留下阻止修复的 PID / 文件锁。
- 修复补回缺失的自有 hook，保留新用户设置；仍包含稳定 launcher 却已被修改的 owned hook 报 ownership conflict。配置发布前再次对照当前文本，不回放整文件旧备份。宿主不合作并发改配置没有文件系统 compare-and-swap 保证，仍保留此前文档的边界。

新 runtime 显式登记 `captureFenceVersion=1`，旧 `a4ca34c` 没有该能力证明。逐来源检查持久 `sources/<source>/settings.json`：曾接入的任一 Codex 来源停用后，再要求回退到该旧版时，rollback 在任何 stop / 改指针前拒绝，保留当前安全 runtime 和 capture fence；另一 Codex 来源仍启用也不能放行。已经回退旧版后，entry-remove 退出任一 Codex 来源的最后 owner 同样拒绝，明确要求先升级或完整 uninstall。stable start / background / repair 也检查这种持久登记，不能启动已知不兼容的旧 worker。未曾配置的 Desktop 仍为 unverified，不凭空假定存在可回退的接入能力。

新 runtime 在全部 Codex 来源停用时跳过整个共享 inbox routing，不读取新元数据；另一来源仍启用时，可读取有界 metadata 前缀用于来源分类，但 disabled 来源不进入 source spool / 原件冻结，`collectOnce(capture:false)` 只交付既有冻结材料。这不是已验证的 Desktop 接入能力。完整卸载及新工具 drain 仍可执行。

有维护工具登记后，stable `background` / `background-worker` 入口也进入较新工具。supervisor 先验证 lifecycle / capture fence，再直接启动所选实际 worker 载荷，快照分别记录活动 runtime 和 toolingRuntime；旧 worker 仍实际参与受支持的回退验证。uninstalled 的正常后台入口拒绝运行，worker 入口没有该监督器 IPC 则拒绝。只有直接指定历史 dist 文件的绕开产品入口操作无法由新工具约束。

中断的 entry-remove / uninstall 仍可能保留待撤下的配置 ownership；repair 依据当前 `configured` fence 撤下这些定义并更新 ownership，不补回已停止来源的 hook。已完整卸载后 repair 保持无采集、无后台。

完整 uninstall 先计划自有配置修改、移除确切自有登录任务并认证停止 writer，再持久写全来源 capture=false，逐个撤下自有 hooks。中途失败可重复修复 / 卸载完成；其他工具和用户字段不删除。保留服务器存档、本地身份、冻结队列、登记会话、未冻结 spool 和恢复工具，不自动撤销设备凭据，因为冻结队列仍需要该身份补传。若要撤销设备，使用平台维护者已有设备停用流程；撤销后不能承诺未确认材料能继续交付。

`drain` 使用当前维护工具的冻结交付逻辑并持有 supervisor / worker 两个认证 OS lease，**不启动回退的旧 worker，不进行 Codex inbox routing，也不读新原生字节**。完成后停止该 writer。它只承诺冻结队列的 ACK；尚未冻结的 hook 事件继续保留并返回 `retainedUnfrozenEvents`。补传完成不等于所有活动已存档，重新 setup 接入才继续采集。数据目录的人工处理应在确认冻结补传并处理未采集范围后进行。

停用后的正常 `start` 拒绝恢复持续后台，明确指向 drain 或重新 setup。回退旧 runtime 后请继续使用保留的稳定 launcher 做维护，随后移除旧 npm / 市场包；直接运行已退出入口的旧内部 background 命令不属于支持的停用流程。

## 验证

公开回归：

```powershell
npm run typecheck
npm run build
node --import tsx --test tests/maintenance.test.ts tests/runtime-control.test.ts
node --import tsx --test tests/installation.test.ts tests/plugin-entry.test.ts tests/mcp.test.ts
```

`maintenance.test.ts` 通过真实内部 npm pack / offline install / setup 建立身份，保留第三方定义及安装后新改的用户字段，删除一个 owned hook 和 launcher 后两次 repair。无关 401 监听仍可响应且收到零 stop。合成 Claude 原件先确认，再断网冻结；分别在持久 `prepared` / `switched` 边界对公开 upgrade 进程发 SIGKILL，repair 后逐字节比对原身份与 pending manifest。成功升级后新增插件登记，再回退而保留双入口；完整卸载后旧 Claude / Codex hook 再入队，drain 只上传此前冻结字节，三条未冻结 / 未解析事件仍可见。Web 查到精确离线原文，历史只有真实两个修订，新增未采集内容未进入存档。控制回归另核对模糊 timeout / 500 / 503 不换注册、不发送 stop。

最初同代码版本化回归 2/2 通过，164.54 秒，证据 `%TEMP%/skynet-test-z3xswr/maintenance-evidence.json` 和截图；截图已检查。真实 Claude Code 2.1.281 使用正常 hooks：内部 npm 安装→repair→升级 0.2.0→两个项目自动采集→Web→移除源 home→服务器包原生续聊，59.48 秒通过，证据 `%TEMP%/skynet-test-6ATRNc/native-maintenance-evidence.json` 和 `native-claude-evidence.json`。该轮在后续兼容修订前完成，不替代最终旧载荷回归。

安装 / 插件 / HTTPS MCP / 控制的五项集成回归 5/5 通过，83.74 秒，安装 `%TEMP%/skynet-test-3QkhjJ`、插件 `%TEMP%/skynet-test-59azLu`、MCP `%TEMP%/skynet-test-06Bq8O`（49 页、三种完整导出）。上述为当前机器实测，不作 Linux / Desktop / 登录或发布门槛的替代证据。

旧载荷不能由新代码改 version 字段冒充：单独保存暂停点 `a4ca34c` 的实际 compiled collector / contracts / bundled zod，目录 `%TEMP%/skynet-v1-implementation/issue14-base-a4ca34c-fdb77852-492b-4f06-94fd-07e1a7f57f6f`，`old-payload-evidence.json` 含关键文件 SHA-256。使用它的旧 pack-agent 建立安装，再由新包升级和回退：

```powershell
$env:SKYNET_TEST_BASE_PACK_CLI = '<旧载荷目录>/dist/apps/collector/cli.js'
node --import tsx --test tests/maintenance.test.ts tests/runtime-control.test.ts
Remove-Item Env:SKYNET_TEST_BASE_PACK_CLI
```

第一轮旧载荷回归 `%TEMP%/skynet-test-SfDib4` 在新增升级后插件时准确失败（稳定 launcher / stage 目录差异）；已修为同版本 setup 复用已选 runtime 和维护 launcher。另一轮 `%TEMP%/skynet-test-JNx3Jw` 报控制超时，未确认根因；不能据后续一次通过声称修复所有高并发启动问题。失败时测试保留操作阶段与安全错误，并不让 cleanup 错误覆盖首个失败。

`%TEMP%/skynet-test-nW61S9` 在 frozen-drain 前收到非 HTTP 的 `ACK`，因端点状态模糊而保留注册并失败；事后没有残留监听，未确认该占用根因。候选 worker 进一步限定在兼容角色范围内且低于 Windows 动态客户端端口范围；这只是减少冲突，不是该失败根因的证明。新增非 HTTP 回归确认不会换注册，且控制错误不再携带未知响应的 rawPacket，避免未知监听者反射敏感请求。

首轮完整实际旧载荷回归 **5/5 通过，149.16 秒**，证据 `%TEMP%/skynet-test-D6bwjS/maintenance-evidence.json`（actual `a4ca34c` compiled payload）。整个流程确实回到旧 worker，然后完整卸载；冻结 drain 使用保留的新维护代码，两条旧 hook 的未冻结事件仍留在原目录，原件只含停用前冻结的两个修订。单独控制回归 **5/5 通过，2.07 秒**，包含非 HTTP rawPacket 的保留与错误清理。

安装 / 插件 / HTTPS MCP / 控制回归 **8/8 通过，128.86 秒**。安装 `%TEMP%/skynet-test-ficPsw`、插件 `%TEMP%/skynet-test-5jO8I1`、MCP `%TEMP%/skynet-test-OCcvLy`。Windows `taskState` 与实际 `Get-ScheduledTask.State` 对照，允许已登记的 Ready 与另行认证的运行中后台同时存在，不伪造 Running；此前 fallback 观察记录跨同配置重新登记保留。Disabled / 缺失 / policy 冲突仍显示 degraded，真实登录与重启保持未验证。

真实 Claude 回归 **1/1 通过，96.51 秒**，证据 `%TEMP%/skynet-test-oNBr8H/native-maintenance-evidence.json`、`native-claude-evidence.json`。这是正常 Claude Code 2.1.281 安装→repair→升级→崩溃恢复→两项目采集→服务器独立续聊，使用隔离 HOME 和回环模型，没有付费调用、用户真实配置或信任绕过。

加入 capture fence 能力 guard 与 interrupted ownership 修复后，实际旧载荷 + 插件 + 控制 **7/7 通过，145.01 秒**；旧载荷 `%TEMP%/skynet-test-fh9jfl`、插件 `%TEMP%/skynet-test-arM2X4`。此前正常 CLI / MCP 验证仍为上述各自条件，后续集成以主线 CI 为准。

最终又补入“先停 Codex→请求旧版 rollback→正常 stable start→新 hook / 新元数据”的公开路径和稳定后台入口适配，实际旧载荷 + 插件 + 控制 **7/7 通过，163.52 秒**；旧载荷 `%TEMP%/skynet-test-nLO1rf/maintenance-evidence.json`、插件 `%TEMP%/skynet-test-8NFsHi`。a4 rollback 因不兼容 capture fence 明确拒绝且保持安全运行时；后续禁采 Codex 元数据未被解析，首次 normal start 完成新一轮 sweep，runtime.errors 仍为空。显式重新 setup 接入后才恢复来源，再实际成功回退旧 worker。完整 uninstall 后 normal stable start / background / background-worker 均拒绝；维护 drain 交付冻结材料而保留三条未冻结 / 未解析事件。普通当前代码版本化路径也通过（`%TEMP%/skynet-test-Nlg06x`，184.99 秒）。

稳定维护 supervisor 直接启动实际选定 worker 后，真实 Claude **1/1 通过，62.38 秒**；证据 `%TEMP%/skynet-test-EC45ys/native-maintenance-evidence.json` 和 `native-claude-evidence.json`。逐来源旧版 guard 随后补入公共 CLI 故障注入登记案例：Codex CLI 已停用、Desktop 仍登记启用时，rollback / start / background 拒绝并保持登记；另一来源保有 owner 时 entry-remove 也不能停用旧版的 CLI 来源。该混合登记仅验证兼容边界，不是 Desktop 原生验收。

逐来源 guard 最终回归：实际 `a4ca34c` tracer + 控制 **6/6 通过，174.80 秒**；证据 `%TEMP%/skynet-test-lE04ax/maintenance-evidence.json`，`legacyPerSourceFence=true`，覆盖上述 fault-injected registration 的公共 stable CLI 路径。最终 typecheck / build / `git diff --check` 通过；build 只有既有 zod 注解提示。没有以同代码改版号替代旧 worker 验证，也未因通过本轮而改写上述并发失败记录。

在上述已停用测试状态中再通过公开稳定 launcher 升级维护工具到 0.2.0，核对 `lifecycle=uninstalled`、`entries=[]`、`background=unavailable`，没有重启采集。随后对实际新版稳定 launcher 连续测量 200 次 hook（含 Node 创建、launcher 分派、本地持久入队）：P50 **59.99 ms**、P95 **85.44 ms**、最大 **1075.89 ms**，P95 满足该样机 100 ms 目标，保留长尾异常。证据 `%TEMP%/skynet-installed-hook-latency-qZM0lv/latency.json`。这轮不替代 #18 并行故障回归 P95 111.35 ms 的既有未达标记录，V1 性能发布验收仍开放。

环境 Windows 11 x64、Node 24.12.0；版本环境记录沿用外部 `environment-resumed.json`。测量开始时上述本票回归已经结束，没有暂停其他 Agent / 系统工作，未控制主机全局并发负载。样本及最大值全部保存，没有用重复选择更快结果替换故障条件。

**仍未验证**：真实 Windows 登录 / 重启 / 休眠、Desktop 市场 UI / 图标启动 / UI 原生续聊、其他 OS 生命周期；此前高并发 1500 ms 控制超时根因。G1 与 V1 完整发布门槛继续开放。尚未冻结或无法访问的原件不能称为完整备份。
