'use strict';

/* ---------- Storage (IndexedDB) ---------- */

const DB_NAME = 'fuel-receipts';
let dbPromise;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('receipts', { keyPath: 'id' });
        d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

const store = {
  all: () => tx('receipts', 'readonly', (s) => s.getAll()),
  put: (r) => tx('receipts', 'readwrite', (s) => s.put(r)),
  del: (id) => tx('receipts', 'readwrite', (s) => s.delete(id)),
  clear: () => tx('receipts', 'readwrite', (s) => s.clear()),
  getMeta: (k) => tx('meta', 'readonly', (s) => s.get(k)),
  setMeta: (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k)),
  clearMeta: () => tx('meta', 'readwrite', (s) => s.clear()),
};

/*
 * Backends share one interface. Receipts in memory never carry the full photo,
 * only a small `thumb` and `hasPhoto`; the full image is fetched on demand.
 * save(rec, photo): photo is undefined when unchanged, null when removed.
 */
const localBackend = {
  kind: 'local',
  async list() {
    return (await store.all()).map(({ photo, ...r }) => ({ ...r, thumb: r.thumb || photo || null, hasPhoto: !!photo }));
  },
  async save(rec, photo) {
    const old = photo === undefined ? await tx('receipts', 'readonly', (s) => s.get(rec.id)) : null;
    await store.put({ ...rec, photo: photo === undefined ? old?.photo ?? null : photo });
  },
  remove: (id) => store.del(id),
  async getPhoto(id) {
    return (await tx('receipts', 'readonly', (s) => s.get(id)))?.photo || null;
  },
  async allPhotos() {
    return new Map((await store.all()).filter((r) => r.photo).map((r) => [r.id, r.photo]));
  },
  loadSettings: () => store.getMeta('settings'),
  saveSettings: (s) => store.setMeta('settings', s),
  async wipe() {
    await store.clear();
    await store.clearMeta();
  },
};

/** Firestore layout: users/{uid}/receipts/{id}, users/{uid}/photos/{id}, users/{uid}/meta/settings. */
function cloudBackend(user) {
  const userDoc = firebase.firestore().collection('users').doc(user.uid);
  const receiptsCol = userDoc.collection('receipts');
  const photosCol = userDoc.collection('photos');
  const settingsDoc = userDoc.collection('meta').doc('settings');
  // Writes resolve only once the server confirms, which never happens offline.
  // Firestore queues them locally, so don't block the UI on them.
  const background = (p) => p.catch((err) => notify('Sync failed: ' + err.message));
  return {
    kind: 'cloud',
    user,
    async list() {
      return (await receiptsCol.get()).docs.map((d) => d.data());
    },
    async save(rec, photo) {
      background(receiptsCol.doc(rec.id).set(rec));
      if (photo) background(photosCol.doc(rec.id).set({ data: photo }));
      else if (photo === null) background(photosCol.doc(rec.id).delete());
    },
    async remove(id) {
      background(receiptsCol.doc(id).delete());
      background(photosCol.doc(id).delete());
    },
    async getPhoto(id) {
      return (await photosCol.doc(id).get()).data()?.data || null;
    },
    async allPhotos() {
      return new Map((await photosCol.get()).docs.map((d) => [d.id, d.data().data]));
    },
    async loadSettings() {
      return (await settingsDoc.get()).data();
    },
    async saveSettings(s) {
      background(settingsDoc.set(JSON.parse(JSON.stringify(s))));
    },
    async wipe() {
      for (const col of [receiptsCol, photosCol]) {
        const docs = (await col.get()).docs;
        for (let i = 0; i < docs.length; i += 400) {
          const batch = firebase.firestore().batch();
          docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
      await settingsDoc.delete();
    },
  };
}

let backend = localBackend;

/* ---------- Settings ---------- */

const PRESETS = {
  'CA-ON': { currency: 'CAD', taxName: 'HST', taxRate: 13, fyStartMonth: 1, unit: 'L' },
  'CA-BC': { currency: 'CAD', taxName: 'GST', taxRate: 5, fyStartMonth: 1, unit: 'L' },
  'CA-AB': { currency: 'CAD', taxName: 'GST', taxRate: 5, fyStartMonth: 1, unit: 'L' },
  'CA-QC': { currency: 'CAD', taxName: 'GST+QST', taxRate: 14.975, fyStartMonth: 1, unit: 'L' },
  IN: { currency: 'INR', taxName: 'GST', taxRate: 0, fyStartMonth: 4, unit: 'L', taxRegistered: false },
  AU: { currency: 'AUD', taxName: 'GST', taxRate: 10, fyStartMonth: 7, unit: 'L' },
  UK: { currency: 'GBP', taxName: 'VAT', taxRate: 20, fyStartMonth: 4, unit: 'L' },
  NZ: { currency: 'NZD', taxName: 'GST', taxRate: 15, fyStartMonth: 4, unit: 'L' },
};

const DEFAULT_SETTINGS = {
  ...PRESETS['CA-ON'],
  taxRegistered: false,
  defaultBizPct: 100,
  ownerName: '',
  vehicles: [],
  km: {}, // { [fyStartYear]: { total, business } }
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let settings = { ...DEFAULT_SETTINGS };
let receipts = [];
let selectedFy = null;

/* ---------- Helpers ---------- */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const round2 = (n) => Math.round(n * 100) / 100;

function money(n) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: settings.currency || 'CAD' }).format(n || 0);
  } catch {
    return (n || 0).toFixed(2);
  }
}
const fmtNum = (n, d = 2) => (n == null ? '' : (+n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// Embedded viewers (iframes) block alert/confirm, downloads, printing and service workers.
const embedded = window.self !== window.top;

let toastTimer;
function notify(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

/** In-page replacement for confirm(); resolves true when the user confirms. */
function ask(msg, { okText = 'OK', danger = false, typeToConfirm = '' } = {}) {
  const d = $('#askDialog');
  const ok = $('#askOk');
  const input = $('#askInput');
  $('#askMsg').textContent = msg;
  ok.textContent = okText;
  ok.className = 'btn ' + (danger ? 'danger' : 'primary');
  input.hidden = !typeToConfirm;
  input.value = '';
  input.placeholder = typeToConfirm ? `Type ${typeToConfirm}` : '';
  ok.disabled = !!typeToConfirm;
  input.oninput = () => (ok.disabled = input.value.trim() !== typeToConfirm);
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => {
    d.onclose = () => resolve(d.returnValue === 'ok');
  });
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/** Start year of the tax year that contains the given ISO date. */
function fyOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m >= settings.fyStartMonth ? y : y - 1;
}
function fyLabel(startYear) {
  if (settings.fyStartMonth === 1) return `${startYear}`;
  return `${startYear}–${String(startYear + 1).slice(2)}`;
}
function fyRange(startYear) {
  const sm = settings.fyStartMonth;
  const start = new Date(startYear, sm - 1, 1);
  const end = new Date(startYear + (sm === 1 ? 0 : 1), sm === 1 ? 12 : sm - 1, 0);
  const f = (d) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `${f(start)} – ${f(end)}`;
}

/** Business-use fraction for a receipt: logbook km for its year wins over per-receipt %. */
function bizFraction(r) {
  const km = settings.km[fyOf(r.date)];
  if (km && km.total > 0 && km.business != null) return Math.min(1, km.business / km.total);
  return (r.bizPct ?? settings.defaultBizPct) / 100;
}

function calc(r) {
  const frac = bizFraction(r);
  const tax = r.tax || 0;
  const net = r.total - tax;
  const claimable = settings.taxRegistered ? net * frac : r.total * frac;
  const credit = settings.taxRegistered ? tax * frac : 0;
  return { frac, tax, net, claimable: round2(claimable), credit: round2(credit) };
}

function totals(list) {
  return list.reduce(
    (a, r) => {
      const c = calc(r);
      a.count++;
      a.total += r.total;
      a.tax += c.tax;
      a.net += c.net;
      a.claimable += c.claimable;
      a.credit += c.credit;
      a.litres += r.litres || 0;
      if (!r.hasPhoto) a.missingPhoto++;
      return a;
    },
    { count: 0, total: 0, tax: 0, net: 0, claimable: 0, credit: 0, litres: 0, missingPhoto: 0 }
  );
}

const yearReceipts = () => receipts.filter((r) => fyOf(r.date) === selectedFy).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

/* ---------- Rendering ---------- */

function renderYearSelect() {
  const years = new Set(receipts.map((r) => fyOf(r.date)));
  years.add(fyOf(todayIso()));
  if (selectedFy == null || !years.has(selectedFy)) selectedFy = fyOf(todayIso());
  const sel = $('#yearSelect');
  sel.innerHTML = [...years]
    .sort((a, b) => b - a)
    .map((y) => `<option value="${y}" ${y === selectedFy ? 'selected' : ''}>Tax year ${fyLabel(y)}</option>`)
    .join('');
}

function stat(label, value, cls = '') {
  return `<div class="stat ${cls}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`;
}

function renderReceipts() {
  const q = $('#search').value.trim().toLowerCase();
  const all = yearReceipts();
  const list = q
    ? all.filter((r) => [r.station, r.vehicle, r.notes, r.receiptNo, r.fuelType, r.payment].join(' ').toLowerCase().includes(q))
    : all;

  const t = totals(all);
  $('#quickStats').innerHTML =
    stat('Receipts', t.count) +
    stat('Total spent', money(t.total)) +
    stat('Claimable expense', money(t.claimable), 'highlight') +
    (settings.taxRegistered ? stat(`${settings.taxName} credit`, money(t.credit), 'highlight') : stat(`${settings.taxName} paid`, money(t.tax)));

  $('#emptyMsg').hidden = all.length > 0;
  $('#receiptList').innerHTML = list
    .map((r) => {
      const c = calc(r);
      const thumb = r.thumb ? `<img class="thumb" src="${r.thumb}" alt="">` : `<div class="thumb" title="No photo">🧾</div>`;
      const vol = r.litres ? `${fmtNum(r.litres, 2)} ${settings.unit}` : '';
      const sub = [fmtDate(r.date), r.vehicle, vol, r.notes].filter(Boolean).map(esc).join(' · ');
      return `<li class="item" data-id="${r.id}">
        ${thumb}
        <div class="main">
          <div class="title">${esc(r.station)} ${r.hasPhoto ? '' : '<span class="badge warn">no photo</span>'}</div>
          <div class="sub">${sub}</div>
        </div>
        <div class="amt"><b>${money(r.total)}</b><span class="badge">${Math.round(c.frac * 100)}% biz</span></div>
      </li>`;
    })
    .join('');
}

function groupRows(list, keyFn, labelFn) {
  const groups = new Map();
  for (const r of list) {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].map(([k, rs]) => ({ key: k, label: labelFn(k), t: totals(rs) }));
}

function tableHtml(rows, firstCol) {
  const reg = settings.taxRegistered;
  const head = `<thead><tr><th>${firstCol}</th><th>Receipts</th><th>${settings.unit}</th><th>Total</th><th>${esc(settings.taxName)}</th><th>Claimable</th>${reg ? `<th>${esc(settings.taxName)} credit</th>` : ''}</tr></thead>`;
  const line = (label, t) =>
    `<td>${esc(label)}</td><td>${t.count}</td><td>${fmtNum(t.litres, 1)}</td><td>${money(t.total)}</td><td>${money(t.tax)}</td><td>${money(t.claimable)}</td>${reg ? `<td>${money(t.credit)}</td>` : ''}`;
  const all = rows.reduce(
    (a, { t }) => {
      for (const k in a) a[k] += t[k];
      return a;
    },
    { count: 0, litres: 0, total: 0, tax: 0, claimable: 0, credit: 0 }
  );
  if (!rows.length) return `${head}<tbody><tr><td colspan="7" class="muted">No receipts</td></tr></tbody>`;
  return `${head}<tbody>${rows.map((r) => `<tr>${line(r.label, r.t)}</tr>`).join('')}</tbody><tfoot><tr>${line('Total', all)}</tr></tfoot>`;
}

function renderSummary() {
  const list = yearReceipts();
  const t = totals(list);
  $('#summaryTitle').textContent = `Tax year ${fyLabel(selectedFy)}`;

  const km = settings.km[selectedFy] || {};
  $('#kmTotal').value = km.total ?? '';
  $('#kmBusiness').value = km.business ?? '';
  $('#kmNote').textContent =
    km.total > 0 && km.business != null
      ? `Using logbook business use of ${((Math.min(1, km.business / km.total)) * 100).toFixed(1)}% for every receipt this year.`
      : 'Not set — using each receipt’s own business-use %.';

  $('#summaryCards').innerHTML =
    stat('Period', fyRange(selectedFy)) +
    stat('Total fuel spend', money(t.total)) +
    stat(`${settings.taxName} paid`, money(t.tax)) +
    stat('Claimable fuel expense', money(t.claimable), 'highlight') +
    (settings.taxRegistered ? stat(`${settings.taxName} credit (ITC)`, money(t.credit), 'highlight') : '') +
    stat(`Volume (${settings.unit})`, fmtNum(t.litres, 1)) +
    stat('Avg price / ' + settings.unit, t.litres ? money(list.reduce((a, r) => a + (r.litres ? r.total : 0), 0) / t.litres) : '—') +
    stat('Missing photos', t.missingPhoto);

  const monthRows = groupRows(list, (r) => r.date.slice(0, 7), (k) => {
    const [y, m] = k.split('-').map(Number);
    return `${MONTHS[m - 1].slice(0, 3)} ${y}`;
  }).sort((a, b) => a.key.localeCompare(b.key));
  $('#monthTable').innerHTML = tableHtml(monthRows, 'Month');

  const vehRows = groupRows(list, (r) => r.vehicle || '—', (k) => k).sort((a, b) => b.t.total - a.t.total);
  $('#vehicleTable').innerHTML = tableHtml(vehRows, 'Vehicle');
}

function renderSettings() {
  const f = $('#settingsForm');
  f.currency.value = settings.currency;
  f.taxName.value = settings.taxName;
  f.taxRate.value = settings.taxRate;
  f.fyStartMonth.innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === settings.fyStartMonth ? 'selected' : ''}>${m}</option>`).join('');
  f.defaultBizPct.value = settings.defaultBizPct;
  f.unit.value = settings.unit;
  f.ownerName.value = settings.ownerName;
  f.taxRegistered.checked = settings.taxRegistered;
  f.vehicles.value = settings.vehicles.join('\n');
}

function renderDatalists() {
  const stations = [...new Set(receipts.map((r) => r.station).filter(Boolean))];
  const vehicles = [...new Set([...settings.vehicles, ...receipts.map((r) => r.vehicle).filter(Boolean)])];
  $('#stationList').innerHTML = stations.map((s) => `<option value="${esc(s)}">`).join('');
  $('#vehicleList').innerHTML = vehicles.map((s) => `<option value="${esc(s)}">`).join('');
  document.querySelectorAll('.unit').forEach((el) => (el.textContent = settings.unit));
  $('#taxLabel').textContent = settings.taxName;
}

function renderAll() {
  renderYearSelect();
  renderDatalists();
  renderReceipts();
  renderSummary();
}

/* ---------- Receipt editor ---------- */

const editor = $('#editor');
const form = $('#receiptForm');
let editingId = null;
let pendingPhoto = null; // full image shown in the editor
let photoChanged = false;

function openEditor(r) {
  editingId = r ? r.id : null;
  form.reset();
  delete form.total.dataset.manual;
  delete form.tax.dataset.manual;
  clearScanMarks();
  $('#editorTitle').textContent = r ? 'Edit receipt' : 'Add receipt';
  $('#deleteBtn').hidden = !r;

  const lastVehicle = receipts.slice().sort((a, b) => b.createdAt - a.createdAt)[0]?.vehicle || settings.vehicles[0] || '';
  const v = r || { date: todayIso(), bizPct: settings.defaultBizPct, vehicle: lastVehicle, fuelType: 'Regular', payment: 'Card' };
  for (const k of ['date', 'station', 'vehicle', 'fuelType', 'litres', 'pricePerLitre', 'total', 'tax', 'bizPct', 'odometer', 'payment', 'receiptNo', 'notes']) {
    if (form[k]) form[k].value = v[k] ?? '';
  }
  if (r) {
    form.total.dataset.manual = '1';
    form.tax.dataset.manual = '1';
  }
  setPhoto(r?.thumb || null);
  photoChanged = false;
  updateHint();
  editor.showModal();
  if (r?.hasPhoto) {
    backend.getPhoto(r.id).then((p) => {
      if (editingId === r.id && !photoChanged && p) setPhoto(p);
    }).catch(() => {});
  }
}

function setPhoto(dataUrl) {
  pendingPhoto = dataUrl;
  const img = $('#photoPreview');
  img.hidden = !dataUrl;
  if (dataUrl) img.src = dataUrl;
  else img.removeAttribute('src');
  $('#removePhoto').hidden = !dataUrl;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = src;
  });
}

function drawScaled(img, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

/** Downscale a photo; it must stay under Firestore's 1 MB document limit. */
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    for (const [dim, q] of [[1600, 0.75], [1300, 0.65], [1000, 0.6], [800, 0.5]]) {
      const data = drawScaled(img, dim, q);
      if (data.length < 900000) return data;
    }
    throw new Error('Photo is too large. Try a closer shot of the receipt.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function makeThumb(dataUrl) {
  return drawScaled(await loadImage(dataUrl), 160, 0.6);
}

function autoTax() {
  if (form.tax.dataset.manual) return;
  const total = num(form.total.value);
  form.tax.value = total == null ? '' : round2((total * settings.taxRate) / (100 + settings.taxRate)).toFixed(2);
}

function updateHint() {
  const total = num(form.total.value);
  if (total == null) {
    $('#calcHint').textContent = '';
    return;
  }
  const r = { date: form.date.value || todayIso(), total, tax: num(form.tax.value) || 0, bizPct: num(form.bizPct.value) ?? settings.defaultBizPct };
  const c = calc(r);
  const logbook = settings.km[fyOf(r.date)]?.total > 0 ? ' (logbook % for this tax year)' : '';
  $('#calcHint').textContent =
    `Claimable expense: ${money(c.claimable)} at ${Math.round(c.frac * 100)}% business use${logbook}` +
    (settings.taxRegistered ? ` · ${settings.taxName} credit: ${money(c.credit)}` : '');
}

form.addEventListener('input', (e) => {
  const n = e.target.name;
  if (e.target.dataset.scanned) {
    delete e.target.dataset.scanned;
    e.target.classList.remove('scanned');
  }
  if (n === 'total') form.total.dataset.manual = form.total.value ? '1' : '';
  if (n === 'tax') form.tax.dataset.manual = form.tax.value ? '1' : '';
  if ((n === 'litres' || n === 'pricePerLitre') && !form.total.dataset.manual) {
    const l = num(form.litres.value), p = num(form.pricePerLitre.value);
    if (l != null && p != null) form.total.value = round2(l * p).toFixed(2);
  }
  if (n === 'total' && !form.pricePerLitre.value) {
    const l = num(form.litres.value), t = num(form.total.value);
    if (l && t != null) form.pricePerLitre.placeholder = (t / l).toFixed(3);
  }
  if (['total', 'litres', 'pricePerLitre'].includes(n)) autoTax();
  updateHint();
});

async function usePhotoFile(file) {
  try {
    setPhoto(await compressImage(file));
    photoChanged = true;
  } catch (err) {
    notify(err.message);
    return;
  }
  if (scanAvailable()) runScan();
}

$('#photoInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) usePhotoFile(file);
});
$('#scanInput').addEventListener('click', () => scanAvailable() && loadScanModels().catch(() => {}));
$('#scanInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  openEditor(null);
  usePhotoFile(file);
});
$('#scanBtn').onclick = () => runScan();

/* ---------- Receipt scanning (Gemini via Firebase AI Logic) ---------- */

const AI_SDK_VERSION = '12.19.0';
// Newest first; later models are fallbacks in case a name is unavailable to this project.
// Flash-Lite comes second: it is the quickest and usually least loaded, and receipts are easy to read.
const SCAN_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
const ATTEMPT_TIMEOUT_MS = 15000; // give up on one model after this
const HEDGE_AFTER_MS = 4000; // start another model in parallel if no answer yet
const SCAN_DEADLINE_MS = 30000; // never keep the user waiting longer than this
const SCANNABLE = ['date', 'station', 'litres', 'pricePerLitre', 'total', 'tax', 'fuelType', 'payment', 'receiptNo', 'odometer'];
const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    isReceipt: { type: 'boolean', description: 'False if the image is not a purchase receipt.' },
    date: { type: 'string', description: 'Purchase date, YYYY-MM-DD.' },
    station: { type: 'string', description: 'Gas station brand or business name.' },
    litres: { type: 'number', description: 'Fuel volume purchased.' },
    pricePerLitre: { type: 'number', description: 'Fuel price per unit of volume.' },
    total: { type: 'number', description: 'Final amount paid, including tax.' },
    tax: { type: 'number', description: 'Sales tax amount included in the total.' },
    fuelType: { type: 'string', enum: ['Regular', 'Mid-grade', 'Premium', 'Diesel', 'Other'] },
    payment: { type: 'string', enum: ['Card', 'Cash', 'Other'] },
    receiptNo: { type: 'string', description: 'Receipt, invoice, transaction or authorization number.' },
    odometer: { type: 'number', description: 'Odometer reading, only if printed or handwritten on the receipt.' },
  },
  required: ['isReceipt'],
};

let scanModelsPromise;
let scanToken = 0;

const scanAvailable = () => backend.kind === 'cloud';

function loadScanModels() {
  if (!scanModelsPromise) {
    scanModelsPromise = (async () => {
      const base = `https://www.gstatic.com/firebasejs/${AI_SDK_VERSION}`;
      const [{ initializeApp, getApps }, { getAI, getGenerativeModel, GoogleAIBackend }] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-ai.js`),
      ]);
      const { appCheckSiteKey, ...options } = cloudConfig;
      // A separate named app keeps this modular SDK apart from the compat SDK used for auth and data.
      let app = getApps().find((a) => a.name === 'scan');
      if (!app) {
        app = initializeApp(options, 'scan');
        // Firebase AI Logic enforces App Check: each request must carry a token proving it comes from this site.
        if (appCheckSiteKey) {
          const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(`${base}/firebase-app-check.js`);
          const appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
          // Fetch the first token now so the scan itself doesn't wait for reCAPTCHA.
          import(`${base}/firebase-app-check.js`).then(({ getToken }) => getToken(appCheck)).catch(() => {});
        }
      }
      const ai = getAI(app, { backend: new GoogleAIBackend() });
      const base_ = { responseMimeType: 'application/json', responseJsonSchema: RECEIPT_SCHEMA, temperature: 0 };
      // Reading a receipt needs no reasoning; thinking adds seconds of latency.
      const thinkingConfig = (name) => (/^gemini-2\./.test(name) ? { thinkingBudget: 0 } : { thinkingLevel: 'MINIMAL' });
      return SCAN_MODELS.map((name) => ({
        name,
        fast: getGenerativeModel(ai, { model: name, generationConfig: { ...base_, thinkingConfig: thinkingConfig(name) } }),
        plain: getGenerativeModel(ai, { model: name, generationConfig: base_ }),
      }));
    })();
    scanModelsPromise.catch(() => (scanModelsPromise = null));
  }
  return scanModelsPromise;
}

function scanPrompt() {
  const unit = settings.unit === 'gal' ? 'US gallons' : 'litres';
  return [
    'Read this fuel (petrol/gas) station receipt and extract the purchase details.',
    `- litres: the fuel volume in ${unit}; convert if the receipt uses another unit. pricePerLitre is per ${unit === 'litres' ? 'litre' : 'gallon'}.`,
    '- total: the final amount paid, including tax.',
    `- tax: the ${settings.taxName} (sales tax) amount printed on the receipt. If several taxes are listed, add them up. Omit it if no tax amount is printed.`,
    '- date: the purchase date as YYYY-MM-DD. Receipts in Canada and the US often print MM/DD/YY.',
    '- station: the brand or business name, e.g. "Petro-Canada", "Esso", "Shell", "Costco".',
    '- fuelType: map the grade (e.g. "Regular 87", "Unleaded", "Plus 89", "Supreme 91", "Diesel") to one of the allowed values.',
    '- payment: "Card" for any debit/credit/fleet card, "Cash", or "Other".',
    '- Omit any field you cannot read with confidence. Do not guess. Set isReceipt to false if this is not a purchase receipt.',
  ].join('\n');
}

const httpStatus = (err) => err.customErrorData?.status;
const isMissingModel = (err) =>
  httpStatus(err) === 404 || err.code === 'no-model' || /model.*(not found|not supported|does not exist)/i.test(err.message || '');

// The model (and thinking mode) that last answered is remembered on this device and tried first.
const WORKING_MODEL_KEY = 'fuel-receipts:scan-model';
let workingModel = (() => {
  try {
    return JSON.parse(localStorage.getItem(WORKING_MODEL_KEY)) || null;
  } catch {
    return null;
  }
})();

function rememberModel(name, fast) {
  workingModel = { name, fast };
  try {
    localStorage.setItem(WORKING_MODEL_KEY, JSON.stringify(workingModel));
  } catch {}
}

// Overloaded or temporarily failing on Google's side: another model usually has capacity.
const isBusy = (err) =>
  [500, 502, 503, 504].includes(httpStatus(err)) || /high demand|overloaded|UNAVAILABLE|try again later/i.test(err.message || '');

const isThinkingRejected = (err) => httpStatus(err) === 400 && /think/i.test(err.message || '');

/** A smaller copy for reading: enough pixels for receipt text, much less to upload. */
async function scanImage(dataUrl) {
  try {
    return drawScaled(await loadImage(dataUrl), 1280, 0.7);
  } catch {
    return dataUrl;
  }
}

async function scanPhoto(dataUrl) {
  const [models, small] = await Promise.all([loadScanModels(), scanImage(dataUrl)]);
  const ordered = [...models].sort((a, b) => (b.name === workingModel?.name) - (a.name === workingModel?.name));
  const image = { inlineData: { data: small.split(',')[1], mimeType: 'image/jpeg' } };
  return hedgedScan(ordered, image);
}

const isTimeout = (err) => err?.name === 'AbortError' || /abort|timed? ?out/i.test(err?.message || '');
// A dropped connection (iOS reports "Load failed") is worth retrying on another model.
const isDropped = (err) => !httpStatus(err) && /Load failed|Failed to fetch|NetworkError|network connection was lost/i.test(err?.message || '');

/** Ask one model, retrying once without the thinking setting if the model rejects it. */
async function askModel(entry, image, signal) {
  const call = async (fast) => {
    const result = await (fast ? entry.fast : entry.plain).generateContent([scanPrompt(), image], { signal, timeout: ATTEMPT_TIMEOUT_MS });
    const data = JSON.parse(result.response.text());
    if (!signal.aborted) rememberModel(entry.name, fast);
    return data;
  };
  const fast = !(entry.name === workingModel?.name && workingModel.fast === false);
  try {
    return await call(fast);
  } catch (err) {
    if (fast && isThinkingRejected(err)) return call(false);
    throw err;
  }
}

/**
 * Race models: start the preferred one, add another every HEDGE_AFTER_MS while none has answered,
 * replace any that fail with busy/missing/timeout errors, and take the first answer.
 */
function hedgedScan(ordered, image) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    let next = 0;
    let running = 0;
    let done = false;
    let lastErr = null;
    let hedgeTimer;
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer);
      clearTimeout(deadline);
      controllers.forEach((c) => c.abort());
      settle(value);
    };
    const launch = () => {
      clearTimeout(hedgeTimer);
      if (done) return;
      if (next >= ordered.length) {
        if (running === 0) finish(reject, lastErr || new Error('No Gemini model answered.'));
        return;
      }
      const entry = ordered[next++];
      const ctrl = new AbortController();
      controllers.push(ctrl);
      running++;
      askModel(entry, image, ctrl.signal).then(
        (data) => finish(resolve, data),
        (err) => {
          running--;
          if (done) return;
          // A busy error says more than "model not found", so keep it for the final message.
          if (!lastErr || isBusy(err) || isTimeout(err)) lastErr = err;
          if (isBusy(err) || isMissingModel(err) || isTimeout(err) || isDropped(err)) launch();
          else finish(reject, err); // e.g. App Check or key problems: other models won't help
        }
      );
      hedgeTimer = setTimeout(launch, HEDGE_AFTER_MS);
    };
    const deadline = setTimeout(() => {
      const err = new Error('Gemini did not answer in time.');
      err.code = 'scan-timeout';
      finish(reject, err);
    }, SCAN_DEADLINE_MS);
    launch();
  });
}

/** Load the AI SDK and App Check token in the background so the first scan starts immediately. */
function warmUpScanning() {
  if (!scanAvailable()) return;
  const start = () => loadScanModels().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 1000);
}

function scanErrorMessage(err) {
  const status = httpStatus(err);
  const text = `${err.code || ''} ${err.message || ''}`;
  const detail = String(err.message || err).replace(/^.*?\]\s*/, '').slice(0, 200);
  if (navigator.onLine === false) return 'This phone is offline. Enter the details by hand or try again when connected.';
  if (err.code === 'api-not-enabled' || /SERVICE_DISABLED|has not been used/i.test(text)) {
    return 'Receipt reading is not turned on yet. In Firebase, open AI Logic → Get started and choose the Gemini Developer API. If you just did, wait a few minutes.';
  }
  if (status === 401 && /App Check/i.test(text)) {
    return cloudConfig.appCheckSiteKey
      ? 'App Check couldn’t verify this device. Check that this website’s domain is listed on the reCAPTCHA key, then try again.'
      : 'Receipt reading needs App Check set up first (a reCAPTCHA key). See “Turn on receipt reading” in the README.';
  }
  if (/appCheck\//i.test(text)) return 'App Check couldn’t verify this device. Try again in a minute. (' + detail + ')';
  if (err.code === 'scan-timeout' || isTimeout(err)) {
    return 'Gemini took too long to answer (Google is busy). Tap “Read details from photo” to try again, or enter the details by hand.';
  }
  if (isBusy(err)) return 'Google’s Gemini is very busy right now. Tap “Read details from photo” again in a minute, or enter the details by hand.';
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(text)) return 'Too many receipts read in a short time. Wait a minute and try again.';
  if (/API_KEY_SERVICE_BLOCKED|are blocked|API key not valid/i.test(text)) {
    return 'The app’s Firebase key isn’t allowed to use AI Logic. In Google Cloud → APIs & Services → Credentials, edit the Browser key and add “Firebase AI Logic API” to its allowed APIs. (' + detail + ')';
  }
  if (isMissingModel(err)) return 'The Gemini model isn’t available to this project. (' + detail + ')';
  if (/Importing a module|dynamically imported module|Load failed|Failed to fetch/i.test(text) && !status) {
    return 'Couldn’t reach the receipt reader. Check your connection and try again.';
  }
  return 'Couldn’t read this receipt. Enter the details by hand.' + (status ? ` [${status}] ` : ' ') + '(' + detail + ')';
}

function clearScanMarks() {
  for (const k of SCANNABLE) {
    form[k].classList.remove('scanned');
    delete form[k].dataset.scanned;
  }
  $('#scanStatus').textContent = '';
  $('#scanStatus').classList.remove('error');
}

/** Fill form fields from a scan, without overwriting anything the user typed. */
function applyScan(data) {
  const values = { ...data };
  if (values.date && !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) delete values.date;
  if (values.date && values.date > todayIso()) delete values.date;
  for (const k of ['litres', 'pricePerLitre', 'total', 'tax', 'odometer']) {
    if (!(typeof values[k] === 'number' && values[k] >= 0)) delete values[k];
  }
  if (values.tax != null && values.total != null && values.tax > values.total) delete values.tax;
  let filled = 0;
  for (const k of SCANNABLE) {
    const v = values[k];
    if (v == null || v === '') continue;
    const el = form[k];
    if (el.value !== '' && !el.dataset.scanned && !(k === 'date' || k === 'fuelType' || k === 'payment')) continue;
    if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) continue;
    el.value = k === 'total' || k === 'tax' ? (+v).toFixed(2) : v;
    el.dataset.scanned = '1';
    el.classList.add('scanned');
    filled++;
  }
  if (values.total != null) form.total.dataset.manual = '1';
  if (values.tax != null) form.tax.dataset.manual = '1';
  else autoTax();
  updateHint();
  return filled;
}

async function runScan() {
  if (!pendingPhoto) {
    notify('Add a photo of the receipt first.');
    return;
  }
  const token = ++scanToken;
  const status = $('#scanStatus');
  const btn = $('#scanBtn');
  status.classList.remove('error');
  const started = Date.now();
  status.textContent = 'Reading receipt…';
  const timer = setInterval(() => {
    if (token === scanToken) status.textContent = `Reading receipt… ${Math.round((Date.now() - started) / 1000)}s`;
  }, 1000);
  btn.disabled = true;
  try {
    const data = await scanPhoto(pendingPhoto);
    if (token !== scanToken || !editor.open) return;
    if (data.isReceipt === false) {
      status.textContent = 'This photo doesn’t look like a receipt. Enter the details by hand.';
      status.classList.add('error');
      return;
    }
    const filled = applyScan(data);
    status.textContent = filled
      ? `Filled ${filled} field${filled === 1 ? '' : 's'} from the photo (highlighted). Check them before saving.`
      : 'Couldn’t find details on this receipt. Enter them by hand.';
  } catch (err) {
    if (token !== scanToken) return;
    status.textContent = `${scanErrorMessage(err)} [${APP_VERSION}]`;
    status.classList.add('error');
  } finally {
    clearInterval(timer);
    if (token === scanToken) btn.disabled = false;
  }
}
$('#removePhoto').onclick = () => {
  setPhoto(null);
  photoChanged = true;
};
$('#photoPreview').onclick = () => showPhoto(pendingPhoto);
$('#cancelBtn').onclick = () => editor.close();
editor.addEventListener('close', () => scanToken++);

$('#deleteBtn').onclick = async () => {
  if (!editingId || !(await ask('Delete this receipt? This cannot be undone.', { okText: 'Delete', danger: true }))) return;
  await backend.remove(editingId);
  receipts = receipts.filter((r) => r.id !== editingId);
  editor.close();
  renderAll();
};

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const total = num(form.total.value);
  const tax = num(form.tax.value);
  if (tax != null && total != null && tax > total) {
    notify('Tax cannot be more than the total.');
    return;
  }
  const existing = receipts.find((r) => r.id === editingId);
  const r = {
    id: editingId || uid(),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    date: form.date.value,
    station: form.station.value.trim(),
    vehicle: form.vehicle.value.trim(),
    fuelType: form.fuelType.value,
    litres: num(form.litres.value),
    pricePerLitre: num(form.pricePerLitre.value),
    total,
    tax: tax ?? 0,
    bizPct: Math.max(0, Math.min(100, num(form.bizPct.value) ?? settings.defaultBizPct)),
    odometer: num(form.odometer.value),
    payment: form.payment.value,
    receiptNo: form.receiptNo.value.trim(),
    notes: form.notes.value.trim(),
    thumb: photoChanged ? (pendingPhoto ? await makeThumb(pendingPhoto) : null) : existing?.thumb ?? null,
    hasPhoto: photoChanged ? !!pendingPhoto : !!existing?.hasPhoto,
  };
  try {
    await backend.save(r, photoChanged ? pendingPhoto : undefined);
  } catch (err) {
    notify('Could not save. Device storage may be full: download a backup and remove old photos. (' + err.message + ')');
    return;
  }
  receipts = receipts.filter((x) => x.id !== r.id).concat(r);
  selectedFy = fyOf(r.date);
  editor.close();
  renderAll();
});

function showPhoto(src) {
  if (!src) return;
  $('#viewerImg').src = src;
  $('#viewer').showModal();
}
$('#viewerClose').onclick = () => $('#viewer').close();

/* ---------- Export / print ---------- */

function download(name, content, type) {
  if (embedded) {
    showExport(name, content);
    return;
  }
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

function showExport(name, text) {
  $('#exportTitle').textContent = name;
  $('#exportText').value = text.replace(/^\ufeff/, '');
  $('#exportDialog').showModal();
}
$('#exportCopy').onclick = async () => {
  const ta = $('#exportText');
  try {
    await navigator.clipboard.writeText(ta.value);
    notify('Copied. Paste it into a spreadsheet, email or notes app.');
  } catch {
    ta.focus();
    ta.select();
    notify('Text selected. Use your device’s Copy command.');
  }
};
$('#exportClose').onclick = () => $('#exportDialog').close();

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const list = yearReceipts().reverse();
  const tn = settings.taxName;
  const header = ['Date', 'Station', 'Vehicle', 'Fuel type', `Volume (${settings.unit})`, `Price/${settings.unit}`, 'Total', `${tn} included`, 'Pre-tax amount', 'Business use %', 'Claimable expense', `${tn} credit`, 'Odometer', 'Payment', 'Receipt #', 'Notes', 'Photo attached'];
  const rows = list.map((r) => {
    const c = calc(r);
    return [r.date, r.station, r.vehicle, r.fuelType, r.litres ?? '', r.pricePerLitre ?? '', r.total.toFixed(2), c.tax.toFixed(2), c.net.toFixed(2), (c.frac * 100).toFixed(1), c.claimable.toFixed(2), c.credit.toFixed(2), r.odometer ?? '', r.payment, r.receiptNo, r.notes, r.hasPhoto ? 'Yes' : 'No'];
  });
  const t = totals(list);
  rows.push(['TOTAL', '', '', '', t.litres.toFixed(2), '', t.total.toFixed(2), t.tax.toFixed(2), t.net.toFixed(2), '', t.claimable.toFixed(2), t.credit.toFixed(2), '', '', '', '', '']);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  download(`fuel-receipts-${fyLabel(selectedFy)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

async function printReport() {
  const allPhotos = await backend.allPhotos();
  const list = yearReceipts().reverse();
  const t = totals(list);
  const reg = settings.taxRegistered;
  const tn = esc(settings.taxName);
  const km = settings.km[selectedFy];
  const rows = list
    .map((r) => {
      const c = calc(r);
      return `<tr><td>${esc(r.date)}</td><td>${esc(r.station)}</td><td>${esc(r.vehicle)}</td><td>${r.litres != null ? fmtNum(r.litres, 2) : ''}</td><td>${money(r.total)}</td><td>${money(c.tax)}</td><td>${(c.frac * 100).toFixed(0)}%</td><td>${money(c.claimable)}</td>${reg ? `<td>${money(c.credit)}</td>` : ''}<td>${esc(r.notes)}</td></tr>`;
    })
    .join('');
  const photos = list
    .filter((r) => allPhotos.has(r.id))
    .map((r) => `<div class="photo"><img src="${allPhotos.get(r.id)}"><div>${esc(r.date)} · ${esc(r.station)} · ${money(r.total)}</div></div>`)
    .join('');
  $('#printArea').innerHTML = `
    <h1>Fuel expense report – tax year ${esc(fyLabel(selectedFy))}</h1>
    <div>${esc(settings.ownerName)} ${settings.ownerName ? '· ' : ''}${esc(fyRange(selectedFy))} · Generated ${esc(new Date().toLocaleDateString())}</div>
    <p><b>Total spend:</b> ${money(t.total)} &nbsp; <b>${tn} paid:</b> ${money(t.tax)} &nbsp; <b>Claimable expense:</b> ${money(t.claimable)}${reg ? ` &nbsp; <b>${tn} credit:</b> ${money(t.credit)}` : ''} &nbsp; <b>Receipts:</b> ${t.count}</p>
    ${km && km.total > 0 ? `<p>Business use per logbook: ${fmtNum(km.business, 0)} of ${fmtNum(km.total, 0)} km (${((km.business / km.total) * 100).toFixed(1)}%)</p>` : ''}
    <table><thead><tr><th>Date</th><th>Station</th><th>Vehicle</th><th>${esc(settings.unit)}</th><th>Total</th><th>${tn}</th><th>Biz %</th><th>Claimable</th>${reg ? `<th>${tn} credit</th>` : ''}<th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
    ${photos ? `<h2 style="page-break-before:always">Receipt images</h2>${photos}` : ''}`;
  window.print();
}

async function exportBackup() {
  const photos = await backend.allPhotos();
  const withPhotos = receipts.map(({ thumb, hasPhoto, ...r }) => ({ ...r, photo: photos.get(r.id) || null }));
  const data = { app: 'fuel-receipts', version: 1, exportedAt: new Date().toISOString(), settings, receipts: withPhotos };
  download(`fuel-receipts-backup-${todayIso()}.json`, JSON.stringify(data), 'application/json');
}

async function restoreBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    notify('That is not a valid backup.');
    return;
  }
  if (data.app !== 'fuel-receipts' || !Array.isArray(data.receipts)) {
    notify('That is not a Fuel Receipts backup.');
    return;
  }
  if (!(await ask(`Restore ${data.receipts.length} receipts? Receipts with the same ID will be overwritten; others are kept.`, { okText: 'Restore' }))) return;
  await importReceipts(data.receipts.filter((r) => r && r.id && r.date && typeof r.total === 'number'));
  if (data.settings) {
    settings = { ...DEFAULT_SETTINGS, ...data.settings, km: { ...settings.km, ...(data.settings.km || {}) } };
    await backend.saveSettings(settings);
  }
  receipts = await backend.list();
  renderSettings();
  renderAll();
  notify('Backup restored.');
}

/** Save full receipts (with `photo`) from a backup or this device into the current backend. */
async function importReceipts(list) {
  for (const { photo, ...r } of list) {
    const rec = { ...r, thumb: photo ? await makeThumb(photo).catch(() => null) : null, hasPhoto: !!photo };
    for (const k of Object.keys(rec)) if (rec[k] === undefined) rec[k] = null;
    await backend.save(rec, photo || null);
  }
}

/* ---------- Wiring ---------- */

document.querySelectorAll('.tab').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + btn.dataset.view));
  })
);

$('#yearSelect').onchange = (e) => {
  selectedFy = +e.target.value;
  renderReceipts();
  renderSummary();
};
$('#search').oninput = renderReceipts;
$('#addBtn').onclick = () => openEditor(null);
$('#receiptList').onclick = (e) => {
  const li = e.target.closest('.item');
  if (!li) return;
  const r = receipts.find((x) => x.id === li.dataset.id);
  if (e.target.matches('img.thumb')) backend.getPhoto(r.id).then((p) => showPhoto(p || r.thumb));
  else openEditor(r);
};

async function saveKm() {
  const total = num($('#kmTotal').value);
  const business = num($('#kmBusiness').value);
  if (total == null && business == null) delete settings.km[selectedFy];
  else settings.km[selectedFy] = { total, business };
  await backend.saveSettings(settings);
  renderReceipts();
  renderSummary();
}
$('#kmTotal').onchange = saveKm;
$('#kmBusiness').onchange = saveKm;

$('#csvBtn').onclick = exportCsv;
$('#printBtn').onclick = printReport;
$('#printBtn').hidden = embedded;
$('#backupBtn').textContent = embedded ? 'Show backup to copy' : 'Download backup (.json)';
$('#csvBtn').textContent = embedded ? 'Copy CSV' : 'Export CSV';
$('#pasteBtn').onclick = () => {
  $('#pasteText').value = '';
  $('#pasteDialog').showModal();
};
$('#pasteCancel').onclick = () => $('#pasteDialog').close();
$('#pasteRestore').onclick = () => {
  const text = $('#pasteText').value.trim();
  $('#pasteDialog').close();
  if (text) restoreBackup(text);
};
$('#backupBtn').onclick = exportBackup;
$('#restoreInput').onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) f.text().then(restoreBackup);
};
$('#wipeBtn').onclick = async () => {
  const where = backend.kind === 'cloud' ? 'your account' : 'this device';
  const msg = `Delete ALL receipts, photos and settings from ${where}? Make a backup first.`;
  if (!(await ask(msg, { okText: 'Delete everything', danger: true, typeToConfirm: 'DELETE' }))) return;
  await backend.wipe();
  receipts = [];
  settings = { ...DEFAULT_SETTINGS, km: {} };
  renderSettings();
  renderAll();
};

$('#preset').onchange = (e) => {
  const p = PRESETS[e.target.value];
  if (!p) return;
  const f = $('#settingsForm');
  f.currency.value = p.currency;
  f.taxName.value = p.taxName;
  f.taxRate.value = p.taxRate;
  f.fyStartMonth.value = p.fyStartMonth;
  f.unit.value = p.unit;
  if (p.taxRegistered === false) f.taxRegistered.checked = false;
};

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const currency = f.currency.value.trim().toUpperCase();
  try {
    new Intl.NumberFormat(undefined, { style: 'currency', currency });
  } catch {
    notify('Unknown currency code. Use a 3-letter code like CAD, INR, USD or GBP.');
    return;
  }
  settings = {
    ...settings,
    currency,
    taxName: f.taxName.value.trim() || 'Tax',
    taxRate: Math.max(0, num(f.taxRate.value) ?? 0),
    fyStartMonth: +f.fyStartMonth.value,
    defaultBizPct: Math.max(0, Math.min(100, num(f.defaultBizPct.value) ?? 100)),
    unit: f.unit.value,
    ownerName: f.ownerName.value.trim(),
    taxRegistered: f.taxRegistered.checked,
    vehicles: f.vehicles.value.split('\n').map((s) => s.trim()).filter(Boolean),
  };
  await backend.saveSettings(settings);
  const msg = $('#savedMsg');
  msg.hidden = false;
  setTimeout(() => (msg.hidden = true), 1500);
  selectedFy = null;
  renderAll();
});

/* ---------- Accounts (Firebase) ---------- */

const APP_VERSION = '2026.10.25-fast3';
const FIREBASE_VERSION = '10.12.2';
const cloudConfig = window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey ? window.FIREBASE_CONFIG : null;
let signUpMode = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(el);
  });
}

async function loadFirebase() {
  if (!window.firebase) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    await loadScript(`${base}/firebase-app-compat.js`);
    await Promise.all([loadScript(`${base}/firebase-auth-compat.js`), loadScript(`${base}/firebase-firestore-compat.js`)]);
  }
  const { appCheckSiteKey, ...config } = cloudConfig;
  // On Firebase Hosting, sign in through this same site so browsers that partition
  // storage between sites (Safari, in-app browsers) keep the sign-in state.
  if (location.hostname === `${config.projectId}.firebaseapp.com`) config.authDomain = location.hostname;
  if (!firebase.apps.length) firebase.initializeApp(config);
  // Keep a local copy so the app works offline; changes sync when back online.
  await firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(() => {});
}

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'No account with that email. Create one below.',
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/popup-blocked': 'This browser blocked the Google sign-in window. Open the app in Safari or Chrome, or sign in with email below.',
  'auth/operation-not-supported-in-this-environment': 'Google sign-in doesn’t work in this browser. Open the app in Safari or Chrome, or sign in with email below.',
  'auth/web-storage-unsupported': 'Google sign-in doesn’t work in this browser. Open the app in Safari or Chrome, or sign in with email below.',
  'auth/network-request-failed': 'No internet connection. Connect and try again.',
  'auth/operation-not-allowed': 'This sign-in method is not turned on in Firebase (Authentication → Sign-in method).',
  'auth/unauthorized-domain': 'This website is not allowed to sign in yet. Add its domain in Firebase → Authentication → Settings → Authorized domains.',
};

function authError(err) {
  if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
  const el = $('#authError');
  el.textContent = AUTH_ERRORS[err.code] || err.message;
  el.hidden = false;
}

function setAuthMode(signUp) {
  signUpMode = signUp;
  $('#emailSubmit').textContent = signUp ? 'Create account' : 'Sign in';
  $('#toggleMode').textContent = signUp ? 'Have an account? Sign in' : 'New here? Create an account';
  $('#authPassword').autocomplete = signUp ? 'new-password' : 'current-password';
  $('#authError').hidden = true;
}

function wireAuthUi() {
  const auth = firebase.auth();
  $('#googleBtn').onclick = async () => {
    $('#authError').hidden = true;
    const provider = new firebase.auth.GoogleAuthProvider();
    // Popup only: the redirect flow fails in browsers that partition storage between sites.
    auth.signInWithPopup(provider).catch(authError);
  };
  $('#toggleMode').onclick = () => setAuthMode(!signUpMode);
  $('#accountInitial').onclick = () => document.querySelector('.tab[data-view=settings]').click();
  $('#emailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#authError').hidden = true;
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const btn = $('#emailSubmit');
    btn.disabled = true;
    try {
      if (signUpMode) {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        cred.user.sendEmailVerification().catch(() => {});
      } else {
        await auth.signInWithEmailAndPassword(email, password);
      }
    } catch (err) {
      authError(err);
    } finally {
      btn.disabled = false;
    }
  });
  $('#forgotBtn').onclick = async () => {
    const email = $('#authEmail').value.trim();
    if (!email) {
      authError({ message: 'Enter your email above, then tap “Forgot password?” again.' });
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      notify(`Password reset email sent to ${email}.`);
    } catch (err) {
      authError(err);
    }
  };
  $('#signOutBtn').onclick = async () => {
    await auth.signOut();
    location.reload();
  };
}

function showApp(signedInUser) {
  $('#appVersion').textContent = `App version ${APP_VERSION}`;
  $('#scanBtn').hidden = !signedInUser;
  $('#authScreen').hidden = true;
  $('#appShell').hidden = false;
  $('#accountCard').hidden = !signedInUser;
  if (signedInUser) {
    $('#accountEmail').textContent = signedInUser.email || signedInUser.displayName || 'your account';
    $('#accountInitial').textContent = (signedInUser.displayName || signedInUser.email || '?').trim()[0].toUpperCase();
    $('#accountInitial').hidden = false;
  }
  $('#wipeBtn').textContent = signedInUser ? 'Delete all data in my account' : 'Delete all data';
  $('#storageNote').textContent = signedInUser
    ? 'Your receipts and photos are saved to your account and sync across your devices. You can still download a backup for your records.'
    : 'All data (including photos) stays on this device. Export a backup regularly — tax records generally need to be kept for 6+ years.';
}

async function loadData() {
  const saved = await backend.loadSettings();
  settings = saved ? { ...DEFAULT_SETTINGS, ...saved, km: saved.km || {} } : { ...DEFAULT_SETTINGS, km: {} };
  receipts = await backend.list();
  selectedFy = null;
  renderSettings();
  renderAll();
}

/** Offer to move receipts saved on this device (before accounts existed) into the account. */
async function offerLocalUpload(user) {
  const flag = 'uploaded:' + user.uid;
  let local;
  try {
    if (await store.getMeta(flag)) return;
    local = await store.all();
  } catch {
    return;
  }
  if (!local.length) return;
  const ok = await ask(`This device has ${local.length} receipt(s) saved before you signed in. Copy them into your account?`, { okText: 'Copy to account' });
  if (!ok) return;
  if (!receipts.length) {
    const localSettings = await store.getMeta('settings');
    if (localSettings) {
      settings = { ...DEFAULT_SETTINGS, ...localSettings, km: localSettings.km || {} };
      await backend.saveSettings(settings);
    }
  }
  await importReceipts(local);
  await store.setMeta(flag, Date.now());
  await loadData();
  notify(`Copied ${local.length} receipt(s) to your account.`);
}

async function init() {
  // Google only accepts sign-in returns on the firebaseapp.com domain, so send
  // visitors of the web.app alias there.
  if (cloudConfig && location.hostname === `${cloudConfig.projectId}.web.app`) {
    location.replace(`https://${cloudConfig.projectId}.firebaseapp.com${location.pathname}${location.search}${location.hash}`);
    return;
  }
  if (cloudConfig && !embedded) {
    await loadFirebase();
    wireAuthUi();
    setAuthMode(false);
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        $('#appShell').hidden = true;
        $('#authScreen').hidden = false;
        return;
      }
      backend = cloudBackend(user);
      showApp(user);
      warmUpScanning();
      await loadData();
      offerLocalUpload(user);
    });
  } else {
    showApp(null);
    await loadData();
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if (!embedded && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

init().catch((err) => {
  document.body.insertAdjacentHTML('afterbegin', `<p style="padding:16px;color:#b42318">Could not start the app: ${esc(err.message)}</p>`);
});
