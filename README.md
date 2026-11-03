# Calendario Impegni Scolastici

App installabile (PWA) per smartphone e tablet, Android e iPhone/iPad, per gestire gli impegni scolastici dell'anno e ricevere gli avvisi.

## Funzioni

- **Anno scolastico**: lo scegli dal menu in alto (da settembre ad agosto).
- **Importa il calendario ufficiale**: carica il PDF della scuola, una foto o uno screenshot (anche dalla fotocamera).
  Il testo viene letto (i PDF scansionati e le foto passano dal riconoscimento del testo in italiano) e l'app trova
  date, periodi (`dal 23 dicembre al 6 gennaio`), orari (`ore 15:30`, `dalle 16 alle 19`) e descrizioni.
  Puoi correggere il testo riconosciuto o incollarlo a mano.
- **Spunta i tuoi impegni**: solo quelli spuntati generano avvisi. Le altre date restano visibili come riferimento.
- **Impegni a mano**: pulsante **+**, con giorno, ora, periodo, categoria e note.
- **Avvisi a tua scelta**:
  - *come*: notifica di sistema, avviso dentro l'app oppure entrambi, con suono e vibrazione;
  - *quando*: all'ora dell'impegno, 15/30 minuti, 1/2 ore, 1/2 giorni, 1 settimana prima o un anticipo personalizzato;
  - riepilogo del giorno a un orario a scelta;
  - impostazioni predefinite, personalizzabili sul singolo impegno.
- **Aggiungi al calendario del telefono** (`.ics`): esporta i tuoi impegni con gli avvisi nel calendario del dispositivo.
- Funziona **offline**, i dati restano sul dispositivo. Backup e ripristino in JSON.

## Avvisi con l'app chiusa

Le web app non possono programmare sveglie esatte quando sono completamente chiuse:

| Situazione | Cosa succede |
|---|---|
| App aperta o in background | Notifiche e avvisi puntuali |
| App chiusa, Android con app installata | Il sistema controlla periodicamente gli avvisi (non al minuto esatto) |
| Alla riapertura | Gli avvisi delle ultime 12 ore non ancora mostrati compaiono subito |
| **Avvisi garantiti al minuto** | Usa **Avvisi → Aggiungi al calendario (.ics)**: ci pensa il calendario del telefono |

Per avere notifiche native esatte anche con l'app chiusa si può impacchettare l'app come app Android/iOS (ad esempio con Capacitor).

## Provarla sul computer

```bash
python -m http.server 8765 --directory calendario-impegni-scolastici
```

Poi apri http://localhost:8765.

## Installarla su smartphone e tablet

Per l'installazione l'app deve essere pubblicata su un indirizzo **HTTPS**. Vanno bene servizi gratuiti come
GitHub Pages, Netlify o Cloudflare Pages: basta caricare il contenuto della cartella `calendario-impegni-scolastici`.

- **Android (Chrome)**: apri l'indirizzo, poi premi **Installa** in alto oppure menu ⋮ → *Installa app*.
- **iPhone/iPad (Safari, iOS 16.4 o successivo)**: Condividi → *Aggiungi alla schermata Home*, poi apri l'app dall'icona
  e attiva le notifiche da **Avvisi**.

## Struttura

```
index.html            interfaccia
css/style.css         stile (chiaro/scuro, telefono e tablet)
js/core.js            archivio IndexedDB, date, calcolo avvisi (usato anche dal service worker)
js/parser.js          riconoscimento di date, orari e descrizioni in italiano
js/scanner.js         lettura di PDF (pdf.js) e OCR di foto e scansioni (Tesseract.js)
js/ics.js             esportazione nel calendario con avvisi (VALARM)
js/app.js             logica dell'interfaccia e degli avvisi
sw.js                 offline, controllo avvisi in background, clic sulle notifiche
manifest.webmanifest  dati per l'installazione
```

Per la prima scansione serve la connessione: pdf.js, Tesseract.js e il dizionario italiano vengono scaricati e poi tenuti in cache.
