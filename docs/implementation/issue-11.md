# npm 单授权值接入（#11）

日期：2026-09-28。**实现链路已交付，#10/G0 未通过，#11/G1 不能据此签收。** 真实 Codex Desktop 正常用户界面、登录自启、完整生命周期与安装渠道覆盖仍按后续票验收。

## 已实现的用户路径

维护者生成包含非敏感部署地址的本地 npm tarball；员工使用禁用安装脚本的 npm 安装，仅提供 `SKYNET_KEY` 并执行 `skynet setup`。setup 检测实际 CLI 版本和 Windows Codex MSIX 包、登记一次设备、保存受限凭据、合并用户 hooks、启动一个共享后台、通过设备凭据完成独立健康往返。随后正常宿主事件经稳定 launcher、本地队列、采集后台进入认证存档与 Web。健康消息不建立会话资格，不计入员工活动。

同一 OS 执行环境的 Claude、Codex CLI、Desktop 登记共用一份 `identity.json`、一个后台和稳定运行目录。各来源子目录保存独立游标与队列，设置文件只引用中央身份，不复制设备凭据。Windows/WSL/远程环境仍分别登记。

包内只有部署配置、编译后的采集器/共享模块及随包 zod，没有员工或服务端密钥，也没有 postinstall 下载、编译步骤；`private: true` 防止意外发布。没有向公共 npm registry 发布。

## 可重复操作

维护者在已构建的仓库中创建一个新的发行目录；目标平台须已运行并由维护者签发个人 enrollment credential：

```powershell
npm ci
npm run build
node dist/apps/collector/cli.js pack-agent --output C:/SkynetReleases/company-v1 --origin https://skynet.company.example --deployment company-skynet
```

地址是占位示例，必须替换为实际受信任平台。仅隔离回环测试允许 HTTP；setup 拒绝重定向，不能把授权值转发到其他 endpoint。构建过程调用真实 `npm pack --ignore-scripts`；随包依赖使目标安装可以 `--offline`，不会要求员工额外登记模型 Key、员工 ID 或地址。

员工需要 Node 24、目标 Agent、内部包下载权限、用户配置目录写权限及当前用户后台进程权限：

```powershell
npm install -g --ignore-scripts ./skynet-agent-0.1.0.tgz
$env:SKYNET_KEY = '<个人接入授权值>'
skynet setup
Remove-Item Env:SKYNET_KEY
skynet status
```

macOS/Linux 使用 `export SKYNET_KEY='…'`，setup 后可 `unset SKYNET_KEY`。CLI hooks 引用绝对 Node 与稳定 launcher，不依赖宿主继承终端的 Key，也不把 Key 放进宿主配置或模型提示。当前有 Unix 权限与命令生成实现，但真实 macOS/Linux 原生客户端、登录机制尚未验收。

Codex 使用正常 `/hooks` 审查并信任确切定义；Claude 沿正常工作目录信任流程。状态分别报告安装、检测版本、配置、待信任、首次宿主事件、后台、服务器健康新鲜度、确认上传和缺口；观察到某一事件不等于所有 hooks 均已被信任。

## 保存与冲突行为

- 稳定状态位置：Windows `%LOCALAPPDATA%/Skynet`；macOS `~/Library/Application Support/Skynet`；Linux `$XDG_STATE_HOME/Skynet` 或 `~/.local/state/Skynet`。
- Windows 写入凭据前设置仅当前用户 SID 的受保护 DACL，子文件继承；Unix 状态目录 `0700`、凭据 `0600`。设备 Key 与 Web 读取身份分离。
- 宿主 JSON 先验证，再只替换登记的确切 Skynet 条目；原有字段、第三方 hooks 和插件设置保留。修改前保存唯一备份，写临时文件并 fsync 后原子替换。写入前两次比较原内容，并以锁协调 Skynet 安装器。
- 重复 setup 保留设备 ID、来源游标和后台实例；PATH 暂时找不到已登记宿主时保留其配置与积压。原生 home 改变、宿主 JSON 无效、自有条目被外部改写时报冲突并保留原件，不猜测覆盖。
- Codex 共用 hooks 时后台读取受限原件元数据再分来源。实测 CLI `source=exec/originator=codex_exec` 与交互式 `source=cli/originator=codex-tui`；其他 originator 保留为未分类事件及可见缺口。不能把 IDE/app-server 或未实测 Desktop 会话归为 CLI/Desktop。

## 验证与证据

`npm run typecheck`、`npm run build`、7 条普通公开流程 E2E 通过（包含 #9 材料链）。安装专项又验证双来源共用服务端 deviceId、独立凭据存储、已有 hooks、重复 setup、不带 Key 重跑、健康不造工作会话、来源未知留队列、配置冲突/无效 JSON/原生 home 改变/缺少 Key 的安全失败，以及 npm 前缀暂时移走后稳定入口仍可写入。

| 实验 | 结果与本机证据 |
| --- | --- |
| 隔离检测桩 + 真实 npm/安装/服务/Web | `%TEMP%/skynet-test-H4UAVK/installation-evidence.json`；通过 npm 生成的 `skynet.cmd` 调用，含空格用户与 npm 目录。setup 2.580 秒，打包+离线 npm 安装+setup 7.095 秒。此项客户端版本输出是检测桩，不是原生客户端验收 |
| 真实 Claude Code 2.1.281 / win32 x64 | `%TEMP%/skynet-test-yfZJ32/native-claude-evidence.json`：npm `--ignore-scripts`、单 Key setup、普通 hooks、两项目、服务器独立恢复与原生续聊通过 |
| 真实 Codex CLI 0.157.1 / win32 x64 | `%TEMP%/skynet-test-geDM58/codex-cli-native-evidence.json`：正常终端 UI 信任全部已显示定义；交互式 + exec 共三个会话、两个项目、存档/Web/服务器独立恢复通过。`installed-native-metadata.json`、`hook-review.txt`、`hook-review-controls.json` 留有原生来源与正常操作证据 |
| 稳定安装 launcher，连续 200 次 | `%TEMP%/skynet-installed-hook-latency-Vxzx7c/latency.json`：P50 57.43 ms、P95 71.59 ms、最大 84.48 ms，达到 P95≤100 ms；含 Node 进程创建、launcher import 与本地持久化，不含宿主自身启动 |

原生测试全部使用隔离 home、合成工作材料和确定性回环模型，没有付费请求、个人模型凭据、伪造信任 hash、trust bypass 或沙箱改动。安装测试源码在 `tests/installation.test.ts`；两个原生测试设置 `SKYNET_TEST_INSTALLER=1` 即切换至完整 npm 接入路径，运行时和 test-only PTY 路径沿各自原有参数提供。延迟复现：`node dist/tests/measure-installed-hook.js <已安装的绝对 launcher 路径>`。

## 尚未验收的边界

本票最初后台为本次登录会话的进程；后续 [#12](issue-12.md) 已加入独占控制、Windows 当前用户任务及崩溃恢复，实际登录/重启/休眠仍待独立验收。#13 负责插件入口；#14 负责升级、修复与卸载。现在不应向员工宣称完整 G1 或发布；运行时暂固定 `0.1.0`，同版本文件替换不是升级流程。

设备登记 ACK 丢失后的恢复已由 [#17](issue-17.md) 补齐：新安装在请求前私有持久保存随机设备 secret，重试证明原凭据所有权并保持原 deviceId/enrolledAt，不会自动另建身份或复活停用设备。只有旧版本未保存 secret 的中断登记仍需维护者处理。非合作宿主在最终比较与 rename 之间写同一配置仍存在极小竞争窗口，不能声称跨任意写者的原子 CAS。系统策略拒绝受限 DACL、后台或配置写入时应按错误处理，不能显示已完成采集。

正常用户 Windows Desktop 的来源格式、信任操作、图标启动采集及界面原生恢复仍待测；Desktop 包被检测到、共享配置写入或后端测试通过，都不是该条件的通过证据。

官方接口依据：[Codex hooks](https://learn.chatgpt.com/docs/hooks)、[Claude hooks](https://code.claude.com/docs/en/hooks)。信任始终由宿主完成。
