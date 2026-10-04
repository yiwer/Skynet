# Ubuntu 单机部署与应用回滚

目标：`ubuntu@159.75.158.26`，域名 `skynet.91boy.cn`。2026-10-03 已使用用户提供的 `tec.pem` 成功部署并验证 HTTPS；不修改服务器认证配置。主机为 Ubuntu 24.04、4 核 / 4 GB、Docker 29.1.3、Compose 2.40.3，使用既有 nginx 代理到 127.0.0.1:14311。首个健康版本为 `v2-36a5c5a0e667-1`；后续视觉修订的部署记录见本文末尾。部署通过不表示完整 V2 或 V1 真实验收完成。

## 文件与部署边界

新增 [生产 Compose](../../deploy/compose.production.yml)、[既有代理覆盖配置](../../deploy/compose.existing-proxy.yml)、[生产 Dockerfile](../../deploy/Dockerfile.production) 和 [发布脚本](../../deploy/ubuntu-release.sh)，保留原有开发/验收 Compose。生产脚本只管理固定项目 `skynet-production` 与带有本部署归属标签的卷；不停止系统 nginx，不接管其他 Compose 项目，不删除镜像、release 或持久卷。`deploy` 保持独立 Caddy 模式；`deploy-proxy` 使用已配置好的 HTTPS 代理，只在 loopback 绑定所选高端口。模式与端口保存进私有配置，后续 `status`、`backup`、`rollback` 自动使用同一模式；不支持通过换命令隐式迁移入口。

默认目录为 `/opt/skynet`，由 root 持有，权限 0700：

```text
/opt/skynet/
  .skynet-managed
  private/runtime.env          # 0600，数据库密码、域名、基础镜像 digest、代理模式和端口
  private/deploy.lock
  private/last-attempt
  releases/<release>/          # 固定源码、source.sha256、release.env、image-id
  current -> releases/<release>  # 最近一次健康检查通过的版本
  previous -> releases/<release>
  receipts/backup-*.json       # 一致备份的非敏感回执
```

PostgreSQL、原件和一致备份保存在 Docker named volumes：`skynet-production-database`、`-originals`、`-backups`。独立 Caddy 模式另建 `-tls-data`、`-tls-config`；既有代理模式不创建这两个卷。每个卷带 `com.skynet.deployment-root=/opt/skynet` 标签。现有同名但未标记的卷会使部署停止；已有数据需要用原配置做明确迁移，不能用新密码或空卷冒充升级。

应用 Node 镜像固定为仓库已有备份工具使用的 Node 24.21.0 digest，依赖按 `package-lock.json` 安装。首次部署拉取 PostgreSQL `17.11-alpine` 并保存实际 digest；独立模式同时拉取并固定 Caddy `2-alpine`。既有代理模式中的 Caddy 服务仅保留 Compose 所需的镜像引用，处于未启用 profile，不拉取或启动它。后续部署保持实际使用的基础镜像 digest，升级基础设施另行执行。应用镜像按 release 命名并保存源码 SHA-256 与最终 image ID。发布编号建议 `v2-<git-short-sha>-<build-number>`；同名 release 的源码不同会被拒绝。

生产 Compose 在独立模式启动数据库、应用和 HTTPS；既有代理模式只启动数据库和应用。分析 Worker 不在该 Compose 中：未配置专用 PAYG 模型、凭据、当前价格和预算时，分析保持未启用，不以 fixture 充当生产分析。

## 1. 主机与入口检查

使用用户指定的私钥建立连接，保持正常主机密钥校验：

```powershell
ssh -i C:\Users\yiwer\.ssh\tec.pem ubuntu@159.75.158.26
```

在服务器核实 Ubuntu 版本、容量、已有服务、Docker 与 Compose。以下命令只读取状态：

```bash
cat /etc/os-release
uname -m
df -h / /var/lib/docker 2>/dev/null
free -h
sudo ss -ltnp '( sport = :80 or sport = :443 )'
sudo docker version
sudo docker compose version
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
getent ahostsv4 skynet.91boy.cn
```

需要 Docker Engine、Compose 插件 v2.20+，以及 Bash、curl、OpenSSL、Python 3、iproute2、util-linux 和 coreutils。已有 Docker 时保持现有安装；缺少时按照 [Docker 官方 Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/) 配置 apt 仓库并安装 Engine/CLI/Buildx/Compose 插件，先查明已有容器和冲突软件，再选择版本。脚本本身不安装、卸载或重启 Docker。

安全组允许公网 TCP 80/443，SSH 保持既有访问限制；数据库不发布到宿主机。既有代理模式的应用仅发布到 `127.0.0.1:14311`，不得放开此端口到公网；独立模式应用不发布宿主机端口。Docker 发布端口可能绕过 UFW 的普通规则，需检查云安全组和 Docker 适用的防火墙链，不能只看 UFW 状态。[Docker 防火墙说明](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations)

域名 A 记录应指向 `159.75.158.26`；若有 AAAA 记录，它也必须到达这台服务器。Caddy 使用现有 [Caddyfile](../../deploy/Caddyfile) 自动取得和续期证书，需要 CA 能访问相关 HTTP/TLS 验证端口。[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)

独立模式若发现 80/443 被占用会停止并保留它们。既有代理模式只检查指定高端口，不管理 nginx。目标主机的独立 Skynet site 已由操作者配置并通过 `nginx -t`：`/etc/nginx/sites-available/skynet`，软链接 `/etc/nginx/sites-enabled/skynet`；ACME webroot `/var/www/letsencrypt`；证书 `/etc/letsencrypt/live/skynet.91boy.cn`，本轮证书有效期至 2027-01-01；`certbot.timer` 为 active，续期 reload hook 位于 `/etc/letsencrypt/renewal-hooks/deploy/skynet-nginx-reload`。原四个站点的配置 SHA 校验记录保存在 `/var/backups/skynet-deployment/existing-sites.sha256`，配置未变。

[nginx 配置示例](../../deploy/nginx.existing-proxy.conf) 与本轮目标域名和端口一致，仅供操作者核对后手工复制；发布脚本不读取、复制或重载它。初次复制 HTTPS 段前先用 ACME webroot 取得证书，测试 `nginx -t` 后 reload；不要覆盖其他站点。实际入口准备脚本另保存在部署证据目录 `E:\GenCode\Skynet-evidence\v2-2026-10-03\prepare-nginx.sh`。更换域名或应用端口须同步核对 site 与私有部署配置。

## 2. 上传固定源码快照

先完成本轮产品集成与测试，并将要发布的代码与新增部署文件固定到一个 Git 提交，再用 `git archive` 打包该提交。这样源码和脚本取自 Git 对象，避免 Windows 工作树的 CRLF 转换；脚本要求 LF。下例只包含构建与部署所需文件，不携带 `.git`、`node_modules`、`dist`、私钥、服务器 `.env` 或员工材料。上传与部署使用同一 release；保存完整 Git revision 与压缩包哈希。未提交或未跟踪的文件不会被 `git archive` 包含。

```powershell
$revision = (git -C E:\GenCode\Skynet rev-parse HEAD).Trim()
$release = "v2-$($revision.Substring(0, 12))-1"
$archive = Join-Path $env:TEMP "$release.tar.gz"
git -C E:\GenCode\Skynet archive --format=tar.gz --output=$archive $revision .dockerignore Dockerfile.backup package.json package-lock.json tsconfig.json vite.config.ts apps packages deploy
Get-FileHash -Algorithm SHA256 -LiteralPath $archive
scp -i C:\Users\yiwer\.ssh\tec.pem $archive ubuntu@159.75.158.26:/home/ubuntu/
```

在服务器创建新的专用解包目录，先核对归档哈希。不要覆盖以前上传或已发布的目录：

```bash
release='v2-REPLACE_WITH_REVISION-1'
sha256sum "/home/ubuntu/$release.tar.gz"
mkdir -m 0700 "/home/ubuntu/$release"
tar -xzf "/home/ubuntu/$release.tar.gz" -C "/home/ubuntu/$release"
sudo bash "/home/ubuntu/$release/deploy/ubuntu-release.sh" \
  deploy-proxy "/home/ubuntu/$release" "$release" skynet.91boy.cn /opt/skynet 14311
```

首次部署前已确认 `/opt/skynet` 不存在；现已由本部署建立，后续发布复用其私有配置与持久卷。首次执行仍会拒绝接管非空未标记目录。`deploy-proxy` 的最后两个参数可省略，默认 `/opt/skynet` 与 `14311`；若指定其他高端口，只接受 1024–65535，且必须先配置好 HTTPS 代理。独立部署仍使用原命令 `deploy SOURCE RELEASE HOST [ROOT]`，要求 80/443 空闲。

脚本拒绝复用不同内容的 release，保留已有密码和固定基础镜像，检查卷归属及端口后构建应用。首次成功后创建 `current`；重跑同一源码和同一编号只协调本项目服务。变更 release 前，使用当前版本的备份工具完成 SQL 与全部原件的一致备份；备份失败时停止升级，旧应用继续运行。

启动包括数据库 readiness、应用容器 `/health`、有效 HTTPS 证书及 HTTPS `/health` 验证；既有代理模式另验证 `http://127.0.0.1:14311/health`。验证成功才更新 `current`。健康检查失败会保留现场和之前的 `current`，但新的应用容器可能已替换旧容器：`current` 是“最后通过验证”，不是失败期间实际运行镜像的承诺。查看 `private/last-attempt`、容器镜像和日志后决定修复或应用回滚。

## 3. 首个维护账号与端到端核查

HTTPS 成功后创建一个维护账号。下面的操作仅执行一次；所有凭据写入 root-only 文件，不打印到终端或日志。若数据库已有员工但凭据文件缺失，先查明旧交付记录，不重复创建账号来掩盖丢失。

```bash
sudo bash <<'SH'
set -euo pipefail
umask 077
root=/opt/skynet
release=$(basename "$(readlink "$root/current")")
compose=(docker compose -p skynet-production --env-file "$root/private/runtime.env" \
  --env-file "$root/releases/$release/release.env" -f "$root/releases/$release/deploy/compose.production.yml")
if grep -qx 'SKYNET_PROXY_MODE=existing-proxy' "$root/private/runtime.env"; then
  compose+=(-f "$root/releases/$release/deploy/compose.existing-proxy.yml")
fi
test ! -e "$root/private/operator.json"
test "$("${compose[@]}" exec -T db psql -U skynet -d skynet -Atc 'SELECT count(*) FROM employees')" = 0
printf '%s' '{"name":"平台维护者","canManageIdentities":true}' | \
  "${compose[@]}" exec -T app node dist/apps/server/provision.js > "$root/private/operator.json.pending"
python3 -c 'import json,sys; v=json.load(open(sys.argv[1])); assert v["readerCredential"] and v["enrollmentCredential"]' "$root/private/operator.json.pending"
mv "$root/private/operator.json.pending" "$root/private/operator.json"
SH
```

`readerCredential` 用于 Web 登录，`enrollmentCredential` 用于员工接入。通过私密交付渠道提供给有权使用者；不要把完整 JSON 贴进聊天、Issue 或公开日志。若创建后在文件发布前中断，保留 `.pending` 并检查数据库，不重跑创建命令。

核查入口：

```bash
sudo bash /opt/skynet/current/deploy/ubuntu-release.sh status
curl --fail --silent --show-error https://skynet.91boy.cn/health
```

还应从服务器之外验证 HTTPS 与主页，并用维护账号检查受保护读取、版本化存档和新页面的空状态。随后只用专门的合成材料验证上传→原文→指标/对话 Web 与 MCP 的路径。`/health` 成功不能证明完整产品验收、原生恢复、真实 PAYG 或运营试点通过。

## 4. 更新、备份与回滚

更新：上传新编号源码，再以同一模式执行 `deploy-proxy` 或 `deploy`。旧 release、旧镜像、数据库、原件和证书均保留；不运行 `docker compose down -v`、volume prune 或删除历史目录。

手动备份：

```bash
sudo bash /opt/skynet/current/deploy/ubuntu-release.sh backup
```

备份实体在 `skynet-production-backups` 卷，回执在 `/opt/skynet/receipts/`。当前副本与服务器同故障域；应按 [服务器一致备份与独立恢复](server-backup.md) 的完整包校验与异机步骤建立第二份副本。恢复必须使用新的专用数据库和原件卷，不能把旧 SQL 倒回仍在接收上传的生产数据中。

应用回滚仅在确认旧代码能读取当前数据库 schema 后执行；脚本先做一致备份，再切换应用镜像，保留当前数据和 HTTPS：

```bash
sudo bash /opt/skynet/current/deploy/ubuntu-release.sh \
  rollback v2-REPLACE_WITH_PREVIOUS_RELEASE-1 --schema-compatible
```

`--schema-compatible` 表示操作者已检查这次迁移的回退兼容性；脚本不能推断语义兼容。若迁移破坏兼容性，保留故障现场并前向修复，或按独立恢复流程在新目标上恢复；不要自动回滚数据库。应用迁移失败、证书取得失败和构建失败分别保留日志和实际镜像，不宣称自动恢复成功。

## 5. 验证与已知限制

2026-10-03 本地验证：Git Bash 的 `bash -n`、`--help`、非法 release 路径、宽泛根目录和非法高端口拒绝检查通过；Docker Compose v5.5.1 的两模式 `config --quiet` 通过。默认服务为 `db`、`app`、`https`，既有代理模式为 `db`、`app` 且应用只发布 `127.0.0.1:14311`；分析 Worker 不在其中。这些准备检查不等于 Ubuntu 应用实机部署验证。远端执行时记录 release/source hash、应用 image ID、PostgreSQL digest（独立模式另记 Caddy digest）、Engine/Compose 版本、健康检查时间与状态、备份回执和未启用的能力。

此配方是单机顺序更新，应用替换存在短暂停机，不承诺零停机或异地容灾。它不自动启用分析 Worker、不扩展防火墙、不注册员工端后台，不替代 V1/V2 的真实验收。磁盘容量、数据库增长和原件长期保留需按实际部署负载观察。

## 6. 实际发布记录

2026-10-03 首次健康发布 `v2-36a5c5a0e667-1`，Git `36a5c5a0e6670dc0ea681fc8e433037437e12a9d`，源码归档 SHA-256 `d3ef9a2fa0726a69d58e61f3c29d0895fefeb98049c26b9cefd1800ca5160dae`。此前 `v2-5daeda3f5b02-1` 在数据库容器启动前因 Compose tmpfs 未加引号失败；修复三个配置值后，核实数据库未启动、卷为空和归属标记，保留原卷与私有配置，再发布修订版本。没有删除数据库或原件。

初始同机一致备份通过，回执 `/opt/skynet/receipts/backup-20261003T103436Z-800099.json`。外部 HTTPS、主页和资产、未认证接口拒绝、维护账号权限、空存档、Web/API 固定指标导出与 OAuth HTTPS issuer 共 13 项检查通过。生产环境没有注入合成会话；完整 Web/MCP/上传验证在独立测试沙箱完成。

首个维护账号已创建一次，服务器凭据文件 `/opt/skynet/private/operator.json` 为 root-only。本机交付文件 `C:\Users\yiwer\.ssh\skynet.91boy.cn-operator.json` 限当前用户和 SYSTEM 访问；网页登录使用其中 `readerCredential`。不在仓库、聊天或日志中记录凭据值，后续发布不重复创建账号。

2026-10-03 19:25（北京时间）视觉修订发布 `v2-43235729a834-1`，代码 Git `43235729a8346914e0eb6f6a2fc64e5914aadc59`。发布归档 SHA-256 `6502a88fe01ded98a57e3a01759a6d94e9fef0db2aa32941d1239e0fdfd03073`，服务器构建源码 SHA-256 `046b8ae42269d8a6ba28f103edc242011eb635fe614bacdc10ba612db6b9c3c2`，镜像 `sha256:f713a36de8dff66224394ac1a2a3e4bb98e34d5d4197c733e28248af99b28e97`。升级前备份回执 `/opt/skynet/receipts/backup-20261003T112516Z-866873.json` 为 completed；保留旧 release 与镜像，数据库未替换。资产为 `index-BtKn_aAS.js` / `index-BpVIMKpd.css`。

外部 13 项 API/HTTPS 冒烟复跑通过。浏览器实测维护账号登录、团队/用量/找回/接入/运行五页、同源字体加载、Ctrl+K/Escape 搜索和 375px 移动抽屉通过，无脚本或 console 错误、无页面横向溢出；严格 CSP 保留。生产存档仍为空，分析 Worker 仍禁用。既有四个 nginx site 的 SHA 校验通过，Certbot timer active。证据为 `E:\GenCode\Skynet-evidence\v2-2026-10-03\production-smoke.json` 与 `production-visual-smoke.json`。本段是部署后的记录更新，部署代码以所列 Git revision 为准。

2026-10-03 20:15（北京时间）发布工作区与信息精简修订 `v2-f0a2f42f4160-1`，随后20:22发布窄屏/平板补丁 **`v2-745c2be6df44-1`**。最终源码 Git `745c2be6df4473290f4eacc44ec0eb747c526525`，发布归档 SHA-256 `c0087ff742a8403a30e7e43a401224ca7bef2e483dd8999f2149d8c391ab2a81`，服务器源码 SHA-256 `f7e237dbade776293711d3971d04a0e2479cadcf860c5116029a56a28101c93d`，应用镜像 `sha256:687b76f0fbde4435affa56a16ada48d7bab455d3b3c2106f6148031586e4324a`。资产为 `index-NNmQzWbl.js` / `index-Dp10cLpo.css`。

两次升级前一致备份均完成，回执分别为 `/opt/skynet/receipts/backup-20261003T121453Z-932334.json` 和 `/opt/skynet/receipts/backup-20261003T122219Z-943386.json`；原数据库、原件、历史 release 与镜像保留。最终外部13项API检查通过，四个既有nginx站点哈希不变，证书续期任务active，分析Worker继续禁用。本轮用户授权本机接入并测试后，生产已含明确的接入测试会话，不再是空存档。

前一个工作区发布通过9个只读页面×1280/375×浅深主题共36个生产浏览器状态、16个下拉菜单的展开/键盘恢复和搜索快速重开，无页面/控制台/HTTP错误。随后独立扩展视口发现会话在768—1199px重叠、团队日期控件裁切和320px隐藏文本撑高外层；最终补丁在本地7个宽度×浅深主题×两页共28态全部通过。独立报告、各轮截图与生产验证保存在 `E:/GenCode/Skynet-evidence/polish-2026-10-03/`，入口为 `REPORT.md` 和 `index.html`；前一次生产验证记录仍保留在 `production/2026-10-03T12-16-33-603Z/`，未覆盖失败或旧版本证据。

最终发布后补验团队320/414及授权接入合成会话320/768/1199/1280、浅深主题共12态全部通过，10个有内容溢出的区域实际滚轮与尾端检查通过，无外层滚动、正文重叠、日期裁切或浏览器错误。确认实际加载最终资产，并等待真实消息渲染后截图；证据为 `production-responsive/2026-10-03T12-23-25-415Z/audit.json` 与22张截图。前次误截加载态的记录标记为被后次替代，仍保留。

2026-10-03 22:49:50（北京时间）发布真实对话与工具 Trace 修订 **`v2-1dc46a1e8fb2-1`**，固定 Git `1dc46a1e8fb2b18ad62c8c2dd9b2dc12fe95ec9b`。归档为 3,737,130 bytes，SHA-256 `49955b21cb47a0a399ba03bbb4ebc60c6e47d7fba30b6489ce89044387b1ac68`；服务器源码 SHA-256 `765ba05ebf29a916b4123854edd8d0614baa68a995741d9989f85bda8c419383`；应用镜像 `sha256:0bd7a4033ff3fdf40efb7bdc8fdc6ae8178755aac82d0a2e8e5bb0bb45728c98`。实际加载资产 `index-BqQ1yFax.js` / `index-CyxpUAeW.css`。

第一次构建期间 SSH 长连接中断，确认当时未进行备份或切换，旧 app/db 仍健康。随后从同一已校验源码和 release 幂等重试，使用会自动回收的独立 systemd oneshot 持续执行；npm 安装层已在第一次中断前完成，第二次命中该缓存。未更改 Dockerfile、锁文件、镜像基线或 TLS 检查。另行准备的本地 `playwright-core` tarball 已按锁文件 SHA-512 校验，但未用于服务器构建。两次日志均保留，临时 unit 已回收。

切换前 SQL 与全部原件一致备份完成，回执 `/opt/skynet/receipts/backup-20261003T144941Z-1136175.json`，备份 ID `630cce51-1b16-4d2d-a23d-4b83cb07ac82`，包含 5 个原件对象、132,332 bytes。仅替换 app；db 容器与启动时间不变，旧 release、镜像和持久卷保留，previous 指向 `v2-745c2be6df44-1`。13 项外部 API/HTTPS 检查通过；四个既有 nginx site 哈希不变，证书续期任务 active，分析 Worker 仍未启用。

发布后独立读取用户实际快照 `03bf40a8-008d-4dfb-b091-8010372c1f2b`：默认 1 条用户消息与 2 条 Agent 消息，4 条系统/环境上下文可选展开；2 次调用与 2 条结果跨两页逐字拼回，8 条 Trace 正常读取。原件仍为 106,317 bytes，SHA-256 与采集前本机文件及升级后下载一致。浏览器验证实际最终资产，完成上下文切换、工具展开及结果锚点跳转、全部 Trace 与命令耗时/退出码检查；320/768/1199/1280 × 浅深主题共 8 态，外层滚动、双栏重叠、浏览器错误均为 0，8 个内部滚动区的滚轮与到达尾端检查通过。侧栏已移除会把环境封套误计为提示词的旧展示行。

本轮生产证据保存在 `E:/GenCode/Skynet-evidence/cli-routing-2026-10-03/`：`production-conversation.json`、`production-browser.json`；发布子目录 `deploy-v2-1dc46a1e8fb2-1` 含归档、部署日志、备份回执、`remote-verification.json` 和 `production-smoke.json`。隔离 UI 验收 45 态和移动端全展开尾部截图保存在 `conversation-2026-10-03/REPORT.md`，独立 HTTP/OAuth MCP、旧对话/统计及旧 Web 整链回归证据位于 `conversation-trace-2026-10-03/manifest.json` 与其中 `v2-public-compatibility/manifest.json`。本轮没有新增生产合成会话或额外模型调用。

2026-10-04 10:58（北京时间）发布基础指标、对话阅读、组装处理及会话洞察 **`v2-ec9b2d3bcd0b-1`**。固定 Git `ec9b2d3bcd0b7e3b52d08d75b0dd329a69d7a047`，归档 SHA-256 `9eac51ddb1a54c3cc3dd5d85826cf9d313a19325de40063f0cc88a6ac0df45d5`，服务器源码 SHA-256 `e30ffb6ede8b22fa09d2a0aaf0a392d85cbbece0062821b7d70ee7bc26840edd`，镜像 `sha256:aa112e9cc425b028548909a259304a15947922ef6817a01d485a8c12a16807ca`。页面实际资产为 `index-DFiI2I_A.js` / `index-BavFiykW.css`。

切换前一致备份完成，回执 `/opt/skynet/receipts/backup-20261004T025828Z-2082693.json`，备份 ID `457f564f-3f6f-45d6-994b-1abf62478d9a`，仍含 5 个原件对象、132,332 bytes。仅替换应用；数据库持续运行，previous 指向 `v2-1dc46a1e8fb2-1`。四个现有 nginx site 哈希不变，配置检查通过，证书续期 timer active；分析 Worker 仍未启用。

24 项外部只读检查通过：HTTPS/资产/CSP、未认证读取拒绝、权限、指标固定版本导出、v3 对话及显式 v2、Trace、组装固定版本、洞察、处理固定版本和 OAuth issuer。已有真实会话仍是 106,317 bytes，SHA-256 `0efa7692784020f5ea2dead09df32b949e722039d9d32c865ab81583971cc437`；3 条消息、2 次工具调用、8 条 Trace 保留。浏览器在 1280×720 验证处理页和真实会话的工具/Trace 展开，文档尺寸等于视口、内部区域独立滚动、无控制台错误。证据在 `E:/GenCode/Skynet-evidence/v2-2026-10-04/deploy-v2-ec9b2d3bcd0b-1/`。本轮没有新增生产测试会话或模型调用；旧数据的计时/传输观察和未运行的模型分析保持未知，完整性能仍由 #54 跟踪。

2026-10-04 12:23（北京时间）发布等待基础、用量与产出、响应等待报表和性能基础 **`v2-91544e8b1424-1`**。固定 Git `91544e8b1424ea8f260b49762a0ab401a1110f04`；归档 SHA-256 `86d1b049e32fddc39cf4c1dc28c93630dde46ad20912a4bed63571457101a556`，服务器源码 SHA-256 `1f077f2d2aa6fb240b4d6ccf3f6c2ce1dda218b3ab47eaeb376154cd31f316bf`，镜像 `sha256:9faebe1bbf6148c7377d62f744851262b39ac7650a20a9288e4d44f7a837ea9e`。实际资产为 `index-CoWAHGZm.js` / `index-1Yml5tNr.css`。

切换前一致备份回执 `/opt/skynet/receipts/backup-20261004T042255Z-2193158.json` 为 completed，备份 ID `76f2de59-971a-48f0-8ad1-836ce50d18c7`，含 5 个原件对象、132,332 bytes，SQL dump 为 141,928 bytes。app/db 健康，数据库容器保持运行，previous 为 `v2-ec9b2d3bcd0b-1`。已有四个 nginx site 哈希不变、配置检查通过、证书续期 active，分析 Worker 禁用。

34 项只读生产检查通过，增加用量、等待及等待统计的授权与固定历史导出一致性，并确认旧发布的固定指标仍可读取。真实会话原件仍为 106,317 bytes，SHA-256 `0efa7692784020f5ea2dead09df32b949e722039d9d32c865ab81583971cc437`，3 条消息、2 次工具调用、8 条 Trace 保留。浏览器实测用量、响应等待与真实对话，1280×720 文档尺寸等于视口，工具/Trace 可展开，无控制台错误。已知部分 Token 为输入 67,091、输出 700；完整计数基线仍未知，组装状态仍有缺口，未据已知小计宣称完整。证据目录 `E:/GenCode/Skynet-evidence/v2-2026-10-04/deploy-v2-91544e8b1424-1/` 包含发布/冒烟记录和页面截图。本轮没有新增生产合成会话或模型调用；AC-32 未签收。
