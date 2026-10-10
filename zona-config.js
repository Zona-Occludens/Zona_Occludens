/* =====================================================================
   Zona Occludens: client configuration (the ONLY file you edit on the frontend)
   ---------------------------------------------------------------------
   API_URL : your Apps Script Web App "/exec" URL.
   API_KEY : must equal CFG.API_KEY you put into code.gs and ran through setupZona().

   SECURITY NOTE: everything in this file is public (GitHub Pages serves it).
   The API key only blocks casual abuse. Real protection is server-side:
   signed expiring session tokens, device binding, rate limits, encryption at
   rest. The admin PIN is NEVER stored here, it lives in Script Properties.
   ===================================================================== */
window.ZONA_CONFIG = Object.freeze({
  API_URL: 'https://script.google.com/macros/s/AKfycbwPXEvx1p9QvX6FbIQynvgaHkY25oiyyzVJKKtHmPwbz2b_sjnza47lYJ08WdZT1npLRQ/exec',
  API_KEY: '_w38qRp0GU2Js4LBtIxwJi70nC6Hd7O1V',
  INACTIVITY_LOCK_MIN: 15,        // auto-lock after N idle minutes
  DEFAULT_AUTOBACKUP_MIN: 15      // cloud snapshot interval (Settings can change it; 0 = off)
});
