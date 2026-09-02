/* ========================================
   Kostenvoranschlag als Blatt — Druck & PDF
   Gleicher Aufnahme-Zustand wie beim Rechnungsersteller, damit die
   gespeicherte PDF der gedruckten Fassung entspricht.
   ======================================== */
(function () {
  'use strict';

  var sheet    = document.getElementById('ks-sheet');
  var printBtn = document.getElementById('ks-print-btn');
  var pdfBtn   = document.getElementById('ks-pdf-btn');

  if (!sheet) return;

  var reference = (document.querySelector('.re-doc-meta dd') || {}).textContent || 'KVA';
  var filename  = reference.trim().replace(/[^\w.-]+/g, '_') + '_brenntel.pdf';

  if (printBtn) {
    printBtn.addEventListener('click', function () { window.print(); });
  }

  if (pdfBtn) {
    pdfBtn.addEventListener('click', function () {
      if (typeof html2pdf === 'undefined' || pdfBtn.disabled) return;

      pdfBtn.disabled = true;
      sheet.classList.add('pdf-capture');
      window.scrollTo(0, 0);

      function cleanup() {
        sheet.classList.remove('pdf-capture');
        pdfBtn.disabled = false;
      }

      setTimeout(function () {
        html2pdf()
          .set({
            margin: [12, 12, 12, 12],
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
          })
          .from(sheet)
          .save()
          .then(cleanup)
          .catch(cleanup);
      }, 150);
    });
  }
})();
