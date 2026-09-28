# 内部插件市场入口与共享采集后台（#13）

日期：2026-09-28。对应 [#13](https://github.com/yiwer/Skynet/issues/13)。这条 tracer bullet 从真实宿主的内部 marketplace 安装开始，经缓存内确定性 setup、一次个人授权、普通宿主信任，到自动原件采集、认证 Web 和服务器独立恢复。**两个 Windows CLI 的链路已实测，G0–G4 仍开放，Desktop 市场界面及完整安装门槛没有据此通过。**

## 发行与接入

维护者构建后生成一个全新的内部发行目录：

```powershell
npm ci
npm run build
node dist/apps/collector/cli.js pack-plugins --output C:/SkynetReleases/company-plugins --origin https://skynet.company.example --deployment company-skynet
```

该目录包含两个宿主的 catalog、`skynet-codex`、`skynet-claude`、编译后的同一 collector、随包 zod 和非敏感部署配置。没有 npm 安装步骤、安装生命周期下载、个人凭据或公开 registry 发布。将整个目录放到员工可以读取的内部位置，随后使用实际验证的宿主命令：

```text
codex plugin marketplace add "<内部发行目录>" --json
codex plugin add skynet-codex@skynet-company-skynet --json

claude plugin marketplace add "<内部发行目录>" --scope user
claude plugin install skynet-claude@skynet-company-skynet --scope user --json
```

这里采用 Codex 0.157.1 实际提供的 `plugin add`。Claude 验证版本为 2.1.281。其他版本、远程 Git/HTTPS archive 下载及公共官方目录上架不在本票声明的支持范围内。

**前提是已有 Node 24、对应 Agent、内部发行物读取权限及用户状态目录写入/后台权限。** 插件未捆绑 Node；缺少 Node 时应先完成该前置安装，不能声称无需 Node。包内轻量入口在旧 Node 上给出明确错误，尚未绑定的 `status` 返回未配置状态。

插件的 `skynet-setup` 仅定位本插件 `scripts/skynet.cjs`，展示本地终端操作并解释状态。员工也可直接运行该脚本，不需要让模型执行采集：

```powershell
$env:SKYNET_KEY = '<个人接入授权值，仅在本地终端输入>'
node "<已安装插件目录>/scripts/skynet.cjs" setup
Remove-Item Env:SKYNET_KEY
node "<已安装插件目录>/scripts/skynet.cjs" status
```

Key 不放在 skill 参数、命令行参数、聊天内容或宿主配置里。setup 使用与 npm 相同的受保护身份、持久登记恢复证明、稳定 launcher、当前用户 supervisor/worker 和来源队列。只有确定性 setup 修改本产品拥有的用户级 hooks；两个插件自身都没有 capture hooks，因此市场插件与 npm 并存不会再挂第二套定义。Codex 仍需正常 `/hooks` 审查，Claude 仍按宿主的正常工作目录信任流程；收到一个事件不等于全部定义均已信任。

## 入口所有权与退出

`status.entries` 分别列出 `npm`、`codex-plugin`、`claude-plugin`、发行版本、登记时间及其来源。同版本重跑复用身份和后台。比稳定运行时旧的发行物在修改 hook/后台前拒绝接入；更新版本要求后续 #14 的显式升级流程，当前不会将稳定运行时降级或把覆盖文件当作已完成升级。

某个来源仍有其他入口使用时，退出一个入口保留其 hooks、身份、后台及队列。最后一个 owner 退出该来源时，先等待自有后台停止，持久写入停止 capture 的边界，撤下确切自有 hooks，再恢复共享后台：已冻结的 pending 继续交付，原生文件与新 spool 事件不再读取。源文件随后追加、或仍在运行的宿主调用旧 hook，都不会新增存档快照。其他来源继续正常工作。配置改写冲突会保留用户内容并报告错误；中途写配置失败时已停用来源保持不再读取，新恢复流程由 #14 接续。

```text
node "<已安装插件目录>/scripts/skynet.cjs" entry-remove --entry claude-plugin
claude plugin uninstall skynet-claude@skynet-company-skynet --scope user

node "<已安装插件目录>/scripts/skynet.cjs" entry-remove --entry codex-plugin
codex plugin remove skynet-codex@skynet-company-skynet --json
```

宿主没有可靠卸载回调。**仅在市场卸载插件不会退出已登记的 capture 入口**；应先运行 `entry-remove`。若缓存已被移除，使用之前 `status` 显示的稳定 `skynet-launcher.mjs` 执行同一命令。稳定文件与身份不放在插件缓存中；完整停用、凭据撤销和整体卸载由 #14 处理。

入口变更与 setup 共用 #17 的 OS 独占安装锁。另修复了 #12 的关闭时序：旧实现先销毁全部控制连接，偶发令成功 stop 的客户端得到 `ECONNRESET`；现在响应完成后开始关闭，正常排空在途响应，超时连接才强制结束。对于刚接受连接便关闭监听的竞争窗口，只对 reset 最多重探测三次；实际收到认证响应或新的连接拒绝才确定状态，持续 reset 仍报错。公开回归在旧代码稳定失败，修复后 20 轮、每轮 8 个并发 status 与 stop 全部通过，并确认监听所有权最终释放；另断言持续 reset 四次后必须拒绝，不能解释为已停止。

## 实测与复现

本地 `typecheck`、`build` 通过；插件结构和两份 skill 的验证器通过。公开 ownership 回归使用检测桩和合成原件，不混作原生宿主证据：

```powershell
node --import tsx --test tests/plugin-entry.test.ts tests/runtime-control.test.ts
```

它从真实 npm 包开始，再通过两个发行脚本接入，验证一设备/一 writer/一套 hooks、旧插件拒绝降级、删除单个 owner、离线冻结材料、最后 owner 退出、旧 hook 再执行仍不采新字节、积压精确补传、服务器只保留两个真实修订、缓存位置不可用后状态仍工作，以及 Web 可见的原文和接入说明。证据 `%TEMP%/skynet-test-ovk4yw/plugin-entry-evidence.json`、`plugin-archive-and-installation.png`；截图已检查。

真实原生回归通过现有公开流程测试切换安装入口：

```powershell
$env:SKYNET_CLAUDE_RUNTIME = '<Claude Code 2.1.281 绝对路径>'
$env:SKYNET_CODEX_CLI = '<Codex CLI 0.157.1 绝对路径>'
$env:SKYNET_NODE_PTY_ROOT = '<外部 test-only node-pty 安装目录>'
$env:SKYNET_TEST_PLUGINS = 'single' # 插件单独接入；coexist 验证双插件 + npm
node --import tsx --test tests/native-claude.test.ts tests/native-codex-cli.test.ts
```

| 流程 | 证据 |
| --- | --- |
| Claude 插件单独接入→两项目→Web→删除源 home→服务器包续聊 | `%TEMP%/skynet-test-sJ0XxL/{native-plugin-evidence,native-claude-evidence}.json`，32.96 秒 |
| Codex 插件单独接入→正常 TUI 信任→交互 + exec→Web→服务器包续聊 | `%TEMP%/skynet-test-DkzbrN/{native-plugin-evidence,codex-cli-native-evidence}.json`，39.86 秒 |
| Claude 首次插件绑定→Codex 插件→npm→市场卸载首个入口→真实自动采集与恢复 | `%TEMP%/skynet-test-GPNWmg/{native-plugin-evidence,native-claude-evidence}.json`，51.41 秒 |
| Codex 首次插件绑定→Claude 插件→npm→市场卸载首个入口并验证缓存删除→真实自动采集与恢复 | `%TEMP%/skynet-test-pbv7Xv/{native-plugin-evidence,codex-cli-native-evidence}.json`，58.49 秒 |
| Claude 市场卸载确实保留缓存→把自有残留缓存改名不可用→真实采集与服务器独立恢复 | `%TEMP%/skynet-test-UF3xgE/{native-plugin-evidence,native-claude-evidence}.json`，最终 69.97 秒（与全套普通回归并行） |

共存回归实际比较三次 setup 的 device ID、supervisor/worker instance 和逐事件 hook 定义数量，并核对服务器正常会话数量。安装目录含空格，使用宿主生成的真实 cache 安装路径。实测 Codex uninstall 删除缓存，Claude uninstall 保留缓存；最终 Claude 故障回归再把自己创建的残留缓存改名，才验证稳定采集不依赖它，不把宿主移除登记误称为缓存删除。所有原生测试使用临时 HOME、自己创建的 Windows 任务和确定性回环模型，无付费请求、真实员工材料、信任 hash 写入、全局策略改动或 sandbox bypass。

已与主线 `198856b` 的 #12/#17/#26 合并，保留 enrollment ACK 恢复和严格持久交付；存档继续通过共享 Web/MCP 查询服务读取。本票没有改变 MCP 授权或工具协议，完整回归覆盖其现有权限及导出路径。

最终 Windows 集成 `npm test` **15/15 通过**，92.83 秒。该轮入口证据 `%TEMP%/skynet-test-1f0rJ2/plugin-entry-evidence.json`，完整安装 `%TEMP%/skynet-test-BX7Evh`。先前高并行回归暴露既有断网测试假设“第二个进程必在 1 秒退避内启动”；测试改为记录代理收到请求的实际时间，核对所有请求均不早于持久 deadline，未重试时 deadline 保持原值，产品退避不变。

Linux 不据 Windows 结果宣称通过：较新主线 `099db05` 的 [CI 36398456892](https://github.com/yiwer/Skynet/actions/runs/36398456892/job/108850344602) 报告后台无法建立所有权及 Web 停用后登录界面超时。此时尚未合入本票，根因和 Linux 独立复现由主线继续跟进，本票的控制响应修复不能据此认定已解决该失败。

随后进行 Linux 安装专用隔离诊断：使用已有生产镜像的 Node 24.21.0、非 root `node` 用户，只读挂载本票代码，完全复用 CI 失败路径 `/tmp/skynet-test-t6txx3/isolated user with spaces/state/Skynet`。真实离线 npm pack/install/setup、合成 enrollment/health 往返及五轮 stop/start 全部通过。supervisor 端口 22640、worker 58418、setup 锁 18299，彼此没有碰撞。探针 `%TEMP%/skynet-v1-implementation/linux-plugin-runtime-probe.mjs`，结果 `linux-plugin-runtime-result.json`；自己创建的诊断容器已自动移除。该结果仅排除这个固定路径与 Node 版本的通用启动失败，**没有确认 CI 失败根因已修复**；下一主线 CI 仍需通过，若再次失败应捕获排除凭据和控制令牌的 startup/supervisor/runtime 状态后定位。

仍待：#14 升级/修复/完整卸载；正常 Desktop 市场 UI、图标启动及 UI 原生续聊；真实登录/重启/休眠；其他 OS 安装链；完整 G1 和其他发布门槛。内部 CLI marketplace 验证不替代这些边界。

控制端口的一个已观察边界也留给 #14：固定候选端口可能落入 Windows 保留范围或被其他进程占用；当前会明确报告无法建立所有权，重复同一状态目录不会重新分配端口。修复时须确认旧监督器和 worker 的所有权状态，不能停止无关监听者或用 PID 文件推定进程归属。

接口依据：[Codex plugin packaging](https://developers.openai.com/plugins/build/plugins)、[Claude plugin reference](https://code.claude.com/docs/en/plugins-reference)。发行格式以生成的 catalog 和实测版本为准。
