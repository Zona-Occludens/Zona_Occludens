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
  API_URL: 'https://script.google.com/macros/s/AKfycbw778dSeqBYAG3g9mYZiGHhMMSXHfmF6w2_klvvNEvXmWHNp2j5OfWdAx0n877LiLsi/exec',
  API_KEY: 'CHANGE_ME_LONG_RANDOM_STRING',
  INACTIVITY_LOCK_MIN: 15,        // auto-lock after N idle minutes
  DEFAULT_AUTOBACKUP_MIN: 15      // cloud snapshot interval (Settings can change it; 0 = off)
});
