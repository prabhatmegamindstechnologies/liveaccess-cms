// Sends a GA4 "button_click" event for every link and button on the site, including the
// header and footer in each page. Page views come from the Google tag in each page's <head>.
(function () {
  if (typeof window.gtag !== 'function') return;

  var STORES = /(^|\.)(apps\.apple\.com|play\.google\.com)$/;

  function text(el) {
    var img = el.querySelector('img[alt]');
    var t = [el.innerText, el.value, el.getAttribute('aria-label'), img && img.alt]
      .map(function (s) { return (s || '').replace(/\s+/g, ' ').trim(); })
      .filter(Boolean)[0] || '';
    return t.slice(0, 100);
  }

  function linkType(el) {
    if (el.tagName !== 'A' || !el.getAttribute('href')) return 'button';
    if (el.protocol === 'mailto:') return 'mailto';
    if (el.protocol === 'tel:') return 'tel';
    if (STORES.test(el.hostname)) return 'store';
    return el.hostname === location.hostname ? 'internal' : 'outbound';
  }

  function section(el) {
    if (el.closest('header')) return 'header';
    if (el.closest('footer')) return 'footer';
    return 'main';
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('a, button, [role="button"], input[type="submit"]');
    if (!el) return;
    if (!(window.liveAccessConsent && window.liveAccessConsent.analytics())) return;
    var type = linkType(el);
    gtag('event', 'button_click', {
      button_text: text(el),
      link_url: type === 'button' ? '' : el.href,
      link_type: type,
      section: section(el)
    });
  }, true);
})();
