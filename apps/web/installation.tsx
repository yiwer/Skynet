export function InstallationHelp() {
  return <details className="recovery"><summary>接入设备 · npm / 插件安装说明</summary>
    <p>先安装 Node 24 和需要使用的 Agent，并确认可以下载管理员提供的本部署 npm 包、在当前用户目录写配置及运行后台。包已包含平台地址，只需要个人接入 Key。</p>
    <ol><li>安装内部发行物：<code>npm install -g --ignore-scripts ./skynet-agent-0.1.0.tgz</code>。当前没有公开 npm 发行包。</li>
      <li>在本地终端设置 <code>SKYNET_KEY</code>，执行 <code>skynet setup</code>。不要把 Key 发到 Agent 对话或填写到项目文件。</li>
      <li>Codex 按 <code>/hooks</code> 正常审查确切命令；Claude 按正常流程信任工作目录。必要时重启宿主，再照常使用 Agent。</li>
      <li>执行 <code>skynet status</code>：分别检查配置、待信任、后台、服务器往返、首次会话事件与已确认上传。健康检查不会生成工作会话。</li></ol>
    <p>也可从管理员提供的内部 marketplace 安装插件：Codex CLI 使用 <code>plugin marketplace add</code> 和 <code>plugin add</code>；Claude 使用 <code>plugin marketplace add --scope user</code> 和 <code>plugin install --scope user</code>。当前插件同样要求 Node 24。</p>
    <p>安装后调用插件的 <code>skynet-setup</code> 导航，在本地终端设置同一个 <code>SKYNET_KEY</code>，运行随包的 <code>node "插件路径/scripts/skynet.cjs" setup</code>，然后清除变量。插件、npm 共用身份与后台；稳定采集不依赖插件缓存。</p>
    <p>只移除一个入口，先运行 <code>node "插件路径/scripts/skynet.cjs" entry-remove --entry codex-plugin</code>（Claude 使用 <code>claude-plugin</code>），再按宿主正常流程卸载插件。仅在市场点击卸载没有可靠回调，仍需此本地退出步骤；其他入口和已冻结的待确认材料保留。</p>
    <p>修复接入执行 <code>skynet repair</code>；升级先取得本部署较新发行包，再从新包执行 <code>skynet upgrade</code>。中断后 repair 回退上一可运行版本，保留设备身份和未确认材料；已成功升级也可执行 <code>skynet rollback</code>。命令只修改确切自有设置，宿主信任仍按正常流程完成。</p>
    <p>完整停用先执行 <code>skynet uninstall</code>，再移除 npm 或市场包。自有 hooks、登录任务及后台停止，服务器存档与本地私有身份、冻结队列、恢复工具保留。联网后用保留的稳定 launcher 执行 <code>drain</code> 只补传冻结材料并停止后台。尚未冻结的 hook 事件仍保留而不读取原件，补传完成不代表所有活动已存档；重新 setup 才继续采集。确认冻结材料补传并处理这些未采集范围后，再人工处理状态目录。状态目录和 launcher 位置由 status 显示。</p>
    <p>Windows 已实现当前用户登录任务，实际登录、重启、休眠、完整升级卸载及 Desktop 界面仍待验收；其他 OS 自启目前降级为当前会话后台。Windows、WSL、SSH 和容器各自登记，未继续的旧会话不会批量导入。</p>
  </details>;
}
