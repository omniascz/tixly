/**
 * Tixly embed widget — auto-resize iframe according to content height.
 *
 * Použití na externím webu:
 *   <div data-tixly-event="EVENT_UUID" data-variant="card"></div>
 *   <script async src="https://tixly.cz/embed.js"></script>
 *
 * Varianty: "card" (default), "button"
 * Volitelně: data-theme="light|dark"
 */
(function () {
  if (window.__tixlyEmbedLoaded) return;
  window.__tixlyEmbedLoaded = true;

  var TIXLY_ORIGIN = (function () {
    var script = document.currentScript || document.querySelector('script[src*="/embed.js"]');
    if (!script) return 'https://tixly.cz';
    var u = new URL(script.src);
    return u.origin;
  })();

  function createIframe(container) {
    var eventId = container.getAttribute('data-tixly-event');
    var variant = container.getAttribute('data-variant') || 'card';
    var theme = container.getAttribute('data-theme') || 'light';
    if (!eventId) return;

    var iframe = document.createElement('iframe');
    iframe.src =
      TIXLY_ORIGIN + '/embed/event/' + encodeURIComponent(eventId) +
      '?variant=' + encodeURIComponent(variant) +
      '&theme=' + encodeURIComponent(theme);
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.minHeight = variant === 'button' ? '60px' : '500px';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('title', 'Tixly vstupenky');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');

    container.appendChild(iframe);
    container.__tixlyIframe = iframe;
  }

  function init() {
    var containers = document.querySelectorAll('[data-tixly-event]');
    Array.prototype.forEach.call(containers, function (c) {
      if (!c.__tixlyIframe) createIframe(c);
    });
  }

  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'tixly:resize') return;
    if (e.origin !== TIXLY_ORIGIN) return;
    var height = Number(e.data.height);
    if (!isFinite(height) || height < 50) return;
    var iframes = document.querySelectorAll('iframe[src*="' + TIXLY_ORIGIN + '"]');
    Array.prototype.forEach.call(iframes, function (f) {
      if (e.source === f.contentWindow) {
        f.style.height = height + 'px';
      }
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Observer pro dynamic insertion (SPAs)
  if (window.MutationObserver) {
    new MutationObserver(init).observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
