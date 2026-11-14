/* Ghar Banao: plan geometry, rules, auto layout and costing. Pure functions over the game state.
   Plan coords: x to the right, y downward; the road is below the plot (large y = front). 1 unit = 1 ft. */
'use strict';

const Plan = (() => {
  const CIRC = new Set(['living', 'dining', 'lobby', 'stairs']);
  const OPEN = new Set(['balcony', 'parking']);
  const T = t => ROOM_TYPES[t] || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function newState(briefId = 'free') {
    return {
      v: 1, brief: briefId, seq: 1, name: 'Mera Ghar',
      plot: null,
      setback: { front: 5, back: 3, left: 0, right: 0 },
      floorH: 10, quality: 'standard',
      floors: [{ rooms: [], open: [], furn: [] }],
      elev: { wall: '#F4EFE6', accent: '#59636B', clad: 'stone', cladWhere: 'front', roof: 'flat', rail: 'glass', frame: '#2F363C', boundary: true, gate: '#2F363C', lights: true },
    };
  }
  const uid = st => 'i' + (st.seq++);

  // Rasterise one floor: own[y*W+x] = room index (later rooms win).
  function grid(st, f) {
    const W = st.plot.w, D = st.plot.d, own = new Int16Array(W * D).fill(-1);
    const rooms = st.floors[f] ? st.floors[f].rooms : [];
    rooms.forEach((r, i) => {
      for (let y = Math.max(0, r.y); y < Math.min(D, r.y + r.d); y++)
        for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) own[y * W + x] = i;
    });
    return { W, D, own, rooms };
  }
  const at = (g, x, y) => (x < 0 || y < 0 || x >= g.W || y >= g.D) ? -1 : g.own[y * g.W + x];

  function edgeKind(ta, tb) {
    const inA = ta && ta !== 'lawn', inB = tb && tb !== 'lawn';
    if (!inA && !inB) return null;
    if (inA && inB) {
      if (CIRC.has(ta) && CIRC.has(tb)) return null;
      if (OPEN.has(ta) && OPEN.has(tb)) return null;
      return 'wall';
    }
    const t = inA ? ta : tb;
    if (t === 'balcony') return 'rail';
    if (t === 'parking') return null;
    return 'wall';
  }

  // Wall segments for a floor, merged along grid lines. h: line y=k from x=a..b, A above, B below.
  // v: line x=k from y=a..b, A left, B right. Also returns per-unit-edge lookups.
  function segments(st, f, g = grid(st, f)) {
    const { W, D, rooms } = g, segs = [];
    const hk = new Array((D + 1) * W).fill(null), vk = new Array((W + 1) * D).fill(null);
    const typ = i => i < 0 ? null : rooms[i].type;
    const kindOf = (a, b) => a === b ? null : edgeKind(typ(a), typ(b));
    for (let k = 0; k <= D; k++) {
      let run = null;
      for (let x = 0; x < W; x++) {
        const A = at(g, x, k - 1), B = at(g, x, k), kind = kindOf(A, B);
        hk[k * W + x] = kind ? { kind, A, B } : null;
        const key = kind ? `${A},${B},${kind}` : null;
        if (run && key && run.key === key) run.b = x + 1;
        else { if (run) segs.push(run); run = key ? { o: 'h', k, a: x, b: x + 1, A, B, kind, key } : null; }
      }
      if (run) segs.push(run);
    }
    for (let k = 0; k <= W; k++) {
      let run = null;
      for (let y = 0; y < D; y++) {
        const A = at(g, k - 1, y), B = at(g, k, y), kind = kindOf(A, B);
        vk[y * (W + 1) + k] = kind ? { kind, A, B } : null;
        const key = kind ? `${A},${B},${kind}` : null;
        if (run && key && run.key === key) run.b = y + 1;
        else { if (run) segs.push(run); run = key ? { o: 'v', k, a: y, b: y + 1, A, B, kind, key } : null; }
      }
      if (run) segs.push(run);
    }
    const edge = (o, k, i) => o === 'h' ? (k >= 0 && k <= D && i >= 0 && i < W ? hk[k * W + i] : null)
                                        : (k >= 0 && k <= W && i >= 0 && i < D ? vk[i * (W + 1) + k] : null);
    return { segs, edge, g };
  }

  // Is an opening fully on wall edges? Returns the edge info at its middle or null.
  function openingEdge(S, op) {
    const k = op.o === 'h' ? op.y : op.x, s = op.o === 'h' ? op.x : op.y;
    for (let i = s; i < s + op.w; i++) {
      const e = S.edge(op.o, k, i);
      if (!e || e.kind !== 'wall') return null;
    }
    return S.edge(op.o, k, Math.floor(s + op.w / 2 - 0.01));
  }

  // Snap a tap to the nearest wall that can take an opening of width w.
  function snapOpening(st, f, px, py, w) {
    const S = segments(st, f);
    let best = null;
    for (const o of ['h', 'v']) {
      const k = Math.round(o === 'h' ? py : px), dist = Math.abs((o === 'h' ? py : px) - k);
      if (dist > 1.6) continue;
      const c = Math.round((o === 'h' ? px : py) - w / 2);
      for (let off = 0; off <= w + 1; off++) {
        let found = null;
        for (const s of off ? [c - off, c + off] : [c]) {
          const op = o === 'h' ? { o, x: s, y: k, w } : { o, x: k, y: s, w };
          if (openingEdge(S, op)) { found = op; break; }
        }
        if (found) { const score = dist + off * 0.3; if (!best || score < best.score) best = { ...found, score }; break; }
      }
    }
    if (!best) return null;
    delete best.score;
    return best;
  }

  const overlap1 = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  function openingsClash(list, op, skipId) {
    return list.some(q => q.id !== skipId && q.o === op.o && (op.o === 'h' ? q.y === op.y && overlap1(q.x, q.x + q.w, op.x, op.x + op.w) > 0
                                                                           : q.x === op.x && overlap1(q.y, q.y + q.w, op.y, op.y + op.w) > 0));
  }

  // Compass: facing = side of the plot that touches the road (= bottom of the plan).
  const BEAR = { N: 0, E: 90, S: 180, W: 270 };
  function bearing(dx, dy, facing) {
    const a = BEAR[facing] * Math.PI / 180;
    const ex = -dx * Math.cos(a) + dy * Math.sin(a), ny = dx * Math.sin(a) + dy * Math.cos(a);
    return (Math.atan2(ex, ny) * 180 / Math.PI + 360) % 360;
  }
  const SECT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const sector = b => SECT[Math.round(b / 45) % 8];
  // Which compass word sits at the top/right/bottom/left of the plan.
  function planCompass(facing) {
    return { bottom: sector(bearing(0, 1, facing)), top: sector(bearing(0, -1, facing)), right: sector(bearing(1, 0, facing)), left: sector(bearing(-1, 0, facing)) };
  }
  function roomZone(st, r) {
    const cx = r.x + r.w / 2 - st.plot.w / 2, cy = r.y + r.d / 2 - st.plot.d / 2;
    if (Math.hypot(cx / st.plot.w, cy / st.plot.d) < 0.12) return 'C';
    return sector(bearing(cx, cy, st.plot.facing));
  }
  // Outward direction of a door on an exterior wall.
  function openingFacing(st, S, op) {
    const e = openingEdge(S, op); if (!e) return null;
    const outsideA = e.A < 0 || OPEN.has(S.g.rooms[e.A]?.type) || S.g.rooms[e.A]?.type === 'lawn';
    const dx = op.o === 'v' ? (outsideA ? -1 : 1) : 0, dy = op.o === 'h' ? (outsideA ? -1 : 1) : 0;
    return sector(bearing(dx, dy, st.plot.facing));
  }
  const isOutsideOwner = (g, i) => i < 0 || ['lawn', 'parking', 'balcony'].includes(g.rooms[i].type);

  function footprint(st, f) {
    const g = grid(st, f), m = new Uint8Array(g.W * g.D);
    for (let i = 0; i < m.length; i++) m[i] = g.own[i] >= 0 && g.rooms[g.own[i]].type !== 'lawn' ? 1 : 0;
    return { g, m };
  }
  function typeMask(g, type) {
    const m = new Uint8Array(g.W * g.D);
    for (let i = 0; i < m.length; i++) m[i] = g.own[i] >= 0 && g.rooms[g.own[i]].type === type ? 1 : 0;
    return m;
  }

  // Merge a 0/1 mask into rectangles.
  function rects(mask, W, D) {
    const used = new Uint8Array(W * D), out = [];
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!mask[i] || used[i]) continue;
      let w = 1; while (x + w < W && mask[i + w] && !used[i + w]) w++;
      let d = 1;
      outer: while (y + d < D) { for (let j = 0; j < w; j++) { const q = (y + d) * W + x + j; if (!mask[q] || used[q]) break outer; } d++; }
      for (let yy = y; yy < y + d; yy++) for (let xx = x; xx < x + w; xx++) used[yy * W + xx] = 1;
      out.push({ x, y, w, d });
    }
    return out;
  }

  function stats(st) {
    const n = st.floors.length, count = {}, maxArea = {}, floorsWith = {};
    for (const t of ROOM_ORDER) { count[t] = 0; maxArea[t] = 0; floorsWith[t] = 0; }
    const s = { gaj: st.plot ? st.plot.w * st.plot.d / GAJ : 0, floors: n, count, maxArea, floorsWith, builtup: [], totalBuilt: 0, beds: 0, stairsOk: true, vastu: {}, roomArea: [] };
    if (!st.plot) return s;
    const grids = st.floors.map((_, f) => grid(st, f));
    grids.forEach((g, f) => {
      const area = new Array(g.rooms.length).fill(0);
      for (const o of g.own) if (o >= 0) area[o]++;
      s.roomArea[f] = area;
      const seen = new Set();
      let built = 0;
      g.rooms.forEach((r, i) => {
        count[r.type]++; maxArea[r.type] = Math.max(maxArea[r.type], area[i]); seen.add(r.type);
        if (r.type !== 'lawn') built += area[i];
      });
      seen.forEach(t => floorsWith[t]++);
      s.builtup[f] = built; s.totalBuilt += built;
    });
    s.beds = count.bedroom + count.master;
    for (let f = 0; f < n - 1; f++) {
      const a = typeMask(grids[f], 'stairs'), b = typeMask(grids[f + 1], 'stairs');
      if (!a.some((v, i) => v && b[i])) s.stairsOk = false;
    }
    // Vastu
    const all = st.floors.flatMap(F => F.rooms);
    s.vastu.kitchenSE = all.some(r => r.type === 'kitchen' && roomZone(st, r) === 'SE');
    s.vastu.poojaNE = all.some(r => r.type === 'pooja' && roomZone(st, r) === 'NE');
    s.vastu.masterSW = all.some(r => r.type === 'master' && roomZone(st, r) === 'SW');
    const S0 = segments(st, 0);
    const main = mainDoor(st, S0);
    s.vastu.doorDir = main ? openingFacing(st, S0, main) : null;
    s.vastu.doorNE = ['N', 'NE', 'E'].includes(s.vastu.doorDir);
    return s;
  }

  function mainDoor(st, S0) {
    const ops = st.floors[0].open.filter(o => o.kind === 'main' || o.kind === 'door');
    const ext = ops.filter(o => { const e = openingEdge(S0, o); return e && (isOutsideOwner(S0.g, e.A) || isOutsideOwner(S0.g, e.B)); });
    return ext.find(o => o.kind === 'main') || ext[0] || null;
  }

  // Which rooms can a person actually walk to from the road?
  function reach(st) {
    const n = st.floors.length, grids = [], Ss = [], base = [];
    let N = 1; // node 0 = road
    for (let f = 0; f < n; f++) { grids[f] = grid(st, f); Ss[f] = segments(st, f, grids[f]); base[f] = N; N += grids[f].rooms.length + 1; }
    const adj = Array.from({ length: N }, () => []);
    const link = (a, b) => { adj[a].push(b); adj[b].push(a); };
    const node = (f, i) => i < 0 ? base[f] + grids[f].rooms.length : base[f] + i;
    link(0, node(0, -1));
    for (let f = 0; f < n; f++) {
      const g = grids[f], S = Ss[f];
      // Unit edges with no wall join the two sides (open plan, lawn, parking).
      for (let k = 0; k <= g.D; k++) for (let x = 0; x < g.W; x++) {
        const A = at(g, x, k - 1), B = at(g, x, k); if (A === B || S.edge('h', k, x)) continue;
        link(node(f, A), node(f, B));
      }
      for (let k = 0; k <= g.W; k++) for (let y = 0; y < g.D; y++) {
        const A = at(g, k - 1, y), B = at(g, k, y); if (A === B || S.edge('v', k, y)) continue;
        link(node(f, A), node(f, B));
      }
      for (const op of st.floors[f].open) {
        if (op.kind === 'window') continue;
        const e = openingEdge(S, op); if (e) link(node(f, e.A), node(f, e.B));
      }
      if (f < n - 1) {
        const a = typeMask(g, 'stairs'), b = typeMask(grids[f + 1], 'stairs');
        for (let i = 0; i < a.length; i++) if (a[i] && b[i]) { link(node(f, g.own[i]), node(f + 1, grids[f + 1].own[i])); }
      }
      // The outside of an upper floor is sky, not the road.
    }
    const seen = new Uint8Array(N), q = [0]; seen[0] = 1;
    while (q.length) { const v = q.pop(); for (const w of adj[v]) if (!seen[w]) { seen[w] = 1; q.push(w); } }
    return (f, i) => !!seen[node(f, i)];
  }

  const FLOOR_NAME = f => f === 0 ? 'Ground floor' : f === 1 ? '1st floor' : f === 2 ? '2nd floor' : f === 3 ? '3rd floor' : `${f}th floor`;

  function checks(st, budget) {
    const out = [], add = (lvl, t, f) => out.push({ lvl, t, f });
    if (!st.plot) return out;
    const n = st.floors.length, P = st.plot, sb = st.setback, s = stats(st);
    const canReach = reach(st);
    const total = st.floors.reduce((a, F) => a + F.rooms.length, 0);
    if (!total) { add('bad', 'Abhi koi kamra nahi bana. "Auto Naksha" dabao ya khud kamre banao.'); return out; }
    if (!s.count.kitchen) add('bad', 'Kitchen (rasoi) nahi hai. Khana kahan banega?');
    if (!s.count.bath) add('bad', 'Ek bhi bathroom nahi hai.');
    if (!s.beds) add('warn', 'Koi bedroom nahi hai. Sona kahan hai?');
    for (let f = 0; f < n; f++) {
      const g = grid(st, f), S = segments(st, f, g), F = st.floors[f], fn = FLOOR_NAME(f);
      if (!F.rooms.length) { add('warn', `${fn} khaali hai.`, f); continue; }
      const below = f > 0 ? footprint(st, f - 1).m : null;
      F.rooms.forEach((r, i) => {
        const nm = `${fn}: ${r.name || T(r.type).short}`;
        if (r.x < 0 || r.y < 0 || r.x + r.w > P.w || r.y + r.d > P.d) add('bad', `${nm} plot ke bahar ja raha hai.`, f);
        const area = s.roomArea[f][i];
        if (area === 0) { add('warn', `${nm} poora dusre kamre ke neeche chhup gaya.`, f); return; }
        if (area < r.w * r.d) add('warn', `${nm} kisi aur kamre se overlap ho raha hai.`, f);
        const mn = T(r.type).min;
        if (mn && Math.min(r.w, r.d) < Math.min(...mn) || mn && Math.max(r.w, r.d) < Math.max(...mn)) add('warn', `${nm} bahut chhota hai (kam se kam ${mn[0]}×${mn[1]} ft).`, f);
        if (!['lawn', 'parking', 'balcony'].includes(r.type)) {
          const inZone = r.x >= sb.left && r.y >= sb.back && r.x + r.w <= P.w - sb.right && r.y + r.d <= P.d - sb.front;
          if (!inZone) add('bad', `${nm} setback mein ghus raha hai (aage ${sb.front}, peeche ${sb.back}, side ${sb.left}/${sb.right} ft khaali chhodo).`, f);
        }
        if (f > 0 && below) {
          let un = 0, cells = 0;
          for (let y = r.y; y < r.y + r.d; y++) for (let x = r.x; x < r.x + r.w; x++) if (x >= 0 && y >= 0 && x < P.w && y < P.d && g.own[y * P.w + x] === i) { cells++; if (!below[y * P.w + x]) un++; }
          if (r.type === 'balcony') { if (un > 0 && un > cells * 0.95 && Math.min(r.w, r.d) > 5) add('warn', `${nm} 5 ft se zyada bahar latak raha hai, beam lagegi.`, f); }
          else if (un > 0) add('bad', `${nm} ka ${un} sq ft hawa mein hai, neeche support nahi.`, f);
        }
        if (!canReach(f, i)) add('bad', `${nm} tak pahunchne ka raasta nahi. Darwaza lagao${f > 0 ? ' ya seedhi jodo' : ''}.`, f);
        const t = T(r.type);
        if (t.hab || r.type === 'bath') {
          const win = F.open.some(op => {
            if (op.kind !== 'window') return false;
            const e = openingEdge(S, op); return e && ((e.A === i && isOutsideOwner(g, e.B)) || (e.B === i && isOutsideOwner(g, e.A)));
          });
          if (!win) add('warn', `${nm} mein bahar wali khidki nahi${r.type === 'bath' ? ' (exhaust/ventilator chahiye)' : ', hawa-roshni nahi aayegi'}.`, f);
        }
      });
      const bad = F.open.filter(op => !openingEdge(S, op));
      if (bad.length) add('warn', `${fn}: ${bad.length} darwaze/khidki ab deewar pe nahi hain (kamra hila diya?).`, f);
    }
    if (!s.stairsOk) add('bad', 'Seedhi har floor pe ek hi jagah honi chahiye, abhi floors judd nahi rahe.');
    if (n > 1 && !s.count.stairs) add('bad', 'Upar jaane ke liye seedhi (stairs) banao.');
    const S0 = segments(st, 0);
    if (!mainDoor(st, S0)) add('bad', 'Ground floor pe bahar se andar aane ka darwaza nahi hai.');
    else if (!st.floors[0].open.some(o => o.kind === 'main')) add('tip', 'Tip: "Main Darwaza" tool se bada main gate lagao.');
    const c = cost(st);
    if (budget && c.total > budget) add('bad', `Budget se ₹${fmtL(c.total - budget)} zyada kharcha ho raha hai.`);
    const cover = s.builtup[0] / (P.w * P.d);
    if (cover > 0.85) add('warn', `Ground coverage ${Math.round(cover * 100)}% hai, thodi khuli jagah chhodo.`);
    if (!out.some(o => o.lvl === 'bad' || o.lvl === 'warn')) add('ok', 'Naksha ekdum pass! Architect saab khush hain.');
    return out;
  }

  function score(st, budget, brief) {
    const ch = checks(st, budget);
    let sc = 100;
    for (const c of ch) sc -= c.lvl === 'bad' ? 12 : c.lvl === 'warn' ? 4 : 0;
    sc = clamp(sc, 0, 100);
    const s = stats(st);
    const needs = (brief?.needs || []).map(nd => ({ t: nd.t, ok: !!nd.f(s) }));
    const met = needs.filter(x => x.ok).length;
    const v = s.vastu, vastu = [v.kitchenSE, v.poojaNE, v.masterSW, v.doorNE].filter(Boolean).length;
    let stars = sc >= 85 ? 3 : sc >= 65 ? 2 : sc >= 40 ? 1 : 0;
    if (needs.length && met < needs.length) stars = Math.min(stars, met >= needs.length - 1 ? 2 : 1);
    return { score: sc, stars, needs, met, vastu, checks: ch, stats: s };
  }

  // ---------- Costing ----------
  function exteriorWallArea(st) {
    let front = 0, ground = 0, all = 0;
    st.floors.forEach((F, f) => {
      const S = segments(st, f);
      for (const sg of S.segs) {
        if (sg.kind !== 'wall') continue;
        const outA = isOutsideOwner(S.g, sg.A), outB = isOutsideOwner(S.g, sg.B);
        if (outA === outB) continue;
        const a = (sg.b - sg.a) * st.floorH;
        all += a; if (f === 0) ground += a;
        if (sg.o === 'h' && outB) front += a;
      }
    });
    return { front, ground, all };
  }
  function cost(st) {
    const c = { plot: st.plot ? st.plot.price : 0, build: 0, floor: 0, clad: 0, boundary: 0, furn: 0, total: 0, rows: [] };
    if (!st.plot) return c;
    const q = QUALITY[st.quality].rate, s = stats(st);
    st.floors.forEach((F, f) => F.rooms.forEach((r, i) => {
      const a = s.roomArea[f][i];
      const share = r.type === 'lawn' ? 0.1 : OPEN.has(r.type) ? 0.55 : 1;
      c.build += a * q * share;
      c.floor += a * (FLOORINGS[r.floor || DEFAULT_FLOOR[r.type]]?.rate || 0);
    }));
    if (st.elev.clad !== 'none') c.clad = exteriorWallArea(st)[st.elev.cladWhere] * CLADDINGS[st.elev.clad].rate;
    if (st.elev.boundary) c.boundary = (st.plot.w * 2 + st.plot.d * 2) * 1400;
    c.furn = st.floors.reduce((a, F) => a + F.furn.reduce((b, it) => b + (FURNITURE[it.type]?.price || 0), 0), 0);
    c.total = c.plot + c.build + c.floor + c.clad + c.boundary + c.furn;
    c.rows = [['Zameen (plot)', c.plot], [`Construction (${QUALITY[st.quality].name})`, c.build], ['Flooring', c.floor], ['Elevation cladding', c.clad], ['Boundary wall + gate', c.boundary], ['Furniture', c.furn]];
    return c;
  }
  function fmtL(v) {
    if (v >= 1e7) return (v / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
    if (v >= 1e5) return (v / 1e5).toFixed(1).replace(/\.0$/, '') + ' L';
    return Math.round(v).toLocaleString('en-IN');
  }

  // ---------- Auto layout ----------
  function room(st, type, x, y, w, d) {
    return { id: uid(st), type, x, y, w, d, floor: DEFAULT_FLOOR[type], paint: DEFAULT_WALL[type] };
  }
  // Split a row of width W among items: {t, w} fixed or {t, flex}. Too-thin items are dropped.
  function splitRow(items, x0, W) {
    let list = items.slice();
    for (let guard = 0; guard < 6; guard++) {
      const fixed = list.reduce((a, it) => a + (it.w || 0), 0), flex = list.reduce((a, it) => a + (it.flex || 0), 0);
      const free = W - fixed;
      const widths = list.map(it => it.w || (flex ? Math.floor(free * it.flex / flex) : 0));
      const used = widths.reduce((a, b) => a + b, 0);
      const fi = list.findIndex(it => it.flex); if (fi >= 0) widths[fi] += W - used; else if (widths.length) widths[widths.length - 1] += W - used;
      const bad = list.findIndex((it, i) => widths[i] < (it.min || 4));
      if (bad < 0 || list.length === 1) { let x = x0; return list.map((it, i) => { const r = { t: it.t, x, w: widths[i] }; x += widths[i]; return r; }); }
      list.splice(list.reduce((bi, it, i) => (it.drop || 0) > (list[bi].drop || 0) ? i : bi, bad), 1);
    }
    return [];
  }
  function autoLayout(st, bhk) {
    const P = st.plot, sb = st.setback, n = st.floors.length;
    const bx = sb.left, BW = P.w - sb.left - sb.right, BD0 = P.d - sb.front - sb.back;
    const BD = Math.min(BD0, 54), by = sb.back + (BD0 - BD);
    const floors = Array.from({ length: n }, () => ({ rooms: [], open: [], furn: [] }));
    if (BW < 10 || BD < 18) return floors;
    const narrow = BW < 20 && BW >= 10 && BD >= 46; // stilt parking in front, hall behind it
    const rm = clamp(Math.round(BD * 0.28), 10, 13);
    const rb = clamp(Math.round((BD - rm) * 0.5), 9, narrow ? 12 : 16);
    let rbb = rb, rmm = rm, rf = BD - rb - rm;
    if (rf < 9) { const tb = Math.min(9 - rf, rbb - 8); rbb -= tb; rf += tb; }
    if (rf < 9) { const tm = Math.min(9 - rf, rmm - 8); rmm -= tm; rf += tm; }
    const yB = by, yM = by + rbb, yF = by + rbb + rmm;
    const sw = BW >= 24 ? 8 : 7, bathW = BW >= 22 ? 6 : 5;
    const parking = BW >= 20 && rf >= 15;
    let left = bhk;
    const put = (f, row, y, d, items) => splitRow(items, bx, BW).forEach(c => floors[f].rooms.push(room(st, c.t, c.x, y, c.w, d)));
    // Ground floor
    const g0beds = n === 1 ? Math.min(left, BW >= 30 ? 3 : 2) : Math.min(left, 1);
    if (narrow) { floors[0].rooms.push(room(st, 'living', bx, yF, BW, rf - 15), room(st, 'parking', bx, yF + rf - 15, BW, 15)); }
    else put(0, 'F', yF, rf, parking ? [{ t: 'parking', w: Math.min(13, Math.max(10, Math.round(BW * 0.42))), min: 9, drop: 3 }, { t: 'living', flex: 1, min: 9 }] : [{ t: 'living', flex: 1, min: 8 }]);
    put(0, 'M', yM, rmm, [...(n === 1 && BW < 26 ? [] : [{ t: 'stairs', w: sw, min: 6 }]), { t: 'dining', flex: 1, min: 6, drop: 2 }, { t: 'kitchen', w: clamp(Math.round(BW * 0.34), 7, 12), min: 6 }]);
    const back0 = [];
    if (BW >= (g0beds >= 2 ? 38 : 30)) back0.push({ t: 'pooja', w: 5, min: 4, drop: 4 });
    if (g0beds >= 1) back0.push({ t: g0beds >= 1 && n === 1 ? 'master' : 'bedroom', flex: 1, min: 9 });
    if (g0beds >= 2) back0.push({ t: 'bedroom', flex: 1, min: 9, drop: 1 });
    back0.push({ t: 'bath', w: bathW, min: 5 });
    if (!g0beds) back0.unshift({ t: 'study', flex: 1, min: 7 });
    put(0, 'B', yB, rbb, back0);
    if (g0beds >= 3) { // squeeze a third bedroom into the front row
      floors[0].rooms = floors[0].rooms.filter(r => !(r.y === yF));
      put(0, 'F', yF, rf, [...(parking ? [{ t: 'parking', w: 11, min: 9, drop: 3 }] : []), { t: 'living', flex: 1, min: 9 }, { t: 'bedroom', flex: 1, min: 9, drop: 2 }]);
    }
    left -= floors[0].rooms.filter(r => r.type === 'bedroom' || r.type === 'master').length;
    // Upper floors
    const rent = st.brief === 'rent';
    for (let f = 1; f < n; f++) {
      const beds = Math.min(3, Math.max(0, f === n - 1 ? left : Math.ceil(left / (n - f))));
      const bal = Math.min(4, Math.max(sb.front, 3));
      floors[f].rooms.push(room(st, 'balcony', bx, yF + rf, BW, Math.min(bal, P.d - (yF + rf))));
      put(f, 'F', yF, rf, beds >= 2 && !narrow ? [{ t: 'bedroom', flex: 1, min: 9 }, { t: 'bedroom', flex: 1, min: 9 }] : [{ t: beds >= 1 ? 'bedroom' : 'lobby', flex: 1, min: 8 }]);
      put(f, 'M', yM, rmm, [{ t: 'stairs', w: sw, min: 6 }, { t: 'lobby', flex: 1, min: 4, drop: 2 }, { t: 'bath', w: bathW, min: 5 }]);
      const back = [{ t: beds >= 3 || (narrow && beds >= 2) ? 'bedroom' : 'study', flex: 1, min: 8 }];
      if (rent) back.push({ t: 'kitchen', w: clamp(Math.round(BW * 0.34), 7, 10), min: 6 });
      else if (beds >= 3) back.push({ t: 'bath', w: bathW, min: 5, drop: 2 });
      put(f, 'B', yB, rbb, back);
      left -= floors[f].rooms.filter(r => r.type === 'bedroom').length;
    }
    const all = floors.flatMap(F => F.rooms);
    if (!all.some(r => r.type === 'master')) {
      const r = all.filter(r => r.type === 'bedroom').sort((a, b) => b.w * b.d - a.w * a.d)[0];
      if (r) { r.type = 'master'; r.paint = DEFAULT_WALL.master; r.floor = DEFAULT_FLOOR.master; }
    }
    if (BD0 - BD >= 6) floors[0].rooms.push(room(st, 'lawn', bx, sb.back, BW, BD0 - BD));
    if (sb.front >= 6) {
      const pk = floors[0].rooms.find(r => r.type === 'parking');
      const lx = pk ? pk.x + pk.w : bx, lw = bx + BW - lx;
      if (lw >= 6) floors[0].rooms.push(room(st, 'lawn', lx, yF + rf, lw, P.d - (yF + rf)));
    }
    return floors;
  }

  function autoOpenings(st, f) {
    const F = st.floors[f]; F.open = [];
    const S = segments(st, f), g = S.g, rooms = g.rooms;
    const place = (sg, w, kind, fromEnd) => {
      const len = sg.b - sg.a; if (len < w) return false;
      const s0 = fromEnd ? sg.b - w - 1 : sg.a + Math.floor((len - w) / 2);
      for (const s of [s0, sg.a + 1, sg.b - w - 1, sg.a]) {
        if (s < sg.a || s + w > sg.b) continue;
        const op = sg.o === 'h' ? { o: 'h', x: s, y: sg.k, w } : { o: 'v', x: sg.k, y: s, w };
        if (!openingsClash(F.open, op) && openingEdge(S, op)) { F.open.push({ id: uid(st), kind, ...op }); return true; }
      }
      return false;
    };
    const between = (a, b) => S.segs.filter(sg => sg.kind === 'wall' && ((sg.A === a && sg.B === b) || (sg.A === b && sg.B === a))).sort((p, q) => (q.b - q.a) - (p.b - p.a));
    const neighbours = i => [...new Set(S.segs.filter(sg => sg.kind === 'wall' && (sg.A === i || sg.B === i)).map(sg => sg.A === i ? sg.B : sg.A))].filter(j => j >= 0);
    // Main door on the ground floor.
    if (f === 0) {
      const hall = rooms.findIndex(r => r.type === 'living') >= 0 ? rooms.findIndex(r => r.type === 'living') : rooms.findIndex(r => CIRC.has(r.type));
      if (hall >= 0) {
        const ext = S.segs.filter(sg => sg.kind === 'wall' && ((sg.A === hall && isOutsideOwner(g, sg.B)) || (sg.B === hall && isOutsideOwner(g, sg.A))))
          .sort((p, q) => ((q.o === 'h' && q.B !== hall) - (p.o === 'h' && p.B !== hall)) || ((q.b - q.a) - (p.b - p.a)));
        for (const sg of ext) if (place(sg, 4, 'main')) break;
      }
    }
    // One door per room to the best neighbour.
    const pref = r => r.type === 'bath' ? ['master', 'bedroom', 'lobby', 'living', 'dining', 'stairs'] : r.type === 'balcony' ? ['lobby', 'living', 'master', 'bedroom', 'study'] : ['lobby', 'living', 'dining', 'stairs'];
    const done = new Set();
    rooms.forEach((r, i) => {
      if (r.type === 'lawn' || r.type === 'parking' || CIRC.has(r.type)) return;
      const nb = neighbours(i);
      const order = pref(r);
      const pick = nb.slice().sort((a, b) => {
        const ia = order.indexOf(rooms[a].type), ib = order.indexOf(rooms[b].type);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      for (const j of pick) {
        if (r.type === 'bath' && rooms[j].type === 'bath') continue;
        if (['bath', 'kitchen', 'pooja', 'store'].includes(rooms[j].type) && r.type !== 'balcony') continue;
        if (rooms[j].type === 'balcony') continue;
        const key = [Math.min(i, j), Math.max(i, j)].join('-'); if (done.has(key)) break;
        const sgs = between(i, j);
        if (sgs.some(sg => place(sg, 3, 'door'))) { done.add(key); break; }
      }
    });
    // Anyone still shut in gets a door to any friendly neighbour.
    rooms.forEach((r, i) => {
      if (r.type === 'lawn' || r.type === 'parking' || CIRC.has(r.type)) return;
      if ([...done].some(k => k.split('-').map(Number).includes(i))) return;
      for (const j of neighbours(i)) {
        if (rooms[j].type === 'bath' || (r.type === 'bath' && rooms[j].type === 'kitchen' && neighbours(i).length > 1)) continue;
        if (between(i, j).some(sg => place(sg, 3, 'door'))) { done.add([Math.min(i, j), Math.max(i, j)].join('-')); break; }
      }
    });
    // Parking to hall.
    rooms.forEach((r, i) => {
      if (r.type !== 'parking') return;
      const hall = neighbours(i).find(j => CIRC.has(rooms[j].type));
      if (hall !== undefined && !F.open.some(o => o.kind === 'main')) between(i, hall).some(sg => place(sg, 4, 'main'));
    });
    // Windows
    rooms.forEach((r, i) => {
      if (['lawn', 'parking', 'balcony'].includes(r.type)) return;
      const ext = S.segs.filter(sg => sg.kind === 'wall' && ((sg.A === i && isOutsideOwner(g, sg.B)) || (sg.B === i && isOutsideOwner(g, sg.A)))).sort((p, q) => (q.b - q.a) - (p.b - p.a));
      let n = 0;
      for (const sg of ext) {
        const len = sg.b - sg.a;
        const w = r.type === 'bath' || r.type === 'store' || r.type === 'pooja' ? 2 : Math.min(r.type === 'stairs' ? 3 : 5, len - 2);
        if (w < 2) continue;
        if (place(sg, w, 'window')) n++;
        if (n >= (T(r.type).hab ? 2 : 1)) break;
      }
    });
  }

  function furnBox(it) {
    const F = FURNITURE[it.type], w = it.w || F.w, d = it.d || F.d;
    return it.rot % 2 ? { x: it.x, y: it.y, w: d, d: w } : { x: it.x, y: it.y, w, d };
  }
  function autoFurnish(st, f, onlyId) {
    const F = st.floors[f];
    const inRoom = (it, r) => { const b = furnBox(it); return b.x + b.w / 2 >= r.x && b.x + b.w / 2 <= r.x + r.w && b.y + b.d / 2 >= r.y && b.y + b.d / 2 <= r.y + r.d; };
    const targets = F.rooms.filter(r => !onlyId || r.id === onlyId);
    F.furn = F.furn.filter(it => !targets.some(r => inRoom(it, r)));
    for (const r of targets) {
      const add = (type, dx, dy, rot = 0, extra = {}) => {
        const it = { id: uid(st), type, x: 0, y: 0, rot, ...extra }, b = furnBox(it);
        if (b.w > r.w - 0.2 || b.d > r.d - 0.2) return false;
        it.x = Math.round(clamp(r.x + (dx === 'c' ? (r.w - b.w) / 2 : dx < 0 ? r.w - b.w + dx : dx), r.x + 0.1, r.x + r.w - b.w - 0.1) * 2) / 2;
        it.y = Math.round(clamp(r.y + (dy === 'c' ? (r.d - b.d) / 2 : dy < 0 ? r.d - b.d + dy : dy), r.y + 0.1, r.y + r.d - b.d - 0.1) * 2) / 2;
        F.furn.push(it); return true;
      };
      switch (r.type) {
        case 'master': case 'bedroom':
          if (!add('bed', 'c', 0.3)) add('sbed', 0.4, 0.3);
          if (r.d >= 11) add('wardrobe', -0.3, -0.3, 2);
          if (r.type === 'master' && r.w >= 12) add('chair', 0.5, -0.6, 2);
          if (r.w >= 13) add('lamp', 0.4, 0.4);
          break;
        case 'living':
          if (r.d >= 11) add('rug', 'c', 3.8);
          add('sofa', 'c', 0.4); add('ctable', 'c', 4.4);
          if (r.d >= 10) add('tv', 'c', -0.3, 2);
          if (r.w >= 14) { add('chair', 0.5, 4, 1); add('plant', -0.4, 0.4); }
          break;
        case 'dining': add('dtable', 'c', 'c'); if (r.w >= 13) add('fridge', -0.3, 0.3); break;
        case 'kitchen': add('counter', 0.2, 0.2, 0, { w: Math.min(r.w - 0.6, 12) }); add('fridge', 0.3, -0.3, 2); break;
        case 'bath': add('wc', 0.3, 0.2); add('basin', -0.3, 0.2); if (r.d >= 7) add('shower', -0.2, -0.2); break;
        case 'pooja': add('mandir', 'c', 0.2); break;
        case 'study': add('desk', 'c', 0.3); add('shelf', -0.3, -0.2, 2); break;
        case 'lobby': if (r.w >= 8 && r.d >= 6) add('plant', 0.3, 0.3); break;
        case 'balcony': add('plant', 0.3, 'c'); add('plant', -0.3, 'c'); if (r.w >= 10) add('jhoola', 'c', 'c'); break;
        case 'parking': if (!add('car', 'c', 'c')) add('bike', 'c', 'c'); break;
        case 'lawn': if (r.w >= 7 && r.d >= 7) add('tree', 0.5, 'c'); add('plant', -0.4, 0.4); add('plant', -0.4, -0.4); break;
        case 'store': add('washer', 0.2, 0.2); break;
      }
    }
  }

  return { newState, uid, grid, segments, openingEdge, snapOpening, openingsClash, stats, checks, score, cost, fmtL, autoLayout, autoOpenings, autoFurnish, furnBox, rects, footprint, typeMask, planCompass, roomZone, isOutsideOwner, FLOOR_NAME, CIRC, OPEN, room, exteriorWallArea };
})();
if (typeof module !== 'undefined') module.exports = Plan;
