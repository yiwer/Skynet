/* PROTOTYPE — 页面：员工工作、项目、会话列表、会话详情、会话找回、接入与设备、分析与运行，以及共享抽屉。 */
(() => {
  'use strict';
  const U = window.SkyUI;
  const {
    D, S, M, DEV, esc, icon, md, dnum, dayLabel, weekday, WD, isToday, isFuture, toMin, dayRec, dayStates, statePill, reportPill,
    avatar, projChip, pill, tone, evBadge, evLegend, statCells, statLine, ruler, notice, empty, pageHead, copyBtn, itemsDl,
    reportBlocks, latestVer, ROWS, set, go, toast, register, onAct, after
  } = U;

  /* ---------------- small helpers ---------------- */
  const INTEG = {
    complete: ['ok', '当前快照完整', 'check'],
    'gap-upstream': ['warn', '快照完整 · 1 处上游缺口', 'none'],
    syncing: ['info', '同步中', 'refresh'],
    partial: ['warn', '已收到部分 · 设备离线', 'offline'],
    gap: ['crit', '存在采集缺口', 'alert']
  };
  const integPill = (k) => { const [t, l, i] = INTEG[k] || INTEG.complete; return pill(t, l, i); };
  const themeStatus = (t) => (t.status === 'blocked' ? pill('warn', '阻塞', 'alert') : t.status === 'done' ? pill('ok', '会话内已完成', 'check') : pill('info', '进行中', 'live'));
  const sesLink = (sid, opts = {}) => {
    const s = D.sessions[sid];
    if (!s) return '';
    return `<a class="slink" href="#session.${sid}" data-go="session.${sid}"><span class="mono">${sid}</span><span>${opts.date ? md(s.date) + ' ' : ''}${s.start}–${s.end}</span><span class="muted">${esc(s.agent)}</span></a>`;
  };
  const osFamily = (env) => (/macOS/.test(env) ? 'macOS' : /Windows/.test(env) ? 'Windows' : 'Linux');
  const key = (mid, iso) => `${mid}|${iso}`;
  const verLabel = (mid, iso) => {
    const rep = D.reports[key(mid, iso)];
    const rr = S.rerun[key(mid, iso)];
    const r = dayRec(mid, iso);
    const vs = rep ? rep.versions.slice() : (r.report && r.report.v ? [{ v: r.report.v, at: r.report.at, why: r.report.v > 1 ? '迟到数据或更正后重算' : '定时生成（北京时间 09:00 触发）', by: '系统' }] : []);
    if (rr && rr.state === 'done') vs.unshift({ v: rr.v, at: `9月24日 ${rr.at}`, why: rr.why, by: '王清 的请求' });
    return vs;
  };

  /* ---------------- rerun simulation ---------------- */
  // 失败的日报经重试或重算完成后，按“已生成”展示（示例摘要）
  const resolveFailed = (mid, iso, v) => {
    const r = dayRec(mid, iso);
    if (!r.report || r.report.status !== 'failed') return false;
    r.report = { v, at: '9月24日 14:07', status: 'ready' };
    r.flags = (r.flags || []).filter((f) => f !== 'analysis-failed');
    r.summary = '把告警规则编辑器的条件编辑、表单校验和组件用例分到三个会话推进，类型检查通过；视觉回归尚未运行。';
    S.jobs['j-3012'] = 'done';
    return true;
  };
  const startRerun = (mid, iso, why) => {
    const k = key(mid, iso);
    const vs = verLabel(mid, iso);
    const next = (vs[0] ? vs[0].v : 0) + 1;
    S.rerun[k] = { state: 'queued', v: next, why };
    set({});
    setTimeout(() => { S.rerun[k].state = 'running'; set({}); }, 1400);
    setTimeout(() => {
      if (resolveFailed(mid, iso, next)) delete S.rerun[k];
      else { S.rerun[k].state = 'done'; S.rerun[k].at = '14:07'; S.ver[k] = next; }
      const onPage = S.r === 'member' && S.a[0] === mid && (S.a[2] || '2026-09-23') === iso;
      set({});
      // 静默成功：正在看这份日报时，版本号变化本身就是反馈；离开页面时才提示
      if (!onPage) toast(`${M[mid].name} · ${md(iso)} 日报已生成 v${next}${next > 1 ? '，旧版本保留' : ''}。`);
    }, 4200);
  };
  document.addEventListener('click', (ev) => {
    if (S.verMenu && !ev.target.closest('.vctl')) set({ verMenu: null });
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && S.verMenu) set({ verMenu: null });
  });
  onAct('rerun', (el) => {
    const { mid, iso } = el.dataset;
    if (S.rerun[key(mid, iso)] && S.rerun[key(mid, iso)].state !== 'done') return;
    startRerun(mid, iso, '手动请求重新分析');
  });
  onAct('ver', (el) => { S.ver[key(el.dataset.mid, el.dataset.iso)] = Number(el.dataset.v); set({ verMenu: null }); });
  onAct('ver-menu', (el) => set({ verMenu: S.verMenu === el.dataset.k ? null : el.dataset.k }));
  onAct('correct', (el) => set({ drawer: { type: 'correct', mid: el.dataset.mid, iso: el.dataset.iso, tab: el.dataset.tab || 'note' } }));
  onAct('correct-tab', (el) => set({ drawer: Object.assign({}, S.drawer, { tab: el.dataset.tab }) }));
  onAct('correct-submit', (form) => {
    const dr = S.drawer;
    const k = key(dr.mid, dr.iso);
    const fd = new FormData(form);
    let text;
    if (dr.tab === 'note') {
      text = String(fd.get('note') || '').trim();
      if (!text) { const f = form.querySelector('#c-note'); f.setAttribute('aria-invalid', 'true'); form.querySelector('#c-note-help').textContent = '说明为空：写下要补充的事实，例如“权限已于 9月24日 申请”。'; f.focus(); return; }
    } else {
      const ses = fd.get('ses'), th = fd.get('theme');
      text = `会话 ${ses} 归入「${th === 'new' ? '新工作主题' : (D.themes[th] ? D.themes[th].title : th)}」。`;
    }
    (S.notes[k] = S.notes[k] || []).push({ kind: dr.tab === 'note' ? '追加说明' : '更正归类', text, at: '14:06', by: '王清' });
    S.drawer = null;
    startRerun(dr.mid, dr.iso, dr.tab === 'note' ? '追加说明后重算' : '更正归类后重算');
  });
  onAct('theme', (el) => set({ drawer: { type: 'theme', id: el.dataset.id, mid: el.dataset.mid, iso: el.dataset.iso } }));

  /* ---------------- drawer ---------------- */
  const drawerWrap = (label, body) => `<div class="dscrim" data-act="drawer-bg"><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(label)}">${body}</aside></div>`;
  const weekDots = (days) => `<div class="wdots" aria-label="出现日期">${D.week.days.map((d) => `<span class="wdots__d ${days.includes(d) ? 'is-on' : ''} ${isToday(d) ? 'is-today' : ''}" title="${dayLabel(d)}">${WD[weekday(d)].slice(1)}</span>`).join('')}</div>`;
  const themeDrawer = (dr) => {
    const t = D.themes[dr.id];
    if (!t) return '';
    const rep = D.reports[key(dr.mid, dr.iso)];
    const v = S.ver[key(dr.mid, dr.iso)] || latestVer(dr.mid, dr.iso);
    const blk = rep ? (reportBlocks(dr.mid, dr.iso, v) || []).find((b) => b.theme === dr.id) : null;
    const r = dayRec(dr.mid, dr.iso);
    const daySes = t.sessions.filter((sid) => D.sessions[sid] && D.sessions[sid].date === dr.iso);
    return drawerWrap(t.title, `
      <header class="drawer__h">
        <div>
          <p class="drawer__k">${projChip(t.project)}<span>${esc(M[t.owner].name)}</span>${themeStatus(t)}</p>
          <h2 class="drawer__t serif">${esc(t.title)}</h2>
        </div>
        <button type="button" class="iconbtn" data-act="drawer-close" aria-label="关闭" data-autofocus>${icon('x')}</button>
      </header>
      <div class="drawer__b">
        <p class="drawer__brief">${esc(t.brief)}</p>
        <p class="drawer__lbl">本周出现</p>
        ${weekDots(t.days)}
        ${t.oldContext ? notice('neutral', 'branch', `包含接入前开始的旧会话（${md(t.oldContext)}），早期上下文按原始日期归期。`) : ''}
        <p class="drawer__lbl">${dayLabel(dr.iso)}</p>
        ${blk ? itemsDl(blk) : r.state === 'today' ? notice('info', 'live', `今日进行中，日报 ${r.report.at} 生成。`) : (r.report && r.report.status === 'failed') ? notice('crit', 'alert', `日报生成失败：${r.report.error}。原文可正常查看。`) : `<p class="muted">${esc(r.summary || '该日只有摘要级内容。')}</p>`}
        ${statLine(r.stats)}
        <p class="drawer__lbl">会话</p>
        <div class="slist">${(daySes.length ? daySes : t.sessions).map((sid) => sesLink(sid, { date: !daySes.length })).join('')}</div>
      </div>
      <footer class="drawer__f">
        <a class="btn btn--primary" href="#member.${dr.mid}.day.${dr.iso}" data-go="member.${dr.mid}.day.${dr.iso}">打开${md(dr.iso)}日报</a>
        <a class="btn btn--quiet" href="#member.${dr.mid}.week.W39" data-go="member.${dr.mid}.week.W39">看整周</a>
      </footer>`);
  };
  const correctDrawer = (dr) => {
    const m = M[dr.mid];
    const vs = verLabel(dr.mid, dr.iso);
    const daySes = Object.entries(D.sessions).filter(([, s]) => s.member === dr.mid && s.date === dr.iso);
    const note = dr.tab === 'note';
    return drawerWrap('追加说明与更正', `
      <header class="drawer__h">
        <div><p class="drawer__k">${avatar(m, 'sm')}<span>${esc(m.name)} · ${dayLabel(dr.iso)} 日报${vs[0] ? ' v' + vs[0].v : ''}</span></p><h2 class="drawer__t">追加说明与更正</h2></div>
        <button type="button" class="iconbtn" data-act="drawer-close" aria-label="关闭">${icon('x')}</button>
      </header>
      <div class="tabs" role="tablist" aria-label="更正类型">
        <button type="button" role="tab" class="tabs__b" aria-selected="${note}" data-act="correct-tab" data-tab="note" ${note ? 'data-autofocus' : ''}>${icon('note')}追加说明</button>
        <button type="button" role="tab" class="tabs__b" aria-selected="${!note}" data-act="correct-tab" data-tab="classify" ${!note ? 'data-autofocus' : ''}>${icon('tag')}更正归类</button>
      </div>
      <form class="drawer__b form" data-submit="correct-submit" novalidate>
        ${note ? `
          <div class="field">
            <label for="c-note">说明</label>
            <textarea id="c-note" name="note" rows="5" aria-describedby="c-note-help" placeholder="沙箱权限已于 9月24日 提交申请。"></textarea>
            <p class="help" id="c-note-help">以你的名义追加到报告，并触发重新生成；原始会话不会被修改。</p>
          </div>` : `
          <div class="field">
            <label for="c-ses">会话</label>
            <select id="c-ses" name="ses">${daySes.map(([sid, s]) => `<option value="${sid}">${sid} · ${s.start}–${s.end} · ${esc(s.title)}</option>`).join('') || '<option value="—">该日没有会话</option>'}</select>
          </div>
          <div class="field">
            <label for="c-theme">归入工作主题</label>
            <select id="c-theme" name="theme">${Object.entries(D.themes).filter(([, t]) => t.owner === dr.mid).map(([id, t]) => `<option value="${id}">${esc(t.title)} · ${esc(D.projects[t.project].name)}</option>`).join('')}<option value="new">新建工作主题…</option></select>
            <p class="help">归类只影响阅读组织，不改变采集范围；记录修改人与时间，旧版本保留。</p>
          </div>`}
        <div class="form__f">
          <button type="submit" class="btn btn--primary">保存并重新生成</button>
          <button type="button" class="btn btn--quiet" data-act="drawer-close">取消</button>
        </div>
      </form>`);
  };
  window.SkyDrawer = (dr) => (dr.type === 'theme' ? themeDrawer(dr) : dr.type === 'correct' ? correctDrawer(dr) : '');

  /* ---------------- member page (员工日/周工作) ---------------- */
  const stageTrack = (stage, issue) => `<span class="stages" role="img" aria-label="接入进度：${D.clientStages.slice(0, stage).join('、') || '未安装'}${issue === 'trust' ? '；待完成宿主信任' : ''}${issue === 'gap' ? '；今日有采集缺口' : ''}">${D.clientStages.map((label, i) => {
    let cls = i < stage ? 'is-done' : '';
    if (issue === 'trust' && i === stage) cls = 'is-warn';
    if (issue === 'gap' && i === D.clientStages.length - 1) cls = 'is-crit';
    return `<span class="stages__n ${cls}" title="${label}"></span>`;
  }).join('')}</span>`;
  const stageLabel = (c) => (c.issue === 'trust' ? '已安装 · 待信任' : c.issue === 'gap' ? '已上传 · 今日有缺口' : D.clientStages[c.stage - 1] || '未安装');
  const coverage = (m) => `<ul class="cov">${m.devices.map((d) => `
      <li class="cov__d ${d.offline ? 'is-off' : ''}">
        <p class="cov__n">${esc(d.name)}</p>
        <p class="cov__e">${esc(d.env)}</p>
        <ul class="cov__cl">${d.clients.map((c) => `<li><span>${esc(c.c)}</span>${stageTrack(c.stage, c.issue)}<span class="cov__s ${c.issue ? 'is-' + c.issue : ''}">${stageLabel(c)}</span></li>`).join('')}</ul>
        <p class="cov__sync">${d.offline ? icon('offline') : icon('refresh')}最近同步 ${esc(d.lastSync)} · 本机积压 ${esc(d.backlog)}</p>
      </li>`).join('')}</ul>`;

  const peopleStrip = (mid, mode, arg) => `<nav class="people" aria-label="切换员工">${D.members.map((m) => {
    const to = mode === 'profile' ? `member.${m.id}` : `member.${m.id}.${mode}.${arg}`;
    return `<a class="people__i ${m.id === mid ? 'is-on' : ''}" href="#${to}" data-go="${to}" ${m.id === mid ? 'aria-current="page"' : ''}>${avatar(m, 'sm')}<span>${esc(m.name)}</span></a>`;
  }).join('')}</nav>`;

  const dayStrip = (mid, iso) => `<div class="dstrip" role="group" aria-label="选择日期（${D.week.label}）">${D.week.days.map((d) => {
    const r = dayRec(mid, d);
    const fut = isFuture(d);
    const mark = r.report && r.report.status === 'ready' ? `v${latestVer(mid, d) || r.report.v}` : r.state === 'today' ? '今天' : r.report && r.report.status === 'failed' ? '失败' : r.state === 'none' ? '无活动' : '';
    const cls = ['dstrip__d', d === iso ? 'is-sel' : '', isToday(d) ? 'is-today' : '', fut ? 'is-future' : '', r.report && r.report.status === 'ready' ? 'has-rep' : ''].join(' ');
    return fut ? `<span class="${cls}" aria-disabled="true"><span class="dstrip__w">${WD[weekday(d)]}</span><span class="dstrip__n num">${dnum(d)}</span><span class="dstrip__s">&nbsp;</span></span>`
      : `<a class="${cls}" href="#member.${mid}.day.${d}" data-go="member.${mid}.day.${d}" data-k="ds-${d}" ${d === iso ? 'aria-current="date"' : ''}><span class="dstrip__w">${WD[weekday(d)]}</span><span class="dstrip__n num">${dnum(d)}</span><span class="dstrip__s">${mark || '&nbsp;'}</span></a>`;
  }).join('')}</div>`;

  const versionControl = (mid, iso) => {
    const vs = verLabel(mid, iso);
    if (!vs.length) return '';
    const k = key(mid, iso);
    const cur = S.ver[k] || vs[0].v;
    const curRow = vs.find((x) => x.v === cur) || vs[0];
    return `<div class="vctl">
        <button type="button" class="btn btn--quiet" data-act="ver-menu" data-k="${k}" aria-expanded="${S.verMenu === k}" aria-haspopup="true">${icon('file')}日报 v${cur} · ${esc(curRow.at.replace('9月24日 ', ''))}${icon('chev-d')}</button>
        ${S.verMenu === k ? `<div class="pop" role="menu" aria-label="报告版本">${vs.map((x) => `
          <button type="button" role="menuitemradio" aria-checked="${x.v === cur}" class="pop__i" data-act="ver" data-mid="${mid}" data-iso="${iso}" data-v="${x.v}">
            <span class="pop__t">v${x.v}${x.v === vs[0].v ? ' · 当前' : ''}</span><span class="pop__d">${esc(x.at)} · ${esc(x.why)}</span></button>`).join('')}</div>` : ''}
      </div>`;
  };

  const themeSection = (blk, mid, iso, opts) => {
    const t = D.themes[blk.theme];
    const pid = blk.unclassified ? 'unclassified' : t.project;
    const title = blk.unclassified ? '未归类的材料' : t.title;
    return `<section class="theme">
      <header class="theme__h">
        <h2 class="theme__t serif">${esc(title)}</h2>
        <p class="theme__m">${projChip(pid)}${t ? `<span>跨 ${t.days.length} 天 · ${t.sessions.length} 个会话</span>${themeStatus(t)}` : ''}</p>
      </header>
      ${blk.unclassified ? notice('neutral', 'folder', `工作目录无法可靠对应到项目，保留为未归类，会话不会被丢弃。<button type="button" class="linkbtn" data-act="correct" data-mid="${mid}" data-iso="${iso}" data-tab="classify">更正归类</button>`) : ''}
      ${itemsDl(blk, { markAdded: opts.markAdded })}
      <p class="theme__s"><span class="muted">本日会话</span>${blk.sessions.map((sid) => sesLink(sid)).join('')}</p>
    </section>`;
  };

  const historyList = (mid, iso) => {
    const vs = verLabel(mid, iso);
    const m = M[mid];
    const cors = D.corrections.filter((c) => c.target.includes(m.name) && c.target.includes(md(iso)));
    const mine = S.notes[key(mid, iso)] || [];
    if (!vs.length && !cors.length && !mine.length) return '<p class="muted">还没有报告版本。</p>';
    return `<ol class="hist">
      ${mine.map((n) => `<li class="hist__i"><span class="hist__dot is-me"></span><p><b>${esc(n.by)}</b> ${esc(n.kind)} · 9月24日 ${esc(n.at)}</p><p class="muted">${esc(n.text)}</p></li>`).join('')}
      ${vs.map((x) => `<li class="hist__i"><span class="hist__dot"></span><p><b>v${x.v}</b> · ${esc(x.at)}</p><p class="muted">${esc(x.why)}</p></li>`).join('')}
      ${cors.map((c) => `<li class="hist__i"><span class="hist__dot is-me"></span><p><b>${esc(c.by)}</b> ${esc(c.kind)} · ${esc(c.at)}</p><p class="muted">${esc(c.text)} ${esc(c.result)}</p></li>`).join('')}
    </ol>`;
  };

  const evidenceBar = (evc) => {
    const tot = evc.obs + evc.claim + evc.infer + evc.gap;
    if (!tot) return '<p class="muted">没有证据引用。</p>';
    const seg = (k) => (evc[k] ? `<span class="evbar__s evbar__s--${k}" style="--w:${(evc[k] / tot * 100).toFixed(1)}%"></span>` : '');
    return `<div class="evbar" role="img" aria-label="证据构成：工具结果 ${evc.obs}，声称 ${evc.claim}，模型推断 ${evc.infer}，材料不足 ${evc.gap}">${seg('obs')}${seg('claim')}${seg('infer')}${seg('gap')}</div>
      <ul class="evbar__lg">
        <li><span class="sw sw--obs"></span>工具结果<b class="num">${evc.obs}</b></li>
        <li><span class="sw sw--claim"></span>声称<b class="num">${evc.claim}</b></li>
        <li><span class="sw sw--infer"></span>模型推断<b class="num">${evc.infer}</b></li>
        <li><span class="sw sw--gap"></span>材料不足<b class="num">${evc.gap}</b></li>
      </ul>`;
  };

  const rawSessions = (mid, iso) => {
    const list = Object.entries(D.sessions).filter(([, s]) => s.member === mid && s.date === iso);
    if (!list.length) return '';
    return `<section class="block"><h2 class="block__h">已收到的会话原文</h2>
      <ul class="rawlist">${list.map(([sid, s]) => `<li><a class="rawlist__i" href="#session.${sid}" data-go="session.${sid}">
        <span class="mono">${sid}</span><span class="rawlist__t">${esc(s.title)}</span><span class="muted">${s.start}–${s.end} · ${esc(s.agent)}</span>${integPill(s.integrity)}</a></li>`).join('')}</ul></section>`;
  };

  const memberDay = (m, iso) => {
    const mid = m.id;
    const r = dayRec(mid, iso);
    const k = key(mid, iso);
    const rep = D.reports[k];
    const vs = verLabel(mid, iso);
    const vLatest = vs[0] ? vs[0].v : null;
    const vSel = S.ver[k] || vLatest;
    const rr = S.rerun[k];
    const notes = [];
    const flags = r.flags || [];
    if (rr && rr.state !== 'done') notes.push(notice('info', 'refresh', `重新分析${rr.state === 'queued' ? '排队中' : '生成中'}（${esc(rr.why)}）。完成后生成 v${rr.v}，当前版本在此期间保持可读。`));
    if (r.state === 'today') notes.push(notice('info', 'live', `今天的活动仍在同步。日报将于 <b>${r.report.at}</b> 生成；下方只有已收到原文的统计，没有分析结论。`));
    if (flags.includes('offline')) notes.push(notice('neutral', 'offline', `设备自 ${r.offlineSince} 起离线。离线期间的材料保存在本机队列，恢复连接后补传；相关日报届时会重新生成并保留旧版本。`));
    if (flags.includes('gap')) notes.push(notice('crit', 'alert', `采集缺口：${esc(r.gap)}。缺口期间的材料无法补回，已在会话中标记；编码没有被阻止。`));
    if (flags.includes('trust-pending')) notes.push(notice('warn', 'shield', `覆盖不完整：Codex Desktop（ZHAO-DESKTOP）已安装但未完成信任，该客户端的活动没有被采集。<a class="linkbtn" href="#devices" data-go="devices">查看诊断</a>`));
    if (flags.includes('late-data')) notes.push(notice('info', 'refresh', `迟到数据：${esc(r.report.late)}。`));
    if (flags.includes('old-context')) notes.push(notice('neutral', 'branch', `本日继续了接入前开始的旧会话 <a class="linkbtn mono" href="#session.s-2c90" data-go="session.s-2c90">s-2c90</a>（9月2日）。早期 198 个事件已完整同步供阅读，按原始日期归期，不计入本日活动。`));
    if (r.report && r.report.status === 'failed') notes.push(notice('crit', 'alert', `日报生成失败：${esc(r.report.error)}，${esc(r.report.retry)}。原文、统计和导出不受影响。<a class="linkbtn" href="#ops" data-go="ops">在分析与运行中处理</a>`));
    if (vSel && vLatest && vSel !== vLatest) notes.push(notice('info', 'file', `正在查看 v${vSel}（${esc((vs.find((x) => x.v === vSel) || {}).at || '')}）。当前版本为 v${vLatest}。<button type="button" class="linkbtn" data-act="ver" data-mid="${mid}" data-iso="${iso}" data-v="${vLatest}">回到当前版本</button>`));

    let body = '';
    if (r.state === 'future') body = empty('clock', '这一天还没有到', '日报在次日北京时间 09:00 生成。');
    else if (r.state === 'none') body = empty('none', '无活动', `设备在线（最近心跳 ${esc(r.heartbeat || '—')}），这一天没有产生 Agent 会话。平台不推断原因，“无活动”与设备离线、待信任和采集缺口分开显示。`);
    else if (r.state === 'today' || (r.report && r.report.status === 'failed')) {
      body = `${rawSessions(mid, iso)}
        <section class="block"><h2 class="block__h">工作主题（待分析）</h2>
          <ul class="tlist">${(r.themes || []).map((x) => { const t = D.themes[x.id]; return `<li><button type="button" class="tlist__i" data-act="theme" data-id="${x.id}" data-mid="${mid}" data-iso="${iso}">${projChip(t.project)}<span class="serif">${esc(t.title)}</span><span class="muted">依据会话标题与前几日报告预归类</span></button></li>`; }).join('')}</ul>
        </section>`;
    } else if (rep) {
      const blocks = reportBlocks(mid, iso, Math.min(vSel, Math.max(...Object.keys(rep.body).map(Number)))) || [];
      const myNotes = (S.notes[k] || []).filter(() => vSel > (rep.versions[0].v));
      body = `
        <section class="lead">
          <p class="lead__m">${pill('neutral', '模型总结', 'infer')}<span>日报 v${vSel} · ${esc((vs.find((x) => x.v === vSel) || vs[0]).at)} · 分析快照 a-2213 · Claude Code → 千问按量接口</span></p>
          <p class="lead__t serif">${esc(r.summary)}</p>
        </section>
        ${myNotes.length ? `<section class="block"><h2 class="block__h">人工补充</h2><ul class="hnotes">${myNotes.map((n) => `<li>${icon('note')}<span><b>${esc(n.by)}</b> ${esc(n.kind)} · 9月24日 ${esc(n.at)}：${esc(n.text)}</span></li>`).join('')}</ul></section>` : ''}
        ${evLegend()}
        ${blocks.map((b) => themeSection(b, mid, iso, { markAdded: vSel >= 2 && rep.versions.length > 1 })).join('')}`;
    } else {
      body = `
        <section class="lead">
          <p class="lead__m">${pill('neutral', '模型总结', 'infer')}<span>日报 v${vSel || r.report.v} · ${esc(r.report.at)}</span></p>
          <p class="lead__t serif">${esc(r.summary || '')}</p>
        </section>
        ${(r.themes || []).map((x) => { const t = D.themes[x.id]; const ses = t.sessions.filter((sid) => D.sessions[sid] && D.sessions[sid].date === iso); return `
          <section class="theme"><header class="theme__h"><h2 class="theme__t serif">${esc(t.title)}</h2><p class="theme__m">${projChip(t.project)}<span>跨 ${t.days.length} 天 · ${t.sessions.length} 个会话</span>${themeStatus(t)}</p></header>
          <p class="theme__brief">${esc(t.brief)}</p>
          <p class="theme__s"><span class="muted">本日会话</span>${ses.map((sid) => sesLink(sid)).join('')}</p></section>`; }).join('')}
        <p class="protonote">${icon('info')}原型示例：这一天只提供摘要级内容；完整的目标 / 行动 / 结果 / 阻塞与证据见 9月23日。</p>`;
    }

    const canRerun = r.report && (r.report.status === 'ready' || r.report.status === 'failed');
    return {
      actions: canRerun ? `
        <button type="button" class="btn btn--quiet" data-act="correct" data-mid="${mid}" data-iso="${iso}" data-tab="note">${icon('note')}追加说明</button>
        <button type="button" class="btn btn--quiet" data-act="correct" data-mid="${mid}" data-iso="${iso}" data-tab="classify">${icon('tag')}更正归类</button>
        <button type="button" class="btn btn--secondary" data-act="rerun" data-mid="${mid}" data-iso="${iso}" ${rr && rr.state !== 'done' ? 'aria-disabled="true"' : ''}>${icon('refresh')}${rr && rr.state !== 'done' ? '重算进行中' : '请求重新分析'}</button>` : '',
      main: `${notes.join('')}${body}`,
      side: `
        <section class="side__s"><h2 class="side__h">活动统计</h2>${statCells(r.stats)}<p class="side__n">确定性计算；指标名悬停可见定义。不含评分、排名或工时。</p></section>
        <section class="side__s"><h2 class="side__h">事件活跃区间</h2>${ruler(r.stats && r.stats.intervals)}</section>
        ${rep ? `<section class="side__s"><h2 class="side__h">证据构成</h2>${evidenceBar(rep.evidence)}</section>` : ''}
        <section class="side__s"><h2 class="side__h">设备覆盖</h2>${coverage(m)}</section>
        <section class="side__s"><h2 class="side__h">报告历史</h2>${historyList(mid, iso)}</section>`
    };
  };

  const memberWeek = (m, wk) => {
    const mid = m.id;
    if (wk === 'W38') {
      const w = D.weekly[mid];
      return {
        actions: '',
        main: `
          <section class="lead">
            <p class="lead__m">${w.v ? pill('neutral', '周报 v1', 'file') : pill('neutral', '无周报', 'none')}<span>W38 · 9月14日—20日${w.v ? ' · ' + esc(w.at) + ' 生成（周一 09:00 触发）' : ''}</span></p>
            <p class="lead__t serif">${esc(w.lead)}</p>
          </section>
          ${w.items.length ? `<ul class="wk-items">${w.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <p class="protonote">${icon('info')}原型示例：W38 周报只提供摘要级内容。</p>`,
        side: `<section class="side__s"><h2 class="side__h">设备覆盖</h2>${coverage(m)}</section>`
      };
    }
    const days = D.week.days;
    const owned = Object.entries(D.themes).filter(([, t]) => t.owner === mid && t.days.some((d) => days.includes(d)));
    const bars = owned.map(([id, t]) => {
      const idx = days.map((d, i) => (t.days.includes(d) ? i : -1)).filter((i) => i >= 0);
      const runs = [];
      idx.forEach((i) => { const last = runs[runs.length - 1]; if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]); });
      return `<div class="gantt__row" role="row">
        <span class="gantt__name" role="rowheader"><i class="dot" data-tone="${tone(t.project)}"></i><span class="serif">${esc(t.title)}</span></span>
        ${days.map((d, i) => `<span class="gantt__cell ${isToday(d) ? 'is-today' : ''} ${isFuture(d) ? 'is-future' : ''}" style="grid-column:${i + 2}" role="cell"></span>`).join('')}
        ${runs.map(([a, b]) => `<a class="gantt__bar ${t.status === 'blocked' && b === idx[idx.length - 1] ? 'is-blocked' : ''}" data-tone="${tone(t.project)}" style="grid-column:${a + 2} / ${b + 3}" href="#member.${mid}.day.${days[b]}" data-go="member.${mid}.day.${days[b]}" title="${esc(t.title)} · ${md(days[a])}${a !== b ? '—' + md(days[b]) : ''}" aria-label="${esc(t.title)}，${md(days[a])}${a !== b ? '至' + md(days[b]) : ''}，打开${md(days[b])}日报">${t.oldContext && a === idx[0] ? '<span class="gantt__old">← 9月2日起</span>' : ''}${t.status === 'blocked' && b === idx[idx.length - 1] ? icon('alert') : ''}</a>`).join('')}
      </div>`;
    }).join('');
    const recs = days.map((d) => dayRec(mid, d)).filter((r) => r.stats);
    const sum = (f) => recs.reduce((a, r) => a + (r.stats[f] || 0), 0);
    const tinKnown = recs.reduce((a, r) => a + (r.stats.tin || 0), 0);
    const unk = recs.reduce((a, r) => a + (r.stats.unknownTokens || 0) + (r.stats.tin == null ? 0 : 0), 0);
    const activeDays = recs.filter((r) => r.stats.sessions > 0).length;
    const nexts = [];
    Object.entries(D.reports).filter(([k]) => k.startsWith(mid + '|')).forEach(([, rep]) => (rep.body[rep.versions[0].v] || []).forEach((b) => (b.next || []).forEach((it) => nexts.push(it))));
    return {
      actions: '',
      main: `
        ${notice('info', 'clock', `本周尚未结束。周报将于 <b>9月28日（周一）09:00</b> 生成；下方按已发布的日报汇集，不是周报结论。`)}
        ${window.SkyReports ? window.SkyReports.memberProfile(mid) : ''}
        <section class="block">
          <h2 class="block__h">本周工作主题</h2>
          <div class="gantt" role="table" aria-label="本周工作主题与出现日期">
            <div class="gantt__row gantt__row--head" role="row"><span class="gantt__name" role="columnheader">工作主题</span>${days.map((d, i) => `<span class="gantt__day ${isToday(d) ? 'is-today' : ''}" style="grid-column:${i + 2}" role="columnheader">${WD[weekday(d)].slice(1)}<b class="num">${dnum(d)}</b></span>`).join('')}</div>
            ${bars || `<p class="muted">本周没有工作主题。</p>`}
          </div>
          <p class="side__n">条形覆盖主题出现的日期；点击进入该日日报。跨会话、跨日期的主题合并为一行。</p>
        </section>
        <section class="block">
          <h2 class="block__h">待继续事项</h2>
          ${nexts.length ? `<ul class="rows__plain">${nexts.map((it) => `<li><span>${esc(it.t)}</span><span class="rows__ev">${(it.ev || []).map(evBadge).join('')}</span></li>`).join('')}</ul>` : '<p class="muted">已发布的日报中没有待继续事项。</p>'}
        </section>
        <section class="block">
          <h2 class="block__h">上周</h2>
          <a class="rowlink" href="#member.${mid}.week.W38" data-go="member.${mid}.week.W38">${icon('file')}<span>W38 周报 · ${esc(D.weekly[mid].at)}</span><span class="muted">${esc(D.weekly[mid].lead)}</span>${icon('arrow')}</a>
        </section>`,
      side: `
        <section class="side__s"><h2 class="side__h">本周至今</h2>
          <dl class="stats">
            <div class="stats__row"><dt title="有会话的天数，截至今天">活跃天数</dt><dd class="num">${activeDays} / 4</dd></div>
            <div class="stats__row"><dt>会话</dt><dd class="num">${sum('sessions')}</dd></div>
            <div class="stats__row"><dt>用户轮次</dt><dd class="num">${sum('turns')}</dd></div>
            <div class="stats__row"><dt>工具调用</dt><dd class="num">${sum('tools')}</dd></div>
            <div class="stats__row"><dt title="仅累计已上报用量的会话">Token 输入（已知部分）</dt><dd class="num">${U.fmtTok(tinKnown)}${unk ? ` <span class="unk">+${unk} 个会话未知</span>` : ''}</dd></div>
          </dl>
          <p class="side__n">并发会话的活跃区间不相加；本页不显示工时。</p>
        </section>
        <section class="side__s"><h2 class="side__h">设备覆盖</h2>${coverage(m)}</section>`
    };
  };

  register('member', (a) => {
    const P = window.SkyProfile;
    if (!a[0] && P) return P.index();                           // #member → 员工一览
    const mid = M[a[0]] ? a[0] : 'lin-yue';
    const m = M[mid];
    const mode = a[1] === 'week' ? 'week' : a[1] === 'day' ? 'day' : 'profile';
    const lastSync = m.devices.map((d) => d.lastSync).filter((x) => /\d/.test(x)).sort().pop() || '—';
    const modeSeg = `<div class="seg" role="group" aria-label="查看方式">
          <a class="seg__b ${mode === 'profile' ? 'is-on' : ''}" href="#member.${mid}" data-go="member.${mid}" ${mode === 'profile' ? 'aria-current="true"' : ''}>画像</a>
          <a class="seg__b ${mode === 'day' ? 'is-on' : ''}" href="#member.${mid}.day.2026-09-23" data-go="member.${mid}.day.2026-09-23" ${mode === 'day' ? 'aria-current="true"' : ''}>日报</a>
          <a class="seg__b ${mode === 'week' ? 'is-on' : ''}" href="#member.${mid}.week.W39" data-go="member.${mid}.week.W39" ${mode === 'week' ? 'aria-current="true"' : ''}>周视图</a>
        </div>`;
    const head = (actions) => pageHead({
      crumbs: `<a href="#member" data-go="member">员工</a><span>/</span><span>${esc(m.name)}</span>`,
      title: `${avatar(m, 'lg')}<span>${esc(m.name)}</span>`,
      sub: `${esc(m.role)} · ${m.devices.length} 台设备 · 最近同步 ${esc(lastSync)} · ${md(m.joined)} 接入`,
      actions
    });
    if (mode === 'profile' && P) return `${peopleStrip(mid, 'profile')}${head('')}<div class="ctrl">${modeSeg}${P.controls()}</div>${P.body(mid)}`;
    const iso = mode === 'day' ? (D.week.days.includes(a[2]) ? a[2] : '2026-09-23') : null;
    const wk = mode === 'week' ? (a[2] === 'W38' ? 'W38' : 'W39') : null;
    const view = mode === 'day' ? memberDay(m, iso) : memberWeek(m, wk);
    return `
      ${peopleStrip(mid, mode, mode === 'day' ? iso : wk)}
      ${head(view.actions)}
      <div class="ctrl">
        ${modeSeg}
        ${mode === 'day' ? dayStrip(mid, iso) : `<div class="seg" role="group" aria-label="选择周">
            <a class="seg__b ${wk === 'W38' ? 'is-on' : ''}" href="#member.${mid}.week.W38" data-go="member.${mid}.week.W38">W38 · 9月14日—20日</a>
            <a class="seg__b ${wk === 'W39' ? 'is-on' : ''}" href="#member.${mid}.week.W39" data-go="member.${mid}.week.W39">W39 · 本周</a></div>`}
        ${mode === 'day' ? versionControl(mid, iso) : ''}
      </div>
      <div class="split">
        <div class="split__main">${view.main}</div>
        <aside class="side" aria-label="统计与覆盖">${view.side}</aside>
      </div>`;
  });

  /* ---------------- projects ---------------- */
  const projSessions = (pid, days) => Object.entries(D.sessions).filter(([, s]) => s.project === pid && (!days || days.includes(s.date)));
  register('project', (a) => {
    const pid = a[0] && D.projects[a[0]] ? a[0] : null;
    if (!pid) {
      return `${pageHead({ title: '项目', sub: '按工作目录与仓库识别，用于组织阅读。项目归类不决定采集范围：所有项目的会话都会被采集。' })}
        <ul class="plist">${Object.entries(D.projects).map(([id, p]) => {
          const ses = projSessions(id, D.week.days);
          const people = [...new Set(ses.map(([, s]) => s.member))];
          const th = Object.values(D.themes).filter((t) => t.project === id && t.days.some((d) => D.week.days.includes(d)));
          const last = ses.map(([, s]) => s.date).sort().pop();
          return `<li><a class="plist__i" href="#project.${id}" data-go="project.${id}">
            <span class="plist__sw" data-tone="${p.tone}" aria-hidden="true"></span>
            <span class="plist__n"><b>${esc(p.name)}</b><span class="mono">${esc(p.repo)}</span></span>
            <span class="plist__p">${people.map((mid) => avatar(M[mid], 'sm')).join('')}</span>
            <span class="plist__c num">本周 ${th.length} 个主题 · ${ses.length} 个会话</span>
            <span class="plist__l">${last ? '最近 ' + md(last) : '本周无会话'}</span>
            ${icon('chev-r')}</a></li>`;
        }).join('')}</ul>`;
    }
    const p = D.projects[pid];
    const ses = projSessions(pid).sort((x, y) => (y[1].date + y[1].start).localeCompare(x[1].date + x[1].start));
    const people = [...new Set(ses.map(([, s]) => s.member))];
    const th = Object.entries(D.themes).filter(([, t]) => t.project === pid);
    return `${pageHead({
      crumbs: '<a href="#project" data-go="project">项目</a><span>/</span><span>' + esc(p.name) + '</span>',
      title: `<span class="ttl-sw" data-tone="${p.tone}" aria-hidden="true"></span><span>${esc(p.name)}</span>`,
      sub: `<span class="mono">${esc(p.repo)}</span>`
    })}
      ${pid === 'unclassified' ? notice('neutral', 'folder', '这些会话的工作目录无法可靠对应到项目。它们照常存档和分析，已认证用户可以在员工日报中更正归类。') : ''}
      <section class="block"><h2 class="block__h">参与员工</h2>
        <div class="chips">${people.map((mid) => { const n = ses.filter(([, s]) => s.member === mid).length; return `<a class="person" href="#member.${mid}.week.W39" data-go="member.${mid}.week.W39">${avatar(M[mid], 'sm')}<span>${esc(M[mid].name)}</span><span class="muted num">${n} 个会话</span></a>`; }).join('') || '<p class="muted">暂无。</p>'}</div>
      </section>
      <section class="block"><h2 class="block__h">工作主题</h2>
        <ul class="tlist tlist--wide">${th.map(([id, t]) => `<li><a class="tlist__i" href="#member.${t.owner}.day.${t.days.filter((d) => !isFuture(d)).slice(-1)[0]}" data-go="member.${t.owner}.day.${t.days.filter((d) => !isFuture(d)).slice(-1)[0]}">
          <span class="serif tlist__t">${esc(t.title)}</span>
          <span class="tlist__o">${avatar(M[t.owner], 'sm')}${esc(M[t.owner].name)}</span>
          <span class="muted num">${md(t.days[0])}${t.days.length > 1 ? '—' + md(t.days[t.days.length - 1]) : ''} · ${t.sessions.length} 个会话</span>
          ${themeStatus(t)}</a></li>`).join('') || '<li class="muted">W38 的会话尚未形成工作主题（仅在报告中汇总）。</li>'}</ul>
      </section>
      <section class="block"><h2 class="block__h">会话</h2>${sessionTable(ses)}</section>`;
  });

  /* ---------------- sessions ---------------- */
  const sessionTable = (list) => `<div class="tblwrap"><table class="tbl">
      <thead><tr><th scope="col">日期</th><th scope="col">员工</th><th scope="col">会话</th><th scope="col">项目</th><th scope="col">Agent</th><th scope="col" class="r">事件</th><th scope="col">完整性</th></tr></thead>
      <tbody>${list.map(([sid, s]) => `<tr>
        <td class="num nowrap">${md(s.date)} ${s.start}</td>
        <td class="nowrap">${avatar(M[s.member], 'xs')}${esc(M[s.member].name)}</td>
        <td><a class="tbl__link" href="#session.${sid}" data-go="session.${sid}"><span class="mono">${sid}</span>${esc(s.title)}</a>${s.late ? `<span class="tag tag--info">${esc(s.late)}</span>` : ''}${s.oldContext ? '<span class="tag">继续旧会话</span>' : ''}${s.parent ? '<span class="tag">子会话</span>' : ''}</td>
        <td class="nowrap">${projChip(s.project)}</td>
        <td class="nowrap">${esc(s.agent)}</td>
        <td class="num r">${s.events}</td>
        <td class="nowrap">${integPill(s.integrity)}</td></tr>`).join('')}</tbody></table></div>`;
  onAct('ses-agent', (el) => set({ sessFilter: Object.assign({}, S.sessFilter, { agent: el.dataset.v }) }));
  onAct('ses-member', (el) => set({ sessFilter: Object.assign({}, S.sessFilter, { member: el.value }) }));
  register('sessions', () => {
    const f = S.sessFilter;
    const list = Object.entries(D.sessions)
      .filter(([, s]) => (f.agent === 'all' || s.agent === f.agent) && (f.member === 'all' || s.member === f.member))
      .sort((x, y) => (y[1].date + y[1].start).localeCompare(x[1].date + x[1].start));
    const agents = ['all', 'Claude Code CLI', 'Codex CLI', 'Codex Desktop'];
    return `${pageHead({ title: '会话', sub: '所有已存档会话。原件保存全部可获得的对话、工具记录与会话内代码变更；缺口会被标出。' })}
      <div class="ctrl">
        <div class="seg" role="group" aria-label="按 Agent 筛选">${agents.map((a) => `<button type="button" class="seg__b ${f.agent === a ? 'is-on' : ''}" aria-pressed="${f.agent === a}" data-act="ses-agent" data-v="${a}" data-k="sa-${a}">${a === 'all' ? '全部' : a}</button>`).join('')}</div>
        <div class="field field--inline"><label for="ses-m">员工</label>
          <select id="ses-m" data-change="ses-member"><option value="all">全部员工</option>${D.members.map((m) => `<option value="${m.id}" ${f.member === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
        <p class="muted num">${list.length} 个会话</p>
      </div>
      ${sessionTable(list)}`;
  });

  /* ---------------- session detail ---------------- */
  const synthTimeline = (sid) => {
    const s = D.sessions[sid];
    const refs = new Map();
    Object.values(D.reports).forEach((rep) => Object.values(rep.body).flat().forEach((b) => ROWS.forEach(([k]) => (b[k] || []).forEach((it) => (it.ev || []).forEach((e) => {
      if (e.s === sid && !refs.has(e.e)) refs.set(e.e, { it, e });
    })))));
    const nums = [...refs.keys()].sort((x, y) => x - y);
    const t0 = toMin(s.start), t1 = /\d/.test(s.end) ? toMin(s.end) : t0 + 120;
    const at = (n) => { const m = Math.round(t0 + (t1 - t0) * Math.min(1, n / Math.max(s.events, 1))); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`; };
    const evs = [];
    if (s.oldContext) evs.push({ kind: 'old', text: `接入前开始的旧会话 · ${md(s.oldContext.from)} · ${s.oldContext.events} 个事件。已完整同步供阅读，按原始日期归期，不计入 ${md(s.date)} 的活动。` });
    let prev = s.oldContext ? s.oldContext.events : 0;
    if (!nums.length) {
      evs.push({ n: prev + 1, t: at(1), kind: 'user', text: `${s.title}` });
      evs.push({ fold: `#${prev + 2}–#${s.events}`, count: s.events - prev - 1, note: '原型示例：此会话未提供事件节选' });
      return { evs, synthetic: true };
    }
    nums.forEach((n) => {
      if (n - prev > 1) evs.push({ fold: `#${prev + 1}–#${n - 1}`, count: n - prev - 1, note: '阅读视图已折叠' });
      const { it, e } = refs.get(n);
      if (e.k === 'claim' && e.who !== 'agent') evs.push({ n, t: at(n), kind: 'user', text: it.t });
      else if (e.k === 'claim') evs.push({ n, t: at(n), kind: 'agent', text: it.t, unverified: it.unverified });
      else if (e.k === 'obs') evs.push({ n, t: at(n), kind: 'tool', tool: 'Bash', cmd: e.t, out: ['（原型示例：输出节选未提供）'], lines: 1 });
      else evs.push({ n, t: at(n), kind: 'gap', range: `#${n}`, text: it.t });
      prev = n;
    });
    if (s.events > prev) evs.push({ fold: `#${prev + 1}–#${s.events}`, count: s.events - prev, note: '阅读视图已折叠' });
    return { evs, synthetic: true };
  };
  const hlq = (text, q) => {
    const t = esc(text);
    if (!q) return t;
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? t : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
  };
  const evText = (e) => [e.text, e.cmd, (e.out || []).join(' '), e.file, (e.diff || []).map((d) => d[1]).join(' '), e.title, e.result].filter(Boolean).join(' ');
  const citedBy = (sid, n) => {
    const out = [];
    Object.entries(D.reports).forEach(([k, rep]) => {
      const v = rep.versions[0].v;
      (rep.body[v] || []).forEach((b) => ROWS.forEach(([rk]) => (b[rk] || []).forEach((it) => (it.ev || []).forEach((e) => { if (e.s === sid && (n == null || e.e === n)) out.push({ k, v, it }); }))));
    });
    return out;
  };
  const renderEvent = (e, sid, anchor, q) => {
    if (e.fold) return `<li class="tl__fold"><span>${icon('layers')}${esc(e.fold)} · ${e.count} 个事件 · ${esc(e.note)}</span><button type="button" class="linkbtn" data-act="sess-view" data-v="raw">在原件中查看</button></li>`;
    if (e.kind === 'old') return `<li class="tl__old">${icon('branch')}<span>${esc(e.text)}</span></li>`;
    const cited = anchor === e.n;
    const cites = cited ? citedBy(sid, e.n) : [];
    const head = (ico, who) => `<p class="tl__who">${icon(ico)}${who}</p>`;
    let inner = '';
    if (e.kind === 'user') inner = `${head('person', '用户')}<p class="tl__txt">${hlq(e.text, q)}</p>`;
    else if (e.kind === 'agent') inner = `${head('bot', 'Agent')}<p class="tl__txt">${hlq(e.text, q)}</p>${e.unverified ? `<p class="tl__flag">${icon('quote')}Agent 自述：会话中没有对应的工具结果，报告中标为“未验证”。</p>` : ''}`;
    else if (e.kind === 'tool') {
      const k = `${sid}#${e.n}`;
      const open = S.expanded[k];
      inner = `${head('terminal', `工具 · ${esc(e.tool)}`)}
        <pre class="code"><span class="code__cmd">$ ${hlq(e.cmd, q)}</span>
${(e.out || []).map((l) => hlq(l, q)).join('\n')}${e.big && open ? '\n<span class="muted">… 第 4–200 行（分页加载，原型示例）</span>' : ''}</pre>
        ${e.big ? `<p class="tl__big">${icon('file')}输出 ${e.lines.toLocaleString('zh-CN')} 行 · ${esc(e.size)} · 默认折叠，导出保留全文 <button type="button" class="linkbtn" data-act="expand" data-k="${esc(k)}">${open ? '收起' : '按页展开'}</button></p>` : ''}`;
    } else if (e.kind === 'edit') inner = `${head('diff', `代码变更 · <span class="mono">${esc(e.file)}</span>`)}<pre class="code code--diff">${e.diff.map(([t, l]) => `<span class="d d--${t}">${t === 'add' ? '+ ' : t === 'del' ? '- ' : ''}${hlq(l, q)}</span>`).join('\n')}</pre>`;
    else if (e.kind === 'compact') inner = `${head('compress', '上下文压缩')}<p class="tl__txt">${hlq(e.text, q)}</p>`;
    else if (e.kind === 'gap') inner = `${head('none', `材料缺口 · ${esc(e.range)}`)}<p class="tl__txt">${hlq(e.text, q)}</p>`;
    else if (e.kind === 'sub') {
      const k = `${sid}#sub${e.n}`;
      inner = `${head('branch', '子会话')}<p class="tl__txt"><span class="mono">${esc(e.id)}</span> · ${hlq(e.title, q)} · ${e.events} 个事件</p>
        <p class="tl__txt muted">返回结果：${hlq(e.result, q)}</p>
        <button type="button" class="linkbtn" data-act="expand" data-k="${esc(k)}">${S.expanded[k] ? '收起子会话' : '展开子会话'}</button>
        ${S.expanded[k] ? `<ol class="tl__sub"><li><span class="num">09:16:31</span> 子会话启动：在 billing/ 下查找 ts.date() 调用</li><li><span class="num">09:18:05</span> 工具 · Grep：3 处命中</li><li><span class="num">09:24:40</span> 读取 payout.py：已有 astimezone 换算</li><li class="muted">…另 11 个事件（原型示例）</li></ol>` : ''}`;
    }
    return `<li class="tl__e tl__e--${e.kind} ${cited ? 'is-cited' : ''}" id="ev-${e.n}">
      <div class="tl__meta"><span class="num">#${e.n}</span><span class="num">${esc(e.t)}</span></div>
      <div class="tl__body">${cited ? `<p class="tl__cite">${icon('obs')}引用位置${cites.length ? ' · 被 ' + cites.map((c) => `${esc(M[c.k.split('|')[0]].name)} ${md(c.k.split('|')[1])}日报 v${c.v}`).join('、') + ' 引用' : ''}</p>` : ''}${inner}</div>
    </li>`;
  };
  // 切换视图时去掉路由里的定位锚点（否则证据锚点会一直把视图固定在时间线）
  onAct('sess-view', (el) => { if (S.r === 'session' && S.a.length > 1) S.a = S.a.slice(0, 1); set({ sessView: el.dataset.v }); });
  onAct('expand', (el) => { S.expanded[el.dataset.k] = !S.expanded[el.dataset.k]; set({}); });
  onAct('sess-q', (el) => {
    S.sessQ = el.value;
    const list = document.getElementById('tl');
    if (!list || !list.dataset.sid) return;
    list.innerHTML = timelineInner(list.dataset.sid, null);
    const c = document.getElementById('tl-count'); if (c) c.textContent = matchCount(list.dataset.sid);
  });
  const tlCache = {};
  const tlFor = (sid) => tlCache[sid] || (tlCache[sid] = D.timeline[sid] ? { evs: D.timeline[sid].events, synthetic: false } : synthTimeline(sid));
  const matchCount = (sid) => {
    const q = S.sessQ.trim();
    if (!q) return '';
    const n = tlFor(sid).evs.filter((e) => !e.fold && evText(e).toLowerCase().includes(q.toLowerCase())).length;
    return `${n} 处命中`;
  };
  const timelineInner = (sid, anchor) => {
    const q = S.sessQ.trim();
    const evs = tlFor(sid).evs.filter((e) => (q ? !e.fold && e.kind !== 'old' && evText(e).toLowerCase().includes(q.toLowerCase()) : true));
    if (q && !evs.length) return `<li class="tl__none">没有找到“${esc(q)}”。检索只覆盖阅读视图中的事件，完整原文请在“原件”中查看或导出。</li>`;
    return evs.map((e) => renderEvent(e, sid, anchor, q)).join('');
  };
  register('session', (a) => {
    const sid = D.sessions[a[0]] ? a[0] : 's-7f3a';
    const s = D.sessions[sid];
    const m = M[s.member];
    const tl = D.timeline[sid];
    const anchor = a[1] && /^e\d+$/.test(a[1]) ? Number(a[1].slice(1)) : null;          // 证据位置 → 时间线
    const anchorM = a[1] && /^m\d+$/.test(a[1]) ? Number(a[1].slice(1)) : null;         // 对话位置 → 对话视图
    const view = anchor ? 'timeline' : anchorM ? 'chat' : (S.sessView === 'read' ? 'timeline' : S.sessView);
    const dev = DEV[s.device];
    const cites = citedBy(sid, null);
    const R = window.SkyReports;
    if (anchor) after(() => { const el = document.getElementById(`ev-${anchor}`); if (el) el.scrollIntoView({ block: 'center' }); });
    if (anchorM) after(() => { const el = document.getElementById(`m-${anchorM}`); if (el) el.scrollIntoView({ block: 'center' }); });
    const viewBtn = (v, label) => `<button type="button" class="seg__b ${view === v ? 'is-on' : ''}" aria-pressed="${view === v}" data-act="sess-view" data-v="${v}" data-k="sv-${v}">${label}</button>`;
    const snaps = tl ? tl.snapshots : [{ g: 'g1', at: `${md(s.date)} ${/\d/.test(s.end) ? s.end : D.now.time}`, note: '当前', state: s.integrity === 'syncing' ? '同步中' : '当前快照完整' }];
    const raw = tl ? tl.raw : [`{"type":"user","uuid":"e0001","timestamp":"${s.date}T..","message":{"role":"user","content":"${s.title}"}}`, '{"…":"原型示例：原件节选未提供"}'];
    return `${pageHead({
      crumbs: `<a href="#sessions" data-go="sessions">会话</a><span>/</span><span class="mono">${sid}</span>`,
      title: esc(s.title),
      sub: `<a class="linkbtn" href="#member.${m.id}.day.${s.date}" data-go="member.${m.id}.day.${s.date}">${esc(m.name)}</a> · ${esc(D.projects[s.project].name)} · ${esc(s.agent)} · ${esc(dev ? dev.name : '')} · ${dayLabel(s.date)} ${s.start}–${s.end}`,
      actions: `<a class="btn btn--primary" href="#recovery.${sid}" data-go="recovery.${sid}">${icon('restore')}找回此会话</a>`
    })}
      <div class="sesmeta">
        ${integPill(s.integrity)}${pill('neutral', `${s.events} 个事件`, 'layers')}${pill('neutral', `快照 ${snaps[snaps.length - 1].g}`, 'archive')}
        ${s.late ? pill('info', esc(s.late), 'refresh') : ''}${s.oldContext ? pill('neutral', `继续旧会话 · ${md(s.oldContext.from)}`, 'branch') : ''}${s.reclassified ? pill('info', '已更正归类', 'tag') : ''}
        ${tl ? `<span class="sesmeta__id">原生 ID <span class="mono">${esc(tl.nativeId)}</span></span><span class="sesmeta__id">来源时间 ${md(s.date)} ${s.start} · 服务器接收 ${esc(tl.received)}</span>` : ''}
      </div>
      ${s.integrity === 'gap' ? notice('crit', 'alert', `采集缺口：${esc(s.gap)}。缺口期间的事件没有进入存档，导出与恢复包会注明该缺口。`) : ''}
      ${s.integrity === 'partial' ? notice('warn', 'offline', '设备离线：已收到 12:30 之前的材料，其余部分在设备恢复连接后补传。') : ''}
      <div class="split split--ses">
        <section class="split__main" aria-label="会话内容">
          <div class="tl-tools">
            <div class="seg" role="group" aria-label="视图">${viewBtn('chat', '对话')}${viewBtn('timeline', '时间线')}${viewBtn('raw', '原件 JSONL')}</div>
            ${view === 'chat' ? `<button type="button" class="switch" role="switch" aria-checked="${!!S.showTools}" data-act="tools-toggle" data-k="tools-toggle"><span class="switch__t" aria-hidden="true"></span>显示工具调用</button>` : ''}
            ${view === 'timeline' ? `<div class="field field--search">${icon('search')}<label class="sr-only" for="sq">在本会话中搜索</label><input id="sq" type="search" value="${esc(S.sessQ)}" placeholder="在本会话中搜索" data-input="sess-q" autocomplete="off" /><span id="tl-count" class="muted num" aria-live="polite">${matchCount(sid)}</span></div>` : ''}
          </div>
          ${view === 'chat'
            ? `${D.timeline[sid] || ['s-2c90', 's-x118', 's-h230', 's-c517'].includes(sid) ? '' : `<p class="protonote">${icon('info')}原型示例：这段对话由会话元数据按模板生成；s-7f3a、s-2c90、s-x118、s-h230、s-c517 为手写示例。</p>`}${R.chat(sid, anchorM)}`
            : view === 'timeline'
              ? `${tlFor(sid).synthetic ? `<p class="protonote">${icon('info')}原型示例：此会话的时间线由报告引用位置生成，只包含被引用的事件。</p>` : ''}<ol class="tl" id="tl" data-sid="${sid}">${timelineInner(sid, anchor)}</ol>`
              : `<div class="rawview"><p class="rawview__h">${icon('archive')}快照 ${snaps[snaps.length - 1].g} · 原件只读 · 解析版本变化不会改变原件</p><ol class="rawview__l">${raw.map((l) => `<li><code>${esc(l)}</code></li>`).join('')}</ol></div>`}
        </section>
        <aside class="side" aria-label="会话数据与存档">
          ${R.sessionData(sid)}
          ${R.assemblyPanel(sid)}
          ${tl ? `<section class="side__s"><h2 class="side__h">本会话分析</h2>
            <dl class="kv"><div><dt>分析快照</dt><dd class="mono">${esc(tl.analysis.id)}</dd></div><div><dt>完成</dt><dd>${esc(tl.analysis.at)}</dd></div><div><dt>运行时</dt><dd>${esc(tl.analysis.runtime)}</dd></div><div><dt>模型接口</dt><dd>${esc(tl.analysis.provider)}</dd></div><div><dt>提示版本</dt><dd class="mono">${esc(tl.analysis.prompt)}</dd></div><div><dt>分段</dt><dd>${tl.analysis.segments} 段，按稳定证据位置切分</dd></div></dl>
            <p class="side__n">会话中的指令只作为分析材料，不会被执行；系统分析会话不计入员工活动。</p></section>` : ''}
          <section class="side__s"><h2 class="side__h">被报告引用</h2>
            ${cites.length ? `<ul class="citelist">${cites.map((c) => { const [mid, iso] = c.k.split('|'); return `<li><a href="#member.${mid}.day.${iso}" data-go="member.${mid}.day.${iso}">${esc(M[mid].name)} · ${md(iso)} 日报 v${c.v}</a><span class="muted">${esc(c.it.t)}</span></li>`; }).join('')}</ul>` : '<p class="muted">尚未被报告引用。</p>'}</section>
          <section class="side__s"><h2 class="side__h">快照与代次</h2>
            <ul class="snaps">${snaps.map((x) => `<li><span class="mono">${esc(x.g)}</span><span>${esc(x.at)} · ${esc(x.note)}</span><span class="muted">${esc(x.state)}</span></li>`).join('')}</ul>
            <p class="side__n">重写或截断产生新代次，旧代次不可变；服务器已收到的早期原件不会被压缩摘要替代。</p></section>
          <section class="side__s"><h2 class="side__h">谱系</h2>
            ${tl && tl.children.length ? `<ul class="snaps">${tl.children.map((c) => `<li>${icon('branch')}<span class="mono">${esc(c.id)}</span><span>${esc(c.title)} · ${c.events} 个事件</span></li>`).join('')}</ul>` : s.parent ? `<p>${icon('branch')}子会话，来源 <a class="linkbtn mono" href="#session.${s.parent}" data-go="session.${s.parent}">${s.parent}</a></p>` : '<p class="muted">没有关联的子会话或分支。</p>'}
            <p class="side__n">子会话与来源会话关联，活动不重复计算。</p></section>
        </aside>
      </div>`;
  });

  /* ---------------- recovery (booking-style flow) ---------------- */
  onAct('rec-member', (el) => set({ rec: Object.assign({}, S.rec, { member: el.dataset.v, session: null, step: 1, prepared: false, from: S.rec.from }) }));
  onAct('rec-date', (el) => set({ rec: Object.assign({}, S.rec, { date: el.dataset.v, session: null, prepared: false }) }));
  onAct('rec-session', (el) => set({ rec: Object.assign({}, S.rec, { session: el.dataset.v, prepared: false }) }));
  onAct('rec-step', (el) => set({ rec: Object.assign({}, S.rec, { step: Number(el.dataset.v), prepared: false }) }, { top: true }));
  onAct('rec-method', (el) => set({ rec: Object.assign({}, S.rec, { method: el.value || el.dataset.v, prepared: false }) }));
  onAct('rec-snap', (el) => set({ rec: Object.assign({}, S.rec, { snap: el.value, prepared: false }) }));
  onAct('rec-prepare', () => {
    set({ rec: Object.assign({}, S.rec, { preparing: true }) });
    setTimeout(() => set({ rec: Object.assign({}, S.rec, { preparing: false, prepared: true }) }), 1600);
  });
  onAct('rec-download', () => toast('原型未连接存储：真实环境中这里下载恢复包到本机隔离目录。'));

  const nativeFor = (s) => {
    const dev = DEV[s.device];
    const os = dev ? osFamily(dev.env) : 'Linux';
    const row = D.recovery.compat.find((c) => c.client === s.agent && (c.os === os || c.os.includes(os)));
    return { os, row: row || { native: 'pending', at: '未登记' } };
  };
  register('recovery', (a) => {
    if (a[0] && D.sessions[a[0]] && S.rec.from !== a[0]) {
      const s0 = D.sessions[a[0]];
      S.rec = { step: 2, member: s0.member, date: s0.date, session: a[0], method: nativeFor(s0).row.native === 'verified' ? 'native' : 'read', snap: 'current', prepared: false, from: a[0] };
    }
    const R = S.rec;
    const m = M[R.member];
    const s = R.session ? D.sessions[R.session] : null;
    const steps = ['选择会话', '选择方式', '校验与恢复'];
    const stepper = `<ol class="steps" aria-label="找回步骤">${steps.map((t, i) => {
      const n = i + 1;
      const st = n < R.step ? 'is-done' : n === R.step ? 'is-cur' : '';
      const can = n < R.step;
      return `<li class="steps__i ${st}" ${n === R.step ? 'aria-current="step"' : ''}>${can ? `<button type="button" class="steps__b" data-act="rec-step" data-v="${n}">` : '<span class="steps__b">'}<span class="steps__n">${n < R.step ? icon('check') : n}</span><span>${t}</span>${can ? '</button>' : '</span>'}</li>`;
    }).join('')}</ol>`;

    let body = '';
    if (R.step === 1) {
      const mSes = Object.entries(D.sessions).filter(([, x]) => x.member === R.member);
      const dates = new Set(mSes.map(([, x]) => x.date));
      const first = 2; // 2026-09-01 为周二 → 周一起始网格偏移 1
      const cells = [];
      for (let i = 0; i < first - 1; i++) cells.push('<span class="cal__d is-pad" aria-hidden="true"></span>');
      for (let d = 1; d <= 30; d++) {
        const iso = `2026-09-${String(d).padStart(2, '0')}`;
        const before = iso < m.joined;
        const fut = isFuture(iso);
        const has = dates.has(iso);
        const cls = ['cal__d', has ? 'has' : '', iso === R.date ? 'is-sel' : '', isToday(iso) ? 'is-today' : '', before ? 'is-before' : ''].join(' ');
        if (has && !fut) cells.push(`<button type="button" class="${cls}" data-act="rec-date" data-v="${iso}" data-k="cal-${iso}" aria-pressed="${iso === R.date}" aria-label="${dayLabel(iso)}，有存档会话"><span class="num">${d}</span></button>`);
        else cells.push(`<span class="${cls}" title="${before ? '接入前：未继续使用的旧会话不批量导入' : fut ? '尚未到达' : '没有存档会话'}"><span class="num">${d}</span></span>`);
      }
      const daySes = mSes.filter(([, x]) => x.date === R.date).sort((x, y) => x[1].start.localeCompare(y[1].start));
      body = `<div class="book">
        <section class="book__who" aria-label="员工">
          <p class="book__k">找回谁的会话</p>
          <div class="whopick" role="group" aria-label="选择员工">${D.members.map((x) => `<button type="button" class="whopick__i ${x.id === R.member ? 'is-on' : ''}" aria-pressed="${x.id === R.member}" data-act="rec-member" data-v="${x.id}" data-k="rm-${x.id}">${avatar(x, 'sm')}<span>${esc(x.name)}</span></button>`).join('')}</div>
          <dl class="kv kv--tight"><div><dt>接入日期</dt><dd>${md(m.joined)}</dd></div><div><dt>存档会话</dt><dd class="num">${mSes.length} 个</dd></div></dl>
          <p class="side__n">接入前、之后没有继续使用的旧会话不在存档中。继续使用过的旧会话会从开头完整同步，可以找回。</p>
        </section>
        <section class="book__cal" aria-label="选择日期">
          <div class="cal__head"><p class="cal__m">2026年9月</p><span class="muted">北京时间</span></div>
          <div class="cal__grid">${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<span class="cal__w" aria-hidden="true">${w}</span>`).join('')}${cells.join('')}</div>
          <p class="cal__lg"><span class="cal__key has"></span>有存档会话<span class="cal__key is-before"></span>接入前</p>
        </section>
        <section class="book__slots" aria-label="选择会话">
          <p class="book__k">${dayLabel(R.date)}</p>
          ${daySes.length ? `<ul class="slots">${daySes.map(([sid, x]) => `<li class="slots__li ${sid === R.session ? 'is-sel' : ''}">
            <button type="button" class="slot" data-act="rec-session" data-v="${sid}" aria-pressed="${sid === R.session}" data-k="slot-${sid}"><span class="slot__t num">${x.start}</span><span class="slot__d">${esc(x.title)}</span><span class="slot__a">${esc(x.agent)} · ${x.events} 个事件</span></button>
            ${sid === R.session ? `<button type="button" class="btn btn--primary slot__next" data-act="rec-step" data-v="2">下一步${icon('arrow')}</button>` : ''}</li>`).join('')}</ul>` : `<p class="muted">这一天没有存档会话。</p>`}
        </section>
      </div>`;
    } else if (s) {
      const nat = nativeFor(s);
      const tl = D.timeline[R.session];
      const snaps = tl ? tl.snapshots : [{ g: 'g1', at: `${md(s.date)} ${s.end}`, note: '当前', state: '当前快照完整' }];
      const natOK = nat.row.native === 'verified';
      const summary = `<div class="recsum">${avatar(M[s.member], 'sm')}<div><p><b>${esc(s.title)}</b> <span class="mono muted">${R.session}</span></p><p class="muted">${esc(M[s.member].name)} · ${esc(s.agent)} · ${nat.os} · ${dayLabel(s.date)} ${s.start}–${s.end} · ${s.events} 个事件</p></div>${integPill(s.integrity)}</div>`;
      if (R.step === 2) {
        body = `${summary}
          <div class="method" role="radiogroup" aria-label="找回方式">
            <label class="mopt ${R.method === 'read' ? 'is-on' : ''}"><input type="radio" name="method" value="read" data-change="rec-method" ${R.method === 'read' ? 'checked' : ''} />
              <span class="mopt__t">${icon('file')}完整可读导出</span>
              <span class="mopt__d">Markdown 阅读版、JSONL 原件、附件与材料清单、校验值。离开平台也能核查；大体积工具输出保留全文。</span>
              <span class="mopt__c">${pill('ok', '所有客户端可用', 'check')}</span></label>
            <label class="mopt ${R.method === 'native' ? 'is-on' : ''} ${natOK ? '' : 'is-off'}"><input type="radio" name="method" value="native" data-change="rec-method" ${R.method === 'native' ? 'checked' : ''} ${natOK ? '' : 'disabled aria-describedby="nat-why"'} />
              <span class="mopt__t">${icon('restore')}原生恢复包</span>
              <span class="mopt__d">在 ${esc(s.agent)} 中继续这段对话。包含来源版本、原件、必要关联材料、清单和哈希。</span>
              <span class="mopt__c">${natOK ? pill('ok', `${esc(s.agent)} · ${nat.os} 已验证（${esc(nat.row.at)}）`, 'check') : pill('warn', `${esc(s.agent)} · ${nat.os} 待验证`, 'clock')}</span>
              ${natOK ? '' : `<span class="mopt__why" id="nat-why">这一组合的原生续聊尚未通过试点验证，暂不提供恢复包；请先使用完整可读导出。Codex 原生恢复未通过前，首版不视为完整完成。</span>`}</label>
          </div>
          <section class="block"><h2 class="block__h">快照</h2>
            <div class="snappick" role="radiogroup" aria-label="选择快照">${snaps.slice().reverse().map((x, i) => `<label class="snappick__i"><input type="radio" name="snap" value="${i === 0 ? 'current' : x.g}" data-change="rec-snap" ${(R.snap === 'current' && i === 0) || R.snap === x.g ? 'checked' : ''} /><span class="mono">${esc(x.g)}</span><span>${esc(x.at)} · ${esc(x.note)}</span><span class="muted">${esc(x.state)}</span></label>`).join('')}</div>
          </section>
          <section class="block"><h2 class="block__h">已登记的恢复能力</h2>
            <div class="tblwrap"><table class="tbl tbl--compact"><thead><tr><th scope="col">客户端</th><th scope="col">系统</th><th scope="col">可读导出</th><th scope="col">原生续聊</th></tr></thead>
            <tbody>${D.recovery.compat.map((c) => `<tr class="${c.client === s.agent ? 'is-hit' : ''}"><td>${esc(c.client)}</td><td>${esc(c.os)}</td><td>${pill('ok', '可用', 'check')}</td><td>${c.native === 'verified' ? pill('ok', '已验证 · ' + esc(c.at), 'check') : pill('warn', '待验证', 'clock')}</td></tr>`).join('')}</tbody></table></div>
            <p class="side__n">示例状态；实际支持矩阵按 Agent、版本、系统与运行环境登记，以试点实测为准。</p>
          </section>
          <div class="form__f"><button type="button" class="btn btn--quiet" data-act="rec-step" data-v="1">${icon('chev-l')}返回</button><button type="button" class="btn btn--primary" data-act="rec-step" data-v="3" ${R.method === 'native' && !natOK ? 'disabled' : ''}>下一步${icon('arrow')}</button></div>`;
      } else {
        const native = R.method === 'native' && natOK;
        const nid = tl ? tl.nativeId : `${R.session.slice(2)}0000-0000-4000-8000-000000000000`;
        const target = `~/skynet-restore/${nid.slice(0, 8)}`;
        const cmd1 = `skynet restore ${R.session} --snapshot ${R.snap === 'current' ? snaps[snaps.length - 1].g : R.snap} --target ${target}`;
        const cmd2 = s.agent === 'Codex CLI' ? `cd ${target} && codex resume ${nid}` : `cd ${target} && claude --resume ${nid}`;
        const cmdRead = `skynet export ${R.session} --format markdown,jsonl --out ~/skynet-export/${R.session}`;
        body = `${summary}
          <ul class="checks">
            <li class="is-ok">${icon('check')}<span><b>材料完整性</b>清单中的分块均已持久化，SHA-256 校验通过</span></li>
            <li class="is-ok">${icon('check')}<span><b>来源版本</b>${esc(s.agent)} · ${esc(tl ? tl.agentVersion : '试点版本')}，与${native ? '恢复包' : '导出'}格式兼容</span></li>
            <li class="is-ok">${icon('check')}<span><b>目标位置隔离</b>默认写入 <span class="mono">${native ? target : '~/skynet-export/' + R.session}</span>，不覆盖正在使用的会话</span></li>
            ${s.integrity === 'gap-upstream' ? `<li class="is-warn">${icon('none')}<span><b>已知缺口</b>#58–#61 附件原件不可得（上游未提供），${native ? '恢复后该处为说明占位' : '导出中注明'}</span></li>` : ''}
            ${s.integrity === 'gap' ? `<li class="is-crit">${icon('alert')}<span><b>采集缺口</b>${esc(s.gap)}，该时段事件不在存档中</span></li>` : ''}
          </ul>
          <section class="block"><h2 class="block__h">${native ? '在原 Agent 中继续' : '导出命令'}</h2>
            <ol class="cmds">
              ${native ? `<li><p>下载并校验恢复包，解压到隔离目录</p><div class="cmd"><code>${esc(cmd1)}</code>${copyBtn(cmd1)}</div></li>
              <li><p>在 ${esc(s.agent)} 中继续原会话</p><div class="cmd"><code>${esc(cmd2)}</code>${copyBtn(cmd2)}</div></li>` : `<li><p>导出完整可读材料</p><div class="cmd"><code>${esc(cmdRead)}</code>${copyBtn(cmdRead)}</div></li>`}
            </ol>
          </section>
          ${notice('neutral', 'person', `历史归属：<b>${esc(M[s.member].name)}</b>。恢复后产生的新活动归属当前使用者（${esc(D.viewer.name)}），并与原会话谱系关联。`)}
          <p class="side__n">找回不包括代码工作区、依赖、运行进程或 Agent 登录状态。</p>
          <div class="form__f">
            <button type="button" class="btn btn--quiet" data-act="rec-step" data-v="2">${icon('chev-l')}返回</button>
            ${R.prepared ? `${pill('ok', `${native ? '恢复包' : '导出'}已准备 · 42.8 MB · SHA-256 3f9c…a1d0`, 'check')}<button type="button" class="btn btn--primary" data-act="rec-download">${icon('download')}下载</button>`
              : `<button type="button" class="btn btn--primary" data-act="rec-prepare" ${R.preparing ? 'aria-disabled="true" data-state="loading"' : ''}>${R.preparing ? '<span class="spin" aria-hidden="true"></span>正在准备…' : native ? '准备恢复包' : '准备导出'}</button>`}
          </div>`;
      }
    } else {
      body = empty('session', '还没有选择会话', '回到第 1 步，选择日期与会话。', `<button type="button" class="btn btn--primary" data-act="rec-step" data-v="1">选择会话</button>`);
    }
    return `${pageHead({ title: '会话找回', sub: '从服务器存档取回完整记录，或生成可在原 Agent 中继续对话的恢复包。恢复前校验材料，默认写入隔离位置。' })}
      ${stepper}${body}`;
  });

  /* ---------------- devices ---------------- */
  onAct('revoke', (el) => set({ confirmRevoke: el.dataset.dev }));
  onAct('revoke-cancel', () => set({ confirmRevoke: null }));
  onAct('revoke-do', (el) => { S.revoked[el.dataset.dev] = '9月24日 14:06 · 王清'; set({ confirmRevoke: null }); });
  register('devices', () => {
    const npm = 'npm i -g @corp/skynet';
    const setup = 'skynet setup';
    const status = 'skynet status';
    const mcpCC = 'claude mcp add --transport http skynet https://skynet.corp.internal/mcp';
    return `${pageHead({ title: '接入与设备', sub: '员工只提供一个个人授权值，完成一次初始化与宿主信任，之后照常使用 Claude Code CLI、Codex CLI 与 Codex Desktop。' })}
      <section class="block">
        <h2 class="block__h">接入步骤</h2>
        <ol class="onb">
          <li><span class="onb__n">1</span><div><p class="onb__t">取得个人授权值</p><p class="onb__d">在平台生成，只显示一次。通过本机受控输入绑定，不要粘贴进模型对话。</p></div></li>
          <li><span class="onb__n">2</span><div><p class="onb__t">安装</p><p class="onb__d">npm 全局安装，或从 Claude / Codex 插件市场安装 Skynet。两条入口共用同一后台与设备身份，无需重复安装。</p></div></li>
          <li><span class="onb__n">3</span><div><p class="onb__t">初始化</p><p class="onb__d">检测已安装的客户端、绑定员工身份、以当前用户注册后台，不需要管理员权限。</p></div></li>
          <li><span class="onb__n">4</span><div><p class="onb__t">宿主信任</p><p class="onb__d">按提示在各 Agent 中确认插件与 hooks；Codex Desktop 需要重启一次。</p></div></li>
          <li><span class="onb__n">5</span><div><p class="onb__t">首次采集</p><p class="onb__d">在任意项目开始一次会话，状态变为“已上传”即接入完成。</p></div></li>
        </ol>
        <div class="prereq">
          <div><p class="prereq__h">${icon('info')}开始前确认</p>
            <ul><li>npm 路径需要 Node 24 LTS</li><li>私有 npm 源或插件市场的下载权限</li><li>允许当前用户运行后台进程</li><li>本地安装与健康检查目标 2 分钟内（不含下载与宿主信任）</li></ul></div>
          <div class="cmds cmds--flat">
            <div class="cmd"><code>${npm}</code>${copyBtn(npm)}</div>
            <div class="cmd"><code>${setup}</code><span class="cmd__note">读取 SKYNET_KEY，或在终端中隐藏输入</span>${copyBtn(setup)}</div>
            <div class="cmd"><code>${status}</code><span class="cmd__note">按客户端显示接入进度</span>${copyBtn(status)}</div>
          </div>
        </div>
      </section>
      <section class="block">
        <h2 class="block__h">设备与客户端</h2>
        <p class="stagekey" aria-hidden="true">${D.clientStages.map((l, i) => `<span><i class="stages__n is-done"></i>${i + 1} ${l}</span>`).join('')}</p>
        <div class="fleet">${D.members.map((m) => `
          <div class="fleet__m">
            <p class="fleet__who">${avatar(m, 'sm')}<b>${esc(m.name)}</b><span class="muted">${m.devices.length} 个运行环境</span></p>
            ${m.devices.map((d) => {
              const rv = S.revoked[d.id];
              return `<div class="dev ${d.offline ? 'is-off' : ''} ${rv ? 'is-revoked' : ''}">
                <div class="dev__h"><p class="dev__n">${esc(d.name)}</p><p class="dev__e">${esc(d.env)} · ${esc(d.bg)}</p></div>
                <ul class="dev__cl">${d.clients.map((c) => `<li><span class="dev__c">${esc(c.c)}</span>${stageTrack(c.stage, c.issue)}<span class="cov__s ${c.issue ? 'is-' + c.issue : ''}">${stageLabel(c)}</span></li>`).join('')}</ul>
                <p class="dev__sync">${d.offline ? icon('offline') : icon('refresh')}最近同步 ${esc(d.lastSync)} · 本机未确认积压 ${esc(d.backlog)}</p>
                ${d.diag && !rv ? `<div class="diag"><p>${icon(d.clients.some((c) => c.issue === 'trust') ? 'shield' : d.offline ? 'offline' : 'alert')}<span>${esc(d.diag)}</span></p>${d.clients.some((c) => c.issue === 'trust') ? `<div class="cmd"><code>skynet doctor --client codex-desktop</code>${copyBtn('skynet doctor --client codex-desktop', '复制诊断命令')}</div>` : ''}</div>` : ''}
                <div class="dev__act">
                  ${rv ? pill('crit', `凭据已停用 · ${esc(rv)}`, 'ban') + '<span class="muted">后续上传与查询会被拒绝；已存档材料保留。重新接入需要新的授权值。</span>'
                    : S.confirmRevoke === d.id ? `<p class="confirm">停用 <b>${esc(d.name)}</b> 的设备凭据？该设备后续的上传会被拒绝，已存档材料保留。</p><button type="button" class="btn btn--danger btn--sm" data-act="revoke-do" data-dev="${d.id}" data-k="rv-${d.id}">停用凭据</button><button type="button" class="btn btn--quiet btn--sm" data-act="revoke-cancel">取消</button>`
                    : `<button type="button" class="btn btn--quiet btn--sm" data-act="revoke" data-dev="${d.id}" data-k="rv-${d.id}">${icon('ban')}停用凭据</button>`}
                </div>
              </div>`;
            }).join('')}
          </div>`).join('')}</div>
      </section>
      <section class="block">
        <h2 class="block__h">在 Agent 中查询（MCP）</h2>
        <p class="block__d">通过 HTTPS Streamable HTTP 连接，首次查询时登录个人账号。MCP 与 Web 使用同一份报告与证据；MCP 登录失败不影响自动采集。</p>
        <div class="cmds cmds--flat">
          <div class="cmd"><code>${mcpCC}</code>${copyBtn(mcpCC)}</div>
          <div class="cmd"><code>https://skynet.corp.internal/mcp</code><span class="cmd__note">Codex：在 MCP 配置中添加此地址（示例，以实测配置为准）</span>${copyBtn('https://skynet.corp.internal/mcp')}</div>
        </div>
      </section>`;
  });

  /* ---------------- ops ---------------- */
  onAct('job-retry', (el) => {
    const id = el.dataset.job;
    S.jobs[id] = 'running';
    set({});
    setTimeout(() => {
      resolveFailed('zhou-qihang', '2026-09-23', 1);
      S.jobs[id] = 'done';
      const onOps = S.r === 'ops';
      set({});
      if (!onOps) toast('周启航 · 9月23日 日报已生成 v1。');
    }, 2600);
  });
  const JOBST = { running: ['info', '运行中', 'live'], queued: ['neutral', '排队中', 'clock'], retrying: ['warn', '等待重试', 'refresh'], done: ['ok', '完成', 'check'], failed: ['crit', '失败', 'alert'] };
  register('ops', () => {
    const o = D.ops;
    const bud = o.usage.budget;
    const pct = Math.round(bud.used / bud.cap * 100);
    const volPct = Math.round(412 / 2048 * 100);
    return `${pageHead({ title: '分析与运行', sub: '分析与原件接收解耦：模型故障、超时或预算耗尽时，会话照常接收、查看与导出。' })}
      <div class="tiles">
        <section class="tile"><p class="tile__k">${icon('layers')}分析队列</p><p class="tile__v num">${o.queue.queued} 排队 · ${o.queue.running} 运行 · ${S.jobs['j-3012'] === 'done' ? 0 : o.queue.retrying} 等待重试</p><p class="tile__d">今日完成 ${o.queue.doneToday} 个作业 · ${esc(o.usage.concurrency)}</p></section>
        <section class="tile"><p class="tile__k">${icon('pulse')}今日模型用量</p><p class="tile__v num">输入 ${o.usage.tin} · 输出 ${o.usage.tout}</p><p class="tile__d"><span class="unk">${o.usage.unknownJobs} 个作业用量未知</span>，未计为 0</p>
          <div class="meter" role="img" aria-label="${esc(bud.note)}：已用 ${pct}%"><span style="--w:${pct}%"></span></div><p class="tile__d">${esc(bud.note)}：已用 ${bud.used.toLocaleString('zh-CN')} / ${bud.cap.toLocaleString('zh-CN')} ${bud.unit}</p></section>
        <section class="tile"><p class="tile__k">${icon('database')}原件存储</p><p class="tile__v num">${o.storage.raw} / ${o.storage.volume}</p>
          <div class="meter" role="img" aria-label="持久卷已用 ${volPct}%"><span style="--w:${volPct}%"></span></div><p class="tile__d">${esc(o.storage.perDay)} · 数据库 ${o.storage.db} · ${esc(o.storage.policy)}</p></section>
        <section class="tile"><p class="tile__k">${icon('archive')}备份与恢复演练</p>
          <ul class="bk">${o.backup.map((b) => `<li>${icon('check')}<span><b>${esc(b.what)}</b> ${esc(b.last)}</span><span class="muted">${esc(b.how)}</span></li>`).join('')}</ul></section>
      </div>
      <section class="block"><h2 class="block__h">分析作业</h2>
        <div class="tblwrap"><table class="tbl tbl--jobs">
          <thead><tr><th scope="col">作业</th><th scope="col">类型</th><th scope="col">范围</th><th scope="col">触发</th><th scope="col">状态</th><th scope="col">尝试</th><th scope="col">说明</th><th scope="col">用量</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead>
          <tbody>${D.jobs.map((j) => {
            const st = S.jobs[j.id] || j.state;
            const [t, l, i] = JOBST[st];
            return `<tr><td class="mono nowrap">${j.id}</td><td class="nowrap">${esc(j.kind)}</td><td class="nowrap">${esc(j.scope)}</td><td>${esc(j.trigger)}</td><td class="nowrap">${pill(t, l, i)}</td><td class="num nowrap">${esc(j.attempts)}</td><td>${st === 'done' && j.state === 'retrying' ? '手动重试成功 · 14:07' : esc(j.note)}</td><td class="nowrap">${esc(j.tokens)}</td>
              <td class="nowrap">${st === 'retrying' ? `<button type="button" class="btn btn--secondary btn--sm" data-act="job-retry" data-job="${j.id}" data-k="jr-${j.id}">${icon('refresh')}立即重试</button>` : ''}</td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="side__n">持久任务队列：短领取事务、租约与心跳、最多 3 次重试。旧作业结果不会覆盖较新的报告版本。</p>
      </section>
      <section class="block"><h2 class="block__h">分析更正记录</h2>
        <ol class="hist hist--wide">${D.corrections.map((c) => `<li class="hist__i"><span class="hist__dot is-me"></span><p><b>${esc(c.by)}</b> · ${esc(c.kind)} · ${esc(c.at)} · ${esc(c.target)}</p><p>${esc(c.text)}</p><p class="muted">${esc(c.result)}</p></li>`).join('')}</ol>
      </section>`;
  });
})();
