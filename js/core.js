/* core.js — archivio dati, utilità per le date e calcolo degli avvisi.
   Script classico: viene caricato sia dalla pagina sia dal service worker (importScripts). */
(function (root) {
  'use strict';

  /* ---------- Archivio (IndexedDB) ---------- */

  const DB_NAME = 'calendario-impegni-scolastici';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('fired')) db.createObjectStore('fired');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function run(store, mode, op) {
    dbPromise = dbPromise || openDB();
    return dbPromise.then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = op(t.objectStore(store));
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const DB = {
    allEvents: () => run('events', 'readonly', s => s.getAll()),
    putEvent: ev => run('events', 'readwrite', s => s.put(ev)),
    putEvents: list => run('events', 'readwrite', s => { list.forEach(ev => s.put(ev)); }),
    deleteEvent: id => run('events', 'readwrite', s => s.delete(id)),
    deleteEvents: ids => run('events', 'readwrite', s => { ids.forEach(id => s.delete(id)); }),
    get: key => run('kv', 'readonly', s => s.get(key)),
    set: (key, value) => run('kv', 'readwrite', s => s.put(value, key)),
    isFired: key => run('fired', 'readonly', s => s.get(key)).then(Boolean),
    markFired: key => run('fired', 'readwrite', s => s.put(Date.now(), key))
  };

  /* ---------- Impostazioni ---------- */

  const DEFAULT_SETTINGS = {
    schoolYear: null,          // anno di inizio, es. 2026 per il 2026/2027
    mode: 'both',              // 'system' | 'app' | 'both'
    offsets: [1440, 60],       // minuti prima dell'impegno
    defaultTime: '08:00',      // orario di riferimento per impegni senza ora
    summary: { enabled: true, time: '07:30' },
    sound: true,
    vibrate: true,
    keepUnchecked: true
  };

  async function loadSettings() {
    const saved = await DB.get('settings');
    return Object.assign({}, DEFAULT_SETTINGS, saved || {}, {
      summary: Object.assign({}, DEFAULT_SETTINGS.summary, (saved && saved.summary) || {})
    });
  }

  const CATEGORIES = {
    lezioni:  { label: 'Lezioni',            color: '#3446c8' },
    vacanze:  { label: 'Festività e vacanze', color: '#e0623a' },
    riunioni: { label: 'Riunioni e consigli', color: '#7a4cc2' },
    colloqui: { label: 'Colloqui',           color: '#0f8f84' },
    verifiche:{ label: 'Esami e verifiche',  color: '#c43b6b' },
    uscite:   { label: 'Uscite e gite',      color: '#2f8a3a' },
    altro:    { label: 'Altro',              color: '#6b7280' }
  };

  /* ---------- Date ---------- */

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function toDate(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
  }

  function addDays(dateStr, n) {
    const d = toDate(dateStr);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }

  function currentSchoolYear(now) {
    now = now || new Date();
    return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  }

  function schoolYearRange(startYear) {
    return { from: `${startYear}-09-01`, to: `${startYear + 1}-08-31` };
  }

  const yearLabel = y => `${y}/${y + 1}`;

  function inYear(ev, startYear) {
    const r = schoolYearRange(startYear);
    const end = ev.endDate || ev.date;
    return ev.date <= r.to && end >= r.from;
  }

  function coversDay(ev, day) {
    return ev.date <= day && (ev.endDate || ev.date) >= day;
  }

  const fmtLong = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtMonth = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });

  function formatDay(dateStr, long) {
    return (long ? fmtLong : fmtShort).format(toDate(dateStr));
  }

  function formatWhen(ev) {
    let s = formatDay(ev.date, true);
    if (ev.endDate && ev.endDate !== ev.date) s = `dal ${formatDay(ev.date)} al ${formatDay(ev.endDate)}`;
    if (ev.time) s += ` · ore ${ev.time}${ev.endTime ? '–' + ev.endTime : ''}`;
    return s;
  }

  /* ---------- Avvisi ---------- */

  const PRESET_OFFSETS = [0, 15, 30, 60, 120, 1440, 2880, 10080];

  function describeOffset(min) {
    if (min === 0) return "All'ora dell'impegno";
    if (min % 10080 === 0) { const n = min / 10080; return n === 1 ? '1 settimana prima' : `${n} settimane prima`; }
    if (min % 1440 === 0) { const n = min / 1440; return n === 1 ? '1 giorno prima' : `${n} giorni prima`; }
    if (min % 60 === 0) { const n = min / 60; return n === 1 ? '1 ora prima' : `${n} ore prima`; }
    return `${min} minuti prima`;
  }

  function shortOffset(min) {
    if (min === 0) return "all'ora";
    if (min % 10080 === 0) return `${min / 10080}sett`;
    if (min % 1440 === 0) return `${min / 1440}g`;
    if (min % 60 === 0) return `${min / 60}h`;
    return `${min}m`;
  }

  function reminderPlan(ev, settings) {
    if (ev.customReminders) return { offsets: ev.reminders || [], mode: ev.mode || settings.mode };
    return { offsets: settings.offsets, mode: settings.mode };
  }

  function remindersFor(ev, settings) {
    if (!ev.mine) return [];
    const plan = reminderPlan(ev, settings);
    const start = toDate(ev.date, ev.time || settings.defaultTime).getTime();
    return plan.offsets.map(min => ({
      key: `${ev.id}|${min}|${ev.date}T${ev.time || ''}`,
      at: start - min * 60000,
      minutes: min,
      mode: plan.mode,
      event: ev
    }));
  }

  function relativeLabel(ev, now) {
    const today = ymd(new Date(now));
    const tomorrow = addDays(today, 1);
    let day;
    if (ev.date === today) day = 'Oggi';
    else if (ev.date === tomorrow) day = 'Domani';
    else day = formatDay(ev.date, true).replace(/^./, c => c.toUpperCase());
    return ev.time ? `${day} alle ${ev.time}` : day;
  }

  function reminderMessage(r, now) {
    const ev = r.event;
    const cat = (CATEGORIES[ev.category] || CATEGORIES.altro).label;
    let body = `${relativeLabel(ev, now)} · ${cat}`;
    if (ev.notes) body += `\n${ev.notes}`;
    return { title: ev.title, body };
  }

  const GRACE_MS = 12 * 3600 * 1000;

  /* Avvisi scaduti e non ancora inviati (entro 12 ore dalla scadenza). */
  async function dueReminders(events, settings, now) {
    const out = [];
    for (const ev of events) {
      if (!ev.mine || !inYear(ev, settings.schoolYear)) continue;
      for (const r of remindersFor(ev, settings)) {
        if (r.at > now || r.at < now - GRACE_MS) continue;
        if (ev.updatedAt && r.at < ev.updatedAt) continue; // già passato quando è stato creato/modificato
        if (!(await DB.isFired(r.key))) out.push(r);
      }
    }
    if (settings.summary && settings.summary.enabled) {
      const today = ymd(new Date(now));
      const at = toDate(today, settings.summary.time).getTime();
      const key = `summary|${today}`;
      if (at <= now && at > now - GRACE_MS && !(await DB.isFired(key))) {
        const list = events.filter(ev => ev.mine && coversDay(ev, today))
          .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
        if (list.length) {
          out.push({
            key, at, mode: settings.mode, summary: true, eventId: list[0].id,
            title: list.length === 1 ? 'Oggi hai 1 impegno' : `Oggi hai ${list.length} impegni`,
            body: list.map(ev => (ev.time ? ev.time + ' ' : '') + ev.title).join('\n')
          });
        } else {
          await DB.markFired(key);
        }
      }
    }
    return out;
  }

  function messageOf(r, now) {
    return r.summary ? { title: r.title, body: r.body } : reminderMessage(r, now);
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  root.Core = {
    DB, DEFAULT_SETTINGS, loadSettings, CATEGORIES, PRESET_OFFSETS,
    pad, ymd, toDate, addDays, currentSchoolYear, schoolYearRange, yearLabel, inYear, coversDay,
    formatDay, formatWhen, fmtMonth, describeOffset, shortOffset, reminderPlan, remindersFor,
    dueReminders, messageOf, uid
  };
})(typeof self !== 'undefined' ? self : this);
