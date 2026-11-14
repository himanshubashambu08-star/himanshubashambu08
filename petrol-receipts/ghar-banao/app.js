/* Ghar Banao: the game UI. Stages: Zameen (map) → Naksha (plan) → Elevation → Interior → Ghar Dekho. */
'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const KEY = 'gharBanao.v1';
  const L = v => '₹' + Plan.fmtL(v);
  const STAGES = [
    { id: 'map', name: 'Zameen', sub: 'Plot chuno' },
    { id: 'plan', name: 'Naksha', sub: 'Kamre banao' },
    { id: 'elev', name: 'Elevation', sub: 'Bahar ka look' },
    { id: 'interior', name: 'Interior', sub: 'Andar sajao' },
    { id: 'view', name: 'Ghar Dekho', sub: '3D + report' },
  ];
  const TOOLS = [
    { id: 'select', icon: '✋', name: 'Chuno / Hilao' },
    { id: 'room', icon: '▭', name: 'Kamra banao' },
    { id: 'door', icon: '🚪', name: 'Darwaza' },
    { id: 'main', icon: '🏠', name: 'Main Darwaza' },
    { id: 'window', icon: '🪟', name: 'Khidki' },
    { id: 'erase', icon: '🧽', name: 'Mitao' },
    { id: 'pan', icon: '🤚', name: 'Naksha khiskao' },
  ];
  const OPW = { door: 3, main: 4, window: 4 };

  let S = null;
  const ui = { stage: 'map', view: '2d', floor: 0, tool: 'select', roomType: 'bedroom', furnType: null, sel: null, cam: null, camFor: '', mapSel: null, night: false, cut: 'follow', walk: false, bhk: 3, briefOpen: true };
  const undo = [], redo = [];

  // ---------- persistence ----------
  function load() {
    try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.S && d.S.v === 1) { S = d.S; ui.stage = d.stage || 'map'; ui.floor = 0; return true; } } catch (e) { /* private mode */ }
    return false;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ S, stage: ui.stage })); } catch (e) { /* ignore */ } }
  const brief = () => BRIEFS.find(b => b.id === S.brief) || BRIEFS[0];
  const budget = () => brief().budget;
  const wide = () => window.innerWidth >= 1000;
  const F = () => S.floors[ui.floor];

  function snapshot() { undo.push(JSON.stringify(S)); if (undo.length > 60) undo.shift(); redo.length = 0; }
  function mutate(fn, opt = {}) { snapshot(); fn(); changed(opt); }
  function changed(opt = {}) {
    save(); ui.floor = clamp(ui.floor, 0, S.floors.length - 1);
    if (opt.side !== false) renderSide();
    renderTop(); draw(); schedule3D();
  }
  function doUndo() { if (!undo.length) return toast('Undo karne ko kuch nahi'); redo.push(JSON.stringify(S)); S = JSON.parse(undo.pop()); ui.sel = null; changed(); }
  function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(S)); S = JSON.parse(redo.pop()); ui.sel = null; changed(); }

  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

  // ---------- top bar ----------
  function renderTop() {
    $('#stages').innerHTML = STAGES.map((s, i) => `<button class="stg ${ui.stage === s.id ? 'on' : ''} ${!S.plot && i > 0 ? 'locked' : ''}" data-act="stage" data-id="${s.id}" data-testid="stage-${s.id}"><b>${i + 1}</b><span>${s.name}<small>${s.sub}</small></span></button>`).join('');
    const c = Plan.cost(S), over = c.total > budget();
    $('#money').innerHTML = `<span class="mlab">Kharcha</span><b class="${over ? 'over' : ''}" data-testid="total">${L(c.total)}</b><span class="mlab">/ ${L(budget())}</span>`;
    $('#money').title = c.rows.map(r => `${r[0]}: ${L(r[1])}`).join('\n');
  }

  // ---------- side panels ----------
  const swatches = (list, cur, act) => `<div class="sw">${list.map(c => `<button class="swc ${c === cur ? 'on' : ''}" style="--c:${c}" data-act="${act}" data-v="${c}" aria-label="${c}"></button>`).join('')}</div>`;
  const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.name)}</option>`).join('');
  function briefCard() {
    const b = brief(); if (b.id === 'free') return `<div class="card brief"><div class="bh"><b>${esc(b.name)}</b><span class="tag">Free mode</span></div><p>${esc(b.story)}</p><button class="link" data-act="choose-brief">Client ka kaam lo →</button></div>`;
    const sc = Plan.score(S, budget(), b);
    return `<div class="card brief ${ui.briefOpen ? '' : 'closed'}"><button class="bh" data-act="brief-toggle"><b>📋 ${esc(b.name)}</b><span class="tag">${sc.met}/${sc.needs.length}</span></button>
      <div class="bb"><p class="who">${esc(b.who)}</p><p>“${esc(b.story)}”</p><ul class="needs">${sc.needs.map(n => `<li class="${n.ok ? 'ok' : ''}">${n.ok ? '✅' : '⬜'} ${esc(n.t)}</li>`).join('')}<li class="${Plan.cost(S).total <= b.budget ? 'ok' : ''}">${Plan.cost(S).total <= b.budget ? '✅' : '⬜'} Budget ${L(b.budget)} ke andar</li></ul>
      <button class="link" data-act="choose-brief">Doosra client chuno</button></div></div>`;
  }
  function checksHtml(limit = 99) {
    const ch = Plan.checks(S, budget());
    const ic = { bad: '❌', warn: '⚠️', ok: '✅', tip: '💡' };
    const order = { bad: 0, warn: 1, tip: 2, ok: 3 };
    const list = ch.slice().sort((a, b) => order[a.lvl] - order[b.lvl]);
    return `<ul class="checks" data-testid="checks">${list.slice(0, limit).map(c => `<li class="${c.lvl}" ${c.f != null ? `data-act="floor" data-f="${c.f}"` : ''}>${ic[c.lvl]} ${esc(c.t)}</li>`).join('')}${list.length > limit ? `<li class="more">…aur ${list.length - limit}</li>` : ''}</ul>`;
  }
  function plotSummary() {
    const P = S.plot; if (!P) return '';
    return `<div class="card plot-sum"><div class="ps-big">${Math.round(P.gaj)} <small>gaj</small></div><div>${P.w} × ${P.d} ft · ${P.w * P.d} sq ft<br>${facingName(P.facing)} facing ${P.id ? '· Plot ' + esc(P.id) : ''}</div></div>`;
  }
  const facingName = f => ({ N: 'North', E: 'East', S: 'South', W: 'West' }[f]);

  function renderSide() {
    const el = $('#side');
    const stage = ui.stage;
    let html = '';
    if (stage === 'map') html = sideMap();
    else if (stage === 'plan') html = sidePlan();
    else if (stage === 'elev') html = sideElev();
    else if (stage === 'interior') html = sideInterior();
    else html = sideView();
    const nextI = STAGES.findIndex(s => s.id === stage) + 1;
    if (nextI < STAGES.length && S.plot) html += `<button class="btn primary next" data-act="stage" data-id="${STAGES[nextI].id}" data-testid="next-stage">Aage: ${STAGES[nextI].name} →</button>`;
    const top = el.scrollTop; el.innerHTML = html; el.scrollTop = top;
  }

  function sideMap() {
    const p = ui.mapSel ? COLONY.plots.find(q => q.id === ui.mapSel) : null;
    let h = briefCard();
    h += `<h3>1. Zameen chuno</h3><p class="hint">Colony ke naksha mein kisi bhi plot pe tap karo. Road wali side = plot ka "facing". 1 gaj = 9 sq ft.</p>`;
    if (p) {
      const mine = S.plot && S.plot.id === p.id;
      h += `<div class="card plotcard" data-testid="plot-card"><div class="pc-head"><b>Plot ${p.id}</b>${p.corner ? '<span class="tag">Corner</span>' : ''}${p.nearPark ? '<span class="tag green">Park ke paas</span>' : ''}${p.mainRoad ? '<span class="tag">Main road</span>' : ''}</div>
        <div class="pc-grid"><div><small>Size</small><b>${p.gaj} gaj</b></div><div><small>Lambai × Chaudai</small><b>${p.wft} × ${p.dft} ft</b></div><div><small>Facing</small><b>${facingName(p.facing)}</b></div><div><small>Rate</small><b>₹${p.rate.toLocaleString('en-IN')}/gaj</b></div></div>
        <div class="pc-price">Keemat <b>${L(p.price)}</b></div>
        ${mine ? '<div class="okline">✅ Ye aapka plot hai</div>' : `<button class="btn primary" data-act="buy-plot" data-testid="buy-plot">Ye plot kharido</button>`}</div>`;
    }
    h += `<details class="card" ${S.plot && !S.plot.id ? 'open' : ''}><summary>✏️ Apne size ka plot (custom)</summary>
      <div class="form"><label>Kitne gaj?<input type="number" id="cg" min="25" max="2000" value="${S.plot && !S.plot.id ? Math.round(S.plot.gaj) : 100}" data-testid="custom-gaj"></label>
      <label>Saamne ki chaudai (ft)<input type="number" id="cw" min="10" max="120" value="${S.plot && !S.plot.id ? S.plot.w : 20}"></label>
      <label>Facing (road kis taraf)<select id="cf">${opts({ N: 'North', E: 'East', S: 'South', W: 'West' }, S.plot?.facing || 'E')}</select></label>
      <label>Rate ₹/gaj<input type="number" id="cr" min="1000" step="500" value="${S.plot && !S.plot.id ? S.plot.rate : 40000}"></label>
      <p class="hint" id="cinfo"></p><button class="btn" data-act="custom-plot" data-testid="custom-plot">Ye size lo</button></div></details>`;
    if (S.plot) h += `<h3>Aapka plot</h3>${plotSummary()}`;
    return h;
  }

  function sidePlan() {
    const P = S.plot, sb = S.setback;
    let h = briefCard();
    h += `<h3>2. Naksha banao</h3>${plotSummary()}`;
    h += `<div class="card"><div class="row"><b>Kitni manzil?</b><div class="stepper"><button data-act="floors-" data-testid="floors-minus">−</button><span data-testid="floor-count">${S.floors.length}</span><button data-act="floors+" data-testid="floors-plus">+</button></div></div>
      <div class="row"><span>Auto naksha</span><select data-ui="bhk">${opts(BHK_PRESETS, String(ui.bhk))}</select><button class="btn sm" data-act="auto-layout" data-testid="auto-layout">✨ Banao</button></div>
      <p class="hint">Auto Naksha se shuru karo, fir kamre hilao, bade-chhote karo.</p></div>`;
    h += `<div class="tools">${TOOLS.map(t => `<button class="tool ${ui.tool === t.id ? 'on' : ''}" data-act="tool" data-t="${t.id}" data-testid="tool-${t.id}" title="${t.name}"><span>${t.icon}</span>${t.name}</button>`).join('')}</div>`;
    if (ui.tool === 'room') h += `<div class="card"><b>Kaunsa kamra?</b><p class="hint">Fir naksha pe ungli/mouse se kheench ke banao.</p><div class="chips">${ROOM_ORDER.map(t => `<button class="chip ${ui.roomType === t ? 'on' : ''}" style="--c:${ROOM_TYPES[t].color}" data-act="rtype" data-t="${t}" data-testid="rtype-${t}">${esc(ROOM_TYPES[t].short)}</button>`).join('')}</div></div>`;
    if (['door', 'main', 'window'].includes(ui.tool)) h += `<div class="card hint">Deewar pe tap karo, ${ui.tool === 'window' ? 'khidki' : 'darwaza'} wahin lag jayega.</div>`;
    h += selPanel();
    h += `<div class="card"><b>Setback (khaali jagah, ft)</b><div class="grid4">${['front', 'back', 'left', 'right'].map(k => `<label>${{ front: 'Aage', back: 'Peeche', left: 'Left', right: 'Right' }[k]}<input type="number" min="0" max="30" value="${sb[k]}" data-set="setback.${k}"></label>`).join('')}</div>
      <div class="row"><span>Floor ki unchai</span><select data-set="floorH">${[9, 10, 11, 12].map(v => `<option ${S.floorH === v ? 'selected' : ''} value="${v}">${v} ft</option>`).join('')}</select></div>
      <div class="row wrap"><button class="btn sm" data-act="auto-open">🚪 Is floor ke darwaze-khidki auto</button>${ui.floor > 0 ? `<button class="btn sm" data-act="copy-below">⬇ Neeche wala floor copy karo</button>` : ''}</div></div>`;
    h += `<h3>Jaanch (Checks)</h3>${checksHtml(12)}`;
    return h;
  }

  function selPanel() {
    const sel = ui.sel; if (!sel) return '';
    if (sel.kind === 'room') {
      const r = F().rooms.find(x => x.id === sel.id); if (!r) return '';
      return `<div class="card selp" data-testid="room-panel"><div class="row"><b>Chuna hua kamra</b><button class="x" data-act="desel">✕</button></div>
        <label>Kamra<select data-room="type">${ROOM_ORDER.map(t => `<option value="${t}" ${t === r.type ? 'selected' : ''}>${esc(ROOM_TYPES[t].name)}</option>`).join('')}</select></label>
        <label>Naam<input data-room="name" value="${esc(r.name || '')}" placeholder="${esc(ROOM_TYPES[r.type].short)}"></label>
        <div class="grid4"><label>X<input type="number" data-room="x" value="${r.x}"></label><label>Y<input type="number" data-room="y" value="${r.y}"></label><label>Chaudai<input type="number" min="2" data-room="w" value="${r.w}"></label><label>Lambai<input type="number" min="2" data-room="d" value="${r.d}"></label></div>
        <p class="hint">${r.w} × ${r.d} ft = ${r.w * r.d} sq ft · disha: ${Plan.roomZone(S, r)}</p>
        <div class="row wrap"><button class="btn sm danger" data-act="del-sel" data-testid="delete">🗑 Hatao</button>${ui.floor < S.floors.length - 1 ? '<button class="btn sm" data-act="copy-up">⬆ Upar copy</button>' : ''}<button class="btn sm" data-act="dup-room">⧉ Duplicate</button></div></div>`;
    }
    if (sel.kind === 'open') {
      const o = F().open.find(x => x.id === sel.id); if (!o) return '';
      return `<div class="card selp"><div class="row"><b>${o.kind === 'window' ? 'Khidki' : o.kind === 'main' ? 'Main Darwaza' : 'Darwaza'}</b><button class="x" data-act="desel">✕</button></div>
        <label>Chaudai (ft)<select data-open="w">${[2, 2.5, 3, 3.5, 4, 5, 6, 8].map(v => `<option ${o.w === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Type<select data-open="kind">${opts({ door: 'Darwaza', main: 'Main Darwaza', window: 'Khidki' }, o.kind)}</select></label>
        <button class="btn sm danger" data-act="del-sel">🗑 Hatao</button></div>`;
    }
    if (sel.kind === 'furn') {
      const it = F().furn.find(x => x.id === sel.id); if (!it) return '';
      return `<div class="card selp" data-testid="furn-panel"><div class="row"><b>${esc(FURNITURE[it.type].name)}</b><button class="x" data-act="desel">✕</button></div>
        <div class="row wrap"><button class="btn sm" data-act="rot" data-testid="rotate">⟳ Ghumao</button><button class="btn sm" data-act="dup-furn">⧉ Ek aur</button><button class="btn sm danger" data-act="del-sel">🗑 Hatao</button></div>
        <p class="hint">Kheench ke jagah badlo. ${FURNITURE[it.type].price ? L(FURNITURE[it.type].price) : ''}</p></div>`;
    }
    return '';
  }

  function sideElev() {
    const E = S.elev;
    let h = briefCard();
    h += `<h3>3. Elevation (bahar ka look)</h3><p class="hint">3D model ko ghuma ke dekho. Saamne wali deewar sabse zaroori hai.</p>`;
    h += `<div class="card"><b>Deewar ka rang</b>${swatches(EXT_PAINTS, E.wall, 'ext-wall')}<b>Accent (chhajja, band, pillar)</b>${swatches(EXT_PAINTS, E.accent, 'ext-accent')}</div>`;
    h += `<div class="card"><label>Cladding<select data-set="elev.clad" data-testid="clad">${opts(CLADDINGS, E.clad)}</select></label>${E.clad !== 'none' ? `<label>Kahan lagaye<select data-set="elev.cladWhere">${opts(CLAD_WHERE, E.cladWhere)}</select></label>` : ''}
      <label>Chhat<select data-set="elev.roof" data-testid="roof">${opts(ROOFS, E.roof)}</select></label>
      <label>Balcony railing<select data-set="elev.rail">${opts(RAILINGS, E.rail)}</select></label></div>`;
    h += `<div class="card"><b>Khidki-darwaze ka frame</b>${swatches(['#2F363C', '#FFFFFF', '#6E4B33', '#8E9AA3', '#1F3A5F', '#B08D57'], E.frame, 'frame')}
      <label class="check"><input type="checkbox" data-set="elev.boundary" ${E.boundary ? 'checked' : ''}> Boundary wall + gate</label>
      ${E.boundary ? `<b>Gate ka rang</b>${swatches(['#2F363C', '#6E4B33', '#B08D57', '#1F3A5F', '#7D2E2E', '#F4EFE6'], E.gate, 'gate')}` : ''}</div>`;
    h += `<div class="card"><div class="row wrap"><button class="btn sm" data-act="preset" data-p="front">Saamne se</button><button class="btn sm" data-act="preset" data-p="corner">Kone se</button><button class="btn sm" data-act="preset" data-p="back">Peeche se</button><button class="btn sm" data-act="preset" data-p="top">Upar se</button></div>
      <div class="row"><button class="btn sm" data-act="night" data-testid="night">${ui.night ? '☀️ Din' : '🌙 Raat'} ka view</button></div></div>`;
    h += `<p class="hint">Cladding kharcha: ${L(Plan.cost(S).clad)}</p>`;
    return h;
  }

  function sideInterior() {
    let h = briefCard();
    h += `<h3>4. Interior (andar sajao)</h3><p class="hint">Kamre pe tap karo: farsh aur rang chuno. Neeche se furniture chuno aur naksha pe tap karke rakho.</p>`;
    h += `<div class="tools t3"><button class="tool ${ui.tool === 'select' ? 'on' : ''}" data-act="tool" data-t="select"><span>✋</span>Chuno</button><button class="tool ${ui.tool === 'erase' ? 'on' : ''}" data-act="tool" data-t="erase"><span>🧽</span>Mitao</button><button class="tool ${ui.tool === 'pan' ? 'on' : ''}" data-act="tool" data-t="pan"><span>🤚</span>Khiskao</button></div>`;
    const sel = ui.sel;
    const r = sel && sel.kind === 'room' ? F().rooms.find(x => x.id === sel.id) : null;
    if (sel && sel.kind === 'furn') h += selPanel();
    if (r) {
      const fk = r.floor || DEFAULT_FLOOR[r.type];
      h += `<div class="card selp" data-testid="interior-room"><div class="row"><b>${esc(r.name || ROOM_TYPES[r.type].name)}</b><button class="x" data-act="desel">✕</button></div>
        <b>Farsh (Flooring)</b><div class="floors">${Object.entries(FLOORINGS).map(([k, v]) => `<button class="fl ${k === fk ? 'on' : ''}" data-act="flooring" data-v="${k}"><i style="--c:${v.color};--l:${v.line}" class="pat-${v.pattern}"></i>${esc(v.name)}<small>+₹${v.rate}/sqft</small></button>`).join('')}</div>
        ${r.type !== 'lawn' ? `<b>Deewar ka rang</b>${swatches(WALL_PAINTS, r.paint || DEFAULT_WALL[r.type], 'paint')}` : ''}
        <div class="row wrap"><button class="btn sm" data-act="auto-furn-room">✨ Is kamre mein auto furniture</button><button class="btn sm" data-act="clear-furn-room">Khaali karo</button></div></div>`;
    }
    const rec = r ? FURNITURE_ORDER.filter(k => FURNITURE[k].rooms.includes(r.type)) : [];
    const list = rec.length ? [...rec, ...FURNITURE_ORDER.filter(k => !rec.includes(k))] : FURNITURE_ORDER;
    h += `<div class="card"><div class="row"><b>Furniture</b><button class="btn sm" data-act="auto-furn-all" data-testid="auto-furn">✨ Poora ghar sajao</button></div>
      <div class="furns">${list.map(k => `<button class="fu ${ui.tool === 'furn' && ui.furnType === k ? 'on' : ''} ${rec.includes(k) ? 'rec' : ''}" data-act="furn" data-t="${k}" data-testid="furn-${k}"><i style="--c:${FURNITURE[k].color}"></i>${esc(FURNITURE[k].name)}</button>`).join('')}</div></div>`;
    const c = Plan.cost(S);
    h += `<p class="hint">Furniture: ${L(c.furn)} · Flooring: ${L(c.floor)}</p>`;
    return h;
  }

  function sideView() {
    const b = brief(), sc = Plan.score(S, budget(), b), c = Plan.cost(S), s = sc.stats;
    const v = s.vastu;
    let h = `<h3>5. Ghar Dekho</h3>`;
    h += `<div class="card result" data-testid="result"><div class="stars">${[0, 1, 2].map(i => `<span class="${i < sc.stars ? 'on' : ''}">★</span>`).join('')}</div>
      <div class="score"><b data-testid="score">${sc.score}</b>/100 Architect score</div>
      <p>${sc.stars === 3 ? 'Shandaar! Client ne mithai baanti 🎉' : sc.stars === 2 ? 'Achha ghar hai, thodi kami hai.' : sc.stars === 1 ? 'Chal jayega, par client khush nahi.' : 'Abhi bahut kaam baaki hai.'}</p></div>`;
    h += `<div class="card"><div class="row wrap"><button class="btn primary sm" data-act="walk" data-testid="walk">${ui.walk ? '🛰 Bahar se dekho' : '🚶 Andar ghumo'}</button><button class="btn sm" data-act="night">${ui.night ? '☀️ Din' : '🌙 Raat'}</button><button class="btn sm" data-act="photo">📸 Photo</button></div>
      ${ui.walk ? '<p class="hint">Mobile: neeche ke buttons se chalo. Computer: W A S D / arrow keys. Screen kheench ke idhar-udhar dekho. Seedhi pe "Upar" dabao.</p>' : ''}</div>`;
    if (b.needs.length) h += briefCard();
    h += `<div class="card"><b>Kharcha (Estimate)</b><table class="tbl">${c.rows.map(r => `<tr><td>${esc(r[0])}</td><td>${L(r[1])}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td>${L(c.total)}</td></tr><tr><td>Budget</td><td class="${c.total > budget() ? 'over' : 'good'}">${L(budget())}</td></tr></table>
      <label>Construction quality<select data-set="quality">${Object.entries(QUALITY).map(([k, q]) => `<option value="${k}" ${k === S.quality ? 'selected' : ''}>${q.name} (₹${q.rate}/sqft)</option>`).join('')}</select></label><p class="hint">${esc(QUALITY[S.quality].note)}</p></div>`;
    h += `<div class="card"><b>Area</b><table class="tbl">${S.floors.map((_, f) => `<tr><td>${Plan.FLOOR_NAME(f)}</td><td>${s.builtup[f]} sq ft</td></tr>`).join('')}<tr class="tot"><td>Kul built-up</td><td>${s.totalBuilt} sq ft</td></tr><tr><td>Plot</td><td>${Math.round(s.gaj)} gaj</td></tr></table>
      <p class="hint">${s.beds} bedroom · ${s.count.bath} bathroom · ${s.count.kitchen} kitchen · ${S.floors.length} manzil</p></div>`;
    h += `<div class="card"><b>Vastu (${sc.vastu}/4)</b><ul class="needs"><li class="${v.kitchenSE ? 'ok' : ''}">${v.kitchenSE ? '✅' : '⬜'} Rasoi South-East (agni kon)</li><li class="${v.poojaNE ? 'ok' : ''}">${v.poojaNE ? '✅' : '⬜'} Pooja North-East (ishan)</li><li class="${v.masterSW ? 'ok' : ''}">${v.masterSW ? '✅' : '⬜'} Master bedroom South-West</li><li class="${v.doorNE ? 'ok' : ''}">${v.doorNE ? '✅' : '⬜'} Main darwaza ${v.doorDir || '?'} (N/E achha)</li></ul></div>`;
    h += `<h3>Jaanch</h3>${checksHtml()}`;
    h += `<div class="card"><div class="row wrap"><button class="btn sm" data-act="export">💾 File save</button><button class="btn sm" data-act="import">📂 File kholo</button><button class="btn sm danger" data-act="new">🆕 Naya ghar</button></div></div>`;
    return h;
  }

  // ---------- view layout ----------
  function layoutViews() {
    const st = ui.stage, v = $('#views');
    const allowed = st === 'map' ? ['2d'] : ['2d', '3d', ...(wide() ? ['split'] : [])];
    if (!allowed.includes(ui.view)) ui.view = st === 'map' ? '2d' : (st === 'elev' || st === 'view') ? '3d' : wide() ? 'split' : '2d';
    v.className = 'views v-' + ui.view;
    const floorsTabs = st !== 'map' ? `<div class="ftabs">${S.floors.map((_, f) => `<button class="${ui.floor === f ? 'on' : ''}" data-act="floor" data-f="${f}" data-testid="floor-${f}">${f === 0 ? 'G' : f}<small>${f === 0 ? 'Ground' : 'Floor'}</small></button>`).join('')}</div>` : '<div class="maptitle">🗺️ Sukh Vihar Colony · North upar hai</div>';
    const viewBtns = allowed.length > 1 ? `<div class="seg">${allowed.map(k => `<button class="${ui.view === k ? 'on' : ''}" data-act="view" data-v="${k}" data-testid="view-${k}">${{ '2d': '2D Naksha', '3d': '3D', split: 'Dono' }[k]}</button>`).join('')}</div>` : '';
    $('#viewbar').innerHTML = floorsTabs + `<div class="vb-right"><button class="ib" data-act="undo" title="Undo (Ctrl+Z)" data-testid="undo">↶</button><button class="ib" data-act="redo" title="Redo">↷</button>${viewBtns}</div>`;
    // 3D overlay
    const cutOpts = ['follow', 'all', ...S.floors.map((_, f) => f)].map(k => `<option value="${k}" ${String(ui.cut) === String(k) ? 'selected' : ''}>${k === 'follow' ? 'Chuna hua floor' : k === 'all' ? 'Poora ghar' : Plan.FLOOR_NAME(k) + ' tak'}</option>`).join('');
    $('#v3ui').innerHTML = ui.walk
      ? `<div class="pad"><button data-hold="f" aria-label="Aage">▲</button><button data-hold="l" aria-label="Left">◀</button><button data-hold="b" aria-label="Peeche">▼</button><button data-hold="r" aria-label="Right">▶</button></div>
         <div class="v3top"><button class="btn sm" data-act="up" data-testid="go-up">⬆ Upar</button><button class="btn sm" data-act="down">⬇ Neeche</button><button class="btn sm" data-act="walk">🛰 Bahar</button><span class="chipinfo">${Plan.FLOOR_NAME(View3D.floor)}</span></div>`
      : `<div class="v3top"><select data-ui="cut" aria-label="Kya dikhaye">${cutOpts}</select><button class="btn sm" data-act="preset" data-p="corner" title="Reset view">⟲</button><button class="btn sm" data-act="walk">🚶 Andar</button><button class="btn sm" data-act="night">${ui.night ? '☀️' : '🌙'}</button></div>
         <div class="v3hint">Ghumane ke liye kheencho · zoom: scroll/pinch · Shift+kheench: khiskao</div>`;
    requestAnimationFrame(() => { sizeCanvas(); View3D.poke(); });
  }

  // ---------- 3D ----------
  let t3 = 0, built3 = '';
  function cutFloor() {
    if (ui.walk) return null;
    if (ui.cut === 'all') return null;
    if (ui.cut === 'follow') return (ui.stage === 'plan' || ui.stage === 'interior') ? ui.floor : null;
    return clamp(+ui.cut, 0, S.floors.length - 1);
  }
  function schedule3D(now) {
    if (!S.plot || !View3D.ready) return;
    clearTimeout(t3);
    t3 = setTimeout(() => {
      const key = JSON.stringify([S, cutFloor(), ui.night]);
      if (key === built3) return; built3 = key;
      View3D.build(S, { cut: cutFloor(), night: ui.night });
    }, now ? 0 : 220);
  }

  // ---------- 2D canvas ----------
  const cv = () => $('#plan');
  let ctx, dpr = 1;
  function sizeCanvas() {
    const c = cv(), box = c.parentElement; if (!box.clientWidth) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = box.clientWidth * dpr; c.height = box.clientHeight * dpr; c.style.width = box.clientWidth + 'px'; c.style.height = box.clientHeight + 'px';
    ctx = c.getContext('2d');
    const k = camKey(); if (ui.camFor !== k) fit();
    draw();
  }
  const camKey = () => ui.stage === 'map' ? 'map' : `plan:${S.plot?.w}x${S.plot?.d}`;
  function fit() {
    const c = cv(), W = c.width / dpr, H = c.height / dpr; if (!W) return;
    let x0, y0, x1, y1;
    if (ui.stage === 'map') { x0 = -6; y0 = -6; x1 = COLONY.W + 6; y1 = COLONY.H + 6; }
    else { const P = S.plot; x0 = -5; y0 = -6; x1 = P.w + 5; y1 = P.d + 13; }
    const s = Math.min(W / (x1 - x0), H / (y1 - y0));
    ui.cam = { s, ox: (W - (x1 - x0) * s) / 2 - x0 * s, oy: (H - (y1 - y0) * s) / 2 - y0 * s };
    ui.camFor = camKey();
  }
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function draw() {
    if (!ctx || !ui.cam) return;
    const c = cv(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ui.stage === 'map') drawMap(); else if (S.plot) drawPlan();
  }
  const tx = x => ui.cam.ox + x * ui.cam.s, ty = y => ui.cam.oy + y * ui.cam.s;

  function drawMap() {
    const s = ui.cam.s, ink = css('--ink'), acc = css('--accent');
    ctx.fillStyle = css('--map-ground'); ctx.fillRect(tx(0), ty(0), COLONY.W * s, COLONY.H * s);
    for (const r of COLONY.roads) { ctx.fillStyle = css('--map-road'); ctx.fillRect(tx(r.x), ty(r.y), r.w * s, r.h * s); }
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.2;
    for (const r of COLONY.roads) { ctx.beginPath(); if (r.w > r.h) { ctx.moveTo(tx(r.x), ty(r.y + r.h / 2)); ctx.lineTo(tx(r.x + r.w), ty(r.y + r.h / 2)); } else { ctx.moveTo(tx(r.x + r.w / 2), ty(r.y)); ctx.lineTo(tx(r.x + r.w / 2), ty(r.y + r.h)); } ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `600 ${clamp(s * 9, 9, 13)}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const r of COLONY.roads) if (r.name) ctx.fillText(r.name.toUpperCase(), tx(r.x + r.w / 2), ty(r.y + r.h / 2));
    for (const p of COLONY.places) {
      if (p.kind === 'PARK') {
        ctx.fillStyle = '#86C46E'; ctx.fillRect(tx(p.x), ty(p.y), p.w * s, p.h * s);
        for (let i = 0; i < 9; i++) { ctx.fillStyle = '#3E8A3C'; ctx.beginPath(); ctx.arc(tx(p.x + 12 + (i * 37) % (p.w - 20)), ty(p.y + 12 + (i * 23) % (p.h - 20)), s * 5, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#1F4D1E'; ctx.fillText('🌳 PARK', tx(p.x + p.w / 2), ty(p.y + p.h / 2));
      } else { ctx.fillStyle = '#F2C27A'; ctx.fillRect(tx(p.x), ty(p.y), p.w * s, p.h * s); ctx.fillStyle = '#7A3E10'; ctx.fillText('🛕 MANDIR', tx(p.x + p.w / 2), ty(p.y + p.h / 2)); }
    }
    for (const p of COLONY.plots) {
      const mine = S.plot && S.plot.id === p.id, sel = ui.mapSel === p.id;
      const hue = p.gaj <= 70 ? '#F6E7C1' : p.gaj <= 120 ? '#F3D9B1' : p.gaj <= 200 ? '#EBC9A0' : '#E2B98D';
      ctx.fillStyle = mine ? '#9BD88A' : hue; ctx.fillRect(tx(p.x) + 1, ty(p.y) + 1, p.w * s - 2, p.h * s - 2);
      ctx.strokeStyle = sel ? acc : 'rgba(80,60,40,.45)'; ctx.lineWidth = sel ? 3 : 1; ctx.strokeRect(tx(p.x) + 1, ty(p.y) + 1, p.w * s - 2, p.h * s - 2);
      // road-side mark
      ctx.fillStyle = 'rgba(80,60,40,.35)'; ctx.fillRect(tx(p.x) + 2, p.facing === 'N' ? ty(p.y) + 1 : ty(p.y + p.h) - 3, p.w * s - 4, 2);
      if (p.w * s > 22) {
        ctx.save(); ctx.translate(tx(p.x + p.w / 2), ty(p.y + p.h / 2));
        if (p.w * s < 34) ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#3B2A1A'; ctx.font = `700 ${clamp(s * 7, 8, 13)}px Inter, sans-serif`; ctx.fillText(p.gaj + (p.w * s > 40 ? ' gaj' : ''), 0, -s * 4);
        ctx.font = `500 ${clamp(s * 5.5, 7, 11)}px Inter, sans-serif`; ctx.fillStyle = '#6B5640'; ctx.fillText(mine ? 'AAPKA' : p.id, 0, s * 6);
        ctx.restore();
      }
    }
    compass(0);
  }

  function compass(northAngle) {
    const c = cv(), W = c.width / dpr, x = W - 34, y = 34;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = css('--surface'); ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.fill(); ctx.stroke();
    ctx.rotate(northAngle);
    ctx.fillStyle = '#C2412D'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(6, 2); ctx.lineTo(-6, 2); ctx.fill();
    ctx.fillStyle = css('--muted'); ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(6, 2); ctx.lineTo(-6, 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = css('--ink'); ctx.font = '800 11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', x + Math.sin(northAngle) * 31, y - Math.cos(northAngle) * 31);
  }

  function drawPlan() {
    const P = S.plot, s = ui.cam.s, f = ui.floor, ink = css('--ink'), muted = css('--muted'), acc = css('--accent'), paper = css('--paper');
    const interior = ui.stage === 'interior';
    // road + surroundings
    ctx.fillStyle = css('--map-road'); ctx.fillRect(tx(-40), ty(P.d + 2), (P.w + 80) * s, 10 * s);
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `600 ${clamp(s * 2.6, 9, 14)}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cp = Plan.planCompass(P.facing);
    ctx.fillText(`SADAK (ROAD) · ${cp.bottom} side`, tx(P.w / 2), ty(P.d + 7));
    ctx.fillStyle = css('--plot'); ctx.fillRect(tx(0), ty(0), P.w * s, P.d * s);
    // grid
    if (s >= 6) { ctx.strokeStyle = css('--grid'); ctx.lineWidth = 0.5; ctx.beginPath(); for (let x = 0; x <= P.w; x++) { ctx.moveTo(tx(x), ty(0)); ctx.lineTo(tx(x), ty(P.d)); } for (let y = 0; y <= P.d; y++) { ctx.moveTo(tx(0), ty(y)); ctx.lineTo(tx(P.w), ty(y)); } ctx.stroke(); }
    ctx.strokeStyle = css('--grid2'); ctx.lineWidth = 0.8; ctx.beginPath(); for (let x = 0; x <= P.w; x += 5) { ctx.moveTo(tx(x), ty(0)); ctx.lineTo(tx(x), ty(P.d)); } for (let y = 0; y <= P.d; y += 5) { ctx.moveTo(tx(0), ty(y)); ctx.lineTo(tx(P.w), ty(y)); } ctx.stroke();
    // setback zone
    const sb = S.setback; ctx.setLineDash([5, 4]); ctx.strokeStyle = '#C2603A'; ctx.lineWidth = 1.2;
    ctx.strokeRect(tx(sb.left), ty(sb.back), (P.w - sb.left - sb.right) * s, (P.d - sb.front - sb.back) * s); ctx.setLineDash([]);
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(tx(0), ty(0), P.w * s, P.d * s);
    // dimensions
    ctx.fillStyle = muted; ctx.font = `600 ${clamp(s * 2, 10, 13)}px Inter, sans-serif`;
    ctx.fillText(`${P.w} ft`, tx(P.w / 2), ty(-2.6));
    ctx.save(); ctx.translate(tx(-2.6), ty(P.d / 2)); ctx.rotate(-Math.PI / 2); ctx.fillText(`${P.d} ft`, 0, 0); ctx.restore();
    // floor below as ghost
    if (f > 0) { ctx.setLineDash([3, 3]); ctx.strokeStyle = muted; ctx.lineWidth = 1; for (const r of S.floors[f - 1].rooms) if (r.type !== 'lawn') ctx.strokeRect(tx(r.x), ty(r.y), r.w * s, r.d * s); ctx.setLineDash([]); }
    const Fl = F(), g = Plan.grid(S, f), Sg = Plan.segments(S, f, g);
    // rooms
    Fl.rooms.forEach((r, i) => {
      const T = ROOM_TYPES[r.type];
      ctx.fillStyle = T.color; ctx.globalAlpha = interior ? 0.55 : 0.9;
      for (const q of Plan.rects(Uint8Array.from(g.own, o => o === i ? 1 : 0), P.w, P.d)) ctx.fillRect(tx(q.x), ty(q.y), q.w * s, q.d * s);
      if (interior) { const fl = FLOORINGS[r.floor || DEFAULT_FLOOR[r.type]]; ctx.globalAlpha = 0.35; ctx.fillStyle = fl.color; ctx.fillRect(tx(r.x), ty(r.y), r.w * s, r.d * s); }
      ctx.globalAlpha = 1;
      if (r.type === 'stairs') { ctx.strokeStyle = 'rgba(60,50,40,.45)'; ctx.lineWidth = 1; ctx.beginPath(); const long = r.d >= r.w; for (let k = 1; k < (long ? r.d : r.w); k++) { if (long) { ctx.moveTo(tx(r.x), ty(r.y + k)); ctx.lineTo(tx(r.x + r.w), ty(r.y + k)); } else { ctx.moveTo(tx(r.x + k), ty(r.y)); ctx.lineTo(tx(r.x + k), ty(r.y + r.d)); } } ctx.stroke(); }
    });
    // walls
    for (const sg of Sg.segs) {
      ctx.strokeStyle = sg.kind === 'rail' ? '#4C8A5E' : ink; ctx.lineWidth = sg.kind === 'rail' ? Math.max(1.5, s * 0.25) : Math.max(2.5, s * 0.75); ctx.lineCap = 'square';
      if (sg.kind === 'rail') ctx.setLineDash([s * 0.6, s * 0.4]);
      ctx.beginPath();
      if (sg.o === 'h') { ctx.moveTo(tx(sg.a), ty(sg.k)); ctx.lineTo(tx(sg.b), ty(sg.k)); } else { ctx.moveTo(tx(sg.k), ty(sg.a)); ctx.lineTo(tx(sg.k), ty(sg.b)); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // openings
    for (const op of Fl.open) {
      const okE = Plan.openingEdge(Sg, op), h = op.o === 'h', sel = ui.sel?.kind === 'open' && ui.sel.id === op.id;
      const x1 = tx(op.x), y1 = ty(op.y), x2 = h ? tx(op.x + op.w) : x1, y2 = h ? y1 : ty(op.y + op.w), th = Math.max(3, s * 0.85);
      ctx.strokeStyle = css('--plot'); ctx.lineWidth = th + 1; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const col = !okE ? '#D33' : sel ? acc : op.kind === 'window' ? '#2E86C1' : op.kind === 'main' ? '#9A4A1C' : '#7A5136';
      if (op.kind === 'window') {
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; const o = th / 2;
        ctx.beginPath(); if (h) { ctx.moveTo(x1, y1 - o); ctx.lineTo(x2, y2 - o); ctx.moveTo(x1, y1 + o); ctx.lineTo(x2, y2 + o); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); } else { ctx.moveTo(x1 - o, y1); ctx.lineTo(x2 - o, y2); ctx.moveTo(x1 + o, y1); ctx.lineTo(x2 + o, y2); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); } ctx.stroke();
      } else {
        // leaf + swing arc into the room side
        const into = okE && !Plan.isOutsideOwner(g, okE.B) ? 1 : -1, r = op.w * s * (op.kind === 'main' ? 0.5 : 1);
        ctx.strokeStyle = col; ctx.lineWidth = op.kind === 'main' ? 2.5 : 1.5;
        const leaves = op.kind === 'main' ? [[x1, y1, 1], [x2, y2, -1]] : [[x1, y1, 1]];
        for (const [hx, hy, sg] of leaves) {
          ctx.beginPath();
          if (h) { const a0 = sg > 0 ? 0 : Math.PI; ctx.moveTo(hx, hy); ctx.lineTo(hx, hy + into * r); ctx.moveTo(hx + sg * r, hy); ctx.arc(hx, hy, r, a0, into > 0 ? Math.PI / 2 : -Math.PI / 2, (sg > 0) !== (into > 0)); }
          else { const a0 = sg > 0 ? Math.PI / 2 : -Math.PI / 2; ctx.moveTo(hx, hy); ctx.lineTo(hx + into * r, hy); ctx.moveTo(hx, hy + sg * r); ctx.arc(hx, hy, r, a0, into > 0 ? 0 : Math.PI, (sg > 0) === (into > 0)); }
          ctx.stroke();
        }
        if (op.kind === 'main') { ctx.fillStyle = col; ctx.font = `700 ${clamp(s * 1.6, 8, 11)}px Inter, sans-serif`; ctx.fillText('MAIN', (x1 + x2) / 2 + (h ? 0 : -into * 14), (y1 + y2) / 2 + (h ? -into * 10 : 0)); }
      }
    }
    // furniture
    for (const it of Fl.furn) {
      const b = Plan.furnBox(it), Fd = FURNITURE[it.type], sel = ui.sel?.kind === 'furn' && ui.sel.id === it.id;
      ctx.globalAlpha = interior ? 1 : 0.4;
      ctx.fillStyle = it.color || Fd.color; ctx.strokeStyle = sel ? acc : 'rgba(0,0,0,.45)'; ctx.lineWidth = sel ? 2.5 : 1;
      roundRect(tx(b.x), ty(b.y), b.w * s, b.d * s, Math.min(4, s * 0.4)); ctx.fill(); ctx.stroke();
      // front edge marker
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      const fr = it.rot % 4; if (fr === 0) ctx.fillRect(tx(b.x), ty(b.y + b.d) - 2, b.w * s, 2); else if (fr === 2) ctx.fillRect(tx(b.x), ty(b.y), b.w * s, 2); else if (fr === 1) ctx.fillRect(tx(b.x), ty(b.y), 2, b.d * s); else ctx.fillRect(tx(b.x + b.w) - 2, ty(b.y), 2, b.d * s);
      if (interior && b.d * s > 13) { ctx.font = `600 ${clamp(s * 1.1, 8, 11)}px Inter, sans-serif`; const nm = ctx.measureText(Fd.name).width < b.w * s - 4 ? Fd.name : ctx.measureText(Fd.name.split(' ')[0]).width < b.w * s - 4 ? Fd.name.split(' ')[0] : ''; ctx.fillStyle = '#fff'; ctx.fillText(nm, tx(b.x + b.w / 2), ty(b.y + b.d / 2)); }
      ctx.globalAlpha = 1;
    }
    // labels
    Fl.rooms.forEach((r, i) => {
      if (r.w * s < 28 || r.d * s < 18) return;
      const nm = r.name || ROOM_TYPES[r.type].short;
      if (interior) {
        ctx.font = `700 ${clamp(s * 1.2, 9, 12)}px Inter, sans-serif`; const tw = ctx.measureText(nm).width + 10;
        ctx.fillStyle = 'rgba(255,253,248,.88)'; roundRect(tx(r.x) + 4, ty(r.y + r.d) - 22, tw, 17, 5); ctx.fill();
        ctx.fillStyle = '#1E2A35'; ctx.textAlign = 'left'; ctx.fillText(nm, tx(r.x) + 9, ty(r.y + r.d) - 13); ctx.textAlign = 'center'; return;
      }
      ctx.fillStyle = ink; ctx.font = `700 ${clamp(s * 1.5, 9, 15)}px Inter, sans-serif`;
      const cy = ty(r.y + r.d / 2);
      ctx.fillText(nm, tx(r.x + r.w / 2), cy - 6);
      ctx.fillStyle = muted; ctx.font = `500 ${clamp(s * 1.2, 8, 12)}px Inter, sans-serif`;
      ctx.fillText(`${r.w}'×${r.d}'`, tx(r.x + r.w / 2), cy + 8);
    });
    // selection
    if (ui.sel?.kind === 'room') {
      const r = Fl.rooms.find(x => x.id === ui.sel.id);
      if (r) { ctx.strokeStyle = acc; ctx.lineWidth = 3; ctx.setLineDash([7, 4]); ctx.strokeRect(tx(r.x), ty(r.y), r.w * s, r.d * s); ctx.setLineDash([]);
        if (ui.stage === 'plan') for (const [hx, hy] of corners(r)) { ctx.fillStyle = '#fff'; ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx(hx), ty(hy), 7, 0, 7); ctx.fill(); ctx.stroke(); } }
    }
    if (drag && drag.kind === 'draw' && drag.rect) { const q = drag.rect; ctx.fillStyle = ROOM_TYPES[ui.roomType].color; ctx.globalAlpha = 0.7; ctx.fillRect(tx(q.x), ty(q.y), q.w * s, q.d * s); ctx.globalAlpha = 1; ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.strokeRect(tx(q.x), ty(q.y), q.w * s, q.d * s); ctx.fillStyle = ink; ctx.font = '700 13px Inter, sans-serif'; ctx.fillText(`${q.w}' × ${q.d}'`, tx(q.x + q.w / 2), ty(q.y + q.d / 2)); }
    // compass: which way is north on the plan?
    const ang = { top: 0, right: Math.PI / 2, bottom: Math.PI, left: -Math.PI / 2 };
    const nk = Object.keys(cp).find(k => cp[k] === 'N'); compass(ang[nk] || 0);
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  const corners = r => [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.d], [r.x + r.w, r.y + r.d]];

  // ---------- pointer on 2D ----------
  let drag = null; const ptrs = new Map();
  const toFt = e => { const rc = cv().getBoundingClientRect(); return { x: (e.clientX - rc.left - ui.cam.ox) / ui.cam.s, y: (e.clientY - rc.top - ui.cam.oy) / ui.cam.s, px: e.clientX - rc.left, py: e.clientY - rc.top }; };
  function hitRoom(p) { const R = F().rooms; for (let i = R.length - 1; i >= 0; i--) { const r = R[i]; if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.d) return r; } return null; }
  function hitFurn(p) { const L2 = F().furn; for (let i = L2.length - 1; i >= 0; i--) { const b = Plan.furnBox(L2[i]); if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.d) return L2[i]; } return null; }
  function hitOpen(p) {
    let best = null, bd = 0.9;
    for (const o of F().open) {
      const d = o.o === 'h' ? (p.x >= o.x - 0.3 && p.x <= o.x + o.w + 0.3 ? Math.abs(p.y - o.y) : 99) : (p.y >= o.y - 0.3 && p.y <= o.y + o.w + 0.3 ? Math.abs(p.x - o.x) : 99);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function onDown(e) {
    if (!ui.cam) return;
    cv().setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) { drag = { kind: 'pinch', d: pdist(), cam: { ...ui.cam }, mid: pmid() }; return; }
    const p = toFt(e);
    if (ui.stage === 'map') { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...ui.cam }, moved: false, tap: p }; return; }
    const interior = ui.stage === 'interior';
    const tool = ui.tool;
    if (tool === 'pan') { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...ui.cam }, moved: true }; return; }
    if (tool === 'room') { const x = Math.round(p.x), y = Math.round(p.y); drag = { kind: 'draw', x0: x, y0: y, rect: null }; return; }
    if (tool === 'door' || tool === 'main' || tool === 'window') {
      const ex = hitOpen(p);
      if (ex) { ui.sel = { kind: 'open', id: ex.id }; renderSide(); draw(); return; }
      const sn = Plan.snapOpening(S, ui.floor, p.x, p.y, OPW[tool]) || Plan.snapOpening(S, ui.floor, p.x, p.y, tool === 'window' ? 2 : 2.5);
      if (!sn) return toast('Yahan deewar nahi hai. Kamron ke beech ki ya bahar ki deewar pe tap karo.');
      if (Plan.openingsClash(F().open, sn)) return toast('Yahan pehle se darwaza/khidki hai.');
      mutate(() => { const op = { id: Plan.uid(S), kind: tool, ...sn }; F().open.push(op); ui.sel = { kind: 'open', id: op.id }; });
      return;
    }
    if (tool === 'erase') {
      const o = hitOpen(p), it = hitFurn(p), r = hitRoom(p);
      if (interior && it) mutate(() => { F().furn = F().furn.filter(x => x !== it); });
      else if (o) mutate(() => { F().open = F().open.filter(x => x !== o); });
      else if (it) mutate(() => { F().furn = F().furn.filter(x => x !== it); });
      else if (r) mutate(() => { removeRoom(r); });
      ui.sel = null; return;
    }
    if (tool === 'furn' && ui.furnType) {
      const Fd = FURNITURE[ui.furnType];
      mutate(() => { const it = { id: Plan.uid(S), type: ui.furnType, rot: 0, x: Math.round((p.x - Fd.w / 2) * 2) / 2, y: Math.round((p.y - Fd.d / 2) * 2) / 2 }; F().furn.push(it); ui.sel = { kind: 'furn', id: it.id }; ui.tool = 'select'; ui.furnType = null; });
      return;
    }
    // select tool
    if (ui.sel?.kind === 'room' && ui.stage === 'plan') {
      const r = F().rooms.find(x => x.id === ui.sel.id);
      if (r) { const ci = corners(r).findIndex(([hx, hy]) => Math.hypot(tx(hx) - p.px, ty(hy) - p.py) < 14); if (ci >= 0) { snapshot(); drag = { kind: 'resize', r, ci, orig: { ...r } }; return; } }
    }
    const it = (interior || ui.stage === 'plan') ? hitFurn(p) : null;
    if (it && (interior || !hitRoom(p) || ui.sel?.kind === 'furn')) { ui.sel = { kind: 'furn', id: it.id }; snapshot(); drag = { kind: 'furn', it, p0: p, orig: { x: it.x, y: it.y }, moved: false }; renderSide(); draw(); return; }
    const o = ui.stage === 'plan' ? hitOpen(p) : null;
    if (o) { ui.sel = { kind: 'open', id: o.id }; renderSide(); draw(); return; }
    const r = hitRoom(p);
    if (r) {
      ui.sel = { kind: 'room', id: r.id };
      if (ui.stage === 'plan') { snapshot(); drag = { kind: 'room', r, p0: p, orig: { x: r.x, y: r.y }, furn: F().furn.filter(q => inRoom(q, r)).map(q => [q, q.x, q.y]), moved: false }; }
      renderSide(); draw(); return;
    }
    if (ui.sel) { ui.sel = null; renderSide(); draw(); }
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cam: { ...ui.cam }, moved: false };
  }
  const inRoom = (it, r) => { const b = Plan.furnBox(it); const cx = b.x + b.w / 2, cy = b.y + b.d / 2; return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.d; };
  const pdist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const pmid = () => { const [a, b] = [...ptrs.values()]; const rc = cv().getBoundingClientRect(); return { x: (a.x + b.x) / 2 - rc.left, y: (a.y + b.y) / 2 - rc.top }; };
  function onMove(e) {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;
    const P = S.plot;
    if (drag.kind === 'pinch') { if (ptrs.size < 2) return; const k = pdist() / drag.d, m = pmid(); zoomAt(drag.mid.x, drag.mid.y, k, drag.cam); ui.cam.ox += m.x - drag.mid.x; ui.cam.oy += m.y - drag.mid.y; draw(); return; }
    if (drag.kind === 'pan') { const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { ui.cam.ox = drag.cam.ox + dx; ui.cam.oy = drag.cam.oy + dy; draw(); } return; }
    const p = toFt(e);
    if (drag.kind === 'draw') {
      const x = clamp(Math.round(p.x), 0, P.w), y = clamp(Math.round(p.y), 0, P.d + 6);
      drag.rect = { x: Math.min(x, drag.x0), y: Math.min(y, drag.y0), w: Math.abs(x - drag.x0), d: Math.abs(y - drag.y0) }; draw(); return;
    }
    if (drag.kind === 'room') {
      const dx = Math.round(p.x - drag.p0.x), dy = Math.round(p.y - drag.p0.y);
      if (dx || dy) drag.moved = true;
      drag.r.x = clamp(drag.orig.x + dx, -2, P.w - drag.r.w + 2); drag.r.y = clamp(drag.orig.y + dy, -2, P.d - drag.r.d + 6);
      const mx = drag.r.x - drag.orig.x, my = drag.r.y - drag.orig.y;
      for (const [q, qx, qy] of drag.furn) { q.x = qx + mx; q.y = qy + my; }
      draw(); return;
    }
    if (drag.kind === 'resize') {
      const r = drag.r, o = drag.orig, x = Math.round(p.x), y = Math.round(p.y);
      const left = drag.ci === 0 || drag.ci === 2, topc = drag.ci < 2;
      if (left) { const nx = Math.min(x, o.x + o.w - 2); r.x = nx; r.w = o.x + o.w - nx; } else r.w = Math.max(2, x - o.x);
      if (topc) { const ny = Math.min(y, o.y + o.d - 2); r.y = ny; r.d = o.y + o.d - ny; } else r.d = Math.max(2, y - o.y);
      drag.moved = true; draw(); return;
    }
    if (drag.kind === 'furn') {
      const dx = Math.round((p.x - drag.p0.x) * 2) / 2, dy = Math.round((p.y - drag.p0.y) * 2) / 2;
      if (dx || dy) drag.moved = true;
      drag.it.x = drag.orig.x + dx; drag.it.y = drag.orig.y + dy; draw(); return;
    }
  }
  function onUp(e) {
    ptrs.delete(e.pointerId);
    if (!drag) return;
    const d = drag;
    if (d.kind === 'pinch') { if (ptrs.size === 0) drag = null; return; }
    drag = null;
    if (d.kind === 'pan' && !d.moved && ui.stage === 'map') {
      const p = d.tap, hit = COLONY.plots.find(q => p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h);
      ui.mapSel = hit ? hit.id : null; renderSide(); draw(); return;
    }
    if (d.kind === 'draw') {
      const q = d.rect;
      if (!q || q.w < 2 || q.d < 2) { draw(); return toast('Kamra banane ke liye kheencho (kam se kam 2×2 ft).'); }
      mutate(() => { const r = Plan.room(S, ui.roomType, q.x, q.y, q.w, q.d); F().rooms.push(r); ui.sel = { kind: 'room', id: r.id }; });
      return;
    }
    if (d.kind === 'room' || d.kind === 'resize' || d.kind === 'furn') {
      if (!d.moved) { undo.pop(); return; }
      changed();
    }
  }
  function zoomAt(px, py, k, base = ui.cam) {
    const s = clamp(base.s * k, 1, 80), kk = s / base.s;
    ui.cam = { s, ox: px - (px - base.ox) * kk, oy: py - (py - base.oy) * kk };
  }
  function removeRoom(r) {
    const Fl = F(); Fl.rooms = Fl.rooms.filter(x => x !== r);
    Fl.furn = Fl.furn.filter(q => !inRoom(q, r));
  }

  // ---------- actions ----------
  function setStage(id) {
    if (id !== 'map' && !S.plot) { toast('Pehle zameen (plot) chuno!'); return; }
    if (ui.walk) { ui.walk = false; View3D.setMode('orbit'); }
    ui.stage = id; ui.sel = null; ui.cut = 'follow';
    ui.tool = 'select'; ui.furnType = null;
    ui.view = id === 'map' ? '2d' : (id === 'elev' || id === 'view') ? '3d' : wide() ? 'split' : '2d';
    if (id === 'plan' && !S.floors.some(Fl => Fl.rooms.length)) toast('Tip: "✨ Banao" dabao, auto naksha ban jayega.');
    save(); render(); schedule3D(true);
    if (id === 'elev' || id === 'view') setTimeout(() => View3D.viewPreset('corner'), 50);
    $('#side').scrollTop = 0;
  }
  function buyPlot(p) {
    const has = S.floors.some(Fl => Fl.rooms.length);
    if (has && !confirm('Naya plot lene se purana naksha hat jayega. Theek hai?')) return;
    mutate(() => {
      S.plot = { id: p.id, w: p.wft, d: p.dft, facing: p.facing, gaj: p.wft * p.dft / GAJ, rate: p.rate, price: p.price, corner: p.corner };
      defaultSetback(); S.floors = S.floors.map(() => ({ rooms: [], open: [], furn: [] }));
      if (S.floors.length < 2 && p.gaj >= 80) S.floors.push({ rooms: [], open: [], furn: [] });
    });
    toast(`Badhai ho! Plot ${p.id} aapka hua 🎉`);
  }
  function defaultSetback() {
    const g = S.plot.gaj, d = S.plot.d;
    S.setback = g >= 300 ? { front: 12, back: 6, left: 5, right: 5 } : g >= 180 ? { front: 8, back: 4, left: 3, right: 3 } : d >= 50 ? { front: 6, back: 3, left: 0, right: 0 } : { front: 3, back: 2, left: 0, right: 0 };
  }
  function autoLayout() {
    if (S.floors.some(Fl => Fl.rooms.length) && !confirm('Is se abhi ka naksha badal jayega. Auto naksha banaye?')) return;
    mutate(() => {
      S.floors = Plan.autoLayout(S, ui.bhk);
      S.floors.forEach((_, f) => { Plan.autoOpenings(S, f); Plan.autoFurnish(S, f); });
      ui.sel = null;
    });
    if (!S.floors[0].rooms.length) toast('Plot bahut chhota hai ya setback bahut zyada. Khud kamre banao.'); else toast(`${BHK_PRESETS[ui.bhk]} ka naksha ready! Ab apne hisaab se badlo.`);
  }

  function act(a, ds, el) {
    switch (a) {
      case 'stage': return setStage(ds.id);
      case 'choose-brief': return showBriefs();
      case 'pick-brief': S.brief = ds.id; closeModal(); save(); render(); return toast(`Client: ${brief().name}`);
      case 'brief-toggle': ui.briefOpen = !ui.briefOpen; return renderSide();
      case 'buy-plot': return buyPlot(COLONY.plots.find(q => q.id === ui.mapSel));
      case 'custom-plot': {
        const gaj = +$('#cg').value, w = Math.round(+$('#cw').value), fac = $('#cf').value, rate = +$('#cr').value || 40000;
        if (!(gaj >= 25 && gaj <= 2000) || !(w >= 10 && w <= 150)) return toast('Gaj 25-2000 aur chaudai 10-150 ft rakho.');
        const d = Math.round(gaj * GAJ / w); if (d < 15 || d > 250) return toast('Ye size ajeeb hai. Chaudai badlo.');
        if (S.floors.some(Fl => Fl.rooms.length) && !confirm('Naya plot lene se purana naksha hat jayega. Theek hai?')) return;
        mutate(() => { S.plot = { id: '', w, d, facing: fac, gaj: w * d / GAJ, rate, price: Math.round(w * d / GAJ * rate), custom: true }; defaultSetback(); S.floors = S.floors.map(() => ({ rooms: [], open: [], furn: [] })); });
        return toast(`Plot: ${w} × ${d} ft (${Math.round(w * d / GAJ)} gaj)`);
      }
      case 'floors+': if (S.floors.length >= 4) return toast('4 manzil se zyada ki permission nahi milegi!'); return mutate(() => { S.floors.push({ rooms: [], open: [], furn: [] }); ui.floor = S.floors.length - 1; });
      case 'floors-': if (S.floors.length <= 1) return; if (S.floors[S.floors.length - 1].rooms.length && !confirm('Sabse upar wala floor hata dein?')) return; return mutate(() => { S.floors.pop(); ui.sel = null; });
      case 'auto-layout': return autoLayout();
      case 'tool': ui.tool = ds.t; ui.furnType = null; renderSide(); return;
      case 'rtype': ui.roomType = ds.t; ui.tool = 'room'; if (ui.sel?.kind === 'room') { const r = F().rooms.find(x => x.id === ui.sel.id); } renderSide(); return;
      case 'desel': ui.sel = null; renderSide(); draw(); return;
      case 'del-sel': return deleteSel();
      case 'copy-up': { const r = F().rooms.find(x => x.id === ui.sel?.id); if (!r) return; return mutate(() => { S.floors[ui.floor + 1].rooms.push({ ...r, id: Plan.uid(S) }); toast('Upar wale floor pe copy ho gaya'); }); }
      case 'dup-room': { const r = F().rooms.find(x => x.id === ui.sel?.id); if (!r) return; return mutate(() => { const n = { ...r, id: Plan.uid(S), x: r.x + 2, y: r.y + 2 }; F().rooms.push(n); ui.sel = { kind: 'room', id: n.id }; }); }
      case 'copy-below': if (F().rooms.length && !confirm('Is floor ka naksha neeche wale jaisa ho jayega. Theek?')) return;
        return mutate(() => { const b = S.floors[ui.floor - 1]; S.floors[ui.floor] = JSON.parse(JSON.stringify(b)); const Fl = F(); Fl.rooms.forEach(r => { r.id = Plan.uid(S); if (r.type === 'parking' || r.type === 'lawn') { r.type = r.type === 'parking' ? 'bedroom' : 'balcony'; } }); Fl.open.forEach(o => { o.id = Plan.uid(S); if (o.kind === 'main') o.kind = 'door'; }); Fl.furn = []; Plan.autoOpenings(S, ui.floor); Plan.autoFurnish(S, ui.floor); });
      case 'auto-open': return mutate(() => { Plan.autoOpenings(S, ui.floor); ui.sel = null; toast('Darwaze aur khidkiyan lag gayi'); });
      case 'floor': ui.floor = +ds.f; ui.sel = null; renderSide(); layoutViews(); draw(); schedule3D(); return;
      case 'view': ui.view = ds.v; layoutViews(); schedule3D(true); return;
      case 'undo': return doUndo();
      case 'redo': return doRedo();
      case 'ext-wall': return mutate(() => { S.elev.wall = ds.v; });
      case 'ext-accent': return mutate(() => { S.elev.accent = ds.v; });
      case 'frame': return mutate(() => { S.elev.frame = ds.v; });
      case 'gate': return mutate(() => { S.elev.gate = ds.v; });
      case 'preset': ui.walk = false; View3D.setMode('orbit'); View3D.viewPreset(ds.p); if (ui.view === '2d') { ui.view = '3d'; layoutViews(); } return;
      case 'night': ui.night = !ui.night; renderSide(); layoutViews(); schedule3D(true); return;
      case 'walk': ui.walk = !ui.walk; if (ui.view === '2d' || ui.view === 'split') ui.view = '3d'; schedule3D(true); setTimeout(() => View3D.setMode(ui.walk ? 'walk' : 'orbit'), 30); if (!ui.walk) setTimeout(() => View3D.viewPreset('corner'), 40); renderSide(); layoutViews(); return;
      case 'up': if (!View3D.changeFloor(1)) toast('Ye sabse upar wala floor hai'); layoutViews(); return;
      case 'down': if (!View3D.changeFloor(-1)) toast('Ye ground floor hai'); layoutViews(); return;
      case 'flooring': return mutate(() => { const r = F().rooms.find(x => x.id === ui.sel?.id); if (r) r.floor = ds.v; });
      case 'paint': return mutate(() => { const r = F().rooms.find(x => x.id === ui.sel?.id); if (r) r.paint = ds.v; });
      case 'furn': ui.tool = 'furn'; ui.furnType = ds.t; renderSide(); return toast(`${FURNITURE[ds.t].name}: ab naksha pe jahan rakhna hai wahan tap karo`);
      case 'rot': return mutate(() => { const it = F().furn.find(x => x.id === ui.sel?.id); if (it) { const b0 = Plan.furnBox(it); it.rot = (it.rot + 1) % 4; const b1 = Plan.furnBox(it); it.x = Math.round((b0.x + b0.w / 2 - b1.w / 2) * 2) / 2; it.y = Math.round((b0.y + b0.d / 2 - b1.d / 2) * 2) / 2; } });
      case 'dup-furn': return mutate(() => { const it = F().furn.find(x => x.id === ui.sel?.id); if (it) { const n = { ...it, id: Plan.uid(S), x: it.x + 1, y: it.y + 1 }; F().furn.push(n); ui.sel = { kind: 'furn', id: n.id }; } });
      case 'auto-furn-room': return mutate(() => { Plan.autoFurnish(S, ui.floor, ui.sel?.id); });
      case 'clear-furn-room': return mutate(() => { const r = F().rooms.find(x => x.id === ui.sel?.id); if (r) F().furn = F().furn.filter(q => !inRoom(q, r)); });
      case 'auto-furn-all': if (S.floors.some(Fl => Fl.furn.length) && !confirm('Saara furniture dobara auto-set ho jayega. Theek?')) return; return mutate(() => { S.floors.forEach((_, f) => Plan.autoFurnish(S, f)); toast('Poora ghar saj gaya ✨'); });
      case 'photo': { const url = View3D.shot(); if (!url) return; const a2 = document.createElement('a'); a2.href = url; a2.download = 'mera-ghar.png'; a2.click(); return toast('Photo download ho gayi 📸'); }
      case 'export': { const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }); const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = 'mera-ghar.ghar.json'; a2.click(); return toast('File save ho gayi'); }
      case 'import': return $('#importFile').click();
      case 'new': if (!confirm('Naya ghar shuru karein? Abhi wala mit jayega (pehle File save kar lo).')) return; S = Plan.newState(S.brief); undo.length = 0; ui.floor = 0; ui.sel = null; ui.mapSel = null; ui.walk = false; View3D.setMode('orbit'); built3 = ''; setStage('map'); return showBriefs();
      case 'start': closeModal(); return;
      case 'help': return showHelp();
    }
  }
  function deleteSel() {
    const sel = ui.sel; if (!sel) return;
    mutate(() => {
      const Fl = F();
      if (sel.kind === 'room') { const r = Fl.rooms.find(x => x.id === sel.id); if (r) removeRoom(r); }
      if (sel.kind === 'open') Fl.open = Fl.open.filter(x => x.id !== sel.id);
      if (sel.kind === 'furn') Fl.furn = Fl.furn.filter(x => x.id !== sel.id);
      ui.sel = null;
    });
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === 'cg' || t.id === 'cw') { const gaj = +$('#cg').value, w = +$('#cw').value; if (gaj && w) $('#cinfo').textContent = `= ${w} × ${Math.round(gaj * GAJ / w)} ft · ${Math.round(gaj * GAJ)} sq ft · ${(gaj * 0.836).toFixed(0)} sq m`; return; }
    if (t.dataset.ui) { ui[t.dataset.ui] = t.dataset.ui === 'bhk' ? +t.value : t.value; if (t.dataset.ui === 'cut') schedule3D(true); return; }
    if (t.dataset.set) {
      const path = t.dataset.set.split('.'), v = t.type === 'checkbox' ? t.checked : t.type === 'number' || path[0] === 'floorH' ? +t.value : t.value;
      if (t.type === 'number' && !Number.isFinite(v)) return;
      return mutate(() => { let o = S; for (let i = 0; i < path.length - 1; i++) o = o[path[i]]; o[path[path.length - 1]] = t.type === 'number' ? clamp(v, 0, 30) : v; });
    }
    if (t.dataset.room) {
      const r = F().rooms.find(x => x.id === ui.sel?.id); if (!r) return;
      const k = t.dataset.room;
      return mutate(() => {
        if (k === 'type') { r.type = t.value; r.floor = DEFAULT_FLOOR[r.type]; r.paint = DEFAULT_WALL[r.type]; }
        else if (k === 'name') r.name = t.value.slice(0, 24);
        else { const v = Math.round(+t.value); if (Number.isFinite(v)) r[k] = k === 'w' || k === 'd' ? clamp(v, 2, 200) : clamp(v, -5, 300); }
      });
    }
    if (t.dataset.open) {
      const o = F().open.find(x => x.id === ui.sel?.id); if (!o) return;
      return mutate(() => { if (t.dataset.open === 'w') o.w = +t.value; else o.kind = t.value; });
    }
  }

  // ---------- modals ----------
  function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="mbox">${html}</div>`; m.classList.add('on'); }
  function closeModal() { $('#modal').classList.remove('on'); }
  function showBriefs() {
    modal(`<h2>Aaj kiska ghar banayein?</h2><p class="hint">Client chuno. Har client ki apni maang aur budget hai. Sab poora karo to 3 star!</p>
      <div class="briefs">${BRIEFS.map(b => `<button class="bcard ${S.brief === b.id ? 'on' : ''}" data-act="pick-brief" data-id="${b.id}" data-testid="brief-${b.id}"><b>${esc(b.name)}</b><small>${esc(b.who)}</small><span>${esc(b.story)}</span><em>Budget ${L(b.budget)}</em></button>`).join('')}</div>`);
  }
  function showHelp() {
    modal(`<h2>Kaise khelein? 🏗️</h2><ol class="help">
      <li><b>Zameen:</b> colony map pe plot chuno ya apne gaj ka custom plot banao.</li>
      <li><b>Naksha:</b> manzil chuno (1-4), "✨ Banao" se auto naksha lo ya khud kamre kheencho. Darwaza, khidki, seedhi lagao. Lal ❌ wali galtiyan theek karo.</li>
      <li><b>Elevation:</b> bahar ka rang, stone/brick cladding, chhat aur railing chuno.</li>
      <li><b>Interior:</b> har kamre ka farsh aur rang, aur furniture rakho.</li>
      <li><b>Ghar Dekho:</b> 3D mein andar ghumo, kharcha aur score dekho.</li></ol>
      <p class="hint">Sab apne aap save hota hai. Ctrl+Z = undo. Delete = hatao. R = furniture ghumao.</p>
      <button class="btn primary" data-act="start" data-testid="start">Chalo shuru karein</button>`);
  }

  function render() { renderTop(); renderSide(); layoutViews(); }

  // ---------- boot ----------
  function boot() {
    const fresh = !load();
    if (fresh) S = Plan.newState('free');
    document.body.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) act(b.dataset.act, b.dataset, b); });
    document.body.addEventListener('change', onChange);
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
    $('#importFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const d = JSON.parse(await f.text()); if (!d || d.v !== 1 || !Array.isArray(d.floors)) throw 0; snapshot(); S = d; built3 = ''; ui.floor = 0; ui.sel = null; changed(); toast('Ghar khul gaya'); } catch (err) { toast('Ye Ghar Banao ki file nahi lagti'); }
      e.target.value = '';
    });
    const c = cv();
    c.addEventListener('pointerdown', onDown); c.addEventListener('pointermove', onMove); c.addEventListener('pointerup', onUp); c.addEventListener('pointercancel', onUp);
    c.addEventListener('wheel', e => { e.preventDefault(); const rc = c.getBoundingClientRect(); zoomAt(e.clientX - rc.left, e.clientY - rc.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); draw(); }, { passive: false });
    $('#zin').onclick = () => { const c2 = cv(); zoomAt(c2.width / dpr / 2, c2.height / dpr / 2, 1.25); draw(); };
    $('#zout').onclick = () => { const c2 = cv(); zoomAt(c2.width / dpr / 2, c2.height / dpr / 2, 0.8); draw(); };
    $('#zfit').onclick = () => { fit(); draw(); };
    $('#helpBtn').onclick = showHelp;
    // walk pad: hold to move
    const pad = $('#v3ui'), held = new Set();
    const upd = () => View3D.move((held.has('f') ? 1 : 0) - (held.has('b') ? 1 : 0), (held.has('l') ? 1 : 0) - (held.has('r') ? 1 : 0));
    pad.addEventListener('pointerdown', e => { const b = e.target.closest('[data-hold]'); if (!b) return; e.preventDefault(); b.setPointerCapture(e.pointerId); held.add(b.dataset.hold); upd(); });
    const rel = e => { const b = e.target.closest('[data-hold]'); if (!b) return; held.delete(b.dataset.hold); upd(); };
    pad.addEventListener('pointerup', rel); pad.addEventListener('pointercancel', rel); pad.addEventListener('lostpointercapture', rel);
    window.addEventListener('keydown', e => {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? doRedo() : doUndo(); }
      if (ui.walk) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { if (ui.sel) { e.preventDefault(); deleteSel(); } }
      if (e.key === 'Escape') { ui.sel = null; ui.tool = 'select'; renderSide(); draw(); }
      if (e.key.toLowerCase() === 'r' && ui.sel?.kind === 'furn') act('rot', {});
    });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { layoutViews(); }, 120); });
    new ResizeObserver(() => sizeCanvas()).observe($('#v2'));
    View3D.init($('#v3c'));
    render();
    schedule3D(true);
    if (fresh) { showHelp(); const onStart = () => { showBriefs(); }; $('#modal').addEventListener('click', function once(e) { if (e.target.closest('[data-act=start]')) { $('#modal').removeEventListener('click', once); setTimeout(onStart, 0); } }); }
    window.__ghar = { get S() { return S; }, ui, Plan };
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
