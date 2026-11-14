/* Ghar Banao: 3D model of the house (three.js r128, global THREE). 1 unit = 1 ft, Y up.
   Plan (x, y) maps to world (x - W/2, z = y - D/2), so the road is toward +Z. */
'use strict';

const View3D = (() => {
  const PL = 1.5, SLAB = 0.5, T = 0.75, EYE = 5.3;
  let renderer, scene, camera, host, root, sun, hemi, ok = false, dirty = true, running = false;
  let furnFloor = 0, st = null, opts = {}, mode = 'orbit', colliders = [], levels = [], bounds = { W: 30, D: 60, top: 30 };
  const orbit = { theta: -0.75, phi: 1.05, r: 110, tx: 0, ty: 10, tz: 0 };
  const walk = { x: 0, z: 0, y: EYE, yaw: 0, pitch: -0.05, f: 0, keys: {}, move: { f: 0, t: 0 } };
  const texCache = {}, matCache = {};

  // ---------- textures ----------
  function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = v => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
    return '#' + ((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1);
  }
  function tex(kind, color, line) {
    const key = kind + color + line; if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), R = rng(key.length * 97 + color.charCodeAt(2));
    x.fillStyle = color; x.fillRect(0, 0, 256, 256);
    const L = line || shade(color, -0.2);
    if (kind === 'tiles') { x.strokeStyle = L; x.lineWidth = 3; for (let i = 0; i <= 256; i += 128) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
      for (let i = 0; i < 4; i++) { x.fillStyle = shade(color, (R() - 0.5) * 0.06); x.fillRect((i % 2) * 128 + 2, (i >> 1) * 128 + 2, 124, 124); } }
    else if (kind === 'marble') { for (let i = 0; i < 9; i++) { x.strokeStyle = shade(L, R() * 0.3); x.globalAlpha = 0.35 + R() * 0.4; x.lineWidth = 0.6 + R() * 1.8; x.beginPath(); let px = R() * 256, py = 0; x.moveTo(px, py); while (py < 256) { px += (R() - 0.5) * 40; py += 10 + R() * 25; x.lineTo(px, py); } x.stroke(); } x.globalAlpha = 1; x.strokeStyle = shade(color, -0.08); x.lineWidth = 2; x.strokeRect(0, 0, 256, 256); }
    else if (kind === 'wood' || kind === 'woodpanel') { const n = 6; for (let i = 0; i < n; i++) { x.fillStyle = shade(color, (R() - 0.5) * 0.18); const w = 256 / n; if (kind === 'wood') x.fillRect(0, i * w, 256, w - 2); else x.fillRect(i * w, 0, w - 3, 256);
        x.strokeStyle = shade(color, -0.25); x.globalAlpha = 0.35; for (let j = 0; j < 5; j++) { x.beginPath(); const o = R() * w; if (kind === 'wood') { x.moveTo(0, i * w + o); x.bezierCurveTo(80, i * w + o + 3, 170, i * w + o - 3, 256, i * w + o); } else { x.moveTo(i * w + o, 0); x.bezierCurveTo(i * w + o + 3, 80, i * w + o - 3, 170, i * w + o, 256); } x.stroke(); } x.globalAlpha = 1; }
      if (kind === 'wood') { x.fillStyle = shade(color, -0.35); for (let i = 0; i < n; i++) x.fillRect(((i * 97) % 200) + 20, i * 256 / n, 2, 256 / n); } }
    else if (kind === 'granite') { for (let i = 0; i < 2600; i++) { x.fillStyle = R() < 0.5 ? shade(color, 0.25 + R() * 0.3) : shade(color, -0.4); x.fillRect(R() * 256, R() * 256, 1 + R() * 2.5, 1 + R() * 2.5); } x.strokeStyle = L; x.lineWidth = 2; x.strokeRect(0, 0, 256, 256); }
    else if (kind === 'paver') { x.strokeStyle = L; x.lineWidth = 3; for (let r = 0; r < 4; r++) { x.beginPath(); x.moveTo(0, r * 64); x.lineTo(256, r * 64); x.stroke(); for (let k = 0; k < 3; k++) { const px = (k * 128 + (r % 2) * 64) % 256; x.beginPath(); x.moveTo(px, r * 64); x.lineTo(px, r * 64 + 64); x.stroke(); } } }
    else if (kind === 'grass') { for (let i = 0; i < 1800; i++) { x.strokeStyle = shade(color, (R() - 0.5) * 0.35); x.beginPath(); const px = R() * 256, py = R() * 256; x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 4, py - 3 - R() * 5); x.stroke(); } }
    else if (kind === 'stone' || kind === 'dholpur') { let y = 0; while (y < 256) { const h = kind === 'dholpur' ? 64 : 18 + R() * 26; let px = -R() * 40; while (px < 256) { const w = kind === 'dholpur' ? 128 : 30 + R() * 60; x.fillStyle = shade(color, (R() - 0.5) * 0.35); x.fillRect(px + 2, y + 2, w - 4, h - 4); px += w; } y += h; } }
    else if (kind === 'brick') { x.fillStyle = shade(color, 0.45); x.fillRect(0, 0, 256, 256); for (let r = 0; r < 8; r++) for (let k = -1; k < 5; k++) { x.fillStyle = shade(color, (R() - 0.5) * 0.3); x.fillRect(k * 64 + (r % 2) * 32 + 2, r * 32 + 2, 60, 28); } }
    else if (kind === 'marbleclad') { x.strokeStyle = shade(color, -0.12); x.lineWidth = 2; x.strokeRect(1, 1, 254, 127); x.strokeRect(1, 128, 254, 127); for (let i = 0; i < 6; i++) { x.strokeStyle = shade(color, -0.25); x.globalAlpha = 0.4; x.beginPath(); let px = R() * 256, py = 0; x.moveTo(px, py); while (py < 256) { px += (R() - 0.5) * 30; py += 20; x.lineTo(px, py); } x.stroke(); } x.globalAlpha = 1; }
    else if (kind === 'asphalt') { for (let i = 0; i < 3000; i++) { x.fillStyle = shade(color, (R() - 0.5) * 0.3); x.fillRect(R() * 256, R() * 256, 2, 2); } }
    else if (kind === 'grill') { x.clearRect(0, 0, 256, 256); x.fillStyle = color; for (let i = 0; i < 256; i += 32) x.fillRect(i, 0, 6, 256); x.fillRect(0, 0, 256, 10); x.fillRect(0, 246, 256, 10); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return (texCache[key] = t);
  }
  function mat(color, o = {}) {
    const key = JSON.stringify([color, o]); if (matCache[key]) return matCache[key];
    const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, transparent: !!o.opacity, opacity: o.opacity ?? 1, emissive: o.emissive || '#000000', emissiveIntensity: o.ei ?? 1, side: o.double ? THREE.DoubleSide : THREE.FrontSide, depthWrite: o.opacity ? false : true, alphaTest: o.alphaTest || 0 });
    if (o.tex) { m.map = tex(o.tex, color, o.line); m.color.set('#ffffff'); m.userData.size = o.size || 4; }
    return (matCache[key] = m);
  }
  const FLOORTEX = { tiles: 'tiles', marble: 'marble', wood: 'wood', granite: 'granite', paver: 'paver', grass: 'grass' };
  function floorMat(key) { const F = FLOORINGS[key] || FLOORINGS.tiles; return mat(F.color, { tex: FLOORTEX[F.pattern] || 'tiles', line: F.line, size: F.size, rough: key === 'marble' || key === 'granite' ? 0.35 : 0.8 }); }
  function cladMat(kind) {
    const map = { stone: ['stone', '#9C958A', 5], brick: ['brick', '#A5533A', 5], wood: ['woodpanel', '#8E5D3A', 6], marble: ['marbleclad', '#ECE8E2', 6], dholpur: ['dholpur', '#D9B48C', 6] };
    const [k, c, s] = map[kind]; return mat(c, { tex: k, size: s });
  }

  // World-scaled UVs so textures tile at a real size on any box face.
  function worldUV(g, ox, oy, oz, mats) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const face = Math.floor(i / 4), m = Array.isArray(mats) ? mats[face] : mats, s = (m && m.userData.size) || 4;
      const x = p.getX(i) + ox, y = p.getY(i) + oy, z = p.getZ(i) + oz;
      let u, v;
      if (Math.abs(n.getY(i)) > 0.5) { u = x; v = z; } else if (Math.abs(n.getX(i)) > 0.5) { u = z; v = y; } else { u = x; v = y; }
      uv.setXY(i, u / s, v / s);
    }
    uv.needsUpdate = true;
  }
  function box(w, h, d, x, y, z, m, parent = root, shadow = true) {
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return null;
    const g = new THREE.BoxGeometry(w, h, d); worldUV(g, x, y, z, m);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z);
    mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  // Local helpers for furniture: y is the bottom of the piece.
  const B = (g, w, h, d, x, y, z, c, o) => box(w, h, d, x, y + h / 2, z, typeof c === 'string' ? mat(c, o) : c, g);
  function C(g, rt, rb, h, x, y, z, c, o, rot) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 18), typeof c === 'string' ? mat(c, o) : c);
    m.position.set(x, y + h / 2, z); if (rot) m.rotation.set(rot[0], rot[1], rot[2]); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }
  function S(g, r, x, y, z, c, o) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat(c, o)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; }

  // ---------- setup ----------
  function init(el) {
    host = el;
    if (typeof THREE === 'undefined') { el.innerHTML = '<div class="v3-fail">3D load nahi hua. Page refresh karo.</div>'; return false; }
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (e) { el.innerHTML = '<div class="v3-fail">Is device pe 3D (WebGL) nahi chal raha.</div>'; return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement); renderer.domElement.className = 'v3-canvas';
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.3, 3000);
    hemi = new THREE.HemisphereLight('#DDEBFF', '#8A7B66', 0.75); scene.add(hemi);
    sun = new THREE.DirectionalLight('#FFF6E6', 0.8); sun.castShadow = true;
    sun.shadow.mapSize.set(window.innerWidth < 700 ? 1024 : 2048, window.innerWidth < 700 ? 1024 : 2048);
    sun.shadow.bias = -0.0006; scene.add(sun); scene.add(sun.target);
    root = new THREE.Group(); scene.add(root);
    new ResizeObserver(resize).observe(el); resize();
    bindInput(renderer.domElement);
    ok = true; loop(); return true;
  }
  function resize() {
    if (!renderer || !host.clientWidth) return;
    renderer.setSize(host.clientWidth, host.clientHeight); camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); dirty = true;
  }
  let last = performance.now();
  function loop() {
    requestAnimationFrame(loop);
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!host || !host.offsetParent) return;
    if (mode === 'walk') stepWalk(dt);
    if (!dirty) return; dirty = false;
    placeCamera(); renderer.render(scene, camera);
  }
  function placeCamera() {
    if (mode === 'walk') {
      camera.position.set(walk.x, walk.y, walk.z);
      camera.lookAt(walk.x - Math.sin(walk.yaw) * Math.cos(walk.pitch), walk.y + Math.sin(walk.pitch), walk.z - Math.cos(walk.yaw) * Math.cos(walk.pitch));
    } else {
      const { r, phi, theta } = orbit;
      camera.position.set(orbit.tx + r * Math.sin(phi) * Math.sin(theta), orbit.ty + r * Math.cos(phi), orbit.tz + r * Math.sin(phi) * Math.cos(theta));
      camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
    }
  }

  // ---------- input ----------
  function bindInput(el) {
    const ptrs = new Map(); let pinch = 0;
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }); pinch = 0; });
    el.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch && mode === 'orbit') orbit.r = Math.max(15, Math.min(600, orbit.r * pinch / dist));
        pinch = dist; dirty = true; return;
      }
      if (mode === 'walk') { walk.yaw -= dx * 0.005; walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - dy * 0.004)); }
      else if (p.b === 2 || p.shift) { const k = orbit.r * 0.0016; orbit.tx -= (dx * Math.cos(orbit.theta)) * k; orbit.tz += (dx * Math.sin(orbit.theta)) * k; orbit.ty = Math.max(0, orbit.ty + dy * k); }
      else { orbit.theta -= dx * 0.007; orbit.phi = Math.max(0.12, Math.min(1.52, orbit.phi - dy * 0.006)); }
      dirty = true;
    });
    const up = e => { ptrs.delete(e.pointerId); pinch = 0; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => { e.preventDefault(); if (mode === 'orbit') { orbit.r = Math.max(15, Math.min(600, orbit.r * (1 + Math.sign(e.deltaY) * 0.1))); dirty = true; } }, { passive: false });
    window.addEventListener('keydown', e => { if (mode === 'walk' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) { walk.keys[e.key.toLowerCase()] = true; if (e.key.startsWith('Arrow')) e.preventDefault(); } });
    window.addEventListener('keyup', e => { walk.keys[e.key.toLowerCase()] = false; });
  }

  // ---------- walking ----------
  function blocked(x, z) {
    const r = 0.8;
    for (const c of colliders) if (c.f === walk.f && x > c.x1 - r && x < c.x2 + r && z > c.z1 - r && z < c.z2 + r) return true;
    return false;
  }
  function floorY() {
    const L = levels[walk.f]; if (!L) return EYE;
    const gx = Math.floor(walk.x + bounds.W / 2), gy = Math.floor(walk.z + bounds.D / 2);
    const inside = gx >= 0 && gy >= 0 && gx < bounds.W && gy < bounds.D && L.mask[gy * bounds.W + gx];
    return (walk.f === 0 && !inside ? 0 : L.y) + EYE;
  }
  function stepWalk(dt) {
    const k = walk.keys;
    let fwd = walk.move.f + ((k.w || k.arrowup) ? 1 : 0) - ((k.s || k.arrowdown) ? 1 : 0);
    let turn = walk.move.t + ((k.a || k.arrowleft) ? 1 : 0) - ((k.d || k.arrowright) ? 1 : 0);
    if (turn) { walk.yaw += turn * dt * 1.8; dirty = true; }
    if (fwd) {
      const sp = 9 * dt * fwd, nx = walk.x - Math.sin(walk.yaw) * sp, nz = walk.z - Math.cos(walk.yaw) * sp;
      if (!blocked(nx, walk.z)) walk.x = nx;
      if (!blocked(walk.x, nz)) walk.z = nz;
      dirty = true;
    }
    const ty = floorY();
    if (Math.abs(walk.y - ty) > 0.01) { walk.y += (ty - walk.y) * Math.min(1, dt * 8); dirty = true; }
  }
  function setMode(m) {
    mode = m; dirty = true;
    if (m === 'walk') {
      walk.f = 0; walk.pitch = -0.05; walk.y = EYE;
      const sp = bounds.spawn;
      if (sp && !blocked(sp.x, sp.z)) { walk.x = sp.x; walk.z = sp.z; walk.yaw = sp.yaw; }
      else { walk.x = -bounds.W / 2 + (bounds.gate ?? bounds.W / 2); walk.z = bounds.D / 2 + 9; walk.yaw = 0; }
    }
  }
  function changeFloor(d) {
    const nf = Math.max(0, Math.min(levels.length - 1, walk.f + d));
    if (nf === walk.f) return false;
    // Arrive on the stairs of the new floor if there are some.
    const L = levels[nf];
    if (L.stairs) { walk.x = L.stairs.x; walk.z = L.stairs.z; }
    walk.f = nf; dirty = true; return true;
  }
  function viewPreset(p) {
    mode = 'orbit';
    const big = Math.max(bounds.W, bounds.D, bounds.top * 1.4);
    if (p === 'front') { orbit.theta = 0; orbit.phi = 1.35; orbit.r = big * 1.8; }
    else if (p === 'top') { orbit.theta = 0; orbit.phi = 0.13; orbit.r = big * 1.7; }
    else if (p === 'back') { orbit.theta = Math.PI; orbit.phi = 1.25; orbit.r = big * 1.8; }
    else { orbit.theta = -0.75; orbit.phi = 1.05; orbit.r = big * 1.9; }
    orbit.tx = 0; orbit.tz = 0; orbit.ty = bounds.top * 0.4; dirty = true;
  }

  // ---------- build ----------
  function clear() {
    root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    scene.remove(root); root = new THREE.Group(); scene.add(root);
    for (const l of [...scene.children]) if (l.isPointLight) scene.remove(l);
  }
  function build(state, o = {}) {
    if (!ok || !state.plot) return;
    st = state; opts = o; clear(); colliders = []; levels = [];
    const P = st.plot, W = P.w, D = P.d, H = st.floorH, n = st.floors.length, E = st.elev;
    const night = !!o.night, cut = o.cut ?? null;
    const X = x => x - W / 2, Z = y => y - D / 2;
    const top = PL + n * H;
    const fresh = bounds.key !== `${W}x${D}`;
    bounds = { W, D, top, key: `${W}x${D}` };
    scene.background = new THREE.Color(night ? '#0E1A2B' : '#CFE4F2');
    scene.fog = new THREE.Fog(night ? '#0E1A2B' : '#CFE4F2', 260, 900);
    hemi.intensity = night ? 0.22 : 0.75; sun.intensity = night ? 0.08 : 0.8;
    sun.position.set(-W * 1.2 - 40, 140, D * 0.9 + 60); sun.target.position.set(0, 0, 0);
    const sc = sun.shadow.camera, ext = Math.max(W, D) * 0.9 + 20; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 500; sc.updateProjectionMatrix();

    const extPaint = mat(E.wall), accent = mat(E.accent), white = mat('#F2F0EC');
    const glass = night ? mat('#FFD38A', { opacity: 0.85, emissive: '#FFB54A', ei: 0.75, rough: 0.2 }) : mat('#9CC9E6', { opacity: 0.38, rough: 0.05, metal: 0.3 });
    const frameM = mat(E.frame, { rough: 0.5, metal: 0.3 });

    // Surroundings: ground, road, neighbours, street trees.
    const groundM = mat('#7DB35F', { tex: 'grass', size: 8 });
    box(900, 0.2, 900, 0, -0.12, 0, groundM, root, false);
    box(700, 0.12, 30, 0, -0.02, D / 2 + 17, mat('#4A4D52', { tex: 'asphalt', size: 10 }), root, false);
    for (let i = -16; i <= 16; i++) box(5, 0.02, 0.5, i * 20, 0.06, D / 2 + 17, mat('#F2F2F2'), root, false);
    box(700, 0.4, 2, 0, 0.1, D / 2 + 1.3, mat('#BDB6AA'), root, false);
    const nbC = ['#D8CBB5', '#C9D2D8', '#E3D3C3', '#CFC7B8'];
    [-1, 1].forEach((s, i) => { for (let k = 0; k < 2; k++) {
      const w = 24, h = 10.5 + ((i + k * 3) % 3) * 6, x = s * (W / 2 + 7 + w / 2 + k * (w + 8)), dd = Math.min(D * 0.55, 45);
      box(w, h, dd, x, h / 2, D / 2 - 10 - dd / 2, mat(nbC[(i + k) % 4]));
      for (let r = 0; r < Math.floor(h / 10); r++) box(5, 4, 0.2, x, 4 + r * 10, D / 2 - 10 + 0.1, mat('#53636E'));
    } });
    for (let i = -6; i <= 6; i++) { if (Math.abs(i * 24) < W / 2 + 4) continue; const g = new THREE.Group(); g.position.set(i * 24, 0, D / 2 + 3.5); C(g, 0.35, 0.5, 8, 0, 0, 0, '#6B4A2F'); S(g, 3.2, 0, 10, 0, '#3E8A3C'); root.add(g); }
    // Plot surface
    box(W, 0.1, D, 0, 0.0, 0, mat('#B9B2A6', { tex: 'paver', size: 2 }), root, false);

    // Boundary wall with a gate in front of the parking.
    const g0 = Plan.grid(st, 0);
    const pk = st.floors[0].rooms.find(r => r.type === 'parking');
    let gx1 = pk ? Math.max(1, pk.x) : Math.round(W / 2 - 5), gx2 = pk ? Math.min(W - 1, pk.x + pk.w) : Math.round(W / 2 + 5);
    if (gx2 - gx1 < 6) { gx1 = Math.max(1, Math.round(W / 2 - 4)); gx2 = Math.min(W - 1, gx1 + 8); }
    bounds.gate = (gx1 + gx2) / 2;
    if (E.boundary) {
      const bw = mat(E.wall), bh = 4.5, coll = (x1, z1, x2, z2) => colliders.push({ f: 0, x1, z1, x2, z2 });
      const seg = (x1, z1, x2, z2) => { box(Math.max(0.5, x2 - x1), bh, Math.max(0.5, z2 - z1), (x1 + x2) / 2, bh / 2, (z1 + z2) / 2, E.clad !== 'none' ? cladMat(E.clad) : bw); box(Math.max(0.5, x2 - x1) + 0.2, 0.25, Math.max(0.5, z2 - z1) + 0.2, (x1 + x2) / 2, bh + 0.12, (z1 + z2) / 2, accent); coll(x1 - 0.25, z1 - 0.25, x2 + 0.25, z2 + 0.25); };
      seg(X(0), Z(0), X(W), Z(0)); seg(X(0), Z(0), X(0), Z(D)); seg(X(W), Z(0), X(W), Z(D));
      seg(X(0), Z(D), X(gx1), Z(D)); seg(X(gx2), Z(D), X(W), Z(D));
      for (const gx of [gx1, gx2]) { box(1.3, 6, 1.3, X(gx), 3, Z(D), accent); S(root, 0.45, X(gx), 6.5, Z(D), '#FFF3C4', night ? { emissive: '#FFD27A', ei: 1 } : {}); }
      // Sliding gate parked behind the wall on the right.
      const gw = gx2 - gx1, gm = mat(E.gate, { tex: 'grill', size: 4, alphaTest: 0.5, double: true, metal: 0.4, rough: 0.5 });
      const gate = box(gw, 5, 0.12, X(Math.min(W - gw / 2 - 0.3, gx2 + gw / 2)), 2.6, Z(D) - 0.6, gm); if (gate) gate.castShadow = false;
    }

    const grids = st.floors.map((_, f) => Plan.grid(st, f));
    const segsAll = st.floors.map((_, f) => Plan.segments(st, f, grids[f]));
    const foot = f => { const g = grids[f], m = new Uint8Array(W * D); for (let i = 0; i < m.length; i++) m[i] = g.own[i] >= 0 && g.rooms[g.own[i]].type !== 'lawn' ? 1 : 0; return m; };
    const anyRoom = f => { const g = grids[f], m = new Uint8Array(W * D); for (let i = 0; i < m.length; i++) m[i] = g.own[i] >= 0 ? 1 : 0; return m; };
    const isOut = (g, i) => Plan.isOutsideOwner(g, i);
    const lights = [];

    for (let f = 0; f < n; f++) {
      if (cut !== null && f > cut) break;
      const g = grids[f], S = segsAll[f], F = st.floors[f], y0 = PL + f * H, wallH = H - SLAB;
      const fm = foot(f);
      const stairsCells = Plan.typeMask(g, 'stairs');
      let sAt = null; for (let i = 0; i < stairsCells.length; i++) if (stairsCells[i]) { const r = g.rooms[g.own[i]]; sAt = { x: X(r.x + r.w / 2), z: Z(r.y + r.d / 2) }; break; }
      levels[f] = { y: y0, mask: anyRoom(f), stairs: sAt };

      // Ground: plinth under the house, parking and lawn at ground level.
      if (f === 0) {
        const pm = new Uint8Array(W * D); for (let i = 0; i < pm.length; i++) pm[i] = fm[i] && g.rooms[g.own[i]].type !== 'parking' ? 1 : 0;
        for (const r of Plan.rects(pm, W, D)) box(r.w, PL - 0.08, r.d, X(r.x + r.w / 2), (PL - 0.08) / 2, Z(r.y + r.d / 2), mat(shade(E.accent, 0.15), { tex: 'stone', size: 4 }));
      }
      // Floor finishes per room.
      g.rooms.forEach((r, i) => {
        const m = new Uint8Array(W * D); for (let k = 0; k < m.length; k++) m[k] = g.own[k] === i ? 1 : 0;
        const low = f === 0 && (r.type === 'parking' || r.type === 'lawn');
        const fy = low ? (r.type === 'lawn' ? 0.12 : 0.3) : y0;
        for (const q of Plan.rects(m, W, D)) box(q.w, 0.1, q.d, X(q.x + q.w / 2), fy - 0.05 + (low ? 0 : 0.0), Z(q.y + q.d / 2), floorMat(r.floor || DEFAULT_FLOOR[r.type]), root, false);
        if (night && !low && !['balcony', 'lawn', 'parking'].includes(r.type) && lights.length < 6 && r.w * r.d >= 100 && (cut === null || f <= cut)) lights.push([X(r.x + r.w / 2), y0 + wallH - 1.2, Z(r.y + r.d / 2)]);
      });

      // Walls with openings.
      const ops = F.open.filter(op => Plan.openingEdge(S, op));
      const sideMat = (owner, face) => {
        if (!isOut(g, owner)) return mat(g.rooms[owner].paint || DEFAULT_WALL[g.rooms[owner].type]);
        const clad = E.clad !== 'none' && (E.cladWhere === 'all' || (E.cladWhere === 'ground' && f === 0) || (E.cladWhere === 'front' && face === 'front'));
        return clad ? cladMat(E.clad) : extPaint;
      };
      for (const sg of S.segs) {
        if (sg.kind === 'rail') { rail(sg, y0, X, Z, f); continue; }
        if (sg.kind !== 'wall') continue;
        const h = sg.o === 'h';
        const mA = sideMat(sg.A, 'back'), mB = sideMat(sg.B, h ? 'front' : 'side');
        const endM = isOut(g, sg.A) || isOut(g, sg.B) ? extPaint : white;
        // BoxGeometry face order: +x, -x, +y, -y, +z, -z
        const mats = h ? [endM, endM, white, white, mB, mA] : [mB, mA, white, white, endM, endM];
        const cuts = ops.filter(op => op.o === sg.o && (h ? op.y : op.x) === sg.k).map(op => { const s = h ? op.x : op.y; return { s: Math.max(s, sg.a), e: Math.min(s + op.w, sg.b), op }; }).filter(c => c.e > c.s).sort((a, b) => a.s - b.s);
        const piece = (a, b, yb, yt, collide) => {
          if (b - a <= 0.001 || yt - yb <= 0.01) return;
          const ext = h ? T / 2 - 0.02 : 0, A = a - (a === sg.a ? ext : 0), Bv = b + (b === sg.b ? ext : 0);
          const len = Bv - A, mid = (A + Bv) / 2;
          if (h) box(len, yt - yb, T, X(mid), y0 + (yb + yt) / 2, Z(sg.k), mats); else box(T, yt - yb, len, X(sg.k), y0 + (yb + yt) / 2, Z(mid), mats);
          if (collide) colliders.push(h ? { f, x1: X(A), x2: X(Bv), z1: Z(sg.k) - T / 2, z2: Z(sg.k) + T / 2 } : { f, x1: X(sg.k) - T / 2, x2: X(sg.k) + T / 2, z1: Z(A), z2: Z(Bv) });
        };
        let p = sg.a;
        for (const c of cuts) {
          piece(p, c.s, 0, wallH, true);
          const isWin = c.op.kind === 'window', bath = isWin && g.rooms[Math.max(sg.A, sg.B)]?.type === 'bath';
          const sill = isWin ? (bath ? 5 : 3) : 0, head = c.op.kind === 'main' ? 7.6 : 7;
          if (sill) piece(c.s, c.e, 0, sill, true);
          piece(c.s, c.e, head, wallH, false);
          p = c.e;
        }
        piece(p, sg.b, 0, wallH, true);
      }
      for (const op of ops) opening(op, S, g, y0, X, Z, glass, frameM, accent, f);

      // Parking pillars
      g.rooms.forEach(r => { if (r.type !== 'parking') return; for (const [px, py] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.d], [r.x + r.w, r.y + r.d]]) { const cx = Math.min(Math.max(px, r.x + 0.5), r.x + r.w - 0.5), cy = Math.min(Math.max(py, r.y + 0.5), r.y + r.d - 0.5); box(1, wallH + (f === 0 ? PL : 0), 1, X(cx), (f === 0 ? 0 : y0) + (wallH + (f === 0 ? PL : 0)) / 2, Z(cy), accent); } });

      // Stairs
      g.rooms.forEach(r => { if (r.type === 'stairs') stairs(r, y0, H, X, Z, mat(shade(E.accent, 0.35)), floorMat(r.floor || 'granite')); });

      // Furniture
      furnFloor = f;
      for (const it of F.furn) furniture(it, f === 0 && isLowAt(g, it) ? (g.rooms[g.own[Math.floor(it.y) * W + Math.floor(it.x)]]?.type === 'lawn' ? 0.17 : 0.35) : y0, X, Z, night);

      // Slab on top of this floor (skipped when cut open).
      if (cut === f) continue;
      const above = f + 1 < n ? anyRoom(f + 1) : null, aboveFoot = f + 1 < n ? foot(f + 1) : null;
      const slab = new Uint8Array(W * D), stUp = f + 1 < n ? Plan.typeMask(grids[f + 1], 'stairs') : null;
      for (let i = 0; i < slab.length; i++) {
        slab[i] = (fm[i] || (above && above[i])) ? 1 : 0;
        if (stUp && stairsCells[i] && stUp[i]) slab[i] = 0;
        if (!stUp && stairsCells[i]) slab[i] = 0;
      }
      const slabM = [accent, accent, mat('#C9C3B8', { tex: 'tiles', size: 2 }), white, accent, accent];
      for (const r of Plan.rects(slab, W, D)) box(r.w, SLAB, r.d, X(r.x + r.w / 2), y0 + H - SLAB / 2, Z(r.y + r.d / 2), slabM);
      const roofTop = f === n - 1;
      // Mumty over the top stairs and a water tank.
      if (roofTop) {
        const sr = Plan.rects(stairsCells, W, D);
        for (const r of sr) {
          const mh = 8.5, cx = X(r.x + r.w / 2), cz = Z(r.y + r.d / 2);
          box(r.w + T, mh, r.d + T, cx, y0 + H + mh / 2 - SLAB, cz, [extPaint, extPaint, accent, white, extPaint, extPaint]);
          box(r.w + T + 1.2, 0.4, r.d + T + 1.2, cx, y0 + H + mh - SLAB + 0.2, cz, accent);
          box(3, 6.8, 0.1, cx, y0 + H - SLAB + 3.4, Z(r.y + r.d) + T / 2 + 0.06, mat('#5A3B26'));
          if (E.roof !== 'sloped') { const tg = new THREE.Group(); tg.position.set(cx + r.w / 4, y0 + H + mh - SLAB + 0.4, cz); C(tg, 1.8, 1.8, 4, 0, 0, 0, '#202326', { rough: 0.6 }); C(tg, 0.6, 1.8, 0.6, 0, 4, 0, '#202326'); root.add(tg); }
        }
      }
      // Parapets around exposed roof.
      const exposed = (x, y) => slab[y * W + x] && !(aboveFoot && aboveFoot[y * W + x]);
      const outer = (x, y) => x < 0 || y < 0 || x >= W || y >= D || (!slab[y * W + x] && !stairsCells[y * W + x]);
      if (!(roofTop && E.roof === 'sloped')) parapets(W, D, exposed, outer, y0 + H, X, Z, E, f + 1);
      if (roofTop && E.roof === 'sloped') slopedRoof(fm, W, D, y0 + H, X, Z);
      if (roofTop && E.roof === 'pergola') pergola(slab, aboveFoot, W, D, y0 + H, X, Z);
    }
    if (cut === null) levels.length = n;
    // Walk mode starts outside the main door, facing it.
    const S0 = segsAll[0], md = st.floors[0].open.find(o => o.kind === 'main' && Plan.openingEdge(S0, o)) || st.floors[0].open.find(o => o.kind === 'door' && Plan.openingEdge(S0, o) && (isOut(grids[0], Plan.openingEdge(S0, o).A) || isOut(grids[0], Plan.openingEdge(S0, o).B)));
    if (md) {
      const e = Plan.openingEdge(S0, md), outB = isOut(grids[0], e.B), d = outB ? 1 : -1;
      bounds.spawn = md.o === 'h' ? { x: X(md.x + md.w / 2), z: Z(md.y) + d * 7, yaw: outB ? 0 : Math.PI } : { x: X(md.x) + d * 7, z: Z(md.y + md.w / 2), yaw: outB ? Math.PI / 2 : -Math.PI / 2 };
    } else bounds.spawn = null;
    if (fresh) viewPreset('corner');
    if (night) {
      for (const p of lights) { const l = new THREE.PointLight('#FFD9A0', 0.55, 30, 2); l.position.set(p[0], p[1], p[2]); scene.add(l); }
      const fl = new THREE.PointLight('#FFE2B0', 0.9, 60, 2); fl.position.set(0, 9, D / 2 + 6); scene.add(fl);
    }
    dirty = true;
  }
  function isLowAt(g, it) {
    const cx = Math.floor(it.x + 0.5), cy = Math.floor(it.y + 0.5), W = g.W;
    const o = g.own[Math.min(g.D - 1, Math.max(0, cy)) * W + Math.min(W - 1, Math.max(0, cx))];
    return o >= 0 && ['parking', 'lawn'].includes(g.rooms[o].type);
  }

  function rail(sg, y0, X, Z, f) {
    const E = st.elev, h = sg.o === 'h', len = sg.b - sg.a, mid = (sg.a + sg.b) / 2, H = 3.4;
    const put = (thick, hh, yb, m) => h ? box(len, hh, thick, X(mid), y0 + yb + hh / 2, Z(sg.k), m) : box(thick, hh, len, X(sg.k), y0 + yb + hh / 2, Z(mid), m);
    if (E.rail === 'concrete') put(0.5, H, 0, mat(E.wall));
    else if (E.rail === 'glass') { put(0.08, H - 0.3, 0.1, mat('#A9D3E8', { opacity: 0.35, rough: 0.05 })); put(0.25, 0.18, H - 0.2, mat('#B8BEC4', { metal: 0.7, rough: 0.3 })); }
    else { const m = put(0.06, H, 0, mat(E.frame, { tex: 'grill', size: 3.4, alphaTest: 0.5, double: true, metal: 0.4 })); if (m) m.castShadow = false; put(0.25, 0.2, H - 0.1, mat(E.frame)); }
    colliders.push(h ? { f, x1: X(sg.a), x2: X(sg.b), z1: Z(sg.k) - 0.3, z2: Z(sg.k) + 0.3 } : { f, x1: X(sg.k) - 0.3, x2: X(sg.k) + 0.3, z1: Z(sg.a), z2: Z(sg.b) });
  }

  function opening(op, S, g, y0, X, Z, glass, frameM, accent, f) {
    const e = Plan.openingEdge(S, op), h = op.o === 'h';
    const outA = Plan.isOutsideOwner(g, e.A), outB = Plan.isOutsideOwner(g, e.B);
    const L = op.w, s = h ? op.x : op.y, k = h ? op.y : op.x;
    const pos = (u, y, off = 0) => h ? [X(s + u), y, Z(k) + off] : [X(k) + off, y, Z(s + u)];
    const sz = (lu, ly, lt) => h ? [lu, ly, lt] : [lt, ly, lu];
    const add = (u, y, lu, ly, lt, m, off = 0) => { const [a, b, c] = sz(lu, ly, lt), [px, py, pz] = pos(u, y, off); return box(a, b, c, px, py, pz, m); };
    if (op.kind === 'window') {
      const bath = g.rooms[outA ? e.B : e.A]?.type === 'bath', sill = bath ? 5 : 3, top = 7, ht = top - sill;
      add(L / 2, y0 + sill + ht / 2, L, ht, 0.06, glass);
      add(L / 2, y0 + top - 0.12, L, 0.25, T + 0.05, frameM); add(L / 2, y0 + sill + 0.12, L, 0.25, T + 0.05, frameM);
      add(0.12, y0 + sill + ht / 2, 0.25, ht, T + 0.05, frameM); add(L - 0.12, y0 + sill + ht / 2, 0.25, ht, T + 0.05, frameM); add(L / 2, y0 + sill + ht / 2, 0.15, ht, 0.2, frameM);
      if (outA || outB) { const dir = outB ? 1 : -1; add(L / 2, y0 + top + 0.5, L + 1.2, 0.25, 1.6, accent, dir * (T / 2 + 0.8)); add(L / 2, y0 + sill - 0.1, L + 0.4, 0.2, 0.5, accent, dir * (T / 2 + 0.2)); }
      return;
    }
    const main = op.kind === 'main', head = main ? 7.6 : 7;
    const wood = mat(main ? '#5A3420' : '#8A5A3B', { tex: 'woodpanel', size: 3 });
    add(0.15, y0 + head / 2, 0.3, head, T + 0.1, frameM); add(L - 0.15, y0 + head / 2, 0.3, head, T + 0.1, frameM); add(L / 2, y0 + head - 0.15, L, 0.3, T + 0.1, frameM);
    // swing into the room side (side B if it is a room)
    const into = !outB ? 1 : -1;
    const leaves = main ? [[0, L / 2, 1], [L, L / 2, -1]] : [[0, L - 0.3, 1]];
    for (const [hu, lw, sgn] of leaves) {
      const grp = new THREE.Group(); const [px, , pz] = pos(hu, 0); grp.position.set(px, y0, pz);
      const leaf = new THREE.Mesh(h ? new THREE.BoxGeometry(lw, head - 0.35, 0.18) : new THREE.BoxGeometry(0.18, head - 0.35, lw), wood); leaf.castShadow = true;
      if (h) leaf.position.set(sgn * lw / 2, (head - 0.35) / 2, 0); else leaf.position.set(0, (head - 0.35) / 2, sgn * lw / 2);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat('#D4AF37', { metal: 0.8, rough: 0.3 }));
      if (h) knob.position.set(sgn * (lw / 2 - 0.35), 3.4 - (head - 0.35) / 2, 0.15); else knob.position.set(0.15, 3.4 - (head - 0.35) / 2, sgn * (lw / 2 - 0.35));
      leaf.add(knob); grp.add(leaf);
      const ang = 1.25 * sgn * into;
      grp.rotation.y = h ? -ang : ang;
      root.add(grp);
    }
    if (main && (outA || outB)) { const dir = outB ? 1 : -1; add(L / 2, y0 + head + 0.6, L + 2.5, 0.3, 3, mat(st.elev.accent), dir * (T / 2 + 1.5)); }
  }

  function stairs(r, y0, H, X, Z, sideM, stepM) {
    const long = r.d >= r.w, Lr = long ? r.d : r.w, Wd = long ? r.w : r.d;
    // u: along long axis from the front end (large y) backwards; v: across.
    const P = (u, v) => long ? [X(r.x + v), Z(r.y + r.d - u)] : [X(r.x + r.w - u), Z(r.y + v)];
    const step = (u, v, lu, lv, yb, hh, m) => { const [px, pz] = P(u, v); const [a, c] = long ? [lv, lu] : [lu, lv]; box(a, hh, c, px, yb + hh / 2, pz, m); };
    const N = 16, rise = H / N;
    if (Wd >= 6) {
      const half = Wd / 2 - 0.25, land = Math.min(4, Wd / 2 + 0.5), tread = (Lr - land - 0.5) / (N / 2);
      for (let i = 0; i < N / 2; i++) step(0.5 + tread * (i + 0.5), Wd * 0.25, tread, half, y0 + rise * i, rise, stepM);
      step(Lr - land / 2, Wd / 2, land, Wd - 0.6, y0 + H / 2 - rise, rise, stepM);
      for (let i = 0; i < N / 2; i++) step(Lr - land - tread * (i + 0.5), Wd * 0.75, tread, half, y0 + H / 2 + rise * i, rise, stepM);
      // centre wall between the flights
      step((Lr - land) / 2 + 0.25, Wd / 2, Lr - land - 0.5, 0.35, y0, H * 0.75, sideM);
    } else {
      const tread = (Lr - 0.5) / N;
      for (let i = 0; i < N; i++) step(0.25 + tread * (i + 0.5), Wd / 2, tread, Wd - 0.6, y0 + rise * i, rise, stepM);
    }
  }

  function parapets(W, D, inside, outer, y, X, Z, E, fl) {
    const m = mat(E.wall), cap = mat(E.accent), hh = 3;
    const runs = [];
    for (let k = 0; k <= D; k++) { let a = null; for (let x = 0; x <= W; x++) {
      const on = x < W && ((k > 0 && inside(x, k - 1) && outer(x, k)) || (k < D && inside(x, k) && outer(x, k - 1)));
      if (on && a === null) a = x; if (!on && a !== null) { runs.push(['h', k, a, x]); a = null; } } }
    for (let k = 0; k <= W; k++) { let a = null; for (let yy = 0; yy <= D; yy++) {
      const on = yy < D && ((k > 0 && inside(k - 1, yy) && outer(k, yy)) || (k < W && inside(k, yy) && outer(k - 1, yy)));
      if (on && a === null) a = yy; if (!on && a !== null) { runs.push(['v', k, a, yy]); a = null; } } }
    for (const [o, k, a, b] of runs) {
      if (o === 'h') { box(b - a + 0.5, hh, 0.5, X((a + b) / 2), y + hh / 2, Z(k), m); box(b - a + 0.7, 0.2, 0.75, X((a + b) / 2), y + hh + 0.1, Z(k), cap); colliders.push({ f: fl, x1: X(a), x2: X(b), z1: Z(k) - 0.25, z2: Z(k) + 0.25 }); }
      else { box(0.5, hh, b - a, X(k), y + hh / 2, Z((a + b) / 2), m); box(0.75, 0.2, b - a + 0.2, X(k), y + hh + 0.1, Z((a + b) / 2), cap); colliders.push({ f: fl, x1: X(k) - 0.25, x2: X(k) + 0.25, z1: Z(a), z2: Z(b) }); }
    }
  }

  function slopedRoof(fm, W, D, y, X, Z) {
    let x1 = W, y1 = D, x2 = 0, y2 = 0;
    for (let yy = 0; yy < D; yy++) for (let x = 0; x < W; x++) if (fm[yy * W + x]) { x1 = Math.min(x1, x); y1 = Math.min(y1, yy); x2 = Math.max(x2, x + 1); y2 = Math.max(y2, yy + 1); }
    if (x2 <= x1) return;
    const o = 1.5, w = x2 - x1 + 2 * o, d = y2 - y1 + 2 * o, rise = Math.min(w, d) * 0.28;
    const alongX = w >= d; // ridge runs along the longer side
    const g = new THREE.BufferGeometry(), hw = (alongX ? d : w) / 2, L = (alongX ? w : d) / 2;
    const v = alongX ? [-L, 0, -hw, L, 0, -hw, L, rise, 0, -L, rise, 0, -L, 0, hw, L, 0, hw, L, rise, 0, -L, rise, 0]
                     : [-hw, 0, -L, -hw, 0, L, 0, rise, L, 0, rise, -L, hw, 0, -L, hw, 0, L, 0, rise, L, 0, rise, -L];
    const idx = alongX ? [0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7] : [0, 1, 2, 0, 2, 3, 4, 7, 6, 4, 6, 5];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals();
    const roofM = mat('#A4492F', { tex: 'brick', size: 3, double: true });
    const uv = []; for (let i = 0; i < v.length; i += 3) uv.push((v[i] + v[i + 2]) / 3, v[i + 1] / 1.5); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, roofM); m.position.set(X((x1 + x2) / 2), y, Z((y1 + y2) / 2)); m.castShadow = true; root.add(m);
    // gable ends
    const gg = new THREE.BufferGeometry();
    const gv = alongX ? [-L + o, 0, -hw + o, -L + o, 0, hw - o, -L + o, rise - 0.3, 0, L - o, 0, -hw + o, L - o, rise - 0.3, 0, L - o, 0, hw - o]
                      : [-hw + o, 0, -L + o, 0, rise - 0.3, -L + o, hw - o, 0, -L + o, -hw + o, 0, L - o, hw - o, 0, L - o, 0, rise - 0.3, L - o];
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gv, 3)); gg.computeVertexNormals();
    const gm = new THREE.Mesh(gg, mat(st.elev.wall, { double: true })); gm.position.copy(m.position); root.add(gm);
  }

  function pergola(slab, aboveFoot, W, D, y, X, Z) {
    let x1 = W, y1 = D, x2 = 0, y2 = 0;
    for (let yy = 0; yy < D; yy++) for (let x = 0; x < W; x++) if (slab[yy * W + x]) { x1 = Math.min(x1, x); y1 = Math.min(y1, yy); x2 = Math.max(x2, x + 1); y2 = Math.max(y2, yy + 1); }
    if (x2 - x1 < 8) return;
    const px1 = x1 + 1, px2 = Math.min(x2 - 1, x1 + 1 + Math.max(8, (x2 - x1) * 0.55)), py1 = y2 - Math.min(14, (y2 - y1) * 0.45), py2 = y2 - 1;
    const wood = mat('#7A4E2E', { tex: 'woodpanel', size: 4 }), hh = 8;
    for (const [px, py] of [[px1, py1], [px2, py1], [px1, py2], [px2, py2]]) box(0.6, hh, 0.6, X(px), y + hh / 2, Z(py), wood);
    box(px2 - px1 + 1, 0.5, 0.5, X((px1 + px2) / 2), y + hh, Z(py1), wood); box(px2 - px1 + 1, 0.5, 0.5, X((px1 + px2) / 2), y + hh, Z(py2), wood);
    for (let x = px1; x <= px2 + 0.01; x += 1.4) box(0.3, 0.6, py2 - py1 + 2, X(x), y + hh + 0.5, Z((py1 + py2) / 2), wood);
  }

  // ---------- furniture ----------
  function furniture(it, y0, X, Z, night) {
    const Fd = FURNITURE[it.type]; if (!Fd) return;
    const w = it.w || Fd.w, d = it.d || Fd.d, c = it.color || Fd.color, b = Plan.furnBox(it);
    const g = new THREE.Group();
    g.position.set(X(b.x + b.w / 2), y0, Z(b.y + b.d / 2)); g.rotation.y = -it.rot * Math.PI / 2;
    if (!['rug', 'plant', 'lamp', 'bike'].includes(it.type)) colliders.push({ f: furnFloor, x1: X(b.x) + 0.2, x2: X(b.x + b.w) - 0.2, z1: Z(b.y) + 0.2, z2: Z(b.y + b.d) - 0.2 });
    const hw = w / 2, hd = d / 2;
    switch (it.type) {
      case 'bed': case 'sbed':
        B(g, w, 1.1, d, 0, 0, 0, c); B(g, w - 0.3, 0.7, d - 0.6, 0, 1.1, 0.2, '#F4F0E8'); B(g, w, 3.6, 0.35, 0, 0, -hd + 0.17, c);
        if (it.type === 'bed') { B(g, w / 2 - 0.6, 0.4, 1.2, -w / 4, 1.8, -hd + 1.2, '#FFFFFF'); B(g, w / 2 - 0.6, 0.4, 1.2, w / 4, 1.8, -hd + 1.2, '#FFFFFF'); } else B(g, w - 0.8, 0.4, 1.2, 0, 1.8, -hd + 1.2, '#FFFFFF');
        B(g, w - 0.1, 0.16, d * 0.5, 0, 1.8, d * 0.22, '#6F8FB5'); break;
      case 'wardrobe':
        B(g, w, 7, d, 0, 0, 0, c); for (let i = 1; i < 3; i++) B(g, 0.05, 6.6, 0.04, -hw + i * w / 3, 0.2, hd, '#2E1F14');
        for (let i = 0; i < 3; i++) B(g, 0.08, 0.8, 0.1, -hw + (i + 0.5) * w / 3 + 0.4, 3.2, hd + 0.03, '#D4AF37', { metal: 0.8 }); break;
      case 'sofa': case 'chair':
        B(g, w, 1.4, d, 0, 0, 0, c); B(g, w, 1.6, 0.7, 0, 1.4, -hd + 0.35, c); B(g, 0.6, 1.0, d, -hw + 0.3, 1.4, 0, c); B(g, 0.6, 1.0, d, hw - 0.3, 1.4, 0, c);
        B(g, w - 1.4, 0.3, d - 0.9, 0, 1.4, 0.3, shade(c, 0.25)); if (it.type === 'sofa') { B(g, 1.2, 1.1, 0.35, -w / 4, 1.6, -hd + 0.9, '#E8C36A'); B(g, 1.2, 1.1, 0.35, w / 4, 1.6, -hd + 0.9, '#C66B4E'); } break;
      case 'ctable': B(g, w - 0.6, 1.3, d - 0.6, 0, 0, 0, '#3A2A1E'); B(g, w, 0.15, d, 0, 1.3, 0, c, { rough: 0.3 }); S(g, 0.3, 0.6, 1.7, 0, '#C8963E'); break;
      case 'tv': B(g, w, 1.6, d, 0, 0, 0, c); B(g, w * 0.7, 2.5, 0.12, 0, 2.2, -hd + 0.25, '#0D0F12', night ? { emissive: '#22406A', ei: 0.6 } : { rough: 0.2 }); B(g, w * 0.22, 0.6, 0.6, -w * 0.33, 1.6, 0, '#7A5136'); break;
      case 'rug': B(g, w, 0.05, d, 0, 0.02, 0, c, { tex: 'tiles', size: 3 }); break;
      case 'lamp': C(g, 0.45, 0.5, 0.15, 0, 0, 0, '#333'); C(g, 0.06, 0.06, 5, 0, 0.15, 0, '#333'); C(g, 0.35, 0.6, 1, 0, 5, 0, c, night ? { emissive: '#FFD27A', ei: 1 } : {}); break;
      case 'dtable': {
        const tw = w * 0.62, td = d * 0.5; B(g, tw, 0.15, td, 0, 2.4, 0, c, { rough: 0.35 });
        for (const [lx, lz] of [[-tw / 2 + 0.3, -td / 2 + 0.3], [tw / 2 - 0.3, -td / 2 + 0.3], [-tw / 2 + 0.3, td / 2 - 0.3], [tw / 2 - 0.3, td / 2 - 0.3]]) B(g, 0.2, 2.4, 0.2, lx, 0, lz, '#3A2A1E');
        const chair = (x, z, r) => { const cg = new THREE.Group(); cg.position.set(x, 0, z); cg.rotation.y = r; B(cg, 1.4, 0.15, 1.4, 0, 1.5, 0, '#C9B48F'); B(cg, 1.4, 1.8, 0.15, 0, 1.5, 0.65, '#7A5136'); for (const [a, bb] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) B(cg, 0.12, 1.5, 0.12, a, 0, bb, '#3A2A1E'); g.add(cg); };
        chair(-tw * 0.25, -td / 2 - 0.8, Math.PI); chair(tw * 0.25, -td / 2 - 0.8, Math.PI); chair(-tw * 0.25, td / 2 + 0.8, 0); chair(tw * 0.25, td / 2 + 0.8, 0);
        chair(-tw / 2 - 0.8, 0, -Math.PI / 2); chair(tw / 2 + 0.8, 0, Math.PI / 2); break; }
      case 'counter':
        B(g, w, 2.8, d, 0, 0, 0, '#D9D3C7'); B(g, w, 0.15, d + 0.1, 0, 2.8, 0.05, '#2B2B2B', { rough: 0.3 }); B(g, w, 2.2, 1.1, 0, 5, -hd + 0.55, '#B9A88F');
        B(g, 2, 0.08, 1.4, w * 0.2, 2.95, 0, '#111'); B(g, 1.8, 0.06, 1.3, -w * 0.25, 2.95, 0, '#AEB4BA', { metal: 0.8, rough: 0.3 }); B(g, 2.2, 1.2, 1.5, w * 0.2, 4.6, -hd + 0.75, '#3C3F44'); break;
      case 'fridge': B(g, w, 6, d, 0, 0, 0, c, { metal: 0.5, rough: 0.35 }); B(g, w * 0.96, 0.04, 0.04, 0, 4.1, hd, '#666'); B(g, 0.1, 1.2, 0.12, w * 0.35, 4.5, hd + 0.05, '#888'); break;
      case 'wc': C(g, 0.6, 0.45, 1.3, 0, 0, 0.2, '#FAFAFA', { rough: 0.2 }); B(g, 1.6, 0.25, 1.9, 0, 1.3, 0.25, '#FFFFFF', { rough: 0.2 }); B(g, 1.6, 1.6, 0.6, 0, 1.3, -hd + 0.3, '#FAFAFA', { rough: 0.2 }); break;
      case 'basin': B(g, 0.5, 2.6, 0.5, 0, 0, 0, '#FAFAFA'); B(g, w, 0.6, d, 0, 2.6, 0, '#FFFFFF', { rough: 0.2 }); B(g, w * 0.9, 2.2, 0.06, 0, 3.8, -hd + 0.05, '#C9DDE8', { metal: 0.6, rough: 0.1 }); break;
      case 'shower': B(g, w, 0.2, d, 0, 0, 0, '#EEEEEE'); B(g, 0.06, 6.5, d, hw, 0.2, 0, mat('#BFE3F0', { opacity: 0.3 })); B(g, w, 6.5, 0.06, 0, 0.2, hd, mat('#BFE3F0', { opacity: 0.3 })); C(g, 0.4, 0.4, 0.1, 0, 6.6, -hd + 0.6, '#AAB'); break;
      case 'tub': B(g, w, 1.8, d, 0, 0, 0, '#F8F8F8', { rough: 0.2 }); B(g, w - 0.5, 0.06, d - 0.5, 0, 1.6, 0, '#9FD3E8', { rough: 0.1 }); break;
      case 'washer': B(g, w, 3, d, 0, 0, 0, c, { rough: 0.3 }); C(g, 0.7, 0.7, 0.06, 0, 1.4, hd, '#3C4A57', {}, [Math.PI / 2, 0, 0]); break;
      case 'mandir': B(g, w, 2.5, d, 0, 0, 0, '#8A5A3B'); B(g, w * 0.8, 2, d * 0.8, 0, 2.5, 0, '#E6C27A'); C(g, 0, w * 0.33, 1.3, 0, 4.5, 0, '#D4A33A', { metal: 0.5, rough: 0.4 }); S(g, 0.12, 0, 3.2, d * 0.35, '#FF9A3C', { emissive: '#FF7A1A', ei: night ? 1.5 : 0.6 }); break;
      case 'desk': B(g, w, 0.12, d, 0, 2.4, 0, c); B(g, 0.15, 2.4, d, -hw + 0.1, 0, 0, c); B(g, 1.2, 2.4, d, hw - 0.6, 0, 0, c); B(g, 1.4, 0.9, 0.1, 0, 2.5, -hd + 0.3, '#222'); B(g, 1.4, 0.2, 1.4, 0, 1.5, hd + 0.8, '#3A3F47'); B(g, 1.4, 1.6, 0.15, 0, 1.6, hd + 1.45, '#3A3F47'); break;
      case 'shelf': B(g, w, 6.5, d, 0, 0, 0, c); for (let r = 0; r < 4; r++) for (let i = 0; i < 5; i++) B(g, w / 6, 1.0, d * 0.7, -hw + (i + 0.7) * w / 5.4, 0.4 + r * 1.55, 0.1, ['#B23A3A', '#2E5E9E', '#E0A030', '#3F8F3A', '#6B4A8A'][(i + r) % 5]); break;
      case 'car':
        B(g, w * 0.95, 1.8, d, 0, 0.8, 0, c, { metal: 0.6, rough: 0.3 }); B(g, w * 0.82, 1.5, d * 0.48, 0, 2.6, -d * 0.04, '#23313D', { metal: 0.4, rough: 0.15 });
        for (const [wx, wz] of [[-hw * 0.88, d * 0.31], [hw * 0.88, d * 0.31], [-hw * 0.88, -d * 0.31], [hw * 0.88, -d * 0.31]]) C(g, 1.1, 1.1, 0.7, wx, 1.1 - 0.35, wz, '#151515', {}, [0, 0, Math.PI / 2]).position.y = 1.1;
        B(g, 0.8, 0.3, 0.1, -hw * 0.6, 1.8, hd, '#FFF6D8', night ? { emissive: '#FFF0C0', ei: 1 } : {}); B(g, 0.8, 0.3, 0.1, hw * 0.6, 1.8, hd, '#FFF6D8', night ? { emissive: '#FFF0C0', ei: 1 } : {}); break;
      case 'bike': B(g, 0.8, 1.4, d * 0.7, 0, 1, 0, c); B(g, 0.9, 0.3, 2, 0, 2.4, -0.5, '#222'); for (const z of [d * 0.36, -d * 0.36]) { const wm = C(g, 0.9, 0.9, 0.3, 0, 0, z, '#151515', {}, [0, 0, Math.PI / 2]); wm.position.y = 0.9; } break;
      case 'plant': C(g, 0.6, 0.45, 1.2, 0, 0, 0, '#B8643E'); S(g, 0.9, 0, 2.1, 0, c); S(g, 0.6, 0.35, 2.7, 0.2, shade(c, 0.15)); break;
      case 'tree': C(g, 0.35, 0.5, 6, 0, 0, 0, '#6B4A2F'); S(g, 2.4, 0, 7.6, 0, c); S(g, 1.7, 1.2, 9, 0.5, shade(c, 0.1)); S(g, 1.6, -1.1, 8.6, -0.6, shade(c, -0.1)); break;
      case 'jhoola': B(g, 0.3, 7, 0.3, -hw + 0.15, 0, 0, c); B(g, 0.3, 7, 0.3, hw - 0.15, 0, 0, c); B(g, w, 0.3, 0.3, 0, 7, 0, c); B(g, w - 1.2, 0.2, 1.6, 0, 1.8, 0, '#C07A4E'); B(g, w - 1.2, 1.4, 0.15, 0, 2, -0.75, '#C07A4E'); for (const x of [-hw + 0.8, hw - 0.8]) B(g, 0.05, 5.2, 0.05, x, 2, 0, '#555'); break;
    }
    root.add(g);
  }

  function shot() { if (!ok) return null; placeCamera(); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }
  return {
    init, build, setMode, changeFloor, viewPreset, shot,
    get mode() { return mode; }, get floor() { return walk.f; }, get ready() { return ok; },
    move(f, t) { walk.move.f = f; walk.move.t = t; },
    poke() { dirty = true; resize(); },
  };
})();
