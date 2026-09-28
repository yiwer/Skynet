# 离线原件队列与补传

对应 [#16](https://github.com/yiwer/Skynet/issues/16)。本票打通：正常 hook 登记活动 → 后台冻结主原件和关联材料 → 离线继续捕获代次 → 自动补传 → 已认证设备页面查看积压、失败和恢复。G1 前置验收与完整 G2 仍开放；本实现不能替代真实 Desktop、崩溃窗口和磁盘故障验收。

## 持久化与交付

hook 未改动，仍只做有界本地宿主事件入队，不读原件或联网。共享后台通过 #11 的每来源设置读取同一设备身份；每来源有独立 `delivery/` 队列。

后台把实际字节写成内容寻址 blob，文件 fsync 后同步目录，再写入持久 pending manifest，之后才允许网络交付。待交付计划没有可供重新读取的源路径。离线期间每次被观察到的追加、重写、截断和材料变化都可形成独立代次；后续原件删除不会删除已冻结材料。还未被后台读取的源头内容不在这项保证之内。

交付按捕获顺序处理，每轮最多 8 份。前驱快照成功后，将其服务器 ID 写入下一份的 prepared manifest，并在首次网络请求前持久化。重试复用相同 manifest；关联材料同样冻结、哈希校验及分块组装。确认过的关联 hash 不重复传输，主原件仍使用校验前缀的追加接口，409 时回退完整传输。

仅接受 `committed` 且主原件 hash / byteLength 匹配的确认，然后持久推进 tracked ACK，再移除对应 pending。只有所有待确认代次都不再引用的 blob 才清理。错误确认、网络中断、拒绝、源文件消失均不清除队列。[#17](issue-17.md) 进一步要求 ACK 匹配持久上传键，并补齐同键异内容冲突和提交点强杀/丢 ACK 的公开流程测试；#16 自身不据此宣称完整 G2 通过。

## 退避、配额与状态

- 网络错误、429、5xx 等使用 1 秒起指数退避，上限 5 分钟；401/403、其他拒绝与本地交付数据错误至少等待 60 秒。429 的数字秒或 HTTP 日期 `Retry-After` 可以延长等待，最长 24 小时。下次尝试时间跨进程保存。
- 单来源队列保留上限为 512 MiB 唯一 blob 字节、1024 份待确认快照。到达上限拒绝新的冻结操作并显示缺口；已有未确认材料不会被淘汰。新材料仍依赖源头保留，不能称为已备份。
- `status --state SOURCE_STATE` 的 `status.json.delivery` 显示份数、唯一字节数、最早积压、最后成功、下次重试、连续失败、当前故障、最近拒绝和配额。安装模式 `status` 在对应 client 的 capture 中显示相同信息。
- 修复连接或凭据后可执行 `retry --state SOURCE_STATE`，它仅向原后台请求一次立即重试，不启动竞争进程。独立显式 state 的测试方式再运行 `run --state SOURCE_STATE --once`；正常安装后台自动消费请求。
- `POST /api/devices/health` 保留 #11 的 nonce 与设备身份检查，增加可选来源交付报告。设备只能报告自己的状态。`GET /api/devices/status` 向任一活跃读取身份分页返回共享设备健康，设备凭据不能读取。
- Web 的「设备同步」显示最近一次设备报告，并保留恢复后的最近拒绝原因。连接时间由服务器接收时记录；超过 90 秒即显示离线或状态过期。服务器无法在断网期间实时知道本机新增积压，界面明确说明这一边界。来源状态有单独接收时间；连接成功不代表宿主信任或完整备份。
- 健康上报自己也退避。共享后台心跳失败后 60 秒起至 5 分钟重试，安装显式 nonce 请求仍可立即检查。没有把设备健康上报算成员工活动。

## 验证与证据

`npm run typecheck`、`npm run build`；新增测试可单独执行：

```powershell
node --import tsx --test tests/delivery.test.ts tests/delivery-queue.test.ts
```

`delivery.test.ts` 使用公开 CLI / HTTP / Web、独立 PostgreSQL 和受控网络代理，覆盖：

1. 先确认一份快照，再离线冻结追加原件与 9 MiB 工具材料；重写原件并删除材料后再次冻结；结束采集进程、删除本测试原件、重启服务器，仅用本地冻结队列补齐两代及完整材料。验证前驱关系、旧快照可读、关联材料准确、最终 ACK 后引用回收。
2. 429 `Retry-After` 期间再次启动进程不绕过退避；服务恢复后自动补传。实际错误设备凭据返回 401，60 秒退避保留字节，修复并显式请求重试后补传且保留拒绝历史。503 同样自动恢复。
3. 代理让服务器正常提交但返回错误 hash 的 ACK；同一 manifest 连续交付十次始终只有一个服务器快照和一次逻辑活动。第十一次匹配确认后才清理本地队列。
4. 读取/设备凭据边界、匿名拒绝、伪造设备 ID 拒绝；Web 展示限流积压、最近拒绝和清空后的状态，1440px / 375px 无横向溢出。

`delivery-queue.test.ts` 达到真实 1024 份上限，确认第 1025 份被拒绝、前 1024 份及共享 blob 跨重新打开保留。512 MiB 字节上限实现了同样的引用合计检查，未在本票单独做满额磁盘压力实验。

首次全量回归曾发现关联原件重复网络传输，导致既有 #9 字节计数断言失败；修复为只跳过已确认 hash 的网络上传，没有修改既有断言。合入 #11 final `9ecf4ed` 后，typecheck、build、10 个公开/队列测试全部通过，另 3 个原生集成测试全部通过。Codex CLI 和 Claude 测试启用真实安装模式 `SKYNET_TEST_INSTALLER=1`，使用隔离目录和本地合成模型；Desktop 仅原生后端，不是正常界面验收。G0–G4 仍未通过。

最终证据目录（合成数据）：`%TEMP%/skynet-test-NRIjwH` 的 `delivery-backlog.png`、`delivery-recovered-mobile.png`、本地 pending/tracked/status 以及隔离原件；两张截图已视觉检查。三来源复杂材料回归为 `%TEMP%/skynet-test-IIh7HG`，安装为 `%TEMP%/skynet-test-tnmJwU`。原生证据分别为 `%TEMP%/skynet-test-rBN5DX/native-claude-evidence.json`、`%TEMP%/skynet-test-M2TFKl/codex-cli-native-evidence.json`、`%TEMP%/skynet-test-K0lXmZ/native-recovery-evidence.json`。持久原件、队列文件包含合成会话内容；不会写入认证值到报告或日志。

## 后续边界

#17 继续验证原件持久化/DB 提交/客户端游标推进的各崩溃窗口和 enrollment ACK 丢失；#18 处理磁盘满、访问权限与采集缺口传播。本地已经损坏的队列会保留并报错，不会自行猜测缺失内容。当前 Windows 文件可 fsync，目录同步仍受 Windows API 限制；Linux 持久目录同步已保留。该票不宣称突然断电的硬件级保证，也不宣称真实 Desktop 或全部安装生命周期验收通过。
