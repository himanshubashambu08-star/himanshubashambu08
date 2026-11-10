// Pardes: plays whole lives through the real UI and checks every one reaches an ending.
// Run from the repo root:  node tests/pardes/playthrough.test.js   (needs Playwright + Chromium)
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

// pick(n, step) chooses an option index for a list of n.
async function playLife(page, base, seed, pick, name = 'Test') {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(`${base}/pardes/?seed=${seed}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('[data-testid=new-life]');
  await page.fill('[data-testid=name]', name);
  await page.click('[data-testid=begin]');
  for (let step = 0; step < 600; step++) {
    if (await page.$('[data-testid=headline]')) break;
    const choices = await page.$$('[data-testid=choice]');
    if (choices.length) { await choices[pick(choices.length, step)].click(); continue; }
    const live = await page.$('[data-testid=live]');
    if (live) {
      // Picking an option redraws the plan, so select by index inside the page.
      for (const [sel, off] of [['input[name=day]', 0], ['input[name=eve]', 1], ['input[name=send]', 2]]) {
        const n = await page.evaluate(q => document.querySelectorAll(q).length, sel);
        if (n) await page.evaluate(([q, i]) => document.querySelectorAll(q)[i].click(), [sel, pick(n, step + off)]);
      }
      await page.click('[data-testid=live]');
      continue;
    }
    const next = await page.$('[data-testid=next]');
    if (next) { await next.click(); continue; }
    throw new Error('stuck: no button at step ' + step + ': ' + (await page.textContent('#app')).slice(0, 200));
  }
  const headline = await page.textContent('[data-testid=headline]');
  const state = await page.evaluate(() => window.__pardes.state());
  return { headline, state, errors };
}

(async () => {
  const server = await serve(), base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const endings = new Set();

  const strategies = {
    first: () => 0,
    last: n => n - 1,
    middle: n => Math.floor(n / 2),
    rotate: (n, step) => step % n,
    rotate2: (n, step) => (step * 7 + 3) % n
  };

  for (const [name, pick] of Object.entries(strategies)) {
    for (const seed of [1, 42]) {
      await test(`a whole life reaches an ending (${name}, seed ${seed})`, async () => {
        const page = await ctx.newPage();
        const r = await playLife(page, base, seed, pick);
        await page.close();
        assert.deepStrictEqual(r.errors, [], 'page errors: ' + r.errors.join('; '));
        assert.ok(r.headline && r.headline.length > 10, 'headline missing');
        assert.ok(r.state.memories.length >= 5, 'album has only ' + r.state.memories.length + ' photos');
        assert.ok(r.state.ledger.length > 10, 'ledger is thin');
        endings.add(r.state.ending.key);
        console.log('       ', r.headline, '|', r.state.ending.key);
      });
    }
  }

  await test('different choices give different endings', async () => {
    assert.ok(endings.size >= 5, `only ${endings.size} distinct endings across 10 lives`);
  });

  await test('the same seed and choices replay the same life', async () => {
    const a = await ctx.newPage(), ra = await playLife(a, base, 7, strategies.rotate); await a.close();
    const b = await ctx.newPage(), rb = await playLife(b, base, 7, strategies.rotate); await b.close();
    assert.strictEqual(ra.state.ending.key, rb.state.ending.key);
    assert.strictEqual(ra.state.money, rb.state.money);
  });

  await test('a saved life continues after reload', async () => {
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(`${base}/pardes/?seed=5`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('[data-testid=new-life]');
    await page.fill('[data-testid=name]', 'Simar');
    await page.click('[data-testid=begin]');
    await page.click('[data-testid=choice] >> nth=0');
    await page.click('[data-testid=next]');
    await page.click('[data-testid=live]');
    const when = await page.textContent('[data-testid=when]');
    await page.reload();
    await page.click('[data-testid=continue]');
    assert.strictEqual(await page.textContent('[data-testid=when]'), when);
    await page.close();
  });

  await test('the phone opens and hides trust', async () => {
    const page = await ctx.newPage();
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(`${base}/pardes/?seed=5`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('[data-testid=new-life]');
    await page.click('[data-testid=begin]');
    await page.click('[data-testid=phone]');
    await page.click('.tabs button:has-text("People")');
    const txt = await page.textContent('.sheet');
    assert.ok(txt.includes('Maa') && txt.includes('Jassi'));
    assert.ok(!/trust/i.test(txt.replace('How they feel about you is never shown', '')), 'trust leaked into the phone');
    await page.close();
  });

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failing` : '\nall passing');
  process.exit(failures ? 1 : 0);
})();
