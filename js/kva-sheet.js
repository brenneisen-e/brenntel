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

  /* ----------------------------------------
     Versand per E-Mail (Resend über /invoice-mail)
     ---------------------------------------- */
  var sendBtn   = document.getElementById('ks-send-btn');
  var sendState = document.getElementById('ks-send-status');

  function setSendStatus(text, cls) {
    if (!sendState) return;
    sendState.textContent = text;
    sendState.className = 're-send-status' + (cls ? ' ' + cls : '');
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function metaText(label) {
    var dts = document.querySelectorAll('.re-doc-meta dt');
    for (var i = 0; i < dts.length; i++) {
      if (dts[i].textContent.trim() === label) {
        var dd = dts[i].nextElementSibling;
        return dd ? dd.textContent.trim() : '';
      }
    }
    return '';
  }

  // PDF im Aufnahme-Zustand erzeugen, damit sie der Druckfassung entspricht
  function buildPdfBase64() {
    sheet.classList.add('pdf-capture');
    window.scrollTo(0, 0);

    function done(value, isError) {
      sheet.classList.remove('pdf-capture');
      if (isError) throw value;
      return value;
    }

    return html2pdf()
      .set({
        margin: [12, 12, 12, 12],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      })
      .from(sheet)
      .outputPdf('datauristring')
      .then(function (uri) { return done(uri.substring(uri.indexOf(',') + 1), false); })
      .catch(function (err) { return done(err, true); });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', function () {
      var to = val('ks-mail-to');
      var from = val('ks-mail-from');
      var subject = val('ks-mail-subject');
      var message = document.getElementById('ks-mail-text').value;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        setSendStatus('Bitte eine gültige Empfängeradresse eingeben.', 'err');
        return;
      }
      if (!from) {
        setSendStatus('Bitte einen Absender eintragen.', 'err');
        return;
      }
      if (!subject) {
        setSendStatus('Bitte einen Betreff eintragen.', 'err');
        return;
      }
      if (typeof html2pdf === 'undefined') {
        setSendStatus('PDF-Bibliothek konnte nicht geladen werden — bitte Seite neu laden.', 'err');
        return;
      }

      sendBtn.disabled = true;
      setSendStatus('PDF wird erzeugt…', 'busy');

      buildPdfBase64()
        .then(function (pdfBase64) {
          setSendStatus('E-Mail wird gesendet…', 'busy');
          var total = document.querySelector('.re-doc-badge strong');
          return fetch('/invoice-mail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: to,
              from: from,
              subject: subject,
              message: message,
              filename: filename,
              pdfBase64: pdfBase64,
              replyTo: 'kontakt@brenntelmediadesign.com',
              meta: {
                kind: 'kva',
                number: reference.trim(),
                total: total ? total.textContent.trim() : '',
                dueDate: metaText('Gültig bis'),
                company: 'Brenntel Mediadesign GbR',
                street: 'Schirmerstr. 18',
                city: '50823 Köln',
                email: 'kontakt@brenntelmediadesign.com',
                phone: '+49 171 5518420',
                taxid: metaText('Steuernummer')
              }
            })
          });
        })
        .then(function (res) {
          return res.text().then(function (raw) {
            var data;
            try { data = JSON.parse(raw); } catch (_) { data = null; }
            if (!res.ok) {
              throw new Error((data && (data.error || data.detail)) || ('HTTP ' + res.status));
            }
            return data;
          });
        })
        .then(function () {
          setSendStatus('Kostenvoranschlag wurde an ' + to + ' gesendet.', 'ok');
        })
        .catch(function (err) {
          setSendStatus('Versand fehlgeschlagen: ' + (err && err.message ? err.message : err), 'err');
        })
        .then(function () {
          sendBtn.disabled = false;
        });
    });
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
