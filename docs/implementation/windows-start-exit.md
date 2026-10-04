# #54 Windows npm start 输出流退出边界

2026-10-04。独立 Windows 安装回归在禁用自有计划任务、stop 后执行 npm `start`：已输出后台 running 状态，但 120 秒子命令期限到达时输出流仍未关闭。该失败与维护旅程的总耗时不同；原安装失败保留，未缩短、放宽或绕过命令期限。

## 诊断与修复

最小公开旅程只保留真实 npm 离线安装、设备绑定、自有计划任务禁用、stop/start 与后台状态读取。修复前实际输出在 8,519ms 完成，调用方 PowerShell 在 8,551ms 以 0 退出；120,002ms 仍没有 close，证实等待的是输出管道，而不是 CLI 尚未返回。回归断言继续等 close，不改成收到 JSON 或 exit 就签为成功。

外部纯进程对照进一步去掉服务器、计划任务和 npm 包：Node caller 以 `detached:true, stdio:'ignore'` 启动持久子进程。直接 Node 调用约 77ms 即 exit/close；PowerShell 调用约 329ms exit 后仍无 close；经过 npm 形状的 `.cmd` 同样失败。只有用自有 sentinel 停止持久子进程后，管道才关闭。去掉 npm 仍复现，定位为 PowerShell 调用链的可继承输出句柄进入分离的 Node 后代。没有按诊断 PID 杀进程。

Windows 当前会话备用启动改为短命隐藏 PowerShell helper，经 `ProcessStartInfo.UseShellExecute=true`、`WindowStyle=Hidden` 启动既有 guardian，让后台不保留调用终端的输出句柄。helper 有既有风格的 15 秒/8KiB 边界；Node 路径和参数通过 JSON 数据传入，复用原 Windows argv 引号规则，SKYNET_KEY 在 helper 环境中移除。不改变计划任务的注册动作、guardian 对实际 ChildProcess 的监护、认证停止或非 Windows 启动路径。

本机对照中隔离后 exit/close 同时发生，持久子进程仍存活直到 sentinel 要求退出。这个 Windows 行为结论来自本轮实测；API 配置语义参考 [Microsoft ProcessStartInfo 文档](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo?view=netframework-4.8) 与 [Node child_process 文档](https://nodejs.org/download/release/v24.0.0/docs/api/child_process.html)。不据此推断所有 Windows/PowerShell 组合均已测。

## 验证

- `tests/windows-start-public.test.ts` 是 Windows 专用公开进程回归：真实 npm shim 的状态输出、exit、close，调用方结束后同一设备、supervisor 与 worker 实例继续运行。主机发现用合成 CLI，未启动真实 Agent 或模型。
- 原 RED：1/1 失败，约 166.91 秒整 fixture；修复后 GREEN：1/1 通过，约 57.17 秒。GREEN `start` 8,447ms 输出，8,471ms 同时 exit/close，后续独立 status 确认后台存活。
- 构建和类型检查通过；接受的集成 `79f24e1`（CI 旅程与原生记录修复）已合入作者分支。原完整 installation 用例 1/1 通过（139.863 秒），保持全部断言，验证 worker/supervisor 崩溃恢复、后台身份、离线补传、无关 PID、认证控制和退出后的公开 Web 存档。未修改 tests/installation.test.ts、owned-command.ts 或其 120 秒期限。

外部证据目录 `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-windows-start/`：`02-public-red.txt`、`red/start-observations.json`、`06-public-green.txt`、`green/start-observations.json`、原与隔离纯进程探针、`09-integrated-build.txt`、完整安装回归日志。诊断源仅保存在明确标注的外部目录；产品没有调试日志。原独立安装失败仍见 `54-ci-independent-windows.txt`。

另一作者已对参数引用、JSON 环境传递、KEY 隔离、Hidden、Dispose 与 guardian 生命周期做只读检查，未发现阻断。维护 311.444 秒通过属于修复前 CI 候选的独立结果，本片没有将它写成修改后复测通过。

```powershell
$env:SKYNET_TEST_POSTGRES_BIN = 'E:/GenCode/Skynet-tools/postgresql-18.6/bin'
$env:SKYNET_OPENSSL = 'D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH = 'D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME = 'E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
npm run build
npx tsx --test --test-concurrency=1 tests/windows-start-public.test.ts tests/installation.test.ts
```

本片不改变安装性能门槛、各子命令期限或 Windows 生命周期支持声明。登录、重启、休眠和真实 Desktop 图标启动仍需各自实测，不能用当前会话 fallback 通过替代。未部署、未接触真实员工材料、未调用付费模型。
