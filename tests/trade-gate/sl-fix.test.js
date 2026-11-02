// Fixing a wrongly entered SL on a closed trade (test mode, offline).
// Run from the repo root:  node tests/trade-gate/sl-fix.test.js   (needs Playwright + Chromium)
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

  // SL hit, entered as $6 (−$120) while the chart's position tool showed $5
  const ms = Date.parse('2026-11-11T13:59:00Z');
  const tr = { id: 'x1', accountId: '__test_main', date: '2026-11-11', createdAt: ms, closedAt: ms + 600e3, dir: 'short', liq: '15', t15: 'up', t5: 'up', sld: 6, lots: 2, status: 'closed', result: 'sl', pnl: -120, move: -6, ruleBreaks: [], tags: [], photos: [{ id: 'p', kind: 'setup', thumb: 'data:,' }],
    mentor: { verdict: 'setup_ok', headline: 'h', checks: [], stage: 'setup', sl_seen: 5 } };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-sl-')), 'b.json');
  fs.writeFileSync(file, JSON.stringify({ trades: [tr] }));

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-11T15:00:00Z') });
  await page.route(/gstatic\.com|faireconomy\.media/, r => r.abort());
  await page.addInitScript(() => localStorage.setItem('gtd.test', 'true'));
  await page.goto(base + '/trade-gate/index.html');
  await page.evaluate(() => { document.getElementById('auth').hidden = true; document.getElementById('app').hidden = false; });
  await page.click('#tab-settings'); await page.click('#acct summary'); await page.setInputFiles('#bk-file', file);
  await page.waitForTimeout(300); await page.clock.runFor(2000);
  if (await page.isVisible('#focus-start')) await page.click('#fs-ok');
  await page.click('#tab-journal');
  await page.click('details.tr summary .trmid');

  await test('journal flags chart SL vs typed SL', async () => assert.match(await text(page, 'details.tr .slfix'), /Chart me SL ~\$5, journal me \$6/));
  await test('fixing SL to $5 makes the SL hit −$100', async () => {
    await page.click('details.tr .slfix-btn');
    assert.match(await text(page, '#pop'), /Asli SL kitne \$ ka tha/);
    await page.click('#pop-actions .btn:has-text("$5")');
    await page.waitForFunction(() => /−?\$100/.test(document.querySelector('details.tr .trpnl').textContent));
    const row = await text(page, 'details.tr summary');
    assert.match(row, /SL \$5 \(pehle \$6\)/); assert.match(row, /\$100/);
  });
  await test('flag is gone after the fix', async () => {
    await page.click('details.tr summary .trmid');
    assert.match(await text(page, 'details.tr .slfix'), /SL galat likha tha\?/);
  });
  await test('no page errors', async () => assert.deepStrictEqual(errors, []));

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed'); process.exit(failures ? 1 : 0);
})();
