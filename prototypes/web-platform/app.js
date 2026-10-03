/* PROTOTYPE — Skynet 观察台 · Web 平台原型（可丢弃）。
 * 问题：Skynet 的 Web 平台应该长什么样？团队概览用哪种结构最能读懂一天/一周的工作与覆盖状态？
 * 加载顺序：data.js（示例数据）→ app.js（路由、外壳、共享组件）→ pages.js（各页面）→ variants.js（团队概览 A/B/C + 原型切换条）
 * 状态只在内存中；刷新即复位。
 */
(() => {
  'use strict';
  const D = window.SKY;
  const PROTOTYPE = true; // 正式构建中不渲染原型切换条与“示例数据”标记

  /* ---------------- basics ---------------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const M = Object.fromEntries(D.members.map((m) => [m.id, m]));
  const DEV = {};
  D.members.forEach((m) => m.devices.forEach((d) => { DEV[d.id] = Object.assign({ member: m.id }, d); }));

  const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WDS = ['日', '一', '二', '三', '四', '五', '六'];
  const ymd = (iso) => iso.split('-').map(Number);
  const weekday = (iso) => { const [y, m, d] = ymd(iso); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const md = (iso) => { const [, m, d] = ymd(iso); return `${m}月${d}日`; };
  const dnum = (iso) => ymd(iso)[2];
  const dayLabel = (iso) => `${md(iso)} ${WD[weekday(iso)]}`;
  const isToday = (iso) => iso === D.now.date;
  const isFuture = (iso) => iso > D.now.date;
  const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

  const fmtTok = (n) => {
    if (n == null) return null;
    if (n === 0) return '0';
    if (n >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
    return String(n);
  };

  const dayRec = (mid, iso) => {
    const r = (D.days[mid] || {})[iso];
    if (r) return r;
    return { state: isFuture(iso) ? 'future' : 'none', flags: [], themes: [], stats: null, report: null };
  };

  /* ---------------- icons (one stroke voice, 24px grid) ---------------- */
  const P = {
    overview: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4"/>',
    person: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c1.3-3.6 3.9-5.5 7.2-5.5s5.9 1.9 7.2 5.5"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4.2l2 2.2h6.8a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    session: '<path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4 3.5v-3.5h-.5a2 2 0 0 1-2-2z"/>',
    restore: '<path d="M4.2 12.5A7.8 7.8 0 1 0 6.6 6.4"/><path d="M4.5 3.8v4.4h4.4"/><path d="M12 8.2V12l2.8 1.7"/>',
    device: '<rect x="4.5" y="5" width="15" height="10" rx="1.6"/><path d="M2.8 18.8h18.4"/>',
    pulse: '<path d="M3 12.5h4l2.4-6 5 11.5 2.6-5.5H21"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m20 20-4.4-4.4"/>',
    'chev-l': '<path d="m14.5 6-6 6 6 6"/>',
    'chev-r': '<path d="m9.5 6 6 6-6 6"/>',
    'chev-d': '<path d="m6 9.5 6 6 6-6"/>',
    check: '<path d="m5 12.8 4.4 4.4L19 7.6"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    alert: '<path d="M12 4.2 21 19.6H3z"/><path d="M12 10v4.6M12 17.1v.4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    offline: '<path d="M3.8 9.6a12.5 12.5 0 0 1 4.3-2.5M20.2 9.6a12.5 12.5 0 0 0-8.3-3.1M7.4 13.2a7 7 0 0 1 3-1.7M16.6 13.2a7 7 0 0 0-1.3-.9M12 17.4v.5M4 4l16 16"/>',
    shield: '<path d="M12 3.4 19 6v5.6c0 4.1-2.9 7.4-7 8.9-4.1-1.5-7-4.8-7-8.9V6z"/><path d="M10 9.8a2 2 0 1 1 2.9 1.8c-.6.3-.9.7-.9 1.3v.4M12 15.6v.4"/>',
    download: '<path d="M12 4v11M7.4 10.6 12 15.2l4.6-4.6M5 19.5h14"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.4a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    edit: '<path d="M14.6 5.4l4 4L8.2 19.8H4.2v-4z"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 0 1-13.3 4.8M4.5 12a7.5 7.5 0 0 1 13.3-4.8"/><path d="M18.2 3.5v3.9h-3.9M5.8 20.5v-3.9h3.9"/>',
    branch: '<circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="8.5" r="2"/><path d="M6.5 7.5v9M17.5 10.5c0 4-5.4 3.2-9.6 6.6"/>',
    compress: '<path d="M9 3.8V9H3.8M15 3.8V9h5.2M9 20.2V15H3.8M15 20.2V15h5.2"/>',
    file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>',
    diff: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M9.6 11.5h4.8M12 9.1v4.8M9.6 16.6h4.8"/>',
    terminal: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    note: '<path d="M5 5.5h14v10h-8.6L5 19.5z"/><path d="M12 8v5M9.5 10.5h5"/>',
    tag: '<path d="M4 4.5h7.6L20 12.9l-7.1 7.1-8.4-8.4z"/><circle cx="8.6" cy="8.6" r="1.3"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
    out: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v5.5H4.5V6H10"/>',
    obs: '<rect x="4" y="4" width="16" height="16" rx="3.2"/><path d="m8.2 12.3 2.7 2.8 5-5.8"/>',
    quote: '<path d="M4.5 5.5h15v10h-8.6l-4.4 3.6v-3.6h-2z"/><path d="M8 9.4h8M8 12.2h5"/>',
    infer: '<path d="M4.5 9.6c2.5-2.2 5-2.2 7.5 0s5 2.2 7.5 0M4.5 14.6c2.5-2.2 5-2.2 7.5 0s5 2.2 7.5 0"/>',
    none: '<circle cx="12" cy="12" r="8"/><path d="m6.4 17.6 11.2-11.2"/>',
    bot: '<rect x="4.5" y="6.8" width="15" height="12" rx="3.2"/><path d="M12 3.6v3.2M9.2 12.2v1.2M14.8 12.2v1.2"/>',
    grid: '<rect x="4" y="4" width="16" height="16" rx="2.2"/><path d="M4 9.4h16M4 14.6h16M9.4 4v16M14.6 4v16"/>',
    list: '<path d="M9 7h10.5M9 12h10.5M9 17h10.5M4.6 7h.6M4.6 12h.6M4.6 17h.6"/>',
    key: '<circle cx="8" cy="15.4" r="3.6"/><path d="m10.6 12.8 8-8M16 7.3l2.1 2.1M13.9 9.4l1.6 1.6"/>',
    ban: '<circle cx="12" cy="12" r="8"/><path d="m6.4 6.4 11.2 11.2"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>',
    archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1.2"/><path d="M5 8.5v10a1.6 1.6 0 0 0 1.6 1.6h10.8a1.6 1.6 0 0 0 1.6-1.6v-10M10 12.5h4"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8v.4"/>',
    heart: '<path d="M3 12h3.6l2-4 3.4 8 2.2-4.4H21"/>',
    live: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.8"/>',
    layers: '<path d="m12 4 8.4 4.4L12 12.8 3.6 8.4z"/><path d="m3.6 12.4 8.4 4.4 8.4-4.4M3.6 16.2 12 20.6l8.4-4.4"/>',
    play: '<circle cx="12" cy="12" r="8.5"/><path d="m10.2 8.8 5 3.2-5 3.2z"/>',
    chart: '<path d="M4.5 19.5h15"/><path d="M7.5 16.5v-5M12 16.5V7.5M16.5 16.5v-3"/>',
    gauge: '<path d="M4.4 16.2a8 8 0 1 1 15.2 0"/><path d="m12 13.2 3.4-3.6"/><circle cx="12" cy="13.6" r="1.2"/>'
  };
  const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;

  /* ---------------- state ---------------- */
  const S = {
    r: 'team', a: [],
    variant: 'C',   // 已选定：C · 覆盖矩阵（A/B 仍可通过 #team.a / #team.b 查看）
    teamDay: '2026-09-23',
    cSel: 'lin-yue', cDay: '2026-09-23',
    drawer: null,
    ver: {},            // `${mid}|${iso}` → 选中的报告版本
    rerun: {},          // `${mid}|${iso}` → { state, v }
    notes: {},          // `${mid}|${iso}` → [{kind,text,at}]
    sessView: 'chat', sessQ: '', expanded: {},
    sessFilter: { agent: 'all', member: 'all' },
    rec: { step: 1, member: 'lin-yue', date: '2026-09-23', session: 's-7f3a', method: 'native', snap: 'g2', prepared: false },
    revoked: {}, confirmRevoke: null,
    jobs: {},
    search: false, q: '退款', qi: 0,
    menu: false,
    toast: null,
    showW38: false
  };

  /* ---------------- shared components ---------------- */
  const tone = (pid) => (D.projects[pid] || D.projects.unclassified).tone;
  const avatar = (m, size = '') => `<span class="av ${size ? 'av--' + size : ''}" data-tone="${m.tone}" aria-hidden="true">${esc(m.initial)}</span>`;
  const projChip = (pid, extra = '') => {
    const p = D.projects[pid] || D.projects.unclassified;
    return `<span class="pchip ${pid === 'unclassified' ? 'pchip--none' : ''}" data-tone="${p.tone}"><i class="dot" aria-hidden="true"></i>${esc(p.name)}${extra}</span>`;
  };
  const pill = (kind, text, ico) => `<span class="pill pill--${kind}">${ico ? icon(ico) : ''}${text}</span>`;

  const EVK = { obs: ['工具结果', 'obs'], claim: ['声称', 'quote'], infer: ['模型推断', 'infer'], gap: ['材料不足', 'none'] };
  const evLabel = (e) => (e.k === 'claim' ? (e.who === 'agent' ? 'Agent 自述' : '用户陈述') : EVK[e.k][0]);
  const evBadge = (e) => {
    const ref = e.s ? `<span class="ev__ref">${esc(e.s)} #${e.e}</span>` : '';
    const inner = `${icon(EVK[e.k][1])}<span class="ev__k">${evLabel(e)}</span>${ref}`;
    const tip = esc(e.t || '');
    if (e.s) {
      const route = `session.${e.s}.e${e.e}`;
      return `<a class="ev ev--${e.k}" href="#${route}" data-go="${route}" title="${tip}" aria-label="${evLabel(e)}：${tip}，打开 ${esc(e.s)} 第 ${e.e} 个事件">${inner}</a>`;
    }
    return `<span class="ev ev--${e.k}" title="${tip}">${inner}</span>`;
  };
  const evLegend = () => `<div class="evlegend" aria-label="证据类型">
      <span class="ev ev--obs">${icon('obs')}<span class="ev__k">工具结果</span></span><span class="evlegend__t">已观察到的工具返回</span>
      <span class="ev ev--claim">${icon('quote')}<span class="ev__k">声称</span></span><span class="evlegend__t">用户或 Agent 的陈述</span>
      <span class="ev ev--infer">${icon('infer')}<span class="ev__k">模型推断</span></span><span class="evlegend__t">分析模型的推断</span>
      <span class="ev ev--gap">${icon('none')}<span class="ev__k">材料不足</span></span><span class="evlegend__t">原件缺失或覆盖不完整</span>
    </div>`;

  // 活动统计：null → 未知（不当 0）
  const statCells = (st, opts = {}) => {
    if (!st) return `<p class="muted">没有统计：该日期没有登记的活动或尚未到达。</p>`;
    const tok = (() => {
      if (st.tin == null && st.tout == null) return `<span class="unk" title="客户端未上报用量">未知</span>`;
      const base = `${fmtTok(st.tin)} / ${fmtTok(st.tout)}`;
      return st.unknownTokens ? `${base} <span class="unk" title="${st.unknownTokens} 个会话未上报用量">+${st.unknownTokens} 未知</span>` : base;
    })();
    const rows = [
      ['会话', st.sessions, '当天有事件的会话数（含子会话，按来源时间归期）'],
      ['用户轮次', st.turns, '用户提交的消息数，不含工具结果'],
      ['工具调用', st.tools, 'Agent 发起的工具调用次数'],
      ['涉及文件', st.files, '工具调用中读写过的不同文件'],
      ['Token 输入/输出', tok, '客户端可取得的用量；未上报的会话标为未知，不计为 0']
    ];
    return `<dl class="stats ${opts.compact ? 'stats--compact' : ''}">${rows.map(([k, v, def]) => `<div class="stats__row"><dt title="${esc(def)}">${k}</dt><dd class="num">${v}</dd></div>`).join('')}</dl>`;
  };
  const statLine = (st) => {
    if (!st) return '';
    const tok = st.tin == null ? '<span class="unk">Token 未知</span>' : `Token ${fmtTok(st.tin)}/${fmtTok(st.tout)}${st.unknownTokens ? ' <span class="unk">+未知</span>' : ''}`;
    return `<p class="statline num">${st.sessions} 会话 · ${st.turns} 轮 · ${st.tools} 次工具调用 · ${st.files} 个文件 · ${tok}</p>`;
  };

  // 活跃区间标尺：07:00–21:00；重叠的会话分道显示，不相加
  const ruler = (intervals, opts = {}) => {
    const lo = 7 * 60, hi = 21 * 60, span = hi - lo;
    if (!intervals || !intervals.length) return `<div class="ruler ruler--empty"><span class="muted">无事件活跃区间</span></div>`;
    const lanes = [];
    const bars = intervals.map(([a, b, sid, live]) => {
      const s = toMin(a), e = toMin(b);
      let lane = lanes.findIndex((end) => end <= s);
      if (lane === -1) { lane = lanes.length; lanes.push(e); } else lanes[lane] = e;
      const left = Math.max(0, (s - lo) / span * 100), width = Math.max(1.2, (Math.min(e, hi) - s) / span * 100);
      const ses = D.sessions[sid];
      const tn = ses ? tone(ses.project) : 'slate';
      return `<span class="ruler__bar ${live ? 'is-live' : ''}" data-tone="${tn}" style="--l:${left.toFixed(2)}%;--w:${width.toFixed(2)}%;--lane:${lane}" title="${esc(sid)} · ${a}–${b}${live ? '（进行中）' : ''}"></span>`;
    }).join('');
    const ticks = [8, 12, 16, 20].map((h) => `<span class="ruler__tick" style="--l:${((h * 60 - lo) / span * 100).toFixed(2)}%">${String(h).padStart(2, '0')}</span>`).join('');
    return `<div class="ruler" style="--lanes:${Math.max(1, lanes.length)}" role="img" aria-label="事件活跃区间：${intervals.map((i) => i[0] + '–' + i[1]).join('，')}">
        <div class="ruler__track">${bars}</div><div class="ruler__axis">${ticks}</div>
      </div>${opts.caption === false ? '' : `<p class="ruler__cap">并发会话分道显示、不相加；活跃区间不是工时。</p>`}`;
  };

  const notice = (kind, ico, html) => `<div class="notice notice--${kind}" role="note">${icon(ico)}<div>${html}</div></div>`;
  const empty = (ico, title, text, action = '') => `<div class="empty">${icon(ico, 'empty__ico')}<p class="empty__t">${title}</p><p class="empty__d">${text}</p>${action}</div>`;
  const pageHead = ({ title, sub = '', actions = '', crumbs = '' }) => `
    <header class="phead">
      ${crumbs ? `<nav class="crumbs" aria-label="位置">${crumbs}</nav>` : ''}
      <div class="phead__row">
        <div class="phead__title"><h1>${title}</h1>${sub ? `<p class="phead__sub">${sub}</p>` : ''}</div>
        ${actions ? `<div class="phead__actions">${actions}</div>` : ''}
      </div>
    </header>`;
  const copyBtn = (text, label = '复制') => `<button type="button" class="btn btn--quiet btn--sm copy" data-act="copy" data-text="${esc(text)}">${icon('copy')}<span class="copy__l">${label}</span></button>`;

  // 状态：每位员工某日的覆盖与分析状态（用于三个变体与员工页）
  const dayStates = (mid, iso) => {
    const r = dayRec(mid, iso);
    const out = [];
    if (r.state === 'future') return [{ k: 'future', label: '未到达', ico: 'clock', tone: 'neutral' }];
    if (r.state === 'none') out.push({ k: 'none', label: '无活动', ico: 'none', tone: 'neutral', detail: `设备在线，最近心跳 ${r.heartbeat || '—'}` });
    if (r.state === 'today') out.push({ k: 'live', label: '进行中', ico: 'live', tone: 'info', detail: `日报 ${r.report ? r.report.at : ''} 生成` });
    if ((r.flags || []).includes('offline')) out.push({ k: 'offline', label: '设备离线', ico: 'offline', tone: 'neutral', detail: `${r.offlineSince || ''} 起 · 恢复后补传` });
    if ((r.flags || []).includes('trust-pending')) out.push({ k: 'trust', label: '待信任', ico: 'shield', tone: 'warn', detail: 'Codex Desktop 未完成信任' });
    if ((r.flags || []).includes('gap')) out.push({ k: 'gap', label: '采集缺口', ico: 'alert', tone: 'crit', detail: r.gap || '' });
    if (r.report && r.report.status === 'failed') out.push({ k: 'failed', label: '分析未完成', ico: 'clock', tone: 'crit', detail: `${r.report.error} · ${r.report.retry}` });
    if ((r.flags || []).includes('late-data')) out.push({ k: 'late', label: '迟到数据 · v2', ico: 'refresh', tone: 'info', detail: r.report.late });
    if ((r.flags || []).includes('old-context')) out.push({ k: 'old', label: '继续旧会话', ico: 'branch', tone: 'neutral', detail: '早期上下文供阅读，不计入当天' });
    if ((r.flags || []).includes('blocked')) out.push({ k: 'blocked', label: '有阻塞', ico: 'alert', tone: 'warn' });
    return out;
  };
  const statePill = (st) => pill(st.tone, st.label, st.ico);

  const reportPill = (mid, iso) => {
    const r = dayRec(mid, iso);
    const key = `${mid}|${iso}`;
    const rr = S.rerun[key];
    if (rr && rr.state !== 'done') return pill('info', rr.state === 'queued' ? '重算排队中' : '重算生成中', 'refresh');
    if (!r.report) return '';
    const st = r.report.status;
    if (st === 'ready') { const v = rr && rr.v ? rr.v : r.report.v; return pill('neutral', `日报 v${v}`, 'file'); }
    if (st === 'failed') return pill('crit', '日报生成失败', 'alert');
    if (st === 'scheduled') return pill('info', `日报 ${r.report.at.replace('9月25日 ', '明日 ')}`, 'clock');
    if (st === 'none') return pill('neutral', '无活动 · 无日报', 'none');
    return '';
  };

  /* ---------------- report body (shared by member page + drawer + digest) ---------------- */
  const latestVer = (mid, iso) => {
    const key = `${mid}|${iso}`;
    if (S.rerun[key] && S.rerun[key].state === 'done') return S.rerun[key].v;
    const rep = D.reports[key];
    return rep ? rep.versions[0].v : null;
  };
  const reportBlocks = (mid, iso, v) => {
    const rep = D.reports[`${mid}|${iso}`];
    if (!rep) return null;
    const base = rep.body[v] || rep.body[rep.versions[0].v];
    return base;
  };
  const ROWS = [['goal', '目标'], ['action', '行动'], ['result', '结果'], ['block', '阻塞'], ['next', '待继续'], ['gaps', '材料缺口']];
  const itemsDl = (blk, opts = {}) => `<dl class="rows">${ROWS.filter(([k]) => (blk[k] || []).length).map(([k, label]) => `
      <div class="rows__r rows__r--${k}"><dt>${label}</dt><dd><ul>${blk[k].map((it) => `
        <li class="${it.unverified ? 'is-unverified' : ''} ${it.added && opts.markAdded ? 'is-added' : ''}">
          <span class="rows__t">${esc(it.t)}</span>
          ${it.unverified ? `<span class="tag tag--warn">未验证</span>` : ''}
          ${it.added && opts.markAdded ? `<span class="tag tag--info">v2 新增</span>` : ''}
          <span class="rows__ev">${(it.ev || []).map(evBadge).join('')}</span>
          ${it.note ? `<span class="hnote">${icon('note')}<b>${esc(it.note.by)}</b> 追加说明 · ${esc(it.note.at)}：${esc(it.note.t)}</span>` : ''}
        </li>`).join('')}</ul></dd></div>`).join('')}</dl>`;

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  const toast = (text, kind = 'info') => {
    S.toast = { text, kind };
    renderToast();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { S.toast = null; renderToast(); }, 5000);
  };
  const renderToast = () => {
    const el = document.getElementById('toast');
    if (!el) return;
    el.innerHTML = S.toast ? `<div class="toast toast--${S.toast.kind}" role="status">${icon(S.toast.kind === 'crit' ? 'alert' : 'info')}<span>${esc(S.toast.text)}</span><button type="button" class="iconbtn iconbtn--sm" data-act="toast-close" aria-label="关闭提示">${icon('x')}</button></div>` : '';
  };

  /* ---------------- shell ---------------- */
  const NAV = [
    ['观察', [['team', '团队概览', 'overview'], ['activity', '活动记录', 'list'], ['member', '员工', 'person'], ['project', '项目', 'folder'], ['sessions', '会话', 'session']]],
    ['报表', [['usage', '用量与产出', 'chart'], ['efficiency', '会话产效', 'gauge'], ['prompts', '提示词分析', 'quote'], ['response', '响应与等待', 'clock']]],
    ['存档', [['recovery', '会话找回', 'restore']]],
    ['运行', [['pipeline', '数据处理', 'layers'], ['devices', '接入与设备', 'device'], ['ops', '分析与运行', 'pulse']]]
  ];
  const navActive = (key) => (S.r === key) || (key === 'sessions' && S.r === 'session');
  const brand = () => `<a class="brand" href="#team" data-go="team" aria-label="Skynet 观察台首页">
      <svg class="brand__mark" viewBox="0 0 28 28" aria-hidden="true"><rect class="brand__tile" x="1" y="1" width="26" height="26" rx="8"/><circle class="brand__lens" cx="14" cy="14" r="5.2"/><circle class="brand__pupil" cx="16.1" cy="11.9" r="1.7"/></svg>
      <span class="brand__name">Skynet</span><span class="brand__sub">观察台</span></a>`;
  const railInner = () => `
      ${brand()}
      <button type="button" class="kpill" data-act="search-open" data-k="kpill">${icon('search')}<span class="kpill__t">搜索员工、项目、会话</span><kbd>⌘K</kbd></button>
      <nav class="nav" aria-label="主导航">
        ${NAV.map(([g, items]) => `<p class="nav__g">${g}</p>${items.map(([key, label, ico]) => `
          <a class="nav__i ${navActive(key) ? 'is-active' : ''}" href="#${key}" data-go="${key}" ${navActive(key) ? 'aria-current="page"' : ''}>${icon(ico)}<span>${label}</span></a>`).join('')}`).join('')}
      </nav>
      <div class="rail__foot">
        <div class="whoami"><span class="av av--sm" data-tone="slate" aria-hidden="true">王</span><div><p class="whoami__n">${esc(D.viewer.name)} · ${esc(D.viewer.role)}</p><p class="whoami__d">已认证用户 · 可查看全部员工数据</p></div></div>
        <p class="railnote">${icon('clock')}北京时间 · 9月24日 ${D.now.time}</p>
        ${PROTOTYPE ? `<p class="railnote railnote--proto">${icon('info')}原型 · 示例数据，不连接真实服务</p>` : ''}
      </div>`;

  const PAGES = {};
  const register = (name, fn) => { PAGES[name] = fn; };

  const renderPage = () => {
    const fn = PAGES[S.r] || PAGES.team;
    try { return fn(S.a); } catch (err) {
      console.error(err);
      return notice('crit', 'alert', `页面渲染失败：${esc(err.message)}`);
    }
  };

  const render = () => {
    const ae = document.activeElement;
    const focusKey = ae && ae.getAttribute ? ae.getAttribute('data-k') : null;
    const app = document.getElementById('app');
    const overlayOpen = !!(S.drawer || S.search || S.menu);
    app.innerHTML = `
      <div class="shell ${S.menu ? 'is-menu' : ''}">
        <header class="topbar">
          ${brand()}
          <div class="topbar__act">
            <button type="button" class="iconbtn" data-act="search-open" aria-label="搜索">${icon('search')}</button>
            <button type="button" class="iconbtn" data-act="menu" aria-label="打开导航" aria-expanded="${S.menu}">${icon('menu')}</button>
          </div>
        </header>
        <aside class="rail" aria-label="侧边栏">${railInner()}</aside>
        <div class="railscrim" data-act="menu-close" aria-hidden="true"></div>
        <main class="main" id="main" ${overlayOpen ? 'inert' : ''}>${renderPage()}</main>
      </div>
      ${S.drawer && window.SkyDrawer ? window.SkyDrawer(S.drawer) : ''}
      ${S.search ? searchDialog() : ''}
      ${PROTOTYPE && S.r === 'team' && S.variant !== 'C' && window.SkyVariants ? window.SkyVariants.switcher() : ''}
      <div id="toast" class="toastzone" aria-live="polite"></div>`;
    renderToast();
    if (S.search) { const q = document.getElementById('q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    else if (S.drawer) { const f = document.querySelector('.drawer [data-autofocus]') || document.querySelector('.drawer button'); if (f) f.focus({ preventScroll: true }); }
    else if (focusKey) { const el = document.querySelector(`[data-k="${CSS.escape(focusKey)}"]`); if (el) el.focus({ preventScroll: true }); }
    if (afterFn) { const f = afterFn; afterFn = null; f(); }
  };
  let afterFn = null;
  const after = (fn) => { afterFn = fn; };

  /* ---------------- search (N13 inline ⌘K) ---------------- */
  const searchIndex = (() => {
    const idx = [];
    D.members.forEach((m) => idx.push({ g: '员工', t: m.name, d: `${m.role} · ${m.devices.length} 台设备`, go: `member.${m.id}`, ico: 'person' }));
    Object.entries(D.projects).forEach(([id, p]) => idx.push({ g: '项目', t: p.name, d: p.repo, go: `project.${id}`, ico: 'folder' }));
    Object.entries(D.themes).forEach(([id, t]) => idx.push({ g: '工作主题', t: t.title, d: `${M[t.owner].name} · ${D.projects[t.project].name} · ${t.days.length} 天`, go: `member.${t.owner}.day.${t.days[Math.min(t.days.length - 1, t.days.indexOf('2026-09-23') >= 0 ? t.days.indexOf('2026-09-23') : t.days.length - 1)]}`, ico: 'layers', extra: t.brief }));
    Object.entries(D.sessions).forEach(([id, s]) => idx.push({ g: '会话', t: `${s.title}`, d: `${id} · ${M[s.member].name} · ${s.agent} · ${md(s.date)} ${s.start}`, go: `session.${id}`, ico: 'session' }));
    // 对话原文（用户与 Agent 消息）→ 跳到对话视图中的原句
    Object.entries(D.conv || {}).forEach(([sid, items]) => items.forEach((it) => {
      if (it.type !== 'msg' || !it.n) return;
      const s = D.sessions[sid];
      idx.push({ g: '对话原文', t: it.text, d: `${M[s.member].name} · ${it.role === 'user' ? '提问' : 'Agent'} · ${sid} · ${md(s.date)} ${it.t.slice(0, 5)}`, go: `session.${sid}.m${it.n}`, ico: it.role === 'user' ? 'person' : 'bot' });
    }));
    // 工具命令与输出 → 跳到时间线中的证据位置
    Object.entries(D.timeline).forEach(([sid, tl]) => tl.events.forEach((e) => {
      if (!e.n || !['tool', 'edit'].includes(e.kind)) return;
      const text = e.cmd || e.file || (e.out || []).join(' ');
      idx.push({ g: '工具记录', t: text, d: `${sid} · #${e.n} · ${e.t}`, go: `session.${sid}.e${e.n}`, ico: 'terminal', mono: true });
    }));
    Object.entries(D.reports).forEach(([key, rep]) => {
      const [mid, iso] = key.split('|');
      Object.values(rep.body).flat().forEach((blk) => ROWS.forEach(([k]) => (blk[k] || []).forEach((it) => idx.push({ g: '报告条目', t: it.t, d: `${M[mid].name} · ${md(iso)} 日报`, go: `member.${mid}.day.${iso}`, ico: 'file' }))));
    });
    return idx;
  })();
  const hl = (text, q) => {
    const t = esc(text);
    if (!q) return t;
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return t;
    return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  };
  const searchResults = () => {
    const q = S.q.trim();
    if (!q) return [];
    const seen = new Set();
    return searchIndex.filter((r) => {
      const hay = `${r.t} ${r.d} ${r.extra || ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
      const k = r.g + r.t + r.go; if (seen.has(k)) return false; seen.add(k); return true;
    }).slice(0, 40);
  };
  const searchList = () => {
    const res = searchResults();
    if (!S.q.trim()) return `<p class="sr__empty">可按员工、日期、项目、Agent 或会话内容检索。</p>`;
    if (!res.length) return `<p class="sr__empty">没有找到“${esc(S.q)}”。检索覆盖员工、项目、工作主题、会话标题、报告条目与已同步的原文。</p>`;
    const groups = {};
    res.forEach((r, i) => { (groups[r.g] = groups[r.g] || []).push([r, i]); });
    S.qi = Math.min(S.qi, res.length - 1);
    return Object.entries(groups).map(([g, list]) => `
      <p class="sr__g">${g}<span class="num">${list.length}</span></p>
      <ul class="sr__list" role="presentation">${list.map(([r, i]) => `
        <li><a class="sr__i ${i === S.qi ? 'is-sel' : ''}" href="#${r.go}" data-go="${r.go}" role="option" aria-selected="${i === S.qi}" data-i="${i}">
          ${icon(r.ico)}<span class="sr__txt"><span class="sr__t ${r.mono ? 'mono' : ''}">${hl(r.t, S.q.trim())}</span><span class="sr__d">${hl(r.d, S.q.trim())}</span></span>${icon('arrow', 'sr__go')}
        </a></li>`).join('')}</ul>`).join('');
  };
  const searchDialog = () => `
    <div class="overlay" data-act="search-close-bg">
      <div class="spot" role="dialog" aria-modal="true" aria-label="检索">
        <div class="spot__bar">${icon('search')}<input id="q" type="search" autocomplete="off" value="${esc(S.q)}" placeholder="员工、项目、Agent、日期或会话内容" aria-label="检索关键词" aria-controls="sr" /><kbd>Esc</kbd></div>
        <div class="spot__res" id="sr" role="listbox" aria-label="检索结果">${searchList()}</div>
        <p class="spot__foot"><kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 打开 · 结果与 MCP 查询共用同一检索</p>
      </div>
    </div>`;
  const refreshSearch = () => { const el = document.getElementById('sr'); if (el) el.innerHTML = searchList(); };

  /* ---------------- routing ---------------- */
  const ROUTES = ['team', 'activity', 'member', 'project', 'sessions', 'session', 'usage', 'efficiency', 'prompts', 'response', 'recovery', 'pipeline', 'devices', 'ops'];
  const parse = (h) => {
    const parts = decodeURIComponent((h || '').replace(/^#/, '')).split('.').filter(Boolean);
    const r = ROUTES.includes(parts[0]) ? parts[0] : 'team';
    return { r, a: ROUTES.includes(parts[0]) ? parts.slice(1) : [] };
  };
  const applyRoute = (route) => {
    const { r, a } = parse(route);
    S.r = r; S.a = a;
    if (r === 'team' && a[0] && /^[abc]$/i.test(a[0])) S.variant = a[0].toUpperCase();
  };
  const go = (route, opts = {}) => {
    applyRoute(route);
    S.drawer = null; S.menu = false; S.search = false; S.verMenu = null;
    try { history.pushState(null, '', `${location.pathname}${location.search}#${route}`); } catch (e) { /* 沙箱内保持内存状态 */ }
    if (!opts.keepScroll) window.scrollTo(0, 0);
    render();
  };
  const set = (patch, opts = {}) => {
    Object.assign(S, patch);
    if (opts.silent) return;
    const y = window.scrollY;
    render();
    if (!opts.top) window.scrollTo(0, y);
  };

  /* ---------------- actions ---------------- */
  const ACTS = {};
  const onAct = (name, fn) => { ACTS[name] = fn; };

  onAct('search-open', () => set({ search: true, qi: 0 }));
  onAct('search-close-bg', (el, ev) => { if (ev.target === el) set({ search: false }); });
  onAct('menu', () => set({ menu: !S.menu }));
  onAct('menu-close', () => set({ menu: false }));
  onAct('toast-close', () => { S.toast = null; renderToast(); });
  onAct('drawer-close', () => set({ drawer: null }));
  onAct('drawer-bg', (el, ev) => { if (ev.target === el) set({ drawer: null }); });
  onAct('copy', async (el) => {
    const text = el.dataset.text || '';
    const done = () => { el.dataset.state = 'copied'; const l = el.querySelector('.copy__l'); if (l) { l.dataset.prev = l.dataset.prev || l.textContent; l.textContent = '已复制'; } setTimeout(() => { delete el.dataset.state; if (l) l.textContent = l.dataset.prev; }, 2500); };
    try { await navigator.clipboard.writeText(text); done(); } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e2) { toast('无法写入剪贴板，已选中文本，请手动复制。', 'crit'); }
      ta.remove();
    }
  });

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-go],[data-act]');
    if (!el) return;
    if (el.dataset.act && ACTS[el.dataset.act]) {
      if (el.tagName === 'A') ev.preventDefault();
      ACTS[el.dataset.act](el, ev);
      return;
    }
    if (el.dataset.go) {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
      ev.preventDefault();
      go(el.dataset.go);
    }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'q') { S.q = ev.target.value; S.qi = 0; refreshSearch(); return; }
    const h = ev.target.closest('[data-input]');
    if (h && ACTS[h.dataset.input]) ACTS[h.dataset.input](h, ev);
  });
  document.addEventListener('change', (ev) => {
    const h = ev.target.closest('[data-change]');
    if (h && ACTS[h.dataset.change]) ACTS[h.dataset.change](h, ev);
  });
  document.addEventListener('submit', (ev) => {
    const f = ev.target.closest('form[data-submit]');
    if (!f) return;
    ev.preventDefault();
    if (ACTS[f.dataset.submit]) ACTS[f.dataset.submit](f, ev);
  });
  document.addEventListener('keydown', (ev) => {
    const typing = ev.target.closest && ev.target.closest('input, textarea, select, [contenteditable]');
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); set({ search: !S.search, qi: 0 }); return; }
    if (ev.key === 'Escape') {
      if (S.search) { set({ search: false }); return; }
      if (S.drawer) { set({ drawer: null }); return; }
      if (S.menu) { set({ menu: false }); return; }
    }
    if (S.search && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Enter')) {
      const res = searchResults();
      if (!res.length) return;
      if (ev.key === 'Enter') { ev.preventDefault(); go(res[S.qi].go); return; }
      ev.preventDefault();
      S.qi = (S.qi + (ev.key === 'ArrowDown' ? 1 : -1) + res.length) % res.length;
      refreshSearch();
      const sel = document.querySelector('.sr__i.is-sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (!typing && !S.search && !S.drawer && PROTOTYPE && S.r === 'team' && S.variant !== 'C' && window.SkyVariants && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
      ev.preventDefault();
      window.SkyVariants.cycle(ev.key === 'ArrowRight' ? 1 : -1);
    }
  });
  window.addEventListener('popstate', () => { applyRoute(location.hash); S.drawer = null; S.search = false; render(); });

  /* ---------------- boot ---------------- */
  const boot = () => {
    document.documentElement.lang = 'zh-CN';
    applyRoute(location.hash || '#team');
    try {
      const v = new URLSearchParams(location.search).get('variant');
      if (v && /^[abc]$/i.test(v)) S.variant = v.toUpperCase();
    } catch (e) { /* ignore */ }
    render();
  };

  window.SkyUI = {
    D, S, M, DEV, PROTOTYPE, esc, icon, WD, WDS, md, dnum, dayLabel, weekday, isToday, isFuture, toMin, fmtTok,
    dayRec, dayStates, statePill, reportPill, avatar, projChip, pill, tone, evBadge, evLegend, statCells, statLine, ruler,
    notice, empty, pageHead, copyBtn, itemsDl, reportBlocks, latestVer, ROWS, render, set, go, toast, register, onAct, after
  };
  window.addEventListener('DOMContentLoaded', boot);
})();
