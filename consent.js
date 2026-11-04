// Cookie consent for Google Analytics (GA4).
// Each page's <head> sets Google Consent Mode to "denied" (or "granted" for a returning visitor who accepted)
// and holds the Google tag as a type="text/plain" script. Nothing is loaded or set until the visitor accepts.
(function () {
  var KEY = 'la_consent_v1';
  var GA_ID = 'G-JFHJD3T51M';
  var LIVE = /(^|\.)liveaccess\.ai$/.test(location.hostname);
  var gaLoaded = false;
  var banner = null;

  function read() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function write(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
  }

  function analyticsOn() {
    return read() === 'granted';
  }

  function loadGoogleTag() {
    if (gaLoaded) return;
    gaLoaded = true;
    var tpl = document.querySelector('script[data-consent="analytics"]');
    var s = document.createElement('script');
    s.async = true;
    s.src = tpl ? tpl.src : 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  function clearGoogleCookies() {
    var names = ['_ga', '_ga_' + GA_ID.replace('G-', '')];
    var parts = location.hostname.split('.');
    var domains = [location.hostname];
    for (var i = 1; i < parts.length - 1; i++) domains.push('.' + parts.slice(i).join('.'));
    names.forEach(function (n) {
      domains.forEach(function (d) {
        document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + d;
      });
      document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });
  }

  function apply(value) {
    if (value === 'granted') {
      window['ga-disable-' + GA_ID] = !LIVE;
      if (typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: 'granted' });
      loadGoogleTag();
    } else {
      window['ga-disable-' + GA_ID] = true;
      if (typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: 'denied' });
      clearGoogleCookies();
    }
  }

  function choose(value) {
    write(value);
    apply(value);
    hide();
  }

  function hide() {
    if (banner) { banner.remove(); banner = null; }
  }

  function show(focus) {
    if (banner) return;
    banner = document.createElement('div');
    banner.className = 'consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-labelledby', 'consent-title');
    banner.setAttribute('aria-describedby', 'consent-text');
    banner.innerHTML =
      '<h2 id="consent-title">Cookies and analytics</h2>' +
      '<p id="consent-text">We use Google Analytics to understand how this site is used. It sets cookies only if you accept. ' +
      'You can change your choice at any time under Cookie settings in the footer. See our <a href="privacy-policy.html">Privacy Policy</a>.</p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="consent-btn" data-choice="denied">Reject</button>' +
      '<button type="button" class="consent-btn consent-accept" data-choice="granted">Accept cookies and analytics</button>' +
      '</div>';
    banner.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-choice]');
      if (b) choose(b.getAttribute('data-choice'));
    });
    document.body.appendChild(banner);
    if (focus) banner.querySelector('[data-choice="denied"]').focus();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (!t) return;
    e.preventDefault();
    show(true);
  });

  window.liveAccessConsent = { analytics: analyticsOn };

  var saved = read();
  if (saved === 'granted' || saved === 'denied') apply(saved);
  else show(false);
})();
