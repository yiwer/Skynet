/* PROTOTYPE — 员工一览与员工画像（垂直切分）：每位员工的 Coding Agent 使用能力评估、使用数据、工作内容、协作方式、会话、活动与趋势。
 * 评估口径：绝对锚点（不与同事比较）、任务类型校正、单项样本 < 3 不计分、会话/提示词不足或覆盖不完整时不评级（待定）。
 * 数据为合成示例；评估结论需人工复核，用于辅导与经验分享，不直接作为绩效结论。
 */
(() => {
  'use strict';
  const U = window.SkyUI, V = window.SkyViz, X = window.SkyData;
  const { D, S, M, esc, icon, md, dayLabel, weekday, WD, avatar, projChip, pill, pageHead, notice, set, go, onAct, empty } = U;
  S.pf = S.pf || { range: 'all', preset: '默认' };
  S.pnotes = S.pnotes || {};
  const LV = { 较好: ['ok', 'check', '用 Agent 工作的方式成熟，可以作为团队参考'], 一般: ['info', 'info', '基本用得起来，个别维度有提升空间'], 需提升: ['warn', 'alert', '建议针对短板安排辅导'], 待定: ['neutral', 'clock', '样本不足或采集覆盖不完整，暂不评级'] };
  const levelPill = (p, prefix = '') => { const [tone, ico] = LV[p.level]; return pill(tone, `${prefix}${p.level}`, ico); };
  const fmtV = (v, f) => (v == null ? '—' : f === 'pct' ? V.pct(v) : f === 'min' ? V.fmtMin(v) : f === 'x' ? `${v.toFixed(2)}×` : v.toFixed(1));
  const r0 = (v) => (v == null ? '—' : String(Math.round(v)));

  /* ---------- controls ---------- */
  onAct('pf', (el) => set({ pf: Object.assign({}, S.pf, { [el.dataset.f]: el.dataset.v }) }));
  const controls = () => `
    <div class="seg" role="group" aria-label="评估范围">${[['all', '接入至今'], ['W39', '本周 W39'], ['W38', '上周 W38']].map(([k, l]) => `<button type="button" class="seg__b ${S.pf.range === k ? 'is-on' : ''}" aria-pressed="${S.pf.range === k}" data-act="pf" data-f="range" data-v="${k}" data-k="pf-r-${k}">${l}</button>`).join('')}</div>
    <div class="seg" role="group" aria-label="权重方案">${Object.keys(X.PRESETS).map((k) => `<button type="button" class="seg__b ${S.pf.preset === k ? 'is-on' : ''}" aria-pressed="${S.pf.preset === k}" data-act="pf" data-f="preset" data-v="${k}" data-k="pf-p-${k}">${k}</button>`).join('')}</div>`;

  const summary = (p) => {
    const n = `（依据 ${p.sample.sessions} 个会话、${p.sample.prompts} 条提示词）`;
    if (p.level === '待定') return `样本不足${p.trust ? '，且 Codex Desktop 待信任、采集覆盖不完整' : ''}，暂不给出等级；下方各维度只作参考${n}。`;
    const s = p.strengths.map((d) => d.name).join('、');
    const g = p.gaps.map((d) => d.name).join('、');
    const lows = X.DIMS.filter((d) => p.dims[d.k].score != null && Math.round(p.dims[d.k].score) < 60).length;
    const gt = !g ? '各维度都在 60 分以上' : lows > p.gaps.length ? `有 ${lows} 个维度低于 60 分，最需要提升的是${g}` : `${g}低于 60 分，是主要的提升方向`;
    return `${s ? `强项是${s}` : '没有明显突出的维度'}；${gt}${n}。`;
  };
  const method = () => {
    const W = X.PRESETS[S.pf.preset];
    return `<details class="method"><summary>${icon('info')}评估方法与口径</summary>
      <div class="method__b">
        <p>评估的是<b>用 Coding Agent 完成工作的方式与效果</b>，只基于已采集的会话。它不代表员工的整体绩效，也不覆盖会议、评审以及不借助 Agent 的工作。</p>
        <div class="tblwrap"><table class="tbl tbl--compact">
          <thead><tr><th scope="col">维度（当前权重）</th><th scope="col">回答的问题</th><th scope="col">指标</th><th scope="col">0 分 → 100 分</th></tr></thead>
          <tbody>${X.DIMS.map((d) => d.metrics.map((mt, i) => `<tr>${i === 0 ? `<th scope="row" rowspan="${d.metrics.length}">${d.name}<span class="muted num"> ${W[d.k]}%</span></th><td rowspan="${d.metrics.length}">${d.q}</td>` : ''}<td>${mt.name}<span class="method__note">${esc(mt.note)}</span></td><td class="num nowrap">${fmtV(mt.a, mt.fmt)} → ${fmtV(mt.b, mt.fmt)}</td></tr>`).join('')).join('')}</tbody></table></div>
        <ul class="method__l">
          <li><b>绝对标尺</b>：按固定锚点打分，不与同事相互比较；所有人都可能同时“较好”。</li>
          <li><b>综合指数</b>：六个维度按当前方案加权平均；没有数据的维度不参与，权重按比例重算。</li>
          <li><b>等级</b>：72 分及以上为较好，60–71 为一般，60 以下为需提升。</li>
          <li><b>可信度</b>：≥ 8 个会话且 ≥ 40 条提示词为高，≥ 5 个会话且 ≥ 25 条为中，其余为低；可信度低时不评级。客户端待信任时可信度降一级。</li>
          <li><b>公平校正</b>：产出类指标除以团队同类任务的均值或中位数；测试只对实现、修复、重构、测试类会话要求；单项少于 3 个样本不计分。</li>
          <li><b>推断字段</b>：提示词要素、返工、追问、任务类型为模型推断，可以更正，并按新结果重算。</li>
          <li><b>用途</b>：作为辅导与经验分享的参考，结论需要人工复核；员工可以查看自己的画像，也可以补充说明。</li>
        </ul>
      </div></details>`;
  };

  /* ================= 员工一览 ================= */
  const reason = (p) => {
    if (p.level === '待定') return `${p.trust ? '覆盖不完整 · ' : ''}${p.sample.sessions} 个会话，样本不足`;
    if (p.level === '较好') return p.strengths.length ? `强项：${p.strengths.map((d) => d.name).join('、')}` : '各维度均衡';
    return p.gaps.length ? `优先提升：${p.gaps.map((d) => d.name).join('、')}` : '各维度 60 分以上';
  };
  const card = ({ m, p }) => `<li><a class="pcard" href="#member.${m.id}" data-go="member.${m.id}" aria-label="${esc(m.name)}：使用能力${p.level}${p.index != null ? `，综合 ${Math.round(p.index)} 分` : ''}，打开员工画像">
      <div class="pcard__h">${avatar(m)}<div class="pcard__who"><b>${esc(m.name)}</b><span class="muted">${esc(m.role)}</span></div>${levelPill(p)}</div>
      <p class="pcard__idx">${p.index != null ? `<b>${Math.round(p.index)}</b><span class="muted">综合 · ±${p.margin} · 可信度${p.confLabel}</span>` : '<span class="muted">这个范围内没有会话</span>'}</p>
      <ul class="pcard__dims">${X.DIMS.map((d) => { const sc = p.dims[d.k].score; return `<li><span class="pcard__dn">${d.name}</span><span class="pbar"><i style="--w:${sc == null ? 0 : sc.toFixed(0)}%"></i></span><span class="num">${r0(sc)}</span></li>`; }).join('')}</ul>
      <p class="pcard__k num">${p.sample.sessions} 会话 · ${p.sample.prompts} 提示词 · 已验证 ${p.agg.verified} · 返工率 ${V.pct(p.agg.reworkRate)}</p>
      ${p.trust ? `<p class="pcard__w">${icon('shield')}Codex Desktop 待信任，覆盖不完整</p>` : ''}
    </a></li>`;
  const index = () => {
    const { range, preset } = S.pf;
    const ps = D.members.map((m) => ({ m, p: X.prof(m.id, range, preset) }));
    return `${pageHead({ title: '员工', sub: `每位员工使用 Coding Agent 的情况与能力评估 · ${X.RANGES[range].label} · 权重方案：${preset}。点开员工查看完整画像。` })}
      <div class="ctrl">${controls()}</div>
      <section class="verdict" aria-label="评估结论">${Object.entries(LV).map(([lv, [tone, ico, desc]]) => {
        const list = ps.filter((x) => x.p.level === lv);
        return `<div class="verdict__g">
          <p class="verdict__h">${pill(tone, lv, ico)}<span class="num">${list.length} 人</span></p>
          <p class="verdict__d">${desc}</p>
          <ul class="verdict__l">${list.length ? list.map((x) => `<li><a href="#member.${x.m.id}" data-go="member.${x.m.id}">${avatar(x.m, 'sm')}<b>${esc(x.m.name)}</b>${x.p.index != null ? `<span class="num">${Math.round(x.p.index)}</span>` : ''}</a><span class="muted">${esc(reason(x.p))}</span></li>`).join('') : '<li class="muted">无</li>'}</ul>
        </div>`;
      }).join('')}</section>
      <p class="guard">${icon('info')}<span>评估只看已采集的 Agent 会话，采用固定锚点（不与同事比较）并按任务类型校正；样本不足或覆盖不完整时不评级。结论用于辅导参考，需要人工复核。</span></p>
      <h2 class="block__h">每位员工</h2>
      <ul class="pgrid">${ps.map(card).join('')}</ul>
      ${method()}`;
  };

  /* ================= 员工画像 ================= */
  onAct('p-jump', (el) => { const t = document.getElementById(el.dataset.v); if (t) t.scrollIntoView({ block: 'start' }); });
  onAct('p-note', (form) => {
    const ta = form.querySelector('textarea');
    const text = (ta.value || '').trim();
    if (!text) { ta.setAttribute('aria-invalid', 'true'); form.querySelector('.help').textContent = '备注为空：写下需要补充的事实，例如“本周主要在做方案评审，Agent 使用少是正常的”。'; ta.focus(); return; }
    (S.pnotes[form.dataset.mid] = S.pnotes[form.dataset.mid] || []).unshift({ by: D.viewer.name, at: `${md(D.now.date)} ${D.now.time}`, text });
    set({});
  });
  onAct('p-activity', (el) => { S.rf = Object.assign({}, S.rf, { member: el.dataset.m }); S.act = Object.assign({}, S.act || {}, { date: el.dataset.d }); go('activity'); });

  const dimRows = (p, med) => X.DIMS.map((d) => {
    const dim = p.dims[d.k];
    const sc = dim.score == null ? null : Math.round(dim.score);
    const gap = sc != null && sc < 60;
    return `<details class="pdim" ${gap ? 'open' : ''}>
      <summary class="pdim__s">
        <span class="pdim__n"><b>${d.name}</b><span class="muted">${d.q}</span></span>
        <span class="pbar pbar--lg" role="img" aria-label="${d.name} ${r0(sc)} 分，团队中位数 ${r0(med[d.k])}"><i style="--w:${sc == null ? 0 : sc.toFixed(0)}%"></i>${med[d.k] != null ? `<em style="--m:${med[d.k].toFixed(0)}%"></em>` : ''}</span>
        <span class="pdim__v num">${r0(sc)}</span>
        ${sc == null ? '<span class="tag">样本不足</span>' : gap ? '<span class="tag tag--warn">待提升</span>' : sc >= 70 ? '<span class="tag tag--ok">强项</span>' : '<span class="tag">一般</span>'}
      </summary>
      <div class="tblwrap"><table class="tbl tbl--compact">
        <thead><tr><th scope="col">指标</th><th scope="col" class="r">数值</th><th scope="col">0 → 100 分</th><th scope="col" class="r">得分</th></tr></thead>
        <tbody>${dim.metrics.map((mt) => `<tr><td>${mt.name}<span class="method__note">${esc(mt.note)}</span></td><td class="num r">${fmtV(mt.value, mt.fmt)}</td><td class="num nowrap">${fmtV(mt.a, mt.fmt)} → ${fmtV(mt.b, mt.fmt)}</td><td class="num r">${mt.score == null ? '<span class="unk">样本不足</span>' : Math.round(mt.score)}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>`;
  }).join('');

  const dumbbell = (rows) => `<div class="db" role="list">${rows.map((r) => `<div class="db__r" role="listitem">
      <span class="db__l">${r.label}</span>
      <span class="db__t" role="img" aria-label="${r.label}：上周 ${r0(r.a)}，本周 ${r0(r.b)}">
        ${r.a != null && r.b != null ? `<i class="db__line" style="--a:${Math.min(r.a, r.b).toFixed(0)}%;--b:${Math.max(r.a, r.b).toFixed(0)}%"></i>` : ''}
        ${r.a != null ? `<i class="db__a" style="--v:${r.a.toFixed(0)}%" ${V.tt([`上周 ${Math.round(r.a)}`, r.label])} tabindex="0"></i>` : ''}
        ${r.b != null ? `<i class="db__b" style="--v:${r.b.toFixed(0)}%" ${V.tt([`本周 ${Math.round(r.b)}`, r.label])} tabindex="0"></i>` : ''}
      </span>
      <span class="db__d num">${r.a != null && r.b != null ? `${r.b - r.a >= 0 ? '+' : '−'}${Math.abs(Math.round(r.b - r.a))}` : r.b != null ? '新接入' : '—'}</span>
    </div>`).join('')}</div>`;

  const body = (mid) => {
    const { range, preset } = S.pf;
    const p = X.prof(mid, range, preset);
    const m = M[mid];
    const a = p.agg;
    const list = X.sessionsIn({ range, member: mid }).sort((x, y) => (y[1].date + y[1].start).localeCompare(x[1].date + x[1].start));
    if (!list.length) return empty('none', '这个范围内没有会话', `${esc(m.name)} ${md(m.joined)} 接入；接入前未继续使用的旧会话不在存档中。换一个评估范围试试。`);
    const med = X.teamDimMedian(range, preset);
    const days = X.daysOf(range).filter((d) => d >= m.joined);
    const W = X.PRESETS[preset];

    const nav = `<nav class="pnav" aria-label="画像目录">${[['p-verdict', '结论'], ['p-dims', '能力维度'], ['p-usage', '使用数据'], ['p-work', '工作内容'], ['p-collab', '协作方式'], ['p-sessions', '会话'], ['p-activity', '最近活动'], ['p-trend', '趋势'], ['p-notes', '复核备注']].map(([id, l]) => `<button type="button" class="pnav__b" data-act="p-jump" data-v="${id}">${l}</button>`).join('')}</nav>`;

    /* 1 · 结论 */
    const verdict = `<section class="pverdict" id="p-verdict" aria-label="评估结论">
        <div class="pverdict__main">
          <p class="pverdict__k">使用 Coding Agent 的能力 · ${X.RANGES[range].label} · 权重方案：${preset}</p>
          <div class="pverdict__row">${levelPill(p)}<p class="pverdict__idx">${p.index != null ? `<b>${Math.round(p.index)}</b><span>/ 100 · ±${p.margin} · 可信度${p.confLabel}</span>` : '—'}</p></div>
          <p class="pverdict__sum">${esc(summary(p))}</p>
          ${p.trust ? notice('warn', 'shield', 'Codex Desktop 已安装但未完成信任，该客户端的活动没有被采集，评估只基于 Claude Code（WSL）的会话。<a class="linkbtn" href="#devices" data-go="devices">查看诊断</a>') : ''}
        </div>
        <div class="pverdict__side">
          <p class="pverdict__h">强项</p><p class="chips">${p.strengths.length ? p.strengths.map((d) => `<span class="tag tag--ok">${d.name} ${Math.round(d.score)}</span>`).join('') : '<span class="muted">暂无 70 分以上的维度</span>'}</p>
          <p class="pverdict__h">优先提升</p><p class="chips">${p.gaps.length ? p.gaps.map((d) => `<span class="tag tag--warn">${d.name} ${Math.round(d.score)}</span>`).join('') : '<span class="muted">各维度都在 60 分以上</span>'}</p>
          ${p.tips.length ? `<p class="pverdict__h">辅导建议</p><ul class="ptips">${p.tips.map((t) => `<li>${icon('arrow')}<span><b>${t.dim}</b>：${esc(t.text)}</span></li>`).join('')}</ul>` : ''}
        </div>
      </section>`;

    /* 2 · 能力维度 */
    const dims = `<section class="block" id="p-dims"><div class="feedhead"><h2 class="block__h">能力维度</h2><span class="muted pleg"><i class="pleg__bar"></i>本人得分<i class="pleg__med"></i>团队中位数</span></div>
      <div class="pdims">${dimRows(p, med)}</div>
      <p class="side__n">权重（${preset}）：${X.DIMS.map((d) => `${d.name} ${W[d.k]}%`).join(' · ')}。展开维度可以看到原始数值、锚点和得分。</p></section>`;

    /* 3 · 使用数据 */
    const perDay = days.map((d) => X.agg(list.filter(([, s]) => s.date === d)));
    const col = (fn, opts) => V.columns(days.map((d, i) => ({ v: fn(perDay[i]), unknown: opts.unk ? perDay[i].unknown > 0 : false, label: `${dayLabel(d)}`, tt: perDay[i].sessions ? opts.fmt(fn(perDay[i])) : '无会话', short: String(Number(d.slice(8))) })), { w: 240, h: 64, label: opts.label, s: opts.s || '1' });
    const agents = ['Claude Code CLI', 'Codex CLI', 'Codex Desktop'].map((ag, i) => ({ ag, s: String(i + 1), n: list.filter(([, s]) => s.agent === ag).length })).filter((x) => x.n);
    const kinds = X.KINDS.map((k) => ({ k, n: list.filter(([sid]) => X.metrics[sid].kind === k).length })).filter((x) => x.n);
    const usage = `<section class="block" id="p-usage"><h2 class="block__h">使用数据</h2>
      <div class="stats-row">
        ${V.stat({ label: '活跃天数', value: `${p.sample.activeDays}<span class="stat__of">/${p.sample.workdays}</span>`, sub: '有会话的工作日 / 接入以来的工作日' })}
        ${V.stat({ label: '会话 · 提示词', value: `${a.sessions}`, sub: `${a.promptN} 条提示词 · ${a.tools} 次工具调用` })}
        ${V.stat({ label: 'Token 输入（已知）', value: V.fmtTok(a.tin), sub: a.unknown ? `<span class="unk">+${a.unknown} 个会话未上报</span>` : '全部会话已上报' })}
        ${V.stat({ label: '已验证结果', value: a.verified, sub: `另有 ${a.claimed} 条只有声称` })}
        ${V.stat({ label: '代码变更', value: `+${V.num(a.add)}`, sub: `−${V.num(a.del)} 行 · 提交 ${a.commits} · 测试 ${a.testsPass}/${a.testsRun}` })}
      </div>
      <div class="multiples multiples--3">
        <div class="mult"><p class="mult__h">每日会话</p>${col((x) => x.sessions, { fmt: (v) => `${v} 个会话`, label: '每日会话' })}</div>
        <div class="mult"><p class="mult__h">每日 Token 输入（已知）</p>${col((x) => (x.known ? x.tin : null), { fmt: V.fmtTok, label: '每日 Token', unk: true })}</div>
        <div class="mult"><p class="mult__h">每日已验证结果</p>${col((x) => x.verified, { fmt: (v) => `${v} 条`, label: '每日已验证结果' })}</div>
      </div>
      <div class="pair pair--gap">
        ${V.figure({ id: `p-ag-${mid}`, title: '使用的 Agent', sub: '按会话数', chart: V.hbars(agents.map((x) => ({ label: esc(x.ag), segs: [{ s: x.s, v: x.n, tt: [`${x.n} 个会话`, x.ag] }], value: `${x.n}` })), { axis: false }), table: V.table(['Agent', '会话'], agents.map((x) => [esc(x.ag), x.n]), { right: [1] }) })}
        ${V.figure({ id: `p-kind-${mid}`, title: '任务类型', sub: '按会话数（模型推断）', chart: V.hbars(kinds.map((x) => ({ label: x.k, segs: [{ s: '1', v: x.n, tt: [`${x.n} 个会话`, x.k] }], value: `${x.n}` })), { axis: false }), table: V.table(['任务类型', '会话'], kinds.map((x) => [x.k, x.n]), { right: [1] }) })}
      </div></section>`;

    /* 4 · 工作内容 */
    const R = X.RANGES[range];
    const themes = Object.entries(D.themes).filter(([, t]) => t.owner === mid && t.days.some((d) => d >= R.from && d <= R.to));
    const blocks = [];
    Object.entries(D.reports).filter(([k]) => k.startsWith(mid + '|')).forEach(([k, rep]) => { const iso = k.split('|')[1]; if (iso < R.from || iso > R.to) return; (rep.body[rep.versions[0].v] || []).forEach((b) => (b.block || []).forEach((it) => blocks.push({ iso, it }))); });
    const work = `<section class="block" id="p-work"><h2 class="block__h">工作内容</h2>
      ${themes.length ? `<ul class="tlist tlist--wide">${themes.map(([, t]) => { const last = t.days.filter((d) => d <= D.now.date).slice(-1)[0]; return `<li><a class="tlist__i" href="#member.${mid}.day.${last}" data-go="member.${mid}.day.${last}">
        <span class="serif tlist__t">${esc(t.title)}</span>${projChip(t.project)}<span class="muted num">${md(t.days[0])}${t.days.length > 1 ? '—' + md(t.days[t.days.length - 1]) : ''} · ${t.sessions.length} 个会话</span>
        ${t.status === 'blocked' ? pill('warn', '阻塞', 'alert') : t.status === 'done' ? pill('ok', '会话内已完成', 'check') : pill('info', '进行中', 'live')}</a></li>`; }).join('')}</ul>` : '<p class="muted">这个范围内的会话还没有形成工作主题（W38 只在周报中汇总）。</p>'}
      ${blocks.length ? `<p class="pverdict__h">记录到的阻塞</p><ul class="rows__plain">${blocks.map((b) => `<li><span>${esc(b.it.t)}</span><span class="muted">${md(b.iso)}</span><span class="rows__ev">${(b.it.ev || []).map(U.evBadge).join('')}</span></li>`).join('')}</ul>` : ''}
    </section>`;

    /* 5 · 协作方式 */
    const team = X.agg(X.sessionsIn({ range, member: 'all' }));
    const firsts = a.prompts.filter((q) => q.first);
    const tFirsts = team.prompts.filter((q) => q.first);
    const elRate = (ps, k) => (ps.length ? ps.filter((q) => q[k]).length / ps.length : null);
    const els = [['goal', '目标明确'], ['cons', '给出约束'], ['ctx', '提供上下文'], ['acc', '验收标准']];
    const bestS = p.best, worstS = p.worst;
    const firstPrompt = bestS ? X.metrics[bestS.sid].prompts[0] : null;
    const rwPrompt = worstS ? X.metrics[worstS.sid].prompts.find((q) => q.rework) : null;
    const hours = Array.from({ length: 14 }, (_, i) => 8 + i);
    const waitsBy = hours.map((h) => a.waits.filter((w) => Math.floor(w.at / 60) === h).map((w) => w.min));
    const topPerm = a.perms.slice().sort((x, y) => y.min - x.min).slice(0, 3);
    const collab = `<section class="block" id="p-collab"><h2 class="block__h">协作方式</h2>
      <div class="pair pair--gap">
        <div class="fig"><div class="fig__h"><div class="fig__t"><h3>怎么写提示词</h3><p>每个会话第一条提示词里各要素的出现率（模型推断）；竖线为团队水平</p></div></div>
          <div class="pel">${els.map(([k, l]) => { const v = elRate(firsts, k), t = elRate(tFirsts, k); return `<div class="pel__r"><span>${l}</span><span class="pbar"><i style="--w:${v == null ? 0 : (v * 100).toFixed(0)}%"></i>${t != null ? `<em style="--m:${(t * 100).toFixed(0)}%"></em>` : ''}</span><span class="num">${V.pct(v)}</span></div>`; }).join('')}</div>
          <dl class="effd__kv pkv"><div><dt>返工率</dt><dd class="num">${V.pct(a.reworkRate)} <span class="muted">团队 ${V.pct(team.reworkRate)}</span></dd></div><div><dt>Agent 追问率</dt><dd class="num">${V.pct(a.clarifyRate)} <span class="muted">团队 ${V.pct(team.clarifyRate)}</span></dd></div><div><dt>无返工会话</dt><dd class="num">${V.pct(a.cleanShare)}</dd></div><div><dt>提示词中位长度</dt><dd class="num">${a.lenMed != null ? Math.round(a.lenMed) : '—'} 字</dd></div></dl>
          ${firstPrompt ? `<div class="ex ex--good"><blockquote class="ex__q">“${esc(firstPrompt.text)}”</blockquote><p class="ex__m">${icon('check')}<span>代表性会话：${esc(bestS.s.title)} · 已验证 ${bestS.m.verified} · 无返工</span></p><p class="ex__src"><a href="#session.${bestS.sid}.m${firstPrompt.n}" data-go="session.${bestS.sid}.m${firstPrompt.n}">打开对话</a></p></div>` : ''}
          ${rwPrompt ? `<div class="ex ex--bad"><blockquote class="ex__q">“${esc(rwPrompt.text)}”</blockquote><p class="ex__m">${icon('refresh')}<span>返工较多的会话：${esc(worstS.s.title)} · 返工 ${worstS.m.rework} 次${worstS.m.claimed > worstS.m.verified ? ' · 声称多于已验证' : ''}</span></p><p class="ex__src"><a href="#session.${worstS.sid}.m${rwPrompt.n}" data-go="session.${worstS.sid}.m${rwPrompt.n}">打开对话</a></p></div>` : ''}
        </div>
        <div class="fig"><div class="fig__h"><div class="fig__t"><h3>怎么回应 Agent</h3><p>Agent 回复后多久给出下一条指令；等待不等于怠工</p></div></div>
          <dl class="effd__kv pkv"><div><dt>等待回复中位数</dt><dd class="num">${V.fmtMin(a.waitMed)} <span class="muted">团队 ${V.fmtMin(team.waitMed)}</span></dd></div><div><dt>P90</dt><dd class="num">${V.fmtMin(a.waitP90)}</dd></div><div><dt>10 分钟以上</dt><dd class="num">${V.pct(a.longShare)}</dd></div><div><dt>期间在别处工作</dt><dd class="num">${V.pct(a.parallelShare)}</dd></div><div><dt>权限等待中位数</dt><dd class="num">${V.fmtMin(a.permMed)} <span class="muted">团队 ${V.fmtMin(team.permMed)}</span></dd></div></dl>
          <p class="mult__h">各时段的等待中位数</p>
          ${V.columns(hours.map((h, i) => ({ v: waitsBy[i].length ? X.median(waitsBy[i]) : null, label: `${h}:00–${h + 1}:00 · ${waitsBy[i].length} 次`, tt: waitsBy[i].length ? V.fmtMin(X.median(waitsBy[i])) : '无等待', short: i % 2 === 0 ? String(h) : '' })), { w: 320, h: 72, label: '各时段等待中位数' })}
          ${topPerm.length ? `<p class="pverdict__h">停得最久的权限请求</p><ul class="rows__plain">${topPerm.map((q) => `<li><span class="mono">${esc(q.cmd)}</span><span class="tag tag--warn">${V.fmtMin(q.min)}</span><a class="linkbtn" href="#session.${q.sid}" data-go="session.${q.sid}">${md(D.sessions[q.sid].date)} 的会话</a></li>`).join('')}</ul>` : ''}
        </div>
      </div></section>`;

    /* 6 · 会话 */
    const sessions = `<section class="block" id="p-sessions"><h2 class="block__h">会话 <span class="muted num">${list.length}</span></h2>
      <div class="tblwrap"><table class="tbl tbl--eff">
        <thead><tr><th scope="col">会话</th><th scope="col">日期</th><th scope="col" class="r">Token</th><th scope="col" class="r">提示词</th><th scope="col" class="r">已验证</th><th scope="col" class="r">产效比</th><th scope="col" class="r">返工</th><th scope="col" class="r">等待占比</th></tr></thead>
        <tbody>${list.map(([sid, s]) => { const mt = X.metrics[sid]; const rt = X.ratio(mt); const flag = (mt.rework >= 2 ? '<span class="tag tag--warn">返工多</span>' : '') + (mt.claimed > mt.verified ? '<span class="tag tag--warn">声称多于已验证</span>' : ''); return `<tr>
          <td><a class="tbl__link" href="#session.${sid}" data-go="session.${sid}">${esc(s.title)}</a><span class="muted"> · ${mt.kind} · ${esc(s.agent)}</span>${flag}</td>
          <td class="num nowrap">${md(s.date)} ${s.start}</td>
          <td class="num r">${mt.known ? V.fmtTok(mt.tin) : '<span class="unk">未知</span>'}</td>
          <td class="num r">${mt.turns}</td>
          <td class="num r">${mt.verified}${mt.claimed ? `<span class="muted"> +${mt.claimed}</span>` : ''}</td>
          <td class="num r">${rt != null ? rt.toFixed(1) : '—'}</td>
          <td class="num r">${mt.rework}</td>
          <td class="num r">${V.pct(mt.waitMin / mt.activeMin)}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="side__n">已验证后的 “+n” 为只有声称的结果；产效比 = 已验证结果 ÷ 百万 Token，只在同类任务之间参考。</p></section>`;

    /* 7 · 最近活动 */
    const acts = X.activity.filter((e) => e.member === mid && e.date >= R.from && e.date <= R.to && ['start', 'prompt', 'wait', 'perm', 'gap', 'backfill', 'offline'].includes(e.type)).slice(-10).reverse();
    const lastDay = acts[0] ? acts[0].date : D.now.date;
    const activity = `<section class="block" id="p-activity"><div class="feedhead"><h2 class="block__h">最近活动</h2><button type="button" class="linkbtn" data-act="p-activity" data-m="${mid}" data-d="${lastDay}">在活动记录中查看</button></div>
      <ol class="feed">${acts.map((e) => { const s = D.sessions[e.sid]; const what = e.type === 'start' ? '开始会话' : e.type === 'prompt' ? (e.rework ? '返工提问' : '提问') : e.type === 'wait' ? `Agent 等待回复 ${V.fmtMin(e.min)}` : e.type === 'perm' ? `权限请求等待 ${V.fmtMin(e.min)}` : e.type === 'gap' ? '采集缺口' : e.type === 'backfill' ? '补传' : '设备离线'; const to = e.n ? `session.${e.sid}.m${e.n}` : `session.${e.sid}`; return `<li class="feed__i feed__i--${e.type}">
        <span class="feed__t num">${md(e.date).replace('月', '/').replace('日', '')} ${X.fmtT(e.at).slice(0, 5)}</span><span class="feed__ico" aria-hidden="true">${icon(e.type === 'prompt' || e.type === 'start' ? 'person' : e.type === 'wait' ? 'clock' : e.type === 'perm' ? 'shield' : 'alert')}</span>
        <div class="feed__b"><p class="feed__h">${what}<a class="feed__s" href="#${to}" data-go="${to}">${esc(s.title)}</a></p>${e.text && ['start', 'prompt'].includes(e.type) ? `<p class="feed__q">“${esc(e.text.length > 80 ? e.text.slice(0, 80) + '…' : e.text)}”</p>` : ''}</div></li>`; }).join('')}</ol></section>`;

    /* 8 · 趋势 */
    const p38 = X.prof(mid, 'W38', preset), p39 = X.prof(mid, 'W39', preset);
    const trend = `<section class="block" id="p-trend"><h2 class="block__h">趋势 · 上周 W38 → 本周 W39</h2>
      ${dumbbell([{ label: '综合指数', a: p38.index, b: p39.index }, ...X.DIMS.map((d) => ({ label: d.name, a: p38.dims[d.k].score, b: p39.dims[d.k].score }))])}
      ${V.legend([['deemph', '上周', 'dot'], ['1', '本周', 'dot']])}<p class="side__n">${p38.sample.sessions ? `单周样本较少（上周可信度${p38.confLabel}，本周可信度${p39.confLabel}），趋势只看方向。` : `${md(m.joined)} 接入，上周没有会话，只显示本周（可信度${p39.confLabel}）。`}</p></section>`;

    /* 9 · 复核备注 */
    const notes = S.pnotes[mid] || [];
    const noteSec = `<section class="block" id="p-notes"><h2 class="block__h">复核备注</h2>
      <p class="block__d">评估需要人工复核。员工本人和 leader 都可以补充背景（例如本周以方案评审为主），备注会保留作者与时间，不会改动评估数据。</p>
      ${notes.length ? `<ol class="hist hist--wide">${notes.map((n) => `<li class="hist__i"><span class="hist__dot is-me"></span><p><b>${esc(n.by)}</b> · ${esc(n.at)}</p><p>${esc(n.text)}</p></li>`).join('')}</ol>` : '<p class="muted">还没有备注。</p>'}
      <form class="form pnote" data-submit="p-note" data-mid="${mid}" novalidate>
        <div class="field"><label for="pn-${mid}">补充说明</label><textarea id="pn-${mid}" rows="3" placeholder="本周主要在做方案评审，Agent 使用少是正常的。" aria-describedby="pn-h-${mid}"></textarea><p class="help" id="pn-h-${mid}">以 ${esc(D.viewer.name)} 的名义保存；全体已认证用户可见。</p></div>
        <div class="form__f"><button type="submit" class="btn btn--primary" data-k="pn-save-${mid}">保存备注</button></div>
      </form></section>`;

    return `${nav}${verdict}${dims}${usage}${work}${collab}${sessions}${activity}${trend}${noteSec}${method()}`;
  };

  window.SkyProfile = { index, controls, body };
})();
