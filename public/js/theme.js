// Applied before first paint so the chosen theme, density, sidebar mode and interface intensity never flash.
(function () {
  try {
    var root = document.documentElement;
    var t = localStorage.getItem('aq-theme');
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    if (localStorage.getItem('aq-density') === 'comfortable') root.setAttribute('data-density', 'comfortable');
    if (localStorage.getItem('aq-rail') === '1') root.setAttribute('data-rail', '');
    if (localStorage.getItem('aq-hud') === 'full') root.setAttribute('data-hud', 'full');
  } catch (e) { /* storage unavailable */ }
})();
