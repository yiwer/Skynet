# #26：在 Claude / Codex 中授权读取存档

对应 [Issue #26](https://github.com/yiwer/Skynet/issues/26)、AC-16 / AC-17。2026-09-28，Windows x64、Node 24.12.0。

本票打通个人读取身份授权 → HTTPS MCP → 会话分页 → 原文与证据 → 完整导出。使用官方 `@modelcontextprotocol/sdk` 1.30.1 的 Streamable HTTP；Web / MCP 共用 `archive-query.ts`，关联材料与恢复包沿用 #9 的 v2 契约。未完成的日周报告、全文搜索和 G0—G4 不由此票宣告通过。

## 部署与连接

Compose 已通过 Caddy 的 HTTPS 主机设置 `SKYNET_PUBLIC_ORIGIN=https://${SKYNET_HOST}`。直接启动服务时，设置公开 HTTPS origin（无尾斜杠），由可信反向代理终止 TLS；不要把内部 HTTP 端口公开给用户。未设置该值时 MCP 与授权端点不启用，已有采集与 Web 不依赖 MCP 登录。

用部署地址替换以下 `https://skynet.example`。在员工自己的正常终端操作；授权页使用个人**读取凭据**，不是接入 Key 或设备凭据。

```powershell
claude mcp add --transport http --scope user skynet_archive https://skynet.example/mcp
claude mcp login --no-browser skynet_archive

codex mcp add skynet_archive --url https://skynet.example/mcp
codex mcp login --no-browser --oauth-client-registration dcr skynet_archive
```

打开客户端给出的授权 URL，核对其自行声明的名称、回调地址及“全体员工全部项目”的读取范围，输入个人读取凭据并点击“授权读取”。headless 模式按客户端提示粘贴回调 URL。Claude 2.1.281 要求真实终端；普通 pipe 不能代替。Codex 测试环境按其官方提示使用 `--no-daemon`，不改变 sandbox 或伪造信任。

## 授权边界

- `/mcp` 的 401 challenge 指向 `/.well-known/oauth-protected-resource/mcp`；授权服务器发现、DCR、授权码、轮换 refresh 与 revoke 端点均位于同一 HTTPS origin。
- 仅 `archive:read`。PKCE 必须是 S256；授权与 token 请求必须绑定 `/mcp` resource、登记 client、精确 redirect。仅接受 HTTPS 或本机 HTTP 回调。不获取任意远程 client metadata；CIMD 明确未启用。
- 表单请求使用独立一次性 request、Secure / HttpOnly / SameSite cookie 和精确 Origin 检查；可明确取消。名称按不可信文本转义。授权页使用 `same-origin` referrer policy，否则浏览器表单会把 Origin 变成 `null`。
- 授权页 10 分钟、授权码 2 分钟、access token 15 分钟、授权 / refresh 最长 30 天。码单次使用；refresh 每次轮换，重用旧 refresh 会撤销整次授权。数据库保存 token / code 哈希。账号 active 状态在每次 MCP 请求和下载时重查，包括命中查询缓存时。
- 个人 Web、设备、接入及 MCP 凭据彼此独立。设备停用不替代个人账号停用；禁用账号立即拒绝已有 MCP token，历史原件保留。
- OAuth 请求每个直接网络对端、每路由每分钟最多 60 次；DCR 最多 10,000 个登记，待授权记录最多约 5,000 个。过期临时记录清理，90 天且没有授权引用的 client 可清理。默认不信任伪造的 forwarded IP。容量达到限制时返回显式错误，不改动上传资格。

## 共享查询与完整性

| 工具 | 返回与后续读取 |
| --- | --- |
| `list_sessions` | 已提交会话的不可变 snapshot ID；1–10 条及约 8 KiB 预算；`nextCursor` 固定查询上界，使用 PostgreSQL 精确时间和 ID 排序 |
| `read_snapshot` | 原件行号、Claude block、来源时间 / 日期、历史上下文归类；每页最多 2,048 UTF-16 单元、25 条，`next` 继续大工具输出 |
| `read_manifest` | 完整清单 JSON 文本分页，包括所有材料、缺口和谱系；拼接 text 后解析；不把大清单混入每页原文 |
| `read_material` | 按清单 material ID 分页；文本为 UTF-8 解码内容、binary 为 base64；显式 `associated-context-only` |
| `prepare_export` | 完整原件 / 可读材料 / v1 或 v2 恢复包的文件名、长度、SHA-256、需 MCP token 的下载路径 |
| `read_export` | 每页 4,096 原始字节的 base64；按 `nextOffset` 拼接解码后核验长度和 SHA-256；最后一页明确返回 null |

所有文字 offset 都是 UTF-16 单元；服务返回的边界不切开 surrogate pair。下载 URL 不包含凭据，匿名、Web token 与设备 token 都不能用 MCP 下载端点。Web 保留原有全文 / 恢复下载，新增相同原文页和完整清单页；列表可继续加载，不止固定前 100 条。

原文响应只重复简短恢复与活动状态。完整关联材料 / 缺口 / 谱系使用 `read_manifest`，每日详细分组沿用 Web 详情；未来报告工具另行实现。工具单次序列化结果上限 96 KiB，入站 JSON 上限 64 KiB。极端元数据超限会给出明确错误，不静默删内容；完整导出仍可分片读取。

派生查询缓存按不可变 snapshot ID 区分，活动缓存另含北京时间日期；5 分钟过期。证据预算估计 192 MiB，导出与关联材料预算 256 MiB，各自只运行一个新的重计算，最多另有 8 个不同查询排队，重复同项请求合并。等待项尚未读取或解析原件，超过等待容量才明确返回 503；失败释放执行位置，后续请求继续处理。缓存不保存认证结果，不产生原件 ACK，重启即可丢弃；上传保持自身路径。这里是缓存预算而非进程 RSS 承诺，解析 / 序列化存在临时内存；完整规模和故障性能仍归 #33 验收。

## 可复现验证

```powershell
npm ci
npm run typecheck
npm run build
npm test

# 指向明确安装的测试版本；NODE_PTY_ROOT 是独立、仅测试使用的 node-pty 安装目录。
$env:SKYNET_CODEX_CLI = 'C:/path/to/codex.exe'
$env:SKYNET_CLAUDE_RUNTIME = 'C:/path/to/claude.exe'
$env:SKYNET_NODE_PTY_ROOT = 'C:/path/to/test-pty-harness'
npm run test:mcp-native
```

测试创建自己的 PostgreSQL 容器、原件、身份、临时 CA、HTTPS 代理和 CLI 配置目录；不读取员工会话或修改现有客户端配置。Windows 使用 Git 自带 OpenSSL；可通过 `SKYNET_OPENSSL` 指定，Linux 使用 `openssl`。

公开 API / SDK / Playwright 流程覆盖：匿名及错用凭据、发现、DCR 地址限制、个人授权 / 取消 / CSRF、错误 PKCE / redirect / scope / resource / client、码重放、重启后 token、refresh 轮换和重用撤销、账号停用、响应大小、缓存后撤销、会话稳定分页、49 页大原文、100 项缺口、binary 关联材料、三种完整导出及授权失败后仍可上传。8 条普通产品测试全部通过，包括 #4–#9、#20 的回归；证据目录 `skynet-test-kk0Qs3`（本次公开 MCP 流程）。

真实客户端：Codex CLI **0.157.1** 与 Claude Code **2.1.281** 均通过正常 HTTPS DCR / PKCE 授权。每个客户端实际调用 17 次产品 MCP 工具，读取两个列表页、含中文和 emoji 的大工具输出全部文字、准备恢复包，并分片获取 raw 原件，重组 SHA-256 与 Web 一致。最近证据：`%TEMP%/skynet-test-aJnHmH/native-mcp-evidence.json`；后续复跑生成独立目录。模型为确定性 loopback 服务，未调用付费服务。

与 #11 安装及 #16 离线队列合入公共分支后，再次通过 `npm ci`、typecheck、build 和全部 **11** 个普通测试。整合保留设备健康 nonce、交付报告与设备同步页面，以及共享查询详情的 device ID；MCP 公开流程证据为 `%TEMP%/skynet-test-QJP7en`，离线交付为 `%TEMP%/skynet-test-3jB075`，安装为 `%TEMP%/skynet-test-xuapbR`。此次合并未改动原生客户端 MCP 协议实现，因此原生实测沿用上述分支证据；不把普通回归当作新的原生验收。

实测发现宿主会在把较大工具结果交给模型时再截断，因此采用小页，并检查**模型实际收到的结果**，不只检查服务器响应。原生 CLI 自行完成真实 HTTPS 握手，仅在其测试进程显式信任临时 CA；未关闭 TLS 校验，未更改 Windows / 浏览器全局证书库。普通进程请求该 CA 会失败。授权页由 Playwright 操作，页面请求使用仅允许本测试 origin、严格校验 CA 和主机名的 HTTPS transport adapter，收到产品 303 后把回调交回正常 headless CLI；这不是浏览器原生证书库或公网域名部署验收。

## 尚待整体验收

公网 / 内网实际域名证书、目标环境浏览器原生信任、其他客户端版本 / OS、真实正常用户 Desktop、真实分析和五工作日试点仍待验证。refresh 轮换通过公开 token API 验证，尚未让两个原生客户端各等待 15 分钟再验证自动刷新。不得把本票两 CLI 的合成模型 MCP 成功等同 G0—G4 或整个 V1 完成。

协议依据：[MCP authorization 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)、[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[官方 TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。实现选择 DCR 和同域授权服务器；原生版本能力以上述实际测试为准。
