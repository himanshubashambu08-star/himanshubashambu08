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
  await test('no page errors', async () => assert.deepStrictEqual(errors, []));

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed'); process.exit(failures ? 1 : 0);
})();
