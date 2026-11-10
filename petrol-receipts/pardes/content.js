// Pardes prototype: the story. People, activities, bills, scenes, random events and regrets.
// Text markup: «Punjabi line»{subtitle} renders as a spoken line with its subtitle.
(function () {
  const P = (window.Pardes = window.Pardes || {});

  P.PEOPLE = {
    maa: { name: 'Maa', role: 'Your mother', trust: 60, bond: 70, family: true, met: true },
    papa: { name: 'Papa', role: 'Your father', trust: 50, bond: 55, family: true, met: true },
    simran: { name: 'Simran', role: 'Your younger sister', trust: 65, bond: 75, family: true, met: true },
    jassi: { name: 'Jassi', role: 'Best friend back home', trust: 55, bond: 65, met: true },
    harjit: { name: 'Harjit Chacha', role: 'Your uncle', trust: 40, bond: 35, family: true },
    manny: { name: 'Manny', role: 'Basement roommate', trust: 20, bond: 10 },
    farah: { name: 'Farah', role: 'Met at work', trust: 10, bond: 0 },
    dev: { name: 'Dev', role: 'Co-worker', trust: 15, bond: 5 }
  };

  // Energy restored by sleep at the start of each period.
  P.SLEEP = [45, 40, 45, 45, 45];
  // Money home per period: none, some, the usual.
  P.SEND_HOME = [null, [0, 40, 120], [0, 600, 1500], [0, 2500, 6000], [0, 15000, 40000]];

  // ---------- jobs ----------
  P.JOBS = {
    warehouse: { label: 'Warehouse picker', ch2: 216, pay: 9800, energy: -40, skill: 'physical', note: '$19/h · hard on the body' },
    kitchen: { label: 'Kitchen dishwasher', ch2: 206, pay: 8200, energy: -32, skill: 'cooking', note: '$17.20/h + a meal' },
    delivery: { label: 'Delivery driver', pay: 10000, energy: -30, skill: 'driving', note: '$14–26/h · needs a car' },
    restaurant: { label: 'Line cook', pay: 9000, energy: -35, skill: 'cooking', note: '$17/h + tips · evenings and weekends' },
    callcentre: { label: 'Call centre agent', pay: 10500, energy: -20, skill: 'language', note: '$19/h · hard on the mood' },
    trucker: { label: 'Long-haul trucker', pay: 16000, energy: -35, skill: 'driving', note: 'Paid by the mile · weeks away' }
  };
  const jobLabel = s => (s.job ? P.JOBS[s.job].label.toLowerCase() : 'work');
  const social = g => { g.s.flags._social = true; };
  const people = (g, id, bond, trust) => { g.bond(id, bond); if (trust) g.trust(id, trust); social(g); };
  const callHome = (g, big) => {
    const s = g.s, k = big ? 1.5 : 1;
    s.stats.calls += big ? 8 : 1;
    g.bond('maa', Math.round(6 * k)); g.bond('simran', Math.round(4 * k)); g.bond('papa', Math.round(3 * k));
    g.mood(s.flags.lied_home && !s.flags.told_truth && !s.flags.truth_late ? 2 : 6);
    g.ledger('gave_time', 'maa', 1);
    social(g);
  };
  const workJob = (g, mult) => {
    const s = g.s, j = P.JOBS[s.job];
    let pay = Math.round(j.pay * mult);
    if (s.job === 'delivery') pay = Math.round(g.between(7000, 13000) * mult);
    if (s.job === 'restaurant') pay += Math.round(g.between(1500, 3500) * mult);
    g.money(pay, `${j.label} pay`);
    g.energy(j.energy); g.career(6); g.skill(j.skill, 1);
    if (s.job === 'callcentre') { g.mood(-8); g.skill('sales', 1); }
    if (s.job === 'trucker') { g.mood(-4); g.bond('farah', -3); }
    s.flags._worked = true;
    if (s.chapter === 2 && s.job === 'warehouse' && g.rand() < 0.1) g.queueLast('injury');
    if (s.chapter === 2 && s.job === 'delivery' && g.rand() < 0.07) g.queueLast('accident');
  };
  const metAndHere = (s, id) => s.people[id].met && !s.people[id].gone;

  // ---------- activities: what a day (or evening) of this period is spent on ----------
  P.ACTIVITIES = [
    // Chapter 1: a period is a month at home.
    [
      { id: 'shop', slot: 'day', label: "Work at Papa's shop", note: 'Pays ₹5,400 · long hours', run: g => { g.money(90, 'Shop wages'); g.energy(-25); g.bond('papa', 3); g.s.flags._worked = true; } },
      { id: 'tutor', slot: 'day', label: 'Tutor neighbourhood kids', note: 'Pays ₹3,600', run: g => { g.money(60, 'Tutoring'); g.energy(-15); g.mood(2); } },
      { id: 'study', slot: 'day', label: 'English test coaching', note: 'Costs ₹1,200', run: g => { g.money(-20, 'Coaching centre'); g.skill('language', 1); g.energy(-15); } },
      { id: 'family', slot: 'evening', label: 'Evening with the family', note: 'Free', run: g => { people(g, 'maa', 6); g.bond('papa', 4); g.bond('simran', 6); g.mood(6); g.ledger('gave_time', 'maa', 1); } },
      { id: 'jassi', slot: 'evening', label: 'Time with Jassi', note: 'Free', run: g => { people(g, 'jassi', 8, 3); g.mood(6); g.ledger('gave_time', 'jassi', 1); } },
      { id: 'speak', slot: 'evening', label: 'Practise speaking English', note: 'Free · tiring', run: g => { if (g.rand() < 0.6) g.skill('language', 1); g.energy(-10); } },
      { id: 'rest', slot: 'evening', label: 'Rest', note: 'Free', run: g => { g.energy(15); g.mood(2); } }
    ],
    // Chapter 2: a period is a week. Students may work 24 hours a week: two shifts.
    [
      { id: 'classes', slot: 'day', label: 'College classes', note: 'Required for your study permit', run: g => { g.s.flags._classes = true; if (g.rand() < 0.5) g.skill('language', 1); g.energy(-15); } },
      { id: 'dayshift', slot: 'day', label: s => `Day shift: ${jobLabel(s)}`, note: s => `Pays $${P.JOBS[s.job].ch2}`, show: s => !!s.job, run: g => { const j = P.JOBS[g.s.job]; g.money(j.ch2, `${j.label} shift`); g.energy(j.energy + 8); g.career(6); g.skill(j.skill, g.rand() < 0.4 ? 1 : 0); g.s.flags._worked = true; } },
      { id: 'hunt', slot: 'day', label: 'Look for work', note: 'Free · tiring', show: s => !s.job, run: g => { g.energy(-15); g.mood(-3); g.queueLast('first_job'); } },
      { id: 'nightshift', slot: 'evening', label: s => `Night shift: ${jobLabel(s)}`, note: s => `Pays $${P.JOBS[s.job].ch2 + 20}`, show: s => !!s.job, run: g => { const j = P.JOBS[g.s.job]; g.money(j.ch2 + 20, `${j.label} night shift`); g.energy(j.energy); g.career(6); g.s.flags._worked = true; } },
      { id: 'call', slot: 'evening', label: 'Video call home', note: 'Free', run: g => callHome(g) },
      { id: 'roomies', slot: 'evening', label: 'Cook with the roommates', note: 'Costs $10', show: s => metAndHere(s, 'manny') && !s.flags.manny_moved, run: g => { g.money(-10, 'Groceries for dinner'); people(g, 'manny', 6, 2); g.mood(5); g.ledger('gave_time', 'manny', 1); } },
      { id: 'langar', slot: 'evening', label: 'Langar at the gurdwara', note: 'Free meal', run: g => { g.mood(6); g.energy(-5); social(g); g.money(8, 'Saved on dinner'); } },
      { id: 'sleep', slot: 'evening', label: 'Sleep', note: 'Free', run: g => { g.energy(15); } }
    ],
    // Chapter 3: a period is a season.
    [
      { id: 'work', slot: 'day', label: s => `Work: ${jobLabel(s)}`, note: s => P.JOBS[s.job].note, show: s => !!s.job, run: g => workJob(g, 1) },
      { id: 'agency', slot: 'day', label: 'Agency shifts', note: 'About $5,500 · no steady job', show: s => !s.job, run: g => { g.money(5500, 'Agency shifts'); g.energy(-35); } },
      { id: 'course', slot: 'day', label: 'Truck licence course', note: '$7,000 · takes the season', show: s => !s.flags.truck_licence, run: g => { g.money(-7000, 'Truck licence course'); g.flag('truck_licence'); g.skill('driving', 2); g.energy(-20); g.say('You pass the road test on the second try. You can drive a truck for a living now.'); } },
      { id: 'side', slot: 'evening', label: 'Side gig: moving furniture', note: 'Pays about $900', run: g => { g.money(900, 'Moving gigs'); g.energy(-20); } },
      { id: 'call', slot: 'evening', label: 'Call home', note: 'Free', run: g => callHome(g) },
      { id: 'farah', slot: 'evening', label: 'Time with Farah', note: 'About $150', show: s => metAndHere(s, 'farah') && s.partner !== 'declined', run: g => { const half = g.s.job === 'restaurant' ? 0.5 : 1; g.money(-150, 'Dinner, cinema'); people(g, 'farah', Math.round(9 * half), 4); g.mood(7); g.ledger('gave_time', 'farah', 1); } },
      { id: 'manny', slot: 'evening', label: 'See Manny and the old crowd', note: 'Free', show: s => metAndHere(s, 'manny'), run: g => { people(g, 'manny', 6, 3); g.mood(5); g.ledger('gave_time', 'manny', 1); } },
      { id: 'dev', slot: 'evening', label: 'Time with Dev', note: 'Free', show: s => metAndHere(s, 'dev'), run: g => { people(g, 'dev', 7, 4); g.mood(4); g.ledger('gave_time', 'dev', 1); } },
      { id: 'night', slot: 'evening', label: 'Evening classes: English and bookkeeping', note: '$600', run: g => { g.money(-600, 'Evening classes'); g.skill('language', 1); g.skill('management', 1); g.energy(-10); } },
      { id: 'look', slot: 'evening', label: 'Look for different work', note: 'Free', run: g => { g.energy(-5); g.queueLast('job_choice'); } },
      { id: 'rest', slot: 'evening', label: 'Rest', note: 'Free', run: g => { g.energy(20); g.mood(3); } }
    ],
    // Chapter 4: a period is a stretch of about eight months.
    [
      { id: 'grow', slot: 'day', label: 'Push to grow the business', note: 'Long days', show: s => s.biz && s.biz.open, run: g => { g.s.biz.health = P.clamp(g.s.biz.health + 12, 0, 100); g.energy(-40); g.mood(-2); g.skill('management', 1); g.s.flags._focus = 'grow'; g.ledger('work_first', null, 1); } },
      { id: 'steady', slot: 'day', label: 'Run it steady', note: 'Normal days', show: s => s.biz && s.biz.open, run: g => { g.s.biz.health = P.clamp(g.s.biz.health + 5, 0, 100); g.energy(-25); g.s.flags._focus = 'steady'; } },
      { id: 'staff', slot: 'day', label: 'Look after the staff', note: 'Normal days', show: s => s.biz && s.biz.open, run: g => { const b = g.s.biz; b.health = P.clamp(b.health + 6, 0, 100); if (b.partner) g.trust(b.partner, 8); g.energy(-25); g.mood(2); g.s.flags._focus = 'staff'; } },
      { id: 'books', slot: 'day', label: 'Go through the books', note: 'Slow days', show: s => s.biz && s.biz.open, run: g => { g.skill('management', 1); g.energy(-20); g.s.flags._focus = 'books'; } },
      { id: 'work4', slot: 'day', label: s => `Work: ${jobLabel(s)}`, note: 'Steady pay', show: s => !(s.biz && s.biz.open) && !!s.job, run: g => workJob(g, 2.6) },
      { id: 'agency4', slot: 'day', label: 'Agency shifts', note: 'About $14,000', show: s => !(s.biz && s.biz.open) && !s.job, run: g => { g.money(14000, 'Agency shifts'); g.energy(-35); } },
      { id: 'call', slot: 'evening', label: 'Call home every week', note: 'Free', run: g => callHome(g) },
      { id: 'farah', slot: 'evening', label: 'Evenings with Farah', note: 'About $1,000', show: s => s.partner === 'married' || s.partner === 'dating', run: g => { g.money(-1000, 'Evenings out'); people(g, 'farah', 10, 4); g.mood(7); g.ledger('gave_time', 'farah', 1); } },
      { id: 'friends', slot: 'evening', label: 'See your friends', note: 'Free', run: g => { const s = g.s; for (const id of ['manny', 'dev', 'jassi']) if (s.people[id].met && !s.people[id].gone && (id !== 'jassi' || s.flags.jassi_here)) { g.bond(id, 5); g.trust(id, 2); g.ledger('gave_time', id, 1); } g.mood(5); social(g); } },
      { id: 'course4', slot: 'evening', label: 'Business course', note: '$2,000', run: g => { g.money(-2000, 'Business course'); g.skill('management', 1); g.energy(-10); } },
      { id: 'rest', slot: 'evening', label: 'Rest', note: 'Free', run: g => { g.energy(20); g.mood(3); } }
    ],
    // Chapter 5: a period is three years.
    [
      { id: 'expand', slot: 'day', label: s => `Open another ${P.BIZ[s.biz.type].unit}`, note: s => `About ${P.fmtPlain(Math.round(P.BIZ[s.biz.type].setup * 0.8 * s.biz.scale))}`, show: s => s.biz && s.biz.open && s.biz.scale < 5, run: g => { const b = g.s.biz, cost = Math.round(P.BIZ[b.type].setup * 0.8 * b.scale); g.money(-cost, `Opened ${P.BIZ[b.type].unit} #${b.scale + 1}`); b.scale++; b.health = P.clamp(b.health - 5, 0, 100); g.energy(-40); g.bond('maa', -4); g.bond('farah', -6); g.skill('management', 1); g.ledger('work_first', null, 2); g.say(`You now run ${b.scale} ${P.BIZ[b.type].unit}s.`); } },
      { id: 'hold', slot: 'day', label: 'Hold steady', note: 'Normal years', show: s => s.biz && s.biz.open, run: g => { g.s.biz.health = P.clamp(g.s.biz.health + 6, 0, 100); g.energy(-25); } },
      { id: 'manager', slot: 'day', label: 'Hire a manager and step back', note: '$30,000', show: s => s.biz && s.biz.open, run: g => { g.money(-30000, 'Manager salary'); g.s.biz.health = P.clamp(g.s.biz.health + 2, 0, 100); g.energy(10); g.mood(6); g.flag('stepped_back'); } },
      { id: 'sell', slot: 'day', label: 'Sell the business', note: 'Cash out', show: s => s.biz && s.biz.open, run: g => { g.queueLast('sell_biz'); g.energy(-10); } },
      { id: 'restart', slot: 'day', label: 'Start over small: a cleaning crew', note: '$8,000', show: s => !(s.biz && s.biz.open) && !s.flags.restarted, run: g => { g.flag('restarted'); g.money(-8000, 'New cleaning company'); P.openBusiness(g, 'cleaning', null, 100, 'cleaning company'); g.energy(-30); g.say('Back to buckets and night shifts. It is yours.'); } },
      { id: 'job5', slot: 'day', label: 'Take a steady job', note: 'About $150,000 over three years', show: s => !(s.biz && s.biz.open), run: g => { g.money(150000, 'Salary'); g.energy(-25); g.s.flags._worked = true; } },
      { id: 'call', slot: 'evening', label: 'Call home every week', note: 'Free', run: g => callHome(g, true) },
      { id: 'visit', slot: 'evening', label: 'Fly home for a month', note: '$6,000', run: g => { g.money(-6000, 'Trip home'); people(g, 'maa', 15, 5); g.bond('papa', 12); g.bond('simran', 10); g.mood(10); g.s.stats.calls += 4; g.flag('visited'); g.ledger('gave_time', 'maa', 3); } },
      { id: 'farah', slot: 'evening', label: 'Time with Farah', note: '$5,000', show: s => s.partner === 'married', run: g => { g.money(-5000, 'Holidays, dinners'); people(g, 'farah', 12, 5); g.mood(8); g.ledger('gave_time', 'farah', 2); } },
      { id: 'friends', slot: 'evening', label: 'See your friends', note: 'Free', run: g => { const s = g.s; for (const id of ['manny', 'dev', 'jassi']) if (s.people[id].met && !s.people[id].gone && (id !== 'jassi' || s.flags.jassi_here)) { g.bond(id, 6); g.trust(id, 2); g.ledger('gave_time', id, 1); } g.mood(5); social(g); } },
      { id: 'rest', slot: 'evening', label: 'Slow down', note: 'Free', run: g => { g.energy(25); g.mood(5); } }
    ]
  ];

  // ---------- bills ----------
  P.BILLS = [
    g => { g.money(-30, 'Your share at home'); },
    g => {
      const s = g.s;
      g.money(-95, 'Groceries, phone, bus pass');
      if (!s.flags._classes) { s.stats.classSkips++; if (s.stats.classSkips >= 3 && !s.flags.college_warned) g.queueLast('college_warning'); }
      s.flags._classes = false;
      if (s.turn === 4 || s.turn === 8) {
        const rent = (s.flags.cheap_room ? 500 : 750) + (s.flags.rent_owed || 0);
        if (s.money >= rent) { g.money(-rent, 'Rent'); s.flags.rent_owed = 0; g.say(`Rent paid: ${g.fmt(rent)}.`); }
        else g.queueLast('rent_short');
      }
    },
    g => {
      const s = g.s;
      g.money(-4200, 'Rent and living');
      if (s.debt > 0) { const p = Math.min(1500, s.debt); g.money(-p, 'Bank loan payment'); s.debt -= p; }
      if (s.flags.car) g.money(-600, 'Car payment and insurance');
    },
    g => {
      const s = g.s;
      g.money(s.partner === 'married' ? -18000 : -14000, 'Rent and living');
      if (s.debt > 0) { const p = Math.min(5000, s.debt); g.money(-p, 'Loan payments'); s.debt -= p; }
    },
    g => {
      const s = g.s;
      g.money(s.partner === 'married' ? -90000 : -70000, 'Home and living, three years');
      if (s.debt > 0) { const p = Math.min(25000, s.debt); g.money(-p, 'Loan payments'); s.debt -= p; }
    }
  ];

  P.ONSTART = [
    null,
    g => { const s = g.s; g.money(2000, 'Cash from home'); g.money(-1500, 'First and last month\'s rent'); g.money(-250, 'Textbooks'); s.home = 'Shared basement'; g.meet('manny'); s.career = 50; s.job = null; s.people.manny.lastSeen = s.clock; },
    g => { const s = g.s; s.home = 'Shared flat'; s.job = null; s.career = 50; },
    g => { const s = g.s; s.home = s.partner === 'married' ? 'Two-bedroom apartment' : 'One-bedroom apartment'; },
    null
  ];

  // Story beats: [0] runs when the chapter opens; [n] runs after period n.
  P.BEATS = [
    [['ch1_open'], ['funding'], ['english_test'], ['visa_refused'], ['visa_ok', 'jassi_dream'], ['promise_simran'], ['airport']],
    [['arrival'], ['first_job'], ['call_home'], ['manny_asks'], [], [], ['shift_cut'], ['manny_after'], ['ch2_close']],
    [['ch3_open'], ['farah_meet'], ['dev_meet'], ['harjit_calls'], ['pr_apply', 'lie_found'], ['jassi_asks'], ['lie_found'], ['pr_result', 'farah_step'], ['dev_idea']],
    [['biz_choose'], ['biz_first'], ['manny_returns'], ['partner_moment'], ['home_pull', 'jassi_arrives'], ['big_contract', 'farah_again'], ['ch4_close']],
    [['ch5_open'], ['simran_wedding'], ['maa_ill'], ['maa_goodbye'], ['marriage_turn'], ['land_back', 'final_home']]
  ];

  const job = s => (s.job ? P.JOBS[s.job].label : 'job');
  const S = (P.SCENES = {});

  // =============== Chapter 1: Home ===============
  S.ch1_open = {
    title: () => 'Nurmahal, Punjab',
    text: s => `The shutter of Papa's hardware shop sticks halfway, the way it has for a year. Sales are down a third since the big store opened on the highway.\n\nMaa puts a steel glass of tea in front of you. «Puttar, Jassi de cousin nu Canada da visa mil gaya.»{Child, Jassi's cousin got his visa for Canada.} Papa doesn't look up from the ledger.\n\nYou are 22, ${s.name}. Everyone at this table already knows what you are going to say.`,
    choices: [
      { label: "\"I'll go. For all of us.\"", run: g => { g.flag('why_family'); g.bond('maa', 3); g.trust('papa', 5); g.memory('The shop shutter, stuck halfway.'); return 'Papa closes the ledger. He says nothing, but he pours you more tea.'; } },
      { label: '"I want to go. I want my own life."', run: g => { g.flag('why_self'); g.mood(5); g.bond('simran', 3); g.memory('The shop shutter, stuck halfway.'); return 'Simran grins at you across the table. Maa looks at the wall for a long time.'; } },
      { label: '"I don\'t want to go. But what choice is there?"', run: g => { g.mood(-3); g.bond('maa', 4); g.memory('The shop shutter, stuck halfway.'); return 'Maa squeezes your hand. «Sab theek ho jaavega.»{It will all be fine.}'; } }
    ]
  };
  S.funding = {
    title: () => 'Paying for it',
    text: () => 'The agent in Jalandhar lays it out on a laminated sheet: college fees, the insurance deposit, the flight. ₹21 lakh, about $35,000.\n\nPapa has a number in his head, and it is not that.',
    choices: [
      { label: 'Take a bank loan against the house', run: g => { g.s.debt = 30000; g.flag('bank_loan'); g.mood(-3); g.ledger('took_loan', null, 30000); return 'The house papers go into a bank file. Repayments start once you are working: ₹90,000 a season.'; } },
      { label: 'Ask Harjit Chacha for the money', run: g => { g.flag('uncle_loan'); g.flag('uncle_owed', 30000); g.meet('harjit'); g.trust('harjit', 5); g.ledger('owes', 'harjit', 30000); return 'Harjit Chacha counts it out at his kitchen table. «Koi gal nahi. Jad ho sake, mod deyin.»{No problem. Pay it back when you can.} He writes nothing down. That worries you more than a contract would.'; } },
      { label: "Sell two acres of Papa's land", run: g => { g.flag('sold_land'); g.bond('papa', -20); g.trust('papa', -10); g.ledger('money_over_people', 'papa', 35000, 2); return "Papa signs at the tehsil office and walks out without waiting for you. Those acres were his father's."; } }
    ]
  };
  S.english_test = {
    title: () => 'Test day in Ludhiana',
    text: () => 'Listening, reading, writing, speaking. In the speaking part the examiner asks you to describe "a place you remember from childhood".',
    choices: [
      { label: 'Talk about the canal where you and Jassi swam', run: g => testResult(g, 'The canal behind the fields.') },
      { label: "Talk about the roof of Papa's shop at kite season", run: g => testResult(g, 'Kites over the shop roof.') }
    ]
  };
  function testResult(g, mem) {
    const s = g.s, score = Math.min(9, 4.5 + s.skills.language * 0.5 + Math.round(g.rand() * 2) * 0.5);
    g.memory(mem);
    if (score >= 6) { g.flag('test_pass'); g.mood(8); return `You score ${score.toFixed(1)}. You needed 6.0. Maa distributes ladoos to the whole lane.`; }
    g.money(-280, 'Test retake'); g.mood(-8); g.skill('language', 1);
    return `You score ${score.toFixed(1)}. You needed 6.0. The retake costs ₹17,000 and another month of evenings. The second time, you pass.`;
  }
  S.visa_refused = {
    title: () => 'Refused',
    text: () => 'The email comes at 2 a.m.\n\n"The officer is not satisfied that you will leave Canada at the end of your stay."\n\nTen months of planning, one sentence.',
    choices: [
      { label: 'Reapply with a stronger file', run: g => { g.money(-250, 'Visa fees'); g.energy(-10); g.mood(-6); return 'You spend a week collecting land records, Papa\'s tax papers and a letter from the college. The second application goes in.'; } },
      { label: 'Pay the agent extra to "fix" the file', run: g => { g.money(-600, 'Agent "fee"'); g.flag('agent_shortcut'); g.ledger('shortcut', null, 600); return 'The agent smiles too much. The second application goes in with papers you never saw.'; } },
      { label: "Tell the family it's only a delay", run: g => { g.lie('maa'); g.mood(-2); return 'You tell everyone the visa is delayed, and reapply quietly.'; } }
    ]
  };
  S.visa_ok = {
    title: () => 'Approved',
    text: () => 'Six weeks later the passport comes back by courier with a sticker in it. You read your own name on it four times.',
    choices: [
      { label: 'Call Maa first', run: g => { g.bond('maa', 4); g.memory('The visa sticker in the passport.'); return 'She cries so loudly that the neighbours come over.'; } },
      { label: 'Call Jassi first', run: g => { g.bond('jassi', 5); g.memory('The visa sticker in the passport.'); return 'He shouts so loudly that you have to hold the phone away from your ear.'; } }
    ]
  };
  S.jassi_dream = {
    title: () => 'The canal',
    text: () => 'Jassi drives you to the canal on his scooter. He wanted this too, but his father won\'t sell anything.\n\n«Tu pahunch ke mainu vi bula layin.»{When you get there, bring me over too.}',
    choices: [
      { label: '"I promise. As soon as I can."', run: g => { g.flag('promise_jassi'); g.trust('jassi', 10); g.bond('jassi', 5); g.ledger('promised', 'jassi'); return 'He holds out his little finger, like when you were nine.'; } },
      { label: '"I can\'t promise. I don\'t know what it\'s like there."', run: g => { g.trust('jassi', 4); g.bond('jassi', -3); return 'He nods slowly. «Sach bolya.»{You told the truth.}'; } },
      { label: '"Maybe you\'re better off here."', run: g => { g.bond('jassi', -8); g.trust('jassi', -5); return 'He doesn\'t answer. He drops you home without stopping for chai.'; } }
    ]
  };
  S.promise_simran = {
    title: () => 'Simran',
    text: () => "Simran is 17 and furious that you are leaving before her board exams. That night she slips a drawing into your suitcase: the two of you on the shop roof, kites everywhere.",
    choices: [
      { label: 'Promise to come back for her wedding, whatever happens', run: g => { g.flag('promise_wedding'); g.bond('simran', 8); g.trust('simran', 8); g.ledger('promised', 'simran'); g.memory("Simran's drawing of kites over the shop."); return '"Pinky promise. Even if I marry a boring engineer."'; } },
      { label: 'Promise to call every Sunday', run: g => { g.flag('promise_sunday'); g.bond('simran', 5); g.memory("Simran's drawing of kites over the shop."); return 'She writes SUNDAY on your hand in marker.'; } },
      { label: 'Tell her not to make you promise things', run: g => { g.bond('simran', -5); g.trust('simran', 2); g.memory("Simran's drawing of kites over the shop."); return 'She takes the drawing back out of the suitcase. Then she puts it in again.'; } }
    ]
  };
  S.airport = {
    title: () => 'Amritsar airport, 3 a.m.',
    text: () => 'The whole family came, and Harjit Chacha, and Jassi. Maa has packed three kilos of pinni that security will not let through.\n\nThe queue for the gate is moving.',
    choices: [
      { label: 'Hold Maa for a long time', run: g => { g.bond('maa', 8); g.mood(4); g.memory('The airport goodbye, 3 a.m.'); return 'She smells of cardamom and diesel. She doesn\'t cry until you let go.'; } },
      { label: 'Shake Papa\'s hand like a grown-up', run: g => { g.bond('papa', 6); g.trust('papa', 5); g.memory('The airport goodbye, 3 a.m.'); return 'He pulls you into a hug instead, the first one in years.'; } },
      { label: "Walk through and don't look back", run: g => { g.mood(-6); g.memory('The airport goodbye, 3 a.m.'); return 'You hear Maa call your name once. You don\'t turn around. If you turn around, you won\'t go.'; } }
    ]
  };

  // =============== Chapter 2: Starting from zero ===============
  S.arrival = {
    title: () => 'Bramford, Ontario · −14°C',
    text: () => 'The basement is under a house on Sandalwood Court: four mattresses, one window at ground level, a shared bathroom with a sign that says 10 MINUTE SHOWERS. Rent is $750 a month for a quarter of a room.\n\nManny, from Hoshiarpur, has been here two years and has the corner by the heater. «Welcome to Canada, bai. Pehla rule: mummy nu basement baare na dassin.»{Welcome to Canada, brother. First rule: don\'t tell your mother about the basement.}',
    choices: [
      { label: 'Laugh, and unpack', run: g => { g.bond('manny', 5); g.trust('manny', 3); g.mood(3); g.memory('The basement window, at ground level.'); return 'Manny clears half a shelf for you.'; } },
      { label: 'Ask Manny how he got through the first month', run: g => { g.bond('manny', 8); g.trust('manny', 5); g.flag('manny_advice'); g.memory('The basement window, at ground level.'); return 'He tells you which warehouses hire students, which agencies to avoid, and where the langar is free.'; } },
      { label: 'Take the free mattress, face the wall, sleep', run: g => { g.energy(10); g.mood(-4); g.memory('The basement window, at ground level.'); return 'The furnace kicks on every forty minutes. You count them.'; } }
    ]
  };
  S.first_job = {
    title: () => 'First job',
    when: s => !s.job,
    text: s => `The agency office smells of wet boots. Two offers on the board today.${s.flags.manny_advice ? ' Manny told you the warehouse pays on time.' : ''}`,
    choices: [
      { label: 'Warehouse picker, $18/h, nights', run: g => { g.s.job = 'warehouse'; g.s.career = 50; return 'Orientation is a video about lifting with your knees. You start Thursday.'; } },
      { label: 'Kitchen dishwasher, $17.20/h plus a meal', run: g => { g.s.job = 'kitchen'; g.s.career = 50; return 'The chef, a Goan woman named Lorna, hands you an apron and says, "Fast, not careful."'; } },
      { label: 'Hold out for something better', run: g => { g.mood(-2); return 'You keep looking. Your savings keep going down.'; } }
    ]
  };
  S.call_home = {
    title: () => 'Sunday video call',
    text: () => 'Maa\'s face fills the screen, too close, the way she always holds the phone.\n\n«Kamra dikha, puttar.»{Show me your room, child.}\n\nBehind your phone: three mattresses, a drying rack, Manny snoring.',
    choices: [
      { label: 'Tell the truth: a shared basement, and it\'s hard', run: g => { g.flag('told_truth'); g.trust('maa', 10); g.bond('maa', 4); g.mood(6); g.s.stats.calls++; return 'She goes quiet. Then: «Roti taan khaanda hain na?»{But you are eating, aren\'t you?} You talk for an hour.'; } },
      { label: 'Point the camera at the one clean wall. "Everything is fine."', run: g => { g.lie('maa'); g.flag('lied_home'); g.bond('maa', 2); g.mood(-3); g.s.stats.calls++; return 'She smiles. «Shukar hai.»{Thank God.} After you hang up you sit on the edge of the mattress for a while.'; } },
      { label: 'Say the line is bad and hang up', run: g => { g.bond('maa', -5); g.mood(-4); return 'She sends four voice notes. You listen to one.'; } }
    ]
  };
  S.manny_asks = {
    title: () => 'On the stairs',
    text: s => `Manny catches you on the basement stairs. His hours got cut and his own rent is due Friday.\n\n«Teen sau dollar, bai. Do hafte, sahun.»{Three hundred dollars, brother. Two weeks, I swear.}\n\nYou have ${P.fmt(s, s.money)}. Your rent of $750 is due at the end of next week.`,
    choices: [
      { label: 'Lend him $300', run: g => { g.need('manny', 'desperate'); g.money(-300, 'Lent to Manny'); g.trust('manny', 15); g.bond('manny', 8); g.flag('lent_manny'); g.ledger('lent', 'manny', 300, 2); g.need('manny', 'struggling'); return 'He hugs you so hard your back cracks.'; } },
      { label: 'Lend him $100. It\'s what you can spare.', run: g => { g.need('manny', 'desperate'); g.money(-100, 'Lent to Manny'); g.trust('manny', 6); g.bond('manny', 3); g.flag('lent_manny_part'); g.ledger('lent', 'manny', 100); g.need('manny', 'struggling'); return '«Theek aa. Thanks, bai.»{Okay. Thanks, brother.} He was hoping for more.'; } },
      { label: 'Say no. You can\'t risk your own rent.', run: g => { g.need('manny', 'desperate'); g.trust('manny', -15); g.bond('manny', -6); g.flag('refused_manny'); g.ledger('refused', 'manny', 300, 2); return '«Theek aa.»{Fine.} He doesn\'t look at you.'; } }
    ]
  };
  S.rent_short = {
    title: () => 'Rent day',
    bad: true,
    text: s => `Mr. Gill, the landlord, texts: "Rent pls. ${P.fmt(s, (s.flags.cheap_room ? 500 : 750) + (s.flags.rent_owed || 0))}."\n\nYou have ${P.fmt(s, s.money)}.`,
    choices: [
      { label: 'Take an extra shift and skip the Sunday call', show: s => !!s.job, run: g => { const rent = (g.s.flags.cheap_room ? 500 : 750) + (g.s.flags.rent_owed || 0); g.money(230, 'Extra shift'); g.energy(-25); g.bond('maa', -6); g.ledger('money_over_people', 'maa', 230); if (g.s.money >= rent) { g.money(-rent, 'Rent'); g.s.flags.rent_owed = 0; return 'You pay the rent on time. Maa\'s missed calls sit on your screen: 3.'; } return payWhatYouCan(g, rent); } },
      { label: 'Ask Manny to pay back what he owes', show: s => s.flags.lent_manny || s.flags.lent_manny_part, run: g => { const rent = (g.s.flags.cheap_room ? 500 : 750) + (g.s.flags.rent_owed || 0); if (g.s.people.manny.trust >= 30) { const back = g.s.flags.lent_manny ? 300 : 100; g.money(back, 'Manny paid back'); g.flag('manny_repaid'); g.trust('manny', -3); if (g.s.money >= rent) { g.money(-rent, 'Rent'); g.s.flags.rent_owed = 0; return `Manny borrows it from someone else to pay you. He doesn't complain. Rent paid.`; } return payWhatYouCan(g, rent); } g.trust('manny', -8); return payWhatYouCan(g, rent, 'Manny says next week. '); } },
      { label: 'Ask Harjit Chacha to send something', show: s => s.flags.uncle_loan, run: g => { const rent = (g.s.flags.cheap_room ? 500 : 750) + (g.s.flags.rent_owed || 0); g.money(300, 'From Harjit Chacha'); g.s.flags.uncle_owed += 300; g.trust('harjit', -3); if (g.s.money >= rent) { g.money(-rent, 'Rent'); g.s.flags.rent_owed = 0; return 'He sends $300 with a voice note you don\'t listen to all the way through. Rent paid.'; } return payWhatYouCan(g, rent); } },
      { label: 'Pay what you have and promise the rest', run: g => payWhatYouCan(g, (g.s.flags.cheap_room ? 500 : 750) + (g.s.flags.rent_owed || 0)) }
    ]
  };
  function payWhatYouCan(g, rent, pre) {
    const s = g.s, paid = Math.max(0, Math.min(s.money, rent));
    if (paid) g.money(-paid, 'Part of the rent');
    s.flags.rent_owed = rent - paid + 50;
    s.stats.missedRent++;
    g.mood(-8);
    g.ledger('missed_rent', null, rent - paid);
    if (s.stats.missedRent >= 2) { g.queue('evicted'); return (pre || '') + 'You pay what you can. Mr. Gill doesn\'t reply. The next morning there is a notice on the door.'; }
    return (pre || '') + `You pay ${g.fmt(paid)}. Mr. Gill adds a $50 late fee to the rest.`;
  }
  S.evicted = {
    title: () => 'Out',
    bad: true,
    text: () => 'Mr. Gill wants you out by Sunday. Two bags, one mattress you can\'t take.',
    choices: [
      { label: 'Ask the gurdwara for a room', run: g => { const s = g.s; s.flags.rent_owed = 0; s.flags.cheap_room = true; s.home = 'Gurdwara guest room'; g.mood(-10); g.memory('Two bags on the gurdwara steps.'); return 'An old sevadar gives you a key and doesn\'t ask questions. Rent from now on: $500, when you can.'; } },
      { label: 'Sleep on a co-worker\'s couch', run: g => { const s = g.s; s.flags.rent_owed = 0; s.flags.cheap_room = true; s.home = "A co-worker's couch"; g.mood(-12); g.energy(-10); return 'His kids watch cartoons at 6 a.m. You pay him $500 a month.'; } }
    ]
  };
  S.college_warning = {
    title: () => 'Email from the college',
    text: () => '"Your attendance has fallen below 70%. International students who do not meet attendance requirements may be reported, which can affect their study permit."',
    choices: [
      { label: 'Go to every class from now on', run: g => { g.flag('college_warned'); g.s.stats.classSkips = 0; return 'You move a shift. It costs you money you needed.'; } },
      { label: 'Ignore it. Rent is more urgent than attendance.', run: g => { g.flag('college_warned'); g.flag('ignored_college'); g.mood(-3); g.ledger('shortcut', null, 0); return 'You delete the email. You think about it every night anyway.'; } }
    ]
  };
  S.shift_cut = {
    title: () => 'The schedule',
    bad: true,
    when: s => !!s.job,
    text: s => `The ${job(s).toLowerCase()} schedule goes up. Your hours are cut in half for two weeks. Someone's cousin got your shifts.`,
    choices: [
      { label: 'Ask the supervisor for your hours back', run: g => { if (g.s.career >= 60) { g.career(5); return 'She looks at your record and gives two shifts back.'; } g.career(-5); g.money(-120, 'Lost shifts'); return '"Talk to me when you\'ve been here a year."'; } },
      { label: 'Find a cash job moving furniture', run: g => { g.money(150, 'Moving job, cash'); g.energy(-20); return 'A man with a van pays you $150 to carry a piano up three floors.'; } },
      { label: 'Use the time to study', run: g => { g.money(-120, 'Lost shifts'); g.skill('language', 1); g.mood(2); return 'You read the whole library copy of a business English textbook.'; } }
    ]
  };
  S.manny_after = {
    title: () => 'Manny',
    text: s => {
      if (s.flags.refused_manny) return 'On Sunday Manny moves out. He leaves a note on your mattress: "No hard feelings. Good luck bai."\n\nYou don\'t believe the first part.';
      if (s.flags.manny_repaid) return 'Manny comes home with a box of jalebi. He is still short, but he made it.';
      return 'Manny got his hours back. He comes home with a box of jalebi and slides an envelope under your pillow.';
    },
    choices: [
      { label: 'Continue', run: g => { const s = g.s; if (s.flags.refused_manny) { g.flag('manny_moved'); g.bond('manny', -10); return 'His corner by the heater is empty. A new guy takes it.'; } if (!s.flags.manny_repaid && (s.flags.lent_manny || s.flags.lent_manny_part)) { const back = s.flags.lent_manny ? 300 : 100; g.money(back, 'Manny paid back'); g.flag('manny_repaid'); g.trust('manny', 6); return `${g.fmt(back)}, every dollar. Two days late.`; } g.trust('manny', 4); return 'You split the jalebi four ways at midnight.'; } }
    ]
  };
  S.ch2_close = {
    title: () => 'Two months in',
    text: () => 'Your English is faster now. Your shoulders hurt in a way they never did at home. On the bus you catch yourself thinking in dollars instead of rupees.',
    choices: [
      { label: 'Write a letter to Simran', run: g => { g.bond('simran', 6); g.memory('The first snow, from the basement window.'); return 'Four pages. You leave out the bad parts, and then you add one back in.'; } },
      { label: 'Send Maa a photo of the snow', run: g => { g.bond('maa', 4); g.memory('The first snow, from the basement window.'); return '«Thand lagdi hogi!»{You must be cold!} She sends back a photo of a sweater she is knitting.'; } },
      { label: 'Go to bed', run: g => { g.energy(10); g.memory('The first snow, from the basement window.'); return 'You sleep eleven hours.'; } }
    ]
  };

  // =============== Chapter 3: The hustle ===============
  S.ch3_open = {
    title: () => 'Graduation',
    text: () => 'A rented gown in a convention centre off the highway. Your post-graduation work permit comes through: three years to work anywhere, for anyone.',
    choices: [
      { label: 'Send Maa the photo in the gown', run: g => { g.bond('maa', 5); g.bond('papa', 4); g.memory('Graduation, in a rented gown.'); g.queue('job_choice'); return 'Papa makes it his phone wallpaper. Simran tells you this; Papa never would.'; } },
      { label: 'Skip the ceremony and work the shift', run: g => { g.money(300, 'Saturday shift'); g.mood(-4); g.queue('job_choice'); return 'You pick orders while your class throws their caps.'; } }
    ]
  };
  S.job_choice = {
    title: () => 'Choosing work',
    text: s => `You have ${P.fmt(s, s.money)}. Each job pays differently and costs you differently.`,
    choices: [
      { label: 'Warehouse picker · $19/h · hard on the body', run: g => setJob(g, 'warehouse') },
      { label: 'Delivery driver · $14–26/h · buy a used car for $4,000', show: s => !s.flags.car && s.money >= 4000, run: g => { g.money(-4000, 'Used Corolla'); g.flag('car'); return setJob(g, 'delivery'); } },
      { label: 'Delivery driver · $14–26/h · you have a car', show: s => s.flags.car, run: g => setJob(g, 'delivery') },
      { label: 'Line cook · $17/h + tips · evenings and weekends', run: g => setJob(g, 'restaurant') },
      { label: 'Call centre agent · $19/h · needs good English', show: s => s.skills.language >= 3, run: g => setJob(g, 'callcentre') },
      { label: 'Long-haul trucker · paid by the mile · weeks away', show: s => s.flags.truck_licence, run: g => setJob(g, 'trucker') },
      { label: 'Keep what you have', show: s => !!s.job, run: () => 'You stay put. Better the devil you know.' }
    ]
  };
  function setJob(g, id) { g.s.job = id; g.s.career = 50; return `You start as a ${P.JOBS[id].label.toLowerCase()} on Monday.`; }
  S.farah_meet = {
    title: () => 'Farah',
    text: () => 'Farah Siddiqui, from Lahore, does payroll at the agency. She laughs at your jokes, which no one here does, and corrects your timesheet without making you feel stupid.',
    choices: [
      { label: 'Ask her for chai after work', run: g => { g.meet('farah'); g.bond('farah', 22); g.trust('farah', 8); g.s.partner = 'dating'; g.memory('Chai with Farah in a parking lot.'); return 'Chai turns into two hours in a parking lot, heater running.'; } },
      { label: 'Keep it friendly and professional', run: g => { g.meet('farah'); g.bond('farah', 4); return 'She waves when you pass. You wave back.'; } }
    ]
  };
  S.dev_meet = {
    title: () => 'Dev',
    text: () => 'Dev Patel works two jobs and keeps a spreadsheet for everything, including his sleep. Today he looks wrecked: his mother is in hospital in Surat and he needs someone to cover his Saturday.',
    choices: [
      { label: 'Cover his shift', run: g => { g.meet('dev'); g.need('dev', 'desperate'); g.trust('dev', 15); g.bond('dev', 10); g.energy(-15); g.ledger('helped', 'dev', 1, 2); g.need('dev', 'fine'); return 'He books the next flight. When he comes back he brings you a box of Surati ghari and says, "I owe you."'; } },
      { label: '"I can\'t. I\'m dead on my feet."', run: g => { g.meet('dev'); g.need('dev', 'desperate'); g.trust('dev', -8); g.bond('dev', 2); g.need('dev', 'fine'); return 'He finds someone else. He is polite to you afterwards. Only polite.'; } }
    ]
  };
  S.harjit_calls = {
    title: () => 'Harjit Chacha',
    bad: true,
    when: s => s.flags.uncle_loan && s.flags.uncle_owed > 0,
    text: s => `Harjit Chacha calls. His daughter's wedding is in March. He needs $10,000 of his money back. Now.\n\nYou have ${P.fmt(s, s.money)}.`,
    choices: [
      { label: 'Send the $10,000', show: s => s.money >= 10000, run: g => { g.money(-10000, 'Repaid Harjit Chacha'); g.s.flags.uncle_owed -= 10000; g.trust('harjit', 15); g.bond('papa', 4); g.ledger('repaid', 'harjit', 10000); return '«Jeonda reh, puttar.»{Live long, child.} Papa calls the next day just to say the wedding tent is enormous.'; } },
      { label: 'Send $3,000 and promise the rest', show: s => s.money >= 3000, run: g => { g.money(-3000, 'Part repaid to Harjit Chacha'); g.s.flags.uncle_owed -= 3000; g.trust('harjit', 2); return 'He says nothing, which says enough.'; } },
      { label: '"Chacha ji, I need until next year."', run: g => { g.trust('harjit', -15); g.bond('papa', -8); g.flag('harjit_upset'); g.ledger('broke_promise', 'harjit', 0, 2); return 'Papa hears about it at the gurdwara before you can tell him.'; } }
    ]
  };
  S.pr_apply = {
    title: () => 'Permanent residency',
    text: () => 'The points system wants English scores, Canadian work experience and savings. The application fee is $1,525.',
    choices: [
      { label: 'Apply now', show: s => s.money >= 1525, run: g => { g.money(-1525, 'PR application'); g.flag('pr_applied'); return 'You upload 61 documents. The portal times out twice.'; } },
      { label: 'Wait a year and improve your scores', run: g => { g.flag('pr_wait'); g.skill('language', 1); return 'You buy a used test-prep book and leave it on your pillow.'; } }
    ]
  };
  S.lie_found = {
    title: () => 'The photo',
    bad: true,
    when: s => s.flags.lied_home && !s.flags.told_truth && !s.flags.truth_late && !s.seen.lie_found,
    text: () => 'Your cousin Rupinder visits Toronto and posts a photo of you outside the basement door, laundry bag over your shoulder.\n\nMaa calls at 6 a.m. «Tu jhooth kyon boleya?»{Why did you lie to me?}',
    choices: [
      { label: 'Tell her everything, now', run: g => { g.flag('truth_late'); g.trust('maa', 5); g.bond('maa', 2); g.mood(4); return 'It takes two hours. At the end she says, «Agli vaar, pehlan dassin.»{Next time, tell me first.}'; } },
      { label: '"That photo is old. It\'s better now."', run: g => { g.lie('maa'); g.trust('maa', -10); return 'She says "okay" in the voice that means it isn\'t.'; } },
      { label: '"What did you want me to say?"', run: g => { g.bond('maa', -10); g.trust('maa', -5); g.mood(-6); return 'She hangs up first, for the first time in your life.'; } }
    ]
  };
  S.jassi_asks = {
    title: () => 'Jassi',
    text: s => `Jassi calls from Nurmahal. His agent wants $3,000 more or his file "goes nowhere".\n\n«Tu hi hai mera, yaar.»{You're all I've got, friend.}\n\nYou have ${P.fmt(s, s.money)}.`,
    choices: [
      { label: 'Send him $3,000', show: s => s.money >= 3000, run: g => { g.need('jassi', 'desperate'); g.money(-3000, 'Sent to Jassi'); g.trust('jassi', 15); g.bond('jassi', 10); g.flag('helped_jassi'); g.ledger('lent', 'jassi', 3000, 2); g.need('jassi', 'fine'); return 'He sends a voice note that is just him breathing, then "thank you" eleven times.'; } },
      { label: 'Say the agent sounds like a scam, and offer to check his papers', run: g => { g.flag('warned_jassi'); g.trust('jassi', 5); g.energy(-10); return 'You spend three nights reading his file over video. Half the documents are fake. He is furious, at the agent, mostly.'; } },
      { label: 'Say you can\'t right now', run: g => { g.need('jassi', 'desperate'); g.trust('jassi', -15); g.bond('jassi', -10); g.flag('refused_jassi'); if (g.has('promise_jassi')) g.ledger('broke_promise', 'jassi', 0, 3); g.need('jassi', 'fine'); return '«Koi na.»{It\'s fine.} He doesn\'t call the next Sunday.'; } }
    ]
  };
  S.pr_result = {
    title: () => 'The letter',
    when: s => s.flags.pr_applied,
    text: s => (s.skills.language >= 4 ? 'The email subject line says "Confirmation of Permanent Residence". You read it standing up in the bus.' : 'The email asks for "additional documents". Another four months, at least.'),
    choices: [
      { label: 'Continue', run: g => { if (g.s.skills.language >= 4) { g.flag('pr'); g.mood(15); g.memory('The PR confirmation email.'); return 'You call home from the bus. The whole family is on the line within a minute.'; } g.mood(-6); g.flag('pr_delayed'); return 'You send the documents. And wait.'; } }
    ]
  };
  S.farah_step = {
    title: () => 'Farah',
    when: s => s.partner === 'dating' && s.people.farah.bond >= 32,
    text: s => `Farah's parents want to meet you. "Are you serious about this, ${s.name}? Because I am."`,
    choices: [
      { label: '"Yes. Let\'s get married."', run: g => { g.s.partner = 'married'; g.bond('farah', 15); g.trust('farah', 10); g.memory('Your wedding, two families, one very long dinner.'); return 'Two families, two languages, one very long dinner. Maa joins on video and cries through all of it.'; } },
      { label: '"Not yet. I need to be settled first."', run: g => { g.bond('farah', -6); g.trust('farah', -5); return 'She says she understands. She asks again in a year, in her head.'; } },
      { label: '"I\'m not ready for any of this."', run: g => { g.s.partner = 'declined'; g.bond('farah', -25); g.ledger('chose_alone', 'farah', 0, 2); return 'She leaves your key on the counter.'; } }
    ]
  };
  S.dev_idea = {
    title: () => 'The spreadsheet',
    text: s => `Dev slides his laptop across a Tim Hortons table. "Offices need cleaning at night. I have two contracts lined up. I need a partner."${s.flags.truck_licence ? '\n\nYou have a truck licence in your wallet and an idea of your own.' : ''}`,
    choices: [
      { label: '"I\'m in."', show: s => s.people.dev.met, run: g => { g.flag('dev_offer'); g.trust('dev', 8); return 'He opens a new tab named PARTNERS. Your name is already in it.'; } },
      { label: '"Maybe. I have my own ideas."', run: g => { g.flag('own_ideas'); return '"Fair," he says, and saves a copy for you anyway.'; } }
    ]
  };

  // =============== Chapter 4: Business ===============
  S.biz_choose = {
    title: () => 'Your own thing',
    text: s => `Four years in. You have ${P.fmt(s, s.money)}${s.debt > 0 ? ` and still owe the bank ${P.fmt(s, s.debt)}` : ''}. A bank officer named Tracy says she can lend up to $45,000 "to the right business plan".`,
    choices: [
      { label: 'Cleaning company with Dev · $4,000 each · 50/50', show: s => s.people.dev.met && s.people.dev.trust >= 20 && s.money >= 4000, run: g => { g.money(-4000, 'Cleaning company: your half'); P.openBusiness(g, 'cleaning', 'dev', 50, 'Spotless Night Cleaning'); return 'You and Dev register Spotless Night Cleaning. The first night you clean 40 toilets yourselves.'; } },
      { label: 'Cleaning company, alone · $8,000', show: s => s.money >= 8000, run: g => { g.money(-8000, 'Cleaning company'); P.openBusiness(g, 'cleaning', null, 100, 'cleaning company'); return 'One van, three cleaners, your name on the insurance.'; } },
      { label: 'Trucking · one used truck · $10,000 down + $25,000 loan', show: s => s.flags.truck_licence && s.money >= 10000, run: g => { g.money(-10000, 'Truck deposit'); g.s.debt += 25000; P.openBusiness(g, 'trucking', null, 100, 'trucking company'); g.memory('Your first truck, a 2014 Volvo, washed twice.'); return 'A 2014 Volvo with 900,000 km on it. You wash it twice before the first load.'; } },
      { label: 'Restaurant with Dev · $15,000 + $45,000 loan · 50/50', show: s => s.people.dev.met && s.people.dev.trust >= 20 && s.money >= 15000, run: g => { g.money(-15000, 'Restaurant: your share'); g.s.debt += 45000; P.openBusiness(g, 'restaurant', 'dev', 50, 'Tandoor & Tiffin'); g.memory('The sign going up: Tandoor & Tiffin.'); return 'Tandoor & Tiffin opens in a strip mall between a vape shop and a dentist.'; } },
      { label: 'Online store, alone · $6,000', show: s => s.money >= 6000, run: g => { g.money(-6000, 'Online store'); P.openBusiness(g, 'online', null, 100, 'online store'); return 'You sell phulkari cushion covers made by women in Nurmahal. Simran handles the supplier side.'; } },
      { label: 'Not yet. Keep working.', run: g => { g.flag('no_biz'); if (!g.s.job) g.s.job = 'warehouse'; return 'You keep your job. Safer. Smaller.'; } }
    ]
  };
  S.biz_first = {
    title: () => 'First hire',
    when: s => s.biz && s.biz.open,
    text: s => `The ${P.BIZ[s.biz.type].name} needs a first hire.`,
    choices: [
      { label: "Hire the gurdwara uncle's nephew, who needs a break", run: g => { g.s.biz.health += 6; g.money(-2000, 'Training the new hire'); return 'He is slow for a month and then the most reliable person you have.'; } },
      { label: 'Hire whoever is cheapest', run: g => { g.s.biz.health -= 6; g.money(2000, 'Lower wages'); return 'He quits in six weeks and takes a customer with him.'; } },
      { label: 'Do it all yourself for now', run: g => { g.s.biz.health += 3; g.energy(-20); g.bond('maa', -4); g.bond('farah', -4); return 'You stop answering calls after 9 p.m. because you are asleep at the table.'; } }
    ]
  };
  S.manny_returns = {
    title: () => 'Manny',
    text: s => {
      const t = s.people.manny.trust, lent = s.flags.lent_manny || s.flags.lent_manny_part;
      if (lent && t >= 55) return 'Manny walks into your office in a good jacket. He runs a tire shop now.\n\n«Yaad aa? Teen sau dollar.»{Remember? Three hundred dollars.}\n\nHe puts a cheque on the desk: $25,000. "Not a loan. A share. If you\'ll have me."';
      if (lent && t < 30) return 'You hear from the old basement crowd: Manny went back to India owing money to half of Bramford. Your money went with him.';
      if (s.flags.refused_manny) return 'In a Costco parking lot someone calls your name. Manny. He looks older than he should. He asks, carefully, whether you are hiring.';
      return 'Manny messages: he is opening a tire shop and asks if you would send customers his way.';
    },
    choices: [
      { label: 'Take his money and make him a partner', show: s => (s.flags.lent_manny || s.flags.lent_manny_part) && s.people.manny.trust >= 55 && s.biz && s.biz.open && !s.biz.partner, run: g => { g.money(25000, 'Manny invests'); g.s.biz.partner = 'manny'; g.s.biz.share = 75; g.s.biz.health += 10; g.flag('manny_investor'); g.ledger('payoff', 'manny', 25000, 3); g.memory('Manny\'s cheque on your desk.'); return 'You shake on it in the parking lot, the way your fathers would have.'; } },
      { label: 'Take it as a loan and pay him back', show: s => (s.flags.lent_manny || s.flags.lent_manny_part) && s.people.manny.trust >= 55, run: g => { g.money(25000, 'Loan from Manny'); g.s.debt += 25000; g.trust('manny', 5); g.flag('manny_investor'); g.memory('Manny\'s cheque on your desk.'); return '"Same thing," he says, "but okay."'; } },
      { label: 'Thank him, but you don\'t need it', show: s => (s.flags.lent_manny || s.flags.lent_manny_part) && s.people.manny.trust >= 55, run: g => { g.bond('manny', 8); return 'He takes the cheque back and buys you dinner instead.'; } },
      { label: 'Let it go', show: s => (s.flags.lent_manny || s.flags.lent_manny_part) && s.people.manny.trust < 30, run: g => { g.flag('betrayed_manny'); g.s.people.manny.gone = true; g.mood(-5); return 'It was never about the money. Mostly.'; } },
      { label: 'Give him a job', show: s => s.flags.refused_manny, run: g => { g.need('manny', 'desperate'); g.trust('manny', 15); g.bond('manny', 10); g.flag('manny_hired'); if (g.s.biz && g.s.biz.open) g.s.biz.health += 4; g.need('manny', 'fine'); return 'He is the first to arrive every morning for two years. Neither of you mentions the $300.'; } },
      { label: 'Give him $200 and your number', show: s => s.flags.refused_manny, run: g => { g.money(-200, 'Gave Manny cash'); g.trust('manny', 3); return 'He takes the money. He never calls the number.'; } },
      { label: 'Say you have nothing right now', show: s => s.flags.refused_manny, run: g => { g.s.people.manny.gone = true; g.ledger('refused', 'manny', 0, 2); return 'He nods and walks back to a car with a cracked windshield.'; } },
      { label: 'Send customers his way', show: s => !s.flags.refused_manny && !((s.flags.lent_manny || s.flags.lent_manny_part) && (s.people.manny.trust >= 55 || s.people.manny.trust < 30)), run: g => { g.trust('manny', 10); g.bond('manny', 6); return 'Every truck and van you know gets tires from Manny now.'; } },
      { label: 'Ignore the message', show: s => !s.flags.refused_manny && !((s.flags.lent_manny || s.flags.lent_manny_part) && (s.people.manny.trust >= 55 || s.people.manny.trust < 30)), run: g => { g.trust('manny', -6); return 'Two blue ticks. No reply.'; } }
    ]
  };
  S.partner_moment = {
    title: () => 'A hard week',
    when: s => s.biz && s.biz.open,
    text: s => {
      const b = s.biz;
      if (!b.partner) return "It's 11 p.m. and you are the only person who knows where the money goes.";
      const p = P.PEOPLE[b.partner].name;
      return s.people[b.partner].trust >= 60
        ? `A client walks out over a mistake you made. ${p} drives across the city at midnight and wins them back without telling you until morning.`
        : `${p} wants to take a contract that means seven-day weeks for the crew and a pay cut for the new hires.`;
    },
    choices: [
      { label: 'Hire a part-time bookkeeper', show: s => !s.biz.partner, run: g => { g.money(-3000, 'Bookkeeper'); g.s.biz.health += 5; g.skill('management', 1); return 'Gloria, retired, terrifying, finds $4,000 of mistakes in a week.'; } },
      { label: 'Keep doing it all yourself', show: s => !s.biz.partner, run: g => { g.energy(-15); g.mood(-4); return 'You start drinking coffee at 9 p.m. to stay up for the invoices.'; } },
      { label: 'Thank them properly. Bigger share of this year\'s profit.', show: s => s.biz.partner && s.people[s.biz.partner].trust >= 60, run: g => { const b = g.s.biz; g.trust(b.partner, 8); g.bond(b.partner, 8); g.money(-3000, 'Bonus to partner'); return 'They pretend it isn\'t a big deal. It is.'; } },
      { label: 'Side with your partner', show: s => s.biz.partner && s.people[s.biz.partner].trust < 60, run: g => { const b = g.s.biz; g.trust(b.partner, 10); b.health -= 6; g.ledger('money_over_people', null, 0); return 'Two cleaners quit by Friday.'; } },
      { label: 'Refuse. The crew comes first.', show: s => s.biz.partner && s.people[s.biz.partner].trust < 60, run: g => { const b = g.s.biz; g.trust(b.partner, -10); b.health += 4; return 'Your partner calls you "soft" in front of a supplier.'; } }
    ]
  };
  S.home_pull = {
    title: () => 'Papa',
    text: () => 'Papa has a fall in the shop. "Not serious," Maa says. Then Simran messages you separately: "It was serious."',
    choices: [
      { label: 'Fly home for two weeks', run: g => { g.money(-3500, 'Flight home'); g.bond('maa', 10); g.bond('papa', 15); g.trust('papa', 8); g.flag('visited'); g.ledger('gave_time', 'papa', 3); if (g.s.biz && g.s.biz.open) g.s.biz.health -= 8; g.memory('Papa in the hospital bed, complaining about the food.'); return 'He complains about the hospital food for two weeks. You have never been happier to be complained at.'; } },
      { label: 'Pay for the best hospital in Ludhiana', run: g => { g.money(-5000, 'Hospital in Ludhiana'); g.bond('papa', 3); g.ledger('money_over_people', 'papa', 5000, 2); return 'The private room has air conditioning. Papa asks Maa why you didn\'t come.'; } },
      { label: 'Start the papers to sponsor Maa and Papa to Canada', run: g => { g.money(-2000, 'Sponsorship application'); g.flag('sponsor_parents'); g.bond('maa', 6); g.bond('papa', 4); return 'Papa says he will never leave the shop. Maa quietly sends you her passport scan.'; } }
    ]
  };
  S.jassi_arrives = {
    title: () => 'Jassi',
    text: s => {
      if (s.flags.warned_jassi) return 'Jassi lands at Pearson on a proper work permit, two years after the fake agent. He brings pinni from your mother. Security let it through this time.';
      if (s.flags.helped_jassi) return s.people.jassi.trust >= 50 ? 'Jassi made it. Your $3,000 got him through the last door. He lands at Pearson in a jacket far too thin for March.' : 'Jassi\'s agent disappeared with the money, yours included. Jassi is still in Nurmahal, driving an auto-rickshaw.';
      return 'You hear from Simran that Jassi married and opened a mobile repair shop in Nurmahal. He didn\'t invite you.';
    },
    choices: [
      { label: 'Continue', run: g => { const s = g.s; if (s.flags.warned_jassi || (s.flags.helped_jassi && s.people.jassi.trust >= 50)) { g.flag('jassi_here'); g.bond('jassi', 12); g.trust('jassi', 10); g.memory('Jassi at arrivals in a jacket far too thin.'); return 'He sleeps on your couch for a month and eats everything in the fridge.'; } if (s.flags.helped_jassi) { g.trust('jassi', 5); return 'He calls you every week anyway. "You tried. That counts."'; } g.bond('jassi', -15); if (s.flags.promise_jassi) g.ledger('broke_promise', 'jassi', 0, 3); return 'You look at the wedding photos online for a long time.'; } }
    ]
  };
  S.big_contract = {
    title: () => 'The big contract',
    text: s => (s.biz && s.biz.open
      ? 'A distribution centre offers a two-year contract that would double your size. It needs you there seven days a week for the first year.'
      : 'Your supervisor offers you the shift-lead job. More money, and every weekend.'),
    choices: [
      { label: 'Take it', run: g => { const s = g.s; if (s.biz && s.biz.open) { s.biz.scale++; s.biz.health += 5; } else g.money(8000, 'Shift-lead raise'); g.energy(-30); g.bond('farah', -12); g.bond('maa', -5); g.ledger('money_over_people', s.partner === 'married' ? 'farah' : null, 0, 2); g.flag('big_contract'); return s.partner === 'married' ? 'Farah stops waiting up for you around October.' : 'You see the sun on weekdays only through a windshield.'; } },
      { label: 'Turn it down', run: g => { g.bond('farah', 6); g.mood(3); return 'You spend that Sunday doing nothing at all. It feels illegal.'; } }
    ]
  };
  S.farah_again = {
    title: () => 'Farah',
    when: s => s.partner === 'dating' && s.people.farah.bond >= 28,
    text: () => '"I\'m going to ask you one more time, and then I\'m going to stop asking."',
    choices: [
      { label: '"Yes."', run: g => { g.s.partner = 'married'; g.bond('farah', 15); g.memory('Your wedding, finally.'); return 'You get married at the courthouse on a Tuesday and have the party later.'; } },
      { label: '"I can\'t."', run: g => { g.s.partner = 'declined'; g.bond('farah', -25); return 'She moves to Calgary in the spring.'; } }
    ]
  };
  S.ch4_close = {
    title: () => 'Somebody\'s boss',
    text: s => `A new hire calls you "boss" and doesn't mean it as a joke.${P.netWorth(s) > 90000 ? '\n\nTracy at the bank mentions, unprompted, that condos in Bramford are "very reasonable right now".' : ''}`,
    choices: [
      { label: 'Buy a condo · $60,000 down', show: s => s.money >= 70000, run: g => { g.money(-60000, 'Condo down payment'); g.s.home = 'Condo'; g.s.debt += 20000; g.flag('condo'); g.mood(8); g.memory('Keys to the condo.'); return 'The first night you sleep on the floor of the empty living room because you can.'; } },
      { label: 'Keep renting', run: g => { g.memory('The first time someone called you boss.'); return 'You frame your business licence instead.'; } }
    ]
  };

  // =============== Chapter 5: Empire or collapse ===============
  S.ch5_open = {
    title: () => 'Seven years',
    text: () => 'Your kitchen has a dishwasher you never use, because washing dishes reminds you of your first job.\n\nYou are 29. What do you want the next part to be?',
    choices: [
      { label: 'Build something bigger', run: g => { g.flag('ambition'); g.mood(3); return 'You buy a whiteboard.'; } },
      { label: 'Build a calmer life', run: g => { g.flag('calm'); g.mood(6); return 'You turn off notifications after 8 p.m. Mostly.'; } },
      { label: 'Build a way back home', run: g => { g.flag('homeward'); g.bond('maa', 5); return 'You start looking at land near Nurmahal on Sunday nights.'; } }
    ]
  };
  S.simran_wedding = {
    title: () => "Simran's wedding",
    text: s => `Simran is getting married in Jalandhar in December.${s.flags.promise_wedding ? ' «Tu promise kitta si.»{You promised.}' : ''}${s.biz && s.biz.open ? '\n\nThe same week, your biggest client wants to renegotiate everything, in person.' : ''}`,
    choices: [
      { label: 'Go. Whatever it costs.', run: g => { g.money(-6000, 'Wedding trip and gifts'); g.bond('simran', 20); g.trust('simran', 15); g.bond('maa', 8); g.bond('papa', 8); g.flag('kept_wedding'); if (g.s.biz && g.s.biz.open) g.s.biz.health -= 10; g.memory("Simran's wedding. You danced badly."); return 'You dance badly for three days. The client signs with someone else. You do not care.'; } },
      { label: 'Go for two days only', run: g => { g.money(-4000, 'Wedding trip'); g.bond('simran', 6); g.memory("Simran's wedding, two days of it."); return 'You miss the mehndi and the jaago. You are there when she leaves for her new home.'; } },
      { label: 'Send a big gift and join on video', run: g => { g.money(-8000, 'Wedding gift'); g.bond('simran', -18); g.trust('simran', -20); g.flag('missed_wedding'); g.ledger('money_over_people', 'simran', 8000, 3); if (g.s.flags.promise_wedding) g.ledger('broke_promise', 'simran', 0, 3); return 'The video freezes during the pheras. Simran\'s message afterwards is one word: "Thanks."'; } }
    ]
  };
  S.maa_ill = {
    title: () => 'Maa',
    text: () => "Maa's tests come back. Her kidneys. The doctors in Ludhiana say months, maybe a year or two.",
    choices: [
      { label: 'Fly home and stay for a few months', run: g => { g.money(-10000, 'Months at home'); if (g.s.biz && g.s.biz.open) g.s.biz.health -= 20; g.bond('maa', 20); g.bond('papa', 10); g.flag('maa_time', 2); g.ledger('gave_time', 'maa', 5); return 'You run the business from her bedside on a phone with a cracked screen.'; } },
      { label: 'Bring her to Canada for treatment', show: s => s.flags.sponsor_parents, run: g => { g.money(-15000, "Maa's treatment"); g.bond('maa', 18); g.flag('maa_time', 2); g.ledger('gave_time', 'maa', 4); return 'She hates the cold and loves your balcony. She feeds every pigeon in the building.'; } },
      { label: 'Fly home for two weeks, then call every day', run: g => { g.money(-4000, 'Trip home'); g.bond('maa', 8); g.s.stats.calls += 30; g.flag('maa_time', 1); return 'Every evening at 8, her face fills the screen, too close, the way it always did.'; } },
      { label: 'Pay for the best care and keep the business running', run: g => { g.money(-25000, "Maa's care"); g.flag('maa_time', 0); g.ledger('money_over_people', 'maa', 25000, 4); return 'The nurses send you photos. Maa is always smiling in them, for you.'; } }
    ]
  };
  S.maa_goodbye = {
    title: () => 'Maa',
    text: s => {
      const t = s.flags.maa_time || 0;
      if (t === 2) return 'In the last weeks she mostly sleeps. When she wakes she asks for you by your childhood name.';
      if (t === 1) return 'Simran calls: come now. You land in Amritsar nine hours before the end.';
      return 'Simran calls at 4 a.m. your time. You are getting ready for a meeting in Mississauga. You land thirty-one hours later, in time for the cremation.';
    },
    choices: [
      { label: 'Ask her what she is proud of', show: s => (s.flags.maa_time || 0) > 0, run: g => endMaa(g, 'She says: «Tu kade jhooth nahi boleya.»{You never lied to me.} ' ) },
      { label: 'Tell her the truth about the basement, finally', show: s => (s.flags.maa_time || 0) > 0 && s.flags.lied_home && !s.flags.told_truth && !s.flags.truth_late, run: g => { g.flag('truth_late'); return endMaa(g, 'She laughs, barely. «Mainu pata si, kamleya.»{I knew, you silly thing.} '); } },
      { label: 'Just hold her hand', show: s => (s.flags.maa_time || 0) > 0, run: g => endMaa(g, '') },
      { label: 'Stay a month with Papa', show: s => !s.flags.maa_time, run: g => { g.flag('maa_present', 'no'); g.bond('papa', 15); g.mood(-15); g.memory("Maa's steel tea glass, on the shelf."); return 'Papa doesn\'t say anything for days. Then he teaches you how she made pinni.'; } },
      { label: 'Fly back after the ceremonies', show: s => !s.flags.maa_time, run: g => { g.flag('maa_present', 'no'); g.bond('papa', -6); g.bond('simran', -6); g.mood(-18); g.memory("Maa's steel tea glass, on the shelf."); return 'The meeting is rescheduled. You go to it.'; } }
    ]
  };
  function endMaa(g, line) {
    const s = g.s;
    g.flag('maa_present', s.flags.maa_time === 2 ? 'yes' : 'partly');
    g.mood(-10);
    g.memory("Maa's hands, holding yours.");
    if (line.indexOf('never lied') >= 0 && s.stats.lies > 0) line = 'She says: «Tu saanu kade bhuleya nahi.»{You never forgot us.} ';
    return line + 'She dies on a Thursday morning, with the window open.';
  }
  S.marriage_turn = {
    title: () => 'Home',
    text: s => {
      if (s.partner === 'married' && s.people.farah.bond >= 45) return 'Farah, on the balcony, coffee going cold: "Two weeks. Just us. Somewhere without Wi-Fi."';
      if (s.partner === 'married') return 'Farah sits you down at the kitchen table. "I have been alone in this marriage for two years."';
      return 'The old crowd gets together for the first time in years: Manny, Dev, Jassi if he made it, a cake that says WE SURVIVED.';
    },
    choices: [
      { label: 'Go. The business can wait.', show: s => s.partner === 'married' && s.people.farah.bond >= 45, run: g => { g.bond('farah', 12); if (g.s.biz && g.s.biz.open) g.s.biz.health -= 4; g.memory('Two weeks with Farah, no Wi-Fi.'); return 'You lose a contract and forget which one by the time you get back.'; } },
      { label: '"Not this year."', show: s => s.partner === 'married' && s.people.farah.bond >= 45, run: g => { g.bond('farah', -12); g.ledger('money_over_people', 'farah', 0, 2); return 'She goes with her sister instead.'; } },
      { label: 'Ask for another chance, and mean it', show: s => s.partner === 'married' && s.people.farah.bond < 45, run: g => { g.bond('farah', 18); g.energy(-10); if (g.s.biz && g.s.biz.open) g.s.biz.health -= 8; return 'You start coming home at six. It is harder than any business you have run.'; } },
      { label: 'Agree to separate', show: s => s.partner === 'married' && s.people.farah.bond < 45, run: g => { g.s.partner = 'separated'; g.mood(-15); g.money(-Math.max(0, Math.round(g.s.money * 0.4)), 'Separation settlement'); return 'You divide the furniture without arguing. That is the saddest part.'; } },
      { label: 'Go, and stay until the end', show: s => s.partner !== 'married', run: g => { for (const id of ['manny', 'dev', 'jassi']) { g.bond(id, 8); g.trust(id, 4); } g.mood(10); g.flag('_social'); g.memory('A cake that said WE SURVIVED.'); return 'Somebody plays the old songs. Everyone sings the wrong words.'; } },
      { label: 'Send a message saying you\'re swamped', show: s => s.partner !== 'married', run: g => { for (const id of ['manny', 'dev', 'jassi']) g.bond(id, -6); return 'They send you a photo of the cake. Your slice is in it, uneaten.'; } }
    ]
  };
  S.land_back = {
    title: () => "Papa's land",
    when: s => s.flags.sold_land && s.money >= 50000,
    text: () => 'The two acres Papa sold to pay for your ticket are for sale again.',
    choices: [
      { label: 'Buy them back · $50,000', run: g => { g.money(-50000, 'Bought back the land'); g.flag('land_back'); g.bond('papa', 25); g.memory('Papa walking the two acres again.'); return 'Papa walks the edge of the field twice and doesn\'t say anything. He doesn\'t need to.'; } },
      { label: 'Let it go', run: () => 'Someone else\'s tractor turns the soil.' }
    ]
  };
  S.final_home = {
    title: () => 'Twenty years',
    text: s => `Twenty years since the airport at 3 a.m. You live in a ${s.home.toLowerCase()} in Bramford. Where do you want to grow old?`,
    choices: [
      { label: 'Here, in Canada', run: g => { g.s.place = 'stayed'; g.flag('_ending'); return 'You plant a lemon tree on the balcony. It will not survive the winter. You plant another.'; } },
      { label: 'Back in Punjab', run: g => { g.s.place = 'returned'; g.flag('_ending'); return 'The shop shutter still sticks halfway. You fix it the first week.'; } },
      { label: 'Both: winters there, summers here', run: g => { g.s.place = 'split'; g.flag('_ending'); return 'Two homes, two SIM cards, and you never quite unpack in either.'; } }
    ]
  };
  S.sell_biz = {
    title: () => 'An offer',
    when: s => s.biz && s.biz.open,
    text: s => { const b = s.biz, v = Math.round(P.BIZ[b.type].base * b.scale * 3 * (0.4 + b.health / 100) * b.share / 100); return `A larger company offers to buy your ${P.BIZ[b.type].name}. Your share would be about ${P.fmt(s, v)}.`; },
    choices: [
      { label: 'Sell', run: g => { const s = g.s, b = s.biz, v = Math.round(P.BIZ[b.type].base * b.scale * 3 * (0.4 + b.health / 100) * b.share / 100); g.money(v, 'Sold the business'); b.open = false; g.flag('sold_biz'); g.mood(5); g.memory('Signing the sale papers.'); return 'You sign in a glass office. You keep the old business card in your wallet.'; } },
      { label: 'Keep it', run: () => 'You turn them down. You like your name on the door.' }
    ]
  };

  // =============== Zero states and breakdowns ===============
  S.collapse = {
    title: () => 'You collapse',
    bad: true,
    text: s => `${s.chapter === 0 ? 'You wake up on the shop floor with Papa fanning you with a ledger.' : 'You wake up in a walk-in clinic with a drip in your arm. A nurse asks when you last slept a full night. You can\'t answer.'}`,
    choices: [
      { label: 'Rest properly this time', run: g => { const s = g.s; s.stats.burnouts++; g.money(s.chapter === 0 ? -20 : -150, 'Clinic bill'); g.energy(45); g.career(-15); g.ledger('burnout', null, 1, 2); return 'You lose days of pay. Your body does not negotiate.'; } },
      { label: 'Go straight back to work', run: g => { const s = g.s; s.stats.burnouts++; s.stats.injuries++; g.money(s.chapter === 0 ? -20 : -150, 'Clinic bill'); g.energy(20); g.ledger('burnout', null, 1, 3); return 'You are back the next day. Your hands shake on the scanner.'; } }
    ]
  };
  S.fired = {
    title: () => "You're let go",
    bad: true,
    text: s => `The supervisor calls you into the office. Missed shifts, slow numbers. Your time as a ${job(s).toLowerCase()} is over.`,
    choices: [
      { label: 'Ask for one more chance', run: g => { if (g.rand() < 0.4) { g.s.career = 30; return 'She sighs and puts you on probation.'; } g.s.job = null; g.mood(-10); if (g.s.chapter === 2) g.queue('job_choice'); return 'She says no. You carry your locker contents to the bus in a plastic bag.'; } },
      { label: 'Leave with your head up', run: g => { g.s.job = null; g.mood(-6); if (g.s.chapter === 2) g.queue('job_choice'); return 'You shake her hand. On the bus you start looking for work.'; } }
    ]
  };
  S.breakdown = {
    title: () => '3 a.m.',
    text: () => 'You are sitting on the edge of the bed with your shoes still on. You can\'t remember the last time you laughed. Your phone is in your hand.',
    choices: [
      { label: 'Call Maa', run: g => callFor(g, 'maa') },
      { label: 'Call Simran', run: g => callFor(g, 'simran') },
      { label: s => `Call ${P.PEOPLE[closestFriend(s)].name}`, show: s => !!closestFriend(s), run: g => callFor(g, closestFriend(g.s)) },
      { label: 'Carry it alone', run: g => { const s = g.s; s.stats.breakdowns++; s.stats.isolation += 4; g.mood(10); g.ledger('carried_alone', null, 1, 2); return 'You put the phone face down. In the morning you go to work as if nothing happened. Something did.'; } },
      { label: 'Step away from everything for a few days', run: g => { const s = g.s; s.stats.breakdowns++; g.energy(40); g.mood(40); g.career(-15); g.money(s.chapter === 1 ? -200 : s.chapter === 0 ? -30 : -1500, 'Days off, unpaid'); return 'You turn your phone off and walk by the lake every day until your head is quiet.'; } }
    ]
  };
  function closestFriend(s) {
    const ids = ['farah', 'manny', 'dev', 'jassi'].filter(id => s.people[id].met && !s.people[id].gone);
    ids.sort((a, b) => s.people[b].bond - s.people[a].bond);
    return ids[0] || null;
  }
  function callFor(g, id) {
    const s = g.s, p = s.people[id], name = P.PEOPLE[id].name;
    s.stats.breakdowns++;
    g.ledger('reached_out', id, 1);
    if (id === 'maa' && s.flags.lied_home && !s.flags.told_truth && !s.flags.truth_late) { g.mood(8); return 'Maa picks up on the first ring. You can\'t tell her, not after all the "everything is fine". You talk about the weather in Nurmahal.'; }
    if (p.trust >= 40) { g.mood(30); g.trust(id, 10); g.bond(id, 8); s.flags._social = true; return `${name} picks up on the second ring and stays on the line until you fall asleep.`; }
    g.mood(-5);
    return `It rings out. ${name} texts in the morning: "Sorry, was asleep. All ok?"`;
  }

  // =============== Random events (life interrupts) ===============
  P.EVENTS = [
    ['wedding_season', 'power_cut', 'agent_call'],
    ['heater', 'langar_coat', 'extra_shift', 'fever', 'scam_call', 'snowstorm'],
    ['car_breaks', 'promotion', 'rent_up', 'tax_refund', 'manny_hospital', 'cousin_wedding'],
    ['inspection', 'rate_crash', 'review', 'staff_quits', 'client_lost', 'ad_spike', 'old_friend'],
    ['audit', 'papa_visit', 'reunion_call', 'market_dip']
  ];
  S.wedding_season = { title: () => 'Wedding season', text: () => 'Three cousins are getting married in one month. Each one expects a shagun envelope.', choices: [
    { label: 'Give to all three', run: g => { g.money(-50, 'Shagun'); g.bond('maa', 3); return 'Maa is proud of you at every wedding.'; } },
    { label: 'Give only to the closest', run: g => { g.money(-15, 'Shagun'); return 'Somebody\'s aunt notices.'; } }] };
  S.power_cut = { bad: true, title: () => 'Power cut', text: () => 'Eleven hours without electricity in June. The inverter dies at noon.', choices: [
    { label: 'Study by the window anyway', run: g => { g.skill('language', 1); g.energy(-10); return 'You learn forty words with sweat dripping onto the page.'; } },
    { label: 'Give up and sleep on the roof', run: g => { g.energy(10); g.mood(2); return 'Simran brings up a fan that doesn\'t work, for moral support.'; } }] };
  S.agent_call = { title: () => 'The agent', text: () => 'Another agent calls, promising a "guaranteed" visa for ₹5 lakh extra.', choices: [
    { label: 'Hang up', run: () => 'He calls back twice.' },
    { label: 'Listen to the pitch', run: g => { g.mood(-2); return 'It sounds too good. It is.'; } }] };
  S.heater = { bad: true, title: () => 'No heat', text: () => 'The basement heater dies in a cold snap. Mr. Gill says the repair man comes "next week".', choices: [
    { label: 'Buy a space heater · $60', run: g => { g.money(-60, 'Space heater'); return 'Four people sleep in a semicircle around it.'; } },
    { label: 'Sleep in your jacket', run: g => { g.energy(-15); g.mood(-4); return 'You can see your breath at 3 a.m.'; } }] };
  S.langar_coat = { title: () => 'A coat', text: () => 'An old man at the gurdwara watches you shiver after langar. He comes back with a heavy winter coat. "My son grew out of it. Twenty years ago."', choices: [
    { label: 'Accept it', run: g => { g.mood(10); g.memory('A stranger\'s winter coat.'); return 'It smells of mothballs and fits perfectly.'; } }] };
  S.extra_shift = { title: () => 'Extra shift', when: s => !!s.job, text: () => 'Someone calls in sick. The supervisor asks if you can stay another eight hours.', choices: [
    { label: 'Stay', run: g => { g.money(150, 'Extra shift'); g.energy(-20); g.career(5); return 'Your feet are numb by the end.'; } },
    { label: 'Go home', run: () => 'You sleep. Someone else takes the money.' }] };
  S.fever = { bad: true, title: () => 'Fever', text: () => 'You wake up at 39°C. Your shift starts in four hours.', choices: [
    { label: 'Call in sick', run: g => { g.career(-8); g.energy(15); return 'The supervisor says "fine" in a way that is not fine.'; } },
    { label: 'Work through it', run: g => { g.energy(-25); g.mood(-4); return 'You make two picking errors and throw up in the parking lot.'; } }] };
  S.scam_call = { bad: true, title: () => '"Canada Revenue Agency"', text: () => 'A man says he is from the government. You owe taxes. If you don\'t pay $500 in gift cards today, you will be deported.', choices: [
    { label: 'Hang up and ask Manny', run: g => { g.skill('language', 1); return 'Manny laughs for a full minute. "Everybody gets that call, bai."'; } },
    { label: 'Pay, just in case', run: g => { g.money(-500, 'Scam'); g.mood(-10); g.ledger('scammed', null, 500); return 'You understand an hour later. You don\'t tell anyone.'; } }] };
  S.snowstorm = { title: () => 'Snowstorm', text: () => 'Forty centimetres overnight. The buses stop.', choices: [
    { label: 'Walk to work anyway', show: s => !!s.job, run: g => { g.energy(-15); g.career(6); return 'You are the only one who shows up. The supervisor remembers.'; } },
    { label: 'Build a snowman with the roommates', run: g => { g.mood(8); g.bond('manny', 4); g.memory('The ugliest snowman in Bramford.'); return 'It has a turban made from a dish towel.'; } }] };
  S.injury = { bad: true, title: () => 'Your back', text: () => 'Something in your lower back goes with a sound you feel more than hear. A pallet of dog food, 22 kilos a bag.', choices: [
    { label: 'Report it and claim compensation', run: g => { g.s.stats.injuries++; g.energy(-20); g.career(-8); g.money(-800, 'Unpaid days before the claim'); return 'The claim takes six weeks. The supervisor stops saying good morning.'; } },
    { label: 'Keep quiet and keep working', run: g => { g.s.stats.injuries += 2; g.energy(-30); g.mood(-6); g.ledger('worked_hurt', null, 1, 2); return 'You buy painkillers in bulk. Your back will remember this for twenty years.'; } }] };
  S.accident = { bad: true, title: () => 'The intersection', text: () => 'A pickup runs a red light. Nobody is hurt, but the Corolla\'s front end is folded and three orders are spread across the road.', choices: [
    { label: 'Go through insurance', run: g => { g.money(-1000, 'Insurance deductible'); g.career(-6); g.mood(-5); return 'Your premium goes up by $90 a month. Forever, it feels like.'; } },
    { label: 'Settle in cash with the other driver', run: g => { g.money(-400, 'Cash settlement'); if (g.rand() < 0.5) { g.mood(-10); g.money(-1500, 'Repairs'); return 'His cheque bounces. You pay for the repairs yourself.'; } return 'He pays. You fix the bumper with zip ties.'; } }] };
  S.car_breaks = { bad: true, title: () => 'The car', when: s => s.flags.car, text: () => 'The Corolla\'s transmission goes on the highway.', choices: [
    { label: 'Fix it · $1,800', run: g => { g.money(-1800, 'Transmission'); return 'The mechanic calls it "a classic". You call it something else.'; } },
    { label: 'Sell it for parts', run: g => { g.money(600, 'Sold the car'); g.flag('car', false); if (g.s.job === 'delivery') { g.s.job = null; return 'No car, no deliveries. You need new work.'; } return 'Back to the bus.'; } }] };
  S.promotion = { title: () => 'Promotion', when: s => s.career >= 75 && !!s.job, text: () => 'Your manager offers you a team-lead role. More money, more responsibility, worse hours.', choices: [
    { label: 'Take it', run: g => { g.money(2500, 'Team-lead raise'); g.skill('management', 1); g.energy(-10); return 'You now explain the scanner to new people, the way someone once explained it to you.'; } },
    { label: 'Not yet', run: g => { g.mood(2); return 'Someone else gets it. You sleep fine.'; } }] };
  S.rent_up = { bad: true, title: () => 'Rent increase', text: () => 'The landlord raises the rent by $200 a month.', choices: [
    { label: 'Pay it', run: g => { g.money(-600, 'Rent increase'); return 'The kitchen faucet still drips.'; } },
    { label: 'Move further out', run: g => { g.energy(-10); g.mood(-3); return 'An extra 40 minutes on the bus, each way.'; } }] };
  S.tax_refund = { title: () => 'Tax refund', text: () => 'Your first tax refund arrives. You didn\'t know this was a thing.', choices: [
    { label: 'Save it', run: g => { g.money(1100, 'Tax refund'); return 'Your first savings account with more than $1,000 in it.'; } },
    { label: 'Send it home', run: g => { g.s.stats.sentHome += 1100; g.bond('maa', 4); g.bond('papa', 4); return 'Papa uses it to fix the shop shutter.'; } }] };
  S.manny_hospital = { title: () => 'Manny', when: s => s.people.manny.met && !s.people.manny.gone, text: () => 'Manny calls at 1 a.m. from the emergency room: a forklift accident, his hand. He needs a ride home and someone to sign the forms.', choices: [
    { label: 'Drive there now', run: g => { g.need('manny', 'desperate'); g.trust('manny', 12); g.bond('manny', 8); g.energy(-15); g.need('manny', 'fine'); g.ledger('helped', 'manny', 1, 2); return 'You sit in the plastic chairs until 6 a.m. He falls asleep on your shoulder.'; } },
    { label: '"I have a shift at six, bai."', run: g => { g.need('manny', 'desperate'); g.trust('manny', -12); g.need('manny', 'fine'); return 'He takes a cab he can\'t afford.'; } }] };
  S.cousin_wedding = { title: () => 'A wedding back home', text: () => 'Your cousin is getting married in Nurmahal. The whole family will be there.', choices: [
    { label: 'Fly home · $2,000', run: g => { g.money(-2000, 'Flight home'); g.bond('maa', 12); g.bond('papa', 8); g.bond('simran', 8); g.flag('visited'); g.memory('Home for a wedding, jet-lagged.'); return 'Maa doesn\'t let go of your arm for three days.'; } },
    { label: 'Send a gift', run: g => { g.money(-300, 'Wedding gift'); g.bond('maa', -3); return 'You watch the dancing on a cousin\'s Instagram story.'; } }] };
  S.inspection = { bad: true, title: () => 'Inspection', when: s => s.biz && s.biz.open && s.biz.type === 'restaurant', text: () => 'A health inspector arrives at the dinner rush.', choices: [
    { label: 'Close for a day and deep-clean', run: g => { g.money(-3000, 'Closed for cleaning'); g.s.biz.health += 5; return 'You pass the re-inspection with a perfect score.'; } },
    { label: 'Argue', run: g => { g.s.biz.health -= 12; return 'The yellow notice goes in the window for a month.'; } }] };
  S.rate_crash = { bad: true, title: () => 'Freight rates', when: s => s.biz && s.biz.open && s.biz.type === 'trucking', text: () => 'Freight rates drop by a third in two months. The truck payment does not.', choices: [
    { label: 'Take cheap loads to keep moving', run: g => { g.s.biz.health -= 6; g.energy(-15); return 'You drive more for less.'; } },
    { label: 'Park the truck and wait', run: g => { g.s.biz.health -= 10; g.money(-4000, 'Payments on a parked truck'); return 'The truck sits in the yard collecting snow.'; } }] };
  S.review = { title: () => 'Going viral', when: s => s.biz && s.biz.open && (s.biz.type === 'restaurant' || s.biz.type === 'online'), text: () => 'A food and lifestyle creator with 400,000 followers posts about you.', choices: [
    { label: 'Ride the wave', run: g => { g.s.biz.health += 15; g.energy(-15); return 'You sell out for six weeks straight.'; } }] };
  S.staff_quits = { bad: true, title: () => 'Two people quit', when: s => s.biz && s.biz.open, text: () => 'Your two best workers quit on the same day to start their own business. They learned from you.', choices: [
    { label: 'Wish them well', run: g => { g.s.biz.health -= 6; g.mood(2); return 'One of them sends you a box of sweets at Diwali every year.'; } },
    { label: 'Threaten to sue', run: g => { g.s.biz.health -= 8; g.money(-2500, 'Lawyer'); return 'The lawyer advises against it, after billing you.'; } }] };
  S.client_lost = { bad: true, title: () => 'Lost client', when: s => s.biz && s.biz.open && s.biz.type === 'cleaning', text: () => 'Your biggest client moves to a cheaper company.', choices: [
    { label: 'Cut your price to win them back', run: g => { g.s.biz.health -= 4; return 'You win them back and make almost nothing on them.'; } },
    { label: 'Chase three smaller clients', run: g => { g.s.biz.health -= 8; g.energy(-15); g.skill('sales', 1); return 'You knock on 60 office doors in two weeks.'; } }] };
  S.ad_spike = { bad: true, title: () => 'Ad prices', when: s => s.biz && s.biz.open && s.biz.type === 'online', text: () => 'The cost of your online ads doubles overnight.', choices: [
    { label: 'Pay it', run: g => { g.money(-3000, 'Ads'); return 'Sales hold. Margins don\'t.'; } },
    { label: 'Stop ads and try word of mouth', run: g => { g.s.biz.health -= 10; return 'Orders drop by half for two months.'; } }] };
  S.old_friend = { title: () => 'An old friend', text: () => 'Someone from the first basement messages: he got his PR and wants to buy you dinner.', choices: [
    { label: 'Go', run: g => { g.mood(8); g.flag('_social'); return 'You both order too much food and talk about the shower sign.'; } },
    { label: 'Too busy', run: () => 'You say "next month". Neither of you means it.' }] };
  S.audit = { bad: true, title: () => 'Audit', when: s => s.biz && s.biz.open, text: () => 'The tax office audits three years of your business.', choices: [
    { label: 'Hire an accountant', run: g => { g.money(-8000, 'Accountant'); return 'Your books are clean. Expensive, but clean.'; } },
    { label: 'Do it yourself', run: g => { g.energy(-20); if (g.s.skills.management >= 4) return 'You find every receipt. They find nothing.'; g.money(-20000, 'Tax reassessment'); return 'You missed things. The reassessment is painful.'; } }] };
  S.papa_visit = { title: () => 'Papa visits', when: s => s.people.papa.bond >= 30, text: () => 'Papa comes to Canada for the first time. He is unimpressed by everything except the roads.', choices: [
    { label: 'Show him your business', run: g => { g.bond('papa', 12); g.trust('papa', 6); g.memory('Papa in front of your business, arms crossed, proud.'); return 'He reads every sign twice. At the end he says, "Better than the shop." It is the best review you will ever get.'; } }] };
  S.reunion_call = { title: () => 'A group call', text: () => 'Simran sets up a family video call with everyone, including relatives you haven\'t seen in fifteen years.', choices: [
    { label: 'Stay for the whole thing', run: g => { g.bond('simran', 8); g.bond('maa', 6); g.mood(6); return 'Three hours. Somebody\'s baby sleeps through all of it.'; } },
    { label: 'Say hi and leave', run: g => { g.bond('simran', -4); return 'Simran sees you leave the call.'; } }] };
  S.market_dip = { bad: true, title: () => 'A bad year', when: s => s.biz && s.biz.open, text: () => 'Interest rates jump. Your customers stop spending.', choices: [
    { label: 'Cut costs and wait it out', run: g => { g.s.biz.health -= 8; return 'You let two people go. You lie awake about it.'; } },
    { label: 'Borrow to keep everyone on', run: g => { g.s.debt += 40000; g.money(40000, 'Credit line'); g.s.biz.health += 4; return 'Nobody loses their job. The bank owns a little more of you.'; } }] };

  // Business failure and partner scenes.
  S.biz_fail = {
    title: () => 'The bank calls',
    bad: true,
    when: s => s.biz && s.biz.open,
    text: s => `The ${P.BIZ[s.biz.type].name} can't make payroll. The bank is calling in the loan.`,
    choices: [
      { label: 'Declare bankruptcy and start over', run: g => { const s = g.s; s.biz.open = false; if (s.stats.peakWorth >= 400000) g.flag('collapsed'); s.debt = 0; s.money = Math.min(s.money, 0) - 5000; g.mood(-25); g.ledger('collapse', null, 0, 3); g.memory('The lock on your own door, changed.'); return 'You hand over the keys in a fluorescent office. The man is kind about it, which is worse.'; } },
      { label: 'Sell everything you own to save it', show: s => s.home === 'Condo', run: g => { const s = g.s; g.money(80000, 'Sold the condo'); s.home = 'Rented apartment'; s.biz.health = 35; g.mood(-12); return 'You move back to renting. The business lives.'; } }
    ]
  };
  S.partner_share = {
    title: () => 'Your partner wants more',
    when: s => s.biz && s.biz.open && s.biz.partner,
    text: s => `${P.PEOPLE[s.biz.partner].name} wants a bigger share: "I'm doing more than half the work."`,
    choices: [
      { label: 'Agree', run: g => { const b = g.s.biz; b.share = Math.max(30, b.share - 10); g.trust(b.partner, 15); return 'Your share goes down. Their mood goes up.'; } },
      { label: 'Talk it through and meet halfway', run: g => { const b = g.s.biz; b.share = Math.max(30, b.share - 5); g.trust(b.partner, 6); return 'A long night with a spreadsheet. Nobody is thrilled. Nobody leaves.'; } },
      { label: 'Refuse', run: g => { const b = g.s.biz; g.trust(b.partner, -15); return '"Fine." It is not fine.'; } }
    ]
  };
  S.skim_found = {
    title: () => 'The numbers',
    when: s => s.biz && s.biz.open && s.biz.partner,
    text: s => `Going through the books line by line, you find ${P.fmt(s, s.biz.skimmed)} missing. ${P.PEOPLE[s.biz.partner].name} signed every one of those cheques.`,
    choices: [
      { label: 'Confront them and buy them out', run: g => { const s = g.s, b = s.biz, id = b.partner; g.flag('betrayed_' + id); s.people[id].gone = true; g.money(-Math.round(P.BIZ[b.type].setup * 0.4), 'Partner buyout'); b.partner = null; b.share = 100; b.skimRate = 0; b.health -= 10; g.mood(-12); return 'They don\'t deny it. They say you were never there.'; } },
      { label: 'Go to a lawyer', run: g => { const s = g.s, b = s.biz, id = b.partner; g.flag('betrayed_' + id); s.people[id].gone = true; g.money(-12000, 'Lawyers'); b.partner = null; b.share = 100; b.skimRate = 0; b.health -= 15; g.mood(-15); return 'It takes fourteen months. You win. It doesn\'t feel like winning.'; } },
      { label: 'Let it go, quietly', run: g => { const b = g.s.biz; b.skimRate = 0.08; g.mood(-6); return 'You say nothing. You check the books every month now.'; } }
    ]
  };

  // ---------- regrets: the heaviest Ledger entries become the closing lines ----------
  P.REGRETS = [
    { w: 12, when: (s, a) => a.present === 'no', text: () => 'You were not there when Maa died.' },
    { w: 10, when: s => s.flags.missed_wedding, text: () => "You missed Simran's wedding." },
    { w: 8, when: s => s.flags.lied_home && !s.flags.told_truth && !s.flags.truth_late, text: () => 'For years, Maa believed everything was fine.' },
    { w: 7, when: (s, a) => a.partner === 'separated', text: () => 'Farah asked for your time for years before she stopped asking.' },
    { w: 7, when: s => s.stats.calls < 15, text: () => 'You called home fewer times than there are Sundays in a year.' },
    { w: 6, when: s => s.flags.promise_jassi && !s.flags.helped_jassi && !s.flags.warned_jassi, text: () => "You promised Jassi you'd bring him over. You didn't." },
    { w: 6, when: s => Object.keys(s.flags).some(k => k.startsWith('betrayed_') && s.flags[k]), text: () => 'You trusted the wrong person with the business, and the books.' },
    { w: 6, when: (s, a) => a.health === 'broken', text: () => 'You worked through every warning your body gave you.' },
    { w: 5, when: s => s.flags.refused_manny && !s.flags.manny_hired, text: () => 'You never found out what really happened to Manny.' },
    { w: 5, when: s => s.flags.sold_land && !s.flags.land_back, text: () => "Papa's two acres were never bought back." },
    { w: 4, when: (s, a) => (a.partner === 'single' || a.partner === 'never') && s.people.farah.met, text: () => 'You told Farah you weren\'t ready, and then you never were.' },
    { w: 4, when: s => s.stats.isolation >= 14, text: () => 'Most of your evenings were spent alone.' },
    { w: 3, when: s => s.flags.harjit_upset, text: () => 'Harjit Chacha never quite forgave you about the wedding money.' },
    { w: 2, when: s => s.flags.agent_shortcut, text: () => 'You still don\'t know what was in the papers the agent filed.' },
    { w: 0, when: () => true, text: () => 'You wish you had taken more photographs.' }
  ];
})();
