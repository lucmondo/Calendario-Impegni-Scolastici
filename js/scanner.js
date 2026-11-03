/* scanner.js — estrae il testo da PDF, immagini e file di testo.
   pdf.js e Tesseract.js (OCR in italiano) vengono caricati solo quando servono. */
(function (root) {
  'use strict';

  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  const loaded = {};
  function loadScript(src) {
    return loaded[src] || (loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error('Impossibile scaricare ' + src + '. Controlla la connessione.')); };
      document.head.appendChild(s);
    }));
  }

  /* Ricostruisce le righe di una pagina PDF raggruppando i frammenti per altezza. */
  async function pdfPageText(page) {
    const tc = await page.getTextContent();
    const items = tc.items
      .filter(i => i.str && i.str.trim())
      .map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: Math.abs(i.transform[3]) || 10, w: i.width || 0 }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    let cur = null;
    for (const it of items) {
      if (cur && Math.abs(cur.y - it.y) <= Math.max(2, it.h * 0.5)) cur.items.push(it);
      else { cur = { y: it.y, items: [it] }; lines.push(cur); }
    }
    return lines.map(l => {
      l.items.sort((a, b) => a.x - b.x);
      let s = '', lastEnd = null;
      for (const it of l.items) {
        if (lastEnd !== null) {
          const gap = it.x - lastEnd;
          s += gap > it.h * 2 ? '   ' : gap > it.h * 0.15 ? ' ' : '';
        }
        s += it.s;
        lastEnd = it.x + it.w;
      }
      return s;
    }).join('\n');
  }

  let ocrWorker = null;
  let ocrProgress = () => {};
  async function getOcr(onProgress) {
    ocrProgress = onProgress;
    if (ocrWorker) return ocrWorker;
    onProgress(null, 'Preparo il riconoscimento del testo (la prima volta serve qualche secondo)…');
    await loadScript(TESSERACT);
    ocrWorker = await root.Tesseract.createWorker('ita', 1, {
      logger: m => {
        if (m.status === 'recognizing text') ocrProgress(m.progress, null);
      }
    });
    return ocrWorker;
  }

  async function ocr(canvas, onProgress, label) {
    const w = await getOcr(onProgress);
    onProgress(0, label);
    const { data } = await w.recognize(canvas);
    return data.text || '';
  }

  function canvasFromBitmap(bmp, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }

  async function scanPdf(file, onProgress) {
    onProgress(null, 'Apro il PDF…');
    await loadScript(PDFJS);
    const pdfjs = root.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const parts = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      onProgress((p - 1) / doc.numPages, `Leggo la pagina ${p} di ${doc.numPages}…`);
      let text = await pdfPageText(page);
      if (text.replace(/\s/g, '').length < 40) {
        // Pagina scansionata: la trasformo in immagine e uso l'OCR
        const vp1 = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(3, 2200 / Math.max(vp1.width, vp1.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        text = await ocr(canvas, onProgress, `Riconosco il testo della pagina ${p} di ${doc.numPages}…`);
      }
      parts.push(text);
    }
    return parts.join('\n');
  }

  async function scanImage(file, onProgress) {
    onProgress(null, "Preparo l'immagine…");
    const bmp = await createImageBitmap(file);
    const canvas = canvasFromBitmap(bmp, 2600);
    return ocr(canvas, onProgress, "Riconosco il testo dell'immagine…");
  }

  /**
   * @param {File} file
   * @param {(fraction:number|null, message:string|null) => void} onProgress
   * @returns {Promise<string>} testo estratto
   */
  async function scan(file, onProgress) {
    const name = (file.name || '').toLowerCase();
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) return scanPdf(file, onProgress);
    if (file.type.startsWith('image/')) return scanImage(file, onProgress);
    if (file.type.startsWith('text/') || name.endsWith('.txt')) return file.text();
    throw new Error('Formato non supportato. Usa un PDF, una foto o un file di testo.');
  }

  root.Scanner = { scan };
})(window);
