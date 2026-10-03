/* PROTOTYPE — 数据处理层（示例）。
 * 正式系统中：确定性指标来自原件解析，任务类型与提示词要素来自模型分段提取；会话由原件分块去重后组装。
 * 这里用固定种子的伪随机数从会话元数据生成同样形状的数据，刷新结果不变；手写会话（s-7f3a 等）使用手写对话。
 * 生成：每个会话的指标、对话（提示词/回复/工具计数/等待）、活动事件、组装与去重记录；并据此重算日统计，保证各视图数字一致。
 */
(() => {
  'use strict';
  const D = window.SKY;
  const SES = D.sessions;

  /* ---------- deterministic randomness ---------- */
  const hash = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lognorm = (r, median, sigma) => { const u1 = Math.max(1e-9, r()), u2 = r(); return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)); };
  const between = (r, a, b) => a + (b - a) * r();
  const int = (r, a, b) => Math.round(between(r, a, b));
  const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const toMin = (hm) => { const p = hm.split(':').map(Number); return p[0] * 60 + p[1] + (p[2] || 0) / 60; };
  const fmtT = (min) => { const s = Math.round(min * 60); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const NOW = toMin(D.now.time);

  /* ---------- task types (模型推断) & person profiles ---------- */
  const KINDS = ['实现', '修复', '排查', '重构', '测试', '运维', '整理'];
  const KIND = {
    's-7f3a': '修复', 's-81c2': '排查', 's-4410': '排查', 's-3b07': '修复', 's-5d21': '排查', 's-9a14': '测试',
    's-1a01': '整理', 's-1a02': '重构', 's-1a19': '修复', 's-1a25': '实现', 's-1a33': '整理', 's-1a47': '排查',
    's-c311': '修复', 's-c402': '重构', 's-c517': '实现', 's-c530': '测试', 's-c523': '实现', 's-c601': '实现',
    's-cc03': '实现', 's-cc10': '重构', 's-cc15': '重构', 's-cc19': '排查', 's-cc22': '整理',
    's-2d01': '实现', 's-2c90': '排查', 's-2e11': '排查', 's-2a05': '排查', 's-2a11': '排查', 's-2a17': '排查', 's-2a20': '实现',
    's-x101': '整理', 's-x118': '实现', 's-x120': '测试', 's-x131': '实现', 's-x140': '整理', 's-xa01': '排查', 's-xa03': '整理', 's-xa07': '实现', 's-xa09': '整理', 's-xa11': '整理',
    's-z077': '排查', 's-z081': '排查', 's-z090': '实现', 's-z095': '实现',
    's-h201': '运维', 's-h210': '运维', 's-h230': '运维', 's-ha01': '整理', 's-ha02': '运维', 's-ha05': '运维', 's-ha09': '整理', 's-ha12': '实现'
  };
  const PROFILE = {
    'lin-yue':     { ctx: 0.72, goal: 0.86, cons: 0.52, acc: 0.38, rework: 0.12, clarify: 0.06, waitMed: 2.2, permP: 0.30, permMed: 1.1, ver: 0.93, test: 0.85 },
    'zhou-qihang': { ctx: 0.55, goal: 0.78, cons: 0.40, acc: 0.22, rework: 0.20, clarify: 0.10, waitMed: 3.4, permP: 0.22, permMed: 1.6, ver: 0.74, test: 0.8 },
    'chen-mu':     { ctx: 0.64, goal: 0.80, cons: 0.36, acc: 0.30, rework: 0.09, clarify: 0.07, waitMed: 5.6, permP: 0.26, permMed: 2.4, ver: 0.9, test: 0.6 },
    'xu-ruoxi':    { ctx: 0.46, goal: 0.70, cons: 0.30, acc: 0.18, rework: 0.22, clarify: 0.14, waitMed: 2.8, permP: 0.24, permMed: 1.4, ver: 0.62, test: 0.45 },
    'zhao-yiming': { ctx: 0.40, goal: 0.66, cons: 0.26, acc: 0.16, rework: 0.26, clarify: 0.16, waitMed: 4.1, permP: 0.20, permMed: 2.0, ver: 0.7, test: 0.5 },
    'han-qiu':     { ctx: 0.68, goal: 0.84, cons: 0.62, acc: 0.34, rework: 0.05, clarify: 0.04, waitMed: 2.4, permP: 0.55, permMed: 2.8, ver: 0.95, test: 0.7 }
  };
  const KP = {
    实现: { tok: 1.0, add: [180, 620], del: [10, 120], files: [4, 12], tests: [1, 4], commit: 0.7, ver: [1, 4], clm: [0, 1] },
    修复: { tok: 0.9, add: [20, 140], del: [5, 60], files: [2, 6], tests: [1, 3], commit: 0.6, ver: [1, 3], clm: [0, 1] },
    排查: { tok: 1.35, add: [0, 40], del: [0, 20], files: [1, 5], tests: [0, 2], commit: 0.1, ver: [0, 2], clm: [0, 2] },
    重构: { tok: 1.15, add: [200, 700], del: [160, 640], files: [6, 20], tests: [1, 4], commit: 0.6, ver: [1, 3], clm: [0, 1] },
    测试: { tok: 0.8, add: [80, 300], del: [0, 30], files: [2, 6], tests: [2, 6], commit: 0.5, ver: [1, 4], clm: [0, 1] },
    运维: { tok: 1.1, add: [10, 90], del: [0, 40], files: [2, 8], tests: [0, 1], commit: 0.3, ver: [0, 3], clm: [0, 2] },
    整理: { tok: 0.7, add: [20, 160], del: [0, 20], files: [1, 4], tests: [0, 0], commit: 0.2, ver: [0, 2], clm: [0, 1] }
  };

  /* ---------- authored overrides（与已发布日报的证据一致） ---------- */
  const OVR = {
    's-7f3a': { turns: 8, tools: 97, files: 9, add: 142, del: 6, testsRun: 4, testsPass: 4, commits: 0, verified: 1, claimed: 1, tin: 0.98e6, tout: 6.6e4 },
    's-81c2': { turns: 3, tools: 30, files: 3, add: 12, del: 0, testsRun: 0, testsPass: 0, commits: 0, verified: 1, claimed: 0, tin: 0.44e6, tout: 3.0e4 },
    's-2c90': { turns: 4, tools: 26, files: 4, add: 18, del: 6, testsRun: 1, testsPass: 1, commits: 1, verified: 1, claimed: 0, tin: 0.31e6, tout: 2.2e4 },
    's-x131': { turns: 5, verified: 1, claimed: 0 },
    's-x118': { turns: 4, verified: 1, claimed: 1 },
    's-z090': { turns: 5, verified: 1, claimed: 0 },
    's-h230': { turns: 3, verified: 1, claimed: 0 },
    's-c517': { turns: 4, verified: 1, claimed: 1 }
  };

  /* ---------- authored conversations ---------- */
  const U = (n, t, text, f = {}) => ({ n, t, role: 'user', text, f });
  const A = (n, t, text, x = {}) => Object.assign({ n, t, role: 'agent', text }, x);
  const CHAT = {
    's-7f3a': {
      msgs: [
        U(1, '09:12:04', '9 月对账里退款金额和渠道账单对不上，帮我查一下 refund_reconcile 的逻辑，先别改代码。', { goal: 1, ctx: 1, cons: 1 }),
        A(2, '09:12:09', '先看对账脚本和最近的提交记录，再对照渠道账单的日期口径。'),
        A(9, '09:15:12', 'settle_date 直接取 UTC 日期。北京时间 0–8 点发生的退款会被计入前一天，而渠道账单按北京时间出账，所以跨日的退款会对不上。'),
        A(17, '09:29:10', '子任务确认了 3 处按 UTC 取日期的调用：refund_reconcile.py 需要改；payout.py 已有时区换算；daily.py 只用于内部报表。建议只改对账脚本并补跨日用例，要我现在修改吗？'),
        U(18, '09:31:47', '确认是这个原因，改吧，补测试。payout 那处不用动。', { goal: 1, ctx: 1, cons: 1, acc: 1 }),
        A(30, '10:04:40', '已改为按 Asia/Shanghai 取结算日，新增 3 个跨日退款用例，本地测试通过。'),
        U(35, '10:08:10', '再加一个 0 点整的边界用例。', { goal: 1 }),
        A(46, '10:24:30', '已补充 0 点整的边界用例，现在共 4 个跨日用例。'),
        U(47, '10:31:00', '测试名改成中文描述，和仓库里其他用例保持一致。', { goal: 1, cons: 1, rework: 1 }),
        A(52, '10:33:10', '已按仓库习惯改为中文描述。'),
        U(62, '10:52:20', '用 9 月数据回放一遍，看看差异条目是不是都消失了。', { goal: 1, ctx: 1, acc: 1 }),
        A(95, '11:08:00', '回放脚本默认会写入临时表。要我先用 --dry-run 跑一遍吗？', { clarify: 1 }),
        U(96, '11:10:10', '不对，回放要用只读模式，不要写任何表。', { goal: 1, cons: 1, rework: 1, afterClarify: 1 }),
        A(120, '11:20:30', '已改用只读模式。回放输出 18,402 行，差异条目数需要单独统计。'),
        U(121, '11:22:05', '输出太长了，只统计差异条数。', { goal: 1 }),
        A(150, '11:46:03', '已在预发环境验证，对账结果一致。', { unverified: 1 }),
        U(152, '11:47:30', '预发我还没有渠道沙箱的权限，先这样，明天申请。', {})
      ],
      perms: [{ t: '09:32:40', min: 0.25, cmd: 'Edit billing/refund_reconcile.py' }, { t: '10:53:30', min: 5.2, cmd: 'python scripts/replay_refunds.py --month 2026-09' }],
      marks: [{ after: 30, kind: 'compact', t: '10:05:18', text: '上下文压缩（代次 g1 → g2）。服务器保留压缩前的完整原件，摘要消息标记为派生内容，不重复计入。' },
        { after: 52, kind: 'gap', t: '10:22:10', text: '#58–#61 附件原件不可得：Agent 引用的渠道后台截图没有保存在本地记录中（上游未提供）。' }]
    },
    's-2c90': {
      old: [
        U(0, '20:14:00', '夜间批处理期间 consumer lag 飙到十几万，帮我分析一下 profile。', { goal: 1, ctx: 1 }),
        A(0, '20:31:00', '火焰图显示大部分时间花在反序列化和逐条提交 offset 上，单次拉取 500 条偏少。'),
        U(0, '21:02:00', '先记下来，明天再处理。', {})
      ],
      oldDate: '2026-09-02', oldEvents: 198,
      msgs: [
        U(205, '10:15:30', '接着上次的分析，查明夜间批处理期间 lag 飙升的原因，这次可以改配置。', { goal: 1, ctx: 1 }),
        A(214, '10:36:10', '建议两步：把 max.poll.records 从 500 提到 2000，并把反序列化移到独立线程池。先在本地压测验证。'),
        U(216, '10:41:00', '可以，先改配置，线程池那部分单独提交。', { goal: 1, cons: 1 }),
        A(231, '11:58:20', '本地压测完成：lag 峰值约 1.8 万，此前约 12 万。输出保存在 bench/out-0923.txt。'),
        U(233, '12:05:10', '生产上还没验证，别写成已解决。', { cons: 1, rework: 1 }),
        A(238, '12:30:40', '已修改总结措辞：本地压测改善，生产待观察。'),
        U(240, '12:36:00', '周四观察夜间批处理的实际 lag，到时候再继续。', {})
      ],
      perms: [{ t: '11:02:00', min: 3.4, cmd: 'bash bench.sh --topic metrics-nightly' }]
    },
    's-x118': {
      msgs: [
        U(1, '13:10:00', '把推送服务的签名方式改成 p8 密钥的 JWT，旧的 p12 先保留开关。', { goal: 1, ctx: 1, cons: 1 }),
        A(22, '13:42:00', '已新增 JWT 签名实现与配置开关 APNS_AUTH=token|cert，默认仍为 cert。'),
        U(23, '14:05:00', 'token 缓存 50 分钟刷新一次，别每次请求都签。', { goal: 1, cons: 1 }),
        A(48, '14:40:00', '已加入 50 分钟的 token 缓存，并补了过期边界测试。'),
        U(49, '15:20:00', '测试里别写死 team id，从环境变量读。', { cons: 1, rework: 1 }),
        A(80, '16:10:00', '已改为从环境变量读取，测试通过。', { unverified: 1 }),
        U(81, '16:30:00', '先这样，明天接着写测试推送脚本。', {})
      ],
      perms: [{ t: '14:12:00', min: 0.6, cmd: 'go test ./apns/...' }],
      backfill: '9月23日 10:20 补传（设备 9月22日 16:40 起离线）'
    },
    's-h230': {
      msgs: [
        U(1, '09:50:00', 'prod-cn 有 2 个资源需要手工迁移 state，先列出 terraform state mv 的命令，不要执行。', { goal: 1, ctx: 1, cons: 1 }),
        A(12, '10:20:00', '列出了 2 条 state mv 命令，并标注了对应资源地址。建议先在 staging 演练。'),
        U(13, '10:34:00', '先在 staging 演练，输出每一步的 plan 差异。', { goal: 1, acc: 1 }),
        A(26, '11:25:00', 'staging 演练第一步完成，plan 无差异。'),
        U(27, '12:18:00', '空间清理好了，继续第二步。', { goal: 1 }),
        A(39, '13:40:00', '第二步完成，plan 显示 0 个变更。正在准备 prod-cn 的执行清单。')
      ],
      perms: [{ t: '10:40:00', min: 6.5, cmd: 'terraform plan -target=module.vpc' }, { t: '12:22:00', min: 1.2, cmd: 'terraform plan -target=module.db' }],
      marks: [{ after: 26, kind: 'gap', t: '11:30:00', text: '11:30–12:10 采集缺口：本地磁盘空间不足，期间材料未能暂存，无法补回。' }]
    },
    's-c517': {
      msgs: [
        U(1, '09:05:00', '把告警规则的条件编辑拆成独立组件 ConditionEditor，保持现有表单行为。', { goal: 1, ctx: 1, cons: 1 }),
        A(30, '09:40:00', '已拆出 ConditionEditor，支持 AND/OR 条件组，原表单通过新组件渲染。'),
        U(31, '10:02:00', '条件组最多嵌套两层，超过时给出提示。', { goal: 1, cons: 1, acc: 1 }),
        A(62, '10:45:00', '已限制嵌套深度为 2，超出时显示行内提示。'),
        U(63, '11:10:00', '样式用 design token，不要写死颜色。', { cons: 1, rework: 1 }),
        A(96, '11:52:00', '已改用 token 变量，并补充了暗色主题的快照测试。', { unverified: 1 }),
        U(97, '12:05:00', '好，子任务里补一下 Storybook 用例。', { goal: 1 })
      ],
      perms: []
    }
  };

  /* ---------- text templates for generated conversations ---------- */
  const FIRST = {
    实现: (t) => `实现「${t}」，沿用现有目录结构和命名，写完补单元测试。`,
    修复: (t) => `${t}：先定位原因再修复，改完跑相关测试。`,
    排查: (t) => `帮我排查「${t}」，先别改代码，把可能的原因和证据列出来。`,
    重构: (t) => `重构「${t}」，对外行为保持不变，分步骤提交。`,
    测试: (t) => `给「${t}」补测试，覆盖边界和异常路径。`,
    运维: (t) => `${t}：先输出 plan 和影响范围，不要直接执行变更。`,
    整理: (t) => `整理「${t}」，输出一份清单和结论。`
  };
  const AFIRST = {
    实现: '先确认现有模块结构和约定，再按约定新增实现与测试。', 修复: '先复现问题，定位到具体代码后再改。', 排查: '先看相关代码和最近的改动，再对照日志找线索。',
    重构: '先梳理调用关系，列出需要改动的模块。', 测试: '先看现有测试的组织方式，再补用例。', 运维: '先只读地收集当前状态，输出 plan。', 整理: '先收集相关材料，再按主题归类。'
  };
  const FOLLOW = ['可以，按这个方案继续。', '把剩下的部分也处理掉。', '再跑一遍相关测试。', '这里的边界情况也要考虑进去。', '输出太长了，只保留关键结果。', '先把改动总结一下，列出影响的文件。', '这部分单独提交，提交信息写清楚。', '换个思路，先看看运行日志。'];
  const REWORK = ['不对，这个文件不要动。', '方向不对，回到上一步的方案。', '还是报错，你看一下完整日志再改。', '不要引入新依赖，用项目里已有的工具函数。', '测试不能跳过，把失败的原因找出来。', '别改公共接口，调用方太多了。'];
  const LAST = ['先这样，明天继续。', '可以了，收尾吧。', '好，就到这里。'];
  const CLQ = ['需要确认一下：这次只处理测试环境，还是生产配置也一起改？', '有两种做法：改调用方，或者在底层兼容。你倾向哪一种？', '这个目录下有两份相似的配置，要改哪一份？'];
  const CLA = ['只改测试环境。', '在底层兼容，调用方先不动。', '改 config/prod 那份。'];
  const AMID = ['已按要求修改，相关测试通过。', '已完成这一步，改动涉及 3 个文件。', '找到了原因：配置在初始化之前就被读取了。', '已补充边界用例，全部通过。', '已调整实现，并更新了注释。', '已回退到上一步的方案，重新实现了这部分。', '已把日志中的报错修复，完整测试通过。'];
  const ALAST = ['改动已完成，影响的文件和验证结果汇总在上面。', '好的，当前进度已记录在会话中。', '已收尾，未提交的改动都在工作区。'];

  /* ---------- per-session generation ---------- */
  const metrics = {}, conv = {}, activity = [], assembly = {};
  const spans = {}; // member → [[date, start, end, sid]]
  Object.entries(SES).forEach(([sid, s]) => {
    const st = toMin(s.start), en = /\d/.test(s.end) ? toMin(s.end) : NOW;
    (spans[s.member] = spans[s.member] || []).push([s.date, st, en, sid]);
  });
  const parallelAt = (member, date, a, b, sid) => (spans[member] || []).some(([d, st, en, id]) => id !== sid && d === date && st < b && en > a);

  Object.entries(SES).forEach(([sid, s]) => {
    const r = mulberry(hash(sid));
    const kind = KIND[sid] || '实现';
    const kp = KP[kind];
    const pr = PROFILE[s.member];
    const o = OVR[sid] || {};
    const live = !/\d/.test(s.end);
    const start = toMin(s.start), end = live ? NOW : toMin(s.end);
    const known = s.agent !== 'Codex Desktop';
    const perEv = s.agent === 'Codex CLI' ? 5600 : 6500;
    const turns = o.turns || clamp(Math.round(s.events / 12 + r() * 3), 2, 18);
    const m = {
      kind, known,
      turns,
      tools: o.tools != null ? o.tools : Math.round(s.events * between(r, 0.46, 0.62)),
      files: o.files != null ? o.files : int(r, kp.files[0], kp.files[1]),
      add: o.add != null ? o.add : int(r, kp.add[0], kp.add[1]),
      del: o.del != null ? o.del : int(r, kp.del[0], kp.del[1]),
      testsRun: o.testsRun != null ? o.testsRun : (kp.tests[1] > 0 && r() < pr.test ? int(r, Math.max(1, kp.tests[0]), kp.tests[1]) : 0),
      commits: o.commits != null ? o.commits : (r() < kp.commit ? int(r, 1, 2) : 0),
      verified: o.verified != null ? o.verified : int(r, kp.ver[0], kp.ver[1]),
      claimed: null,
      tin: known ? (o.tin != null ? o.tin : Math.round(s.events * perEv * kp.tok * between(r, 0.78, 1.22))) : null,
      tout: null
    };
    if (m.claimed == null) { let c = 0; for (let i = 0; i <= m.verified; i++) if (r() > pr.ver) c += 1; m.claimed = Math.min(c, kp.clm[1] + 1); }
    m.testsPass = o.testsPass != null ? o.testsPass : Math.max(0, m.testsRun - (r() < 0.25 ? 1 : 0));
    if (known) m.tout = o.tout != null ? o.tout : Math.round(m.tin * between(r, 0.05, 0.09));
    if (live) { m.verified = Math.min(m.verified, 1); m.claimed = Math.min(m.claimed, 1); }

    /* conversation */
    const items = [];
    const prompts = [], waits = [], perms = [];
    const chat = CHAT[sid];
    if (chat) {
      if (chat.old) {
        items.push({ type: 'divider', kind: 'old', text: `${Number(chat.oldDate.slice(5, 7))}月${Number(chat.oldDate.slice(8))}日 · 接入前开始的对话，续聊时完整同步（${chat.oldEvents} 个事件），按原始日期归期，不计入 ${Number(s.date.slice(5, 7))}月${Number(s.date.slice(8))}日` });
        chat.old.forEach((x) => items.push(Object.assign({ type: 'msg', old: true, date: chat.oldDate }, x)));
        items.push({ type: 'divider', kind: 'day', text: `${Number(s.date.slice(5, 7))}月${Number(s.date.slice(8))}日 · 继续会话` });
      }
      if (chat.backfill) items.push({ type: 'divider', kind: 'backfill', text: chat.backfill });
      let prevAgent = null, prevN = 0;
      chat.msgs.forEach((x, i) => {
        // tool calls between messages come from event numbers
        (chat.marks || []).filter((mk) => mk.after === prevN && prevN).forEach((mk) => items.push({ type: 'divider', kind: mk.kind, t: mk.t, text: mk.text }));
        // 工具调用发生在 Agent 工作期间：只在下一条是 Agent 消息时显示
        const toolsBetween = Math.max(0, Math.round((x.n - prevN - 1) * 0.62));
        if (i > 0 && toolsBetween && x.role === 'agent') items.push({ type: 'tools', count: toolsBetween, from: prevN + 1, to: x.n - 1 });
        if (x.role === 'user') {
          const at = toMin(x.t);
          if (prevAgent) {
            const w = at - toMin(prevAgent.t);
            const wait = { at: toMin(prevAgent.t), min: w, kind: 'turn', parallel: parallelAt(s.member, s.date, toMin(prevAgent.t), at, sid), clarify: !!x.f.afterClarify };
            waits.push(wait);
            items.push({ type: 'wait', min: w, parallel: wait.parallel });
          }
          prompts.push({ at, n: x.n, len: [...x.text].length, text: x.text, goal: !!x.f.goal, ctx: !!x.f.ctx, cons: !!x.f.cons, acc: !!x.f.acc, rework: !!x.f.rework, first: prompts.length === 0, cat: kind, clarified: !!x.f.afterClarify });
        }
        items.push(Object.assign({ type: 'msg' }, x));
        if (x.role === 'agent') prevAgent = x; else prevAgent = null;
        prevN = x.n;
      });
      (chat.perms || []).forEach((p) => perms.push({ at: toMin(p.t), min: p.min, cmd: p.cmd, kind: 'perm' }));
      m.clarifies = chat.msgs.filter((x) => x.clarify).length;
      m.turns = prompts.length;
    } else {
      // generated: prompt → agent work → (turn end) → wait → prompt …
      const dur = Math.max(12, end - start);
      const n = m.turns;
      let ws = Array.from({ length: n - 1 }, () => clamp(lognorm(r, pr.waitMed, 0.95), 0.2, 80));
      const wsum = ws.reduce((a, b) => a + b, 0);
      if (wsum > dur * 0.55) ws = ws.map((w) => (w * dur * 0.55) / wsum);
      const workLeft = dur - ws.reduce((a, b) => a + b, 0);
      const wr = Array.from({ length: n }, () => 0.6 + r());
      const wrs = wr.reduce((a, b) => a + b, 0);
      const works = wr.map((x) => (x * workLeft) / wrs);
      let t = start, ev = 1, clar = 0, lastClar = false, prevCtx = true;
      const toolPer = works.map((w) => Math.max(0, Math.round((m.tools * w) / workLeft)));
      for (let i = 0; i < n; i++) {
        const isLast = i === n - 1;
        const afterClarify = i > 0 && lastClar;
        // 缺少上下文的上一条提示词之后更容易返工（示例数据中的关系，报表里用于提示写法）
        const rework = i > 0 && !isLast && !afterClarify && r() < pr.rework * (prevCtx ? 0.6 : 1.7);
        let text;
        if (i === 0) text = FIRST[kind](s.title);
        else if (afterClarify) text = pick(r, CLA);
        else if (isLast && !live) text = pick(r, LAST);
        else if (rework) text = pick(r, REWORK);
        else text = pick(r, FOLLOW);
        const f = { goal: i === 0 ? r() < pr.goal : r() < pr.goal * 0.8, ctx: r() < pr.ctx * (i === 0 ? 1 : 0.6), cons: r() < pr.cons, acc: r() < pr.acc * (i === 0 ? 1 : 0.5), rework };
        prompts.push({ at: t, n: ev, len: [...text].length, text, goal: f.goal, ctx: f.ctx, cons: f.cons, acc: f.acc, rework, first: i === 0, cat: kind, clarified: !!afterClarify, generated: true });
        prevCtx = f.ctx;
        items.push({ type: 'msg', role: 'user', n: ev, t: fmtT(t), text, f });
        ev += 1;
        // agent work, permission waits inside
        const w = works[i];
        if (toolPer[i]) items.push({ type: 'tools', count: toolPer[i], from: ev, to: ev + toolPer[i] - 1 });
        if (r() < pr.permP && w > 2) {
          const pm = clamp(lognorm(r, pr.permMed, 0.9), 0.1, Math.max(0.2, w * 0.6));
          perms.push({ at: t + w * between(r, 0.2, 0.6), min: pm, cmd: kind === '运维' ? 'terraform plan' : kind === '测试' ? 'npm test' : pick(r, ['git diff --stat', 'pytest -q', 'go test ./...', 'npm run build']), kind: 'perm' });
        }
        ev += toolPer[i];
        t += w;
        const clarify = !isLast && r() < pr.clarify;
        if (clarify) clar += 1;
        lastClar = clarify;
        const atext = i === 0 ? AFIRST[kind] : clarify ? pick(r, CLQ) : isLast ? pick(r, ALAST) : pick(r, AMID);
        if (!(live && isLast)) items.push({ type: 'msg', role: 'agent', n: ev, t: fmtT(t), text: atext, clarify });
        ev += 1;
        if (!isLast) {
          const wmin = ws[i];
          const wait = { at: t, min: wmin, kind: 'turn', parallel: parallelAt(s.member, s.date, t, t + wmin, sid) };
          waits.push(wait);
          items.push({ type: 'wait', min: wmin, parallel: wait.parallel });
          t += wmin;
        }
      }
      if (live) items.push({ type: 'divider', kind: 'live', text: `进行中 · 截至 ${D.now.time} 仍在同步` });
      m.clarifies = clar;
    }
    if (sid === 's-h230') items.push({ type: 'divider', kind: 'live', text: `进行中 · 截至 ${D.now.time} 仍在同步` });
    waits.forEach((w) => { w.date = s.date; w.offHours = w.at >= 19 * 60 || w.at < 9 * 60; });
    perms.forEach((p) => { p.date = s.date; p.sid = sid; });
    m.prompts = prompts; m.waits = waits; m.perms = perms;
    m.waitMin = waits.reduce((a, w) => a + w.min, 0) + perms.reduce((a, p) => a + p.min, 0);
    m.activeMin = Math.max(1, end - start);
    m.workMin = Math.max(0, m.activeMin - m.waitMin);
    m.rework = prompts.filter((p) => p.rework).length;
    metrics[sid] = m;
    conv[sid] = items;

    /* activity events */
    const push = (e) => activity.push(Object.assign({ member: s.member, sid, date: s.date, agent: s.agent, project: s.project }, e));
    push({ at: start, type: 'start', text: prompts[0] ? prompts[0].text : s.title });
    items.forEach((it) => {
      if (it.type === 'msg' && !it.old && it.role === 'user' && it.n !== (prompts[0] && prompts[0].n)) push({ at: toMin(it.t), type: 'prompt', text: it.text, n: it.n, rework: !!(it.f && it.f.rework) });
      if (it.type === 'msg' && !it.old && it.role === 'agent') push({ at: toMin(it.t), type: 'reply', text: it.text, n: it.n, clarify: !!it.clarify, unverified: !!it.unverified });
    });
    waits.filter((w) => w.min >= 10).forEach((w) => push({ at: w.at, type: 'wait', min: w.min, parallel: w.parallel }));
    perms.filter((p) => p.min >= 3).forEach((p) => push({ at: p.at, type: 'perm', min: p.min, text: p.cmd }));
    (chat && chat.marks || []).forEach((mk) => push({ at: toMin(mk.t), type: mk.kind === 'gap' ? 'gap' : 'compact', text: mk.text }));
    if (!live && sid !== 's-h230') push({ at: end, type: 'end', text: `结束 · ${m.turns} 轮 · ${m.tools} 次工具调用` });

    /* assembly & dedup */
    const chunks = Math.max(3, Math.ceil(s.events / 4));
    const dupChunks = r() < 0.35 ? int(r, 1, 5) : 0;
    const asm = {
      sources: [{ kind: '原件文件', label: s.agent === 'Codex CLI' || s.agent === 'Codex Desktop' ? `~/.codex/sessions/2026/${s.date.slice(5, 7)}/${s.date.slice(8)}/rollout-${sid.slice(2)}.jsonl` : `~/.claude/projects/${s.project}/${sid.slice(2)}….jsonl`, detail: `${chunks} 个分块` }],
      chunks, dupChunks, dupEvents: dupChunks * 3, copied: 0, derived: 0,
      ops: ['按消息 UUID 与内容哈希去重', '按来源时间排序并校验事件序号连续'],
      at: `${Number(s.date.slice(5, 7))}月${Number(s.date.slice(8))}日 ${live ? D.now.time : s.end}`,
      state: live ? '组装中（同步中）' : '已组装'
    };
    assembly[sid] = asm;
  });

  /* special assembly cases (与会话详情一致) */
  Object.assign(assembly['s-7f3a'], {
    sources: [
      { kind: '原件文件', label: '~/.claude/projects/billing-service/7f3a92c1….jsonl', detail: '快照 g1（压缩前）+ g2 · 38 个分块' },
      { kind: '子会话', label: 's-7f3a-sub1 · Explore', detail: '14 个事件，作为侧链关联' }
    ],
    chunks: 38, dupChunks: 5, dupEvents: 14, derived: 1,
    ops: ['网络重试导致 5 个分块重复上传 → 按（来源, 偏移, 哈希）幂等丢弃', '压缩后的摘要消息标记为派生内容，不重复计入轮次与统计', '子会话 s-7f3a-sub1 按父事件 #12 关联为侧链', '#58–#61 附件在上游不可得 → 记录缺口，不生成替代内容'],
    at: '9月23日 11:49', state: '已组装 · 当前快照完整'
  });
  Object.assign(assembly['s-2c90'], {
    sources: [
      { kind: '原件文件（续聊）', label: '~/.claude/projects/data-pipeline/2c90….jsonl', detail: '9月23日 继续使用' },
      { kind: '旧会话原件', label: '9月2日 开始的同一会话（接入前）', detail: '续聊时从开头完整同步' }
    ],
    chunks: 61, dupChunks: 0, dupEvents: 198, copied: 198,
    ops: ['续聊文件中复制的 198 条早期消息按原始 UUID 合并，只保留一份', '早期事件保留 9月2日 的来源时间，不计入 9月23日 的活动', '谱系：同一会话的继续，不视为新会话'],
    at: '9月23日 12:41', state: '已组装 · 续聊合并'
  });
  ['s-x118', 's-x120'].forEach((sid) => Object.assign(assembly[sid], {
    dupChunks: sid === 's-x118' ? 4 : 2, dupEvents: sid === 's-x118' ? 12 : 5,
    ops: ['离线期间暂存在本机队列的分块于 9月23日 10:20 补传', '补传分块与离线前已收到的部分按事件序号拼接，重试产生的重复事件已丢弃', '按来源时间归入 9月22日，触发当日日报重算（v2）'],
    at: '9月23日 10:20', state: '已组装 · 补传并入'
  }));
  Object.assign(assembly['s-c530'], { sources: [{ kind: '子会话原件', label: 'Codex Desktop 子任务（Storybook 用例）', detail: '父会话 s-c517' }], ops: ['识别为 s-c517 的子任务，关联谱系，活动不重复计算'], state: '已组装 · 子会话' });
  Object.assign(assembly['s-h230'], { ops: ['11:30–12:10 本地未能暂存 → 标记缺口；缺口前后的分块按序号分别组装', '组装中：会话仍在进行'], state: '组装中 · 存在缺口' });

  /* backfill + pipeline events for the activity log */
  activity.push({ member: 'xu-ruoxi', sid: 's-x118', date: '2026-09-23', agent: 'Codex Desktop', project: 'mobile-app', at: toMin('10:20'), type: 'backfill', text: '补传 9月22日 离线期间的 2 个会话（s-x118、s-x120），去重 17 条重复事件，9月22日 日报重算为 v2' });
  activity.push({ member: 'xu-ruoxi', sid: 's-x140', date: '2026-09-24', agent: 'Claude Code CLI', project: 'mobile-app', at: toMin('12:31'), type: 'offline', text: '设备离线（最近心跳 12:31），之后的材料暂存在本机，恢复连接后补传' });
  activity.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);

  /* recompute day stats from sessions so every view agrees */
  Object.entries(D.days).forEach(([mid, days]) => Object.entries(days).forEach(([iso, rec]) => {
    const list = Object.entries(SES).filter(([, s]) => s.member === mid && s.date === iso);
    if (!list.length) return;
    const ms = list.map(([sid]) => metrics[sid]);
    const knownT = ms.filter((x) => x.known);
    rec.stats = {
      sessions: list.length,
      turns: ms.reduce((a, x) => a + x.turns, 0),
      tools: ms.reduce((a, x) => a + x.tools, 0),
      files: ms.reduce((a, x) => a + x.files, 0),
      tin: knownT.length ? knownT.reduce((a, x) => a + x.tin, 0) : null,
      tout: knownT.length ? knownT.reduce((a, x) => a + x.tout, 0) : null,
      unknownTokens: ms.filter((x) => !x.known).length,
      intervals: list.map(([sid, s]) => [s.start, /\d/.test(s.end) ? s.end : D.now.time, sid, !/\d/.test(s.end)])
    };
  }));

  /* ---------- pipeline summary（今日，示例） ---------- */
  const today = Object.entries(SES).filter(([, s]) => s.date === D.now.date);
  const pipeline = {
    stages: [
      { k: '拾取', v: 23, d: '来源文件（8 个运行环境，hooks 登记 + 后台核对）' },
      { k: '接收分块', v: 612, d: '已持久化并校验哈希' },
      { k: '去重', v: 41, d: '重复分块（网络重试、续聊复制、重复投递）' },
      { k: '组装会话', v: today.length + 2, d: `今日 ${today.length} 个 · 补传并入 2 个` },
      { k: '解析与指标', v: 1284, d: '规范化事件 · 解析失败 0' },
      { k: '报告', v: 6, d: '日报批次 09:00 · 迟到数据重算 1' }
    ],
    lag: { p95: '38 秒', note: '事件发生到原文可查询（约定试点负载，示例）' },
    pending: [{ sid: 's-h210', text: 'han-ws 上发现两个内容重叠 71% 的会话文件（跨目录复制），无法确定是续聊还是副本，暂按两个会话保存，等待确认谱系。' }]
  };

  /* ---------- helpers exposed to the UI ---------- */
  const median = (xs) => { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y); const h = Math.floor(a.length / 2); return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };
  const quant = (xs, q) => { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y); const i = (a.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
  const RANGES = {
    W39: { label: '本周 W39', from: '2026-09-21', to: '2026-09-27' },
    W38: { label: '上周 W38', from: '2026-09-14', to: '2026-09-20' },
    all: { label: '接入至今', from: '2026-09-14', to: '2026-09-27' }
  };
  const daysOf = (range) => { const out = []; const R = RANGES[range]; let d = new Date(`${R.from}T00:00:00Z`); const end = new Date(`${R.to}T00:00:00Z`); while (d <= end) { const iso = d.toISOString().slice(0, 10); if (iso <= D.now.date) out.push(iso); d = new Date(d.getTime() + 864e5); } return out; };
  const sessionsIn = (f) => Object.entries(SES).filter(([, s]) => {
    const R = RANGES[f.range || 'W39'];
    return s.date >= R.from && s.date <= R.to && (f.member === 'all' || !f.member || s.member === f.member) && (f.agent === 'all' || !f.agent || s.agent === f.agent) && (f.project === 'all' || !f.project || s.project === f.project);
  });
  const agg = (list) => {
    const ms = list.map(([sid]) => metrics[sid]);
    const known = ms.filter((x) => x.known);
    const prompts = ms.flatMap((x) => x.prompts);
    const waits = ms.flatMap((x) => x.waits);
    const perms = ms.flatMap((x) => x.perms);
    const nonFirst = prompts.filter((p) => !p.first);
    return {
      sessions: list.length, known: known.length, unknown: ms.length - known.length,
      tin: known.reduce((a, x) => a + x.tin, 0), tout: known.reduce((a, x) => a + x.tout, 0),
      turns: ms.reduce((a, x) => a + x.turns, 0), tools: ms.reduce((a, x) => a + x.tools, 0), files: ms.reduce((a, x) => a + x.files, 0),
      add: ms.reduce((a, x) => a + x.add, 0), del: ms.reduce((a, x) => a + x.del, 0),
      testsRun: ms.reduce((a, x) => a + x.testsRun, 0), testsPass: ms.reduce((a, x) => a + x.testsPass, 0), commits: ms.reduce((a, x) => a + x.commits, 0),
      verified: ms.reduce((a, x) => a + x.verified, 0), claimed: ms.reduce((a, x) => a + x.claimed, 0),
      prompts, waits, perms,
      promptN: prompts.length,
      lenMed: median(prompts.map((p) => p.len)),
      ctxRate: prompts.length ? prompts.filter((p) => p.ctx).length / prompts.length : null,
      goalRate: prompts.length ? prompts.filter((p) => p.goal).length / prompts.length : null,
      consRate: prompts.length ? prompts.filter((p) => p.cons).length / prompts.length : null,
      accRate: prompts.length ? prompts.filter((p) => p.acc).length / prompts.length : null,
      reworkRate: nonFirst.length ? nonFirst.filter((p) => p.rework).length / nonFirst.length : null,
      cleanShare: ms.length ? ms.filter((x) => x.rework === 0).length / ms.length : null,
      clarifyRate: prompts.length ? ms.reduce((a, x) => a + (x.clarifies || 0), 0) / prompts.length : null,
      waitMed: median(waits.map((w) => w.min)), waitP90: quant(waits.map((w) => w.min), 0.9),
      longShare: waits.length ? waits.filter((w) => w.min >= 10).length / waits.length : null,
      permMed: median(perms.map((p) => p.min)),
      parallelShare: waits.length ? waits.filter((w) => w.parallel).length / waits.length : null,
      activeMin: ms.reduce((a, x) => a + x.activeMin, 0)
    };
  };
  const ratio = (m) => (m.known && m.tin ? m.verified / (m.tin / 1e6) : null);
  const codeRatio = (m) => (m.known && m.tin ? (m.add + m.del) / (m.tin / 1e6) : null);

  /* ---------- Agent 使用能力评估（原型口径：绝对锚点、任务类型校正、样本不足不评级） ---------- */
  const wday = (iso) => { const [y, mo, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); };
  const lin = (v, a, b) => (v == null || Number.isNaN(v) ? null : Math.max(0, Math.min(100, ((v - a) / (b - a)) * 100)));
  const mean = (xs) => { const v = xs.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
  const PRESETS = {
    默认: { adopt: 20, prompt: 20, iter: 20, verify: 20, output: 15, flow: 5 },
    重产出: { adopt: 15, prompt: 15, iter: 15, verify: 15, output: 35, flow: 5 },
    重质量: { adopt: 10, prompt: 25, iter: 25, verify: 30, output: 10, flow: 0 }
  };
  // 每个指标：值 → 0–100 的线性锚点（a 得 0 分，b 得 100 分；a > b 表示越低越好）
  const DIMS = [
    { k: 'adopt', name: '使用深度', q: '是否把 Agent 用进日常工作', metrics: [
      { k: 'activeShare', name: '活跃天数占比', a: 0.3, b: 0.9, fmt: 'pct', note: '有会话的工作日 ÷ 接入以来的工作日' },
      { k: 'perDay', name: '活跃日会话数', a: 0.6, b: 1.8, fmt: 'num1', note: '会话数 ÷ 活跃天数' }] },
    { k: 'prompt', name: '需求表达', q: '提示词是否写清楚', metrics: [
      { k: 'elem', name: '首条提示词要素覆盖', a: 0.3, b: 0.75, fmt: 'pct', note: '每个会话第一条提示词中，目标、约束、上下文、验收四项的平均出现率（模型推断）；后续追问本就简短，不计入' },
      { k: 'clarify', name: 'Agent 追问率', a: 0.2, b: 0.03, fmt: 'pct', note: '越低越好：Agent 需要回头澄清需求的比例' }] },
    { k: 'iter', name: '迭代效率', q: '来回修改多不多', metrics: [
      { k: 'rework', name: '返工率', a: 0.28, b: 0.05, fmt: 'pct', note: '越低越好：纠正或推翻上一轮结果的提示词占比' },
      { k: 'clean', name: '无返工会话占比', a: 0.2, b: 0.85, fmt: 'pct', note: '整段会话没有返工提示词' },
      { k: 'turnsPerVer', name: '每条已验证结果的轮次', a: 14, b: 3, fmt: 'num1', note: '越低越好：提示词数 ÷ 已验证结果' }] },
    { k: 'verify', name: '验证把关', q: '结果有没有经过验证', metrics: [
      { k: 'verShare', name: '已验证占比', a: 0.5, b: 0.95, fmt: 'pct', note: '已验证 ÷（已验证 + 仅声称）' },
      { k: 'testShare', name: '运行测试的会话占比', a: 0.15, b: 0.8, fmt: 'pct', note: '只看实现、修复、重构、测试类会话；运维与排查不要求测试' }] },
    { k: 'output', name: '产出转化', q: '投入是否变成可核对的结果', metrics: [
      { k: 'outIdx', name: '已验证结果（按任务类型校正）', a: 0.5, b: 1.4, fmt: 'x', note: '每个会话的已验证结果 ÷ 团队同类任务均值' },
      { k: 'effIdx', name: '产效比（按任务类型校正）', a: 0.5, b: 1.5, fmt: 'x', note: '产效比 ÷ 团队同类任务中位数；Token 未知的会话不参与' }] },
    { k: 'flow', name: '协作节奏', q: 'Agent 是否常被卡住', metrics: [
      { k: 'permMed', name: '权限等待中位数', a: 6, b: 0.8, fmt: 'min', note: '越低越好：常用只读命令未加入允许列表会拉长' },
      { k: 'longShare', name: '10 分钟以上等待占比', a: 0.35, b: 0.05, fmt: 'pct', note: '越低越好；期间在其他会话中活动的等待不计入' }] }
  ];
  const LEVELS = [[72, '较好', 'ok'], [60, '一般', 'info'], [0, '需提升', 'warn']];
  const TIPS = {
    adopt: '把排查、补测试、整理文档这类日常任务也交给 Agent，保持每个工作日都在用',
    prompt: null, // 按最弱的提示词要素给出
    iter: '动手前让 Agent 先复述方案并确认；把不能改动的范围写进第一条提示词',
    verify: '要求 Agent 运行测试并贴出结果；对“已验证”“已通过”的说法追问证据',
    output: '把任务拆小，每个会话以一个可验证的结果收尾（测试通过或提交）',
    flow: '把 git diff、测试等只读命令加入允许列表，减少 Agent 等待批准'
  };
  const ELEM_TIPS = { goal: '第一句写清要达成的目标', cons: '写明不能改动的文件、接口或环境', ctx: '附上文件路径、报错日志或复现步骤', acc: '写明怎样算完成，例如要跑哪些测试' };

  // 团队基准（按任务类型）：用全部已存档会话计算
  const kindBase = {};
  KINDS.forEach((k) => {
    const ms = Object.entries(SES).filter(([sid, s]) => metrics[sid].kind === k && /\d/.test(s.end)).map(([sid]) => metrics[sid]);
    const rs = ms.filter((m) => m.known && m.tin).map((m) => m.verified / (m.tin / 1e6));
    kindBase[k] = { ver: Math.max(0.5, mean(ms.map((m) => m.verified)) || 1), ratio: median(rs) || null };
  });

  const profCache = {};
  const prof = (mid, range = 'all', preset = '默认') => {
    const key = `${mid}|${range}|${preset}`;
    if (profCache[key]) return profCache[key];
    const member = D.members.find((m) => m.id === mid);
    const R = RANGES[range];
    const list = sessionsIn({ range, member: mid });
    const done = list.filter(([, s]) => /\d/.test(s.end));
    const a = agg(list);
    const from = R.from > member.joined ? R.from : member.joined;
    const workdays = daysOf(range).filter((d) => d >= from && wday(d) !== 0 && wday(d) !== 6).length;
    const activeDays = new Set(list.map(([, s]) => s.date)).size;
    const ms = list.map(([sid]) => metrics[sid]);
    const dms = done.map(([sid]) => metrics[sid]);
    const knownDone = dms.filter((m) => m.known && m.tin);
    const nonParallelWaits = a.waits.filter((w) => !w.parallel);
    const raw = {
      activeShare: workdays ? activeDays / workdays : null,
      perDay: activeDays ? list.length / activeDays : null,
      elem: (() => { const fp = a.prompts.filter((q) => q.first); return fp.length >= 3 ? mean(['goal', 'cons', 'ctx', 'acc'].map((k) => fp.filter((q) => q[k]).length / fp.length)) : null; })(),
      clarify: a.clarifyRate,
      rework: a.reworkRate,
      clean: a.cleanShare,
      turnsPerVer: a.promptN ? a.turns / Math.max(0.5, a.verified) : null,
      verShare: a.verified + a.claimed >= 4 ? a.verified / (a.verified + a.claimed) : null,
      testShare: (() => { const t = ms.filter((m) => ['实现', '修复', '重构', '测试'].includes(m.kind)); return t.length >= 3 ? t.filter((m) => m.testsRun > 0).length / t.length : null; })(),
      outIdx: dms.length >= 3 ? mean(dms.map((m) => m.verified / kindBase[m.kind].ver)) : null,
      effIdx: knownDone.length >= 3 ? mean(knownDone.map((m) => { const b = kindBase[m.kind].ratio; return b ? (m.verified / (m.tin / 1e6)) / b : null; })) : null,
      permMed: a.permMed,
      longShare: nonParallelWaits.length ? nonParallelWaits.filter((w) => w.min >= 10).length / nonParallelWaits.length : null
    };
    const dims = {};
    DIMS.forEach((dm) => {
      const mets = dm.metrics.map((mt) => ({ ...mt, value: raw[mt.k], score: lin(raw[mt.k], mt.a, mt.b) }));
      dims[dm.k] = { k: dm.k, name: dm.name, q: dm.q, metrics: mets, score: mean(mets.map((x) => x.score)) };
    });
    const W = PRESETS[preset] || PRESETS.默认;
    let ws = 0, sum = 0;
    DIMS.forEach((dm) => { const sc = dims[dm.k].score; if (sc != null && W[dm.k]) { ws += W[dm.k]; sum += W[dm.k] * sc; } });
    // 页面显示整数，分档也按显示值判断，避免出现“72 · 一般”
    const index = ws ? Math.round(sum / ws) : null;
    const trust = member.devices.some((d) => d.clients.some((c) => c.issue === 'trust'));
    let conf = list.length >= 8 && a.promptN >= 40 ? 3 : list.length >= 5 && a.promptN >= 25 ? 2 : 1;
    if (trust) conf = Math.max(1, conf - 1);
    const margin = list.length ? Math.round(26 / Math.sqrt(list.length)) : null;
    const level = conf === 1 || index == null ? ['待定', 'neutral'] : (() => { const L = LEVELS.find(([t]) => index >= t); return [L[1], L[2]]; })();
    const scored = DIMS.map((dm) => dims[dm.k]).filter((d) => d.score != null);
    const strengths = scored.filter((d) => Math.round(d.score) >= 70).sort((p, q) => q.score - p.score).slice(0, 2);
    const gaps = scored.filter((d) => Math.round(d.score) < 60).sort((p, q) => p.score - q.score).slice(0, 2);
    const weakestElem = [['goal', a.goalRate], ['cons', a.consRate], ['ctx', a.ctxRate], ['acc', a.accRate]].filter((x) => x[1] != null).sort((p, q) => p[1] - q[1])[0];
    const tips = gaps.map((g) => ({ dim: g.name, text: g.k === 'prompt' ? (weakestElem ? ELEM_TIPS[weakestElem[0]] : '写清目标、约束、上下文与验收方式') : TIPS[g.k] }));
    // 代表性会话：最好 = 已验证多且无返工；待改进 = 返工多或声称多于已验证
    const sorted = done.map(([sid, s]) => ({ sid, s, m: metrics[sid] }));
    const best = sorted.filter((x) => x.m.verified > 0 && x.m.rework === 0).sort((p, q) => q.m.verified - p.m.verified || (p.m.tin || 9e9) - (q.m.tin || 9e9))[0] || null;
    const worst = sorted.filter((x) => x.m.rework >= 1 || x.m.claimed > x.m.verified).sort((p, q) => (q.m.rework + q.m.claimed - q.m.verified) - (p.m.rework + p.m.claimed - p.m.verified))[0] || null;
    const out = {
      mid, range, preset, index, margin, conf, confLabel: ['', '低', '中', '高'][conf], level: level[0], tone: level[1],
      dims, raw, strengths, gaps, tips, best, worst, trust,
      sample: { sessions: list.length, prompts: a.promptN, activeDays, workdays, unknownTok: a.unknown },
      agg: a
    };
    profCache[key] = out;
    return out;
  };
  const teamDimMedian = (range = 'all', preset = '默认') => {
    const out = {};
    DIMS.forEach((dm) => { out[dm.k] = median(D.members.map((m) => prof(m.id, range, preset).dims[dm.k].score).filter((x) => x != null)); });
    return out;
  };

  D.metrics = metrics; D.conv = conv; D.activity = activity; D.assembly = assembly; D.pipeline = pipeline; D.kinds = KINDS;
  window.SkyData = { metrics, conv, activity, assembly, pipeline, KINDS, RANGES, daysOf, sessionsIn, agg, median, quant, ratio, codeRatio, toMin, fmtT, prof, teamDimMedian, DIMS, PRESETS, LEVELS, wday };
})();
