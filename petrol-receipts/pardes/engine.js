// Pardes prototype: the rules. State, meters, the daily loop, trust, the Life Ledger, businesses and the ending.
// Story content lives in content.js; the screens live in ui.js.
(function () {
  const P = (window.Pardes = window.Pardes || {});

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  P.clamp = clamp;

  // Seeded random numbers, so a life can be replayed exactly from its seed.
  P.rand = s => {
    s.rng = (s.rng + 0x6d2b79f5) | 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  P.between = (s, lo, hi) => Math.round(lo + (hi - lo) * P.rand(s));

  P.CHAPTERS = [
    { title: 'Home', sub: 'Chapter 1', turns: 6, unit: 'Month', place: 'Nurmahal, Punjab' },
    { title: 'Starting from zero', sub: 'Chapter 2', turns: 8, unit: 'Week', place: 'Bramford, Ontario' },
    { title: 'The hustle', sub: 'Chapter 3', turns: 8, unit: 'Season', place: 'Bramford, Ontario' },
    { title: 'Business', sub: 'Chapter 4', turns: 6, unit: 'Stretch', place: 'Bramford, Ontario' },
    { title: 'Empire or collapse', sub: 'Chapter 5', turns: 5, unit: 'Years', place: 'Bramford, Ontario' }
  ];

  const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
  P.timeLabel = s => {
    const c = s.chapter, t = s.turn;
    if (c === 0) return `Month ${t} at home`;
    if (c === 1) return `Week ${t} abroad`;
    if (c === 2) return `${SEASONS[(t - 1) % 4]}, year ${Math.ceil(t / 4)}`;
    if (c === 3) return `Years ${3 + Math.floor((t - 1) * 0.67)}–${3 + Math.floor(t * 0.67)} abroad`;
    return `Years ${7 + (t - 1) * 3}–${7 + t * 3} abroad`;
  };
  P.periodWord = s => ['month', 'week', 'season', 'stretch', 'few years'][s.chapter];

  // Money is held in Canadian dollars; Chapter 1 shows it in rupees.
  P.RUPEES_PER_DOLLAR = 60;
  P.fmt = (s, n) => {
    const neg = n < 0, a = Math.abs(Math.round(n));
    const txt = s.chapter === 0
      ? '₹' + (a * P.RUPEES_PER_DOLLAR).toLocaleString('en-IN')
      : '$' + a.toLocaleString('en-CA');
    return (neg ? '−' : '') + txt;
  };

  P.pr = (s, form) => {
    const map = {
      he: { he: 'he', him: 'him', his: 'his', He: 'He', His: 'His' },
      she: { he: 'she', him: 'her', his: 'her', He: 'She', His: 'Her' },
      they: { he: 'they', him: 'them', his: 'their', He: 'They', His: 'Their' }
    };
    return map[s.pronoun || 'they'][form];
  };

  P.newState = (name, pronoun, seed) => {
    const people = {};
    for (const [id, p] of Object.entries(P.PEOPLE)) people[id] = { trust: p.trust, bond: p.bond, met: !!p.met, lastSeen: 0 };
    return {
      v: 1, seed, rng: seed | 0, name: (name || 'Arjun').trim().slice(0, 20) || 'Arjun', pronoun: pronoun || 'they',
      chapter: 0, turn: 1, clock: 0,
      money: 150, debt: 0, energy: 80, mood: 60, career: 50, job: null,
      skills: { language: 1, physical: 1, driving: 0, cooking: 0, sales: 0, management: 0 },
      people, flags: {}, ledger: [], memories: [], bank: [],
      stats: { sentHome: 0, calls: 0, lies: 0, missedRent: 0, burnouts: 0, isolation: 0, injuries: 0, breakdowns: 0, peakWorth: 0, noSendTurns: 0, classSkips: 0, badRun: 0 },
      partner: 'none', home: 'Family home', place: null, biz: null,
      phase: 'scene', queue: [], scene: null, result: null, lastBreakdown: -9, lastEvent: -9, seen: {}
    };
  };

  // ---------- the helper every story effect receives ----------
  P.api = s => {
    const out = [];
    const g = {
      s, out,
      say: t => out.push(t),
      money(n, why) {
        s.money += n;
        if (why) { s.bank.unshift({ when: P.timeLabel(s), ch: s.chapter, why, n }); s.bank.length = Math.min(s.bank.length, 40); }
      },
      energy(n) { if (s.energy + n <= 0 && n < 0) s.flags._collapse = true; s.energy = clamp(s.energy + n, 0, 100); },
      mood(n) { s.mood = clamp(s.mood + n, 0, 100); },
      career(n) { if (s.job || s.chapter === 0) s.career = clamp(s.career + n, 0, 100); },
      skill(k, n) { s.skills[k] = clamp(s.skills[k] + n, 0, 10); },
      // Hidden trust: help given when someone is desperate counts double.
      trust(id, n) { const p = s.people[id]; if (!p) return; const x = n > 0 && p.need === 'desperate' ? n * 2 : n; p.trust = clamp(p.trust + x, -100, 100); },
      bond(id, n) { const p = s.people[id]; if (!p) return; p.bond = clamp(p.bond + n, 0, 100); if (n > 0) p.lastSeen = s.clock; },
      meet(id) { if (s.people[id]) s.people[id].met = true; },
      need(id, v) { if (s.people[id]) s.people[id].need = v; },
      flag(k, v = true) { s.flags[k] = v; },
      has: k => !!s.flags[k],
      ledger(tag, who, amount, weight = 1) { s.ledger.push({ c: s.chapter, t: s.turn, clock: s.clock, tag, who: who || null, amount: amount || 0, weight }); },
      lie(who) { s.stats.lies++; g.ledger('lied_to', who, 0, 2); },
      memory(caption) { s.memories.push({ ch: s.chapter, when: P.timeLabel(s), caption, art: P.artFor ? P.artFor(s, s.scene) : null }); },
      queue(id) { s.queue.unshift(id); },
      queueLast(id) { s.queue.push(id); },
      rand: () => P.rand(s),
      between: (lo, hi) => P.between(s, lo, hi),
      fmt: n => P.fmt(s, n),
      pr: f => P.pr(s, f)
    };
    return g;
  };

  // ---------- the turn ----------
  P.activitiesFor = (s, slot) => P.ACTIVITIES[s.chapter].filter(a => a.slot === slot && (!a.show || a.show(s)));
  P.homeOptions = s => P.SEND_HOME[s.chapter] || null;

  P.liveTurn = (s, dayId, eveId, sendIdx) => {
    const g = P.api(s);
    const acts = P.ACTIVITIES[s.chapter];
    const day = acts.find(a => a.id === dayId), eve = acts.find(a => a.id === eveId);
    s.clock++;
    s.flags._social = false; s.flags._worked = false;
    s.energy = clamp(s.energy + P.SLEEP[s.chapter], 0, 100);

    for (const a of [day, eve]) if (a) a.run(g, a.slot);

    // Money home: never forced, but the family notices.
    const opts = P.homeOptions(s);
    if (opts && sendIdx > 0) {
      const amt = opts[sendIdx];
      g.money(-amt, 'Sent home');
      s.stats.sentHome += amt; s.stats.noSendTurns = 0;
      g.ledger('sent_home', 'maa', amt);
      g.bond('maa', sendIdx); g.bond('papa', sendIdx + 1); g.mood(2);
    } else if (opts) s.stats.noSendTurns++;

    // Bills and the business.
    P.BILLS[s.chapter](g);
    if (s.biz && s.biz.open) P.runBusiness(g, s.flags._focus || 'steady');
    s.flags._focus = null;

    // Drift: people cool when you don't show up.
    for (const [id, p] of Object.entries(s.people)) {
      if (!p.met || p.gone) continue;
      if (s.clock - p.lastSeen > 1) p.bond = clamp(p.bond - (P.PEOPLE[id].family ? 3 : 2), 0, 100);
    }
    if (!s.flags._social) { g.mood(-5); s.stats.isolation++; if (s.stats.isolation % 4 === 0) g.ledger('isolated', null, 0, 1); }
    if (s.job && !s.flags._worked && s.chapter >= 1 && s.chapter <= 2) g.career(-10);

    // Zero states. Every fall has a way back.
    if (s.flags._collapse) { s.flags._collapse = false; s.queue.push('collapse'); }
    if (s.job && s.career <= 0) s.queue.push('fired');
    if (s.mood <= 20 && s.energy <= 25 && s.clock - s.lastBreakdown >= 3) { s.lastBreakdown = s.clock; s.queue.unshift('breakdown'); }

    // Story beats for this turn, then maybe life interrupts.
    const beats = (P.BEATS[s.chapter][s.turn] || []).filter(id => { const sc = P.SCENES[id]; return sc && (!sc.when || sc.when(s)); });
    s.queue.push(...beats);
    if (!beats.length && s.clock - s.lastEvent >= 2 && P.rand(s) < 0.55) {
      const ev = P.pickEvent(s);
      if (ev) { s.lastEvent = s.clock; s.queue.push(ev); }
    }

    const worth = P.netWorth(s);
    if (worth > s.stats.peakWorth) s.stats.peakWorth = worth;

    s.result = { title: `${P.timeLabel(s)}`, lines: g.out };
    s.phase = 'result';
  };

  P.pickEvent = s => {
    const deck = P.EVENTS[s.chapter].filter(id => {
      const sc = P.SCENES[id];
      if (!sc || s.seen[id]) return false;
      if (sc.bad && s.stats.badRun >= 2) return false; // never more than 2 bad events in a row
      return !sc.when || sc.when(s);
    });
    if (!deck.length) return null;
    const id = deck[Math.floor(P.rand(s) * deck.length)];
    s.stats.badRun = P.SCENES[id].bad ? s.stats.badRun + 1 : 0;
    return id;
  };

  P.netWorth = s => {
    let w = s.money - s.debt;
    if (s.biz && s.biz.open) w += Math.round(P.BIZ[s.biz.type].setup * s.biz.scale * (0.4 + s.biz.health / 100) * (s.biz.share / 100));
    return w;
  };

  // ---------- businesses ----------
  P.BIZ = {
    trucking: { name: 'trucking company', setup: 35000, base: 36000, vol: 0.5, unit: 'truck' },
    restaurant: { name: 'restaurant', setup: 80000, base: 40000, vol: 0.35, unit: 'location' },
    cleaning: { name: 'cleaning company', setup: 8000, base: 22000, vol: 0.2, unit: 'crew' },
    online: { name: 'online store', setup: 6000, base: 20000, vol: 0.6, unit: 'product line' }
  };

  P.runBusiness = (g, focus) => {
    const s = g.s, b = s.biz, def = P.BIZ[b.type];
    const mult = s.chapter === 4 ? 3 : 1;
    // Partner behaviour follows hidden trust.
    if (b.partner && !s.people[b.partner].gone) {
      const t = s.people[b.partner].trust;
      if (t >= 60) { b.health = clamp(b.health + 5, 0, 100); }
      else if (t < 20) { b.skimRate = 0.15; }
      else if (t < 60 && !s.flags.askedShare && g.rand() < 0.35) { s.flags.askedShare = true; s.queue.push('partner_share'); }
    }
    b.health = clamp(b.health - 4 + Math.round(s.skills.management / 2), 0, 100);
    const swing = 1 - def.vol + 2 * def.vol * g.rand();
    let profit = Math.round(def.base * b.scale * (0.5 + b.health / 100) * swing * mult - def.base * 0.35 * b.scale * mult);
    let skim = 0;
    if (b.skimRate && profit > 0) { skim = Math.round(profit * b.skimRate); b.skimmed = (b.skimmed || 0) + skim; profit -= skim; }
    const mine = Math.round(profit * b.share / 100);
    g.money(mine, `${b.label}: your share`);
    b.lastProfit = mine;
    g.say(mine >= 0 ? `The ${def.name} made you ${g.fmt(mine)}.` : `The ${def.name} lost money. Your share: ${g.fmt(mine)}.`);
    if (focus === 'books' && b.skimmed > 0 && !s.flags.skimFound) { s.flags.skimFound = true; s.queue.push('skim_found'); }
    if (b.health <= 0 || s.money < -25000) s.queue.push('biz_fail');
  };

  P.openBusiness = (g, type, partner, share, label) => {
    g.s.biz = { type, partner, share, health: 55, scale: 1, open: true, label: label || P.BIZ[type].name, skimmed: 0 };
    g.flag('biz_' + type);
    g.ledger('started_business', partner, P.BIZ[type].setup);
  };

  // ---------- advancing ----------
  P.next = s => {
    if (s.queue.length) { s.scene = s.queue.shift(); s.phase = 'scene'; return; }
    if (s.phase === 'chapterEnd') return P.startChapter(s, s.chapter + 1);
    if (s.flags._chapterStart) { s.flags._chapterStart = false; s.phase = 'plan'; return; }
    if (s.flags._ending) { s.phase = 'ending'; s.ending = P.buildEnding(s); return; }
    s.turn++;
    if (s.turn > P.CHAPTERS[s.chapter].turns) { s.phase = 'chapterEnd'; return; }
    s.phase = 'plan';
  };

  P.startChapter = (s, c) => {
    if (c >= P.CHAPTERS.length) { s.phase = 'ending'; s.ending = P.buildEnding(s); return; }
    s.chapter = c; s.turn = 1; s.flags._chapterStart = true; s.lastEvent = s.clock;
    if (P.ONSTART[c]) P.ONSTART[c](P.api(s));
    const intro = P.BEATS[c][0] || [];
    s.queue.push(...intro);
    P.next(s);
  };

  P.choose = (s, idx) => {
    const sc = P.SCENES[s.scene];
    const choices = P.visibleChoices(s, sc);
    const ch = choices[idx];
    if (!ch) return;
    const g = P.api(s);
    s.seen[s.scene] = true;
    const ret = ch.run ? ch.run(g) : null;
    if (typeof ret === 'string') g.say(ret);
    s.result = { title: sc.title ? sc.title(s) : '', lines: g.out };
    s.phase = g.out.length ? 'result' : 'scene';
    if (!g.out.length) P.next(s);
  };
  P.visibleChoices = (s, sc) => (sc.choices || []).filter(c => !c.show || c.show(s));

  // ---------- the ending ----------
  P.axes = s => {
    const st = s.stats, peak = st.peakWorth, worth = P.netWorth(s);
    let wealth;
    if (s.flags.collapsed && peak >= 400000) wealth = 'collapsed';
    else if (worth < 0) wealth = 'debt';
    else if (worth < 25000) wealth = 'getting_by';
    else if (worth < 200000) wealth = 'comfortable';
    else if (worth < 1000000) wealth = 'wealthy';
    else wealth = 'rich';
    const bondState = b => (b >= 65 ? 'close' : b >= 40 ? 'warm' : b >= 15 ? 'distant' : 'estranged');
    const fam = { maa: bondState(s.people.maa.bond), papa: bondState(s.people.papa.bond), simran: bondState(s.people.simran.bond) };
    const present = s.flags.maa_present || 'partly';
    let partner = 'never';
    if (s.partner === 'married') partner = s.people.farah.bond >= 50 ? 'strong' : 'strained';
    else if (s.partner === 'separated') partner = 'separated';
    else if (s.partner === 'declined') partner = 'single';
    const friend = id => {
      const p = s.people[id];
      if (s.flags['betrayed_' + id]) return 'betrayed';
      if (p.met && p.trust >= 40 && p.bond >= 25 && !p.gone) return 'lasting';
      return 'lost';
    };
    const friends = { manny: friend('manny'), jassi: friend('jassi'), dev: friend('dev') };
    const hs = st.burnouts * 2 + Math.floor(st.isolation / 4) + st.injuries * 2 + st.breakdowns;
    const health = hs < 4 ? 'well' : hs < 9 ? 'worn' : 'broken';
    return { wealth, worth, fam, present, partner, friends, health, place: s.place || 'stayed' };
  };

  P.buildEnding = s => {
    const a = P.axes(s), his = P.pr(s, 'his'), His = P.pr(s, 'His'), He = P.pr(s, 'He');
    const lasting = Object.values(a.friends).filter(x => x === 'lasting').length;
    const wealthNoun = {
      debt: 'Someone still paying off old debts', getting_by: 'A hard worker of modest means', comfortable: 'A careful saver with a comfortable life',
      wealthy: 'A self-made success', rich: 'A millionaire', collapsed: 'A one-time millionaire'
    }[a.wealth];
    const clauses = [];
    if (a.present === 'no') clauses.push([10, `who was not there in ${his} mother's last years`]);
    if (a.partner === 'strong' && (a.fam.maa !== 'estranged') && lasting >= 1) clauses.push([8, 'with a full house every Sunday']);
    if (a.partner === 'separated') clauses.push([7, 'whose marriage ended quietly']);
    if (a.place === 'returned') clauses.push([6, 'who went home in the end']);
    if (s.flags.missed_wedding) clauses.push([6, `who missed ${his} sister's wedding`]);
    if (a.health === 'broken') clauses.push([6, 'who worked until the body said no']);
    if (Object.values(a.friends).includes('betrayed')) clauses.push([5, 'who learned who ' + (s.pronoun === 'they' ? 'their' : his) + ' friends were']);
    if (lasting >= 2) clauses.push([5, 'whose oldest friends never left']);
    if (a.present === 'yes') clauses.push([5, `who held ${his} mother's hand at the end`]);
    if (a.partner === 'never' || a.partner === 'single') clauses.push([3, 'who mostly came home to an empty flat']);
    if (s.stats.lies >= 3) clauses.push([4, 'who kept telling home that everything was fine']);
    clauses.push([1, 'who started from zero']);
    clauses.sort((x, y) => y[0] - x[0]);
    let headline;
    if ((a.wealth === 'getting_by' || a.wealth === 'comfortable') && a.partner === 'strong' && lasting >= 1 && s.biz) headline = 'A small business and a full house.';
    else headline = `${wealthNoun} ${clauses[0][1]}.`;

    const years = 20;
    const summary = [
      `${s.name} left Nurmahal at 22 with one suitcase.`,
      `Over ${years} years ${P.pr(s, 'he')} sent home ${P.fmtPlain(s.stats.sentHome)} and called home ${s.stats.calls} times.`,
      s.stats.lies ? `${He} told ${s.stats.lies} ${s.stats.lies === 1 ? 'lie' : 'lies'} to people who loved ${P.pr(s, 'him')}.` : `${He} never lied to the people at home.`,
      {
        debt: `${He} ended with more owed than owned: ${P.fmtPlain(a.worth)}.`,
        getting_by: `${He} ended with ${P.fmtPlain(Math.max(0, a.worth))} to ${his} name, enough to get by.`,
        comfortable: `${He} ended with about ${P.fmtPlain(a.worth)}, comfortable and careful.`,
        wealthy: `${He} ended worth about ${P.fmtPlain(a.worth)}.`,
        rich: `${He} ended worth more than ${P.fmtPlain(Math.floor(a.worth / 100000) * 100000)}.`,
        collapsed: `At ${his} peak ${P.pr(s, 'he')} was worth ${P.fmtPlain(s.stats.peakWorth)}. It did not last.`
      }[a.wealth],
      { yes: `${He} was there in ${his} mother's last months.`, partly: `${He} flew home in time to say goodbye, and not much sooner.`, no: `${He} was not there when ${his} mother died.` }[a.present],
      { strong: `${He} and Farah held on to each other.`, strained: `${He} and Farah stayed married, mostly out of habit.`, separated: `${He} and Farah separated.`, single: `${He} chose to stay single.`, never: `${He} never found someone to share it with.` }[a.partner],
      { well: `${His} health held up.`, worn: `${His} body carried the years in ${his} back and knees.`, broken: `By the end ${his} body was spent.` }[a.health],
      { stayed: `${He} stayed in Canada.`, returned: `${He} went back to Punjab.`, split: `${He} split ${his} year between both homes.` }[a.place]
    ];
    const people = [
      ['Maa', a.fam.maa], ['Papa', a.fam.papa], ['Simran', a.fam.simran],
      ['Manny', a.friends.manny], ['Jassi', a.friends.jassi], ['Dev', a.friends.dev]
    ];
    const regrets = P.REGRETS.filter(r => r.when(s, a)).sort((x, y) => y.w - x.w).slice(0, 3).map(r => r.text(s));
    // The album is read by whoever is closest at the end.
    let narrator = 'Simran';
    if (a.partner === 'strong') narrator = 'Farah';
    else if (a.fam.simran === 'estranged' && a.friends.jassi === 'lasting') narrator = 'Jassi';
    else if (a.fam.simran === 'estranged' && a.friends.manny === 'lasting') narrator = 'Manny';
    else if (a.fam.simran === 'estranged') narrator = 'no one';
    return { headline, summary, people, regrets, narrator, axes: a, key: P.endingKey(s, a) };
  };
  P.fmtPlain = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-CA');
  P.endingKey = (s, a) => [a.wealth, a.fam.maa, a.fam.papa, a.fam.simran, a.present, a.partner, a.friends.manny, a.friends.jassi, a.friends.dev, a.health, a.place].join('|');

  // ---------- saving ----------
  const KEY = 'pardes.save.v1';
  P.save = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: play on without saving */ } };
  P.load = () => { try { const t = localStorage.getItem(KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; } };
  P.clearSave = () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } };
})();
