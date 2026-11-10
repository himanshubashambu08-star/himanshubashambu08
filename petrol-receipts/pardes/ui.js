// Pardes prototype: the screens. Renders the state from engine.js and sends taps back to it.
(function () {
  const P = window.Pardes;
  const app = document.getElementById('app');
  let s = null;
  let plan = { day: null, eve: null, send: 0 };
  let phoneTab = null;
  let prev = {}; // last values shown in the HUD, so changes can animate

  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const val = (x, st) => (typeof x === 'function' ? x(st) : x);
  // «spoken line»{subtitle} → a styled line with its translation underneath.
  const rich = t => esc(t)
    .replace(/«([^»]+)»\{([^}]+)\}/g, '<span class="spoken"><span class="pa">$1</span><span class="sub">$2</span></span>')
    .split(/\n\n/).map(p => `<p>${p}</p>`).join('');

  const seedFromUrl = () => { const m = location.search.match(/[?&]seed=(\d+)/); return m ? Number(m[1]) : null; };

  function save() { if (s) P.save(s); }
  function set(newState) { s = newState; save(); render(); window.scrollTo(0, 0); }

  // ---------- screens ----------
  function render() {
    if (!s) return renderTitle();
    if (s.phase === 'create') return renderCreate();
    if (s.phase === 'ending') return renderEnding();
    let body = '';
    if (s.phase === 'plan') body = renderPlan();
    else if (s.phase === 'scene') body = renderScene();
    else if (s.phase === 'result') body = renderResult();
    else if (s.phase === 'chapterEnd') body = renderChapterEnd();
    app.innerHTML = hud() + `<main class="stage ch${s.chapter}">${body}</main>` + (phoneTab ? phone() : '');
    bind();
    animateMeters();
  }
  function animateMeters() {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      app.querySelectorAll('.m-fill[data-to]').forEach(el => { el.style.width = el.dataset.to + '%'; });
    }));
  }

  function renderTitle() {
    const saved = P.load();
    app.innerHTML = `
      <main class="title-screen">
        <div class="title-art">${P.drawArt('village')}</div>
        <h1>Pardes</h1>
        <p class="title-sub">From Zero</p>
        <p class="tagline">Leave home. Start over. Live with it.</p>
        <div class="title-actions">
          <button class="btn primary" data-act="new" data-testid="new-life">Begin a new life</button>
          ${saved && saved.phase !== 'ending' ? `<button class="btn ghost" data-act="continue" data-testid="continue">Continue ${esc(saved.name)}'s life</button>` : ''}
        </div>
        <p class="fine">Text prototype of the full game · about 40 minutes · choices are never labelled right or wrong</p>
      </main>`;
    bind();
  }

  function renderCreate() {
    app.innerHTML = `
      <main class="create">
        <p class="eyebrow">Nurmahal, Punjab</p>
        <h2>Who are you?</h2>
        <label class="field"><span>Your name</span><input id="name" maxlength="20" placeholder="Arjun" autocomplete="off" data-testid="name"></label>
        <fieldset class="field"><legend>Refer to you as</legend>
          <div class="seg" role="radiogroup">
            ${['he', 'she', 'they'].map(p => `<label><input type="radio" name="pr" value="${p}" ${p === s.pronoun ? 'checked' : ''}><span>${p}</span></label>`).join('')}
          </div>
        </fieldset>
        <button class="btn primary" data-act="begin" data-testid="begin">Begin</button>
      </main>`;
    bind();
  }

  function hud() {
    const ch = P.CHAPTERS[s.chapter];
    // Bars start at last screen's value and slide to the new one (see animateMeters).
    const bar = (label, v, cls) => { const from = prev[cls] ?? v; prev[cls] = v; return `<div class="meter ${cls} ${v <= 25 ? 'low' : ''}"><span class="m-label">${label}</span><span class="m-track"><span class="m-fill" style="width:${from}%" data-to="${v}"></span></span></div>`; };
    const dm = prev.money == null ? 0 : Math.round(s.money - prev.money);
    prev.money = s.money;
    const delta = dm ? `<span class="delta ${dm < 0 ? 'down' : 'up'}" aria-hidden="true">${dm > 0 ? '+' : ''}${P.fmt(s, dm)}</span>` : '';
    return `
      <header class="hud">
        <div class="hud-top">
          <div class="where"><span class="ch">${ch.sub} · ${esc(ch.title)}</span><span class="when" data-testid="when">${esc(P.timeLabel(s))}</span></div>
          <button class="phone-btn" data-act="phone" aria-label="Open your phone" data-testid="phone">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="10.5" y1="18.5" x2="13.5" y2="18.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="meters">
          <div class="money ${s.money < 0 ? 'neg' : ''}"><span class="m-label">Money</span><span class="m-num" data-testid="money">${P.fmt(s, s.money)}</span>${delta}</div>
          ${bar('Energy', s.energy, 'energy')}
          ${bar('Mood', s.mood, 'mood')}
          ${s.job || (s.biz && s.biz.open) ? bar(s.biz && s.biz.open ? 'Business' : 'Work', s.biz && s.biz.open ? s.biz.health : s.career, 'career') : ''}
        </div>
      </header>`;
  }

  function renderPlan() {
    const days = P.activitiesFor(s, 'day'), eves = P.activitiesFor(s, 'evening');
    if (!days.find(a => a.id === plan.day)) plan.day = days[0] && days[0].id;
    if (!eves.find(a => a.id === plan.eve)) plan.eve = eves[0] && eves[0].id;
    const opts = P.homeOptions(s);
    const list = (name, items, cur) => items.map(a => `
      <label class="opt ${a.id === cur ? 'on' : ''}">
        <input type="radio" name="${name}" value="${a.id}" ${a.id === cur ? 'checked' : ''} data-testid="${name}-${a.id}">
        <span class="opt-label">${esc(val(a.label, s))}</span>
        <span class="opt-note">${esc(val(a.note, s))}</span>
      </label>`).join('');
    const word = P.periodWord(s);
    return `
      <section class="card plan">
        <div class="illus">${P.drawArt(P.homeArt(s))}</div>
        <p class="eyebrow">${esc(s.home)}</p>
        <h2>How will you spend this ${word}?</h2>
        <h3>Days</h3><div class="opts">${list('day', days, plan.day)}</div>
        <h3>Evenings</h3><div class="opts">${list('eve', eves, plan.eve)}</div>
        ${opts ? `<h3>Money home this ${word}</h3>
          <div class="seg send">${['None', 'Some', 'The usual'].map((l, i) => `<label><input type="radio" name="send" value="${i}" ${i === plan.send ? 'checked' : ''} data-testid="send-${i}"><span>${l}${i ? `<small>${P.fmt(s, opts[i])}</small>` : ''}</span></label>`).join('')}</div>` : ''}
        <button class="btn primary wide" data-act="live" data-testid="live">Live this ${word}</button>
      </section>`;
  }

  function renderScene() {
    const sc = P.SCENES[s.scene];
    if (!sc) { P.next(s); save(); return renderAgain(); }
    const choices = P.visibleChoices(s, sc);
    return `
      <section class="card scene" data-scene="${esc(s.scene)}">
        <div class="illus">${P.drawArt(P.artFor(s, s.scene))}</div>
        ${sc.title ? `<h2>${esc(sc.title(s))}</h2>` : ''}
        <div class="prose">${rich(sc.text(s))}</div>
        <div class="choices">
          ${choices.map((c, i) => `<button class="choice" style="--i:${i}" data-act="choose" data-i="${i}" data-testid="choice">${esc(val(c.label, s))}</button>`).join('')}
        </div>
      </section>`;
  }
  function renderAgain() { setTimeout(render, 0); return ''; }

  function renderResult() {
    const r = s.result || { title: '', lines: [] };
    return `
      <section class="card result">
        ${r.title ? `<p class="eyebrow">${esc(r.title)}</p>` : ''}
        <div class="prose">${r.lines.length ? r.lines.map(l => rich(l)).join('') : '<p>The days go by.</p>'}</div>
        <button class="btn primary wide" data-act="next" data-testid="next">Continue</button>
      </section>`;
  }

  function renderChapterEnd() {
    const ch = P.CHAPTERS[s.chapter], nx = P.CHAPTERS[s.chapter + 1];
    const close = Object.entries(s.people).filter(([, p]) => p.met && !p.gone).sort((a, b) => b[1].bond - a[1].bond).slice(0, 3).map(([id]) => P.PEOPLE[id].name);
    return `
      <section class="card chapter-end">
        <div class="illus tall">${P.drawArt(nx ? P.chapterArt(s.chapter + 1) : 'balcony')}</div>
        <p class="eyebrow">End of ${ch.sub}</p>
        <h2>${esc(ch.title)}</h2>
        <dl class="facts">
          <div><dt>Money</dt><dd>${P.fmt(s, s.money)}</dd></div>
          <div><dt>Living in</dt><dd>${esc(s.home)}</dd></div>
          <div><dt>Closest to you</dt><dd>${esc(close.join(', '))}</dd></div>
        </dl>
        ${nx ? `<p class="next-ch">Next · ${nx.sub}: <b>${esc(nx.title)}</b></p>` : ''}
        <button class="btn primary wide" data-act="next" data-testid="next">${nx ? 'Turn the page' : 'See your life'}</button>
      </section>`;
  }

  function renderEnding() {
    const e = s.ending || (s.ending = P.buildEnding(s));
    const state = { close: 'Close', warm: 'Warm', distant: 'Distant', estranged: 'Estranged', lasting: 'A lasting friendship', lost: 'Lost touch', betrayed: 'Betrayed you' };
    app.innerHTML = `
      <main class="ending">
        <div class="illus hero">${P.drawArt(e.axes.place === 'returned' ? 'village' : 'balcony')}</div>
        <p class="eyebrow">${esc(s.name)} · twenty years</p>
        <h1 class="headline" data-testid="headline">${esc(e.headline)}</h1>
        <section class="summary prose">${e.summary.map(l => `<p>${esc(l)}</p>`).join('')}</section>
        <h3>The people</h3>
        <ul class="people">${e.people.filter(([n]) => n !== 'Dev' || s.people.dev.met).map(([n, v]) => `<li><span>${esc(n)}</span><span class="tag ${v}">${state[v] || v}</span></li>`).join('')}</ul>
        <h3>Regrets</h3>
        <ul class="regrets">${e.regrets.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <h3>The album</h3>
        <p class="narrator">${e.narrator === 'no one' ? 'There is no one left to read it to you. You turn the pages yourself.' : `Read aloud by ${esc(e.narrator)}.`}</p>
        <div class="album">${s.memories.map((m, i) => `<figure class="photo ch${m.ch}" style="--tilt:${(i % 5) - 2}deg;--i:${i}"><div class="ph">${P.drawArt(m.art || P.chapterArt(m.ch), true)}</div><figcaption>${esc(m.caption)}<small>${esc(m.when)}</small></figcaption></figure>`).join('')}</div>
        <div class="title-actions">
          <button class="btn primary" data-act="restart" data-testid="restart">Live another life</button>
        </div>
        <p class="fine">Ending code ${esc(e.key)}</p>
      </main>`;
    bind();
  }

  function phone() {
    const tabs = [['bank', 'Bank'], ['people', 'People'], ['album', 'Album'], ['skills', 'Skills']];
    let inner = '';
    if (phoneTab === 'bank') {
      inner = `<p class="balance">${P.fmt(s, s.money)}</p>${s.debt > 0 ? `<p class="debt">Loans owed: ${P.fmt(s, s.debt)}</p>` : ''}
        <ul class="ledger">${s.bank.slice(0, 25).map(b => `<li><span>${esc(b.why)}<small>${esc(b.when)}</small></span><span class="${b.n < 0 ? 'neg' : 'pos'}">${b.n < 0 ? '' : '+'}${P.fmt(s, b.n)}</span></li>`).join('') || '<li class="empty">No transactions yet.</li>'}</ul>`;
    } else if (phoneTab === 'people') {
      inner = `<ul class="contacts">${Object.entries(s.people).filter(([, p]) => p.met).map(([id, p]) => {
        const ago = s.clock - p.lastSeen;
        return `<li><span class="avatar">${esc(P.PEOPLE[id].name[0])}</span><span>${esc(P.PEOPLE[id].name)}<small>${esc(id === 'farah' && s.partner === 'married' ? 'Your spouse' : P.PEOPLE[id].role)}${p.gone ? ' · out of your life' : ago <= 1 ? ' · recently' : ` · ${ago} ${P.periodWord(s)}${ago === 1 ? '' : 's'} ago`}</small></span></li>`;
      }).join('')}</ul><p class="fine">How they feel about you is never shown. You find out.</p>`;
    } else if (phoneTab === 'album') {
      inner = s.memories.length ? `<div class="album small">${s.memories.map((m, i) => `<figure class="photo ch${m.ch}" style="--tilt:${(i % 5) - 2}deg"><div class="ph">${P.drawArt(m.art || P.chapterArt(m.ch), true)}</div><figcaption>${esc(m.caption)}</figcaption></figure>`).join('')}</div>` : '<p class="empty">No photos yet.</p>';
    } else {
      inner = `<ul class="skills">${Object.entries(s.skills).map(([k, v]) => `<li><span>${k[0].toUpperCase() + k.slice(1)}</span><span class="dots">${'●'.repeat(v)}${'○'.repeat(10 - v)}</span></li>`).join('')}</ul>
        ${s.job ? `<p class="fine">Job: ${esc(P.JOBS[s.job].label)}</p>` : ''}${s.biz && s.biz.open ? `<p class="fine">Business: ${esc(s.biz.label)} · ${s.biz.scale} ${P.BIZ[s.biz.type].unit}${s.biz.scale > 1 ? 's' : ''} · your share ${s.biz.share}%</p>` : ''}`;
    }
    return `
      <div class="sheet-backdrop" data-act="close-phone"></div>
      <aside class="sheet" role="dialog" aria-label="Your phone">
        <div class="sheet-head"><span>Your phone</span><button class="x" data-act="close-phone" aria-label="Close">×</button></div>
        <nav class="tabs">${tabs.map(([k, l]) => `<button class="${k === phoneTab ? 'on' : ''}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</nav>
        <div class="sheet-body">${inner}</div>
      </aside>`;
  }

  // ---------- input ----------
  function bind() {
    app.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', onAct));
    app.querySelectorAll('input[name="day"]').forEach(el => el.addEventListener('change', e => { plan.day = e.target.value; render(); }));
    app.querySelectorAll('input[name="eve"]').forEach(el => el.addEventListener('change', e => { plan.eve = e.target.value; render(); }));
    app.querySelectorAll('input[name="send"]').forEach(el => el.addEventListener('change', e => { plan.send = Number(e.target.value); }));
    app.querySelectorAll('input[name="pr"]').forEach(el => el.addEventListener('change', e => { s.pronoun = e.target.value; }));
  }

  function onAct(e) {
    const el = e.currentTarget, act = el.dataset.act;
    if (act === 'new' || act === 'restart') {
      P.clearSave();
      const seed = seedFromUrl() ?? Math.floor(Math.random() * 2 ** 31);
      s = { phase: 'create', pronoun: 'they', seed }; prev = {};
      plan = { day: null, eve: null, send: 0 };
      return render();
    }
    if (act === 'continue') { s = P.load(); plan = { day: null, eve: null, send: 0 }; prev = {}; return render(); }
    if (act === 'begin') {
      const name = (document.getElementById('name').value || '').trim() || 'Arjun';
      const st = P.newState(name, s.pronoun, s.seed);
      P.startChapter(st, 0);
      return set(st);
    }
    if (act === 'live') {
      P.liveTurn(s, plan.day, plan.eve, plan.send);
      return set(s);
    }
    if (act === 'choose') { P.choose(s, Number(el.dataset.i)); return set(s); }
    if (act === 'next') { P.next(s); return set(s); }
    if (act === 'phone') { phoneTab = 'bank'; return render(); }
    if (act === 'tab') { phoneTab = el.dataset.tab; return render(); }
    if (act === 'close-phone') { phoneTab = null; return render(); }
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && phoneTab) { phoneTab = null; render(); } });
  window.__pardes = { state: () => s };
  render();
})();
