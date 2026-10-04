# #54 最终回归运行器与 CI 前提

本补丁准备可重复的当前代码回归，不宣布 V1/V2 总验收完成。逐项剩余条件由外部 `E:/GenCode/Skynet-evidence/v2-2026-10-04/54-final-acceptance-map.md` 记录。完整测试、千会话性能、真实提供商和试点仍需各自实际证据。

`tests/run.ts` 继续选择全部非 `native-*` 的 `*.test.ts` 文件，没有删减新增 Web/MCP/实际 CLI loopback 用例。每个运行器显式 `--test-concurrency=1`，同一工作实例不会按 CPU 数同时启动大量隔离 PostgreSQL。既有 20 分钟进程上限、16 MiB 输出上限、失败 stdout/footer、错误脱敏和非零退出保留。

CI 用两个独立 Ubuntu job，各自串行；`SKYNET_TEST_SHARD=1/2` 和 `2/2` 交给 Node 原生分片，全部文件合计恰执行一次。省略变量运行完整集合；其他值立即失败。该变量不传给嵌套测试fixture，避免运行器自身回归被再次切片。Workflow 外层上限为 30 分钟以包括依赖安装/构建，未修改任何产品性能阈值、单用例期限或运行器的 20 分钟上限。

`.github/workflows/v1.yml` 保留 main/PR，并补充 `codex/v2` push 与手动触发；这只是让正确固定源码有机会生成证据，过去未触发 CI 不构成产品实现失败。两个 job 即使其中之一失败也各自完成/保留结果，不能只看绿色分片。

CI 提供独立锁定的官方 Claude Code 2.1.281 Linux x64/glibc 包，使用 npm SRI 完整性校验、禁止安装脚本、实际 `--version` 检查及二进制 SHA-256。详见 `tests/runtime/README.md`。不使用 latest、全局安装或产品依赖。CI 的 PostgreSQL 继续使用既有 Docker fixture；Windows 验证显式使用四个环境变量：

```powershell
$env:SKYNET_TEST_POSTGRES_BIN='E:/GenCode/Skynet-tools/postgresql-18.6/bin'
$env:SKYNET_OPENSSL='D:/DevEnv/Git/usr/bin/openssl.exe'
$env:SKYNET_GIT_BASH='D:/DevEnv/Git/bin/bash.exe'
$env:SKYNET_CLAUDE_RUNTIME='E:/GenCode/Skynet-evidence/v2-2026-10-04/runtime/package/claude.exe'
```

Workflow 保留固定源码、dirty 状态、Node/npm/Docker/宿主版本、runtime版本/hash、完整候选文件表、分片、构建与实际测试输出。支持外部证据目录的浏览器旅程写入 artifact 子目录。旧测试内部临时文件仍不自动变成永久附件；只有 upload-artifact 中实际存在的文件可作为本轮附件。

运行器的公开测试通过真正的子测试进程观察：三个测试共享一个排他资源时全部完成；两个分片覆盖每个文件恰一次；无效分片立即失败；失败输出/footer/脱敏继续有既有公开回归。没有mock Node命令行或断言某个内部函数被调用。

首次完整回归应等同机性能采样结束并使用冻结源码，避免资源争用掩盖行为。正常隔离 Windows 安装/Task、Docker 灾备、原生宿主矩阵和真实提供商门槛仍单独登记，不能把本工具或 fixture 通过写成那些能力已验收。

验证证据：`E:/GenCode/Skynet-evidence/v2-2026-10-04/54-final-validation/`。`01-runner-red.txt` 是真实资源竞争 RED，`02-runner-green.txt` 通过；`03-shards-red.txt` 记录分片未生效导致重复执行，`04-runner-green.txt` 修复通过。`05-typecheck.txt` 保留测试局部 env 类型错误，修正后 `06-typecheck.txt` 通过。`08-build.txt` 构建通过，`09-final-runner-public.txt` **11/11 PASS（6.40 秒）**，包含既有 owned-command 完整回归。Linux原生包未在Windows执行，GitHub workflow 尚未触发，完整普通套件尚未运行；这些都不能记成 CI PASS。
合入已接受等待批处理的集成 `f1a1094` 后，作者代码固定为 `0c991711af8109f48ad7dca8b585fdb2d62a4eb7`：`10-integrated-build.txt` 构建通过；`11-integrated-runner-public.txt` **11/11 PASS（7.87 秒，0 skip）**。本轮只执行构建和无 PostgreSQL 的运行器/owned-command 用例，没有启动普通全套或与千会话数据库量测竞争。
