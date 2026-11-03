// Prep before the session: ticking levels/news outside the session is allowed (no rule-fail pop-up) and counts in the score.
// Run from the repo root:  node tests/trade-gate/prep-session.test.js   (needs Playwright + Chromium)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'petrol-receipts');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const serve = () => new Promise(r => {
  const s = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  s.listen(0, '127.0.0.1', () => r(s));
});
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();

let failures = 0;
async function test(name, fn) { try { await fn(); console.log('ok   -', name); } catch (e) { failures++; console.log('FAIL -', name, '\n      ', e.message); } }

(async () => {
  const server = await serve(), base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-11T23:04:00Z') }); // Wed 6:04 PM ET, market open
  await page.route(/gstatic\.com|faireconomy\.media/, r => r.abort());
  await page.addInitScript(() => {
    localStorage.setItem('gtd.test', 'false');
    localStorage.setItem('gtd.settings', JSON.stringify({ session: { mode: 'custom', start: '20:00', end: '12:00' }, cooldown: 30 }));
  });
  await page.goto(base + '/trade-gate/index.html');
  await page.evaluate(() => { document.getElementById('auth').hidden = true; document.getElementById('app').hidden = false; });
  // an old trade so the app renders offline
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-prep-')), 'b.json');
  fs.writeFileSync(file, JSON.stringify({ trades: [{ id: 'o1', accountId: 'main', date: '2026-11-02', createdAt: Date.parse('2026-11-02T14:00:00Z'), closedAt: Date.parse('2026-11-02T14:10:00Z'), dir: 'short', liq: '15', t15: 'up', t5: 'up', sld: 5, lots: 2, status: 'closed', result: 'tp', pnl: 300, ruleBreaks: [], tags: [], photos: [] }] }));
  await page.click('#tab-settings'); await page.click('#acct summary'); await page.setInputFiles('#bk-file', file);
  await page.waitForTimeout(300); await page.clock.runFor(2000);
  if (await page.isVisible('#focus-start')) await page.click('#fs-ok');
  await page.click('#tab-trade');

  await test('outside the session step 00 waits instead of failing', async () => {
    assert.strictEqual(await text(page, '#c0'), 'Session ka wait');
    assert.match(await text(page, '#m0'), /Prep \(news, focus, levels\) abhi tick kar lo/);
  });
  await test('ticking levels gives no "Mat lo" pop-up and keeps the tick', async () => {
    await page.click('#q-lvl5'); await page.waitForTimeout(200);
    assert.ok(!(await page.isVisible('#pop')), await text(page, '#pop'));
    assert.ok(await page.isChecked('#q-lvl5'));
    assert.strictEqual(await text(page, '#c0'), 'Session ka wait');
    assert.ok(await page.evaluate(() => document.getElementById('s1').disabled)); // later steps stay locked
  });
  await test('the levels tick counts in today\'s Growth score', async () => {
    assert.strictEqual(await page.evaluate(() => window.__tradeGate.todayScore().manual.levels), true);
  });
  await test('when the session starts, step 00 passes with the prep already done', async () => {
    await page.clock.runFor(2 * 3600e3); // → 8:04 PM ET
    await page.click('#q-newsManual').catch(() => {});
    await page.evaluate(() => { const f = document.getElementById('q-focusOk'); if (f && !f.checked && f.closest('label') && !f.closest('label').hidden) f.click(); });
    await page.waitForTimeout(200);
    assert.ok(await page.isChecked('#q-lvl5'));
    assert.notStrictEqual(await text(page, '#c0'), 'Session ka wait');
  });
  await test('no page errors', async () => assert.deepStrictEqual(errors, []));

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed'); process.exit(failures ? 1 : 0);
})();
