// End-of-day broker screenshot verification tests (test mode, offline; Gemini is stubbed).
// Run from the repo root:  node tests/trade-gate/eod-verify.test.js   (needs Playwright + Chromium)
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

// Firebase modular SDK stubs: the AI answer is whatever the test puts in window.__vfResp
const APP_STUB = "export const getApps=()=>[{name:'mentor'}]; export const initializeApp=()=>({name:'mentor'});";
// window.__vfFail: 'strict' = models reject the JSON schema, 'all' = every call fails
const AI_STUB = "export class GoogleAIBackend{}; export const getAI=()=>({}); export const getGenerativeModel=(ai,o)=>({generateContent:async(parts)=>{window.__vfParts=parts.length; if(window.__vfFail==='all'||(window.__vfFail==='strict'&&o.generationConfig.responseJsonSchema)) throw new Error('[400] schema not supported'); return {response:{text:()=>JSON.stringify(window.__vfResp)}};}})";

let failures = 0;
async function test(name, fn) { try { await fn(); console.log('ok   -', name); } catch (e) { failures++; console.log('FAIL -', name, '\n      ', e.message); } }

(async () => {
  const server = await serve(), base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-vf-'));
  const ms = Date.parse('2026-11-11T14:00:00Z');
  fs.writeFileSync(path.join(tmp, 'b.json'), JSON.stringify({ trades: [{ id: 'w1', accountId: '__test_main', date: '2026-11-11', createdAt: ms, closedAt: ms + 600e3, dir: 'short', liq: '20', t15: 'up', t5: 'up', sld: 5, lots: 2, status: 'closed', result: 'tp', pnl: 300, ruleBreaks: [], tags: [], photos: [{ id: 'p', kind: 'setup', thumb: 'data:,' }] }] }));
  const png = path.join(tmp, 'shot.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-11-11T15:00:00Z') });
  // later routes win in Playwright, so the catch-all abort goes first
  await page.route(/gstatic\.com|faireconomy\.media/, r => r.abort());
  await page.route(/firebasejs\/12\.19\.0\/firebase-app\.js/, r => r.fulfill({ contentType: 'text/javascript', body: APP_STUB }));
  await page.route(/firebasejs\/12\.19\.0\/firebase-ai\.js/, r => r.fulfill({ contentType: 'text/javascript', body: AI_STUB }));
  await page.route(/firebasejs\/12\.19\.0\/firebase-app-check\.js/, r => r.fulfill({ contentType: 'text/javascript', body: 'export const initializeAppCheck=()=>{}; export class ReCaptchaEnterpriseProvider{}' }));
  await page.addInitScript(() => localStorage.setItem('gtd.test', 'true'));
  await page.goto(base + '/trade-gate/index.html');
  await page.evaluate(() => { document.getElementById('auth').hidden = true; document.getElementById('app').hidden = false; });
  await page.click('#tab-settings'); await page.click('#acct summary'); await page.setInputFiles('#bk-file', path.join(tmp, 'b.json'));
  await page.waitForTimeout(300); await page.clock.runFor(2000);
  if (await page.isVisible('#focus-start')) await page.click('#fs-ok');
  await page.click('#tab-growth');

  await test('card is there, button locked until both screenshots', async () => {
    assert.ok(await page.isVisible('#gs-verify'));
    assert.ok(await page.isDisabled('#vf-run'));
    assert.match(await text(page, '#gs-chips'), /Verification baaki/);
    await page.setInputFiles('#vf-dash', png); await page.waitForTimeout(300);
    assert.ok(await page.isDisabled('#vf-run'));
    await page.setInputFiles('#vf-hist', png); await page.waitForFunction(() => !document.getElementById('vf-run').disabled);
  });

  const run = async resp => {
    await page.evaluate(r => { window.__vfResp = r; }, resp);
    await page.click('#vf-run');
    await page.waitForFunction(() => !document.querySelector('#vf-out .loading'));
  };

  await test('matching broker data → verified', async () => {
    await run({ dashboard_found: true, balance: 25300, history_found: true, dates_seen: ['2026-11-11'], trades: [{ time: '09:00', side: 'sell', qty: 2, pnl: 300 }] });
    const out = await text(page, '#vf-out');
    assert.match(out, /Verified: broker aur journal match/); assert.match(out, /Trades match: 1/);
    assert.match(await text(page, '#gs-chips'), /Broker se verified/);
    assert.ok(!(await page.isVisible('#pop')) || !/Untracked/.test(await text(page, '#pop')));
  });

  await test('saved verify has no nested arrays (Firestore rejects them)', async () => {
    const doc = await page.evaluate(() => window.__tradeGate.todayScore());
    const nested = (v, inArr) => Array.isArray(v) ? (inArr || v.some(x => nested(x, true))) : v && typeof v === 'object' ? Object.values(v).some(x => nested(x, false)) : false;
    assert.ok(doc && doc.verify, 'verify saved'); assert.ok(!nested(doc, false), JSON.stringify(doc.verify.checks));
  });
  await test('extra broker trade → mismatch, untracked pop-up', async () => {
    await run({ dashboard_found: true, balance: 25150, history_found: true, dates_seen: ['2026-11-11'], trades: [{ pnl: 300 }, { pnl: -150 }] });
    const out = await text(page, '#vf-out');
    assert.match(out, /Mismatch/); assert.match(out, /Broker me 2 trade, journal me sirf 1/);
    assert.match(await text(page, '#gs-chips'), /Broker mismatch/);
    assert.match(await text(page, '#pop'), /Untracked trade/);
    await page.click('#pop-actions .btn');
  });

  await test('old screenshot (wrong date) is caught', async () => {
    await run({ dashboard_found: true, history_found: true, dates_seen: ['2026-11-05'], trades: [{ pnl: 300 }] });
    assert.match(await text(page, '#vf-out'), /Screenshot aaj ka nahi lagta/);
    await page.click('#pop-actions .btn');
  });

  await test('falls back to plain JSON when the schema is rejected', async () => {
    await page.evaluate(() => { window.__vfFail = 'strict'; });
    await run({ dashboard_found: true, history_found: true, dates_seen: ['2026-11-11'], trades: [{ pnl: 300 }] });
    assert.match(await text(page, '#vf-out'), /Verified/);
  });
  await test('when AI fails, the reason is shown', async () => {
    await page.evaluate(() => { window.__vfFail = 'all'; });
    await run({});
    const out = await text(page, '#vf-out');
    assert.match(out, /AI abhi screenshots nahi padh paya/); assert.match(out, /Detail: \[400\] schema not supported/);
    await page.evaluate(() => { window.__vfFail = null; });
  });
  await test('untracked broker trade is auto-logged as a mistake and counted everywhere', async () => {
    await page.evaluate(() => { const $ = id => document.getElementById(id); $('p-on').checked = true; $('p-size').value = '25000'; $('p-dd').value = '1000'; $('p-daily').value = '600'; $('p-start').value = '2026-11-01'; $('p-save').click(); });
    // one untracked −$28 trade at the broker; Lucid shows the balance after it
    await run({ dashboard_found: true, balance: 25272, history_found: true, dates_seen: ['2026-11-11'], trades: [{ pnl: 300 }, { pnl: -28 }] });
    await page.click('#pop-actions .btn'); // close the "Untracked trade" pop-up
    await page.waitForFunction(() => document.getElementById('d-pnl').textContent === '$272');
    assert.match(await text(page, '#prop-title'), /\$25,272/);
    assert.match(await text(page, '#prop-card'), /\$872 bacha/); // daily room 600 + 272
    assert.strictEqual(await text(page, '#d-count'), '2');
    const out = await text(page, '#vf-out');
    assert.match(out, /Mismatch/); assert.match(out, /Broker me 2 trade, journal me sirf 1/);
    assert.ok(!(await page.$('#vf-sync')));
    await page.click('#tab-journal');
    const st = await text(page, '#stats');
    assert.match(st, /Net P&L ?\$272/); assert.match(st, /Rules followed ?50%/); assert.doesNotMatch(st, /Broker farak/);
    const j = await text(page, '#journal');
    assert.match(j, /untracked/i); assert.match(j, /Bina app ke trade/); assert.match(j, /−\$28/);
    await page.click('#tab-growth');
  });
  await test('re-checking does not log it twice', async () => {
    await run({ dashboard_found: true, balance: 25272, history_found: true, dates_seen: ['2026-11-11'], trades: [{ pnl: 300 }, { pnl: -28 }] });
    await page.click('#pop-actions .btn');
    await page.waitForTimeout(300);
    assert.strictEqual(await text(page, '#d-count'), '2'); assert.strictEqual(await text(page, '#d-pnl'), '$272');
  });
  await test('Undo removes the auto-logged trade', async () => {
    await page.click('#vf-undo');
    await page.waitForFunction(() => document.getElementById('d-pnl').textContent === '$300');
    assert.strictEqual(await text(page, '#d-count'), '1');
  });
  await test('next day the focus warns about the untracked trade', async () => {
    // the broker mismatch already marked today as untracked
    assert.strictEqual(await page.evaluate(() => window.__tradeGate.todayScore().untracked), true);
    await page.clock.fastForward('24:00:00'); await page.clock.runFor(61000);
    await page.reload(); await page.evaluate(() => { document.getElementById('auth').hidden = true; document.getElementById('app').hidden = false; });
    await page.clock.runFor(61000); // the focus card checks every minute
    assert.ok(await page.isVisible('#focus-start'));
    const fs = await text(page, '#focus-start');
    assert.match(fs, /App ke bahar trade/); assert.match(fs, /Bina log kiye koi trade nahi/);
  });
  await test('a check from yesterday (opened after the 6 PM reset) still logs the untracked trade', async () => {
    const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    p2.on('pageerror', e => errors.push(e.message));
    await p2.clock.install({ time: new Date('2026-11-11T23:30:00Z') }); // 6:30 PM ET → trading day 12 Nov
    await p2.route(/gstatic\.com|faireconomy\.media/, r => r.abort());
    const at = Date.parse('2026-11-11T19:52:00Z');
    await p2.addInitScript(([at]) => {
      localStorage.setItem('gtd.test', 'true');
      localStorage.setItem('gtd.scores', JSON.stringify({ '__test_main_2026-11-11': { id: '__test_main_2026-11-11', bucket: '__test_main', date: '2026-11-11', untracked: true, manual: {}, notes: {},
        verify: { status: 'mismatch', checks: [], brokerCount: 2, brokerPnl: -128, journalCount: 1, journalPnl: -120, balance: null, at, applied: true } } }));
    }, [at]);
    await p2.goto(base + '/trade-gate/index.html');
    await p2.evaluate(() => { document.getElementById('auth').hidden = true; document.getElementById('app').hidden = false; });
    const yf = path.join(tmp, 'y.json');
    fs.writeFileSync(yf, JSON.stringify({ trades: [{ id: 'y1', accountId: '__test_main', date: '2026-11-11', createdAt: at - 3600e3, closedAt: at - 3000e3, dir: 'short', liq: '15', t15: 'up', t5: 'up', sld: 6, lots: 2, status: 'closed', result: 'sl', pnl: -120, ruleBreaks: [], tags: [], photos: [] }] }));
    await p2.click('#tab-settings'); await p2.click('#acct summary'); await p2.setInputFiles('#bk-file', yf);
    await p2.waitForTimeout(300); if (await p2.isVisible('#focus-start')) await p2.click('#fs-ok');
    await p2.click('#tab-growth'); await p2.waitForTimeout(300);
    await p2.click('#tab-journal');
    const j = await text(p2, '#journal');
    assert.match(j, /Bina app ke trade/); assert.match(j, /−\$8/);
    assert.match(await text(p2, '#stats'), /Net P&L ?−?-?\$128/);
    await p2.close();
  });
  await test('no page errors', async () => assert.deepStrictEqual(errors, []));

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed'); process.exit(failures ? 1 : 0);
})();
