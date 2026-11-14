// Ghar Banao: plays the architect game through the real UI, stage by stage.
// Run from the repo root:  node tests/ghar-banao/playthrough.test.js   (needs Playwright + Chromium)
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'petrol-receipts');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const serve = () => new Promise(r => {
  const s = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  s.listen(0, '127.0.0.1', () => r(s));
});

let failures = 0;
async function test(name, fn) { try { await fn(); console.log('ok   -', name); } catch (e) { failures++; console.log('FAIL -', name, '\n      ', e.message); } }

const state = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__ghar.S)));
// Screen position of a plan point (in feet) on the 2D canvas.
async function screenOf(page, fx, fy) {
  const box = await page.locator('[data-testid=plan-canvas]').boundingBox();
  const cam = await page.evaluate(() => window.__ghar.ui.cam);
  return { x: box.x + cam.ox + fx * cam.s, y: box.y + cam.oy + fy * cam.s };
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/ghar-banao/`;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.accept(); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await test('first visit shows how to play, then the client list', async () => {
    await page.click('[data-testid=start]');
    await page.click('[data-testid=brief-sharma]');
    assert.strictEqual((await state(page)).brief, 'sharma');
  });

  await test('later stages stay locked until a plot is bought', async () => {
    await page.click('[data-testid=stage-plan]');
    assert.strictEqual(await page.evaluate(() => window.__ghar.ui.stage), 'map');
  });

  await test('tap a 100 gaj plot on the colony map and buy it', async () => {
    const pl = await page.evaluate(() => COLONY.plots.find(q => q.id === 'A-02'));
    const p = await screenOf(page, pl.x + pl.w / 2, pl.y + pl.h / 2);
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('[data-testid=plot-card]');
    assert.match(await page.textContent('[data-testid=plot-card]'), /100 gaj/);
    await page.click('[data-testid=buy-plot]');
    const s = await state(page);
    assert.deepStrictEqual([s.plot.id, s.plot.w, s.plot.d, s.plot.facing, Math.round(s.plot.gaj)], ['A-02', 15, 60, 'N', 100]);
    assert.strictEqual(s.floors.length, 2, '100 gaj starts with two floors');
  });

  await test('custom plot from gaj + frontage gives the right depth', async () => {
    await page.click('summary');
    await page.fill('[data-testid=custom-gaj]', '200');
    await page.fill('#cw', '30');
    await page.click('[data-testid=custom-plot]');
    const s = await state(page);
    assert.deepStrictEqual([s.plot.w, s.plot.d, Math.round(s.plot.gaj)], [30, 60, 200]);
    await page.click('[data-testid=undo]');
    assert.strictEqual((await state(page)).plot.id, 'A-02', 'undo brings the bought plot back');
  });

  await test('auto naksha builds a reachable 2-floor house with no hard errors', async () => {
    await page.click('[data-testid=stage-plan]');
    await page.selectOption('[data-ui=bhk]', '3');
    await page.click('[data-testid=auto-layout]');
    const s = await state(page);
    assert.ok(s.floors[0].rooms.length >= 5 && s.floors[1].rooms.length >= 4);
    assert.ok(s.floors[0].open.some(o => o.kind === 'main'), 'main door placed');
    const bad = await page.evaluate(() => window.__ghar.Plan.checks(window.__ghar.S, 0).filter(c => c.lvl === 'bad').map(c => c.t));
    assert.deepStrictEqual(bad, []);
  });

  await test('add floors with + up to 4, and remove one', async () => {
    await page.click('[data-testid=floors-plus]');
    assert.strictEqual((await state(page)).floors.length, 3);
    assert.match(await page.textContent('[data-testid=checks]'), /khaali/);
    await page.click('[data-testid=floors-minus]');
    assert.strictEqual((await state(page)).floors.length, 2);
  });

  await test('draw a room by dragging, then undo it', async () => {
    await page.click('[data-testid=floor-0]');
    const before = (await state(page)).floors[0].rooms.length;
    await page.click('[data-testid=tool-room]');
    await page.click('[data-testid=rtype-pooja]');
    const a = await screenOf(page, 2, 1), b = await screenOf(page, 7, 3);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
    const s = await state(page);
    assert.strictEqual(s.floors[0].rooms.length, before + 1);
    const r = s.floors[0].rooms[s.floors[0].rooms.length - 1];
    assert.deepStrictEqual([r.type, r.x, r.y, r.w, r.d], ['pooja', 2, 1, 5, 2]);
    await page.waitForSelector('[data-testid=room-panel]');
    await page.click('[data-testid=undo]');
    assert.strictEqual((await state(page)).floors[0].rooms.length, before);
  });

  await test('door tool snaps to a wall', async () => {
    await page.click('[data-testid=tool-door]');
    // pick the longest plain wall on the ground floor and tap its middle
    const target = await page.evaluate(() => {
      const { Plan, S } = window.__ghar, Sg = Plan.segments(S, 0);
      const free = Sg.segs.filter(g => g.kind === 'wall' && g.b - g.a >= 6 && !S.floors[0].open.some(o => o.o === g.o && (g.o === 'h' ? o.y : o.x) === g.k && (g.o === 'h' ? o.x : o.y) < g.b && (g.o === 'h' ? o.x : o.y) + o.w > g.a));
      const g = free.sort((p, q) => (q.b - q.a) - (p.b - p.a))[0];
      const m = (g.a + g.b) / 2; return g.o === 'h' ? [m, g.k] : [g.k, m];
    });
    const before = (await state(page)).floors[0].open.length;
    const p = await screenOf(page, target[0], target[1]);
    await page.mouse.click(p.x, p.y);
    const s = await state(page);
    assert.strictEqual(s.floors[0].open.length, before + 1);
    assert.strictEqual(s.floors[0].open[s.floors[0].open.length - 1].kind, 'door');
  });

  await test('elevation: cladding and sloped roof are saved', async () => {
    await page.click('[data-testid=stage-elev]');
    await page.selectOption('[data-testid=clad]', 'brick');
    await page.selectOption('[data-testid=roof]', 'sloped');
    const s = await state(page);
    assert.deepStrictEqual([s.elev.clad, s.elev.roof], ['brick', 'sloped']);
    assert.match(await page.textContent('#side'), /Cladding kharcha: ₹[1-9]/);
  });

  await test('interior: whole-house furnish puts furniture in every floor', async () => {
    await page.click('[data-testid=stage-interior]');
    await page.click('[data-testid=auto-furn]');
    await page.click('[data-testid=ask-yes]');
    const s = await state(page);
    assert.ok(s.floors.every(F => F.furn.length >= 3));
    assert.ok(s.floors[0].furn.some(f => f.type === 'car'), 'car in the parking');
  });

  await test('interior: place a plant by tapping, then rotate it', async () => {
    await page.click('[data-testid=floor-0]');
    const before = (await state(page)).floors[0].furn.length;
    await page.click('[data-testid=furn-plant]');
    const room = (await state(page)).floors[0].rooms.find(r => r.type === 'living');
    const p = await screenOf(page, room.x + room.w - 1.5, room.y + room.d / 2);
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector('[data-testid=furn-panel]');
    await page.click('[data-testid=rotate]');
    const s = await state(page), it = s.floors[0].furn[s.floors[0].furn.length - 1];
    assert.strictEqual(s.floors[0].furn.length, before + 1);
    assert.deepStrictEqual([it.type, it.rot], ['plant', 1]);
  });

  await test('ghar dekho: score, cost table, and walking upstairs', async () => {
    await page.click('[data-testid=stage-view]');
    await page.waitForSelector('[data-testid=result]');
    const score = +(await page.textContent('[data-testid=score]'));
    assert.ok(score >= 0 && score <= 100);
    assert.match(await page.textContent('#side'), /Kharcha \(Estimate\)[\s\S]*Total/);
    await page.click('[data-testid=walk]');
    await page.waitForSelector('[data-testid=go-up]');
    await page.keyboard.down('w'); await page.waitForTimeout(600); await page.keyboard.up('w');
    await page.click('[data-testid=go-up]');
    assert.match(await page.textContent('#v3ui'), /1st floor/);
  });

  await test('the 3D view actually draws pixels', async () => {
    const lit = await page.evaluate(() => {
      const c = document.querySelector('.v3-canvas'), g = c.getContext('webgl') || c.getContext('webgl2');
      const px = new Uint8Array(4); g.readPixels(c.width >> 1, c.height >> 1, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); return px[3];
    });
    assert.strictEqual(lit, 255);
  });

  await test('progress survives a reload', async () => {
    await page.reload();
    const s = await state(page);
    assert.strictEqual(s.plot.id, 'A-02');
    assert.strictEqual(s.elev.roof, 'sloped');
    assert.strictEqual(await page.evaluate(() => window.__ghar.ui.stage), 'view');
  });

  await test('auto naksha has no hard errors on any colony plot, 1-4 floors', async () => {
    const bad = await page.evaluate(() => {
      const { Plan } = window.__ghar, out = [];
      for (const p of COLONY.plots) for (const n of [1, 2, 3, 4]) for (const bhk of [2, 3, 5]) {
        const st = Plan.newState(); st.plot = { w: p.wft, d: p.dft, facing: p.facing, gaj: p.gaj, price: p.price };
        st.setback = p.gaj >= 300 ? { front: 12, back: 6, left: 5, right: 5 } : p.gaj >= 180 ? { front: 8, back: 4, left: 3, right: 3 } : p.dft >= 50 ? { front: 6, back: 3, left: 0, right: 0 } : { front: 3, back: 2, left: 0, right: 0 };
        st.floors = Array.from({ length: n }, () => ({ rooms: [], open: [], furn: [] }));
        st.floors = Plan.autoLayout(st, bhk); st.floors.forEach((_, f) => { Plan.autoOpenings(st, f); Plan.autoFurnish(st, f); });
        for (const c of Plan.checks(st, 0)) if (c.lvl === 'bad') out.push(`${p.id} n${n} ${bhk}bhk: ${c.t}`);
      }
      return out;
    });
    assert.deepStrictEqual(bad.slice(0, 5), []);
  });

  await test('phone: no sideways scroll on any stage', async () => {
    const ph = await browser.newPage({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });
    ph.on('pageerror', e => errors.push('phone: ' + e.message));
    await ph.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await ph.goto(base);
    await ph.click('[data-testid=start]');
    await ph.click('[data-testid=brief-free]');
    for (const st of ['map', 'plan', 'elev', 'interior', 'view']) {
      await ph.click(`[data-testid=stage-${st}]`);
      await ph.waitForTimeout(150);
      const [sw, w] = await ph.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert.ok(sw <= w, `${st}: page is ${sw}px wide on a ${w}px screen`);
    }
    await ph.close();
  });

  await test('no page errors', async () => { assert.deepStrictEqual(errors, []); });

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
