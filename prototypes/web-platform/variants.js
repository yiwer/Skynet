/* PROTOTYPE — 团队概览的三个结构变体，同一路由，通过 ?variant=A|B|C（或 #team.a|b|c）与底部浮动切换条切换。
 *   A · 周历     —— 时间优先：一周日历，员工为行，工作主题像日程一样落在日期上，点开抽屉看证据。
 *   B · 日报阅读 —— 叙述优先：选一天，逐人阅读目标/结果/阻塞与证据，右侧是“需要关注”。
 *   C · 覆盖矩阵 —— 数据优先：员工 × 日期的覆盖符号 + 当天确定性统计，右侧检查器。
 * 变体之间只共享小组件（头像、证据标记、状态胶囊），不共享布局。
 */
(() => {
  'use strict';
  const U = window.SkyUI;
  const {
    D, S, M, esc, icon, md, dnum, dayLabel, weekday, WD, isToday, isFuture, dayRec, dayStates, statePill, reportPill,
    avatar, projChip, pill, tone, evBadge, evLegend, statLine, ruler, notice, empty, pageHead, reportBlocks, latestVer, set, register, onAct
  } = U;
  const days = D.week.days;
  const NAMES = { A: '周历', B: '日报阅读', C: '覆盖矩阵' };
  const ORDER = ['A', 'B', 'C'];
  const isWeekend = (iso) => { const w = weekday(iso); return w === 0 || w === 6; };

  /* ================= A · 周历 ================= */
  const markA = (st) => {
    const cls = { trust: 'warn', gap: 'crit', failed: 'crit', offline: 'off', late: 'info', old: 'neutral' }[st.k];
    if (!cls) return '';
    return `<span class="cmark cmark--${cls}" title="${esc(st.detail || st.label)}">${icon(st.ico)}${st.label}</span>`;
  };
  const cellA = (m, d) => {
    const r = dayRec(m.id, d);
    const sts = dayStates(m.id, d);
    const cls = ['wk__cell', isToday(d) ? 'is-today' : '', isFuture(d) ? 'is-future' : '', isWeekend(d) ? 'is-wkend' : '', r.state === 'none' ? 'is-none' : '', (r.flags || []).includes('offline') ? 'is-offline' : ''].join(' ');
    if (isFuture(d)) return `<div class="${cls}" role="gridcell" aria-label="${dayLabel(d)}：尚未到达"></div>`;
    if (r.state === 'none') return `<div class="${cls}" role="gridcell"><span class="wk__none">${icon('none')}无活动</span><span class="wk__hb">心跳 ${esc(r.heartbeat || '—')}</span></div>`;
    const chips = (r.themes || []).map((x) => {
      const t = D.themes[x.id];
      const meta = [`${x.sessions} 会话`, x.blocked ? '阻塞' : '', x.live ? '进行中' : '', x.pending ? '待分析' : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="wkchip ${x.blocked ? 'is-blocked' : ''}" data-tone="${tone(t.project)}" data-act="theme" data-id="${x.id}" data-mid="${m.id}" data-iso="${d}" data-k="wk-${m.id}-${d}-${x.id}">
          <span class="wkchip__t">${esc(t.title)}</span><span class="wkchip__m">${x.blocked ? icon('alert') : ''}${meta}</span></button>`;
    }).join('');
    return `<div class="${cls}" role="gridcell">${chips}${sts.map(markA).join('')}</div>`;
  };
  const variantA = () => {
    const legend = `<div class="legend" aria-label="图例">
        ${Object.entries(D.projects).filter(([id]) => id !== 'unclassified').map(([, p]) => `<span class="legend__p"><i class="dot" data-tone="${p.tone}"></i>${esc(p.name)}</span>`).join('')}
        <span class="legend__sep" aria-hidden="true"></span>
        <span>${icon('none')}无活动</span><span>${icon('offline')}设备离线</span><span>${icon('shield')}待信任</span><span>${icon('alert')}采集缺口</span><span>${icon('clock')}分析未完成</span>
      </div>`;
    return `${pageHead({
      title: '团队概览',
      sub: `${D.week.label} · ${D.week.range} · 北京时间 · 数据截至 9月24日 ${D.now.time}`,
      actions: `<span class="weeknav"><button type="button" class="iconbtn" aria-label="上一周" title="原型只含本周数据" aria-disabled="true">${icon('chev-l')}</button><span class="weeknav__l">本周</span><button type="button" class="iconbtn" aria-label="下一周" aria-disabled="true">${icon('chev-r')}</button></span>`
    })}
      ${legend}
      <div class="wkwrap">
        <div class="wk" role="grid" aria-label="${D.week.label} 团队工作日历">
          <div class="wk__row wk__row--head" role="row">
            <span class="wk__corner" role="columnheader">员工</span>
            ${days.map((d) => `<span class="wk__day ${isToday(d) ? 'is-today' : ''} ${isWeekend(d) ? 'is-wkend' : ''}" role="columnheader"><span class="wk__w">${WD[weekday(d)]}</span><span class="wk__n num">${dnum(d)}</span>${isToday(d) ? '<span class="wk__tl">今天</span>' : ''}</span>`).join('')}
          </div>
          ${D.members.map((m) => {
            const trust = m.devices.some((dv) => dv.clients.some((c) => c.issue === 'trust'));
            const off = m.devices.some((dv) => dv.offline);
            return `<div class="wk__row" role="row">
              <a class="wk__who" role="rowheader" href="#member.${m.id}.week.W39" data-go="member.${m.id}.week.W39">${avatar(m)}<span class="wk__whot"><b>${esc(m.name)}</b><span class="muted">${esc(m.role)}</span></span>
                ${trust ? `<span class="wk__cov is-warn" title="有客户端待信任">${icon('shield')}</span>` : off ? `<span class="wk__cov is-off" title="有设备离线">${icon('offline')}</span>` : ''}</a>
              ${days.map((d) => cellA(m, d)).join('')}
            </div>`;
          }).join('')}
        </div>
      </div>
      <p class="side__n">点工作主题查看当天的目标、结果、阻塞与证据；点员工进入整周视图。今日列为同步中的原文，日报次日 09:00 生成。</p>`;
  };

  /* ================= B · 日报阅读 ================= */
  onAct('b-day', (el) => set({ teamDay: el.dataset.v }));
  const attention = (iso) => {
    const list = [];
    D.members.forEach((m) => {
      const r = dayRec(m.id, iso);
      const f = r.flags || [];
      if (f.includes('blocked')) list.push(['warn', 'alert', '阻塞', m, r.themes.filter((x) => x.blocked).map((x) => D.themes[x.id].title).join('、')]);
      if (r.report && r.report.status === 'failed') list.push(['crit', 'clock', '日报生成失败', m, `${r.report.error}，${r.report.retry}`]);
      if (f.includes('trust-pending')) list.push(['warn', 'shield', '待信任', m, 'Codex Desktop 未完成信任，覆盖不完整']);
      if (f.includes('offline')) list.push(['neutral', 'offline', '设备离线', m, `${r.offlineSince} 起，恢复后补传`]);
      if (f.includes('gap')) list.push(['crit', 'alert', '采集缺口', m, r.gap]);
      if (f.includes('late-data')) list.push(['info', 'refresh', '迟到数据', m, '已补传并重新生成 v2']);
    });
    return list;
  };
  const digestItem = (m, iso) => {
    const r = dayRec(m.id, iso);
    const k = `${m.id}|${iso}`;
    const rep = D.reports[k];
    const themes = (r.themes || []).map((x) => D.themes[x.id]);
    const projs = [...new Set(themes.map((t) => t.project))];
    const head = `<header class="dg__h">
        ${avatar(m)}
        <a class="dg__who" href="#member.${m.id}.day.${iso}" data-go="member.${m.id}.day.${iso}"><b>${esc(m.name)}</b><span class="muted">${esc(m.role)}</span></a>
        <span class="dg__tags">${projs.map((p) => projChip(p)).join('')}${reportPill(m.id, iso)}</span>
      </header>`;
    const flags = dayStates(m.id, iso).filter((s) => ['trust', 'offline', 'gap', 'late', 'old'].includes(s.k));
    const flagLine = flags.length ? `<p class="dg__flags">${flags.map((s) => `<span class="dg__flag dg__flag--${s.tone}">${icon(s.ico)}${s.label}${s.detail ? `<span class="muted"> · ${esc(s.detail)}</span>` : ''}</span>`).join('')}</p>` : '';
    let body;
    if (r.state === 'none') body = `<p class="dg__none">${icon('none')}无活动。设备在线（最近心跳 ${esc(r.heartbeat || '—')}），当天没有 Agent 会话；平台不推断原因。</p>`;
    else if (r.state === 'today') body = `<p class="dg__live">${icon('live')}进行中：${themes.map((t) => `<span class="serif">${esc(t.title)}</span>`).join('、')}。日报 ${esc(r.report.at)} 生成。</p>`;
    else if (r.report && r.report.status === 'failed') body = `${notice('crit', 'alert', `日报生成失败：${esc(r.report.error)}，${esc(r.report.retry)}。原文可正常查看。`)}<p class="dg__pending">${themes.map((t) => `<span class="serif">${esc(t.title)}</span>`).join('、')}<span class="muted">（按会话标题预归类，待分析）</span></p>`;
    else {
      const blocks = rep ? (reportBlocks(m.id, iso, latestVer(m.id, iso)) || []) : [];
      const pick = (field) => blocks.flatMap((b) => b[field] || []);
      const rows = [['结果', pick('result')], ['阻塞', pick('block')], ['缺口', pick('gaps')]].filter(([, xs]) => xs.length);
      body = `<p class="dg__lead serif">${esc(r.summary || '')}</p>
        ${rows.length ? `<dl class="dg__rows">${rows.map(([label, xs]) => `<div><dt>${label}</dt><dd><ul>${xs.map((it) => `<li><span>${esc(it.t)}</span>${it.unverified ? '<span class="tag tag--warn">未验证</span>' : ''}<span class="rows__ev">${(it.ev || []).map(evBadge).join('')}</span></li>`).join('')}</ul></dd></div>`).join('')}</dl>`
          : `<p class="dg__themes">${themes.map((t) => `<span class="serif">${esc(t.title)}</span>`).join('、')}<span class="muted"> · 摘要级内容（原型示例）</span></p>`}`;
    }
    const foot = r.stats && r.stats.sessions ? `<footer class="dg__f">${statLine(r.stats)}<div class="dg__ruler">${ruler(r.stats.intervals, { caption: false })}</div>
        <a class="dg__open" href="#member.${m.id}.day.${iso}" data-go="member.${m.id}.day.${iso}">打开日报${icon('arrow')}</a></footer>` : '';
    return `<article class="dg" aria-label="${esc(m.name)} ${dayLabel(iso)}">${head}${flagLine}${body}${foot}</article>`;
  };
  const variantB = () => {
    const iso = S.teamDay;
    const att = attention(iso);
    const ready = D.members.filter((m) => { const r = dayRec(m.id, iso); return r.report && r.report.status === 'ready'; }).length;
    const strip = `<div class="bdates" role="group" aria-label="选择日期">${days.map((d) => {
      const fut = isFuture(d);
      const nReady = D.members.filter((m) => { const r = dayRec(m.id, d); return r.report && r.report.status === 'ready'; }).length;
      const cls = ['bdates__d', d === iso ? 'is-sel' : '', isToday(d) ? 'is-today' : '', fut ? 'is-future' : '', nReady ? 'has' : ''].join(' ');
      const sub = fut ? '&nbsp;' : isToday(d) ? '进行中' : `${nReady} 份日报`;
      return fut ? `<span class="${cls}" aria-disabled="true"><span class="bdates__w">${WD[weekday(d)]}</span><span class="bdates__n num">${dnum(d)}</span><span class="bdates__s">${sub}</span></span>`
        : `<button type="button" class="${cls}" data-act="b-day" data-v="${d}" data-k="bd-${d}" aria-pressed="${d === iso}"><span class="bdates__w">${WD[weekday(d)]}</span><span class="bdates__n num">${dnum(d)}</span><span class="bdates__s">${sub}</span></button>`;
    }).join('')}</div>`;
    return `${pageHead({ title: '团队概览', sub: `${dayLabel(iso)} · ${isToday(iso) ? '今日进行中，日报明日 09:00 生成' : `${ready} 份日报 · 北京时间次日 09:00 生成`}` })}
      ${strip}
      <div class="digest">
        <div class="digest__feed">${D.members.map((m) => digestItem(m, iso)).join('')}</div>
        <aside class="digest__rail" aria-label="需要关注与覆盖">
          <section class="rail-s"><h2 class="side__h">需要关注</h2>
            ${att.length ? `<ul class="attn">${att.map(([t, ico, label, m, detail]) => `<li><a class="attn__i attn__i--${t}" href="#member.${m.id}.day.${iso}" data-go="member.${m.id}.day.${iso}">${icon(ico)}<span><b>${label}</b> · ${esc(m.name)}<span class="attn__d">${esc(detail)}</span></span></a></li>`).join('')}</ul>` : '<p class="muted">这一天没有需要关注的事项。</p>'}
          </section>
          <section class="rail-s"><h2 class="side__h">覆盖</h2>
            <p>6 名员工 · 8 个运行环境</p>
            <ul class="covsum"><li>${icon('shield')}1 个客户端待信任（赵一鸣 · Codex Desktop）</li><li>${icon('offline')}今日 1 台设备离线（许若溪）</li><li>${icon('alert')}今日 1 处采集缺口（韩秋）</li></ul>
            <a class="linkbtn" href="#devices" data-go="devices">接入与设备</a>
          </section>
          <section class="rail-s"><h2 class="side__h">证据类型</h2>${evLegend()}</section>
        </aside>
      </div>`;
  };

  /* ================= C · 覆盖矩阵 ================= */
  onAct('c-sel', (el) => set({ cSel: el.dataset.v }));
  onAct('c-day', (el) => set({ cDay: el.dataset.v }));
  onAct('c-cell', (el) => set({ cSel: el.dataset.m, cDay: el.dataset.d }));
  const glyph = (mid, d) => {
    const r = dayRec(mid, d);
    const f = r.flags || [];
    const base = isFuture(d) ? 'future' : r.state === 'none' ? 'none' : r.state === 'today' ? 'live' : 'active';
    const badges = [];
    if (f.includes('trust-pending')) badges.push('trust');
    if (f.includes('gap')) badges.push('gap');
    if (r.report && r.report.status === 'failed') badges.push('failed');
    if (f.includes('blocked')) badges.push('blocked');
    const slash = f.includes('offline');
    const labels = dayStates(mid, d).map((s) => s.label);
    const label = base === 'active' ? ['有活动', ...labels] : labels;
    return { base, badges, slash, label: label.join('、') || '有活动' };
  };
  const glyphSvg = (g) => `<svg class="gl" viewBox="0 0 24 24" aria-hidden="true">
      ${g.base === 'active' ? '<circle class="gl__fill" cx="12" cy="12" r="6"/>' : ''}
      ${g.base === 'none' ? '<circle class="gl__ring" cx="12" cy="12" r="5.5"/>' : ''}
      ${g.base === 'live' ? '<circle class="gl__ring" cx="12" cy="12" r="5.5"/><path class="gl__fill" d="M12 6.5a5.5 5.5 0 0 1 0 11z"/>' : ''}
      ${g.base === 'future' ? '<circle class="gl__dash" cx="12" cy="12" r="5.5"/>' : ''}
      ${g.slash ? '<path class="gl__slash" d="M5 19 19 5"/>' : ''}
      ${g.badges.includes('trust') ? '<path class="gl__b gl__b--warn" d="M19 1.5 22.5 5 19 8.5 15.5 5z"/>' : ''}
      ${g.badges.includes('gap') ? '<path class="gl__b gl__b--crit" d="M19 1.5 23 8.5h-8z"/>' : ''}
      ${g.badges.includes('failed') ? '<rect class="gl__b gl__b--crit" x="15.8" y="1.8" width="6.4" height="6.4" rx="1"/>' : ''}
      ${g.badges.includes('blocked') ? '<circle class="gl__b gl__b--warn" cx="19" cy="19" r="3.2"/>' : ''}
    </svg>`;
  const inspector = (mid, d) => {
    const m = M[mid];
    const r = dayRec(mid, d);
    const rep = D.reports[`${mid}|${d}`];
    const sts = dayStates(mid, d);
    const themes = (r.themes || []).map((x) => [x, D.themes[x.id]]);
    const blocks = rep ? (reportBlocks(mid, d, latestVer(mid, d)) || []) : [];
    const blocksOf = (f) => blocks.flatMap((b) => b[f] || []);
    return `<header class="insp__h">${avatar(m)}<div><p class="insp__n">${esc(m.name)}</p><p class="muted">${dayLabel(d)}</p></div>${reportPill(mid, d)}</header>
      ${sts.length ? `<p class="insp__st">${sts.map(statePill).join('')}</p>` : ''}
      ${isFuture(d) ? empty('clock', '尚未到达', '这一天还没有开始。') : ''}
      ${r.summary ? `<p class="insp__lead serif">${esc(r.summary)}</p>` : ''}
      ${r.stats && r.stats.sessions ? statLine(r.stats) : ''}
      ${themes.length ? `<section class="insp__s"><h3 class="insp__k">工作主题</h3><ul class="insp__th">${themes.map(([x, t]) => `<li><button type="button" class="linkrow" data-act="theme" data-id="${x.id}" data-mid="${mid}" data-iso="${d}">${projChip(t.project)}<span class="serif">${esc(t.title)}</span><span class="muted num">${x.sessions} 会话</span></button></li>`).join('')}</ul></section>` : ''}
      ${blocksOf('block').length ? `<section class="insp__s"><h3 class="insp__k">阻塞</h3><ul class="insp__list">${blocksOf('block').map((it) => `<li>${esc(it.t)}<span class="rows__ev">${it.ev.map(evBadge).join('')}</span></li>`).join('')}</ul></section>` : ''}
      ${rep ? `<section class="insp__s"><h3 class="insp__k">证据构成</h3>${(() => { const e = rep.evidence; const tot = e.obs + e.claim + e.infer + e.gap; return `<div class="evbar" role="img" aria-label="工具结果 ${e.obs}，声称 ${e.claim}，模型推断 ${e.infer}，材料不足 ${e.gap}">${['obs', 'claim', 'infer', 'gap'].map((k) => (e[k] ? `<span class="evbar__s evbar__s--${k}" style="--w:${(e[k] / tot * 100).toFixed(1)}%"></span>` : '')).join('')}</div><p class="muted num insp__evn">工具结果 ${e.obs} · 声称 ${e.claim} · 推断 ${e.infer} · 材料不足 ${e.gap}</p>`; })()}</section>` : ''}
      ${r.stats && r.stats.sessions ? `<section class="insp__s"><h3 class="insp__k">事件活跃区间</h3>${ruler(r.stats.intervals)}</section>` : ''}
      <section class="insp__s"><h3 class="insp__k">设备</h3><ul class="insp__dev">${m.devices.map((dv) => `<li><span>${esc(dv.name)}</span><span class="muted">${dv.clients.map((c) => `${esc(c.c)}${c.issue === 'trust' ? '（待信任）' : ''}`).join('、')}</span><span class="muted num">${dv.offline ? '离线 · ' : ''}同步 ${esc(dv.lastSync)}</span></li>`).join('')}</ul></section>
      <div class="insp__act">
        ${!isFuture(d) ? `<a class="btn btn--primary" href="#member.${mid}.day.${d}" data-go="member.${mid}.day.${d}">打开${md(d)}日报</a>` : ''}
        <a class="btn btn--quiet" href="#member.${mid}.week.W39" data-go="member.${mid}.week.W39">整周</a>
      </div>`;
  };
  const cell = (v) => (v == null ? '<span class="unk">未知</span>' : v);
  // 矩阵里用紧凑的日报状态，完整状态在检查器中
  const reportMini = (mid, d) => {
    const r = dayRec(mid, d);
    const rr = S.rerun[`${mid}|${d}`];
    if (rr && rr.state !== 'done') return pill('info', '重算中', 'refresh');
    if (!r.report) return '<span class="muted">—</span>';
    const st = r.report.status;
    if (st === 'ready') return pill('neutral', `v${latestVer(mid, d) || r.report.v}`, 'file');
    if (st === 'failed') return pill('crit', '失败', 'alert');
    if (st === 'scheduled') return pill('info', '明日', 'clock');
    return '<span class="muted">无</span>';
  };
  const variantC = () => {
    const d = S.cDay, sel = S.cSel;
    const R = window.SkyReports;
    return `${pageHead({ title: '团队概览', sub: `${D.week.label} · ${D.week.range} · 北京时间 · 数据截至 9月24日 ${D.now.time}`, actions: `<a class="btn btn--quiet" href="#activity" data-go="activity">${icon('list')}活动记录</a><a class="btn btn--secondary" href="#usage" data-go="usage">${icon('chart')}数据报表</a>` })}
      ${R ? R.overviewKpis() : ''}
      <h2 class="block__h">覆盖与活动 · 右侧统计为 ${dayLabel(d)}</h2>
      <div class="mx">
        <div class="mx__main">
          <div class="tblwrap">
            <table class="tbl tbl--mx">
              <caption class="sr-only">员工 × 日期覆盖状态，以及所选日期的活动统计</caption>
              <thead><tr>
                <th scope="col">员工</th>
                ${days.map((x) => `<th scope="col" class="mx__dh ${x === d ? 'is-sel' : ''} ${isToday(x) ? 'is-today' : ''}"><button type="button" class="mx__dhb" data-act="c-day" data-v="${x}" data-k="cd-${x}" aria-pressed="${x === d}" ${isFuture(x) ? 'aria-disabled="true"' : ''}>${WD[weekday(x)].slice(1)}<b class="num">${dnum(x)}</b></button></th>`).join('')}
                <th scope="col" class="r mx__stat">会话</th><th scope="col" class="r mx__stat">轮次</th><th scope="col" class="r mx__stat">工具调用</th><th scope="col" class="r mx__stat">文件</th><th scope="col" class="mx__stat" title="输入 Token；未上报用量的会话标为未知，输出见检查器">Token 输入</th><th scope="col">日报</th>
              </tr></thead>
              <tbody>${D.members.map((m) => {
                const r = dayRec(m.id, d);
                const st = r.stats;
                const tok = !st ? '—' : st.tin == null ? '<span class="unk">未知</span>' : `${U.fmtTok(st.tin)}${st.unknownTokens ? ' <span class="unk">+未知</span>' : ''}`;
                return `<tr class="${m.id === sel ? 'is-sel' : ''}">
                  <th scope="row"><button type="button" class="mx__who" data-act="c-sel" data-v="${m.id}" data-k="cs-${m.id}" aria-pressed="${m.id === sel}">${avatar(m, 'sm')}<span>${esc(m.name)}</span></button></th>
                  ${days.map((x) => { const g = glyph(m.id, x); return `<td class="mx__c ${x === d ? 'is-col' : ''}"><button type="button" class="mx__g ${m.id === sel && x === d ? 'is-on' : ''}" data-act="c-cell" data-m="${m.id}" data-d="${x}" data-k="cc-${m.id}-${x}" aria-label="${esc(m.name)} ${dayLabel(x)}：${esc(g.label)}" title="${esc(g.label)}" ${isFuture(x) ? 'aria-disabled="true"' : ''}>${glyphSvg(g)}</button></td>`; }).join('')}
                  <td class="num r mx__stat">${st ? cell(st.sessions) : '—'}</td><td class="num r mx__stat">${st ? cell(st.turns) : '—'}</td><td class="num r mx__stat">${st ? cell(st.tools) : '—'}</td><td class="num r mx__stat">${st ? cell(st.files) : '—'}</td>
                  <td class="num nowrap mx__stat">${tok}</td><td class="nowrap">${reportMini(m.id, d)}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
          <div class="mx__lg" aria-label="符号说明">
            <span>${glyphSvg({ base: 'active', badges: [] })}有活动</span><span>${glyphSvg({ base: 'none', badges: [] })}无活动</span><span>${glyphSvg({ base: 'live', badges: [] })}今日进行中</span>
            <span>${glyphSvg({ base: 'live', badges: [], slash: true })}设备离线</span><span>${glyphSvg({ base: 'active', badges: ['trust'] })}待信任</span><span>${glyphSvg({ base: 'active', badges: ['gap'] })}采集缺口</span>
            <span>${glyphSvg({ base: 'active', badges: ['failed'] })}分析未完成</span><span>${glyphSvg({ base: 'active', badges: ['blocked'] })}有阻塞</span>
          </div>
          <p class="side__n">统计为确定性计算：未上报的字段显示“未知”，不计为 0；不排序、不评分、不折算工时。</p>
        </div>
        <aside class="mx__insp" aria-label="检查器">${inspector(sel, d)}</aside>
      </div>
      ${R ? R.overviewPeople() : ''}`;
  };

  /* ================= wiring + prototype switcher ================= */
  const VARIANTS = { A: variantA, B: variantB, C: variantC };
  register('team', () => (VARIANTS[S.variant] || variantA)());

  const setVariant = (v) => {
    S.variant = v;
    try {
      const u = new URL(location.href);
      u.searchParams.set('variant', v);
      u.hash = `team.${v.toLowerCase()}`;
      history.replaceState(null, '', u.href);
    } catch (e) { /* 沙箱或 file:// 下保持内存状态 */ }
    set({ drawer: null }, { top: true });
    window.scrollTo(0, 0);
  };
  const cycle = (dir) => {
    const i = ORDER.indexOf(S.variant);
    setVariant(ORDER[(i + dir + ORDER.length) % ORDER.length]);
  };
  onAct('v-prev', () => cycle(-1));
  onAct('v-next', () => cycle(1));
  const switcher = () => `<div class="psw" role="region" aria-label="原型变体切换（仅原型）">
      <span class="psw__tag">原型</span>
      <button type="button" class="psw__b" data-act="v-prev" data-k="psw-prev" aria-label="上一个变体">${icon('chev-l')}</button>
      <span class="psw__l" aria-live="polite"><b>${S.variant}</b><span>${NAMES[S.variant]}</span></span>
      <button type="button" class="psw__b" data-act="v-next" data-k="psw-next" aria-label="下一个变体">${icon('chev-r')}</button>
      <span class="psw__k" aria-hidden="true">← →</span>
    </div>`;
  window.SkyVariants = { switcher, cycle, names: NAMES };
})();
