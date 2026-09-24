/* Credit-controls demo: app. Vanilla JS, no build step, no network calls.
   One in-browser store drives the clinic portal screens (Results, Invite Patient, Billing, Settings), the
   card-problem screen, the billing export and the patient page. The bottom bar switches scenarios.
   Ticket keys, names and internal field names come from D.SPEC in data.js, never from this file. */
(function () {
  'use strict';

  const D = window.DEMO;
  const SP = D.SPEC || {};
  const T = SP.tickets || {};
  const ICON = window.PORTAL_ICONS || {};
  const KEY = 'qualiphy-credit-control-demo-v1';
  const params = new URLSearchParams(location.search);
  const STATIC = params.has('static');
  if (STATIC) document.body.classList.add('static');

  const DAY = 864e5;
  const SC_BY = Object.fromEntries(D.SCENARIOS.map((s) => [s.id, s]));
  const PER = D.LIMITS.perPage;
  const PRESETS = [['all', 'All time'], ['d7', 'Last 7 days'], ['d30', 'Last 30 days'], ['d90', 'Last 90 days'], ['ytd', 'Year to date'], ['custom', 'Custom']];
  const INCLUDE = [['all', 'All charges'], ['unpaid', 'Unpaid only'], ['paid', 'Paid only']];

  let S = null;
  let pendingTop = false;

  /* ------------------------------------------------------------------ utils */
  const I = (name, cls) => `<span class="pi${cls ? ' ' + cls : ''}">${ICON[name] || ''}</span>`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const TODAY = dayStart(Date.now());
  const THIS_YEAR = new Date(TODAY).getFullYear();
  const shortDate = (t) => new Date(t).toLocaleDateString('en-US', new Date(t).getFullYear() === THIS_YEAR ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  const longDate = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const iso = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fromIso = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const daysAgo = (n, hour) => { const d = new Date(TODAY - n * DAY); d.setHours(hour == null ? 10 : hour, 15, 0, 0); return d.getTime(); };
  const count = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many || one + 's'}`;
  const round2 = (n) => Math.round(n * 100) / 100;
  function setPath(o, path, v) { const ks = path.split('.'); let t = o; for (let i = 0; i < ks.length - 1; i++) { if (t[ks[i]] == null) t[ks[i]] = {}; t = t[ks[i]]; } t[ks[ks.length - 1]] = v; }
  function toast(msg, kind) {
    const box = document.getElementById('toast'); if (!box) return;
    const el = document.createElement('div'); el.className = `toast${kind ? ' ' + kind : ''}`; el.textContent = msg;
    while (box.children.length > 1) box.firstChild.remove();
    box.appendChild(el); setTimeout(() => el.remove(), 3000);
  }
  const dnote = (k, html, id) => `<div class="dnote"${id ? ` id="${id}"` : ''}><span class="dn-i">i</span><div><span class="dn-k">${esc(k)}</span>${html}</div></div>`;

  /* ------------------------------------------------------------------ demo charges */
  const CT = D.CHARGE_TYPES;
  function mk(examId, days, type, status, extra, hour) {
    const t = CT[type];
    return Object.assign({ id: 'ch_' + examId, date: daysAgo(days, hour == null ? 8 + (examId % 9) : hour), examId, type, description: t.description, amount: t.amount, status }, extra || {});
  }
  /* Settled history every normal scenario shares: 24 paid charges over about ten weeks, so Billing has pages. */
  function history() {
    const out = [[6, 48127, 'gfe'], [8, 48061, 'rx'], [9, 48022, 'gfe'], [13, 47788, 'gfe'], [15, 47701, 'rx'], [20, 47405, 'uc']].map(([d, id, ty]) => mk(id, d, ty, 'paid'));
    const types = ['gfe', 'rx', 'gfe', 'uc', 'rx', 'gfe'];
    let id = 47350;
    for (let i = 0; i < 18; i++) { id -= 17 + ((i * 7) % 23); out.push(mk(id, 22 + i * 3, types[i % types.length], 'paid')); }
    return out;
  }
  /* A clinic whose card expired months ago: 300 unpaid charges when the controls go live, older ones with collections. */
  function backlog() {
    const out = []; const types = ['rx', 'gfe', 'rx', 'uc', 'gfe', 'rx', 'rx', 'uc', 'gfe', 'rx'];
    let id = 48420;
    for (let i = 0; i < 300; i++) {
      const days = 1 + Math.floor(i / 2);
      id -= 3 + ((i * 13) % 11);
      out.push(mk(id, days, types[i % types.length], days > 60 ? 'collections' : 'unpaid', { attempts: 3, reason: D.DECLINE.expired }, i % 2 ? 10 : 15));
    }
    for (let j = 0; j < 20; j++) { id -= 5 + ((j * 7) % 9); out.push(mk(id, 152 + j * 2, types[(j + 3) % types.length], 'paid')); }
    return out;
  }
  function buildCharges(sc) {
    const X = D.DECLINE; const h = history(); const failed = (reason) => ({ attempts: 3, reason });
    let list;
    if (sc === 'retrying') list = [mk(48355, 1, 'rx', 'retrying', { attempts: 1, nextRetry: TODAY + DAY + 10 * 36e5, reason: X.insufficient }), ...h];
    else if (sc === 'gfe_only') list = [mk(48290, 4, 'gfe', 'unpaid', failed(X.insufficient)), mk(48244, 5, 'rx', 'unpaid', failed(X.insufficient)), ...h];
    else if (sc === 'blocked') list = [mk(48311, 3, 'rx', 'unpaid', failed(X.expired)), mk(48290, 4, 'gfe', 'unpaid', failed(X.expired)), mk(48244, 5, 'rx', 'unpaid', failed(X.expired)), mk(47930, 11, 'uc', 'collections', failed(X.expired)), mk(47866, 12, 'rx', 'collections', failed(X.expired)), ...h];
    else if (sc === 'backlog') list = backlog();
    else list = h;
    return list.sort((a, b) => b.date - a.date);
  }
  function buildCard(sc) {
    const base = { brand: 'Visa', last4: '4242', exp: '08/27', declined: null };
    if (sc === 'retrying') return Object.assign(base, { declined: { on: daysAgo(1), reason: D.DECLINE.insufficient } });
    if (sc === 'gfe_only') return Object.assign(base, { declined: { on: daysAgo(4), reason: D.DECLINE.insufficient } });
    if (sc === 'blocked') return Object.assign(base, { exp: '08/26', declined: { on: daysAgo(3), reason: D.DECLINE.expired } });
    if (sc === 'backlog') return Object.assign(base, { exp: '03/26', declined: { on: daysAgo(1), reason: D.DECLINE.expired } });
    return base;
  }
  const BACKLOG_TOTAL = round2(backlog().filter((c) => c.status !== 'paid').reduce((s, c) => s + c.amount, 0));

  /* ------------------------------------------------------------------ state */
  function fresh(sc) {
    const scenario = SC_BY[sc] ? sc : D.DEFAULT_SCENARIO;
    return {
      v: 1, scenario, page: 'billing',
      charges: buildCharges(scenario), card: buildCard(scenario), lastPayment: null,
      bill: { tab: 'all', page: 1, range: { preset: 'all', from: '', to: '' }, rangeOpen: false, draft: null },
      invite: { type: 'gfe', exam: D.EXAMS_BY_TYPE.gfe[0], state: D.STATE_OPTIONS[0] },
      modal: null, drawer: false, notes: true, guide: true,
    };
  }
  function load() {
    if (params.has('fresh')) return null;
    try {
      const raw = localStorage.getItem(KEY); if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.v === 1 && Array.isArray(s.charges) && s.bill && SC_BY[s.scenario] ? Object.assign(s, { modal: null, drawer: false }) : null;
    } catch (e) { return null; }
  }
  let saveTimer = null;
  function save() { try { const { modal, drawer, ...keep } = S; localStorage.setItem(KEY, JSON.stringify(keep)); } catch (e) { /* storage blocked: the demo still runs */ } }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); }
  function setScenario(sc) {
    const keep = { page: S.page, notes: S.notes, guide: S.guide };
    S = Object.assign(fresh(sc), keep);
    if (S.page === 'invite' && invitesBlocked()) S.page = 'results';
  }

  /* ------------------------------------------------------------------ rules */
  const invitesBlocked = () => S.scenario === 'blocked' || S.scenario === 'backlog' || S.scenario === 'hold';
  const rxBlocked = () => invitesBlocked() || S.scenario === 'gfe_only';
  const isOpen = (c) => c.status === 'retrying' || c.status === 'unpaid' || c.status === 'collections';
  const openCharges = () => S.charges.filter(isOpen);
  const balance = () => round2(openCharges().reduce((s, c) => s + c.amount, 0));
  const oldestOpen = () => { const o = openCharges(); return o.length ? o[o.length - 1].date : null; };
  const earliest = () => (S.charges.length ? S.charges[S.charges.length - 1].date : TODAY);

  function rangeBounds(r) {
    if (!r || r.preset === 'all') return null;
    if (r.preset === 'custom') return isIso(r.from) && isIso(r.to) ? { from: fromIso(r.from), to: fromIso(r.to) } : null;
    if (r.preset === 'ytd') return { from: new Date(THIS_YEAR, 0, 1).getTime(), to: TODAY };
    const back = { d7: 6, d30: 29, d90: 89 }[r.preset];
    return back == null ? null : { from: TODAY - back * DAY, to: TODAY };
  }
  const inRange = (c, b) => !b || (c.date >= b.from && c.date < b.to + DAY);
  const byTab = (c, tab) => (tab === 'unpaid' ? isOpen(c) : tab === 'paid' ? !isOpen(c) : true);
  const billRows = () => { const b = rangeBounds(S.bill.range); return S.charges.filter((c) => byTab(c, S.bill.tab) && inRange(c, b)); };
  function rangeLabel(r) {
    const b = rangeBounds(r);
    return b ? `${longDate(b.from)} - ${longDate(b.to)}` : `${longDate(earliest())} - ${longDate(TODAY)}`;
  }
  const presetName = (id) => (PRESETS.find((p) => p[0] === id) || PRESETS[0])[1];

  function statusCell(c) {
    const n = D.LIMITS.retryHours.length;
    if (c.status === 'retrying') return ['Retrying', `Declined (${c.reason}). Automatic retry ${c.attempts} of ${n}${c.nextRetry ? ` on ${shortDate(c.nextRetry)}` : ''}.`];
    if (c.status === 'unpaid') return ['Unpaid', `All ${n} automatic retries failed (${c.reason}).`];
    if (c.status === 'collections') return ['In collections', 'With our collections team. Paying your balance settles it.'];
    if (c.status === 'collected') return ['Paid', c.paidOn ? `Paid ${shortDate(c.paidOn)} with your updated card.` : ''];
    return ['Paid', ''];
  }

  /* ------------------------------------------------------------------ mutations */
  function pay(testLast4) {
    const now = Date.now(); const amount = balance();
    const card = testLast4 ? { brand: 'Visa', last4: testLast4, exp: '09/29', declined: null } : Object.assign({}, S.card, { declined: null });
    S.charges = S.charges.map((c) => (isOpen(c) ? Object.assign({}, c, { status: 'collected', paidOn: now, nextRetry: null }) : c));
    S.card = card;
    S.lastPayment = { amount, last4: card.last4, brand: card.brand, at: now };
    if (S.scenario !== 'hold') S.scenario = 'ok';
    Object.assign(S.bill, { tab: 'all', page: 1, range: { preset: 'all', from: '', to: '' }, rangeOpen: false, draft: null });
  }
  function openCard(reason) { S.modal = { kind: 'card', reason, step: 'form', useFile: false, test: null, error: '', showCharges: false }; }
  function sendInvite() {
    if (S.scenario === 'hold') { openCard('invite'); return; }
    if (invitesBlocked()) { openCard('invite'); return; }
    go('invite');
  }
  function go(page) { S.page = page; S.bill.rangeOpen = false; pendingTop = true; }
  function openExport(from) {
    const b = rangeBounds(S.bill.range);
    const fromSettings = from === 'settings';
    const r = fromSettings ? { from: TODAY - 6 * DAY, to: TODAY } : b || { from: Math.max(earliest(), fromIso(D.LIMITS.exportFrom)), to: TODAY };
    S.modal = { kind: 'export', from: iso(r.from), to: iso(r.to), include: fromSettings ? 'all' : S.bill.tab, origin: fromSettings ? 'settings' : 'billing', error: '' };
  }
  const exportRows = (m) => (isIso(m.from) && isIso(m.to) ? S.charges.filter((c) => byTab(c, m.include) && inRange(c, { from: fromIso(m.from), to: fromIso(m.to) })) : []);
  function toCsv(rows) {
    const q = (v) => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['Date', 'Exam ID', 'Description', 'Amount', 'Status', 'Automatic attempts', 'Decline reason', 'Paid on'];
    const lines = rows.slice().sort((a, b) => a.date - b.date).map((c) => [iso(c.date), c.examId, c.description, c.amount.toFixed(2), statusCell(c)[0], c.attempts || '', c.reason || '', c.paidOn ? iso(c.paidOn) : ''].map(q).join(','));
    return [head.join(','), ...lines].join('\r\n') + '\r\n';
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ------------------------------------------------------------------ portal shell */
  const MENU = [
    ['results', 'Results', 'TbReportAnalytics'], ['', 'Clinics', 'BiClinic'], ['', 'Managers', 'FaUserTie'],
    ['', 'Medication Management', 'MdOutlineContentPasteSearch'], ['', 'Exams', 'FaNotesMedical'], ['', 'Intake Forms (Beta)', 'FaFileAlt'],
    ['', 'Knowledge Base', 'BsQuestionCircle'], ['', 'Weight Loss Exam', 'MdOutlineNoteAlt'], ['', 'Rewards', 'TiUserAdd'],
    ['', 'White Label', 'IoIosColorPalette'], ['billing', 'Billing', 'FaFileInvoiceDollar', true], ['settings', 'Settings', 'IoSettings'],
  ];
  function side() {
    const cur = S.page === 'invite' ? 'results' : S.page;
    return `<aside class="side"><div class="brand"><img class="full" src="assets/logo_white.png" alt="Qualiphy"><span class="mark"><img src="assets/logo_white.png" alt=""></span></div>
      <div class="dash"><span>Dashboard</span>${I('IoClose')}</div>
      <nav>${MENU.map(([pg, label, ic, isNew]) => `<button class="${pg && pg === cur ? 'on' : ''}" data-act="${pg ? 'go' : 'noop'}" data-page="${pg}" title="${esc(label)}"${pg ? ` id="nav-${pg}"` : ''}>${I(ic)}<span class="lbl">${esc(label)}</span>${isNew ? '<span class="new-dot">New</span>' : ''}</button>`).join('')}<div class="gap"></div><button data-act="noop" title="Logout">${I('TbLogout')}<span class="lbl">Logout</span></button></nav></aside>`;
  }
  function top(title, icon, opts) {
    const o = opts || {};
    const lead = o.back ? `<button class="back" data-act="go" data-page="${o.back}" aria-label="Back">${I('IoChevronBack')}</button>` : icon ? I(icon) : '';
    const right = o.noInvite ? '' : `<div class="right"><button class="btn btn-primary" data-act="invite" id="btn-send-invite">${I('RiMailSendFill')} Send Exam Invite</button></div>`;
    return `<header class="top"><h1>${lead}<span>${esc(title)}</span></h1>${right}</header>`;
  }
  const shell = (head, body) => `<div class="shell">${side()}<main class="main">${head}<div class="page">${guide()}${body}</div></main></div>`;

  function banner(onBilling) {
    const sc = S.scenario; if (sc === 'ok') return '';
    const open = openCharges(); const bal = balance();
    const charges = `${count(open.length, 'unpaid charge')} (${money(bal)})`;
    const retry = open.find((c) => c.nextRetry);
    const decl = S.card.declined;
    const C = {
      retrying: { tone: 'warn', title: "A payment didn't go through", body: `We couldn't charge ${money(bal)} to your ${S.card.brand} ending ${S.card.last4}${decl ? ` on ${shortDate(decl.on)} (${decl.reason})` : ''}. We'll try again automatically${retry ? ` on ${shortDate(retry.nextRetry)}` : ''}. Nothing is paused.`, label: 'Update card', reason: 'update' },
      gfe_only: { tone: 'stop', title: 'Prescription exams are paused', body: `${charges}. Good Faith Exams still work. Pay your balance to turn prescriptions back on.`, label: 'Pay balance', reason: 'pay' },
      blocked: { tone: 'stop', title: 'Sending exams is paused', body: `${charges}. Exams already in progress will finish. Pay your balance to turn sending back on right away.`, label: 'Pay balance', reason: 'pay' },
      hold: { tone: 'stop', title: 'Your account is on hold', body: "Sending exams is paused. You don't owe anything; contact support to lift the hold.", label: 'Contact support', reason: 'invite' },
    };
    C.backlog = C.blocked;
    const c = C[sc];
    const cls = c.tone === 'stop' ? 'btn-error' : 'btn-warning';
    const act = `<button class="btn btn-sm ${cls}" data-act="card" data-reason="${c.reason}" id="bnr-act">${esc(c.label)}</button>`;
    const right = onBilling
      ? (sc === 'hold' ? act : `<button class="btn btn-sm ${cls}" data-act="card" data-reason="pay" id="bnr-pay">Pay balance now</button>`)
      : `<button class="btn btn-ghost btn-sm" data-act="go" data-page="billing" id="bnr-billing">View billing</button>${act}`;
    return `<div class="bnr ${c.tone}" role="status" id="cc-banner"><div class="b-l">${I(sc === 'hold' ? 'BsLockFill' : 'BsExclamationTriangleFill')}<div><span class="b-t">${esc(c.title)}</span><span>${esc(c.body)}</span></div></div><div class="b-r">${right}</div></div>`;
  }

  /* ------------------------------------------------------------------ Results (Patient Exams) */
  function viewResults() {
    const rows = D.RESULTS.map((r) => {
      const day = longDate(daysAgo(r.ago));
      return `<tr><td>${r.id}</td><td>${esc(r.name)}</td><td>${esc(r.exam)}</td><td>${esc(r.status)}</td><td>None</td><td>${day}<br>${esc(r.sent)}</td><td>${r.done ? `${day}<br>${esc(r.done)}` : '-'}</td><td>${r.done ? '<button class="view" data-act="noop">View</button>' : ''}</td></tr>`;
    }).join('');
    const body = `${banner(false)}
      ${S.scenario === 'ok' ? '' : dnote('Where it shows', 'The banner sits where the portal already shows the "Missing Payment Method" callout, on Results and on Billing.')}
      <div class="res-head"><div><h2>Patient Exams List</h2><p>Note : If your patient is having issues connecting to a provider, please call support for immediate assistance. Need a refresher or have any additional questions, schedule time with your account manager <u>here.</u></p></div>
        <label class="fld"><span>Select Clinic:</span><span class="fake">${esc(D.CLINIC)} ${I('IoChevronDown')}</span></label></div>
      <div class="res-card"><div class="res-filters"><label class="fld"><span>Search:</span><span class="fake">Search</span></label><label class="fld"><span>Sort By:</span><span class="fake">Select Sort By ${I('IoChevronDown')}</span></label><label class="fld"><span>Date Range: ${I('FaInfoCircle')}</span><span class="fake" style="color:var(--ink)">${longDate(TODAY - 365 * DAY)} - ${longDate(TODAY)}</span></label></div>
        <table class="ptbl"><thead><tr><th>ID</th><th>Patient Name</th><th>Exam Title</th><th>Status</th><th>Medication Information &amp; Tracking</th><th>Sent Date</th><th>Completed Date</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="prevnext"><button class="btn btn-outline" disabled>${I('RxChevronLeft')} Prev</button><button class="btn btn-outline" disabled>Next ${I('RxChevronRight')}</button></div></div>`;
    return shell(top('Patient Exams', 'TbReportAnalytics'), body);
  }

  /* ------------------------------------------------------------------ Invite Patient */
  function viewInvite() {
    const rx = rxBlocked(); const v = S.invite;
    const lock = rx ? `<div class="ct-lock" id="rx-lock"><span>${I('BsLockFill')}<b>Prescription exams are paused</b> because of an unpaid balance of ${money(balance())}. Good Faith Exams still work.</span><button class="btn btn-error btn-sm" data-act="card" data-reason="pay">Pay balance</button></div>` : '';
    const cards = D.CONSULT_TYPES.map((t) => {
      const locked = rx && t.rx; const on = v.type === t.id && !locked;
      return `<button class="ct${on ? ' on' : ''}${locked ? ' locked' : ''}" data-act="ct" data-type="${t.id}"${locked ? ' data-locked="1" title="Paused: unpaid balance. Click to pay it."' : ''}><span class="rd">${I(locked ? 'BsLockFill' : 'FaCheck')}</span>${esc(t.label)}${locked ? '<span class="ct-why">Paused: unpaid balance</span>' : ''}</button>`;
    }).join('');
    const exams = D.EXAMS_BY_TYPE[v.type] || [];
    const body = `<div class="inv">
      ${rx ? dnote('Rx paused', 'Prescription consultation types lock and say why. Good Faith Exam & Orders still works. Clicking a locked type opens the card screen.') : ''}
      <div class="grid2"><label class="fld"><span>Clinic ${I('FaInfoCircle')}</span><span class="fake" style="color:var(--ink);height:48px">${esc(D.CLINIC)} ${I('IoChevronDown')}</span></label>
        <label class="fld"><span>Patient State ${I('FaInfoCircle')}</span><select class="sel" data-bind="invite.state">${D.STATE_OPTIONS.map((s) => `<option${s === v.state ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label></div>
      <h3>Consultation Type <span class="pi" style="width:16px;height:16px;color:var(--info)">${ICON.FaInfoCircle || ''}</span></h3>
      ${lock}
      <div class="cts" id="consult-types">${cards}</div>
      ${exams.length ? `<label class="fld"><span>Exam ${I('FaInfoCircle')}</span><select class="sel" data-bind="invite.exam">${exams.map((x) => `<option${x === v.exam ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>` : ''}
      <h3>Patient Details</h3>
      <div class="grid2"><label class="fld"><span>First Name</span><input class="inp" placeholder="First Name"></label><label class="fld"><span>Last Name</span><input class="inp" placeholder="Last Name"></label>
        <label class="fld"><span>Email</span><input class="inp" placeholder="Email"></label><label class="fld"><span>Phone Number</span><input class="inp" placeholder="(___) ___-____"></label>
        <label class="fld"><span>Date of Birth</span><input class="inp" placeholder="MM/DD/YYYY"></label><label class="fld"><span>Gender Assigned at Birth</span><select class="sel"><option>Select Gender Assigned at Birth</option><option>Female</option><option>Male</option></select></label></div>
      <h3>Note to Provider</h3>
      <label class="chk"><input type="checkbox"> Add note to provider?</label>
      <div class="inv-send"><button class="btn btn-primary" data-act="send" id="btn-send">Send Invite</button></div></div>`;
    return shell(top('Invite Patient', null, { back: 'results', noInvite: true }), body);
  }

  /* ------------------------------------------------------------------ Billing (new tab) */
  function rangePicker() {
    const b = S.bill; const dr = b.draft || b.range;
    const pop = b.rangeOpen ? `<div class="drp-pop" id="drp-pop">
      <div class="presets">${PRESETS.map(([id, l]) => `<button class="${dr.preset === id ? 'on' : ''}" data-act="preset" data-preset="${id}">${l}</button>`).join('')}</div>
      ${dr.preset === 'custom' ? `<div class="custom"><label>From<input type="date" id="drp-from" data-bind="bill.draft.from" value="${esc(dr.from)}" max="${iso(TODAY)}"></label><label>To<input type="date" id="drp-to" data-bind="bill.draft.to" value="${esc(dr.to)}" max="${iso(TODAY)}"></label></div>
      <div class="pop-f"><button class="btn btn-ghost btn-sm" data-act="range-cancel">Cancel</button><button class="btn btn-primary btn-sm" data-act="range-apply" id="drp-apply">Apply</button></div>` : ''}
    </div>` : '';
    return `<div class="drp"><button class="drp-btn" data-act="range-open" id="drp-btn" aria-expanded="${b.rangeOpen}"><span>${esc(rangeLabel(b.range))}</span>${I('BsCalendar3')}</button>${pop}</div>`;
  }
  function pagination(page, pages, entries) {
    const start = (page - 1) * PER + 1; const end = Math.min(page * PER, entries);
    const vis = pages <= 3 ? Array.from({ length: pages }, (_, i) => i + 1) : page === 1 ? [1, 2, 3] : page === pages ? [pages - 2, pages - 1, pages] : [page - 1, page, page + 1];
    return `<div class="pgn" id="billing-pager"><span class="showing">Showing ${start.toLocaleString('en-US')} to ${end.toLocaleString('en-US')} of ${entries.toLocaleString('en-US')} entries</span><div class="pages">${page > 1 ? `<button class="arr l" data-act="pg" data-p="${page - 1}" aria-label="Previous page">&lsaquo;</button>` : ''}${vis.map((p) => `<button class="${p === page ? 'on' : ''}${page === 1 && p === 1 ? ' first' : ''}" data-act="pg" data-p="${p}"${p === page ? ' aria-current="page"' : ''}>${p}</button>`).join('')}${page < pages ? `<button class="arr r" data-act="pg" data-p="${page + 1}" aria-label="Next page">&rsaquo;</button>` : ''}</div></div>`;
  }
  function chargeRow(c) {
    const [chip, note] = statusCell(c);
    return `<tr class="${isOpen(c) ? 'open' : ''}"><td class="nw">${shortDate(c.date)}</td><td class="nw">#${c.examId}</td><td>${esc(c.description)}</td><td class="r tnum">${money(c.amount)}</td><td><div class="st"><span class="chip ${c.status}">${chip}</span>${note ? `<small>${esc(note)}</small>` : ''}</div></td></tr>`;
  }
  const supportLine = (id) => `<p class="support"${id ? ` id="${id}"` : ''}>If you need more clarification on these charges, please contact <a href="#" data-act="mail">${esc(SP.support || 'support')}</a>.</p>`;
  function viewBilling() {
    const sc = S.scenario; const open = openCharges(); const bal = balance(); const b = S.bill;
    const status = sc === 'ok'
      ? `<div class="bnr ok" role="status" id="billing-status"><div class="b-l">${I('BsCheckCircleFill')}<span><b>Account active.</b> Your account is in good standing.</span></div></div>`
      : banner(true);
    const tone = sc === 'retrying' ? 'warn' : 'stop';
    const balSub = open.length
      ? `${count(open.length, sc === 'retrying' ? 'failed charge' : 'unpaid charge')}, oldest from ${shortDate(oldestOpen())}`
      : S.lastPayment ? `Last payment ${money(S.lastPayment.amount)} on ${shortDate(S.lastPayment.at)}` : 'Nothing owed';
    const card = S.card;
    const cards = `<div class="bill-cards">
      <section class="bcard" id="billing-balance"><span class="k">Balance due</span><span class="bal${bal > 0 ? ' ' + tone : ''}">${money(bal)}</span><span class="sub">${esc(balSub)}</span></section>
      <section class="bcard" id="billing-card"><span class="k">Card on file</span><span class="cardline">${I('BsCreditCard2Front')} ${esc(card.brand)} ending ${esc(card.last4)} <span class="exp">expires ${esc(card.exp)}</span></span>
        ${card.declined ? `<span class="bad">Declined ${shortDate(card.declined.on)} (${esc(card.declined.reason)})</span>` : '<span class="good">Working</span>'}
        <button class="btn btn-outline btn-sm" data-act="card" data-reason="update" id="btn-update-card">Update card</button></section></div>`;
    const rows = billRows();
    const pages = Math.max(1, Math.ceil(rows.length / PER)); const page = Math.min(Math.max(1, b.page), pages);
    const slice = rows.slice((page - 1) * PER, page * PER);
    const tabs = [['all', 'All'], ['unpaid', `Unpaid${open.length ? ` (${open.length.toLocaleString('en-US')})` : ''}`], ['paid', 'Paid']];
    const total = round2(rows.reduce((s, c) => s + c.amount, 0));
    const filtered = b.tab !== 'all' || b.range.preset !== 'all';
    const charges = `<section class="ch" style="display:flex;flex-direction:column;gap:14px">
      <div class="ch-head"><h2>Charges</h2><div class="tabs-boxed" role="tablist" aria-label="Filter charges">${tabs.map(([id, l]) => `<button role="tab" class="${b.tab === id ? 'on' : ''}" aria-selected="${b.tab === id}" data-act="tab" data-tab="${id}" id="tab-${id}">${esc(l)}</button>`).join('')}</div></div>
      <div class="ch-filters"><div class="ch-actions"><div class="fld"><span>Date Range: ${I('FaInfoCircle')}</span>${rangePicker()}</div><button class="btn btn-primary" data-act="export" id="btn-export">${I('BsDownload')} Export</button></div>
        <div class="ch-count" id="ch-count"><b>${count(rows.length, 'charge')}</b>, ${money(total)}${filtered ? ` <button class="link" data-act="clear-filters" style="margin-left:6px">Clear filters</button>` : ''}</div></div>
      <div class="ctbl-wrap"><table class="ctbl" id="billing-charges"><thead><tr><th>Date</th><th>Exam</th><th>Description</th><th class="r">Amount</th><th>Status</th></tr></thead>
        <tbody>${slice.length ? slice.map(chargeRow).join('') : `<tr class="empty"><td colspan="5">No ${b.tab === 'all' ? '' : b.tab + ' '}charges in this date range.</td></tr>`}</tbody></table></div>
      ${rows.length ? pagination(page, pages, rows.length) : ''}
      ${supportLine('billing-support')}</section>`;
    const L = D.LIMITS;
    const howto = `<section class="howto" id="billing-howto"><h3>How billing works</h3><ul>
      <li>Each exam is charged to your card on file.</li>
      <li>If a charge fails, we retry it automatically after ${L.retryHours.slice(0, -1).join(', ')} and ${L.retryHours[L.retryHours.length - 1]} hours.</li>
      <li>If it's still unpaid, prescription exams pause. At ${L.failureCount} unpaid charges or ${money(L.dollarLimit).replace('.00', '')} owed, sending new exams pauses.</li>
      <li>Paying your balance turns everything back on right away. Exams already in progress always finish.</li></ul>
      <p>Need a spreadsheet? Use <b>Export</b> above for any date range. Export Billing in <button class="link" data-act="go" data-page="settings">Settings</button> still works too.</p></section>`;
    const notes = dnote('Added after the first review', '<b>Pages:</b> 10 charges per page, with the page control the portal already uses on Medication Management. <b>Export:</b> the date range and the tab filter what you see, and Export downloads exactly that, in every status. <b>Support line</b> under the table.', 'billing-note');
    return shell(top('Billing', 'FaFileInvoiceDollar'), `${status}${notes}${cards}${charges}${howto}`);
  }

  /* ------------------------------------------------------------------ Settings */
  function viewSettings() {
    const body = `${dnote('Exists today', esc(SP.exportToday || 'Settings already has Export Billing with a date range.'), 'settings-note')}
      <div class="set-col"><div class="api-card"><div class="t">API Key (Default Clinic)</div><div class="api-key">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</div><div class="api-doc">API Documentation<small>Endpoints, request formats and webhook events for this key.</small></div></div>
        <button class="btn btn-primary" data-act="export" data-from="settings" id="btn-settings-export">Export Billing</button>
        <button class="btn btn-primary" data-act="noop">Notification Settings</button>
        <button class="btn btn-primary" data-act="noop">WordPress Quidget</button>
        <button class="btn btn-primary" data-act="noop">Embed Quidget</button>
        <button class="btn btn-primary" data-act="noop">Change Password</button>
        <button class="btn btn-purple" data-act="noop">Change Email</button>
        <button class="btn btn-error" data-act="noop">Logout</button></div>`;
    return shell(top('Settings', 'IoSettings', { noInvite: true }), body);
  }

  /* ------------------------------------------------------------------ patient page */
  function viewPatient() {
    const sc = S.scenario;
    const shown = rxBlocked();
    const card = `<div class="pt-card" id="cc-patient">${I('BsCalendar2X')}<h1>Online consultations aren't available right now</h1><p>This clinic can't take new online consultations at the moment. Please contact the clinic directly to book your visit.</p><p class="fine2">If you already started a consultation, you can still finish it.</p></div>`;
    const note = !shown
      ? `In "${esc(SC_BY[sc].label)}" nothing is paused, so patients start exams as usual. This page appears when sending exams is paused.`
      : sc === 'gfe_only' ? 'At "Rx paused" only prescription exams show this page. Good Faith Exams start as usual.' : 'What a patient sees at a paused clinic, from Quidget or a patient link. It never mentions payment, because the patient has nothing to fix.';
    return `<div class="pt-page"><div style="display:flex;flex-direction:column;gap:16px;align-items:center;width:min(480px,100%)">${shown ? card : ''}${dnote('Patient view', note)}<button class="btn btn-outline btn-sm" data-act="go" data-page="results" id="pt-back">Back to the clinic portal</button></div></div>`;
  }

  /* ------------------------------------------------------------------ modals */
  function modal(title, body, size, id) {
    return `<div class="modal-wrap" data-act="modal-bg"><div class="modal ${size || 'lg'}" role="dialog" aria-label="${esc(title)}" data-stop${id ? ` id="${id}"` : ''}><div class="modal-h"><h3>${esc(title)}</h3><button class="modal-x" data-act="modal-close" aria-label="Close">${I('IoClose')}</button></div><div class="modal-b">${body}</div></div></div>`;
  }
  function chargeList(list) {
    const shown = list.slice(0, PER);
    const more = list.length - shown.length;
    return `<ul class="clist" id="cc-list">${shown.map((c) => `<li><span class="cd"><b>${esc(c.description)}</b><small>${shortDate(c.date)} · Exam #${c.examId}</small></span><span class="ca"><span class="chip ${c.status}">${statusCell(c)[0]}</span><span class="amt">${money(c.amount)}</span></span></li>`).join('')}${more > 0 ? `<li class="more" id="cc-more">Showing ${PER} of ${list.length.toLocaleString('en-US')}.&nbsp;<button class="link" data-act="see-all">See them all on Billing</button></li>` : ''}</ul>`;
  }
  function cardModal() {
    const m = S.modal; const sc = S.scenario; const owed = balance(); const open = openCharges();
    const card = S.card; const expired = !!card.declined && card.declined.reason === D.DECLINE.expired;
    if (sc === 'hold' && m.step !== 'done') {
      return modal('Your account is on hold', `<div class="hold-box" id="cc-hold">${I('BsLockFill')}<div><p><b>Sending exams is paused.</b></p><p>Our team has placed a hold on this account. You don't owe anything, so a new card won't lift it.</p></div></div>
        <p>Email us and we'll help you sort it out. Exams already in progress will still finish.</p>
        <div class="modal-f"><button class="btn btn-ghost" data-act="modal-close">Close</button><button class="btn btn-primary" data-act="mail">Email ${esc(SP.support || 'support')}</button></div>`, 'lg', 'cc-modal');
    }
    if (m.step === 'done' && S.lastPayment) {
      const p = S.lastPayment;
      const next = m.reason === 'invite' ? ['Continue to Send Exam Invite', 'after-invite'] : m.reason === 'rx' ? ['Back to your invite', 'modal-close'] : ['Done', 'modal-close'];
      return modal('Payment received', `<div class="done" id="cc-success">${I('BsCheckCircleFill', 'ok-ico')}<p class="big">You're all set.</p>
        <p>${p.amount > 0 ? `We charged <b>${money(p.amount)}</b> to your ${esc(p.brand)} ending ${esc(p.last4)}. Those charges now show as paid on your Billing page.` : `Your ${esc(p.brand)} ending ${esc(p.last4)} is now your card on file.`}</p>
        ${p.amount > 0 ? `<p><b>${m.reason === 'rx' ? 'Prescription exams are back on.' : 'Sending exams is back on.'}</b></p>` : ''}
        <button class="btn btn-primary" data-act="${next[1]}" id="cc-next">${next[0]}</button></div>`, 'lg', 'cc-modal');
    }
    const retrying = sc === 'retrying';
    const paused = invitesBlocked() || rxBlocked();
    const title = m.reason === 'rx' ? 'Prescriptions are paused' : m.reason === 'update' ? 'Update your card' : m.reason === 'pay' ? 'Pay your balance' : "There's a problem with your card";
    const heading = m.reason === 'rx'
      ? `<p>We're having trouble with the card on file.</p><p><b>Good Faith Exams still work. Prescription exams are paused until your balance is paid.</b></p>`
      : m.reason === 'update' ? `<p>Enter the card you'd like us to use for your exams.</p>`
      : m.reason === 'pay' ? `<p>${invitesBlocked() ? 'Pay your balance to turn sending exams back on right away.' : 'Pay your balance now so nothing gets paused.'}</p>`
      : `<p>We're having trouble with the card on file. Please enter a new one to continue.</p><p><b>Sending exams is paused until your balance is paid.</b></p>`;
    const owedBox = owed > 0 ? `<div class="owed ${retrying ? 'warn' : 'stop'}" id="cc-balance"><div class="o-top"><span>${count(open.length, retrying ? 'failed charge' : 'unpaid charge')}${open.length === 1 ? ' from ' : ', oldest from '}${shortDate(oldestOpen())}</span><span class="o-amt">${money(owed)}</span></div>
      <button class="toggle" data-act="toggle-charges" id="cc-toggle">${m.showCharges ? 'Hide charges' : 'Show charges'}</button>${m.showCharges ? chargeList(open) : ''}</div>` : '';
    const onFile = card.declined ? `<div class="onfile">${I('BsCreditCard2Front')}<span>Card on file: ${esc(card.brand)} ending ${esc(card.last4)} was declined on ${shortDate(card.declined.on)} (${esc(card.declined.reason)}).</span></div>` : '';
    const err = m.error ? `<div class="alert" role="alert" id="cc-error">${I('BsExclamationTriangleFill')}<span>${esc(m.error)}</span></div>` : '';
    const canRetryFile = m.reason === 'pay' && owed > 0 && !expired;
    const radios = canRetryFile ? `<div class="radios" role="radiogroup" aria-label="Pay with"><label><input type="radio" name="payw" data-act="use-file" data-v="0"${!m.useFile ? ' checked' : ''}> A new card</label><label><input type="radio" name="payw" data-act="use-file" data-v="1" id="cc-use-file"${m.useFile ? ' checked' : ''}> Try my ${esc(card.brand)} ending ${esc(card.last4)} again</label></div>` : '';
    const t = D.DEMO_CARDS.find((c) => c.last4 === m.test);
    const busy = m.step === 'processing';
    const form = m.useFile ? '' : `<div class="testcards" id="cc-testcards"><b>Demo cards</b>${D.DEMO_CARDS.map((c) => `<button class="${m.test === c.last4 ? 'on' : ''}" data-act="test-card" data-last4="${c.last4}" id="tc-${c.last4}">${esc(c.label)}: ${esc(c.outcome)}</button>`).join('')}<span>This demo can't take real card details.</span></div>
      <fieldset class="cform" style="border:0;padding:0;margin:0"${busy ? ' disabled' : ''}>
        <label class="c6">Name on card<input class="inp" readonly value="${t ? esc(D.CLINIC) : ''}" placeholder="Pick a demo card"></label>
        <label class="c6">Card number<input class="inp" readonly value="${t ? `4000 0000 0000 ${t.last4}` : ''}" placeholder="1234 5678 9012 3456"></label>
        <label class="c2">Expiry<input class="inp" readonly value="${t ? '09/29' : ''}" placeholder="MM/YY"></label>
        <label class="c2">CVC<input class="inp" readonly value="${t ? '&bull;&bull;&bull;' : ''}"></label>
        <label class="c2">Billing ZIP<input class="inp" readonly value="${t ? '90210' : ''}"></label></fieldset>
      <p class="fine">${I('BsLockFill')} Card details are encrypted and sent straight to our payment processor.</p>`;
    const chargeNote = `<p class="fine">${owed > 0 ? `We'll charge ${money(owed)} to this card now and use it for future exams.${paused ? ' Access comes back as soon as the payment goes through.' : ''}` : "We'll use this card for future exams."}</p>`;
    const cta = owed > 0 ? `Pay ${money(owed)}${m.reason === 'invite' || m.reason === 'rx' ? ' and continue' : ''}` : 'Save card';
    return modal(title, `${heading}${owedBox}${owed > 0 ? supportLine('cc-support') : ''}${onFile}${err}${radios}${form}${chargeNote}
      <div class="modal-f"><button class="btn btn-ghost" data-act="modal-close"${busy ? ' disabled' : ''}>Not now</button><button class="btn btn-primary${busy ? ' loading' : ''}" data-act="submit-card" id="cc-submit"${busy ? ' disabled' : ''} style="min-width:12rem">${busy ? 'Processing' : esc(cta)}</button></div>`, 'lg', 'cc-modal');
  }
  function exportModal() {
    const m = S.modal; const rows = exportRows(m); const total = round2(rows.reduce((s, c) => s + c.amount, 0));
    const valid = isIso(m.from) && isIso(m.to) && m.from <= m.to;
    return modal('Export Clinic Billing', `<div class="xrow"><span class="lbl">Date Range:</span><div class="grid2" style="gap:8px"><input type="date" class="inp" id="x-from" data-bind="modal.from" data-rerender value="${esc(m.from)}" max="${iso(TODAY)}"><input type="date" class="inp" id="x-to" data-bind="modal.to" data-rerender value="${esc(m.to)}" max="${iso(TODAY)}"></div></div>
      <div class="xrow"><span class="lbl">Include: <span class="chip new">New</span></span><select class="sel" id="x-include" data-bind="modal.include" data-rerender>${INCLUDE.map(([v, l]) => `<option value="${v}"${m.include === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="preview" id="x-preview">${valid ? `<b>${count(rows.length, 'charge')}</b>, ${money(total)}, from ${longDate(fromIso(m.from))} to ${longDate(fromIso(m.to))}.` : 'Pick a start and end date.'}</div>
      <p class="small">You can only export billing summaries dated on or after March 1, 2025.</p>
      ${m.error ? `<div class="alert" role="alert">${I('BsExclamationTriangleFill')}<span>${esc(m.error)}</span></div>` : ''}
      ${dnote(m.origin === 'settings' ? 'Exists today' : 'Same export as Settings', m.origin === 'settings' ? 'This is the Export Billing dialog clinics have today, plus the new Include choice so failed and collections charges can be exported.' : 'Billing opens the Export Billing dialog with its current filters filled in. Include is new, so failed and collections charges come out too.')}
      <div class="modal-f"><button class="btn btn-primary" data-act="generate" id="x-generate"${valid ? '' : ' disabled'}>Generate</button></div>`, 'sm', 'export-modal');
  }
  function csvModal() {
    const m = S.modal;
    return modal('Export Billing', `<p><b>Your billing has been exported.</b></p><p class="small muted">${count(m.rows, 'charge')}, saved as ${esc(m.file)}.</p>
      ${dnote('Small fix', 'Today this dialog says "Export Logs" and saves data.csv. The demo names it for billing and dates the file.')}
      <div class="modal-f"><button class="btn btn-success" data-act="download" id="x-download">Download</button></div>`, 'sm', 'csv-modal');
  }

  /* ------------------------------------------------------------------ demo layer */
  function bar() {
    return `<div class="bar-inner"><span class="bar-tag">Demo</span><span class="bar-lbl">Scenario</span>${D.SCENARIOS.map((s) => `<button class="bar-btn${S.scenario === s.id ? ' on' : ''}" data-act="scenario" data-s="${s.id}" id="sc-${s.id}">${esc(s.short)}</button>`).join('')}<span class="bar-sep"></span>
      <button class="bar-btn tool${S.page === 'patient' ? ' on' : ''}" data-act="patient" id="bar-patient">Patient view</button>
      <button class="bar-btn tool${S.drawer ? ' on' : ''}" data-act="about" id="bar-about">About</button>
      <button class="bar-btn tool${S.guide ? ' on' : ''}" data-act="guide" id="bar-tips" title="Show or hide the scenario tips">Tips</button>
      <button class="bar-btn tool" data-act="notes" title="Show or hide the amber demo notes">${S.notes ? 'Hide notes' : 'Show notes'}</button>
      <button class="bar-btn tool" data-act="reset" id="bar-reset">Reset</button></div>`;
  }
  function guide() {
    if (!S.guide) return '';
    const s = SC_BY[S.scenario];
    const paid = S.lastPayment && S.scenario === 'ok';
    const what = paid ? `Paid ${money(S.lastPayment.amount)} with the ${S.lastPayment.brand} ending ${S.lastPayment.last4}, so everything is back on. Pick a scenario to start again.` : s.what;
    return `<div class="scard" id="scard"><span class="s-k">Scenario</span><b class="s-t">${esc(paid ? 'Paid up' : s.label)}</b><span class="s-w">${esc(what)}</span>${paid ? '' : `<span class="tries">${s.tries.map(([l, a]) => `<button data-act="try" data-a="${a}">${esc(l)}</button>`).join('')}</span>`}</div>`;
  }
  function kvt(rows) { return `<table class="kvt">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`; }
  function about() {
    const tk = Object.values(T).filter(Boolean);
    const what = T.block
      ? `A clickable design reference for ${T.block} (pause exams on a failed-charge backlog, collect when the clinic updates its card) and ${T.force} (force block), with the clinic's own Billing page.`
      : 'A clickable design reference for clinic credit controls: pausing exams when charges go unpaid, collecting when the clinic updates its card, and the clinic\'s own Billing page.';
    const qs = (SP.questions || []).map(([who, q]) => `<li><span class="qown">${esc(who)}</span> ${esc(q.replace('{backlog}', money(BACKLOG_TOTAL)))}</li>`).join('');
    return `<div class="backdrop" data-act="about-bg"><div class="drawer" data-stop id="about"><div class="dr-head"><div><div class="dr-kicker">About this demo</div><h2>${esc(D.META.title)}</h2><div class="sub">${esc(D.META.version)} · ${esc(D.META.date)}${SP.audience ? ` · for ${esc(SP.audience)}` : ''}</div></div><button class="dr-x" data-act="about-close" aria-label="Close">&times;</button></div>
      <div class="dr-body">
        <h3>What this is</h3><p>${esc(what)} Every number, card and date is demo data, and nothing calls a payment gateway.</p>
        <h3>Added after the first review</h3>${kvt(SP.fromReview || [])}
        <h3>Export today</h3><p>${esc(SP.exportToday || '')}</p>
        <h3>Scenarios (bottom bar)</h3>${kvt(D.SCENARIOS.map((s) => [s.label, s.what]))}
        <h3>Defaults built in (confirm or change)</h3><ol>${(SP.defaults || []).map((d) => `<li>${esc(d)}</li>`).join('')}</ol>
        <h3>Open questions</h3><ul>${qs}</ul>
        <h3>Engineering notes</h3>${kvt(SP.engineering || [])}
        ${tk.length ? `<h3>Tickets</h3><p class="small">${tk.map(esc).join(', ')}</p>` : ''}
        <h3>How to use it</h3><ul><li>The <b>bottom bar</b> switches scenarios. Each one resets the account to that state.</li><li><b>Pay balance</b> or <b>Update card</b>: pick the demo card ending 0002 to see a decline, or 1881 to pay.</li><li><b>Patient view</b> shows what a patient sees at a paused clinic.</li><li><b>Reset</b> starts over. Changes are kept in this browser until then.</li></ul>
      </div></div></div>`;
  }

  /* ------------------------------------------------------------------ actions */
  function doTry(a) {
    const [k, v] = a.split(':');
    if (k === 'go') go(v);
    else if (k === 'card') openCard(v);
    else if (k === 'invite') sendInvite();
    else if (k === 'export') { go('billing'); openExport('billing'); }
    else if (k === 'billing') { go('billing'); S.bill.tab = v; S.bill.page = 1; }
  }
  function submitCard() {
    const m = S.modal; if (!m || m.kind !== 'card' || m.step === 'processing') return false;
    if (!m.useFile && !m.test) { m.error = "Pick a demo card first. This demo can't take real card details."; return true; }
    m.error = ''; m.step = 'processing';
    setTimeout(() => {
      if (S.modal !== m) return;
      if (!m.useFile && m.test === '0002') {
        m.step = 'form'; m.test = null;
        m.error = `Your bank declined that card. ${invitesBlocked() ? 'Sending exams is still paused. ' : rxBlocked() ? 'Prescription exams are still paused. ' : ''}Try a different card, or call your bank.`;
      } else {
        pay(m.useFile ? null : m.test); m.step = 'done';
      }
      render();
    }, STATIC ? 60 : 1100);
    return true;
  }
  const ACT = {
    noop() { toast('Not part of this demo.', 'info'); return false; },
    mail() { toast(`Demo: this opens an email to ${SP.support || 'support'}.`, 'info'); return false; },
    go(d) { if (d.page) go(d.page); },
    invite() { sendInvite(); },
    card(d) { openCard(d.reason); },
    ct(d) {
      if (d.locked) { openCard('rx'); return; }
      S.invite.type = d.type; S.invite.exam = (D.EXAMS_BY_TYPE[d.type] || [''])[0];
    },
    send() { toast('Demo: the invite isn\'t sent anywhere.', 'info'); return false; },
    tab(d) { S.bill.tab = d.tab; S.bill.page = 1; },
    pg(d) {
      S.bill.page = Number(d.p) || 1;
      setTimeout(() => { const el = document.getElementById('billing-charges'); if (el && el.getBoundingClientRect().top < 80) el.scrollIntoView({ block: 'start' }); }, 0);
    },
    'range-open'() { const b = S.bill; if (b.rangeOpen) { b.rangeOpen = false; b.draft = null; return; } const cur = rangeBounds(b.range) || { from: earliest(), to: TODAY }; b.draft = { preset: b.range.preset, from: b.range.from || iso(cur.from), to: b.range.to || iso(cur.to) }; b.rangeOpen = true; },
    preset(d) {
      const b = S.bill; if (!b.draft) return false;
      if (d.preset === 'custom') { b.draft.preset = 'custom'; return; }
      b.range = { preset: d.preset, from: '', to: '' }; b.rangeOpen = false; b.draft = null; b.page = 1;
    },
    'range-apply'() {
      const b = S.bill; const dr = b.draft; if (!dr) return false;
      if (!isIso(dr.from) || !isIso(dr.to) || dr.from > dr.to) { toast('Pick a start date on or before the end date.', 'err'); return false; }
      b.range = { preset: 'custom', from: dr.from, to: dr.to }; b.rangeOpen = false; b.draft = null; b.page = 1;
    },
    'range-cancel'() { S.bill.rangeOpen = false; S.bill.draft = null; },
    'clear-filters'() { S.bill.tab = 'all'; S.bill.range = { preset: 'all', from: '', to: '' }; S.bill.page = 1; },
    export(d) { openExport(d.from === 'settings' ? 'settings' : 'billing'); },
    generate() {
      const m = S.modal; if (!m || m.kind !== 'export') return false;
      if (!isIso(m.from) || !isIso(m.to) || m.from > m.to) { m.error = 'Pick a start date on or before the end date.'; return; }
      if (m.from < D.LIMITS.exportFrom) { m.error = 'You can only export billing summaries dated on or after March 1, 2025'; return; }
      const rows = exportRows(m);
      if (!rows.length) { m.error = 'No charges in that range.'; return; }
      S.modal = { kind: 'csv', rows: rows.length, file: `qualiphy-billing-${m.from}-to-${m.to}.csv`, csv: toCsv(rows) };
      toast('Billing exported successfully');
    },
    download() { const m = S.modal; if (!m || m.kind !== 'csv') return false; download(m.file, m.csv); toast(`Downloaded ${m.file}`); S.modal = null; },
    'toggle-charges'() { if (S.modal) S.modal.showCharges = !S.modal.showCharges; },
    'see-all'() { S.modal = null; go('billing'); S.bill.tab = 'unpaid'; S.bill.page = 1; S.bill.range = { preset: 'all', from: '', to: '' }; },
    'use-file'(d) { if (S.modal) { S.modal.useFile = d.v === '1'; S.modal.error = ''; } },
    'test-card'(d) { if (S.modal) { S.modal.test = d.last4; S.modal.error = ''; } },
    'submit-card'() { return submitCard(); },
    'after-invite'() { S.modal = null; go('invite'); },
    'modal-close'() { if (S.modal && S.modal.step === 'processing') return false; S.modal = null; },
    'modal-bg'() { if (S.modal && S.modal.step === 'processing') return false; S.modal = null; },
    scenario(d) { setScenario(d.s); },
    patient() { go(S.page === 'patient' ? 'results' : 'patient'); },
    about() { S.drawer = !S.drawer; },
    'about-close'() { S.drawer = false; },
    'about-bg'() { S.drawer = false; },
    notes() { S.notes = !S.notes; },
    guide() { S.guide = !S.guide; },
    try(d) { doTry(d.a); },
    reset() {
      try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
      S = fresh(D.DEFAULT_SCENARIO); pendingTop = true; toast('Reset: back to the start.', 'info');
    },
  };

  /* ------------------------------------------------------------------ render + events */
  const $app = document.getElementById('app');
  const $overlay = document.getElementById('overlay');
  const $bar = document.getElementById('bar');

  function view() {
    if (S.page === 'patient') return viewPatient();
    if (S.page === 'invite') return viewInvite();
    if (S.page === 'settings') return viewSettings();
    if (S.page === 'results') return viewResults();
    return viewBilling();
  }
  function overlays() {
    let h = '';
    if (S.drawer) h += about();
    const m = S.modal;
    if (m && m.kind === 'card') h += cardModal();
    else if (m && m.kind === 'export') h += exportModal();
    else if (m && m.kind === 'csv') h += csvModal();
    return h;
  }
  function render() {
    if (S.page === 'invite' && invitesBlocked()) S.page = 'results';
    document.body.classList.toggle('notes-off', !S.notes);
    $app.innerHTML = view();
    $overlay.innerHTML = overlays();
    $bar.innerHTML = bar();
    if (pendingTop) { pendingTop = false; window.scrollTo(0, 0); }
    saveSoon();
  }

  document.addEventListener('click', (e) => {
    if (S.bill.rangeOpen && !e.target.closest('.drp')) { S.bill.rangeOpen = false; S.bill.draft = null; if (!e.target.closest('[data-act]')) { render(); return; } }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act;
    if ((act === 'modal-bg' || act === 'about-bg') && e.target.closest('[data-stop]')) return;
    const fn = ACT[act]; if (!fn) return;
    if (el.tagName !== 'INPUT') e.preventDefault();
    if (fn(el.dataset, el, e) !== false) render();
  });
  document.addEventListener('input', (e) => {
    const el = e.target; const path = el.dataset && el.dataset.bind; if (!path || el.tagName === 'SELECT' || el.type === 'checkbox') return;
    setPath(S, path, el.value);
    if (el.dataset.rerender !== undefined && el.type !== 'date') render(); else saveSoon();
  });
  document.addEventListener('change', (e) => {
    const el = e.target; const path = el.dataset && el.dataset.bind; if (!path) return;
    setPath(S, path, el.type === 'checkbox' ? el.checked : el.value);
    if (S.modal && S.modal.error && path.startsWith('modal.')) S.modal.error = '';
    if (el.dataset.rerender !== undefined) render(); else saveSoon();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (S.bill.rangeOpen) { S.bill.rangeOpen = false; S.bill.draft = null; render(); }
    else if (S.modal && S.modal.step !== 'processing') { S.modal = null; render(); }
    else if (S.drawer) { S.drawer = false; render(); }
  });
  window.addEventListener('beforeunload', save);

  /* ------------------------------------------------------------------ init */
  S = load() || fresh(params.get('s') || D.DEFAULT_SCENARIO);
  if (params.has('s') && SC_BY[params.get('s')]) setScenario(params.get('s'));
  if (params.has('page')) { const p = params.get('page'); if (['results', 'invite', 'billing', 'settings', 'patient'].includes(p)) S.page = p; }
  render();

  /* Test hook for the smoke script: read-only snapshot of the store. */
  window.__demo = { get state() { return JSON.parse(JSON.stringify(S)); }, backlogTotal: BACKLOG_TOTAL };
})();
