// Tema: 'auto' (prema postavkama uređaja), 'light' ili 'dark'. Pamti se na ovom uređaju.
// Učitava se u <head>, prije prikaza stranice, da ne bljesne pogrešna tema.
(function () {
  var KEY = 'opg-tema';
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function get() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function apply() {
    var t = get(), dark = t === 'dark' || (t === 'auto' && mq.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#2f3d1b' : '#556b2f');
  }
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);
  window.opgTheme = {
    get: get,
    isDark: function () { return document.documentElement.getAttribute('data-theme') === 'dark'; },
    set: function (t) { try { localStorage.setItem(KEY, t); } catch (e) {} apply(); },
  };
})();
