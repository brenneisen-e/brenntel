# brenntel – Hinweise für Claude

## Kostenvoranschläge und Angebote (KVA)

- KVA- und Angebotsseiten (`kva-*.html`) immer über Screenshots sichten und
  anhand der Screenshots optimieren, bevor sie als fertig gelten. Jede Änderung
  am Blatt erneut prüfen:
  - Desktop (1280 px) und Handy (390 px), ohne horizontales Scrollen
  - PDF-Export über „Als PDF speichern“ (html2pdf), jede Seite einzeln ansehen
- Vorgehen: Repo lokal mit `python3 -m http.server` ausliefern, mit Playwright
  (global installiert, Chromium unter `/opt/pw-browsers`) Screenshots und den
  PDF-Download erzeugen, PDF-Seiten mit `pdftoppm -png` als Bilder ansehen.
- Worauf achten: Umbrüche ohne einzelne Wörter oder an Bindestrichen getrennte
  Begriffe (`&#8209;` bzw. `&nbsp;` nutzen), sinnvolle Seitenumbrüche in der
  PDF, nichts am rechten Rand abgeschnitten, Tabellen und Icons vollständig.
- html2canvas übernimmt Inline-SVG nicht in die PDF. Symbole im Blatt (z. B.
  Häkchen) deshalb per CSS zeichnen.
- Neue Seiten im Register `VALID_CODES` in `js/kva.js` eintragen
  (Code `KVA-XX-0000`). Deep Link: `/kva?code=KVA-XX-0000`.
- Angebote setzen `data-kind="angebot"` und `data-label="Angebot"` am Blatt,
  damit Versandmail und Statusmeldung „Angebot“ statt „Kostenvoranschlag“
  sagen.

## Caching

Live liefert Cloudflare CSS und JS mit `cache-control: max-age=14400` aus, die
`no-cache`-Regel aus `_headers` greift dort nicht. Wird eine CSS- oder JS-Datei
geändert, die Einbindung in den betroffenen Seiten mit `?v=JJJJMMTTx`
versionieren, sonst sehen Besucher bis zu 4 Stunden die alte Fassung.
