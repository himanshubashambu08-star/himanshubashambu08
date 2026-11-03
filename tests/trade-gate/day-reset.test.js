// The Trade tab starts a new day at the 5 PM ET close (test mode, offline).
// Run from the repo root:  node tests/trade-gate/day-reset.test.js   (needs Playwright + Chromium)
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
  // two losses on Wed 11 Nov 2026 (EST = UTC−5)
  const tr = (id, iso) => { const ms = Date.parse(iso); return { id, accountId: '__test_main', date: '2026-11-11', createdAt: ms, closedAt: ms + 600e3, dir: 'short', liq: '15', t15: 'up', t5: 'up', sld: 5, lots: 2, status: 'closed', result: 'sl', pnl: -100, ruleBreaks: [], tags: [], photos: [{ id: 'p', kind: 'setup', thumb: 'data:,' }] }; };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-day-')), 'b.json');
  fs.writeFileSync(file, JSON.stringify({ trades: [tr('a', '2026-11-11T14:00:00Z'), tr('b', '2026-11-11T15:00:00Z')] }));

  const open = async iso => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date(iso) });
    await page.route(/gstatic\.com|faireconomy\.media/, r => r.abort());
    await page.addInitScript(() => localStorage.setItem('gtd.test', 'true'));
    await page.goto(base + '/trade-gate/index.html');
    await page.evaluate(() => { document.getElementById('auth').hidden = true; document.getElementById('app').hidden = false; });
    await page.click('#tab-settings'); await page.click('#acct summary'); await page.setInputFiles('#bk-file', file);
    await page.waitForTimeout(300); await page.clock.runFor(2000);
    if (await page.isVisible('#focus-start')) await page.click('#fs-ok');
    await page.click('#tab-trade');
    return page;
  };
  const errors = [];

  const before = await open('2026-11-11T21:50:00Z'); // 4:50 PM ET, same trading day
  await test('before 5 PM ET: two losses lock the day, with a countdown to the new day', async () => {
    assert.strictEqual(await text(before, '#d-count'), '2'); assert.strictEqual(await text(before, '#d-pnl'), '−$200');
    assert.ok(await before.isVisible('#locked-title')); assert.match(await text(before, '#locked-title'), /Do loss = band/);
    assert.match(await text(before, '#locked-note'), /Naya din 5:00 PM ET pe · 00:(09:\d\d|10:00) baaki/);
  });
  await test('crossing 5 PM ET starts the new day without a reload', async () => {
    await before.clock.runFor(25 * 60e3); // → 5:15 PM ET
    assert.strictEqual(await text(before, '#d-count'), '0'); assert.strictEqual(await text(before, '#d-pnl'), '$0');
    assert.ok(!(await before.isVisible('#locked-title'))); assert.match(await text(before, '#app'), /Trading allowed/);
  });
  await before.close();

  const after = await open('2026-11-11T23:12:00Z'); // 6:12 PM ET → trading day Thu 12 Nov
  await test('opened after 5 PM ET: fresh day, journal keeps yesterday', async () => {
    assert.strictEqual(await text(after, '#d-count'), '0');
    assert.ok(!(await after.isVisible('#locked-title')));
    await after.click('#tab-journal');
    assert.match(await text(after, '#journal'), /−\$200/);
  });
  await test('5:01 PM ET (real mode): market band with the open countdown, old 6 PM setting moved to 5 PM', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-11-11T22:01:00Z') }); // Wed 5:01 PM ET
    await page.route(/gstatic\.com|faireconomy\.media/, r => r.abort());
    await page.addInitScript(() => { localStorage.setItem('gtd.test', 'false'); localStorage.setItem('gtd.gs', JSON.stringify({ on: true, reset: '18:00' })); });
    await page.goto(base + '/trade-gate/index.html');
    await page.evaluate(() => { document.getElementById('auth').hidden = true; document.getElementById('app').hidden = false; });
    await page.click('#tab-settings'); await page.click('#acct summary'); await page.setInputFiles('#bk-file', file);
    await page.waitForTimeout(300); await page.clock.runFor(2000);
    if (await page.isVisible('#focus-start')) await page.click('#fs-ok');
    await page.click('#tab-trade');
    assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('gtd.gs')).reset || ''), '17:00');
    assert.match(await text(page, '#status'), /Khulne me 00:5\d:\d\d/);
    await page.close();
  });
  await test('no page errors', async () => assert.deepStrictEqual(errors, []));

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed'); process.exit(failures ? 1 : 0);
})();
