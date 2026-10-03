/* PROTOTYPE — 报表与数据处理：用量与产出、会话产效、提示词、响应与等待、活动记录、数据处理；以及会话对话视图与会话数据面板。
 * 口径守则：确定性指标来自原件；任务类型与提示词要素为模型推断；未知不计为 0；不合成评分、不按人排名；比值只在同类任务间参考。
 */
(() => {
  'use strict';
  const U = window.SkyUI, V = window.SkyViz, X = window.SkyData;
  const { D, S, M, esc, icon, md, dayLabel, weekday, WD, avatar, projChip, pill, pageHead, notice, set, go, register, onAct, after } = U;
  const AG = { 'Claude Code CLI': '1', 'Codex CLI': '2', 'Codex Desktop': '3' };
  const MEMBERS = D.members;
  S.rf = S.rf || { range: 'W39', member: 'all', agent: 'all', project: 'all' };
  const rangeDays = () => X.daysOf(S.rf.range);

  /* ---------------- shared bits ---------------- */
  onAct('rf', (el) => set({ rf: Object.assign({}, S.rf, { [el.dataset.f]: el.dataset.v }) }));
  onAct('rf-sel', (el) => set({ rf: Object.assign({}, S.rf, { [el.dataset.f]: el.value }) }));
  onAct('rf-go', (el) => { S.rf = Object.assign({}, S.rf, { member: el.dataset.m, range: el.dataset.r || S.rf.range }); go(el.dataset.to); });
  const filterBar = (opts = {}) => {
    const f = S.rf;
    const sel = (id, key, label, options) => `<div class="field field--inline"><label for="${id}">${label}</label><select id="${id}" data-change="rf-sel" data-f="${key}">${options.map(([v, t]) => `<option value="${v}" ${f[key] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
    return `<div class="rfbar" role="group" aria-label="报表筛选（作用于本页所有图表）">
      <div class="seg" role="group" aria-label="时间范围">${Object.keys(X.RANGES).map((k) => `<button type="button" class="seg__b ${f.range === k ? 'is-on' : ''}" aria-pressed="${f.range === k}" data-act="rf" data-f="range" data-v="${k}" data-k="rf-${k}">${X.RANGES[k].label}</button>`).join('')}</div>
      ${sel('rf-m', 'member', opts.memberLabel || '员工', [['all', '全部员工'], ...MEMBERS.map((m) => [m.id, m.name])])}
      ${sel('rf-a', 'agent', 'Agent', [['all', '全部 Agent'], ['Claude Code CLI', 'Claude Code CLI'], ['Codex CLI', 'Codex CLI'], ['Codex Desktop', 'Codex Desktop']])}
      ${sel('rf-p', 'project', '项目', [['all', '全部项目'], ...Object.entries(D.projects).map(([id, p]) => [id, p.name])])}
      <p class="rfbar__n">北京时间 · 截至 9月24日 ${D.now.time} · <a class="linkbtn" href="#pipeline" data-go="pipeline">指标口径</a></p>
    </div>`;
  };
  const guard = (extra = '') => `<p class="guard">${icon('info')}<span>确定性指标来自会话原件；任务类型与提示词要素为模型推断。未上报的数据标为“未知”，不计为 0。平台不合成评分、不按人排名${extra}。</span></p>`;
  const who = (mid) => `${avatar(M[mid], 'xs')}${esc(M[mid].name)}`;
  const sesTitle = (sid) => { const s = D.sessions[sid]; return `${s.title}（${sid}）`; };
  const hmOf = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`;
  const memberScope = () => (S.rf.member === 'all' ? MEMBERS : MEMBERS.filter((m) => m.id === S.rf.member));
  const scoped = (extra = {}) => X.sessionsIn(Object.assign({}, S.rf, extra));
  const emptyScope = () => U.empty('none', '当前筛选下没有会话', '换一个时间范围、员工、Agent 或项目试试。接入前的旧会话不在存档中。');

  /* ================= 用量与产出 ================= */
  register('usage', () => {
    const list = scoped();
    const a = X.agg(list);
    const days = rangeDays();
    const perDay = days.map((d) => X.agg(list.filter(([, s]) => s.date === d)));
    const dayLabels = days.map(dayLabel);
    if (!list.length) return `${pageHead({ title: '用量与产出', sub: '谁用了多少 Token，会话里产出了什么。' })}${filterBar()}${emptyScope()}`;

    const kpis = `<div class="stats-row">
      ${V.stat({ label: 'Token 输入（已知）', value: V.fmtTok(a.tin), sub: `输出 ${V.fmtTok(a.tout)} · ${a.unknown ? `<span class="unk">${a.unknown} 个会话未上报</span>` : '全部会话已上报'}`, trend: V.spark(perDay.map((x) => (x.known ? x.tin : null)), dayLabels, { fmt: V.fmtTok, label: '每日 Token 输入' }) })}
      ${V.stat({ label: '会话', value: a.sessions, sub: `${a.turns} 轮提示词 · ${a.tools} 次工具调用`, trend: V.spark(perDay.map((x) => x.sessions), dayLabels, { label: '每日会话' }) })}
      ${V.stat({ label: '已验证结果', value: a.verified, sub: `另有 ${a.claimed} 条只有声称、无工具结果`, trend: V.spark(perDay.map((x) => x.verified), dayLabels, { label: '每日已验证结果' }) })}
      ${V.stat({ label: '代码变更', value: `+${V.num(a.add)}`, sub: `−${V.num(a.del)} 行 · ${a.files} 个文件（按会话累计）` })}
      ${V.stat({ label: '测试通过', value: a.testsRun ? V.pct(a.testsPass / a.testsRun) : '—', sub: `${a.testsPass}/${a.testsRun} 次运行 · 会话内提交 ${a.commits} 次` })}
    </div>`;

    // A · Token by person × agent (stacked, adjacent series ≤ 3)
    const people = memberScope().filter((m) => list.some(([, s]) => s.member === m.id));
    const rowsA = people.map((m) => {
      const mine = list.filter(([, s]) => s.member === m.id);
      const by = (ag) => X.agg(mine.filter(([, s]) => s.agent === ag));
      const cc = by('Claude Code CLI'), cx = by('Codex CLI'), cd = mine.filter(([, s]) => s.agent === 'Codex Desktop');
      return {
        m, cc, cx, cdN: cd.length,
        row: {
          label: who(m.id), href: `member.${m.id}.week.W39`,
          segs: [
            { s: '1', v: cc.tin, tt: [V.fmtTok(cc.tin), `${m.name} · Claude Code CLI · ${cc.sessions} 个会话`] },
            { s: '2', v: cx.tin, tt: [V.fmtTok(cx.tin), `${m.name} · Codex CLI · ${cx.sessions} 个会话`] }
          ],
          value: V.fmtTok(cc.tin + cx.tin),
          tail: cd.length ? `<span class="unk" title="Codex Desktop 未在会话记录中上报用量">+${cd.length} 个会话未知</span>` : ''
        }
      };
    });
    const figA = V.figure({
      id: 'usage-tok', title: '每人 Token 输入（已知）', sub: '按 Agent 堆叠；Codex Desktop 当前版本不上报用量，单独标为未知，不画成 0',
      chart: V.hbars(rowsA.map((x) => x.row), { fmt: V.fmtTok }),
      legend: V.legend([['1', 'Claude Code CLI'], ['2', 'Codex CLI'], ['unk', 'Codex Desktop（未知）', 'unk']]),
      table: V.table(['员工', 'Claude Code CLI', 'Codex CLI', 'Codex Desktop', '合计（已知）'], rowsA.map((x) => [esc(x.m.name), V.fmtTok(x.cc.tin), V.fmtTok(x.cx.tin), x.cdN ? `${x.cdN} 个会话 · 未知` : '—', V.fmtTok(x.cc.tin + x.cx.tin)]), { right: [1, 2, 4] })
    });

    // B · outputs bar-table (each column its own scale; no dual axis)
    const perP = people.map((m) => ({ m, a: X.agg(list.filter(([, s]) => s.member === m.id)) }));
    const mx = (f) => Math.max(1, ...perP.map((x) => f(x.a)));
    const figB = `<figure class="fig"><figcaption class="fig__h"><div class="fig__t"><h3>每人产出</h3><p>每列独立比例尺；“已验证结果”指报告中有工具结果佐证的结果条目</p></div></figcaption>
      <div class="fig__b"><div class="tblwrap"><table class="tbl tbl--bars">
        <thead><tr><th scope="col">员工</th><th scope="col">会话</th><th scope="col">已验证结果</th><th scope="col">仅声称</th><th scope="col">代码变更行</th><th scope="col">测试通过</th><th scope="col">会话内提交</th></tr></thead>
        <tbody>${perP.map(({ m, a: x }) => `<tr>
          <th scope="row" class="nowrap"><a href="#member.${m.id}.week.W39" data-go="member.${m.id}.week.W39">${who(m.id)}</a></th>
          <td class="num">${x.sessions}</td>
          <td>${V.barCell(x.verified, mx((q) => q.verified), String(x.verified))}</td>
          <td>${V.barCell(x.claimed, mx((q) => q.claimed), String(x.claimed), 'deemph')}</td>
          <td>${V.barCell(x.add + x.del, mx((q) => q.add + q.del), `+${V.num(x.add)} / −${V.num(x.del)}`)}</td>
          <td>${V.barCell(x.testsPass, mx((q) => q.testsPass), `${x.testsPass}/${x.testsRun}`)}</td>
          <td class="num">${x.commits}</td></tr>`).join('')}</tbody></table></div></div></figure>`;

    // C · scatter: Token vs verified per session; member filter = emphasis, others as context
    const all = X.sessionsIn(Object.assign({}, S.rf, { member: 'all' }));
    const emphOn = S.rf.member !== 'all';
    const mk = ([sid, s]) => { const m = X.metrics[sid]; return { x: m.tin / 1e6, y: m.verified, emph: emphOn ? s.member === S.rf.member : true, go: `session.${sid}`, tt: [`已验证 ${m.verified} · Token ${V.fmtTok(m.tin)}`, s.title, `${M[s.member].name} · ${md(s.date)} · ${m.kind}`] }; };
    const known = all.filter(([sid]) => X.metrics[sid].known), unk = all.filter(([sid]) => !X.metrics[sid].known);
    const figC = V.figure({
      id: 'usage-sc', title: '会话：Token 与已验证结果', sub: emphOn ? `高亮 ${M[S.rf.member].name} 的会话，其余员工的会话作为灰色参照；点圆点打开会话` : '每个点是一个会话；在筛选中选择员工可高亮其会话；点圆点打开会话',
      chart: V.scatter(known.map(mk), unk.map(([sid, s]) => Object.assign(mk([sid, s]), { tt: [`已验证 ${X.metrics[sid].verified} · Token 未知`, s.title, `${M[s.member].name} · ${md(s.date)} · ${s.agent} 未上报用量`] })), { xLabel: 'Token 输入（百万）', yLabel: '已验证结果', fmtX: (v) => v.toFixed(1), jitterY: true, label: '会话 Token 与已验证结果散点图' }),
      table: V.table(['会话', '员工', '类型', 'Token 输入', '已验证结果'], all.map(([sid, s]) => [`<a href="#session.${sid}" data-go="session.${sid}">${esc(s.title)}</a>`, esc(M[s.member].name), X.metrics[sid].kind, V.fmtTok(X.metrics[sid].tin), X.metrics[sid].verified]), { right: [3, 4] }),
      note: '排查类会话通常 Token 高、代码与结果少；比较请结合任务类型（见“会话产效”）。'
    });

    // D · small multiples: daily Token per person
    const smax = V.nice(Math.max(1, ...people.flatMap((m) => days.map((d) => X.agg(list.filter(([, s]) => s.member === m.id && s.date === d)).tin))));
    const figD = V.figure({
      id: 'usage-sm', title: '每日 Token 输入（已知）', sub: '每人一张小图，同一比例尺；顶部的短横表示当天有会话未上报用量',
      chart: `<div class="multiples">${people.map((m) => {
        const vals = days.map((d) => { const x = X.agg(list.filter(([, s]) => s.member === m.id && s.date === d)); return { v: x.tin, unknown: x.unknown > 0, label: `${m.name} · ${dayLabel(d)}${x.unknown ? ` · ${x.unknown} 个会话未知` : ''}`, tt: x.sessions ? V.fmtTok(x.tin) : '无会话', short: String(Number(d.slice(8))) }; });
        return `<div class="mult"><p class="mult__h">${who(m.id)}<span class="num">${V.fmtTok(vals.reduce((q, x) => q + (x.v || 0), 0))}</span></p>${V.columns(vals, { max: smax, label: `${m.name} 每日 Token` })}</div>`;
      }).join('')}</div>`,
      table: V.table(['员工', ...days.map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`)], people.map((m) => [esc(m.name), ...days.map((d) => { const x = X.agg(list.filter(([, s]) => s.member === m.id && s.date === d)); return x.sessions ? `${V.fmtTok(x.tin)}${x.unknown ? '＋未知' : ''}` : '—'; })]))
    });
    return `${pageHead({ title: '用量与产出', sub: '谁用了多少 Token，会话里产出了什么。产出只统计会话内可核对的结果：代码变更、测试结果、提交，以及有工具结果佐证的结论。' })}
      ${filterBar()}${kpis}${guard()}
      <div class="figgrid">${figA}${figB}</div>
      ${figC}${figD}`;
  });

  /* ================= 会话产效 ================= */
  S.eff = S.eff || { sort: 'date', dir: -1, sel: 's-7f3a' };
  onAct('eff-sort', (el) => { const k = el.dataset.v; set({ eff: Object.assign({}, S.eff, { sort: k, dir: S.eff.sort === k ? -S.eff.dir : -1 }) }); });
  onAct('eff-sel', (el) => set({ eff: Object.assign({}, S.eff, { sel: el.dataset.v }) }));
  const sessionSegments = (sid) => {
    const s = D.sessions[sid], m = X.metrics[sid];
    const start = X.toMin(s.start), end = /\d/.test(s.end) ? X.toMin(s.end) : X.toMin(D.now.time);
    const segs = [];
    const ps = m.prompts;
    ps.forEach((p, i) => {
      const w = m.waits[i]; // wait after this prompt's agent turn
      const a = p.at, b = w ? w.at : (i === ps.length - 1 ? end : (ps[i + 1] ? ps[i + 1].at : end));
      segs.push({ a, b, kind: 'work', tt: [`Agent 工作 ${V.fmtMin(b - a)}`, `${hmOf(a)}–${hmOf(b)} · 第 ${i + 1} 轮`] });
      if (w) segs.push({ a: w.at, b: w.at + w.min, kind: 'wait', tt: [`等待回复 ${V.fmtMin(w.min)}`, `${hmOf(w.at)} 起${w.parallel ? ' · 期间在其他会话中活动' : ''}`] });
    });
    m.perms.forEach((p) => segs.push({ a: p.at, b: p.at + p.min, kind: 'perm', tt: [`权限请求等待 ${V.fmtMin(p.min)}`, p.cmd] }));
    if (sid === 's-h230') segs.push({ a: X.toMin('11:30'), b: X.toMin('12:10'), kind: 'gap', tt: ['采集缺口 40 分钟', '本地磁盘空间不足'] });
    return { segs, start, end };
  };
  register('efficiency', () => {
    const list = X.sessionsIn(Object.assign({}, S.rf, { member: 'all' }));
    const done = list.filter(([, s]) => /\d/.test(s.end));
    if (!done.length) return `${pageHead({ title: '会话产效' })}${filterBar({ memberLabel: '高亮员工' })}${emptyScope()}`;
    const emphOn = S.rf.member !== 'all';
    const rows = X.KINDS.map((k) => {
      const ks = done.filter(([sid]) => X.metrics[sid].kind === k && X.metrics[sid].known);
      const pts = ks.map(([sid, s]) => { const m = X.metrics[sid]; const r = X.ratio(m); return { x: r, emph: emphOn ? s.member === S.rf.member : true, go: `session.${sid}`, tt: [`${r.toFixed(1)} 条 / 百万 Token`, s.title, `${M[s.member].name} · 已验证 ${m.verified} · Token ${V.fmtTok(m.tin)}`] }; });
      return { label: k, pts, med: X.median(pts.map((p) => p.x)) };
    }).filter((r) => r.pts.length);
    const figS = V.figure({
      id: 'eff-strip', title: '按任务类型看产效比', sub: `已验证结果 ÷ 百万 Token（已知）。竖线为该类型中位数${emphOn ? `；高亮 ${M[S.rf.member].name}` : ''}`,
      chart: V.strip(rows, { xLabel: '已验证结果 / 百万 Token', fmtX: (v) => v.toFixed(1), label: '按任务类型的产效比分布' }),
      table: V.table(['任务类型', '会话数', '中位数', '最小', '最大'], rows.map((r) => [r.label, r.pts.length, r.med.toFixed(1), Math.min(...r.pts.map((p) => p.x)).toFixed(1), Math.max(...r.pts.map((p) => p.x)).toFixed(1)]), { right: [1, 2, 3, 4] }),
      note: `${done.filter(([sid]) => !X.metrics[sid].known).length} 个 Token 未知的会话不计算比值（Codex Desktop）。任务类型为模型推断。`
    });
    const tins = done.filter(([sid]) => X.metrics[sid].known).map(([sid]) => X.metrics[sid].tin);
    const p75 = X.quant(tins, 0.75);
    const review = [];
    done.forEach(([sid, s]) => {
      const m = X.metrics[sid];
      const reasons = [];
      if (m.known && m.tin >= p75 && m.verified === 0) reasons.push('Token 较高且没有已验证结果');
      if (m.claimed > m.verified) reasons.push('声称多于已验证');
      if (m.rework >= 2) reasons.push(`返工 ${m.rework} 次`);
      if (reasons.length) review.push({ sid, s, m, reasons });
    });
    const sorters = {
      date: ([, s]) => s.date + s.start, tin: ([sid]) => X.metrics[sid].tin ?? -1, turns: ([sid]) => X.metrics[sid].turns, code: ([sid]) => X.metrics[sid].add + X.metrics[sid].del,
      verified: ([sid]) => X.metrics[sid].verified, ratio: ([sid]) => X.ratio(X.metrics[sid]) ?? -1, wait: ([sid]) => X.metrics[sid].waitMin / X.metrics[sid].activeMin
    };
    const shown = (S.rf.member === 'all' ? done : done.filter(([, s]) => s.member === S.rf.member)).slice().sort((p, q) => { const a1 = sorters[S.eff.sort](p), b1 = sorters[S.eff.sort](q); return (a1 > b1 ? 1 : a1 < b1 ? -1 : 0) * S.eff.dir; });
    const sel = shown.find(([sid]) => sid === S.eff.sel) ? S.eff.sel : (shown[0] && shown[0][0]);
    const th = (k, label, right) => `<th scope="col" class="${right ? 'r' : ''}" aria-sort="${S.eff.sort === k ? (S.eff.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="thsort" data-act="eff-sort" data-v="${k}" data-k="es-${k}">${label}${S.eff.sort === k ? icon(S.eff.dir > 0 ? 'chev-d' : 'chev-d', S.eff.dir > 0 ? 'is-up' : '') : ''}</button></th>`;
    const detail = (() => {
      if (!sel) return '';
      const s = D.sessions[sel], m = X.metrics[sel];
      const { segs, start, end } = sessionSegments(sel);
      return `<section class="effd" aria-label="会话明细">
        <header class="effd__h"><div><p class="effd__t">${esc(s.title)}</p><p class="muted">${who(s.member)} · ${esc(s.agent)} · ${dayLabel(s.date)} ${s.start}–${s.end} · ${m.kind}</p></div>
          <a class="btn btn--quiet btn--sm" href="#session.${sel}" data-go="session.${sel}">${icon('session')}打开对话</a></header>
        ${V.workWait(segs, start, end, { label: `${s.title} 的 Agent 工作与等待` })}
        ${V.legend([['work', 'Agent 工作'], ['wait', '等待用户回复'], ['perm', '等待权限批准'], ...(sel === 's-h230' ? [['gap', '采集缺口']] : [])])}
        <dl class="effd__kv">
          <div><dt>Token 输入/输出</dt><dd class="num">${m.known ? `${V.fmtTok(m.tin)} / ${V.fmtTok(m.tout)}` : '<span class="unk">未知</span>'}</dd></div>
          <div><dt>提示词 · 工具调用</dt><dd class="num">${m.turns} · ${m.tools}</dd></div>
          <div><dt>代码变更</dt><dd class="num">+${m.add} / −${m.del}</dd></div>
          <div><dt>已验证 · 仅声称</dt><dd class="num">${m.verified} · ${m.claimed}</dd></div>
          <div><dt>产效比</dt><dd class="num">${X.ratio(m) != null ? `${X.ratio(m).toFixed(1)} 条 / 百万 Token` : '—（Token 未知）'}</dd></div>
          <div><dt>代码产出</dt><dd class="num">${X.codeRatio(m) != null ? `${V.num(X.codeRatio(m))} 行 / 百万 Token` : '—'}</dd></div>
          <div><dt>等待占活跃区间</dt><dd class="num">${V.pct(m.waitMin / m.activeMin)}（${V.fmtMin(m.waitMin)}）</dd></div>
          <div><dt>返工提示词</dt><dd class="num">${m.rework}</dd></div>
        </dl>
      </section>`;
    })();
    return `${pageHead({ title: '会话产效', sub: '每个会话投入了多少、得到了什么。比值拆开给出分子和分母，只在同类任务之间参考。' })}
      ${filterBar({ memberLabel: '高亮员工' })}
      <section class="defcard"><p><b>产效比</b> = 已验证结果 ÷ 百万 Token（已知）　·　<b>代码产出</b> = 代码变更行 ÷ 百万 Token　·　<b>等待占比</b> = 等待时长 ÷ 活跃区间</p>
        <p class="muted">只对 Token 已知且已结束的会话计算；排查类任务天然 Token 高、代码少，不能与实现类直接比较。不合成总分、不按人排名。</p></section>
      ${figS}
      ${review.length ? `<section class="block"><h2 class="block__h">值得复盘的会话 <span class="muted num">${review.length}</span></h2>
        <p class="block__d">用于复盘提示词与流程，不作为考核依据。</p>
        <ul class="review">${review.slice(0, 8).map((x) => `<li><a class="review__i" href="#session.${x.sid}" data-go="session.${x.sid}">
          <span class="review__t">${esc(x.s.title)}<span class="muted"> · ${esc(M[x.s.member].name)} · ${md(x.s.date)} · ${x.m.kind}</span></span>
          <span class="review__r">${x.reasons.map((r) => `<span class="tag tag--warn">${r}</span>`).join('')}</span>${icon('arrow')}</a></li>`).join('')}</ul></section>` : ''}
      <section class="block"><h2 class="block__h">会话明细 <span class="muted num">${shown.length}</span></h2>
        <div class="effgrid">
          <div class="tblwrap"><table class="tbl tbl--eff">
            <thead><tr><th scope="col">会话</th>${th('date', '日期')}${th('tin', 'Token', 1)}${th('turns', '提示词', 1)}${th('code', '代码行', 1)}${th('verified', '已验证', 1)}${th('ratio', '产效比', 1)}${th('wait', '等待占比', 1)}</tr></thead>
            <tbody>${shown.map(([sid, s]) => { const m = X.metrics[sid]; const r = X.ratio(m); return `<tr class="${sid === sel ? 'is-sel' : ''}">
              <td><button type="button" class="rowbtn" data-act="eff-sel" data-v="${sid}" data-k="ef-${sid}" aria-pressed="${sid === sel}"><span>${esc(s.title)}</span><span class="muted">${esc(M[s.member].name)} · ${m.kind}</span></button></td>
              <td class="num nowrap">${md(s.date)} ${s.start}</td>
              <td class="num r">${m.known ? V.fmtTok(m.tin) : '<span class="unk">未知</span>'}</td>
              <td class="num r">${m.turns}</td><td class="num r">+${m.add}/−${m.del}</td>
              <td class="num r">${m.verified}${m.claimed ? `<span class="muted"> +${m.claimed}声称</span>` : ''}</td>
              <td class="num r">${r != null ? r.toFixed(1) : '—'}</td>
              <td class="num r">${V.pct(m.waitMin / m.activeMin)}</td></tr>`; }).join('')}</tbody></table></div>
          ${detail}
        </div></section>
      ${guard('；比值只在同类任务间参考')}`;
  });

  /* ================= 提示词 ================= */
  const GROUPS = [['实现与修复', ['实现', '修复'], '1'], ['排查', ['排查'], '2'], ['重构与测试', ['重构', '测试'], '3'], ['运维与整理', ['运维', '整理'], '4']];
  const tip = (a) => {
    const c = [['ctxRate', '补充文件路径、报错日志或复现步骤'], ['consRate', '写明不能改动的范围与约束'], ['accRate', '写明验收方式，例如要跑哪些测试'], ['goalRate', '开头一句写清目标']];
    const low = c.filter(([k]) => a[k] != null).sort((x, y) => a[x[0]] - a[y[0]])[0];
    return low ? low[1] : '—';
  };
  register('prompts', () => {
    const list = scoped();
    if (!list.length) return `${pageHead({ title: '提示词分析' })}${filterBar()}${emptyScope()}`;
    const a = X.agg(list);
    const people = memberScope().filter((m) => list.some(([, s]) => s.member === m.id));
    const perP = people.map((m) => ({ m, a: X.agg(list.filter(([, s]) => s.member === m.id)) }));
    const kpis = `<div class="stats-row">
      ${V.stat({ label: '提示词', value: a.promptN, sub: `${a.sessions} 个会话 · 中位长度 ${a.lenMed != null ? Math.round(a.lenMed) : '—'} 字` })}
      ${V.stat({ label: '提供了上下文', value: V.pct(a.ctxRate), sub: '文件路径、日志、复现步骤等（模型推断）' })}
      ${V.stat({ label: '返工率', value: V.pct(a.reworkRate), sub: '纠正或推翻上一轮结果的提示词占比（不含首条）' })}
      ${V.stat({ label: '无返工会话', value: V.pct(a.cleanShare), sub: '整段会话没有返工提示词' })}
      ${V.stat({ label: 'Agent 追问', value: V.pct(a.clarifyRate), sub: 'Agent 向用户澄清需求的次数 ÷ 提示词' })}
    </div>`;
    const els = [['goalRate', '目标明确'], ['consRate', '给出约束'], ['ctxRate', '提供上下文'], ['accRate', '验收标准']];
    const step = (v) => (v == null ? 0 : Math.min(8, 1 + Math.floor(v * 8)));
    const figE = V.figure({
      id: 'pr-el', title: '提示词要素覆盖', sub: '每格是该员工提示词中包含此要素的比例（模型推断）；颜色越深比例越高',
      chart: V.heatmap(perP.map((x) => x.m.name), els.map((e) => e[1]), (ri, ci) => { const v = perP[ri].a[els[ci][0]]; return { step: step(v), text: V.pct(v), tt: [V.pct(v), `${perP[ri].m.name} · ${els[ci][1]} · ${perP[ri].a.promptN} 条提示词`] }; }, { label: '提示词要素覆盖热力表', scaleLabel: '比例', stops: ['0–12%', '13–25%', '26–37%', '38–50%', '51–62%', '63–75%', '76–87%', '88–100%'] }),
      table: V.table(['员工', ...els.map((e) => e[1]), '提示词数'], perP.map((x) => [esc(x.m.name), ...els.map((e) => V.pct(x.a[e[0]])), x.a.promptN]), { right: [1, 2, 3, 4, 5] })
    });
    // rework after ctx vs no ctx
    let aC = 0, rC = 0, aN = 0, rN = 0;
    list.forEach(([sid]) => { const ps = X.metrics[sid].prompts; ps.forEach((p, i) => { if (i === 0) return; if (ps[i - 1].ctx) { aC++; if (p.rework) rC++; } else { aN++; if (p.rework) rN++; } }); });
    const figR = V.figure({
      id: 'pr-rw', title: '上下文与返工', sub: '下一轮提示词为返工的比例，按上一条提示词是否提供了上下文分组',
      chart: V.hbars([
        { label: '上一条提供了上下文', segs: [{ s: '1', v: aC ? rC / aC : 0, tt: [V.pct(aC ? rC / aC : 0), `${rC}/${aC} 次返工`] }], value: V.pct(aC ? rC / aC : 0) },
        { label: '上一条没有上下文', segs: [{ s: '1', v: aN ? rN / aN : 0, tt: [V.pct(aN ? rN / aN : 0), `${rN}/${aN} 次返工`] }], value: V.pct(aN ? rN / aN : 0) }
      ], { max: Math.max(0.05, V.nice(Math.max(aC ? rC / aC : 0, aN ? rN / aN : 0))), fmt: (v) => V.pct(v) }),
      table: V.table(['分组', '后续提示词', '返工', '返工率'], [['上一条提供了上下文', aC, rC, V.pct(aC ? rC / aC : 0)], ['上一条没有上下文', aN, rN, V.pct(aN ? rN / aN : 0)]], { right: [1, 2, 3] }),
      note: '相关不等于因果：这组对比用于提示写法，不用于评价个人。'
    });
    const buckets = [[0, 15, '≤15 字'], [16, 30, '16–30 字'], [31, 60, '31–60 字'], [61, 120, '61–120 字'], [121, 1e9, '>120 字']];
    const bRows = buckets.map(([lo, hi, label]) => { const ps = a.prompts.filter((p) => p.len >= lo && p.len <= hi); const nf = ps.filter((p) => !p.first); return { label, n: ps.length, rw: nf.length ? nf.filter((p) => p.rework).length / nf.length : null }; });
    const figL = V.figure({
      id: 'pr-len', title: '提示词长度', sub: '左：各长度段的数量；右：该长度段的返工率（两张图同一行序，不共用坐标轴）',
      chart: `<div class="pair">${V.hbars(bRows.map((b) => ({ label: b.label, segs: [{ s: '1', v: b.n, tt: [`${b.n} 条`, b.label] }], value: b.n })), { axis: false })}${V.hbars(bRows.map((b) => ({ label: b.label, segs: [{ s: '2', v: b.rw || 0, tt: [V.pct(b.rw), `${b.label} 的返工率`] }], value: V.pct(b.rw) })), { axis: false, max: Math.max(0.05, V.nice(Math.max(...bRows.map((b) => b.rw || 0)))) })}</div>`,
      table: V.table(['长度', '提示词数', '返工率'], bRows.map((b) => [b.label, b.n, V.pct(b.rw)]), { right: [1, 2] })
    });
    const figK = V.figure({
      id: 'pr-kind', title: '提示词的任务类型构成', sub: '按会话的任务类型（模型推断）归组；每行合计 100%',
      chart: V.hbars(perP.map(({ m, a: x }) => ({ label: who(m.id), segs: GROUPS.map(([g, ks, s]) => { const n = x.prompts.filter((p) => ks.includes(p.cat)).length; return { s, v: n / Math.max(1, x.promptN), tt: [V.pct(n / Math.max(1, x.promptN)), `${m.name} · ${g} · ${n} 条`] }; }), value: `${x.promptN} 条` })), { max: 1, axis: false }),
      legend: V.legend(GROUPS.map(([g, , s]) => [s, g])),
      table: V.table(['员工', ...GROUPS.map((g) => g[0]), '合计'], perP.map(({ m, a: x }) => [esc(m.name), ...GROUPS.map(([, ks]) => x.prompts.filter((p) => ks.includes(p.cat)).length), x.promptN]), { right: [1, 2, 3, 4, 5] })
    });
    const ex = (sid, n) => { const it = X.conv[sid].find((q) => q.type === 'msg' && q.n === n); return it ? { sid, n, text: it.text } : null; };
    const good = [[ex('s-7f3a', 18), '目标、约束、验收一句话写清；Agent 一次完成修改，测试结果佐证。'], [ex('s-h230', 1), '写明范围（2 个资源）与禁止事项（不要执行），Agent 只输出命令，无返工。'], [ex('s-c517', 31), '给出可检验的规则（最多两层）与提示方式。']].filter((x) => x[0]);
    const bad = [[ex('s-7f3a', 96), '上一轮缺少“只读”约束，Agent 追问后才纠正；把约束放进首条提示词可省一轮。'], [ex('s-x118', 49), '测试数据来源没有事先说明，导致返工。'], [ex('s-2c90', 233), '对“已解决”的口径没有事先约定。']].filter((x) => x[0]);
    const exList = (arr, kind) => `<ul class="exlist">${arr.map(([e, why]) => `<li class="ex ex--${kind}"><blockquote class="ex__q">“${esc(e.text)}”</blockquote>
      <p class="ex__m">${icon(kind === 'good' ? 'check' : 'refresh')}<span>${why}</span></p>
      <p class="ex__src"><a href="#session.${e.sid}.m${e.n}" data-go="session.${e.sid}.m${e.n}">${esc(M[D.sessions[e.sid].member].name)} · ${esc(D.sessions[e.sid].title)} · #${e.n}</a><span class="ev ev--infer">${icon('infer')}<span class="ev__k">模型推断</span></span></p></li>`).join('')}</ul>`;
    return `${pageHead({ title: '提示词分析', sub: '员工怎么向 Agent 提需求：写清了什么、漏了什么、哪些写法更少返工。' })}
      ${filterBar()}${kpis}${guard()}
      <div class="figgrid">${figE}${figR}</div>
      <div class="figgrid">${figL}${figK}</div>
      <section class="block"><h2 class="block__h">写法示例</h2>
        <div class="expair"><div><p class="expair__h">${icon('check')}少返工的写法</p>${exList(good, 'good')}</div><div><p class="expair__h">${icon('refresh')}引起返工的写法</p>${exList(bad, 'bad')}</div></div></section>
      <section class="block"><h2 class="block__h">写法建议（模型推断）</h2>
        <ul class="tips">${perP.map(({ m, a: x }) => `<li>${who(m.id)}<span>${esc(tip(x))}</span><span class="muted num">返工率 ${V.pct(x.reworkRate)} · ${x.promptN} 条</span></li>`).join('')}</ul>
        <p class="side__n">建议取自该员工占比最低的提示词要素，供辅导参考。</p></section>`;
  });

  /* ================= 响应与等待 ================= */
  register('response', () => {
    const list = scoped();
    if (!list.length) return `${pageHead({ title: '响应与等待' })}${filterBar()}${emptyScope()}`;
    const a = X.agg(list);
    const kpis = `<div class="stats-row">
      ${V.stat({ label: '等待回复中位数', value: V.fmtMin(a.waitMed), sub: `${a.waits.length} 次 Agent 结束本轮后等待用户` })}
      ${V.stat({ label: 'P90', value: V.fmtMin(a.waitP90), sub: '九成等待短于此值' })}
      ${V.stat({ label: '10 分钟以上', value: V.pct(a.longShare), sub: `${a.waits.filter((w) => w.min >= 10).length} 次长等待` })}
      ${V.stat({ label: '权限请求等待', value: V.fmtMin(a.permMed), sub: `中位数 · ${a.perms.length} 次；这段时间 Agent 被阻塞` })}
      ${V.stat({ label: '等待期间在别处工作', value: V.pct(a.parallelShare), sub: '同一员工在其他会话中有活动' })}
    </div>`;
    // heatmap weekday × hour
    const hours = Array.from({ length: 14 }, (_, i) => 8 + i);
    const wdOrder = [1, 2, 3, 4, 5, 6, 0];
    const cells = {};
    list.forEach(([sid, s]) => X.metrics[sid].waits.forEach((w) => { const k = `${weekday(s.date)}|${Math.floor(w.at / 60)}`; (cells[k] = cells[k] || []).push(w.min); }));
    const th = [1, 2, 3, 5, 8, 12, 20];
    const stepOf = (v) => (v == null ? 0 : 1 + th.filter((t) => v > t).length);
    const usedRows = wdOrder.filter((wd) => hours.some((h) => cells[`${wd}|${h}`]));
    const figH = V.figure({
      id: 'rs-hm', title: '什么时候等得久', sub: '星期 × 小时的等待中位数；空白表示该时段没有等待记录',
      chart: V.heatmap(usedRows.map((wd) => WD[wd]), hours.map((h) => String(h).padStart(2, '0')), (ri, ci) => { const xs = cells[`${usedRows[ri]}|${hours[ci]}`]; const v = xs ? X.median(xs) : null; return { step: stepOf(v), text: '', tt: xs ? [`中位 ${V.fmtMin(v)}`, `${WD[usedRows[ri]]} ${hours[ci]}:00–${hours[ci] + 1}:00 · ${xs.length} 次`] : null }; }, { every: 2, label: '等待中位数热力图', scaleLabel: '中位等待', stops: ['≤1 分', '1–2', '2–3', '3–5', '5–8', '8–12', '12–20', '>20 分'] }),
      table: V.table(['星期', ...hours.map((h) => `${h}时`)], usedRows.map((wd) => [WD[wd], ...hours.map((h) => { const xs = cells[`${wd}|${h}`]; return xs ? V.fmtMin(X.median(xs)) : '—'; })]))
    });
    const people = memberScope().filter((m) => list.some(([, s]) => s.member === m.id));
    const all = X.sessionsIn(Object.assign({}, S.rf, { member: 'all' }));
    const emphOn = S.rf.member !== 'all';
    const rowsD = MEMBERS.filter((m) => all.some(([, s]) => s.member === m.id)).map((m) => {
      const ws = all.filter(([, s]) => s.member === m.id).flatMap(([sid, s]) => X.metrics[sid].waits.map((w) => ({ w, s, sid })));
      return { label: m.name, pts: ws.map(({ w, s, sid }) => ({ x: Math.min(w.min, 30), emph: emphOn ? m.id === S.rf.member : true, go: `session.${sid}`, tt: [`等待 ${V.fmtMin(w.min)}`, `${s.title} · ${md(s.date)} ${hmOf(w.at)}`, w.parallel ? '期间在其他会话中活动' : ''] })), med: X.median(ws.map((x) => Math.min(x.w.min, 30))) };
    });
    const figD = V.figure({
      id: 'rs-strip', title: '每人的等待分布', sub: `每个点是一次等待（超过 30 分钟的归到右端）；竖线为中位数${emphOn ? `；高亮 ${M[S.rf.member].name}` : ''}`,
      chart: V.strip(rowsD, { xmax: 30, xLabel: '等待回复（分钟）', fmtX: (v) => String(Math.round(v)), label: '每人等待分布' }),
      table: V.table(['员工', '等待次数', '中位数', 'P90', '10 分钟以上', '权限等待中位', '期间在别处工作'], people.map((m) => { const x = X.agg(list.filter(([, s]) => s.member === m.id)); return [esc(m.name), x.waits.length, V.fmtMin(x.waitMed), V.fmtMin(x.waitP90), V.pct(x.longShare), V.fmtMin(x.permMed), V.pct(x.parallelShare)]; }), { right: [1, 2, 3, 4, 5, 6] })
    });
    const topPerms = a.perms.slice().sort((p, q) => q.min - p.min).slice(0, 6);
    return `${pageHead({ title: '响应与等待', sub: 'Agent 回复后，多久得到下一条指令；权限请求让 Agent 停了多久。' })}
      ${filterBar()}
      <section class="defcard"><p><b>等待回复</b>：Agent 结束本轮到用户下一次输入的间隔，不含会话结束后的空闲。<b>权限等待</b>：Agent 发起命令确认到用户批准的间隔。</p>
        <p class="muted">等待不等于怠工：可能在审阅改动、开会或处理并行会话。这组数据用来发现被卡住的 Agent 与流程，不用于考勤。</p></section>
      ${kpis}
      <div class="figgrid">${figH}${figD}</div>
      <section class="block"><h2 class="block__h">让 Agent 停得最久的权限请求</h2>
        <p class="block__d">把常用的只读命令加入允许列表，可以减少这类阻塞。</p>
        <ul class="review">${topPerms.map((p) => { const s = D.sessions[p.sid]; return `<li><a class="review__i" href="#session.${p.sid}" data-go="session.${p.sid}"><span class="review__t"><span class="mono">${esc(p.cmd)}</span><span class="muted"> · ${esc(M[s.member].name)} · ${esc(s.title)} · ${md(s.date)} ${hmOf(p.at)}</span></span><span class="review__r"><span class="tag tag--warn">${V.fmtMin(p.min)}</span></span>${icon('arrow')}</a></li>`; }).join('')}</ul></section>
      ${guard('；等待时长不折算为工时')}`;
  });

  /* ================= 活动记录 ================= */
  S.act = S.act || { date: '2026-09-23', types: { prompt: true, reply: true, wait: true, session: true, data: true } };
  onAct('act-day', (el) => set({ act: Object.assign({}, S.act, { date: el.dataset.v }) }));
  onAct('act-type', (el) => { const t = Object.assign({}, S.act.types); t[el.dataset.v] = !t[el.dataset.v]; set({ act: Object.assign({}, S.act, { types: t }) }); });
  const TYPE = {
    start: ['session', 'play', '开始会话'], end: ['session', 'check', '结束会话'], prompt: ['prompt', 'person', '提问'], reply: ['reply', 'bot', 'Agent 回复'],
    wait: ['wait', 'clock', 'Agent 等待回复'], perm: ['wait', 'shield', '权限请求等待'], compact: ['data', 'compress', '上下文压缩'], gap: ['data', 'alert', '采集缺口'],
    backfill: ['data', 'refresh', '补传'], offline: ['data', 'offline', '设备离线']
  };
  register('activity', () => {
    const date = S.act.date;
    const f = S.rf;
    const evs = X.activity.filter((e) => e.date === date && (f.member === 'all' || e.member === f.member) && (f.agent === 'all' || e.agent === f.agent) && (f.project === 'all' || e.project === f.project) && S.act.types[TYPE[e.type][0]]);
    const weekDays = S.act.date >= '2026-09-21' ? D.week.days : ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
    const strip = `<div class="dstrip" role="group" aria-label="选择日期">${weekDays.map((d) => {
      const n = X.activity.filter((e) => e.date === d && e.type === 'prompt').length + X.activity.filter((e) => e.date === d && e.type === 'start').length;
      const fut = d > D.now.date;
      const cls = ['dstrip__d', d === date ? 'is-sel' : '', d === D.now.date ? 'is-today' : '', fut ? 'is-future' : '', n ? 'has-rep' : ''].join(' ');
      return fut ? `<span class="${cls}" aria-disabled="true"><span class="dstrip__w">${WD[weekday(d)]}</span><span class="dstrip__n num">${Number(d.slice(8))}</span><span class="dstrip__s">&nbsp;</span></span>`
        : `<button type="button" class="${cls}" data-act="act-day" data-v="${d}" data-k="ad-${d}" aria-pressed="${d === date}"><span class="dstrip__w">${WD[weekday(d)]}</span><span class="dstrip__n num">${Number(d.slice(8))}</span><span class="dstrip__s">${n ? `${n} 条提问` : '无'}</span></button>`;
    }).join('')}</div>`;
    const weekSeg = `<div class="seg" role="group" aria-label="选择周"><button type="button" class="seg__b ${date < '2026-09-21' ? 'is-on' : ''}" data-act="act-day" data-v="2026-09-18">W38</button><button type="button" class="seg__b ${date >= '2026-09-21' ? 'is-on' : ''}" data-act="act-day" data-v="2026-09-23">W39</button></div>`;
    const typeChips = `<div class="chips" role="group" aria-label="事件类型">${[['prompt', '提问'], ['reply', 'Agent 回复'], ['wait', '等待与权限'], ['session', '会话起止'], ['data', '数据事件']].map(([k, l]) => `<button type="button" class="fchip ${S.act.types[k] ? 'is-on' : ''}" aria-pressed="${!!S.act.types[k]}" data-act="act-type" data-v="${k}" data-k="at-${k}">${S.act.types[k] ? icon('check') : ''}${l}</button>`).join('')}</div>`;
    // lanes
    const lanesRows = memberScope().map((m) => {
      const ses = Object.entries(D.sessions).filter(([, s]) => s.member === m.id && s.date === date && (f.agent === 'all' || s.agent === f.agent) && (f.project === 'all' || s.project === f.project));
      return {
        label: m.name,
        spans: ses.map(([sid, s]) => ({ a: X.toMin(s.start), b: /\d/.test(s.end) ? X.toMin(s.end) : X.toMin(D.now.time), s: AG[s.agent], go: `session.${sid}`, tt: [`${s.start}–${s.end}`, `${s.title} · ${s.agent}`] })),
        waits: ses.flatMap(([sid]) => X.metrics[sid].waits.filter((w) => w.min >= 10).map((w) => ({ a: w.at, b: w.at + w.min, tt: [`等待 ${V.fmtMin(w.min)}`, D.sessions[sid].title] }))),
        dots: ses.flatMap(([sid, s]) => X.metrics[sid].prompts.map((p) => ({ t: p.at, kind: p.rework ? 'rework' : '', go: `session.${sid}.m${p.n}`, tt: [`${hmOf(p.at)} · ${p.rework ? '返工提问' : '提问'}`, p.text.length > 36 ? `${p.text.slice(0, 36)}…` : p.text, s.title] })))
      };
    });
    const figL = V.figure({
      id: 'act-lanes', title: '当天的对话节奏', sub: '条形为会话（按 Agent 着色），圆点为提问，空心为返工提问，浅灰段为 10 分钟以上的等待；竖线为现在',
      chart: V.lanes(lanesRows, { from: 7, to: 22, now: date === D.now.date ? X.toMin(D.now.time) : null, label: `${dayLabel(date)} 对话节奏` }),
      legend: V.legend([['1', 'Claude Code CLI'], ['2', 'Codex CLI'], ['3', 'Codex Desktop'], ['dot', '提问', 'dot'], ['rework', '返工提问', 'ring'], ['wait', '长等待']]),
      table: V.table(['员工', '会话', '提问', '首次提问', '最后活动'], lanesRows.map((r) => [esc(r.label), r.spans.length, r.dots.length, r.dots.length ? hmOf(Math.min(...r.dots.map((d) => d.t))) : '—', r.spans.length ? hmOf(Math.max(...r.spans.map((s) => s.b))) : '—']), { right: [1, 2] })
    });
    // feed grouped by hour
    const groups = {};
    evs.forEach((e) => { const h = Math.floor(e.at / 60); (groups[h] = groups[h] || []).push(e); });
    const line = (e) => {
      const [, ico, label] = TYPE[e.type];
      const s = D.sessions[e.sid];
      const target = e.n ? `session.${e.sid}.m${e.n}` : `session.${e.sid}`;
      const what = e.type === 'wait' ? `Agent 等待回复 ${V.fmtMin(e.min)}${e.parallel ? ' · 期间在其他会话中活动' : ''}` : e.type === 'perm' ? `权限请求等待 ${V.fmtMin(e.min)}` : label;
      const quote = ['prompt', 'reply', 'start'].includes(e.type) ? `<p class="feed__q">“${esc(e.text.length > 90 ? e.text.slice(0, 90) + '…' : e.text)}”</p>` : e.text ? `<p class="feed__x ${e.type === 'perm' ? 'mono' : ''}">${esc(e.text)}</p>` : '';
      return `<li class="feed__i feed__i--${e.type}">
        <span class="feed__t num">${hmOf(e.at)}</span>
        <span class="feed__ico" aria-hidden="true">${icon(ico)}</span>
        <div class="feed__b">
          <p class="feed__h"><b>${esc(M[e.member].name)}</b> ${what}${e.rework ? '<span class="tag tag--warn">返工</span>' : ''}${e.clarify ? '<span class="tag tag--info">追问</span>' : ''}${e.unverified ? '<span class="tag tag--warn">未验证</span>' : ''}
            <a class="feed__s" href="#${target}" data-go="${target}">${esc(s.title)} · <span class="mono">${e.sid}</span></a></p>
          ${quote}
        </div></li>`;
    };
    const feed = Object.keys(groups).length ? Object.entries(groups).sort((p, q) => Number(p[0]) - Number(q[0])).map(([h, list]) => `<section class="feed__g"><h3 class="feed__gh">${String(h).padStart(2, '0')}:00</h3><ol class="feed">${list.map(line).join('')}</ol></section>`).join('') : U.empty('none', '这一天没有匹配的活动', '换一天，或打开更多事件类型。');
    return `${pageHead({ title: '活动记录', sub: '按时间记录每次对话：谁、在哪个会话、什么时候说了什么。点击条目跳到对话中的原句。' })}
      <div class="ctrl">${weekSeg}${strip}</div>
      ${filterBar()}
      ${figL}
      <section class="block"><div class="feedhead"><h2 class="block__h">${dayLabel(date)} · ${evs.length} 条记录</h2>${typeChips}</div>${feed}</section>`;
  });

  /* ================= 数据处理（拾取 · 去重 · 组装 · 指标） ================= */
  const CATALOG = [
    ['会话', '有事件的会话（含子会话），按来源时间归期', '原件 · 确定性', '续聊合并为同一会话；子会话关联，不重复计算'],
    ['提示词（用户轮次）', '用户提交的消息，不含工具结果与压缩摘要', '原件 · 确定性', '压缩后的摘要消息标记为派生内容'],
    ['工具调用', 'Agent 发起的工具调用次数', '原件 · 确定性', '在对话视图中默认隐藏'],
    ['Token 输入/输出', '客户端记录的用量', '原件 · 确定性', '未上报的会话标为未知，不计为 0'],
    ['代码变更行', '会话内 Edit / Write / apply_patch 的增删行', '原件 · 确定性', '不关联外部提交或 PR'],
    ['测试通过', '工具结果中解析出的测试运行与通过', '原件 · 解析', '只认工具输出，不认 Agent 陈述'],
    ['已验证结果', '报告中有工具结果佐证的结果条目', '模型提取 + 证据核对', '可点击跳到原件位置'],
    ['仅声称', '只有用户或 Agent 陈述、没有工具结果的结果条目', '模型提取', '单独列出，不计入已验证'],
    ['产效比', '已验证结果 ÷ 百万 Token（已知）', '派生', '只在同类任务之间参考；不合成总分'],
    ['任务类型', '实现 / 修复 / 排查 / 重构 / 测试 / 运维 / 整理', '模型推断', '可在日报中更正'],
    ['提示词要素', '目标、约束、上下文、验收标准是否出现', '模型推断', '用于辅导写法'],
    ['返工率', '纠正或推翻上一轮结果的提示词占比（不含首条）', '模型推断 + 规则', '—'],
    ['等待回复', 'Agent 结束本轮到用户下一次输入的间隔', '原件时间戳 · 确定性', '不含会话结束后的空闲；不折算工时'],
    ['权限等待', 'Agent 发起命令确认到用户批准的间隔', '原件时间戳 · 确定性', '这段时间 Agent 被阻塞'],
    ['期间在别处工作', '等待期间同一员工在其他会话中有活动', '原件时间戳 · 确定性', '用于解释长等待']
  ];
  register('pipeline', () => {
    const P = X.pipeline;
    const special = ['s-2c90', 's-7f3a', 's-x118', 's-x120', 's-c530', 's-h230'];
    const recent = Object.entries(D.sessions).filter(([sid, s]) => s.date >= '2026-09-23' && !special.includes(sid)).slice(0, 6).map(([sid]) => sid);
    const rows = [...special, ...recent];
    const cov = ['Claude Code CLI', 'Codex CLI', 'Codex Desktop'].map((ag) => { const all = Object.entries(D.sessions).filter(([, s]) => s.agent === ag); const k = all.filter(([sid]) => X.metrics[sid].known).length; return { ag, n: all.length, k }; });
    return `${pageHead({ title: '数据处理', sub: '自动拾取各设备上的会话原件，去重后组装为完整会话，再计算指标、生成报告。员工不需要任何操作。' })}
      <section class="block"><h2 class="block__h">处理链路 · 今日</h2>
        <ol class="flow">${P.stages.map((st, i) => `<li class="flow__s"><p class="flow__v">${V.num(st.v)}</p><p class="flow__k">${esc(st.k)}</p><p class="flow__d">${esc(st.d)}</p></li>${i < P.stages.length - 1 ? `<li class="flow__a" aria-hidden="true">${icon('arrow')}</li>` : ''}`).join('')}</ol>
        <p class="side__n">原文可见延迟 P95 ${P.lag.p95}（${esc(P.lag.note)}）。示例数值。</p></section>
      <section class="block"><h2 class="block__h">去重与组装规则</h2>
        <ul class="rules">
          <li>${icon('layers')}<span><b>分块幂等</b>：按（来源, 偏移, 哈希）识别网络重试与重复投递；同键同内容丢弃，同键不同内容报冲突。</span></li>
          <li>${icon('branch')}<span><b>续聊合并</b>：续聊文件里复制的历史消息按原始 UUID 合并，只保留一份，并保留原始日期。</span></li>
          <li>${icon('compress')}<span><b>压缩代次</b>：压缩前的原件保留为旧代次；压缩摘要标记为派生内容，不重复计入。</span></li>
          <li>${icon('session')}<span><b>子会话</b>：按父事件关联为侧链，活动不重复计算。</span></li>
          <li>${icon('refresh')}<span><b>离线补传</b>：按事件序号与已收到的部分拼接，按来源时间归期并触发受影响报告重算。</span></li>
          <li>${icon('shield')}<span><b>无法确定谱系时</b>：跨设备复制等情况保持分离并提示确认，不默默合并。</span></li>
        </ul>
        ${P.pending.map((p) => notice('warn', 'branch', `${esc(p.text)} <a class="linkbtn" href="#session.${p.sid}" data-go="session.${p.sid}">查看会话</a>`)).join('')}
      </section>
      <section class="block"><h2 class="block__h">会话组装记录</h2>
        <div class="tblwrap"><table class="tbl tbl--asm">
          <thead><tr><th scope="col">完成时间</th><th scope="col">会话</th><th scope="col">员工</th><th scope="col">来源</th><th scope="col" class="r">分块</th><th scope="col" class="r">去重</th><th scope="col">结果</th><th scope="col">说明</th></tr></thead>
          <tbody>${rows.map((sid) => { const x = D.assembly[sid], s = D.sessions[sid]; return `<tr>
            <td class="nowrap num">${esc(x.at)}</td>
            <td><a class="tbl__link" href="#session.${sid}" data-go="session.${sid}"><span class="mono">${sid}</span>${esc(s.title)}</a></td>
            <td class="nowrap">${who(s.member)}</td>
            <td class="nowrap">${x.sources.length} 个</td>
            <td class="num r">${x.chunks}</td>
            <td class="num r">${x.dupEvents ? `${x.dupEvents} 条事件` : '0'}</td>
            <td class="nowrap">${pill(/缺口|中/.test(x.state) ? 'warn' : 'ok', esc(x.state), /缺口|中/.test(x.state) ? 'alert' : 'check')}</td>
            <td class="asm__op">${esc(x.ops[0])}</td></tr>`; }).join('')}</tbody></table></div></section>
      <section class="block"><h2 class="block__h">数据质量</h2>
        ${V.figure({ id: 'dq-cov', title: 'Token 用量上报覆盖', sub: '按 Agent 统计能取得用量的会话比例',
          chart: V.hbars(cov.map((c) => ({ label: esc(c.ag), segs: [{ s: AG[c.ag], v: c.n ? c.k / c.n : 0, tt: [V.pct(c.n ? c.k / c.n : 0), `${c.k}/${c.n} 个会话已上报用量`] }], value: `${c.k}/${c.n}` })), { max: 1, fmt: (v) => V.pct(v) }),
          table: V.table(['Agent', '会话', '已上报用量', '覆盖率'], cov.map((c) => [esc(c.ag), c.n, c.k, V.pct(c.n ? c.k / c.n : 0)]), { right: [1, 2, 3] }),
          note: 'Codex Desktop 当前试点版本未在会话记录中暴露用量，相关报表显示“未知”。' })}
      </section>
      <section class="block"><h2 class="block__h">指标口径</h2>
        <div class="tblwrap"><table class="tbl tbl--cat"><thead><tr><th scope="col">指标</th><th scope="col">定义</th><th scope="col">来源与证据级别</th><th scope="col">注意</th></tr></thead>
        <tbody>${CATALOG.map(([k, d, src, n]) => `<tr><th scope="row" class="nowrap">${k}</th><td>${d}</td><td class="nowrap">${/推断|提取/.test(src) ? pill('neutral', src, 'infer') : pill('ok', src, 'obs')}</td><td class="muted">${n}</td></tr>`).join('')}</tbody></table></div></section>`;
  });

  /* ================= 会话：对话视图与数据面板（供 pages.js 使用） ================= */
  S.showTools = S.showTools || false;
  onAct('tools-toggle', () => set({ showTools: !S.showTools }));
  const DIV = { old: 'branch', day: 'overview', backfill: 'refresh', compact: 'compress', gap: 'alert', live: 'live' };
  const chat = (sid, anchor) => {
    const s = D.sessions[sid];
    const tl = D.timeline[sid];
    const items = X.conv[sid] || [];
    let pendingTools = 0, out = '';
    items.forEach((it) => {
      if (it.type === 'divider') { out += `<li class="cv__div cv__div--${it.kind}">${icon(DIV[it.kind] || 'info')}<span>${esc(it.text)}</span></li>`; return; }
      if (it.type === 'tools') {
        if (!S.showTools) { pendingTools += it.count; return; }
        const detail = tl ? tl.events.filter((e) => e.n && e.n >= it.from && e.n <= it.to && ['tool', 'edit', 'sub'].includes(e.kind)) : [];
        out += `<li class="cv__tools"><p class="cv__toolsh">${icon('terminal')}${it.count} 次工具调用 · #${it.from}–#${it.to}</p>${detail.length ? `<ul>${detail.map((e) => `<li><span class="mono">${e.kind === 'edit' ? `Edit ${esc(e.file)}` : e.kind === 'sub' ? `Task ${esc(e.title)}` : `${esc(e.tool)} · ${esc(e.cmd)}`}</span><a class="linkbtn" href="#session.${sid}.e${e.n}" data-go="session.${sid}.e${e.n}">#${e.n}</a></li>`).join('')}</ul>` : '<p class="muted">原型示例：此段只提供数量，明细见“原件”。</p>'}</li>`;
        return;
      }
      if (it.type === 'wait') { out += `<li class="cv__wait ${it.min >= 10 ? 'is-long' : ''}"><span>${icon('clock')}等待回复 ${V.fmtMin(it.min)}${it.parallel ? ' · 期间在其他会话中活动' : ''}</span></li>`; return; }
      if (it.type !== 'msg') return;
      const isUser = it.role === 'user';
      const cited = anchor === it.n;
      const meta = [`<span class="num">${esc(it.old ? `${Number(it.date.slice(5, 7))}/${Number(it.date.slice(8))} ` : '')}${esc(it.t.slice(0, 5))}</span>`];
      if (it.n) meta.push(`#${it.n}`);
      if (!isUser && pendingTools) { meta.push(`${pendingTools} 次工具调用（已隐藏）`); pendingTools = 0; }
      const flags = [
        isUser && it.f && it.f.rework ? '<span class="tag tag--warn">返工</span>' : '',
        !isUser && it.clarify ? '<span class="tag tag--info">追问</span>' : '',
        !isUser && it.unverified ? `<span class="tag tag--warn">${icon('quote')}Agent 自述 · 无工具结果佐证</span>` : '',
        it.old ? '<span class="tag">接入前</span>' : ''
      ].join('');
      out += `<li class="cv__m cv__m--${isUser ? 'user' : 'agent'} ${it.old ? 'is-old' : ''} ${cited ? 'is-cited' : ''}" ${it.n ? `id="m-${it.n}"` : ''}>
        ${isUser ? '' : `<span class="cv__av" aria-hidden="true">${icon('bot')}</span>`}
        <div class="cv__col">
          <div class="cv__bub"><span class="sr-only">${isUser ? esc(M[s.member].name) : 'Agent'}：</span>${esc(it.text)}</div>
          <p class="cv__meta">${isUser ? esc(M[s.member].name) : 'Agent'} · ${meta.join(' · ')}${flags}</p>
        </div>
        ${isUser ? `<span class="cv__av cv__av--user" aria-hidden="true">${avatar(M[s.member], 'sm')}</span>` : ''}
      </li>`;
    });
    if (pendingTools && !S.showTools) out += `<li class="cv__wait"><span>${icon('terminal')}Agent 进行中 · ${pendingTools} 次工具调用（已隐藏）</span></li>`;
    return `<ol class="cv" aria-label="对话">${out}</ol>`;
  };
  const sessionData = (sid) => {
    const m = X.metrics[sid];
    const s = D.sessions[sid];
    const { segs, start, end } = sessionSegments(sid);
    return `<section class="side__s"><h2 class="side__h">会话数据</h2>
        <dl class="kv">
          <div><dt>任务类型</dt><dd>${m.kind}<span class="ev ev--infer">${icon('infer')}<span class="ev__k">推断</span></span></dd></div>
          <div><dt>Token</dt><dd class="num">${m.known ? `${V.fmtTok(m.tin)} / ${V.fmtTok(m.tout)}` : '<span class="unk">未知</span>'}</dd></div>
          <div><dt>提示词</dt><dd class="num">${m.turns} 轮 · 返工 ${m.rework}</dd></div>
          <div><dt>工具调用</dt><dd class="num">${m.tools}</dd></div>
          <div><dt>代码变更</dt><dd class="num">+${m.add} / −${m.del} · ${m.files} 个文件</dd></div>
          <div><dt>测试</dt><dd class="num">${m.testsPass}/${m.testsRun} 通过</dd></div>
          <div><dt>已验证</dt><dd class="num">${m.verified}${m.claimed ? ` · 另 ${m.claimed} 条仅声称` : ''}</dd></div>
          <div><dt>产效比</dt><dd class="num">${X.ratio(m) != null ? `${X.ratio(m).toFixed(1)} / 百万 Token` : '—'}</dd></div>
          <div><dt>等待回复</dt><dd class="num">中位 ${V.fmtMin(X.median(m.waits.map((w) => w.min)))} · 共 ${V.fmtMin(m.waitMin)}</dd></div>
        </dl>
        <p class="side__h side__h--sub">Agent 工作与等待</p>
        ${V.workWait(segs, start, end, { label: 'Agent 工作与等待' })}
        ${V.legend([['work', '工作'], ['wait', '等待回复'], ['perm', '权限等待'], ...(sid === 's-h230' ? [['gap', '缺口']] : [])])}
      </section>`;
  };
  const assemblyPanel = (sid) => {
    const x = D.assembly[sid];
    return `<section class="side__s"><h2 class="side__h">组装与去重</h2>
      <p class="asmstate">${pill(/缺口|中/.test(x.state) ? 'warn' : 'ok', esc(x.state), /缺口|中/.test(x.state) ? 'alert' : 'check')}<span class="muted num">${esc(x.at)}</span></p>
      <ul class="asmsrc">${x.sources.map((src) => `<li><span class="asmsrc__k">${esc(src.kind)}</span><span class="mono">${esc(src.label)}</span><span class="muted">${esc(src.detail)}</span></li>`).join('')}</ul>
      <p class="asmnum num">${x.chunks} 个分块 · 去重 ${x.dupEvents} 条重复事件${x.copied ? `（含续聊复制 ${x.copied} 条）` : ''}${x.derived ? ` · ${x.derived} 条派生摘要不计入` : ''}</p>
      <ul class="asmops">${x.ops.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></section>`;
  };

  /* ================= 团队概览（C）增强：KPI 与人员汇总 ================= */
  const overviewKpis = () => {
    const f = { range: 'W39', member: 'all', agent: 'all', project: 'all' };
    const list = X.sessionsIn(f);
    const a = X.agg(list);
    const days = X.daysOf('W39');
    const perDay = days.map((d) => X.agg(list.filter(([, s]) => s.date === d)));
    const labels = days.map(dayLabel);
    const active = new Set(list.map(([, s]) => s.member)).size;
    return `<div class="stats-row stats-row--ov">
      ${V.stat({ label: '本周活跃员工', value: `${active}<span class="stat__of">/${MEMBERS.length}</span>`, sub: '1 个客户端待信任 · 今日 1 台离线' })}
      ${V.stat({ label: 'Token 输入（已知）', value: V.fmtTok(a.tin), sub: `<span class="unk">${a.unknown} 个会话未上报</span>`, trend: V.spark(perDay.map((x) => (x.known ? x.tin : null)), labels, { fmt: V.fmtTok, label: '每日 Token' }) })}
      ${V.stat({ label: '已验证结果', value: a.verified, sub: `另 ${a.claimed} 条仅声称`, trend: V.spark(perDay.map((x) => x.verified), labels, { label: '每日已验证结果' }) })}
      ${V.stat({ label: '代码变更', value: `+${V.num(a.add)}`, sub: `−${V.num(a.del)} 行`, trend: V.spark(perDay.map((x) => x.add + x.del), labels, { label: '每日代码变更行' }) })}
      ${V.stat({ label: 'Agent 等待回复', value: V.fmtMin(a.waitMed), sub: `中位数 · 权限等待 ${V.fmtMin(a.permMed)}` })}
    </div>`;
  };
  const overviewPeople = () => {
    const list = X.sessionsIn({ range: 'W39', member: 'all', agent: 'all', project: 'all' });
    const perP = MEMBERS.map((m) => ({ m, a: X.agg(list.filter(([, s]) => s.member === m.id)) }));
    const mx = (fn) => Math.max(1, ...perP.map((x) => fn(x.a)));
    return `<section class="block"><div class="feedhead"><h2 class="block__h">本周人员汇总</h2><a class="linkbtn" href="#usage" data-go="usage">打开完整报表</a></div>
      <div class="tblwrap"><table class="tbl tbl--bars">
        <thead><tr><th scope="col">员工</th><th scope="col">会话</th><th scope="col">Token 输入（已知）</th><th scope="col">已验证结果</th><th scope="col">代码变更行</th><th scope="col">提示词 · 返工率</th><th scope="col">等待中位</th><th scope="col">覆盖</th><th scope="col">使用能力（接入至今）</th></tr></thead>
        <tbody>${perP.map(({ m, a: x }) => `<tr>
          <th scope="row" class="nowrap"><a href="#member.${m.id}.week.W39" data-go="member.${m.id}.week.W39">${who(m.id)}</a></th>
          <td class="num">${x.sessions}</td>
          <td>${V.barCell(x.tin, mx((q) => q.tin), `${V.fmtTok(x.tin)}${x.unknown ? ' <span class="unk">+' + x.unknown + ' 未知</span>' : ''}`)}</td>
          <td>${V.barCell(x.verified, mx((q) => q.verified), String(x.verified))}</td>
          <td>${V.barCell(x.add + x.del, mx((q) => q.add + q.del), V.num(x.add + x.del))}</td>
          <td class="num nowrap">${x.promptN} · ${V.pct(x.reworkRate)}</td>
          <td class="num nowrap">${V.fmtMin(x.waitMed)}</td>
          <td class="nowrap">${m.devices.some((d) => d.clients.some((c) => c.issue === 'trust')) ? pill('warn', '待信任', 'shield') : m.devices.some((d) => d.offline) ? pill('neutral', '今日离线', 'offline') : m.devices.some((d) => d.clients.some((c) => c.issue === 'gap')) ? pill('crit', '有缺口', 'alert') : pill('ok', '完整', 'check')}</td>
          <td class="nowrap">${(() => { const pr = X.prof(m.id, 'all'); const tone = { 较好: 'ok', 一般: 'info', 需提升: 'warn', 待定: 'neutral' }[pr.level]; return `<a class="lvlink" href="#member.${m.id}" data-go="member.${m.id}">${pill(tone, pr.level, { 较好: 'check', 一般: 'info', 需提升: 'alert', 待定: 'clock' }[pr.level])}${pr.index != null && pr.level !== '待定' ? `<span class="num">${Math.round(pr.index)}</span>` : ''}</a>`; })()}</td></tr>`).join('')}</tbody></table></div>
      <p class="side__n">按姓名排列；“使用能力”按固定锚点评估、样本不足不评级，点击进入员工画像查看依据。Token 未上报的会话单独标注。</p></section>`;
  };
  const memberProfile = (mid) => {
    const list = X.sessionsIn({ range: 'W39', member: mid, agent: 'all', project: 'all' });
    const a = X.agg(list);
    const days = X.daysOf('W39');
    const vals = days.map((d) => { const x = X.agg(list.filter(([, s]) => s.date === d)); return { v: x.tin, unknown: x.unknown > 0, label: dayLabel(d), tt: x.sessions ? V.fmtTok(x.tin) : '无会话', short: WD[weekday(d)].slice(1) }; });
    return `<section class="block"><div class="feedhead"><h2 class="block__h">使用画像 · 本周</h2><button type="button" class="linkbtn" data-act="rf-go" data-m="${mid}" data-r="W39" data-to="usage">在报表中查看</button></div>
      <div class="stats-row stats-row--sm">
        ${V.stat({ label: 'Token 输入（已知）', value: V.fmtTok(a.tin), sub: a.unknown ? `<span class="unk">+${a.unknown} 个会话未知</span>` : '全部已上报' })}
        ${V.stat({ label: '已验证结果', value: a.verified, sub: `另 ${a.claimed} 条仅声称` })}
        ${V.stat({ label: '提示词', value: a.promptN, sub: `返工率 ${V.pct(a.reworkRate)} · 上下文 ${V.pct(a.ctxRate)}` })}
        ${V.stat({ label: '等待回复', value: V.fmtMin(a.waitMed), sub: `中位数 · 权限等待 ${V.fmtMin(a.permMed)}` })}
      </div>
      <div class="mult mult--wide"><p class="mult__h">每日 Token 输入（已知）</p>${V.columns(vals, { w: 360, h: 72, label: '本周每日 Token' })}</div></section>`;
  };

  window.SkyReports = { chat, sessionData, assemblyPanel, overviewKpis, overviewPeople, memberProfile, sessionSegments };
})();
