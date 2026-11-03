/* ics.js — esporta gli impegni in formato iCalendar (.ics) con gli avvisi (VALARM),
   così il calendario del dispositivo avvisa anche quando l'app è chiusa. */
(function (root) {
  'use strict';

  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const compact = d => d.replace(/-/g, '');
  const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

  /* Le righe più lunghe di 75 caratteri vanno spezzate (RFC 5545). */
  function fold(line) {
    const out = [];
    while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
    out.push(line);
    return out.join('\r\n');
  }

  function trigger(minutes) {
    return (minutes < 0 ? '' : '-') + 'PT' + Math.abs(minutes) + 'M';
  }

  function build(events, settings) {
    const { Core } = root;
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendario Impegni Scolastici//IT',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:Impegni scolastici ' + Core.yearLabel(settings.schoolYear)
    ];
    const [dh, dm] = settings.defaultTime.split(':').map(Number);
    const defaultMinutes = dh * 60 + dm;

    for (const ev of events) {
      const plan = Core.reminderPlan(ev, settings);
      const cat = (Core.CATEGORIES[ev.category] || Core.CATEGORIES.altro).label;
      lines.push('BEGIN:VEVENT', `UID:${ev.id}@calendario-impegni-scolastici`, `DTSTAMP:${stamp()}`);
      if (ev.time) {
        lines.push(`DTSTART:${compact(ev.date)}T${ev.time.replace(':', '')}00`);
        const endDay = ev.endDate || ev.date;
        const endTime = ev.endTime || ev.time;
        lines.push(`DTEND:${compact(endDay)}T${endTime.replace(':', '')}00`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${compact(ev.date)}`);
        lines.push(`DTEND;VALUE=DATE:${compact(Core.addDays(ev.endDate || ev.date, 1))}`);
      }
      lines.push(fold('SUMMARY:' + esc(ev.title)), fold('CATEGORIES:' + esc(cat)));
      if (ev.notes) lines.push(fold('DESCRIPTION:' + esc(ev.notes)));
      if (ev.mine && plan.mode !== 'app') {
        for (const min of plan.offsets) {
          // per gli impegni di un giorno intero l'avviso è riferito all'orario predefinito
          const rel = ev.time ? min : min - defaultMinutes;
          lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold('DESCRIPTION:' + esc(ev.title)), `TRIGGER:${trigger(rel)}`, 'END:VALARM');
        }
      }
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  root.ICS = { build };
})(window);
