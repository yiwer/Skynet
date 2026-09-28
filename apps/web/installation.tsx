export function InstallationHelp() {
  return <details className="recovery"><summary>接入设备 · npm 安装说明</summary>
    <p>先安装 Node 24 和需要使用的 Agent，并确认可以下载管理员提供的本部署 npm 包、在当前用户目录写配置及运行后台。包已包含平台地址，只需要个人接入 Key。</p>
    <ol><li>安装内部发行物：<code>npm install -g --ignore-scripts ./skynet-agent-0.1.0.tgz</code>。当前没有公开 npm 发行包。</li>
      <li>在本地终端设置 <code>SKYNET_KEY</code>，执行 <code>skynet setup</code>。不要把 Key 发到 Agent 对话或填写到项目文件。</li>
      <li>Codex 按 <code>/hooks</code> 正常审查确切命令；Claude 按正常流程信任工作目录。必要时重启宿主，再照常使用 Agent。</li>
      <li>执行 <code>skynet status</code>：分别检查配置、待信任、后台、服务器往返、首次会话事件与已确认上传。健康检查不会生成工作会话。</li></ol>
    <p>当前接入实现只启动本次登录会话的后台；登录自启、完整生命周期与 Desktop 界面仍待验收。Windows、WSL、SSH 和容器各自登记，未继续的旧会话不会批量导入。</p>
  </details>;
}
