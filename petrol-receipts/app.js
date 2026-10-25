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
      if (!r.photo) a.missingPhoto++;
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
      const thumb = r.photo ? `<img class="thumb" src="${r.photo}" alt="">` : `<div class="thumb" title="No photo">🧾</div>`;
      const vol = r.litres ? `${fmtNum(r.litres, 2)} ${settings.unit}` : '';
      const sub = [fmtDate(r.date), r.vehicle, vol, r.notes].filter(Boolean).map(esc).join(' · ');
      return `<li class="item" data-id="${r.id}">
        ${thumb}
        <div class="main">
          <div class="title">${esc(r.station)} ${r.photo ? '' : '<span class="badge warn">no photo</span>'}</div>
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
let pendingPhoto = null;

function openEditor(r) {
  editingId = r ? r.id : null;
  form.reset();
  delete form.total.dataset.manual;
  delete form.tax.dataset.manual;
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
  setPhoto(r?.photo || null);
  updateHint();
  editor.showModal();
}

function setPhoto(dataUrl) {
  pendingPhoto = dataUrl;
  const img = $('#photoPreview');
  img.hidden = !dataUrl;
  if (dataUrl) img.src = dataUrl;
  else img.removeAttribute('src');
  $('#removePhoto').hidden = !dataUrl;
}

/** Downscale a photo so years of receipts fit comfortably in browser storage. */
function compressImage(file, maxDim = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
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

$('#photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    setPhoto(await compressImage(file));
  } catch (err) {
    alert(err.message);
  }
});
$('#removePhoto').onclick = () => setPhoto(null);
$('#photoPreview').onclick = () => showPhoto(pendingPhoto);
$('#cancelBtn').onclick = () => editor.close();

$('#deleteBtn').onclick = async () => {
  if (!editingId || !confirm('Delete this receipt? This cannot be undone.')) return;
  await store.del(editingId);
  receipts = receipts.filter((r) => r.id !== editingId);
  editor.close();
  renderAll();
};

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const total = num(form.total.value);
  const tax = num(form.tax.value);
  if (tax != null && total != null && tax > total) {
    alert('Tax cannot be more than the total.');
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
    photo: pendingPhoto,
  };
  try {
    await store.put(r);
  } catch (err) {
    alert('Could not save — device storage may be full. Export a backup and remove old photos.\n\n' + err.message);
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
    return [r.date, r.station, r.vehicle, r.fuelType, r.litres ?? '', r.pricePerLitre ?? '', r.total.toFixed(2), c.tax.toFixed(2), c.net.toFixed(2), (c.frac * 100).toFixed(1), c.claimable.toFixed(2), c.credit.toFixed(2), r.odometer ?? '', r.payment, r.receiptNo, r.notes, r.photo ? 'Yes' : 'No'];
  });
  const t = totals(list);
  rows.push(['TOTAL', '', '', '', t.litres.toFixed(2), '', t.total.toFixed(2), t.tax.toFixed(2), t.net.toFixed(2), '', t.claimable.toFixed(2), t.credit.toFixed(2), '', '', '', '', '']);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  download(`fuel-receipts-${fyLabel(selectedFy)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

function printReport() {
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
    .filter((r) => r.photo)
    .map((r) => `<div class="photo"><img src="${r.photo}"><div>${esc(r.date)} · ${esc(r.station)} · ${money(r.total)}</div></div>`)
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
  const data = { app: 'fuel-receipts', version: 1, exportedAt: new Date().toISOString(), settings, receipts };
  download(`fuel-receipts-backup-${todayIso()}.json`, JSON.stringify(data), 'application/json');
  await store.setMeta('lastBackup', Date.now());
}

async function restoreBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    alert('That file is not a valid backup.');
    return;
  }
  if (data.app !== 'fuel-receipts' || !Array.isArray(data.receipts)) {
    alert('That file is not a Fuel Receipts backup.');
    return;
  }
  if (!confirm(`Restore ${data.receipts.length} receipts? Receipts with the same ID will be overwritten; others are kept.`)) return;
  for (const r of data.receipts) if (r && r.id && r.date && typeof r.total === 'number') await store.put(r);
  if (data.settings) {
    settings = { ...DEFAULT_SETTINGS, ...data.settings, km: { ...settings.km, ...(data.settings.km || {}) } };
    await store.setMeta('settings', settings);
  }
  receipts = await store.all();
  renderSettings();
  renderAll();
  alert('Backup restored.');
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
  if (e.target.matches('img.thumb')) showPhoto(r.photo);
  else openEditor(r);
};

async function saveKm() {
  const total = num($('#kmTotal').value);
  const business = num($('#kmBusiness').value);
  if (total == null && business == null) delete settings.km[selectedFy];
  else settings.km[selectedFy] = { total, business };
  await store.setMeta('settings', settings);
  renderReceipts();
  renderSummary();
}
$('#kmTotal').onchange = saveKm;
$('#kmBusiness').onchange = saveKm;

$('#csvBtn').onclick = exportCsv;
$('#printBtn').onclick = printReport;
$('#backupBtn').onclick = exportBackup;
$('#restoreInput').onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) restoreBackup(f);
};
$('#wipeBtn').onclick = async () => {
  if (!confirm('Delete ALL receipts, photos and settings from this device? Download a backup first!')) return;
  if (prompt('Type DELETE to confirm') !== 'DELETE') return;
  await store.clear();
  await store.clearMeta();
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
    alert('Unknown currency code. Use a 3-letter code like CAD, INR, USD, GBP.');
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
  await store.setMeta('settings', settings);
  const msg = $('#savedMsg');
  msg.hidden = false;
  setTimeout(() => (msg.hidden = true), 1500);
  selectedFy = null;
  renderAll();
});

async function init() {
  const saved = await store.getMeta('settings');
  if (saved) settings = { ...DEFAULT_SETTINGS, ...saved, km: saved.km || {} };
  receipts = await store.all();
  renderSettings();
  renderAll();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

init().catch((err) => {
  document.body.insertAdjacentHTML('afterbegin', `<p style="padding:16px;color:#b42318">Could not open storage: ${esc(err.message)}</p>`);
});
