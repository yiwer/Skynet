/* PROTOTYPE — 示例数据（合成），不连接真实服务，不包含任何真实员工材料。
 * 结构按 PRD v1.0 的语义组织：未知 ≠ 0、并发区间不相加、证据分为 已观察 / 声称 / 推断 / 材料不足。
 * 当前时刻固定为 2026-09-24（周四）14:05 北京时间。
 */
window.SKY = (() => {
  const ev = (k, s, e, t, who) => ({ k, s, e, t, who });
  const OBS = (s, e, t) => ev('obs', s, e, t);
  const SAY = (s, e, t, who = 'user') => ev('claim', s, e, t, who);
  const INF = (t) => ev('infer', null, null, t);
  const GAP = (t, s, e) => ev('gap', s || null, e || null, t);

  const projects = {
    'billing-service': { name: '计费服务', repo: 'git.corp/pay/billing-service', tone: 'blue' },
    'ops-console':     { name: '运维控制台', repo: 'git.corp/sre/ops-console', tone: 'lime' },
    'data-pipeline':   { name: '数据管道', repo: 'git.corp/data/pipeline', tone: 'lavender' },
    'mobile-app':      { name: '移动端', repo: 'git.corp/app/mobile', tone: 'teal' },
    'infra':           { name: '基础设施', repo: 'git.corp/sre/infra-terraform', tone: 'orange' },
    'unclassified':    { name: '未归类', repo: '无法可靠识别的工作目录', tone: 'slate' }
  };

  const clientStages = ['已安装', '待信任', '后台运行', '首次采集', '已上传'];

  const members = [
    { id: 'lin-yue', name: '林悦', initial: '林', role: '后端工程师', tone: 'blue', joined: '2026-09-14',
      devices: [
        { id: 'd-lin-mbp', name: '林悦的 MacBook Pro', env: 'macOS 15.6 · arm64', bg: 'launchd 用户代理 · 运行中', lastSync: '14:02', backlog: '0',
          clients: [{ c: 'Claude Code CLI', stage: 5 }, { c: 'Codex CLI', stage: 5 }] },
        { id: 'd-lin-dev', name: 'dev-bj-07（远程开发机）', env: 'Ubuntu 24.04 · x86_64 · SSH', bg: 'systemd --user · 运行中', lastSync: '11:50', backlog: '0',
          clients: [{ c: 'Claude Code CLI', stage: 5 }, { c: 'Codex CLI', stage: 5 }] }
      ] },
    { id: 'zhou-qihang', name: '周启航', initial: '周', role: '前端工程师', tone: 'lime', joined: '2026-09-14',
      devices: [
        { id: 'd-zhou-win', name: 'ZHOU-LAPTOP', env: 'Windows 11 24H2 · x64', bg: '计划任务（当前用户）· 运行中', lastSync: '13:58', backlog: '0',
          clients: [{ c: 'Codex Desktop', stage: 5 }, { c: 'Claude Code CLI', stage: 5 }] }
      ] },
    { id: 'chen-mu', name: '陈牧', initial: '陈', role: '数据工程师', tone: 'lavender', joined: '2026-09-15',
      devices: [
        { id: 'd-chen-mba', name: '陈牧的 MacBook Air', env: 'macOS 15.6 · arm64', bg: 'launchd 用户代理 · 运行中', lastSync: '13:40', backlog: '0',
          clients: [{ c: 'Claude Code CLI', stage: 5 }, { c: 'Codex CLI', stage: 5 }] }
      ] },
    { id: 'xu-ruoxi', name: '许若溪', initial: '许', role: '移动端工程师', tone: 'teal', joined: '2026-09-14',
      devices: [
        { id: 'd-xu-mbp', name: '许若溪的 MacBook Pro', env: 'macOS 15.5 · arm64', bg: '离线 · 最近心跳 12:31', lastSync: '12:31', backlog: '未知（离线中）', offline: true,
          diag: '设备自 12:31 起未上报心跳。离线期间的材料保存在本机队列，恢复连接后自动补传；平台不据此推断工作情况。',
          clients: [{ c: 'Codex Desktop', stage: 5 }, { c: 'Claude Code CLI', stage: 5 }] }
      ] },
    { id: 'zhao-yiming', name: '赵一鸣', initial: '赵', role: '全栈工程师', tone: 'orange', joined: '2026-09-21',
      devices: [
        { id: 'd-zhao-win', name: 'ZHAO-DESKTOP', env: 'Windows 11 · x64', bg: '计划任务（当前用户）· 运行中', lastSync: '—', backlog: '0',
          diag: 'Codex Desktop 已安装 Skynet 插件，但尚未在 Codex Desktop 的插件设置中确认信任。确认后重启 Codex Desktop，状态会变为「后台运行」。',
          clients: [{ c: 'Codex Desktop', stage: 1, issue: 'trust' }] },
        { id: 'd-zhao-wsl', name: 'ZHAO-DESKTOP · WSL', env: 'Ubuntu 22.04（WSL2，独立登记）', bg: 'systemd --user · 运行中', lastSync: '13:45', backlog: '0',
          clients: [{ c: 'Claude Code CLI', stage: 5 }] }
      ] },
    { id: 'han-qiu', name: '韩秋', initial: '韩', role: '平台工程师', tone: 'slate', joined: '2026-09-14',
      devices: [
        { id: 'd-han-ws', name: 'han-ws（工作站）', env: 'Fedora 40 · x86_64', bg: 'systemd --user · 运行中', lastSync: '13:20', backlog: '0',
          diag: '今日 11:30–12:10 本地磁盘空间不足，期间新增材料未能暂存，已登记为采集缺口。12:10 空间恢复后采集正常，编码未被阻止。',
          clients: [{ c: 'Codex CLI', stage: 5 }, { c: 'Claude Code CLI', stage: 5, issue: 'gap' }] }
      ] }
  ];

  const week = {
    id: 'W39', label: '第 39 周', range: '9月21日—27日',
    days: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']
  };

  const themes = {
    't-refund':   { title: '退款对账差异修复', project: 'billing-service', owner: 'lin-yue', days: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'], sessions: ['s-4410', 's-5d21', 's-7f3a', 's-81c2', 's-9a14'], status: 'blocked',
                    brief: '9 月退款金额与渠道账单不一致。已定位为按 UTC 取结算日导致跨日计入，修复与回归测试已完成；端到端核对等待渠道沙箱权限。' },
    't-invoice':  { title: '发票 PDF 生成超时', project: 'billing-service', owner: 'lin-yue', days: ['2026-09-21'], sessions: ['s-3b07'], status: 'done',
                    brief: '批量开票时 PDF 渲染超时。改为复用字体缓存后，会话内压测显示单张耗时下降。' },
    't-dark':     { title: '暗色模式对比度修复', project: 'ops-console', owner: 'zhou-qihang', days: ['2026-09-21'], sessions: ['s-c311'], status: 'done',
                    brief: '修正告警列表在暗色模式下的文字对比度，并更新快照测试。' },
    't-alert':    { title: '告警规则编辑器重构', project: 'ops-console', owner: 'zhou-qihang', days: ['2026-09-22', '2026-09-23', '2026-09-24'], sessions: ['s-c402', 's-c517', 's-c523', 's-c530', 's-c601'], status: 'active',
                    brief: '把旧的告警规则表单迁移为 React 组件，拆分编辑器并补充组件用例。' },
    't-backfill': { title: '每日指标回填脚本', project: 'data-pipeline', owner: 'chen-mu', days: ['2026-09-21'], sessions: ['s-2d01'], status: 'done',
                    brief: '为缺失日期补跑指标聚合，增加幂等检查。' },
    't-kafka':    { title: 'Kafka 消费延迟排查', project: 'data-pipeline', owner: 'chen-mu', days: ['2026-09-23', '2026-09-24'], sessions: ['s-2c90', 's-2e11'], status: 'active', oldContext: '2026-09-02',
                    brief: '继续 9月2日开始的旧会话，排查夜间批处理期间 consumer lag 飙升。' },
    't-push':     { title: 'iOS 推送证书迁移到 p8 密钥', project: 'mobile-app', owner: 'xu-ruoxi', days: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'], sessions: ['s-x101', 's-x118', 's-x120', 's-x131', 's-x140'], status: 'blocked',
                    brief: '服务端 p8 签名与测试推送已完成，正式切换等待开发者账号管理员授权。' },
    't-export':   { title: '订单导出接口分页改造', project: 'billing-service', owner: 'zhao-yiming', days: ['2026-09-22', '2026-09-23', '2026-09-24'], sessions: ['s-z081', 's-z090', 's-z095'], status: 'active',
                    brief: '把大账户订单导出从 offset 分页改为游标分页，避免超时。' },
    't-regex':    { title: '临时目录中的正则调试', project: 'unclassified', owner: 'zhao-yiming', days: ['2026-09-21'], sessions: ['s-z077'], status: 'done',
                    brief: '在 ~/tmp 下调试日志解析正则，工作目录无法对应到已知项目。' },
    't-tf':       { title: 'Terraform 模块升级到 1.9', project: 'infra', owner: 'han-qiu', days: ['2026-09-21', '2026-09-22', '2026-09-24'], sessions: ['s-h201', 's-h210', 's-h230'], status: 'active',
                    brief: '升级基础设施模块的 provider 版本约束，逐个环境执行 plan 并记录差异。' }
  };

  // Stats: null = 未知（不当 0）。intervals = 事件活跃区间，并发不相加。
  const day = (o) => Object.assign({ state: 'active', flags: [], themes: [], stats: null, report: null }, o);

  const days = {
    'lin-yue': {
      '2026-09-21': day({ themes: [{ id: 't-refund', sessions: 1 }, { id: 't-invoice', sessions: 1 }], stats: { sessions: 2, turns: 14, tools: 63, files: 8, tin: 1.1e6, tout: 8.2e4, unknownTokens: 0, intervals: [['10:02', '12:15', 's-4410'], ['15:30', '17:05', 's-3b07']] }, report: { v: 1, at: '9月22日 09:02', status: 'ready' },
        summary: '确认退款差异集中在跨日时段；另将发票 PDF 生成改为复用字体缓存。' }),
      '2026-09-22': day({ themes: [{ id: 't-refund', sessions: 1 }], stats: { sessions: 1, turns: 9, tools: 41, files: 5, tin: 0.74e6, tout: 5.1e4, unknownTokens: 0, intervals: [['09:40', '12:02', 's-5d21']] }, report: { v: 1, at: '9月23日 09:03', status: 'ready' },
        summary: '用 9 月前两周的渠道账单复现了退款差异，差异条目全部落在北京时间 0–8 点。' }),
      '2026-09-23': day({ flags: ['blocked', 'corrected'], themes: [{ id: 't-refund', sessions: 2, blocked: true }], stats: { sessions: 2, turns: 11, tools: 58, files: 9, tin: 1.42e6, tout: 9.6e4, unknownTokens: 0, intervals: [['09:12', '11:48', 's-7f3a'], ['14:20', '16:05', 's-81c2']] }, report: { v: 2, at: '9月24日 10:41', status: 'ready' },
        summary: '定位到退款对账差异来自按 UTC 取结算日，已修复并补齐回归测试；端到端核对受渠道沙箱权限阻塞。' }),
      '2026-09-24': day({ state: 'today', themes: [{ id: 't-refund', sessions: 1, live: true }], stats: { sessions: 1, turns: 4, tools: 17, files: 2, tin: 0.21e6, tout: 1.2e4, unknownTokens: 0, intervals: [['09:30', '14:05', 's-9a14', true]] }, report: { status: 'scheduled', at: '9月25日 09:00' } })
    },
    'zhou-qihang': {
      '2026-09-21': day({ themes: [{ id: 't-dark', sessions: 1 }], stats: { sessions: 1, turns: 6, tools: 22, files: 7, tin: 0.4e6, tout: 3.0e4, unknownTokens: 0, intervals: [['14:00', '16:10', 's-c311']] }, report: { v: 1, at: '9月22日 09:02', status: 'ready' },
        summary: '修正告警列表在暗色模式下的文字对比度，并更新了快照测试。' }),
      '2026-09-22': day({ flags: ['corrected'], themes: [{ id: 't-alert', sessions: 1 }], stats: { sessions: 1, turns: 12, tools: 57, files: 11, tin: null, tout: null, unknownTokens: 1, intervals: [['10:20', '17:40', 's-c402']] }, report: { v: 2, at: '9月23日 17:52', status: 'ready' },
        summary: '拆分告警规则编辑器，确定 5 个子组件的边界。' }),
      '2026-09-23': day({ flags: ['analysis-failed'], themes: [{ id: 't-alert', sessions: 3, pending: true }], stats: { sessions: 3, turns: 24, tools: 131, files: 22, tin: 0.62e6, tout: 4.4e4, unknownTokens: 1, intervals: [['09:05', '12:10', 's-c517'], ['13:30', '15:10', 's-c523'], ['11:40', '12:30', 's-c530']] }, report: { status: 'failed', at: '9月24日 09:00', error: '模型请求超时（120 s）', retry: '已自动重试 1/3 · 下次 14:30' } }),
      '2026-09-24': day({ state: 'today', themes: [{ id: 't-alert', sessions: 1, live: true }], stats: { sessions: 1, turns: 6, tools: 28, files: 5, tin: null, tout: null, unknownTokens: 1, intervals: [['10:10', '12:00', 's-c601']] }, report: { status: 'scheduled', at: '9月25日 09:00' } })
    },
    'chen-mu': {
      '2026-09-21': day({ themes: [{ id: 't-backfill', sessions: 1 }], stats: { sessions: 1, turns: 5, tools: 19, files: 3, tin: 0.18e6, tout: 1.1e4, unknownTokens: 0, intervals: [['16:00', '17:20', 's-2d01']] }, report: { v: 1, at: '9月22日 09:02', status: 'ready' },
        summary: '为缺失日期补跑指标聚合，并增加了幂等检查。' }),
      '2026-09-22': day({ state: 'none', stats: { sessions: 0, turns: 0, tools: 0, files: 0, tin: 0, tout: 0, unknownTokens: 0, intervals: [] }, report: { status: 'none' }, heartbeat: '18:30' }),
      '2026-09-23': day({ flags: ['old-context'], themes: [{ id: 't-kafka', sessions: 1 }], stats: { sessions: 1, turns: 7, tools: 26, files: 4, tin: 0.31e6, tout: 2.2e4, unknownTokens: 0, intervals: [['10:15', '12:40', 's-2c90']] }, report: { v: 1, at: '9月24日 09:04', status: 'ready' },
        summary: '继续 9月2日的旧会话排查 Kafka 夜间消费延迟，调整拉取参数后本地压测的延迟峰值明显下降。' }),
      '2026-09-24': day({ state: 'today', themes: [{ id: 't-kafka', sessions: 1, live: true }], stats: { sessions: 1, turns: 2, tools: 5, files: 1, tin: 0.04e6, tout: 0.3e4, unknownTokens: 0, intervals: [['13:20', '14:05', 's-2e11', true]] }, report: { status: 'scheduled', at: '9月25日 09:00' } })
    },
    'xu-ruoxi': {
      '2026-09-21': day({ themes: [{ id: 't-push', sessions: 1 }], stats: { sessions: 1, turns: 8, tools: 30, files: 4, tin: null, tout: null, unknownTokens: 1, intervals: [['10:00', '12:20', 's-x101']] }, report: { v: 1, at: '9月22日 09:02', status: 'ready' },
        summary: '梳理 p12 证书与 p8 密钥的差异，列出迁移步骤。' }),
      '2026-09-22': day({ flags: ['late-data'], themes: [{ id: 't-push', sessions: 2 }], stats: { sessions: 2, turns: 13, tools: 44, files: 6, tin: 0.26e6, tout: 1.9e4, unknownTokens: 1, intervals: [['13:10', '16:38', 's-x118'], ['15:00', '16:40', 's-x120']] }, report: { v: 2, at: '9月23日 10:41', status: 'ready', late: '16:40 起设备离线，2 个会话于 9月23日 10:20 补传，日报重新生成为 v2（v1 仅含 13:10 前材料）' },
        summary: '完成 p8 密钥的 JWT 签名配置；离线前的最后两段会话已补传并计入当日。' }),
      '2026-09-23': day({ flags: ['blocked'], themes: [{ id: 't-push', sessions: 1, blocked: true }], stats: { sessions: 1, turns: 9, tools: 33, files: 6, tin: null, tout: null, unknownTokens: 1, intervals: [['10:30', '15:45', 's-x131']] }, report: { v: 1, at: '9月24日 09:03', status: 'ready' },
        summary: '服务端 p8 推送配置与测试推送脚本已完成；正式切换等待开发者账号管理员授权。' }),
      '2026-09-24': day({ state: 'today', flags: ['offline'], themes: [{ id: 't-push', sessions: 1 }], stats: { sessions: 1, turns: 5, tools: 21, files: 3, tin: null, tout: null, unknownTokens: 1, intervals: [['10:00', '12:30', 's-x140']] }, report: { status: 'scheduled', at: '9月25日 09:00' }, offlineSince: '12:31' })
    },
    'zhao-yiming': {
      '2026-09-21': day({ flags: ['trust-pending'], themes: [{ id: 't-regex', sessions: 1 }], stats: { sessions: 1, turns: 3, tools: 9, files: 1, tin: 0.05e6, tout: 0.4e4, unknownTokens: 0, intervals: [['16:30', '17:05', 's-z077']] }, report: { v: 1, at: '9月22日 09:02', status: 'ready' },
        summary: '在临时目录调试日志解析正则（未归类项目）。覆盖不完整：Codex Desktop 待信任。' }),
      '2026-09-22': day({ flags: ['trust-pending'], themes: [{ id: 't-export', sessions: 1 }], stats: { sessions: 1, turns: 6, tools: 24, files: 4, tin: 0.19e6, tout: 1.3e4, unknownTokens: 0, intervals: [['10:05', '12:30', 's-z081']] }, report: { v: 1, at: '9月23日 09:03', status: 'ready' },
        summary: '分析大账户订单导出超时的原因，确定改用游标分页。覆盖不完整：Codex Desktop 待信任。' }),
      '2026-09-23': day({ flags: ['trust-pending'], themes: [{ id: 't-export', sessions: 1 }], stats: { sessions: 1, turns: 5, tools: 19, files: 3, tin: 0.21e6, tout: 1.5e4, unknownTokens: 0, intervals: [['13:10', '15:20', 's-z090']] }, report: { v: 1, at: '9月24日 09:03', status: 'ready' },
        summary: '将订单导出接口改为游标分页，并补充了大账户导出的集成测试。' }),
      '2026-09-24': day({ state: 'today', flags: ['trust-pending'], themes: [{ id: 't-export', sessions: 1, live: true }], stats: { sessions: 1, turns: 3, tools: 12, files: 2, tin: 0.08e6, tout: 0.6e4, unknownTokens: 0, intervals: [['09:40', '14:05', 's-z095', true]] }, report: { status: 'scheduled', at: '9月25日 09:00' } })
    },
    'han-qiu': {
      '2026-09-21': day({ themes: [{ id: 't-tf', sessions: 1 }], stats: { sessions: 1, turns: 7, tools: 35, files: 6, tin: 0.33e6, tout: 2.4e4, unknownTokens: 0, intervals: [['09:30', '12:00', 's-h201']] }, report: { v: 1, at: '9月22日 09:02', status: 'ready' },
        summary: '升级 provider 版本约束，完成 staging 环境的 plan 并记录差异。' }),
      '2026-09-22': day({ themes: [{ id: 't-tf', sessions: 1 }], stats: { sessions: 1, turns: 10, tools: 48, files: 9, tin: 0.52e6, tout: 3.6e4, unknownTokens: 0, intervals: [['14:00', '18:10', 's-h210']] }, report: { v: 1, at: '9月23日 09:03', status: 'ready' },
        summary: '在 prod-cn 环境执行 plan，发现 2 处需要手工迁移的状态。' }),
      '2026-09-23': day({ state: 'none', stats: { sessions: 0, turns: 0, tools: 0, files: 0, tin: 0, tout: 0, unknownTokens: 0, intervals: [] }, report: { status: 'none' }, heartbeat: '18:00' }),
      '2026-09-24': day({ state: 'today', flags: ['gap'], themes: [{ id: 't-tf', sessions: 1, live: true }], stats: { sessions: 1, turns: 4, tools: 16, files: 3, tin: 0.12e6, tout: 0.9e4, unknownTokens: 0, intervals: [['09:50', '14:05', 's-h230', true]] }, report: { status: 'scheduled', at: '9月25日 09:00' }, gap: '11:30–12:10 本地磁盘空间不足' })
    }
  };

  // 日报正文（工作主题 → 目标/行动/结果/阻塞/待继续）。v 字段对应报告版本。
  const reports = {
    'lin-yue|2026-09-23': {
      versions: [
        { v: 2, at: '9月24日 10:41', why: '分析更正后重算：会话 s-81c2 归入本主题；追加说明', by: '王清 的更正' },
        { v: 1, at: '9月24日 09:03', why: '定时生成（北京时间 09:00 触发）', by: '系统' }
      ],
      evidence: { obs: 6, claim: 3, infer: 1, gap: 1 },
      body: {
        2: [{ theme: 't-refund', sessions: ['s-7f3a', 's-81c2'],
          goal: [{ t: '查明 9 月退款金额与渠道账单不一致的原因，先不改代码。', ev: [SAY('s-7f3a', 1, '用户开场说明')] }],
          action: [
            { t: '确认结算日直接取 UTC 日期：北京时间 0–8 点的退款被计入前一天。', ev: [OBS('s-7f3a', 7, 'grep 命中 3 处 ts.date()'), SAY('s-7f3a', 9, 'Agent 结论', 'agent')] },
            { t: '改为按 Asia/Shanghai 取结算日，并新增 3 个跨日退款用例。', ev: [OBS('s-7f3a', 21, '编辑 refund_reconcile.py'), OBS('s-7f3a', 24, '新增 test_timezone.py')] },
            { t: '在远程开发机回放 9 月退款数据，逐条对比差异。', ev: [OBS('s-81c2', 33, 'replay_refunds.py 输出')], added: true }
          ],
          result: [
            { t: '退款对账单元测试 38 项通过。', ev: [OBS('s-7f3a', 142, 'pytest · 38 passed')] },
            { t: '回放后差异条目由 217 条降为 0 条。', ev: [OBS('s-81c2', 35, 'diff 结果为空')], added: true },
            { t: 'Agent 称“已在预发环境验证一致”，会话中没有对应的工具结果。', ev: [SAY('s-7f3a', 150, 'Agent 自述 · 无工具结果佐证', 'agent')], unverified: true }
          ],
          block: [{ t: '缺少渠道沙箱对账文件的读取权限，无法做端到端核对。', ev: [SAY('s-7f3a', 152, '用户说明')] }],
          next: [{ t: '取得沙箱权限后运行端到端对账。', ev: [INF('由阻塞推断')], note: { by: '王清', at: '9月24日 10:12', t: '沙箱权限已于 9月24日 提交申请。' } }],
          gaps: [{ t: '会话引用了一张渠道后台截图，本地记录未保存图片原件（上游未提供）。', ev: [GAP('#58–#61 附件不可得', 's-7f3a', 58)] }]
        }],
        1: [{ theme: 't-refund', sessions: ['s-7f3a'],
          goal: [{ t: '查明 9 月退款金额与渠道账单不一致的原因，先不改代码。', ev: [SAY('s-7f3a', 1, '用户开场说明')] }],
          action: [
            { t: '确认结算日直接取 UTC 日期：北京时间 0–8 点的退款被计入前一天。', ev: [OBS('s-7f3a', 7, 'grep 命中 3 处 ts.date()'), SAY('s-7f3a', 9, 'Agent 结论', 'agent')] },
            { t: '改为按 Asia/Shanghai 取结算日，并新增 3 个跨日退款用例。', ev: [OBS('s-7f3a', 21, '编辑 refund_reconcile.py'), OBS('s-7f3a', 24, '新增 test_timezone.py')] }
          ],
          result: [
            { t: '退款对账单元测试 38 项通过。', ev: [OBS('s-7f3a', 142, 'pytest · 38 passed')] },
            { t: 'Agent 称“已在预发环境验证一致”，会话中没有对应的工具结果。', ev: [SAY('s-7f3a', 150, 'Agent 自述 · 无工具结果佐证', 'agent')], unverified: true }
          ],
          block: [{ t: '缺少渠道沙箱对账文件的读取权限，无法做端到端核对。', ev: [SAY('s-7f3a', 152, '用户说明')] }],
          next: [{ t: '取得沙箱权限后运行端到端对账。', ev: [INF('由阻塞推断')] }],
          gaps: [{ t: '会话引用了一张渠道后台截图，本地记录未保存图片原件（上游未提供）。', ev: [GAP('#58–#61 附件不可得', 's-7f3a', 58)] }]
        }, { theme: 'unclassified', sessions: ['s-81c2'], unclassified: true,
          goal: [], action: [{ t: '在远程开发机回放 9 月退款数据（工作目录 /srv/scratch 无法对应到项目）。', ev: [OBS('s-81c2', 33, 'replay_refunds.py 输出')] }],
          result: [], block: [], next: [] }]
      }
    },
    'chen-mu|2026-09-23': {
      versions: [{ v: 1, at: '9月24日 09:04', why: '定时生成（北京时间 09:00 触发）', by: '系统' }],
      evidence: { obs: 3, claim: 3, infer: 1, gap: 0 },
      body: { 1: [{ theme: 't-kafka', sessions: ['s-2c90'],
        goal: [{ t: '查明夜间批处理期间 consumer lag 飙升的原因。', ev: [SAY('s-2c90', 205, '用户说明')] }],
        action: [{ t: '对照 9月2日会话中的火焰图结论，把 max.poll.records 由 500 调到 2000，并拆分反序列化线程。', ev: [OBS('s-2c90', 219, '编辑 consumer.yaml'), SAY('s-2c90', 214, 'Agent 方案', 'agent')] }],
        result: [
          { t: '本地压测 lag 峰值由约 12 万降至约 1.8 万。', ev: [OBS('s-2c90', 231, 'bench.sh 输出')] },
          { t: '尚未在生产流量下验证。', ev: [INF('会话中无生产环境操作')] }
        ],
        block: [],
        next: [{ t: '周四观察夜间批处理的实际 lag。', ev: [SAY('s-2c90', 240, '用户计划')] }],
        gaps: [] }] }
    },
    'xu-ruoxi|2026-09-23': {
      versions: [{ v: 1, at: '9月24日 09:03', why: '定时生成（北京时间 09:00 触发）', by: '系统' }],
      evidence: { obs: 3, claim: 2, infer: 1, gap: 0 },
      body: { 1: [{ theme: 't-push', sessions: ['s-x131'],
        goal: [{ t: '将 iOS 推送从 p12 证书迁移到 p8 密钥。', ev: [SAY('s-x131', 2, '用户说明')] }],
        action: [{ t: '更新推送服务的 JWT 签名配置，新增测试推送脚本。', ev: [OBS('s-x131', 18, '编辑 apns.go'), OBS('s-x131', 26, '新增 push_smoke.sh')] }],
        result: [{ t: '测试环境推送返回 HTTP/2 200。', ev: [OBS('s-x131', 40, 'curl 输出')] }],
        block: [{ t: '需要 Apple 开发者账号管理员在后台授权新密钥。', ev: [SAY('s-x131', 44, '用户说明')] }],
        next: [{ t: '授权后切换生产配置并观察送达情况。', ev: [INF('由阻塞推断')] }],
        gaps: [] }] }
    },
    'zhao-yiming|2026-09-23': {
      versions: [{ v: 1, at: '9月24日 09:03', why: '定时生成（北京时间 09:00 触发）', by: '系统' }],
      evidence: { obs: 2, claim: 1, infer: 0, gap: 1 },
      body: { 1: [{ theme: 't-export', sessions: ['s-z090'],
        goal: [{ t: '解决大账户订单导出超时。', ev: [SAY('s-z090', 1, '用户说明')] }],
        action: [{ t: '把 offset 分页改为基于 (created_at, id) 的游标分页。', ev: [OBS('s-z090', 15, '编辑 export/query.go')] }],
        result: [{ t: '导出模块集成测试 12 项通过。', ev: [OBS('s-z090', 48, 'go test ./export/... ok')] }],
        block: [],
        next: [],
        gaps: [{ t: 'Codex Desktop（Windows）自 9月21日 安装后未完成信任，该客户端的活动未被采集，本报告只基于 Claude Code（WSL）的材料。', ev: [GAP('覆盖不完整')] }] }] }
    }
  };

  // 上周周报（W38，9月14日—20日，9月21日 09:26 生成）
  const weekly = {
    'lin-yue': { at: '9月21日 09:26', v: 1, lead: '接入第一周集中在计费服务：完成退款对账脚本的依赖升级，并开始追查 9 月对账差异。', items: ['升级对账脚本依赖并修复 2 个弃用告警（工具结果）', '整理 9 月前两周渠道账单样本（用户说明）', '待继续：定位退款差异的根因'] },
    'zhou-qihang': { at: '9月21日 09:26', v: 1, lead: '运维控制台的前端基础整理：迁移构建脚本，修复暗色模式若干问题。', items: ['构建脚本迁移到 Vite（工具结果）', '暗色模式问题清单 6 项，完成 4 项（模型推断）', '待继续：告警规则编辑器重构'] },
    'chen-mu': { at: '9月21日 09:26', v: 1, lead: '数据管道的指标口径校对与补数准备。', items: ['核对 3 个核心指标的计算口径（工具结果）', '待继续：缺失日期回填'] },
    'xu-ruoxi': { at: '9月21日 09:26', v: 1, lead: '移动端推送链路梳理，确认迁移到 p8 密钥的方案。', items: ['整理推送服务调用链（工具结果）', '待继续：p8 签名配置'] },
    'zhao-yiming': { at: '—', v: 0, lead: '9月21日 接入，W38 无存档材料（接入前的旧会话不批量导入）。', items: [] },
    'han-qiu': { at: '9月21日 09:26', v: 1, lead: 'Terraform 模块升级的前期准备。', items: ['列出受 provider 升级影响的模块（工具结果）', '待继续：逐环境执行 plan'] }
  };

  const sessions = {
    // W38（9月14日—20日）：接入后的会话，已存档，可找回
    's-1a02': { member: 'lin-yue', agent: 'Claude Code CLI', project: 'billing-service', theme: null, date: '2026-09-15', start: '10:10', end: '12:05', title: '对账脚本依赖升级', events: 64, integrity: 'complete', device: 'd-lin-mbp' },
    's-1a19': { member: 'lin-yue', agent: 'Codex CLI', project: 'billing-service', theme: null, date: '2026-09-16', start: '14:30', end: '15:40', title: '弃用告警修复', events: 38, integrity: 'complete', device: 'd-lin-dev' },
    's-1a33': { member: 'lin-yue', agent: 'Claude Code CLI', project: 'billing-service', theme: null, date: '2026-09-17', start: '09:50', end: '11:30', title: '整理渠道账单样本', events: 51, integrity: 'complete', device: 'd-lin-mbp' },
    's-1a47': { member: 'lin-yue', agent: 'Claude Code CLI', project: 'billing-service', theme: null, date: '2026-09-18', start: '15:10', end: '17:45', title: '退款差异初查', events: 77, integrity: 'complete', device: 'd-lin-mbp' },
    's-cc10': { member: 'zhou-qihang', agent: 'Codex Desktop', project: 'ops-console', theme: null, date: '2026-09-16', start: '10:00', end: '12:40', title: '构建脚本迁移到 Vite', events: 90, integrity: 'complete', device: 'd-zhou-win' },
    's-cc22': { member: 'zhou-qihang', agent: 'Codex Desktop', project: 'ops-console', theme: null, date: '2026-09-18', start: '14:20', end: '16:00', title: '暗色模式问题清单', events: 47, integrity: 'complete', device: 'd-zhou-win' },
    's-2a05': { member: 'chen-mu', agent: 'Claude Code CLI', project: 'data-pipeline', theme: null, date: '2026-09-15', start: '15:00', end: '17:10', title: '核心指标口径核对', events: 58, integrity: 'complete', device: 'd-chen-mba' },
    's-2a17': { member: 'chen-mu', agent: 'Codex CLI', project: 'data-pipeline', theme: null, date: '2026-09-17', start: '10:30', end: '11:50', title: '口径差异复核', events: 33, integrity: 'complete', device: 'd-chen-mba' },
    's-xa03': { member: 'xu-ruoxi', agent: 'Codex Desktop', project: 'mobile-app', theme: null, date: '2026-09-16', start: '09:40', end: '11:20', title: '推送服务调用链', events: 49, integrity: 'complete', device: 'd-xu-mbp' },
    's-xa11': { member: 'xu-ruoxi', agent: 'Claude Code CLI', project: 'mobile-app', theme: null, date: '2026-09-18', start: '13:30', end: '15:10', title: 'p8 迁移方案', events: 42, integrity: 'complete', device: 'd-xu-mbp' },
    's-ha01': { member: 'han-qiu', agent: 'Codex CLI', project: 'infra', theme: null, date: '2026-09-15', start: '09:20', end: '11:00', title: 'provider 升级影响面', events: 55, integrity: 'complete', device: 'd-han-ws' },
    's-ha09': { member: 'han-qiu', agent: 'Codex CLI', project: 'infra', theme: null, date: '2026-09-17', start: '14:00', end: '16:30', title: '模块依赖图', events: 61, integrity: 'complete', device: 'd-han-ws' },
    's-1a01': { member: 'lin-yue', agent: 'Claude Code CLI', project: 'billing-service', theme: null, date: '2026-09-14', start: '14:10', end: '16:20', title: '对账脚本依赖梳理', events: 58, integrity: 'complete', device: 'd-lin-mbp' },
    's-1a25': { member: 'lin-yue', agent: 'Claude Code CLI', project: 'billing-service', theme: null, date: '2026-09-16', start: '10:00', end: '11:40', title: '渠道账单字段映射', events: 66, integrity: 'complete', device: 'd-lin-mbp' },
    's-cc03': { member: 'zhou-qihang', agent: 'Codex Desktop', project: 'ops-console', theme: null, date: '2026-09-14', start: '10:30', end: '12:00', title: '告警列表分页', events: 72, integrity: 'complete', device: 'd-zhou-win' },
    's-cc15': { member: 'zhou-qihang', agent: 'Codex Desktop', project: 'ops-console', theme: null, date: '2026-09-15', start: '14:00', end: '17:10', title: '主题色变量整理', events: 118, integrity: 'complete', device: 'd-zhou-win' },
    's-cc19': { member: 'zhou-qihang', agent: 'Claude Code CLI', project: 'ops-console', theme: null, date: '2026-09-17', start: '09:40', end: '11:30', title: '构建产物体积排查', events: 63, integrity: 'complete', device: 'd-zhou-win' },
    's-2a11': { member: 'chen-mu', agent: 'Claude Code CLI', project: 'data-pipeline', theme: null, date: '2026-09-16', start: '13:30', end: '15:40', title: '指标口径差异定位', events: 84, integrity: 'complete', device: 'd-chen-mba' },
    's-2a20': { member: 'chen-mu', agent: 'Codex CLI', project: 'data-pipeline', theme: null, date: '2026-09-18', start: '10:10', end: '12:30', title: '回填任务幂等设计', events: 69, integrity: 'complete', device: 'd-chen-mba' },
    's-xa01': { member: 'xu-ruoxi', agent: 'Codex Desktop', project: 'mobile-app', theme: null, date: '2026-09-14', start: '15:00', end: '16:30', title: '推送失败日志分析', events: 51, integrity: 'complete', device: 'd-xu-mbp' },
    's-xa07': { member: 'xu-ruoxi', agent: 'Claude Code CLI', project: 'mobile-app', theme: null, date: '2026-09-15', start: '10:20', end: '12:10', title: '证书到期巡检脚本', events: 60, integrity: 'complete', device: 'd-xu-mbp' },
    's-xa09': { member: 'xu-ruoxi', agent: 'Codex Desktop', project: 'mobile-app', theme: null, date: '2026-09-17', start: '14:30', end: '16:00', title: '推送 SDK 升级评估', events: 39, integrity: 'complete', device: 'd-xu-mbp' },
    's-ha02': { member: 'han-qiu', agent: 'Codex CLI', project: 'infra', theme: null, date: '2026-09-14', start: '10:00', end: '12:20', title: 'state 文件备份', events: 74, integrity: 'complete', device: 'd-han-ws' },
    's-ha05': { member: 'han-qiu', agent: 'Codex CLI', project: 'infra', theme: null, date: '2026-09-16', start: '14:10', end: '17:00', title: 'provider 锁定版本', events: 97, integrity: 'complete', device: 'd-han-ws' },
    's-ha12': { member: 'han-qiu', agent: 'Claude Code CLI', project: 'infra', theme: null, date: '2026-09-18', start: '09:30', end: '11:10', title: 'plan 输出比对脚本', events: 55, integrity: 'complete', device: 'd-han-ws' },
    // W39
    's-4410': { member: 'lin-yue', agent: 'Codex CLI', project: 'billing-service', theme: 't-refund', date: '2026-09-21', start: '10:02', end: '12:15', title: '退款差异的时段分布', events: 96, integrity: 'complete', device: 'd-lin-mbp' },
    's-3b07': { member: 'lin-yue', agent: 'Claude Code CLI', project: 'billing-service', theme: 't-invoice', date: '2026-09-21', start: '15:30', end: '17:05', title: '批量开票 PDF 超时', events: 71, integrity: 'complete', device: 'd-lin-mbp' },
    's-5d21': { member: 'lin-yue', agent: 'Claude Code CLI', project: 'billing-service', theme: 't-refund', date: '2026-09-22', start: '09:40', end: '12:02', title: '复现 9 月退款差异', events: 88, integrity: 'complete', device: 'd-lin-mbp' },
    's-7f3a': { member: 'lin-yue', agent: 'Claude Code CLI', project: 'billing-service', theme: 't-refund', date: '2026-09-23', start: '09:12', end: '11:48', title: '退款对账差异排查与修复', events: 152, integrity: 'gap-upstream', device: 'd-lin-mbp', detailed: true },
    's-81c2': { member: 'lin-yue', agent: 'Codex CLI', project: 'billing-service', theme: 't-refund', date: '2026-09-23', start: '14:20', end: '16:05', title: '回放 9 月退款数据', events: 64, integrity: 'complete', device: 'd-lin-dev', reclassified: true },
    's-9a14': { member: 'lin-yue', agent: 'Claude Code CLI', project: 'billing-service', theme: 't-refund', date: '2026-09-24', start: '09:30', end: '进行中', title: '申请沙箱前的端到端脚本准备', events: 37, integrity: 'syncing', device: 'd-lin-mbp' },
    's-c311': { member: 'zhou-qihang', agent: 'Codex Desktop', project: 'ops-console', theme: 't-dark', date: '2026-09-21', start: '14:00', end: '16:10', title: '暗色模式对比度', events: 58, integrity: 'complete', device: 'd-zhou-win' },
    's-c402': { member: 'zhou-qihang', agent: 'Codex Desktop', project: 'ops-console', theme: 't-alert', date: '2026-09-22', start: '10:20', end: '17:40', title: '拆分 RuleEditor', events: 140, integrity: 'complete', device: 'd-zhou-win' },
    's-c517': { member: 'zhou-qihang', agent: 'Codex Desktop', project: 'ops-console', theme: 't-alert', date: '2026-09-23', start: '09:05', end: '12:10', title: '条件编辑子组件', events: 121, integrity: 'complete', device: 'd-zhou-win' },
    's-c530': { member: 'zhou-qihang', agent: 'Codex Desktop', project: 'ops-console', theme: 't-alert', date: '2026-09-23', start: '11:40', end: '12:30', title: '子任务：Storybook 用例', events: 34, integrity: 'complete', device: 'd-zhou-win', parent: 's-c517' },
    's-c523': { member: 'zhou-qihang', agent: 'Claude Code CLI', project: 'ops-console', theme: 't-alert', date: '2026-09-23', start: '13:30', end: '15:10', title: '表单校验迁移', events: 77, integrity: 'complete', device: 'd-zhou-win' },
    's-c601': { member: 'zhou-qihang', agent: 'Codex Desktop', project: 'ops-console', theme: 't-alert', date: '2026-09-24', start: '10:10', end: '12:00', title: '规则预览面板', events: 49, integrity: 'complete', device: 'd-zhou-win' },
    's-2d01': { member: 'chen-mu', agent: 'Codex CLI', project: 'data-pipeline', theme: 't-backfill', date: '2026-09-21', start: '16:00', end: '17:20', title: '指标回填脚本', events: 44, integrity: 'complete', device: 'd-chen-mba' },
    's-2c90': { member: 'chen-mu', agent: 'Claude Code CLI', project: 'data-pipeline', theme: 't-kafka', date: '2026-09-23', start: '10:15', end: '12:40', title: 'Kafka 消费延迟（继续旧会话）', events: 241, integrity: 'complete', device: 'd-chen-mba', oldContext: { from: '2026-09-02', events: 198 } },
    's-2e11': { member: 'chen-mu', agent: 'Claude Code CLI', project: 'data-pipeline', theme: 't-kafka', date: '2026-09-24', start: '13:20', end: '进行中', title: '观察夜间批处理 lag', events: 12, integrity: 'syncing', device: 'd-chen-mba' },
    's-x101': { member: 'xu-ruoxi', agent: 'Codex Desktop', project: 'mobile-app', theme: 't-push', date: '2026-09-21', start: '10:00', end: '12:20', title: 'p12 与 p8 差异梳理', events: 62, integrity: 'complete', device: 'd-xu-mbp' },
    's-x118': { member: 'xu-ruoxi', agent: 'Codex Desktop', project: 'mobile-app', theme: 't-push', date: '2026-09-22', start: '13:10', end: '16:38', title: 'JWT 签名配置', events: 97, integrity: 'complete', device: 'd-xu-mbp', late: '9月23日 10:20 补传' },
    's-x120': { member: 'xu-ruoxi', agent: 'Claude Code CLI', project: 'mobile-app', theme: 't-push', date: '2026-09-22', start: '15:00', end: '16:40', title: '签名单元测试', events: 45, integrity: 'complete', device: 'd-xu-mbp', late: '9月23日 10:20 补传' },
    's-x131': { member: 'xu-ruoxi', agent: 'Codex Desktop', project: 'mobile-app', theme: 't-push', date: '2026-09-23', start: '10:30', end: '15:45', title: '测试推送脚本', events: 118, integrity: 'complete', device: 'd-xu-mbp' },
    's-x140': { member: 'xu-ruoxi', agent: 'Claude Code CLI', project: 'mobile-app', theme: 't-push', date: '2026-09-24', start: '10:00', end: '12:30', title: '生产切换预案', events: 53, integrity: 'partial', device: 'd-xu-mbp' },
    's-z077': { member: 'zhao-yiming', agent: 'Claude Code CLI', project: 'unclassified', theme: 't-regex', date: '2026-09-21', start: '16:30', end: '17:05', title: '日志解析正则', events: 21, integrity: 'complete', device: 'd-zhao-wsl' },
    's-z081': { member: 'zhao-yiming', agent: 'Claude Code CLI', project: 'billing-service', theme: 't-export', date: '2026-09-22', start: '10:05', end: '12:30', title: '导出超时分析', events: 66, integrity: 'complete', device: 'd-zhao-wsl' },
    's-z090': { member: 'zhao-yiming', agent: 'Claude Code CLI', project: 'billing-service', theme: 't-export', date: '2026-09-23', start: '13:10', end: '15:20', title: '游标分页实现', events: 70, integrity: 'complete', device: 'd-zhao-wsl' },
    's-z095': { member: 'zhao-yiming', agent: 'Claude Code CLI', project: 'billing-service', theme: 't-export', date: '2026-09-24', start: '09:40', end: '进行中', title: '导出任务断点续传', events: 29, integrity: 'syncing', device: 'd-zhao-wsl' },
    's-h201': { member: 'han-qiu', agent: 'Codex CLI', project: 'infra', theme: 't-tf', date: '2026-09-21', start: '09:30', end: '12:00', title: 'staging 环境 plan', events: 83, integrity: 'complete', device: 'd-han-ws' },
    's-h210': { member: 'han-qiu', agent: 'Codex CLI', project: 'infra', theme: 't-tf', date: '2026-09-22', start: '14:00', end: '18:10', title: 'prod-cn 环境 plan', events: 131, integrity: 'complete', device: 'd-han-ws' },
    's-h230': { member: 'han-qiu', agent: 'Claude Code CLI', project: 'infra', theme: 't-tf', date: '2026-09-24', start: '09:50', end: '进行中', title: '手工迁移状态', events: 40, integrity: 'gap', device: 'd-han-ws', gap: '11:30–12:10 磁盘空间不足' }
  };

  // 会话详情：s-7f3a（阅读视图的事件节选；折叠段代表未展开的事件）
  const timeline = {
    's-7f3a': {
      nativeId: '7f3a92c1-5b0e-4d7a-9c21-3e8b1f04a6d2',
      received: '9月23日 11:49:12', size: '3.1 MB', agentVersion: '试点版本',
      snapshots: [
        { g: 'g1', at: '9月23日 10:05', note: '压缩前', state: '完整 · 已被 g2 取代，原件保留' },
        { g: 'g2', at: '9月23日 11:49', note: '当前', state: '当前快照完整' }
      ],
      children: [{ id: 's-7f3a-sub1', title: 'Explore：查找所有按 UTC 取日期的调用', events: 14 }],
      analysis: { id: 'a-2213', at: '9月24日 09:02', runtime: 'Claude Code（隔离运行，不加载员工项目 hooks）', provider: '千问按量接口（Anthropic 兼容）', prompt: 'p-7', segments: 3 },
      events: [
        { n: 1, t: '09:12:04', kind: 'user', text: '9 月对账里退款金额和渠道账单对不上，帮我查一下 refund_reconcile 的逻辑，先别改代码。' },
        { n: 2, t: '09:12:09', kind: 'agent', text: '先看对账脚本和最近的提交记录，再对照渠道账单的日期口径。' },
        { n: 3, t: '09:12:15', kind: 'tool', tool: 'Bash', cmd: 'git log --oneline -n 8 -- billing/refund_reconcile.py', out: ['a41c9e2 refund: 合并部分退款的明细行', '77b0d13 reconcile: 支持渠道账单 v3 字段', '…另 6 行'], lines: 8 },
        { fold: '#4–#6', count: 3, note: '2 次工具调用 · 1 条 Agent 消息' },
        { n: 7, t: '09:14:40', kind: 'tool', tool: 'Grep', cmd: 'grep -rn "ts.date()" billing/', out: ['billing/refund_reconcile.py:88:    settle_date = ts.date()', 'billing/payout.py:41:    day = ts.date()', 'billing/report/daily.py:120:    d = ts.date()'], lines: 3 },
        { n: 9, t: '09:15:12', kind: 'agent', text: 'settle_date 直接取 UTC 日期。北京时间 0–8 点发生的退款会被计入前一天，而渠道账单按北京时间出账，所以跨日的退款会对不上。' },
        { n: 12, t: '09:16:30', kind: 'sub', id: 's-7f3a-sub1', title: 'Explore：查找所有按 UTC 取日期的调用', events: 14, result: '3 处；payout.py 已有时区换算，不受影响。' },
        { fold: '#13–#17', count: 5, note: '3 次工具调用 · 2 条 Agent 消息' },
        { n: 18, t: '09:31:47', kind: 'user', text: '确认是这个原因，改吧，补测试。payout 那处不用动。' },
        { n: 21, t: '09:33:05', kind: 'edit', file: 'billing/refund_reconcile.py', diff: [['meta', '@@ -86,7 +86,8 @@'], ['del', '    settle_date = ts.date()'], ['add', '    # 渠道账单按北京时间出账'], ['add', '    settle_date = ts.astimezone(SHANGHAI).date()']] },
        { n: 24, t: '09:36:40', kind: 'edit', file: 'tests/refund/test_timezone.py', diff: [['meta', '新文件 · 64 行'], ['add', 'def test_refund_before_8am_counts_same_day():'], ['add', '    …']] },
        { fold: '#25–#30', count: 6, note: '5 次工具调用' },
        { n: 31, t: '10:05:18', kind: 'compact', text: '上下文压缩（代次 g1 → g2）。服务器保留压缩前的完整原件，不被后来的摘要替代。' },
        { fold: '#32–#57', count: 26, note: '19 次工具调用 · 2 条用户消息' },
        { n: 58, t: '10:22:10', kind: 'gap', range: '#58–#61', text: '附件原件不可得：Agent 引用了一张渠道后台截图，本地会话记录没有保存图片原件（上游未提供）。已记录为缺口，不生成替代内容。' },
        { fold: '#62–#140', count: 79, note: '58 次工具调用 · 3 条用户消息' },
        { n: 141, t: '11:30:02', kind: 'tool', tool: 'Bash', cmd: 'python scripts/replay_refunds.py --month 2026-09 --dry-run', out: ['[replay] 2026-09-01 … 612 条', '[replay] 2026-09-02 … 588 条', '[replay] 2026-09-03 … 604 条'], lines: 18402, size: '2.4 MB', big: true },
        { n: 142, t: '11:41:37', kind: 'tool', tool: 'Bash', cmd: 'pytest tests/refund -q', out: ['......................................', '38 passed in 4.21s'], lines: 2 },
        { fold: '#143–#149', count: 7, note: '3 次工具调用' },
        { n: 150, t: '11:46:03', kind: 'agent', text: '已在预发环境验证，对账结果一致。', unverified: true },
        { n: 152, t: '11:47:30', kind: 'user', text: '预发我还没有渠道沙箱的权限，先这样，明天申请。' }
      ],
      raw: [
        '{"type":"user","uuid":"e0001","timestamp":"2026-09-23T01:12:04.118Z","message":{"role":"user","content":"9 月对账里退款金额和渠道账单对不上…"}}',
        '{"type":"assistant","uuid":"e0002","timestamp":"2026-09-23T01:12:09.402Z","message":{"role":"assistant","content":[{"type":"text","text":"先看对账脚本…"}]}}',
        '{"type":"assistant","uuid":"e0003","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git log --oneline -n 8 -- billing/refund_reconcile.py"}}]}}',
        '{"type":"user","uuid":"e0004","message":{"content":[{"type":"tool_result","content":"a41c9e2 refund: 合并部分退款的明细行\\n…"}]}}',
        '{"type":"system","subtype":"compact_boundary","uuid":"e0031","timestamp":"2026-09-23T02:05:18.550Z"}',
        '{"type":"assistant","uuid":"e0142","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"pytest tests/refund -q"}}]}}',
        '{"type":"user","uuid":"e0143","message":{"content":[{"type":"tool_result","content":"38 passed in 4.21s"}]}}'
      ]
    }
  };

  const jobs = [
    { id: 'j-3019', kind: '会话分段提取', scope: 's-z095 · 赵一鸣', trigger: '增量去抖合并', state: 'running', attempts: '1/3', note: '租约至 14:06:30 · 心跳 14:05:40', tokens: '进行中' },
    { id: 'j-3020', kind: '会话分段提取', scope: 's-9a14 · 林悦', trigger: '增量去抖合并', state: 'queued', attempts: '0/3', note: '排队第 1 位', tokens: '—' },
    { id: 'j-3021', kind: '会话分段提取', scope: 's-2e11 · 陈牧', trigger: '增量去抖合并', state: 'queued', attempts: '0/3', note: '排队第 2 位', tokens: '—' },
    { id: 'j-3022', kind: '会话分段提取', scope: 's-h230 · 韩秋', trigger: '增量去抖合并', state: 'queued', attempts: '0/3', note: '含缺口标记（11:30–12:10）', tokens: '—' },
    { id: 'j-3012', kind: '日报', scope: '周启航 · 9月23日', trigger: '定时 09:00', state: 'retrying', attempts: '1/3', note: '模型请求超时（120 s）· 下次 14:30', tokens: '输入 0.41M · 输出未知' },
    { id: 'j-3013', kind: '日报', scope: '林悦 · 9月23日', trigger: '分析更正（王清 10:12）', state: 'done', attempts: '1/3', note: '生成 v2 · 10:41', tokens: '输入 0.38M · 输出 21k' },
    { id: 'j-3011', kind: '日报', scope: '许若溪 · 9月22日', trigger: '迟到数据（10:20 补传 2 个会话）', state: 'done', attempts: '1/3', note: '生成 v2 · 9月23日 10:41', tokens: '输入 0.29M · 输出 17k' },
    { id: 'j-3004', kind: '日报批次', scope: '全员 · 9月23日', trigger: '定时 09:00', state: 'done', attempts: '—', note: '6 份：4 份生成 · 1 份无活动 · 1 份失败转重试', tokens: '输入 1.9M · 输出 0.12M' },
    { id: 'j-2990', kind: '周报批次', scope: '全员 · W38', trigger: '定时 周一 09:00', state: 'done', attempts: '—', note: '9月21日 09:26 完成 · 5 份（1 人 W38 无材料）', tokens: '输入 3.4M · 输出 0.2M' }
  ];

  const corrections = [
    { id: 'c-17', at: '9月24日 10:12', by: '王清', target: '林悦 · 9月23日 日报', kind: '更正归类', text: '会话 s-81c2 从「未归类」改为「计费服务 / 退款对账差异修复」。', result: '触发重算 → v2（10:41）' },
    { id: 'c-16', at: '9月24日 10:12', by: '王清', target: '林悦 · 9月23日 日报', kind: '追加说明', text: '沙箱权限已于 9月24日 提交申请。', result: '随 v2 发布' },
    { id: 'c-15', at: '9月23日 17:30', by: '周启航', target: '周启航 · 9月22日 日报', kind: '更正主题', text: '将“表单样式调整”合并到「告警规则编辑器重构」。', result: '触发重算 → v2（17:52）' },
    { id: 'c-14', at: '9月22日 11:05', by: '陈牧', target: '项目归类规则', kind: '更正归类', text: '工作目录 ~/work/pipeline-bench 归入「数据管道」，后续会话沿用。', result: '影响 0 份已发布报告' }
  ];

  const ops = {
    queue: { queued: 3, running: 1, retrying: 1, failed: 0, doneToday: 14 },
    usage: { tin: '4.1M', tout: '0.38M', unknownJobs: 2, budget: { used: 1860, cap: 3000, unit: '元', note: '本月预算（部署时设置 · 示例值）' }, concurrency: '模型并发 2 · 解析并发 4' },
    storage: { raw: '412 GB', volume: '2 TB', db: '38 GB', perDay: '约 3.1 GB / 天（近 7 日）', policy: '原件默认不自动删除' },
    backup: [
      { what: 'PostgreSQL（数据库）', last: '9月24日 03:00', state: 'ok', how: '基础备份 + WAL 归档' },
      { what: '原件持久卷', last: '9月24日 03:40', state: 'ok', how: '卷快照，异机保存' },
      { what: '恢复演练', last: '9月15日', state: 'ok', how: '数据库与原件一致性校验通过；抽检 200 条证据引用均可定位 · 下次 10月15日' }
    ]
  };

  const recovery = {
    compat: [
      { client: 'Claude Code CLI', os: 'macOS', read: true, native: 'verified', at: '9月18日 演练' },
      { client: 'Claude Code CLI', os: 'Linux', read: true, native: 'verified', at: '9月18日 演练' },
      { client: 'Claude Code CLI', os: 'Windows', read: true, native: 'pending', at: '待试点验证' },
      { client: 'Codex CLI', os: 'macOS / Linux', read: true, native: 'verified', at: '9月19日 演练' },
      { client: 'Codex Desktop', os: 'macOS', read: true, native: 'pending', at: '待试点验证' },
      { client: 'Codex Desktop', os: 'Windows', read: true, native: 'pending', at: '待试点验证' }
    ]
  };

  return { now: { date: '2026-09-24', time: '14:05' }, viewer: { name: '王清', role: '研发经理' }, projects, clientStages, members, week, themes, days, reports, weekly, sessions, timeline, jobs, corrections, ops, recovery };
})();
