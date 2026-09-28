# 崩溃与确认丢失的一致快照（#17）

日期：2026-09-28。对应 [#17](https://github.com/yiwer/Skynet/issues/17)。这条 tracer bullet 从公开 setup / hook / collector 到上传事务，再到共享 Web、原件、可读导出和恢复包。**本票的合成故障流程通过；G0–G4 仍 OPEN，不代表真实 Desktop、磁盘故障、完整跨设备归属或整个 V1 验收通过。**

## 提交与确认

本地 pending manifest 的随机 UUID 是持久上传键，在任何网络请求前保存。追加与全量回退使用相同 `Idempotency-Key`，prepared manifest 在首次交付前冻结。服务端以设备 ID 和上传键绑定规范化 manifest 的 SHA-256；设备接入日期始终由服务器覆盖，客户端不能修改活动边界。

服务端事务先对该设备与键加事务级锁，再核对全部主原件/关联材料已落盘、长度及 SHA-256，最后将快照和上传键绑定一起提交。相同键与相同内容返回原快照 ID、原提交时间；同键不同原件或元数据返回 409，既有快照保留。并发相同请求也只得到一个结果。未提供键的旧 HTTP 调用仍按完整 manifest 去重；新版采集器要求 ACK 同时匹配上传键、快照格式、hash、长度和 `committed`，因此须先升级服务器，再升级采集器。

原件暂存不等于已提交快照。读取接口只返回数据库已提交结果；新提交缺块、长度错误或 hash 错误时，旧快照继续可读。客户端持久推进 tracked ACK 之后才移除 pending，随后仅清理没有待确认引用的 blob。被强杀后会重新打开冻结队列，不依赖源文件仍然存在。blob 先写唯一临时文件、fsync，再以链接发布完整 hash 文件；进程中断不会把半截内容发布到不可变 hash 名称下。

## 接入确认恢复

setup 在受保护状态目录先持久保存 installation ID、随机 256 位设备 secret、服务器地址及个人授权值的 hash，随后才登记。个人授权值本身不落盘。若服务端成功但响应丢失，重跑同一 setup 能证明原设备 secret 所有权，得到同一个设备、同一个 secret、同一个 `enrolledAt`；服务端只存 secret hash，不需要恢复明文，也不静默轮换凭据。

仅有 installation ID、不同 secret、切换待处理个人授权或服务器不能接管登记。停用设备返回 403，停用账号返回 401，不会通过重试复活。旧版本只有 installation ID、没有预存 secret 的未完成登记仍需维护者处理，不能自动恢复已经丢失的未知凭据。

安装锁和独立显式 state 的采集锁改为 OS 独占端点，强杀后由 OS 释放，不用 PID 文件判断存活或杀进程。Windows 使用命名管道；其他平台使用路径 hash 对应的回环端口，端口被其他服务占用时明确失败。已安装来源拒绝直接 `run --state`，由共享后台继续负责唯一写者。#12 管理共享后台生命周期。Windows 状态权限通过 .NET Directory DACL API 设置，避免从 PowerShell 7 继承模块路径时 Windows PowerShell 的 `Set-Acl` 模块加载失败；系统配置不变。

## 可复现验证

```powershell
npm ci
npm run build
node --import tsx --test tests/consistency.test.ts
npm test
```

测试仅创建自己的 PostgreSQL 容器、临时材料、CLI 与服务器子进程。外部 HTTP 代理控制故障点，产品中没有测试开关或提交后门。

- 登记事务已完成但 ACK 未到：真实强杀 setup 和服务器，保留预存证明；并发 setup 被锁拒绝，切换个人授权被拒绝，原授权重试保留一个设备及原接入时间。
- 原件上传返回 staged、快照请求尚未提交：并发采集器被锁拒绝，强杀采集器及服务器并删除本测试源文件；重启前后只显示旧快照，冻结队列补传后得到精确新字节。
- 快照已提交、客户端游标尚未推进：强杀两进程；重启后先注入错误上传键 ACK，再实际断连接丢失十次 ACK。十次均保留 pending 与旧游标，只有同一个上传键及快照；匹配 ACK 后才清空积压。
- 十个并发相同 HTTP 提交、同键不同原件/项目/来源、缺块、错误长度/hash、缺关联材料分别验证；失败不增加活动或改变旧快照。最终一个会话、三个真实修订、三个用户轮次。
- 共享读取身份核对 raw / readable / recovery 的完整字节和清单，并从 Web 下载原件；停用写入身份后旧材料仍可读。

Windows 本机 `typecheck`、`build`、11 项普通测试全部通过；最新专项证据为 `%TEMP%/skynet-test-SfRhyt/consistency-evidence.json` 与 `consistency-final.png`。全量回归的一致性证据为 `%TEMP%/skynet-test-oVwNk2`，实际离线 npm 安装回归为 `%TEMP%/skynet-test-zYs99e`。截图已视觉核对。hook 未改动，不重复延迟测量。

本票测试实际进程强杀，不是断电试验；Windows 不能 fsync 目录，不能把本机结果宣称为断电持久性证据。生产服务器的 Linux 目录同步路径由 Linux CI/部署验证继续覆盖。MCP 与 Web 使用的共享查询接入由 #26 提供，本票没有新增 MCP 写入工具；最终合并须回归其读取与导出。磁盘满/权限拒绝和队列损坏的可见缺口属于 #18，跨设备/历史归属属于 #19。
