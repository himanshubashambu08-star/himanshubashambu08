// "Aaj ka Focus" tests for Gold Trade Gate (runs in test mode, offline).
// Run from the repo root:  node tests/trade-gate/focus.test.js   (needs Playwright + Chromium)
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

  // Mon and Tue: SL moved on a test-mode trade. Today is Wed 11 Nov 2026, 10 AM ET.
  const tr = (id, iso) => { const ms = Date.parse(iso); return { id, accountId: '__test_main', date: iso.slice(0, 10), createdAt: ms, closedAt: ms + 600e3, dir: 'short', liq: '20', t15: 'up', t5: 'up', sld: 5, lots: 2, status: 'closed', result: 'tp', pnl: 300, ruleBreaks: ['SL moved'], tags: [], photos: [{ id: 'p', kind: 'setup', thumb: 'data:,' }] }; };
  const file = path.join(os.tmpdir(), 'tg-focus.json');
  fs.writeFileSync(file, JSON.stringify({ trades: [tr('m1', '2026-11-09T15:00:00Z'), tr('t1', '2026-11-10T15:00:00Z')] }));

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-11T15:00:00Z') });
  await page.route(/gstatic\.com|faireconomy\.media/, r => r.abort());
  await page.addInitScript(() => localStorage.setItem('gtd.test', 'true'));
  await page.goto(base + '/trade-gate/index.html');
  await page.evaluate(() => { document.getElementById('auth').hidden = true; document.getElementById('app').hidden = false; });
  await page.click('#tab-settings'); await page.click('#acct summary'); await page.setInputFiles('#bk-file', file);
  await page.waitForTimeout(300); await page.clock.runFor(2000);

  await test('start card shows yesterday\'s costliest broken rule and today\'s focus', async () => {
    assert.ok(await page.isVisible('#focus-start'));
    const t = await text(page, '#focus-start');
    assert.match(t, /SL \$4–6 aur kabhi move nahi −10/);
    assert.match(t, /SL \$5 pe set karo aur move mat karo/);
  });
  await test('repeat mistake is flagged (2x in 7 days)', async () => assert.match(await text(page, '#focus-start'), /Repeat galti \(2x is hafte\)/));
  await page.click('#fs-ok'); await page.click('#tab-trade');
  await test('trade gate shows the focus box', async () => assert.match(await text(page, '#focus-box'), /SL \$5 pe set karo/));
  await test('step 00 needs the focus tick', async () => {
    await page.click('#q-lvl5'); assert.strictEqual(await text(page, '#c0'), 'Rule fail');
    await page.click('#q-focusOk'); assert.strictEqual(await text(page, '#c0'), 'Pass');
  });
  await test('a clean trade today marks the mistake as fixed', async () => {
    for (const s of ['#q-dir-short', '#q-liq-20', '#q-fail-no', '#q-t15-up', '#q-t5-up']) await page.click(s + ' + span');
    for (const s of ['#q-reached', '#q-broke']) await page.click(s);
    await page.click('#q-sld-5 + span'); await page.click('#q-nomove'); await page.click('#q-alert');
    await page.click('#pop-actions .btn:not(.ghost)');
    for (const s of ['#res-tp', '#mv-no', '#wt-no', '#tag-0']) await page.click(s + ' + span');
    await page.click('#close-btn'); await page.click('#pop-actions .btn');
    await page.click('#tab-growth');
    const chips = await text(page, '#gs-chips');
    assert.match(chips, /Kal ki galti fix ki/); assert.match(chips, /Fix streak 1/);
  });
  await test('no page errors', async () => assert.deepStrictEqual(errors, []));

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed'); process.exit(failures ? 1 : 0);
})();
