// Runs before first paint (classic script, no module): applies the saved theme and fills the splash with
// the laboratory name remembered from the last visit, so the loading screen is complete from frame one.
(function () {
  var store = {};
  try { store = JSON.parse(localStorage.getItem('aq.portal') || '{}') || {}; } catch (e) { /* private mode */ }
  if (store.theme === 'light' || store.theme === 'dark') document.documentElement.setAttribute('data-theme', store.theme);
  document.addEventListener('DOMContentLoaded', function () {
    var name = document.getElementById('splash-name');
    if (name && store.lab) name.textContent = store.lab;
    // Only claim encryption when the page really arrived over TLS.
    var trust = document.getElementById('splash-trust');
    if (trust && location.protocol === 'https:') trust.textContent = 'Encrypted connection · 21 CFR Part 11 audit trail';
  });
})();
