/* app.js — interfaccia dell'app: calendario, elenco, importazione, avvisi. */
(function () {
  'use strict';

  const { Core, Parser, Scanner, ICS } = window;
  const { DB, CATEGORIES } = Core;

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    settings: null,
    events: [],
    view: 'calendar',
    month: null,           // { y, m } m = 0..11
    selectedDay: null,     // 'YYYY-MM-DD'
    listFilter: 'mine',
    search: '',
    candidates: [],
    editing: null,         // evento in modifica
    evOffsets: [],
    evMode: 'both',
    alertQueue: [],
    alertEventId: null,
    swReg: null,
    installPrompt: null
  };

  /* ---------- Avvio ---------- */

  async function init() {
    state.settings = await Core.loadSettings();
    if (!state.settings.schoolYear) {
      state.settings.schoolYear = Core.currentSchoolYear();
      await saveSettings();
    }
    state.events = await DB.allEvents();
    resetMonthToToday();
    buildYearSelect();
    buildCategorySelect();
    bindEvents();
    renderAll();
    registerSW();
    checkReminders();
    setInterval(checkReminders, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });
    handleHash();
  }

  const saveSettings = () => DB.set('settings', state.settings);
  const year = () => state.settings.schoolYear;
  const yearEvents = () => state.events.filter(ev => Core.inYear(ev, year()));

  function resetMonthToToday() {
    const r = Core.schoolYearRange(year());
    const today = Core.ymd(new Date());
    const day = today >= r.from && today <= r.to ? today : r.from;
    const d = Core.toDate(day);
    state.month = { y: d.getFullYear(), m: d.getMonth() };
    state.selectedDay = day;
  }

  function buildYearSelect() {
    const sel = $('#yearSelect');
    const now = Core.currentSchoolYear();
    const years = new Set([now - 1, now, now + 1, now + 2, year()]);
    state.events.forEach(ev => years.add(Core.currentSchoolYear(Core.toDate(ev.date))));
    sel.innerHTML = Array.from(years).sort().map(y =>
      `<option value="${y}" ${y === year() ? 'selected' : ''}>${Core.yearLabel(y)}</option>`).join('');
  }

  function buildCategorySelect() {
    $('#categorySelect').innerHTML = Object.entries(CATEGORIES)
      .map(([k, c]) => `<option value="${k}">${c.label}</option>`).join('');
  }

  /* ---------- Render ---------- */

  function renderAll() {
    $('#yearLabel').textContent = 'Anno scolastico ' + Core.yearLabel(year());
    $$('[data-year-label]').forEach(el => { el.textContent = Core.yearLabel(year()); });
    renderCalendar();
    renderDay();
    renderAgenda();
    renderSettings();
    renderNotifBanner();
  }

  function eventsOnDay(day) {
    return yearEvents().filter(ev => Core.coversDay(ev, day))
      .sort((a, b) => (b.mine - a.mine) || (a.time || '').localeCompare(b.time || ''));
  }

  function renderCalendar() {
    const { y, m } = state.month;
    const title = Core.fmtMonth.format(new Date(y, m, 1));
    $('#monthTitle').textContent = title.charAt(0).toUpperCase() + title.slice(1);

    const r = Core.schoolYearRange(year());
    const first = `${y}-${Core.pad(m + 1)}-01`;
    $('#prevMonth').disabled = first <= r.from;
    $('#nextMonth').disabled = first >= `${year() + 1}-08-01`;

    const startOffset = (new Date(y, m, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = Core.ymd(new Date());
    let html = '';
    for (let i = 0; i < startOffset; i++) html += '<span class="cell empty"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const day = `${y}-${Core.pad(m + 1)}-${Core.pad(d)}`;
      const evs = eventsOnDay(day);
      const holiday = evs.some(ev => ev.category === 'vacanze');
      const weekend = ((startOffset + d - 1) % 7) >= 5;
      const cls = ['cell',
        day === today && 'today',
        day === state.selectedDay && 'selected',
        holiday && 'holiday',
        weekend && 'weekend',
        evs.some(ev => ev.mine) && 'has-mine'].filter(Boolean).join(' ');
      const dots = evs.slice(0, 4).map(ev =>
        `<i class="dot ${ev.mine ? 'mine' : ''}" style="--c:${(CATEGORIES[ev.category] || CATEGORIES.altro).color}"></i>`).join('');
      const label = `${Core.formatDay(day, true)}${evs.length ? ', ' + evs.length + ' impegni' : ''}`;
      html += `<button class="${cls}" data-day="${day}" aria-label="${esc(label)}"><span class="num">${d}</span><span class="dots">${dots}</span></button>`;
    }
    $('#monthGrid').innerHTML = html;

    const usedCats = new Set(yearEvents().map(ev => ev.category));
    $('#legend').innerHTML = Object.entries(CATEGORIES).filter(([k]) => usedCats.has(k))
      .map(([, c]) => `<span><i class="dot mine" style="--c:${c.color}"></i>${c.label}</span>`).join('');
  }

  function renderDay() {
    const day = state.selectedDay;
    const t = Core.formatDay(day, true);
    $('#dayTitle').textContent = t.charAt(0).toUpperCase() + t.slice(1);
    const evs = eventsOnDay(day);
    $('#dayList').innerHTML = evs.length ? evs.map(eventItem).join('')
      : '<p class="empty-state">Nessun impegno in questo giorno.</p>';
  }

  function eventItem(ev) {
    const cat = CATEGORIES[ev.category] || CATEGORIES.altro;
    const plan = Core.reminderPlan(ev, state.settings);
    const bell = ev.mine && plan.offsets.length
      ? `<span class="bell" title="${esc(plan.offsets.map(Core.describeOffset).join(', '))}">
           <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>
           ${esc(plan.offsets.slice().sort((a, b) => b - a).map(Core.shortOffset).join(' · '))}
         </span>` : '';
    return `<article class="ev ${ev.mine ? 'is-mine' : ''}" data-id="${ev.id}" style="--c:${cat.color}">
      <label class="check" title="${ev.mine ? 'Mio impegno' : 'Segna come mio impegno'}">
        <input type="checkbox" data-toggle-mine="${ev.id}" ${ev.mine ? 'checked' : ''} aria-label="Mio impegno: ${esc(ev.title)}">
        <span></span>
      </label>
      <button class="ev-body" data-edit="${ev.id}">
        <span class="ev-title">${esc(ev.title)}</span>
        <span class="ev-meta">${esc(Core.formatWhen(ev))}</span>
        <span class="ev-cat">${esc(cat.label)}</span>
      </button>
      ${bell}
    </article>`;
  }

  function renderAgenda() {
    const today = Core.ymd(new Date());
    const q = state.search.trim().toLowerCase();
    let list = yearEvents();
    if (state.listFilter === 'mine') list = list.filter(ev => ev.mine);
    if (state.listFilter === 'upcoming') list = list.filter(ev => ev.mine && (ev.endDate || ev.date) >= today);
    if (q) list = list.filter(ev => (ev.title + ' ' + (ev.notes || '')).toLowerCase().includes(q));
    list.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));

    $$('#listFilter .chip').forEach(c => c.classList.toggle('active', c.dataset.filter === state.listFilter));

    if (!list.length) {
      const msg = state.listFilter === 'all' && !q
        ? 'Il calendario è vuoto. Importa il calendario ufficiale o aggiungi un impegno con il pulsante +.'
        : q ? 'Nessun impegno trovato.'
        : 'Nessun impegno spuntato. Spunta i tuoi impegni nel calendario o importa il calendario ufficiale.';
      $('#agenda').innerHTML = `<p class="empty-state">${msg}</p>`;
      return;
    }
    let html = '', curMonth = '';
    for (const ev of list) {
      const mk = ev.date.slice(0, 7);
      if (mk !== curMonth) {
        if (curMonth) html += '</div>';
        curMonth = mk;
        const t = Core.fmtMonth.format(Core.toDate(ev.date));
        html += `<h3 class="month-head">${t.charAt(0).toUpperCase() + t.slice(1)}</h3><div class="ev-list">`;
      }
      html += eventItem(ev);
    }
    $('#agenda').innerHTML = html + '</div>';
  }

  function offsetChips(container, selected, extra) {
    const all = Array.from(new Set([...Core.PRESET_OFFSETS, ...selected, ...(extra || [])])).sort((a, b) => a - b);
    container.innerHTML = all.map(min =>
      `<button type="button" class="chip ${selected.includes(min) ? 'active' : ''}" data-offset="${min}" aria-pressed="${selected.includes(min)}">${Core.describeOffset(min)}</button>`).join('');
  }

  function renderSettings() {
    const s = state.settings;
    offsetChips($('#offsetChips'), s.offsets);
    $$('#modeSeg button').forEach(b => { const on = b.dataset.mode === s.mode; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    $('#setSound').checked = s.sound;
    $('#setVibrate').checked = s.vibrate;
    $('#setDefaultTime').value = s.defaultTime;
    $('#setSummary').checked = s.summary.enabled;
    $('#setSummaryTime').value = s.summary.time;
    $('#setSummaryTime').disabled = !s.summary.enabled;
    $('#keepUnchecked').checked = s.keepUnchecked;

    const perm = notifPermission();
    const pill = $('#permStatus');
    const labels = { granted: 'Notifiche attive', denied: 'Notifiche bloccate', default: 'Notifiche non attive', unsupported: 'Notifiche non supportate' };
    pill.textContent = labels[perm];
    pill.className = 'pill ' + (perm === 'granted' ? 'ok' : perm === 'denied' ? 'bad' : '');
    $('#permBtn').hidden = perm !== 'default';
    const hints = {
      denied: 'Le notifiche sono bloccate: riattivale dalle impostazioni del browser o del telefono per questo sito/app.',
      unsupported: isIOS()
        ? 'Su iPhone e iPad le notifiche funzionano dopo aver aggiunto l\'app alla schermata Home (Condividi → Aggiungi alla schermata Home).'
        : 'Questo browser non supporta le notifiche: verranno mostrati gli avvisi nell\'app.',
      granted: 'Gli avvisi arrivano mentre l\'app è aperta o in background. Per avvisi garantiti anche ad app chiusa usa “Aggiungi al calendario”.',
      default: ''
    };
    $('#permHint').textContent = hints[perm];
  }

  function renderNotifBanner() {
    const wantsSystem = state.settings.mode !== 'app';
    const hasMine = state.events.some(ev => ev.mine);
    $('#notifBanner').hidden = !(wantsSystem && hasMine && notifPermission() === 'default');
  }

  function showView(view) {
    state.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tab').forEach(t => { const on = t.dataset.view === view; t.classList.toggle('active', on); t.setAttribute('aria-current', on ? 'page' : 'false'); });
    $('.fab').hidden = view === 'import' || view === 'settings';
    window.scrollTo({ top: 0 });
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3000);
  }

  /* ---------- Impegni ---------- */

  async function saveEvent(ev) {
    ev.updatedAt = Date.now();
    await DB.putEvent(ev);
    const i = state.events.findIndex(e => e.id === ev.id);
    if (i >= 0) state.events[i] = ev; else state.events.push(ev);
  }

  async function toggleMine(id, on) {
    const ev = state.events.find(e => e.id === id);
    if (!ev) return;
    ev.mine = on;
    await saveEvent(ev);
    renderAll();
    toast(on ? 'Aggiunto ai tuoi impegni: riceverai gli avvisi' : 'Rimosso dai tuoi impegni');
    if (on && state.settings.mode !== 'app' && notifPermission() === 'default') requestNotifications();
  }

  function openEventDialog(ev, day) {
    const isNew = !ev;
    const r = Core.schoolYearRange(year());
    state.editing = ev || null;
    const f = $('#eventForm');
    f.reset();
    $('#eventDialogTitle').textContent = isNew ? 'Nuovo impegno' : 'Modifica impegno';
    $('#deleteEventBtn').hidden = isNew;
    f.title.value = ev ? ev.title : '';
    f.date.value = ev ? ev.date : (day || state.selectedDay);
    f.endDate.value = ev && ev.endDate ? ev.endDate : '';
    f.time.value = ev && ev.time ? ev.time : '';
    f.endTime.value = ev && ev.endTime ? ev.endTime : '';
    f.category.value = ev ? ev.category : 'altro';
    f.notes.value = ev && ev.notes ? ev.notes : '';
    f.mine.checked = ev ? ev.mine : true;
    f.date.min = f.endDate.min = r.from;
    f.date.max = f.endDate.max = r.to;
    const custom = !!(ev && ev.customReminders);
    f.remMode.value = custom ? 'custom' : 'default';
    state.evOffsets = custom ? ev.reminders.slice() : state.settings.offsets.slice();
    state.evMode = custom ? ev.mode : state.settings.mode;
    $('#defaultsPreview').textContent = '(' + (state.settings.offsets.length
      ? state.settings.offsets.slice().sort((a, b) => b - a).map(Core.describeOffset).join(', ').toLowerCase()
      : 'nessun avviso') + ')';
    syncReminderBox();
    $('#eventDialog').showModal();
    if (isNew) setTimeout(() => f.title.focus(), 50);
  }

  function syncReminderBox() {
    const f = $('#eventForm');
    $('#reminderBox').disabled = !f.mine.checked;
    $('#reminderBox').classList.toggle('off', !f.mine.checked);
    $('#customReminders').hidden = f.remMode.value !== 'custom';
    offsetChips($('#evOffsetChips'), state.evOffsets);
    $$('#evModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === state.evMode));
  }

  async function submitEvent(e) {
    e.preventDefault();
    const f = $('#eventForm');
    const title = f.title.value.trim();
    if (!title) { f.title.focus(); return; }
    let endDate = f.endDate.value || null;
    if (endDate && endDate <= f.date.value) endDate = null;
    const ev = Object.assign(state.editing || { id: Core.uid(), source: 'manuale', createdAt: Date.now() }, {
      title,
      date: f.date.value,
      endDate,
      time: f.time.value || null,
      endTime: f.time.value && f.endTime.value ? f.endTime.value : null,
      category: f.category.value,
      notes: f.notes.value.trim(),
      mine: f.mine.checked,
      customReminders: f.remMode.value === 'custom',
      reminders: f.remMode.value === 'custom' ? state.evOffsets.slice() : [],
      mode: f.remMode.value === 'custom' ? state.evMode : null
    });
    await saveEvent(ev);
    $('#eventDialog').close();
    state.selectedDay = ev.date;
    const d = Core.toDate(ev.date);
    state.month = { y: d.getFullYear(), m: d.getMonth() };
    renderAll();
    toast('Impegno salvato');
    if (ev.mine && state.settings.mode !== 'app' && notifPermission() === 'default') requestNotifications();
  }

  async function deleteEditing() {
    const ev = state.editing;
    if (!ev || !confirm(`Eliminare “${ev.title}”?`)) return;
    await DB.deleteEvent(ev.id);
    state.events = state.events.filter(e => e.id !== ev.id);
    $('#eventDialog').close();
    renderAll();
    toast('Impegno eliminato');
  }

  /* ---------- Importazione ---------- */

  async function handleFile(file) {
    if (!file) return;
    const bar = $('#scanProgress');
    const fill = $('#progressFill');
    const text = $('#progressText');
    bar.hidden = false;
    bar.classList.add('indeterminate');
    fill.style.width = '0%';
    $('#reviewCard').hidden = true;
    const onProgress = (fraction, msg) => {
      if (msg) text.textContent = msg;
      if (fraction == null) bar.classList.add('indeterminate');
      else { bar.classList.remove('indeterminate'); fill.style.width = Math.round(fraction * 100) + '%'; }
    };
    try {
      const raw = await Scanner.scan(file, onProgress);
      $('#rawText').value = raw;
      bar.hidden = true;
      analyze(raw);
    } catch (err) {
      console.error(err);
      bar.classList.remove('indeterminate');
      text.textContent = 'Errore: ' + (err && err.message ? err.message : err);
    }
  }

  function analyze(raw) {
    const { candidates, ignored } = Parser.parse(raw, year());
    state.candidates = candidates.map(c => Object.assign({ id: Core.uid(), checked: false }, c));
    const card = $('#reviewCard');
    card.hidden = false;
    let summary = candidates.length
      ? `Ho trovato ${candidates.length} date per l'anno ${Core.yearLabel(year())}. Spunta quelle che ti riguardano: riceverai gli avvisi.`
      : `Non ho trovato date per l'anno ${Core.yearLabel(year())}. Controlla il testo riconosciuto qui sotto, correggilo e premi “Analizza”.`;
    if (ignored) summary += ` (${ignored} date fuori dall'anno scolastico ignorate)`;
    $('#reviewSummary').textContent = summary;
    if (!candidates.length) $('details.raw').open = true;
    renderCandidates();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCandidates() {
    const r = Core.schoolYearRange(year());
    const catOptions = sel => Object.entries(CATEGORIES)
      .map(([k, c]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${c.label}</option>`).join('');
    $('#candidateList').innerHTML = state.candidates.map(c => `
      <div class="cand ${c.checked ? 'checked' : ''}" data-cid="${c.id}" style="--c:${(CATEGORIES[c.category] || CATEGORIES.altro).color}">
        <label class="check"><input type="checkbox" data-cfield="checked" ${c.checked ? 'checked' : ''} aria-label="Mio impegno"><span></span></label>
        <div class="cand-fields">
          <input class="cand-title" data-cfield="title" value="${esc(c.title)}" aria-label="Titolo">
          <div class="cand-row">
            <input type="date" data-cfield="date" value="${c.date}" min="${r.from}" max="${r.to}" aria-label="Giorno">
            ${c.endDate ? `<span class="muted">→</span><input type="date" data-cfield="endDate" value="${c.endDate}" min="${r.from}" max="${r.to}" aria-label="Fino al">` : ''}
            <input type="time" data-cfield="time" value="${c.time || ''}" aria-label="Ora">
            <select data-cfield="category" aria-label="Categoria">${catOptions(c.category)}</select>
          </div>
        </div>
        <button class="icon-btn small" data-remove-cand="${c.id}" aria-label="Rimuovi">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>`).join('');
    updateSaveImportLabel();
  }

  function updateSaveImportLabel() {
    const n = state.candidates.filter(c => c.checked).length;
    $('#saveImportBtn').textContent = n ? `Salva (${n} spuntati)` : 'Salva nel calendario';
  }

  async function saveImport() {
    const keep = $('#keepUnchecked').checked;
    const toSave = state.candidates.filter(c => c.checked || keep);
    if (!toSave.length) { toast('Spunta almeno un impegno'); return; }
    const now = Date.now();
    const evs = toSave.map(c => ({
      id: Core.uid(), title: c.title.trim() || 'Impegno', date: c.date,
      endDate: c.endDate && c.endDate > c.date ? c.endDate : null,
      time: c.time || null, endTime: c.time ? c.endTime || null : null,
      category: c.category, notes: '', mine: c.checked, source: 'importato',
      customReminders: false, reminders: [], mode: null, createdAt: now, updatedAt: now
    }));
    // non duplicare impegni già presenti (stessa data, ora e titolo)
    const key = ev => [ev.date, ev.time || '', ev.title.toLowerCase()].join('|');
    const existing = new Map(state.events.map(ev => [key(ev), ev]));
    const fresh = [];
    for (const ev of evs) {
      const old = existing.get(key(ev));
      if (old) { if (ev.mine && !old.mine) { old.mine = true; old.updatedAt = now; fresh.push(old); } }
      else fresh.push(ev);
    }
    await DB.putEvents(fresh);
    const ids = new Set(fresh.map(e => e.id));
    state.events = state.events.filter(e => !ids.has(e.id)).concat(fresh);
    state.settings.keepUnchecked = keep;
    await saveSettings();
    state.candidates = [];
    $('#reviewCard').hidden = true;
    renderAll();
    const mine = evs.filter(e => e.mine).length;
    toast(`Salvati ${fresh.length} impegni${mine ? `, ${mine} tuoi con avvisi` : ''}`);
    state.listFilter = mine ? 'mine' : 'all';
    renderAgenda();
    showView('list');
    if (mine && state.settings.mode !== 'app' && notifPermission() === 'default') requestNotifications();
  }

  /* ---------- Notifiche e avvisi ---------- */

  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }

  function notifPermission() {
    return 'Notification' in window ? Notification.permission : 'unsupported';
  }

  async function requestNotifications() {
    if (!('Notification' in window)) { renderSettings(); toast('Notifiche non supportate su questo dispositivo'); return; }
    const res = await Notification.requestPermission();
    renderAll();
    if (res === 'granted') { toast('Notifiche attivate'); registerPeriodicSync(); }
  }

  async function checkReminders() {
    if (checkReminders.busy) return;
    checkReminders.busy = true;
    try {
      const due = await Core.dueReminders(state.events, state.settings, Date.now());
      for (const r of due) {
        await DB.markFired(r.key);
        await fireReminder(r);
      }
    } catch (err) {
      console.error(err);
    } finally {
      checkReminders.busy = false;
    }
  }

  async function fireReminder(r) {
    const { title, body } = Core.messageOf(r, Date.now());
    const eventId = r.summary ? r.eventId : r.event.id;
    const wantSystem = r.mode !== 'app';
    const wantApp = r.mode !== 'system';
    let shownSystem = false;
    if (wantSystem && notifPermission() === 'granted') {
      shownSystem = await showSystemNotification(title, body, r.key, eventId);
    }
    // se la notifica di sistema non è disponibile, l'avviso compare comunque nell'app
    if (wantApp || !shownSystem) inAppAlert(title, body, eventId);
  }

  async function showSystemNotification(title, body, tag, eventId) {
    const opts = {
      body, tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
      data: { eventId }, renotify: true,
      silent: !state.settings.sound,
      vibrate: state.settings.vibrate ? [200, 100, 200] : undefined
    };
    try {
      const reg = state.swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
      if (reg) { await reg.showNotification(title, opts); return true; }
      new Notification(title, opts);
      return true;
    } catch (err) {
      console.warn('Notifica non mostrata', err);
      return false;
    }
  }

  function inAppAlert(title, body, eventId) {
    state.alertQueue.push({ title, body, eventId });
    if ($('#alertLayer').hidden) nextAlert();
  }

  function nextAlert() {
    const a = state.alertQueue.shift();
    if (!a) { $('#alertLayer').hidden = true; return; }
    state.alertEventId = a.eventId;
    $('#alertTitle').textContent = a.title;
    $('#alertBody').textContent = a.body;
    $('#alertLayer').hidden = false;
    $('#alertLayer .btn:not(.ghost)').focus();
    if (state.settings.sound) beep();
    if (state.settings.vibrate && navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }

  let audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime;
      [880, 1175].forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.35);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + i * 0.18);
        o.stop(t + i * 0.18 + 0.4);
      });
    } catch (e) { /* audio non disponibile */ }
  }

  async function testAlert() {
    const mode = state.settings.mode;
    if (mode !== 'app' && notifPermission() === 'default') await requestNotifications();
    const title = 'Prova avviso';
    const body = 'Così vedrai gli avvisi dei tuoi impegni scolastici.';
    let shown = false;
    if (mode !== 'app' && notifPermission() === 'granted') shown = await showSystemNotification(title, body, 'test', null);
    if (mode !== 'system' || !shown) inAppAlert(title, body, null);
  }

  /* ---------- Service worker e installazione ---------- */

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      state.swReg = await navigator.serviceWorker.register('sw.js');
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data && e.data.type === 'open-event') openEventById(e.data.eventId);
      });
      registerPeriodicSync();
    } catch (err) {
      console.warn('Service worker non registrato', err);
    }
  }

  /* Su Android (app installata) il browser può controllare gli avvisi anche ad app chiusa. */
  async function registerPeriodicSync() {
    try {
      const reg = state.swReg || await navigator.serviceWorker.ready;
      if (!reg || !('periodicSync' in reg)) return;
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state === 'granted') await reg.periodicSync.register('check-reminders', { minInterval: 15 * 60 * 1000 });
    } catch (e) { /* non supportato */ }
  }

  function openEventById(id) {
    const ev = state.events.find(e => e.id === id);
    if (!ev) return;
    state.selectedDay = ev.date;
    const d = Core.toDate(ev.date);
    state.month = { y: d.getFullYear(), m: d.getMonth() };
    if (!Core.inYear(ev, year())) changeYear(Core.currentSchoolYear(d));
    showView('calendar');
    renderAll();
    openEventDialog(ev);
  }

  function handleHash() {
    const m = location.hash.match(/event=([\w-]+)/);
    const v = location.hash.match(/view=(\w+)/);
    if (m || v) history.replaceState(null, '', location.pathname);
    if (m) openEventById(m[1]);
    else if (v && $('#view-' + v[1])) showView(v[1]);
  }

  async function changeYear(y) {
    state.settings.schoolYear = y;
    await saveSettings();
    resetMonthToToday();
    buildYearSelect();
    renderAll();
    if (state.candidates.length) toast('Anno cambiato: rianalizza il testo per aggiornare le date');
  }

  /* ---------- Backup ---------- */

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function exportIcs() {
    const mine = yearEvents().filter(ev => ev.mine);
    if (!mine.length) { toast('Spunta prima i tuoi impegni'); return; }
    const ics = ICS.build(mine, state.settings);
    const name = `impegni-scolastici-${Core.yearLabel(year()).replace('/', '-')}.ics`;
    const file = new File([ics], name, { type: 'text/calendar' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Impegni scolastici' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    download(name, ics, 'text/calendar');
    toast('File .ics scaricato: aprilo per aggiungerlo al calendario');
  }

  async function exportBackup() {
    const data = { app: 'calendario-impegni-scolastici', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, events: state.events };
    download(`backup-impegni-scolastici-${Core.ymd(new Date())}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'calendario-impegni-scolastici' || !Array.isArray(data.events)) throw new Error('File non valido');
      if (!confirm(`Ripristinare ${data.events.length} impegni dal backup? Gli impegni con lo stesso identificativo verranno sostituiti.`)) return;
      await DB.putEvents(data.events);
      if (data.settings) { state.settings = Object.assign(state.settings, data.settings); await saveSettings(); }
      state.events = await DB.allEvents();
      buildYearSelect();
      resetMonthToToday();
      renderAll();
      toast('Backup ripristinato');
    } catch (err) {
      alert('Impossibile ripristinare il backup: ' + err.message);
    }
  }

  async function clearYear() {
    const ids = yearEvents().map(ev => ev.id);
    if (!ids.length) { toast('Nessun impegno in questo anno'); return; }
    if (!confirm(`Eliminare tutti i ${ids.length} impegni dell'anno ${Core.yearLabel(year())}?`)) return;
    await DB.deleteEvents(ids);
    const set = new Set(ids);
    state.events = state.events.filter(ev => !set.has(ev.id));
    renderAll();
    toast('Anno svuotato');
  }

  /* ---------- Eventi UI ---------- */

  function toggleOffset(list, min) {
    const i = list.indexOf(min);
    if (i >= 0) list.splice(i, 1); else list.push(min);
    list.sort((a, b) => a - b);
  }

  function bindEvents() {
    $('#yearSelect').addEventListener('change', e => changeYear(Number(e.target.value)));

    $$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

    $('#prevMonth').addEventListener('click', () => moveMonth(-1));
    $('#nextMonth').addEventListener('click', () => moveMonth(1));
    let touchX = null;
    $('#monthGrid').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
    $('#monthGrid').addEventListener('touchend', e => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 60) moveMonth(dx < 0 ? 1 : -1);
      touchX = null;
    });

    $('#monthGrid').addEventListener('click', e => {
      const cell = e.target.closest('[data-day]');
      if (!cell) return;
      state.selectedDay = cell.dataset.day;
      renderCalendar();
      renderDay();
      if (window.innerWidth < 900) $('.day-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // elenchi di impegni: spunta e modifica
    document.addEventListener('change', e => {
      const id = e.target.dataset.toggleMine;
      if (id) toggleMine(id, e.target.checked);
    });
    document.addEventListener('click', e => {
      const edit = e.target.closest('[data-edit]');
      if (edit) openEventDialog(state.events.find(ev => ev.id === edit.dataset.edit));
    });

    $('#listFilter').addEventListener('click', e => {
      const chip = e.target.closest('[data-filter]');
      if (!chip) return;
      state.listFilter = chip.dataset.filter;
      renderAgenda();
    });
    $('#searchInput').addEventListener('input', e => { state.search = e.target.value; renderAgenda(); });

    // azioni generiche
    const actions = {
      'add-event': () => openEventDialog(null),
      'add-on-day': () => openEventDialog(null, state.selectedDay),
      'close-dialog': () => $('#eventDialog').close(),
      'delete-event': deleteEditing,
      'enable-notifications': requestNotifications,
      'test-alert': testAlert,
      'alert-ok': nextAlert,
      'alert-open': () => { const id = state.alertEventId; nextAlert(); if (id) openEventById(id); },
      'check-all': () => { state.candidates.forEach(c => { c.checked = true; }); renderCandidates(); },
      'check-none': () => { state.candidates.forEach(c => { c.checked = false; }); renderCandidates(); },
      'cancel-import': () => { state.candidates = []; $('#reviewCard').hidden = true; },
      'save-import': saveImport,
      'analyze-text': () => { const t = $('#rawText').value.trim(); if (t) analyze(t); else toast('Incolla prima il testo del calendario'); },
      'export-ics': exportIcs,
      'export-backup': exportBackup,
      'clear-year': clearYear,
      'add-custom-offset': async () => {
        const min = Number($('#customOffsetN').value) * Number($('#customOffsetU').value);
        if (!(min > 0)) return;
        if (!state.settings.offsets.includes(min)) toggleOffset(state.settings.offsets, min);
        await saveSettings();
        renderAll();
      },
      'add-ev-offset': () => {
        const min = Number($('#evCustomN').value) * Number($('#evCustomU').value);
        if (min > 0 && !state.evOffsets.includes(min)) toggleOffset(state.evOffsets, min);
        syncReminderBox();
      }
    };
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (btn && actions[btn.dataset.action]) { e.preventDefault(); actions[btn.dataset.action](); }
    });

    // impostazioni avvisi
    $('#offsetChips').addEventListener('click', async e => {
      const chip = e.target.closest('[data-offset]');
      if (!chip) return;
      toggleOffset(state.settings.offsets, Number(chip.dataset.offset));
      await saveSettings();
      renderAll();
    });
    $('#modeSeg').addEventListener('click', async e => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      state.settings.mode = b.dataset.mode;
      await saveSettings();
      renderAll();
      if (b.dataset.mode !== 'app' && notifPermission() === 'default') requestNotifications();
    });
    const bindSetting = (sel, apply) => $(sel).addEventListener('change', async e => { apply(e.target); await saveSettings(); renderAll(); });
    bindSetting('#setSound', el => { state.settings.sound = el.checked; });
    bindSetting('#setVibrate', el => { state.settings.vibrate = el.checked; });
    bindSetting('#setDefaultTime', el => { if (el.value) state.settings.defaultTime = el.value; });
    bindSetting('#setSummary', el => { state.settings.summary.enabled = el.checked; });
    bindSetting('#setSummaryTime', el => { if (el.value) state.settings.summary.time = el.value; });

    // dialog impegno
    $('#eventForm').addEventListener('submit', submitEvent);
    $('#eventForm').addEventListener('change', e => {
      if (e.target.name === 'mine' || e.target.name === 'remMode') syncReminderBox();
    });
    $('#evOffsetChips').addEventListener('click', e => {
      const chip = e.target.closest('[data-offset]');
      if (!chip) return;
      toggleOffset(state.evOffsets, Number(chip.dataset.offset));
      syncReminderBox();
    });
    $('#evModeSeg').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      state.evMode = b.dataset.mode;
      syncReminderBox();
    });
    $('#eventDialog').addEventListener('click', e => { if (e.target.id === 'eventDialog') e.target.close(); });

    // importazione
    $('#fileInput').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
    $('#cameraInput').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
    const dz = $('#dropzone');
    ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));

    $('#candidateList').addEventListener('input', e => {
      const row = e.target.closest('[data-cid]');
      const field = e.target.dataset.cfield;
      if (!row || !field) return;
      const c = state.candidates.find(x => x.id === row.dataset.cid);
      c[field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (field === 'checked') { row.classList.toggle('checked', c.checked); updateSaveImportLabel(); }
      if (field === 'category') row.style.setProperty('--c', (CATEGORIES[c.category] || CATEGORIES.altro).color);
    });
    $('#candidateList').addEventListener('click', e => {
      const rm = e.target.closest('[data-remove-cand]');
      if (!rm) return;
      state.candidates = state.candidates.filter(c => c.id !== rm.dataset.removeCand);
      renderCandidates();
    });

    $('#backupInput').addEventListener('change', e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });

    // installazione
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      state.installPrompt = e;
      $('#installBtn').hidden = false;
    });
    $('#installBtn').addEventListener('click', async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      $('#installBtn').hidden = true;
    });
    window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('App installata'); });
    window.addEventListener('hashchange', handleHash);
  }

  function moveMonth(delta) {
    const r = Core.schoolYearRange(year());
    const d = new Date(state.month.y, state.month.m + delta, 1);
    const first = Core.ymd(d);
    if (first < r.from || first > r.to) return;
    state.month = { y: d.getFullYear(), m: d.getMonth() };
    const sel = Core.toDate(state.selectedDay);
    if (sel.getFullYear() !== state.month.y || sel.getMonth() !== state.month.m) state.selectedDay = first;
    renderCalendar();
    renderDay();
  }

  init();
})();
