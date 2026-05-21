/**
 * Tixly Discover Widget — embeddable na partner weby.
 *
 * Usage:
 *   <div id="tixly-discover" data-city="praha" data-category="hudba" data-limit="6"></div>
 *   <script src="https://app.tixly.cz/discover-widget.js" defer></script>
 *
 * Vykreslí list nadcházejících akcí z Tixly národního feedu.
 */
(function () {
  'use strict';

  var BASE = (function () {
    var s = document.currentScript;
    if (s) {
      try { return new URL(s.src).origin; } catch (_) { /* fallthrough */ }
    }
    return 'https://app.tixly.cz';
  })();

  function fmt(date) {
    try {
      return new Date(date).toLocaleString('cs-CZ', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    } catch (_) {
      return date;
    }
  }

  function money(halire, currency) {
    var n = (halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 });
    return n + ' ' + (currency === 'EUR' ? '€' : 'Kč');
  }

  function render(container, events) {
    var html = '<div class="tixly-w" style="font-family:system-ui;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">';
    if (!events.length) {
      html += '<p style="color:#666">Žádné aktuální akce.</p>';
    }
    events.forEach(function (e) {
      var img = e.cover_image_url
        ? '<div style="aspect-ratio:16/9;background:url(' + e.cover_image_url + ') center/cover #eee"></div>'
        : '<div style="aspect-ratio:16/9;background:#eee"></div>';
      html +=
        '<a href="' + BASE + '/cs/events/' + e.id + '" target="_blank" rel="noopener" ' +
        'style="text-decoration:none;color:inherit;border:1px solid #ddd;border-radius:8px;overflow:hidden;display:block">' +
        img +
        '<div style="padding:10px">' +
        '<p style="font-size:11px;text-transform:uppercase;color:#888;margin:0">' + (e.promoter_name || '') + '</p>' +
        '<p style="font-weight:600;margin:4px 0 6px;line-height:1.2">' + e.title + '</p>' +
        '<p style="font-size:12px;color:#666;margin:0">' + fmt(e.date_start) + (e.venue_name ? ' · ' + e.venue_name : '') + '</p>' +
        (e.cheapest_price ? '<p style="font-size:13px;font-weight:600;color:#6c47ff;margin:6px 0 0">od ' + money(e.cheapest_price, e.currency) + '</p>' : '') +
        '</div></a>';
    });
    html += '</div>';
    html += '<p style="font-size:11px;color:#999;margin-top:8px"><a href="' + BASE + '" style="color:#999" target="_blank">Powered by Tixly</a></p>';
    container.innerHTML = html;
  }

  function load(container) {
    var city = container.getAttribute('data-city') || '';
    var category = container.getAttribute('data-category') || '';
    var limit = container.getAttribute('data-limit') || '6';
    var params = new URLSearchParams({ format: 'json', limit: limit });
    if (city) params.set('city', city);
    if (category) params.set('category', category);

    fetch(BASE + '/api/v1/feed/events?' + params.toString())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var events = data.events || data || [];
        render(container, Array.isArray(events) ? events.slice(0, +limit) : []);
      })
      .catch(function () {
        container.innerHTML = '<p style="color:#666">Nepodařilo se načíst akce.</p>';
      });
  }

  function init() {
    var containers = document.querySelectorAll('[id="tixly-discover"], [data-tixly-discover]');
    containers.forEach(load);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
