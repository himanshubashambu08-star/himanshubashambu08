// Trading-day boundary tests for Gold Trade Gate's Daily Growth Score.
// A trade placed Sunday after the 6 PM ET reset belongs to Monday's trading day
// and to Monday's weekly-report week.
//
// Run from the repo root:  node tests/trade-gate/trading-day.test.js
// Needs Playwright with Chromium (require('playwright')).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'petrol-receipts');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

async function openApp(browser, base, nowIso) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date(nowIso) });
  // no network in tests: Firebase and the news feed stay offline, the app runs on local storage
  await page.route(/gstatic\.com|faireconomy\.media/, r => r.abort());
  await page.goto(base + '/trade-gate/index.html');
  await page.waitForFunction(() => window.__tradeGate);
  await page.evaluate(() => { document.getElementById('auth').hidden = true; document.getElementById('app').hidden = false; });
  return { page, errors };
}

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('ok   -', name); }
  catch (e) { failures++; console.log('FAIL -', name, '\n      ', e.message); }
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  // Monday 9 Nov 2026, 10:00 AM EST
  const { page, errors } = await openApp(browser, base, '2026-11-09T15:00:00Z');
  const td = iso => page.evaluate(ms => window.__tradeGate.tradingDate(ms), Date.parse(iso));
  const monday = d => page.evaluate(x => window.__tradeGate.mondayOf(x), d);

  await test('Sunday 6:30 PM ET counts as Monday', async () => assert.strictEqual(await td('2026-11-08T23:30:00Z'), '2026-11-09'));
  await test('Sunday 6:00 PM ET exactly counts as Monday', async () => assert.strictEqual(await td('2026-11-08T23:00:00Z'), '2026-11-09'));
  await test('Sunday 5:59 PM ET stays Sunday', async () => assert.strictEqual(await td('2026-11-08T22:59:00Z'), '2026-11-08'));
  await test('Monday 10 AM ET is Monday', async () => assert.strictEqual(await td('2026-11-09T15:00:00Z'), '2026-11-09'));
  await test('Monday 7 PM ET counts as Tuesday', async () => assert.strictEqual(await td('2026-11-10T00:00:00Z'), '2026-11-10'));
  await test('Sunday 6:30 PM on DST-start day (EDT) counts as Monday', async () => assert.strictEqual(await td('2026-03-08T22:30:00Z'), '2026-03-09'));
  await test('Monday trading day belongs to the week starting that Monday', async () => {
    const d = await td('2026-11-08T23:30:00Z');
    assert.strictEqual(await monday(d), '2026-11-09');
  });
  await test('Friday 4:59 PM ET belongs to the same week', async () => assert.strictEqual(await monday(await td('2026-11-13T21:59:00Z')), '2026-11-09'));

  // UI: a trade placed Sunday 6:30 PM ET scores on Monday and lands in Monday's weekly report
  await test('Sunday-evening trade is scored on Monday and in Monday\'s weekly report', async () => {
    const t = Date.parse('2026-11-08T23:30:00Z');
    const file = path.join(os.tmpdir(), 'tg-sunday-trade.json');
    fs.writeFileSync(file, JSON.stringify({ trades: [{ id: 'sun1', date: '2026-11-08', createdAt: t, closedAt: t + 600e3, dir: 'short', liq: '20', t15: 'up', t5: 'up', sld: 5, lots: 2, status: 'closed', result: 'tp', pnl: 300, ruleBreaks: [], tags: [] }] }));
    await page.click('#tab-settings');
    await page.click('#acct summary');
    await page.setInputFiles('#bk-file', file);
    await page.waitForTimeout(300);
    await page.click('#tab-growth');
    await page.waitForTimeout(200);
    assert.match(await page.textContent('#gs-day-lbl'), /Mon, Nov 9/);
    assert.match((await page.textContent('#gs-cats')).replace(/\s+/g, ''), /Execution50\/50/, 'Monday execution should come from the Sunday-evening trade');
    await page.click('#gs-week-now');
    await page.waitForTimeout(500); // AI tips fail offline; the report is still saved
    const body = (await page.textContent('#gs-week-body')).replace(/\s+/g, ' ');
    assert.match(body, /Mon, Nov 9 – Fri, Nov 13/);
    assert.match(body, /1 din/);
  });

  await test('no page errors', async () => assert.deepStrictEqual(errors, []));

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
