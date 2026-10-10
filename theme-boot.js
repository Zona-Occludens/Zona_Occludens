/* Applies the saved theme before first paint (kept external so the page CSP can forbid inline scripts). */
(function () {
  try {
    var t = localStorage.getItem('zona-theme');
    if (['dark', 'light', 'oled', 'midnight', 'solarized'].indexOf(t) > -1) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
