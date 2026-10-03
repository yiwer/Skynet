/* PROTOTYPE — 图表工具（纯 SVG / HTML，无依赖）。
 * 规范：细标记（条 ≤ 16px、4px 圆角数据端、基线方角）、2px 表面间隙与点位表面环、发丝网格、
 * 每个图都有悬停/聚焦提示（值在前、标签在后，用 textContent 写入）与“表格”视图；颜色只来自 tokens.css。
 */
(() => {
  'use strict';
  const U = window.SkyUI;
  const { esc, S, set, onAct } = U;

  /* ---------- formatting ---------- */
  const fmtTok = (v) => (v == null ? '未知' : v >= 1e6 ? `${(v / 1e6).toFixed(2).replace(/\.?0+$/, '')}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));
  const fmtMin = (m) => (m == null ? '—' : m < 1 ? `${Math.max(1, Math.round(m * 60))} 秒` : m < 60 ? `${m < 10 ? m.toFixed(1) : Math.round(m)} 分钟` : `${(m / 60).toFixed(1)} 小时`);
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const num = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: d }));
  const nice = (v) => { if (!v || v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
  const tt = (lines) => `data-tt="${esc(lines.filter((x) => x != null && x !== '').join('\n'))}"`;

  /* ---------- tooltip layer (one element, outside #app) ---------- */
  let tip = null;
  const ensure = () => {
    if (!tip) { tip = document.createElement('div'); tip.className = 'vtip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.appendChild(tip); }
    return tip;
  };
  const show = (el, x, y) => {
    const t = ensure();
    t.textContent = '';
    (el.getAttribute('data-tt') || '').split('\n').forEach((line, i) => {
      const d = document.createElement('div');
      d.className = i === 0 ? 'vtip__v' : 'vtip__l';
      d.textContent = line;
      t.appendChild(d);
    });
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    t.style.left = `${Math.max(8, left)}px`;
    t.style.top = `${Math.max(8, top)}px`;
  };
  const hide = () => { if (tip) tip.hidden = true; };
  document.addEventListener('pointermove', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-tt]');
    if (el) show(el, ev.clientX, ev.clientY); else hide();
  });
  document.addEventListener('focusin', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-tt]');
    if (!el) return hide();
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.bottom);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);

  /* ---------- figure wrapper with chart/table toggle ---------- */
  S.tv = S.tv || {};
  onAct('fig-view', (el) => { S.tv[el.dataset.id] = el.dataset.v; set({}); });
  const figure = ({ id, title, sub = '', chart, table, legend = '', note = '', cls = '' }) => {
    const tab = S.tv[id] === 'table';
    return `<figure class="fig ${cls}" id="fig-${id}">
      <figcaption class="fig__h">
        <div class="fig__t"><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div>
        ${table ? `<div class="seg seg--sm" role="group" aria-label="${esc(title)} 的显示方式">
          <button type="button" class="seg__b ${tab ? '' : 'is-on'}" aria-pressed="${!tab}" data-act="fig-view" data-id="${id}" data-v="chart" data-k="fv-${id}-c">图表</button>
          <button type="button" class="seg__b ${tab ? 'is-on' : ''}" aria-pressed="${tab}" data-act="fig-view" data-id="${id}" data-v="table" data-k="fv-${id}-t">表格</button></div>` : ''}
      </figcaption>
      <div class="fig__b">${tab ? table : chart}</div>
      ${!tab && legend ? legend : ''}
      ${note ? `<p class="fig__n">${note}</p>` : ''}
    </figure>`;
  };
  const legend = (items) => `<ul class="vleg" aria-label="图例">${items.map(([s, label, shape]) => `<li><span class="vsw vsw--${shape || 'rect'}" data-s="${s}" aria-hidden="true"></span>${esc(label)}</li>`).join('')}</ul>`;
  const table = (head, rows, opts = {}) => `<div class="tblwrap"><table class="tbl tbl--compact"><thead><tr>${head.map((h, i) => `<th scope="col" class="${opts.right && opts.right.includes(i) ? 'r' : ''}">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${opts.right && opts.right.includes(i) ? 'num r' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  /* ---------- stat tile + sparkline ---------- */
  const spark = (vals, labels, opts = {}) => {
    const w = opts.w || 120, h = opts.h || 30, pad = 4;
    const vs = vals.map((v) => (v == null ? null : v));
    const max = Math.max(1e-9, ...vs.filter((v) => v != null));
    const n = vs.length;
    if (!n) return '';
    const x = (i) => (n === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (n - 1));
    const y = (v) => h - pad - (v / max) * (h - pad * 2);
    let d = '';
    vs.forEach((v, i) => { if (v == null) return; d += `${d && vs[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; });
    const last = vs.length - 1;
    const hits = vs.map((v, i) => `<rect class="hit" x="${(x(i) - (w / n) / 2).toFixed(1)}" y="0" width="${(w / n).toFixed(1)}" height="${h}" ${tt([v == null ? '未知' : opts.fmt ? opts.fmt(v) : num(v), labels[i]])}></rect>`).join('');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(opts.label || '趋势')}">
      <path class="spark__l" d="${d}"></path>
      ${vs[last] != null ? `<circle class="spark__end" cx="${x(last).toFixed(1)}" cy="${y(vs[last]).toFixed(1)}" r="3.5"></circle>` : ''}${hits}</svg>`;
  };
  const stat = ({ label, value, unit = '', sub = '', trend = '', tone = '' }) => `<section class="stat ${tone ? 'stat--' + tone : ''}">
      <p class="stat__k">${label}</p>
      <p class="stat__v">${value}${unit ? `<span class="stat__u">${unit}</span>` : ''}</p>
      ${sub ? `<p class="stat__s">${sub}</p>` : ''}${trend ? `<div class="stat__t">${trend}</div>` : ''}
    </section>`;

  /* ---------- horizontal (stacked) bars — HTML ---------- */
  // rows: [{ label, href, segs:[{ s, v, tt }], value, tail }]
  const hbars = (rows, opts = {}) => {
    const max = opts.max || nice(Math.max(1e-9, ...rows.map((r) => r.segs.reduce((a, x) => a + (x.v || 0), 0))));
    return `<div class="hb" role="list">${rows.map((r) => {
      const tot = r.segs.reduce((a, x) => a + (x.v || 0), 0);
      return `<div class="hb__row" role="listitem">
        <span class="hb__lab">${r.href ? `<a href="#${r.href}" data-go="${r.href}">${r.label}</a>` : r.label}</span>
        <span class="hb__plot"><span class="hb__bar" style="--w:${((tot / max) * 100).toFixed(2)}%">${r.segs.filter((x) => x.v > 0).map((x) => `<span class="hb__seg" data-s="${x.s}" style="--g:${x.v}" ${x.tt ? tt(x.tt) + ' tabindex="0"' : ''}></span>`).join('')}</span>
          <span class="hb__val num">${r.value != null ? r.value : ''}</span>${r.tail || ''}</span>
      </div>`;
    }).join('')}
      ${opts.axis === false ? '' : `<div class="hb__axis" aria-hidden="true"><span></span><span class="hb__ticks">${[0, 0.25, 0.5, 0.75, 1].map((f) => `<i style="--l:${f * 100}%">${opts.fmt ? opts.fmt(max * f) : num(max * f)}</i>`).join('')}</span></div>`}
    </div>`;
  };
  const barCell = (v, max, text, s = '1') => `<span class="bc"><span class="bc__t"><span class="bc__b" data-s="${s}" style="--w:${max ? Math.max(v > 0 ? 2 : 0, (v / max) * 100).toFixed(1) : 0}%"></span></span><span class="bc__v num">${text}</span></span>`;

  /* ---------- scatter (all-pairs → ≤ 3 hues; here emphasis vs context) ---------- */
  // pts: [{ x, y, emph, tt, go }], unknown: [{ y, emph, tt, go }]
  const scatter = (pts, unknown, opts = {}) => {
    const W = 640, H = opts.h || 260, L = 44, UL = unknown && unknown.length ? 52 : 0, R = 16, T = 12, B = 34;
    const xmax = nice(Math.max(1e-9, ...pts.map((p) => p.x)));
    const ymax = Math.max(opts.ymin || 4, ...pts.map((p) => p.y), ...(unknown || []).map((p) => p.y));
    const px = (x) => L + UL + (x / xmax) * (W - L - UL - R);
    const py = (y) => T + (1 - y / ymax) * (H - T - B);
    const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => xmax * f);
    const yt = Array.from({ length: ymax + 1 }, (_, i) => i).filter((i) => ymax <= 6 || i % 2 === 0);
    const jit = (i) => ((i * 37) % 11) / 11 - 0.5;
    const dot = (cx, cy, p, i) => `<g class="sc__pt ${p.emph ? 'is-emph' : ''}">
        <circle class="sc__dot" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5"></circle>
        <circle class="hit" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="12" ${tt(p.tt)} tabindex="0" ${p.go ? `data-go="${p.go}" role="link"` : ''}></circle></g>`;
    const ctx = pts.map((p, i) => [p, i]).sort((a, b) => (a[0].emph ? 1 : 0) - (b[0].emph ? 1 : 0));
    return `<div class="figscroll"><svg class="sc" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || '散点图')}">
      ${yt.map((v) => `<line class="grid" x1="${L + UL}" x2="${W - R}" y1="${py(v)}" y2="${py(v)}"></line><text class="tick" x="${L + UL - 8}" y="${py(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      ${xt.map((v) => `<line class="grid" x1="${px(v)}" x2="${px(v)}" y1="${T}" y2="${H - B}"></line><text class="tick" x="${px(v)}" y="${H - B + 16}" text-anchor="middle">${opts.fmtX ? opts.fmtX(v) : num(v)}</text>`).join('')}
      <line class="axis" x1="${L + UL}" x2="${W - R}" y1="${H - B}" y2="${H - B}"></line>
      ${UL ? `<rect class="sc__lane" x="${L + 4}" y="${T}" width="${UL - 12}" height="${H - T - B}" rx="6"></rect><text class="tick" x="${L + 4 + (UL - 12) / 2}" y="${H - B + 16}" text-anchor="middle">未知</text>` : ''}
      <text class="axlab" x="${W - R}" y="${H - 4}" text-anchor="end">${esc(opts.xLabel || '')}</text>
      <text class="axlab" x="4" y="${T + 4}" text-anchor="start">${esc(opts.yLabel || '')}</text>
      ${(unknown || []).map((p, i) => dot(L + 4 + (UL - 12) / 2 + jit(i) * 18, py(p.y + jit(i + 3) * 0.3), p, i)).join('')}
      ${ctx.map(([p, i]) => dot(px(p.x), py(p.y + (opts.jitterY ? jit(i) * 0.35 : 0)), p, i)).join('')}
    </svg></div>`;
  };

  /* ---------- strip plot (one row per category) ---------- */
  // rows: [{ label, pts:[{ x, emph, tt, go }], med }]
  const strip = (rows, opts = {}) => {
    const W = 640, RH = 36, L = 64, R = 56, T = 8, B = 30;
    const H = T + rows.length * RH + B;
    const xmax = opts.xmax || nice(Math.max(1e-9, ...rows.flatMap((r) => r.pts.map((p) => p.x))));
    const px = (x) => L + (Math.min(x, xmax) / xmax) * (W - L - R);
    const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => xmax * f);
    return `<div class="figscroll"><svg class="sc" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || '分布')}">
      ${xt.map((v) => `<line class="grid" x1="${px(v)}" x2="${px(v)}" y1="${T}" y2="${H - B}"></line><text class="tick" x="${px(v)}" y="${H - B + 16}" text-anchor="middle">${opts.fmtX ? opts.fmtX(v) : num(v, 1)}</text>`).join('')}
      ${rows.map((r, ri) => {
        const cy = T + ri * RH + RH / 2;
        const pts = r.pts.map((p, i) => [p, i]).sort((a, b) => (a[0].emph ? 1 : 0) - (b[0].emph ? 1 : 0));
        return `<line class="grid grid--row" x1="${L}" x2="${W - R}" y1="${cy}" y2="${cy}"></line>
          <text class="rlab" x="${L - 10}" y="${cy + 4}" text-anchor="end">${esc(r.label)}</text>
          <text class="tick" x="${W - R + 8}" y="${cy + 4}">n=${r.pts.length}</text>
          ${r.med != null ? `<line class="med" x1="${px(r.med)}" x2="${px(r.med)}" y1="${cy - 12}" y2="${cy + 12}"></line>` : ''}
          ${pts.map(([p, i]) => { const cx = px(p.x), yy = cy + (((i * 29) % 9) / 9 - 0.5) * 16; return `<g class="sc__pt ${p.emph ? 'is-emph' : ''}"><circle class="sc__dot" cx="${cx.toFixed(1)}" cy="${yy.toFixed(1)}" r="4.5"></circle><circle class="hit" cx="${cx.toFixed(1)}" cy="${yy.toFixed(1)}" r="11" ${tt(p.tt)} tabindex="0" ${p.go ? `data-go="${p.go}" role="link"` : ''}></circle></g>`; }).join('')}`;
      }).join('')}
      <text class="axlab" x="${W - R}" y="${H - 4}" text-anchor="end">${esc(opts.xLabel || '')}</text>
    </svg></div>`;
  };

  /* ---------- small column chart (small multiples) ---------- */
  // vals: [{ v, unknown, label }]
  const columns = (vals, opts = {}) => {
    const W = opts.w || 200, H = opts.h || 64, B = 14, T = 4;
    const max = opts.max || nice(Math.max(1e-9, ...vals.map((x) => x.v || 0)));
    const n = vals.length, slot = W / n, bw = Math.min(14, slot * 0.6);
    return `<svg class="cols" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || '每日')}">
      <line class="axis" x1="0" x2="${W}" y1="${H - B}" y2="${H - B}"></line>
      ${vals.map((x, i) => {
        const cx = slot * i + slot / 2;
        const h = x.v ? Math.max(2, (x.v / max) * (H - B - T)) : 0;
        const y0 = H - B;
        const r = Math.min(4, h / 2, bw / 2);
        const path = h ? `M${(cx - bw / 2).toFixed(1)} ${y0} V${(y0 - h + r).toFixed(1)} Q${(cx - bw / 2).toFixed(1)} ${(y0 - h).toFixed(1)} ${(cx - bw / 2 + r).toFixed(1)} ${(y0 - h).toFixed(1)} H${(cx + bw / 2 - r).toFixed(1)} Q${(cx + bw / 2).toFixed(1)} ${(y0 - h).toFixed(1)} ${(cx + bw / 2).toFixed(1)} ${(y0 - h + r).toFixed(1)} V${y0} Z` : '';
        return `${h ? `<path class="col" data-s="${opts.s || '1'}" d="${path}"></path>` : ''}
          ${x.unknown ? `<rect class="col--unk" x="${(cx - bw / 2).toFixed(1)}" y="${(y0 - (h || 0) - 6).toFixed(1)}" width="${bw.toFixed(1)}" height="4" rx="2"></rect>` : ''}
          <text class="tick" x="${cx.toFixed(1)}" y="${H - 2}" text-anchor="middle">${esc(x.short || '')}</text>
          <rect class="hit" x="${(slot * i).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H - B}" ${tt([x.tt || (x.v == null ? '未知' : num(x.v)), x.label])} tabindex="0"></rect>`;
      }).join('')}
    </svg>`;
  };

  /* ---------- heatmap (HTML grid) ---------- */
  // rows: labels; cols: labels; cell(ri, ci) → { v, step 0..8, text, tt }
  const heatmap = (rows, cols, cell, opts = {}) => `<div class="figscroll"><div class="hm" style="--cols:${cols.length}" role="table" aria-label="${esc(opts.label || '热力图')}">
      <span class="hm__corner" role="columnheader"></span>${cols.map((c, i) => `<span class="hm__ch" role="columnheader">${i % (opts.every || 1) === 0 ? esc(c) : ''}</span>`).join('')}
      ${rows.map((r, ri) => `<span class="hm__rh" role="rowheader">${esc(r)}</span>${cols.map((c, ci) => { const x = cell(ri, ci); return `<span class="hm__c hc-${x.step}" role="cell" ${x.tt ? tt(x.tt) + ' tabindex="0"' : ''}>${x.text || ''}</span>`; }).join('')}`).join('')}
    </div></div>
    <div class="hmlg" aria-label="色阶">${opts.scaleLabel ? `<span>${esc(opts.scaleLabel)}</span>` : ''}${(opts.stops || []).map((s, i) => `<span class="hmlg__i"><i class="hc-${i + 1}"></i>${esc(s)}</span>`).join('')}<span class="hmlg__i"><i class="hc-0"></i>无数据</span></div>`;

  /* ---------- activity swimlanes ---------- */
  // lanes: [{ label, spans:[{ a, b, s, tt, go }], dots:[{ t, tt, go, kind }] }]
  const lanes = (rows, opts = {}) => {
    const from = (opts.from || 7) * 60, to = (opts.to || 22) * 60;
    const W = 720, L = 72, R = 12, RH = 34, T = 8, B = 26;
    const H = T + rows.length * RH + B;
    const px = (m) => L + ((Math.max(from, Math.min(to, m)) - from) / (to - from)) * (W - L - R);
    const hours = []; for (let h = Math.ceil(from / 60); h <= Math.floor(to / 60); h += 1) hours.push(h);
    return `<div class="figscroll"><svg class="sc lanes" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || '活动节奏')}">
      ${hours.map((h) => `<line class="grid" x1="${px(h * 60)}" x2="${px(h * 60)}" y1="${T}" y2="${H - B}"></line>${h % 2 === 0 ? `<text class="tick" x="${px(h * 60)}" y="${H - B + 16}" text-anchor="middle">${String(h).padStart(2, '0')}</text>` : ''}`).join('')}
      ${opts.now != null ? `<line class="now" x1="${px(opts.now)}" x2="${px(opts.now)}" y1="${T}" y2="${H - B}"></line>` : ''}
      ${rows.map((r, ri) => {
        const cy = T + ri * RH + RH / 2;
        return `<text class="rlab" x="${L - 10}" y="${cy + 4}" text-anchor="end">${esc(r.label)}</text>
          ${r.spans.map((sp) => `<rect class="lane__span" data-s="${sp.s}" x="${px(sp.a).toFixed(1)}" y="${cy - 5}" width="${Math.max(3, px(sp.b) - px(sp.a)).toFixed(1)}" height="10" rx="5" ${tt(sp.tt)} tabindex="0" ${sp.go ? `data-go="${sp.go}" role="link"` : ''}></rect>`).join('')}
          ${r.waits ? r.waits.map((w) => `<rect class="lane__wait" x="${px(w.a).toFixed(1)}" y="${cy - 5}" width="${Math.max(2, px(w.b) - px(w.a)).toFixed(1)}" height="10" ${tt(w.tt)}></rect>`).join('') : ''}
          ${r.dots.map((d) => `<g class="lane__dot ${d.kind === 'rework' ? 'is-rework' : ''}"><circle cx="${px(d.t).toFixed(1)}" cy="${cy}" r="3.5"></circle><circle class="hit" cx="${px(d.t).toFixed(1)}" cy="${cy}" r="9" ${tt(d.tt)} tabindex="0" ${d.go ? `data-go="${d.go}" role="link"` : ''}></circle></g>`).join('')}`;
      }).join('')}
    </svg></div>`;
  };

  /* ---------- work vs wait bar for one session ---------- */
  // segs: [{ a, b, kind: 'work'|'wait'|'perm'|'gap', tt }]
  const workWait = (segs, from, to, opts = {}) => {
    const W = 640, H = 46, L = 4, R = 4;
    const px = (m) => L + ((m - from) / Math.max(1, to - from)) * (W - L - R);
    const ticks = []; for (let h = Math.ceil(from / 60); h <= Math.floor(to / 60); h += 1) ticks.push(h * 60);
    return `<div class="figscroll"><svg class="sc ww" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label || 'Agent 工作与等待')}">
      ${segs.map((s) => `<rect class="ww__${s.kind}" x="${px(s.a).toFixed(1)}" y="6" width="${Math.max(1.5, px(s.b) - px(s.a) - 2).toFixed(1)}" height="16" rx="3" ${tt(s.tt)} tabindex="0"></rect>`).join('')}
      ${ticks.map((m) => `<line class="grid" x1="${px(m)}" x2="${px(m)}" y1="26" y2="30"></line><text class="tick" x="${px(m)}" y="42" text-anchor="middle">${String(Math.floor(m / 60)).padStart(2, '0')}:00</text>`).join('')}
    </svg></div>`;
  };

  window.SkyViz = { fmtTok, fmtMin, pct, num, nice, tt, figure, legend, table, spark, stat, hbars, barCell, scatter, strip, columns, heatmap, lanes, workWait };
})();
