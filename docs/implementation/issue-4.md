# #4：首条会话存档链

状态：已实现合成输入的完整产品路径；**Issue #4 的真实 Codex Desktop/OS 验收尚未通过**。不能据此关闭 #4、解锁依赖票或宣布 V1/G0 已完成。

实现范围是：管理员签发独立的接入授权与读取凭据 → 设备绑定 → 短 hook 本地落队列 → 后台核对该会话 → 持久化原件 → 提交快照 → 另一已认证用户在 Web 阅读消息与工具结果。接入不会扫描原生目录；只有接入后进入 hook 队列的会话才会被读取。

## 本地演示与测试

需要 Node 24、npm、可运行 Linux 容器的 Docker。测试及演示只创建随机命名的隔离 PostgreSQL 容器、临时目录与合成材料，不读取用户的 Agent 配置、会话或凭据。

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm run build
npm test
npm run demo
```

演示命令输出本机 URL 和一个私有临时 JSON 文件路径。从文件取得本次随机生成的 `readerCredential`，在页面登录并选择“合成演示员工”的会话。凭据没有固定默认值；HTTP 监听仅在 loopback。页面以纯文本显示恶意 HTML 示例，不执行其中脚本。`Ctrl+C` 结束演示；Windows 终端若只结束 npm 包装进程，应直接运行 `node dist/tests/demo.js`，并确认对应演示子进程已经退出。测试自动清理容器，截图留在输出的临时目录。

Linux 原件持久化 smoke：

```sh
docker build -t skynet-v1-issue4:local .
npm run test:linux
```

该 smoke 通过公开 CLI/API 采集一条合成会话，应用在 Linux Node 24 容器中运行，原件使用 named volume，重启应用容器后逐字节核对下载结果。它不等于断电、磁盘故障、灾备或 G2 故障矩阵验收。

## Linux 单机启动

复制 `.env.example` 为 `.env`，填写随机十六进制 `POSTGRES_PASSWORD` 和解析至服务器的 `SKYNET_HOST`，然后执行：

```sh
docker compose --env-file .env -f deploy/compose.yml up --build -d
```

只有 Caddy 暴露 80/443；数据库、应用与原件卷留在内部网络。Caddy 负责 HTTPS。没有内置员工、活跃默认凭据或公开管理员注册端点。管理员在服务器上经标准输入创建员工：

```sh
printf '{"name":"试点员工"}' | docker compose --env-file .env -f deploy/compose.yml exec -T app node dist/apps/server/provision.js
```

返回的 `enrollmentCredential` 用于设备接入，`readerCredential` 用于页面读取；二者权限独立。保管返回值，服务端只存哈希。已认证读者可以读取全部员工存档。设备写入归属由服务端绑定决定，不接受清单自报员工 ID。

当前只显示单副本状态；数据库与原件卷必须分别保留。本票不提供灾备操作或自动清理原件。不要执行删除持久卷的命令作为重启操作。

## 采集公开入口

先构建代码。以下命令的 `PRIVATE_STATE` 必须是当前用户独占的绝对目录，Windows 应使用当前用户私有目录并核查 ACL。`setup` 标准输入为 JSON：

```json
{
  "server": "https://your-skynet-host.example",
  "enrollmentCredential": "由管理员签发的个人接入授权值",
  "nativeRoot": "隔离 Codex home 内的 sessions 绝对路径",
  "sourceVersion": "实测宿主版本",
  "sourceOs": "实测操作系统"
}
```

```sh
node dist/apps/collector/cli.js setup --state PRIVATE_STATE
node dist/apps/collector/cli.js run --state PRIVATE_STATE
node dist/apps/collector/cli.js status --state PRIVATE_STATE
```

`setup` 从 stdin 接收上述 JSON，不把授权值作为命令行参数。`run` 是本票的显式后台进程入口；系统登录启动、安装与修复属于后续票，尚未实现。正常采集不依赖每天手动同步，但当前进程须由测试操作者启动并保持运行。重复 setup 使用已有身份；如果设置保存前接收确认丢失，自动恢复绑定仍待后续安装票处理。

宿主 hook 命令为：

```sh
node /absolute/path/to/dist/apps/collector/cli.js hook --state PRIVATE_STATE
```

它从 stdin 接收 Codex 的 `hook_event_name`、`session_id`、`transcript_path` 与可选 `cwd`，仅写本地 spool，不执行网络请求或读取原件，始终成功退出且不向 stdout 写内容。当前接受 SessionStart、UserPromptSubmit、Stop；`transcript_path=null` 或写入失败进入本地 `hook-gap.json`（若磁盘可写）。通过 `status` 可见材料缺口。后台仅读取指定原生根下、ID 与原件首行一致的 JSONL，不打包配置目录。

必须在隔离宿主中按其正常 hook 审查/信任入口批准准确的命令；本实现没有修改宿主配置、授予信任或绕过宿主安全机制。**手工向 stdin 重放事件只是模拟输入，不构成真实宿主活动验证。**

## HTTP 契约

所有 API 响应禁止缓存。读取用个人读取 Bearer credential，写入用独立设备 Bearer credential；接入用个人接入授权值。凭据只能经 HTTPS 发送，隔离本机演示允许 loopback HTTP。

| 入口 | 行为 |
| --- | --- |
| `POST /api/devices/enroll` | 接入授权与安装 UUID 绑定员工，返回设备 ID/凭据；重复安装 UUID 拒绝以免泄露已有凭据 |
| `PUT /api/chunks/:sha256` | 接收原始 octet-stream，校验字节哈希，fsync 后以不覆盖方式发布；返回 staged，读者不可见 |
| `POST /api/snapshots` | 校验已落盘原件及长度，提交清单事务后返回 committed；同清单重试返回相同快照 ID |
| `GET /api/me` | 验证读取凭据并返回当前员工显示信息 |
| `GET /api/sessions` | 最近 100 条会话的最新已提交快照，所有已认证读者结果一致 |
| `GET /api/snapshots/:id?offset=0` | 确定快照、来源、哈希、解析版本、原件行位置；每页最多 100 条已解析记录 |
| `GET /api/snapshots/:id/raw` | 返回完全相同的原件字节；下载原件不代表原生续聊已验证 |

初始协议清单见 `packages/contracts/archive.ts`。只接受一个最大 8 MiB 的原件；超限保留待处理状态并报告错误，后续票再实现分块、多原件与复杂来源。JSONL 未闭合末行、未知类型保留全部原始字节，不冒充完整业务事件。来源 `capability=unverified` 为固定状态，本票没有设置“完整备份/原生恢复已验证”的路径。

## 已跑验证与未决条件

2026-09-28，在 Windows Node 24.12.0/npm 11.6.2、Linux PostgreSQL 17 容器与 Playwright Chromium 上通过：类型检查、生产构建、公开接入→断开服务器时 hook 入队→后台采集→HTTP 查询→Web 阅读→应用进程重启后原件逐字节一致。覆盖匿名/错误权限拒绝、另一员工读取、归属不可自报、未提交不可见、哈希损坏拒绝、未知/部分行保留、未活动旧会话不扫描、网页文本不执行、375/1440px 无横向溢出。截图由测试保留，未提交包含随机本机路径的截图文件。

生产依赖经 npm 官方 registry audit 检查为 0 漏洞。同日通过 Linux 容器 smoke：Node 24、PostgreSQL 17、独立 named raw volume，重启应用容器后公开下载与输入原件逐字节一致。镜像构建时本机 Docker 自动注入的 loopback 代理不可达；仅对该构建清空代理 build args 后通过，未改动全局 Docker/代理设置。

**仍缺真实 Desktop 验收：** 已安装 Windows Desktop 26.924.2738.0、内置 runtime 0.158.0-alpha.2.1。独立研究的隔离 Desktop UI 启动在显示页面前退出，且正常宿主 hook 信任与自动捕获尚未贯通。本票合成测试使用公开 hook 入口重放输入，没有冒充 Desktop。实际 Desktop 从正常可信 hook 产生一条新合成对话、经后台进入此页面的证据仍待补齐。hook 启动 P95≤100ms、真实原文可见 P95≤60s 尚未测量，不声称达标。CLI/runtime 模式的探针不能代替 Desktop UI 验收。

契约参考：[Codex hooks](https://learn.chatgpt.com/docs/hooks)、[Fastify server](https://fastify.dev/docs/latest/Reference/Server/)、[Node 文件系统持久化 API](https://nodejs.org/docs/latest-v24.x/api/fs.html)。
