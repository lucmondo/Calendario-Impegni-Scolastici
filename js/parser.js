/* parser.js — riconosce date, orari e descrizioni nel testo di un calendario scolastico italiano. */
(function (root) {
  'use strict';

  const MONTH_IDX = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12 };
  const M = "(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|genn?|febb?|mar|apr|magg?|giu|lug|ago|sett?|ott|nov|dic)\\.?(?![a-zà-ù])";
  const WD = "(?:luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|lun|mar|mer|gio|ven|sab|dom)\\.?";
  const SEP = "\\s*(?:-|–|—|al(?:l')?|fino\\s+al(?:l')?)\\s*";

  const RE = {
    rangeText: new RegExp(`\\b(?:dal(?:l')?\\s*|da\\s+)?(?:${WD}\\s+)?(\\d{1,2})(?:\\s+${M}(?:\\s+(\\d{4}))?)?${SEP}(?:${WD}\\s+)?(\\d{1,2})\\s+${M}(?:\\s+(\\d{2,4}))?\\b`, 'gi'),
    rangeNum: new RegExp(`\\b(?:dal(?:l')?\\s*)?(\\d{1,2})[\\/.](\\d{1,2})(?:[\\/.](\\d{2,4}))?${SEP}(\\d{1,2})[\\/.](\\d{1,2})(?:[\\/.](\\d{2,4}))?\\b`, 'gi'),
    listText: new RegExp(`\\b((?:\\d{1,2}\\s*,\\s*)+\\d{1,2}(?:\\s*,?\\s*e\\s+\\d{1,2})?|\\d{1,2}\\s+e\\s+\\d{1,2})\\s+${M}(?:\\s+(\\d{4}))?\\b`, 'gi'),
    singleText: new RegExp(`\\b(?:${WD}\\s+)?(\\d{1,2})\\s+${M}(?:\\s+(\\d{4}))?\\b`, 'gi'),
    singleSlash: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g,
    singleDotDash: /\b(\d{1,2})([.\-])(\d{1,2})\2(\d{2,4})\b/g,
    timeWord: /\b(?:dalle|ore|h|alle)\.?\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:-|–|alle|\/)\s*(?:ore\s*)?(\d{1,2})(?:[:.](\d{2}))?)?\b/gi,
    timePlain: /\b(\d{1,2})[:.](\d{2})(?:\s*(?:-|–|\/)\s*(\d{1,2})[:.](\d{2}))?\b/g,
    monthHeader: new RegExp(`^\\s*(?:mese\\s+di\\s+)?${M}(?:\\s+(\\d{4}))?\\s*$`, 'i'),
    dayLed: new RegExp(`^\\s*(?:${WD}\\s+)?(\\d{1,2})(?:\\s+${WD})?\\s*[-–:.)]?\\s+(.*[a-zà-ù].*)$`, 'i')
  };

  const CATEGORY_RULES = [
    ['verifiche', /esam|prova|prove|invalsi|verific|maturit/],
    ['riunioni', /consigl|collegio|scrutin|riunion|assemble|dipartiment|elezion|organi collegiali/],
    ['colloqui', /colloqu|ricevimento|udienz|incontr\w*\s+(?:con\s+)?(?:i\s+)?genitori/],
    ['uscite', /uscit|gita|viaggi|visita|escursion|teatro|museo/],
    ['vacanze', /vacanz|festa|festivit|sospension|chiusura|ponte|natale|pasqua|carnevale|patrono|ognissanti|immacolata|liberazione|repubblica|lavorator|epifania|defunti|interruzion|non si svolg/],
    ['lezioni', /inizio|fine|termine|lezioni|rientro|apertura|quadrimestre|trimestre|pentamestre/]
  ];

  function guessCategory(text) {
    const t = text.toLowerCase();
    for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
    return 'altro';
  }

  const monthNum = s => MONTH_IDX[s.toLowerCase().replace('.', '').slice(0, 3)];
  const pad = n => String(n).padStart(2, '0');

  function fullYear(y, m, startYear) {
    if (y) { y = Number(y); return y < 100 ? 2000 + y : y; }
    return m >= 9 ? startYear : startYear + 1;
  }

  function makeDate(d, m, y) {
    d = Number(d); m = Number(m);
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function makeRange(d1, m1, y1, d2, m2, y2, startYear) {
    m2 = Number(m2);
    m1 = m1 ? Number(m1) : m2;
    let Y2 = fullYear(y2, m2, startYear);
    let Y1;
    if (y1) Y1 = fullYear(y1, m1, startYear);
    else if (y2) Y1 = m1 > m2 ? Y2 - 1 : Y2;
    else { Y1 = fullYear(null, m1, startYear); Y2 = fullYear(null, m2, startYear); }
    const a = makeDate(d1, m1, Y1), b = makeDate(d2, m2, Y2);
    if (!a || !b || b < a) return null;
    return { date: a, endDate: b === a ? null : b };
  }

  const blank = (s, from, to) => s.slice(0, from) + ' '.repeat(to - from) + s.slice(to);

  function findDates(line, startYear) {
    let work = line;
    const found = [];
    const take = (re, build) => {
      re.lastIndex = 0;
      const hits = [];
      let m;
      while ((m = re.exec(work))) hits.push(m);
      for (const h of hits) {
        const res = build(h);
        if (!res) continue;
        (Array.isArray(res) ? res : [res]).forEach(r => found.push(Object.assign({ pos: h.index }, r)));
        work = blank(work, h.index, h.index + h[0].length);
      }
    };

    take(RE.rangeText, h => makeRange(h[1], h[2] && monthNum(h[2]), h[3], h[4], monthNum(h[5]), h[6], startYear));
    take(RE.rangeNum, h => makeRange(h[1], h[2], h[3], h[4], h[5], h[6], startYear));
    take(RE.listText, h => {
      const m = monthNum(h[2]);
      const y = fullYear(h[3], m, startYear);
      const out = h[1].split(/[^\d]+/).filter(Boolean).map(d => makeDate(d, m, y)).filter(Boolean).map(date => ({ date }));
      return out.length ? out : null;
    });
    take(RE.singleText, h => {
      const m = monthNum(h[2]);
      const date = makeDate(h[1], m, fullYear(h[3], m, startYear));
      return date && { date };
    });
    take(RE.singleSlash, h => {
      const date = makeDate(h[1], h[2], fullYear(h[3], Number(h[2]), startYear));
      return date && { date };
    });
    take(RE.singleDotDash, h => {
      const date = makeDate(h[1], h[3], fullYear(h[4], Number(h[3]), startYear));
      return date && { date };
    });

    found.sort((a, b) => a.pos - b.pos);
    return { found, rest: work };
  }

  function findTime(text) {
    let work = text;
    let time = null, endTime = null;
    const fmt = (h, m) => {
      h = Number(h); m = Number(m || 0);
      return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null;
    };
    for (const re of [RE.timeWord, RE.timePlain]) {
      re.lastIndex = 0;
      let m;
      const hits = [];
      while ((m = re.exec(work))) hits.push(m);
      for (const h of hits) {
        const t = fmt(h[1], h[2]);
        if (!t) continue;
        if (!time) {
          time = t;
          if (h[3]) endTime = fmt(h[3], h[4]);
        }
        work = blank(work, h.index, h.index + h[0].length);
      }
    }
    return { time, endTime, rest: work };
  }

  const STRIP_HEAD = new RegExp(`^(?:[-–—:;,.|•·*/>)\\]]+|(?:dal|dall'|dalle|al|all'|alle|il|ore|h|e|giorno|${WD})(?![a-zà-ù]))\\s*`, 'i');
  const STRIP_TAIL = /(?:\s*[-–—:;,|•·*/(\[]+|(?:^|\s)(?:dal|al|alle|dalle|ore|e|il|ed)\.?)$/i;

  function cleanTitle(s) {
    let t = s.replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
    let prev;
    do { prev = t; t = t.replace(STRIP_HEAD, '').replace(STRIP_TAIL, '').trim(); } while (t !== prev);
    if (!/[a-zà-ù]{2}/i.test(t)) return '';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function normalize(text) {
    return text
      .replace(/\r/g, '')
      .replace(/[’‘`´]/g, "'")
      .replace(/(\d)\s*[°º]/g, '$1')
      .replace(/\bl[°º]/gi, '1')
      .replace(/[\t ]+/g, ' ');
  }

  /**
   * Analizza il testo e restituisce le date trovate.
   * @param {string} text testo del calendario
   * @param {number} startYear anno di inizio dell'anno scolastico (es. 2026)
   */
  function parse(text, startYear) {
    const lines = normalize(text).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const from = `${startYear}-09-01`, to = `${startYear + 1}-08-31`;
    const out = [];
    let ignored = 0;
    let ctxMonth = null, ctxYear = null;
    let lastText = null;
    const used = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const header = line.match(RE.monthHeader);
      if (header) {
        ctxMonth = monthNum(header[1]);
        ctxYear = fullYear(header[2], ctxMonth, startYear);
        lastText = null;
        continue;
      }

      let { found, rest } = findDates(line, startYear);
      if (!found.length && ctxMonth) {
        const m = line.match(RE.dayLed);
        if (m) {
          const date = makeDate(m[1], ctxMonth, ctxYear);
          if (date) {
            found = [{ date }];
            rest = m[2];
          }
        }
      }

      if (!found.length) {
        lastText = used.has(i) ? null : i;
        continue;
      }

      const { time, endTime, rest: rest2 } = findTime(rest);
      let title = cleanTitle(rest2);
      if (!title) {
        if (lastText !== null && !used.has(lastText)) {
          title = cleanTitle(lines[lastText]);
          used.add(lastText);
        } else if (i + 1 < lines.length && !findDates(lines[i + 1], startYear).found.length && !RE.monthHeader.test(lines[i + 1])) {
          title = cleanTitle(lines[i + 1]);
          used.add(i + 1);
        }
      }
      lastText = null;
      if (!title) title = 'Impegno';

      for (const f of found) {
        const end = f.endDate || f.date;
        if (end < from || f.date > to) { ignored++; continue; }
        out.push({
          date: f.date,
          endDate: f.endDate || null,
          time, endTime,
          title,
          category: guessCategory(title + ' ' + line),
          line
        });
      }
    }

    const seen = new Set();
    const candidates = out.filter(c => {
      const k = [c.date, c.endDate, c.time, c.title.toLowerCase()].join('|');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));

    return { candidates, ignored };
  }

  const Parser = { parse, guessCategory };
  if (typeof module !== 'undefined' && module.exports) module.exports = Parser;
  else root.Parser = Parser;
})(typeof self !== 'undefined' ? self : this);
