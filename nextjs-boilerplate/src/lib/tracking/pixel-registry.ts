/**
 * Universal pixel registry — 30 tracking pixel types.
 * Each entry defines UI config fields + client-side script template.
 * Scripts are injected via PixelManager (dangerouslySetInnerHTML in next/script).
 */

export interface PixelEventData {
  value?: number;
  currency?: string;
  orderId?: string;
  items?: number;
  contentName?: string;
  contentIds?: string[];
}

export interface PixelConfigField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'password';
  required: boolean;
  placeholder?: string;
  hint?: string;
}

export interface PixelTypeDef {
  id: string;
  name: string;
  category: 'advertising' | 'analytics' | 'automation' | 'analytics_product' | 'custom';
  icon: string;
  placeholder: string;
  configFields: PixelConfigField[];
  defaultEvents: string[];
  hasServerSide: boolean;
  buildScript(
    pixelId: string,
    config: Record<string, string>,
    pageEvent: string,
    data?: PixelEventData,
  ): string | null;
}

// Sanitize pixel IDs before embedding in JS strings
function s(v: string): string {
  return String(v).replace(/['"\\<>&\r\n]/g, '');
}
function n(v?: number): string {
  return v != null ? String(Number(v.toFixed(2))) : '0';
}
function j(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export const PIXEL_REGISTRY: Record<string, PixelTypeDef> = {

  // ─── Advertising ──────────────────────────────────────────────────────────

  meta: {
    id: 'meta', name: 'Meta Pixel (Facebook / Instagram)',
    category: 'advertising', icon: '📘', placeholder: '123456789012345',
    configFields: [], defaultEvents: ['ViewContent','InitiateCheckout','Purchase'],
    hasServerSide: true,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const eventMap: Record<string, string> = {
        ViewContent: 'ViewContent', InitiateCheckout: 'InitiateCheckout', Purchase: 'Purchase',
      };
      const fbEvent = eventMap[pageEvent];
      if (!fbEvent && pageEvent !== 'PageView') return null;
      const pid = s(pixelId);
      const init = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pid}');fbq('track','PageView');`;
      if (!fbEvent) return init;
      const params = pageEvent === 'Purchase' && data
        ? j({ value: data.value ?? 0, currency: data.currency ?? 'CZK', num_items: data.items ?? 1, content_type: 'product' })
        : pageEvent === 'InitiateCheckout' && data
        ? j({ value: data.value ?? 0, currency: data.currency ?? 'CZK', num_items: data.items ?? 1 })
        : j({ content_name: data?.contentName ?? '', content_type: 'product' });
      return `${init}fbq('track','${fbEvent}',${params}${data?.orderId ? `,'${j({ eventID: data.orderId })}'.slice(1,-1)` : ''});`;
    },
  },

  google_ads: {
    id: 'google_ads', name: 'Google Ads (Conversion Tracking)',
    category: 'advertising', icon: '🟢', placeholder: 'AW-1234567890',
    configFields: [
      { key: 'conversionLabel', label: 'Conversion Label', type: 'text', required: false, placeholder: 'ABCDE12345', hint: 'Z Google Ads → Konverze → Tag setup' },
    ],
    defaultEvents: ['Purchase'], hasServerSide: false,
    buildScript(pixelId, cfg, pageEvent, data) {
      const pid = s(pixelId);
      const gtag = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${pid}');`;
      const scriptSrc = `(function(){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${pid}';document.head.appendChild(s)})();${gtag}`;
      if (pageEvent === 'Purchase' && data && cfg.conversionLabel) {
        const sendTo = `${pid}/${s(cfg.conversionLabel)}`;
        return `${scriptSrc}gtag('event','conversion',${j({ send_to: sendTo, value: data.value ?? 0, currency: data.currency ?? 'CZK', transaction_id: data.orderId ?? '' })});`;
      }
      return scriptSrc;
    },
  },

  google_analytics: {
    id: 'google_analytics', name: 'Google Analytics 4',
    category: 'advertising', icon: '📊', placeholder: 'G-XXXXXXXXXX',
    configFields: [], defaultEvents: ['ViewContent','InitiateCheckout','Purchase'],
    hasServerSide: true,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const base = `(function(){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${pid}';document.head.appendChild(s)})();window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${pid}');`;
      if (pageEvent === 'Purchase' && data) {
        return `${base}gtag('event','purchase',${j({ transaction_id: data.orderId ?? '', value: data.value ?? 0, currency: data.currency ?? 'CZK', items: [{ item_name: data.contentName ?? '', quantity: data.items ?? 1 }] })});`;
      }
      if (pageEvent === 'InitiateCheckout' && data) {
        return `${base}gtag('event','begin_checkout',${j({ value: data.value ?? 0, currency: data.currency ?? 'CZK' })});`;
      }
      if (pageEvent === 'ViewContent') return `${base}gtag('event','view_item',${j({ items: [{ item_name: data?.contentName ?? '' }] })});`;
      return base;
    },
  },

  gtm: {
    id: 'gtm', name: 'Google Tag Manager',
    category: 'advertising', icon: '🏷️', placeholder: 'GTM-XXXXXXX',
    configFields: [], defaultEvents: ['ViewContent','InitiateCheckout','Purchase'],
    hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const push = pageEvent === 'Purchase' && data
        ? `window.dataLayer.push(${j({ event: 'purchase', ecommerce: { transaction_id: data.orderId ?? '', value: data.value ?? 0, currency: data.currency ?? 'CZK' } })});`
        : pageEvent === 'InitiateCheckout'
        ? `window.dataLayer.push(${j({ event: 'begin_checkout' })});`
        : pageEvent === 'ViewContent'
        ? `window.dataLayer.push(${j({ event: 'view_item' })});`
        : '';
      return `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${pid}');${push}`;
    },
  },

  tiktok: {
    id: 'tiktok', name: 'TikTok Pixel',
    category: 'advertising', icon: '🎵', placeholder: 'C9XXXXXXXXXXX',
    configFields: [], defaultEvents: ['ViewContent','InitiateCheckout','Purchase'],
    hasServerSide: true,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const eventMap: Record<string, string> = { ViewContent: 'ViewContent', InitiateCheckout: 'InitiateCheckout', Purchase: 'CompletePayment' };
      const ttEvent = eventMap[pageEvent];
      const init = `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._n=ttq._n||{},ttq._n[e]=n||0,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${pid}');ttq.page();}(window,document,'ttq');`;
      if (!ttEvent) return init;
      const props = data ? j({ value: data.value ?? 0, currency: data.currency ?? 'CZK', contents: [{ content_type: 'product', quantity: data.items ?? 1 }] }) : '{}';
      return `${init}ttq.track('${ttEvent}',${props});`;
    },
  },

  snapchat: {
    id: 'snapchat', name: 'Snap Pixel',
    category: 'advertising', icon: '👻', placeholder: 'a1b2c3d4-...',
    configFields: [], defaultEvents: ['ViewContent','InitiateCheckout','Purchase'],
    hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const eventMap: Record<string, string> = { ViewContent: 'VIEW_CONTENT', InitiateCheckout: 'START_CHECKOUT', Purchase: 'PURCHASE' };
      const ev = eventMap[pageEvent];
      const init = `(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s='script';r=t.createElement(s);r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u)})(window,document,'https://sc-static.net/scevent.min.js');snaptr('init','${pid}');snaptr('track','PAGE_VIEW');`;
      if (!ev) return init;
      const props = data && pageEvent === 'Purchase' ? j({ price: data.value ?? 0, currency: data.currency ?? 'CZK', transaction_id: data.orderId ?? '' }) : '{}';
      return `${init}snaptr('track','${ev}',${props});`;
    },
  },

  twitter: {
    id: 'twitter', name: 'Twitter / X Pixel',
    category: 'advertising', icon: '🐦', placeholder: 'o0abc1',
    configFields: [
      { key: 'purchaseEventId', label: 'Purchase Event ID', type: 'text', required: false, placeholder: 'tw-xxxxx-xxxxx', hint: 'Z Twitter Ads → Events manager' },
    ],
    defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, cfg, pageEvent, data) {
      const pid = s(pixelId);
      const init = `!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments)},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config','${pid}');`;
      if (pageEvent === 'Purchase' && cfg.purchaseEventId && data) {
        return `${init}twq('event','${s(cfg.purchaseEventId)}',${j({ value: data.value ?? 0, currency: data.currency ?? 'CZK', num_items: data.items ?? 1 })});`;
      }
      return init;
    },
  },

  pinterest: {
    id: 'pinterest', name: 'Pinterest Tag',
    category: 'advertising', icon: '📌', placeholder: '1234567890123',
    configFields: [], defaultEvents: ['ViewContent','InitiateCheckout','Purchase'],
    hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const eventMap: Record<string, string> = { ViewContent: 'pagevisit', InitiateCheckout: 'checkout', Purchase: 'checkout' };
      const ev = eventMap[pageEvent];
      const init = `!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");pintrk('load','${pid}');pintrk('page');`;
      if (!ev) return init;
      const props = data && pageEvent === 'Purchase' ? j({ value: data.value ?? 0, currency: data.currency ?? 'CZK', order_id: data.orderId ?? '' }) : '{}';
      return `${init}pintrk('track','${ev}',${props});`;
    },
  },

  linkedin: {
    id: 'linkedin', name: 'LinkedIn Insight Tag',
    category: 'advertising', icon: '💼', placeholder: '1234567',
    configFields: [], defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, _pageEvent, _data) {
      const pid = s(pixelId);
      return `_linkedin_partner_id="${pid}";window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";s.parentNode.insertBefore(b,s)})(window.lintrk);`;
    },
  },

  microsoft_bing: {
    id: 'microsoft_bing', name: 'Microsoft / Bing UET',
    category: 'advertising', icon: '🔵', placeholder: '12345678',
    configFields: [], defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const init = `(function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:"${pid}",enableAutoSpaTracking:true};o.q=w[u],w[u]=new UET(o),w[u].push("pageLoad")},n=d.createElement(t),n.src=r,n.async=1,n.onload=n.onreadystatechange=function(){var s=this.readyState;s&&s!=="loaded"&&s!=="complete"||(f(),n.onload=n.onreadystatechange=null)},i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)})(window,document,"script","//bat.bing.com/bat.js","uetq");`;
      if (pageEvent === 'Purchase' && data) {
        return `${init}window.uetq=window.uetq||[];window.uetq.push('event','purchase',${j({ revenue_value: data.value ?? 0, currency: data.currency ?? 'CZK' })});`;
      }
      return init;
    },
  },

  criteo: {
    id: 'criteo', name: 'Criteo OneTag',
    category: 'advertising', icon: '🟠', placeholder: '12345',
    configFields: [], defaultEvents: ['ViewContent','InitiateCheckout','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const device = `(/iPad/.test(navigator.userAgent)?"t":/Mobile|iP(hone|od)|Android/.test(navigator.userAgent)?"m":"d")`;
      const events: Record<string,string> = { ViewContent: 'viewItem', InitiateCheckout: 'viewBasket', Purchase: 'trackTransaction' };
      const ev = events[pageEvent];
      const base = `window.criteo_q=window.criteo_q||[];(function(){var s=document.createElement('script');s.async=true;s.src='https://static.criteo.net/js/ld/ld.js';document.head.appendChild(s)})();window.criteo_q.push({event:"setAccount",account:${pid}},{event:"setSiteType",type:${device}},`;
      if (ev === 'trackTransaction' && data) {
        return `${base}{event:"trackTransaction",id:"${s(data.orderId??'')}",item:[{id:"ticket",price:${n(data.value)},quantity:${data.items??1}}]});`;
      }
      if (ev) return `${base}{event:"${ev}",item:[{id:"event"}]});`;
      return `${base}{event:"viewHome"});`;
    },
  },

  rtb_house: {
    id: 'rtb_house', name: 'RTB House',
    category: 'advertising', icon: '🏠', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    configFields: [], defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const ev = pageEvent === 'Purchase' ? 'tr' : 'dp';
      const params = data && pageEvent === 'Purchase'
        ? `&orderId=${s(data.orderId??'')}&totalValue=${n(data.value)}&currency=${s(data.currency??'CZK')}`
        : '';
      return `(function(){var img=new Image();img.src='https://tags.rtbhouse.com/e.gif?eventType=${ev}&account=${pid}${params}';})();`;
    },
  },

  adform: {
    id: 'adform', name: 'Adform',
    category: 'advertising', icon: '🔷', placeholder: '12345',
    configFields: [
      { key: 'trackingPoint', label: 'Tracking Point Name', type: 'text', required: false, placeholder: 'Purchase', hint: 'Pojmenování konverze v Adform' },
    ],
    defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, cfg, pageEvent, data) {
      const pid = s(pixelId);
      const tp = s(cfg.trackingPoint ?? 'Purchase');
      if (pageEvent === 'Purchase' && data) {
        return `window._adftrack=Array.isArray(window._adftrack)?window._adftrack:[];window._adftrack.push({HttpServer:"track.adform.net",pm:${pid},divider:encodeURIComponent("|"),PageName:encodeURIComponent("${tp}"),itm:{itd:[{bn:"ticket",bc:"tickets",bp:${n(data.value)},bq:${data.items??1}}]}});(function(){var s=document.createElement("script");s.type="text/javascript";s.async=true;s.src="https://a2.adform.net/serving/scripts/trackpoint/async/";var x=document.getElementsByTagName("script")[0];x.parentNode.insertBefore(s,x);})();`;
      }
      return `(function(){var s=document.createElement("script");s.async=true;s.src="https://a2.adform.net/serving/scripts/trackpoint/async/";document.head.appendChild(s)})();window._adftrack=window._adftrack||[];window._adftrack.push({HttpServer:"track.adform.net",pm:${pid}});`;
    },
  },

  outbrain: {
    id: 'outbrain', name: 'Outbrain Pixel',
    category: 'advertising', icon: '⭕', placeholder: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    configFields: [], defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, _data) {
      const pid = s(pixelId);
      const ev = pageEvent === 'Purchase' ? 'Purchase' : 'ViewContent';
      return `!function(_window,_document){"use strict";var OB_ADV_ID="${pid}";if(_window.obApi){var toArray=function(object){return Object.prototype.toString.call(object)==="[object Array]"?object:[object]};_window.obApi.marketerId=toArray(_window.obApi.marketerId).concat(toArray(OB_ADV_ID));return}_window.obApi=function(){_window.obApi.dispatch?_window.obApi.dispatch.apply(_window.obApi,arguments):_window.obApi.queue.push(arguments)};var api=_window.obApi;api.version="1.1";api.loaded=true;api.marketerId=OB_ADV_ID;api.queue=[];var tag=_document.createElement("script");tag.async=true;tag.src="https://amplify.outbrain.com/cp/obtp.js";var script=_document.getElementsByTagName("script")[0];script.parentNode.insertBefore(tag,script)}(window,document);obApi("track","${ev}");`;
    },
  },

  taboola: {
    id: 'taboola', name: 'Taboola Pixel',
    category: 'advertising', icon: '🟡', placeholder: '1234567',
    configFields: [], defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const ev = pageEvent === 'Purchase' ? 'Purchase' : 'page_view';
      const purchaseData = data && pageEvent === 'Purchase' ? `,${j({ orderid: data.orderId ?? '', revenue: data.value ?? 0, currency: data.currency ?? 'CZK' })}` : '';
      return `window._tfa=window._tfa||[];window._tfa.push({notify:"event",name:"${ev}",id:${pid}${purchaseData}});!function(t,f,a,x){if(!document.getElementById(x)){t.async=1;t.src=a;t.id=x;f.parentNode.insertBefore(t,f)}}(document.createElement("script"),document.getElementsByTagName("script")[0],"//cdn.taboola.com/libtrc/unip/${pid}/tfa.js","tb_tfa_script");`;
    },
  },

  reddit: {
    id: 'reddit', name: 'Reddit Pixel',
    category: 'advertising', icon: '🤖', placeholder: 'a2_xxxxxxxxxxxxx',
    configFields: [], defaultEvents: ['ViewContent','InitiateCheckout','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const eventMap: Record<string,string> = { ViewContent: 'ViewContent', InitiateCheckout: 'AddToCart', Purchase: 'Purchase' };
      const ev = eventMap[pageEvent] ?? 'PageVisit';
      const props = data && pageEvent === 'Purchase' ? j({ value: data.value ?? 0, currency: data.currency ?? 'CZK', itemCount: data.items ?? 1 }) : '{}';
      return `!function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/v2.js",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);rdt('init','${pid}');rdt('track','PageVisit');rdt('track','${ev}',${props});`;
    },
  },

  quora: {
    id: 'quora', name: 'Quora Pixel',
    category: 'advertising', icon: '❓', placeholder: 'abc123def456',
    configFields: [], defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, _pageEvent, _data) {
      const pid = s(pixelId);
      return `!function(q,e,v,n,t,s){if(q.qp)return;n=q.qp=function(){n.qp?n.qp.apply(n,arguments):n.queue.push(arguments)};n.queue=[];t=document.createElement(e);t.async=!0;t.src=v;s=document.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,"script","https://a.quora.com/qevents.js");qp('init','${pid}');qp('track','Generic');`;
    },
  },

  // ─── Analytics / CRO ──────────────────────────────────────────────────────

  hotjar: {
    id: 'hotjar', name: 'Hotjar',
    category: 'analytics', icon: '🔥', placeholder: '1234567',
    configFields: [], defaultEvents: ['ViewContent'], hasServerSide: false,
    buildScript(pixelId, _cfg, _pageEvent, _data) {
      const pid = s(pixelId);
      return `(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};h._hjSettings={hjid:${pid},hjsv:6};a=o.getElementsByTagName("head")[0];r=o.createElement("script");r.async=1;r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;a.appendChild(r)})(window,document,"https://static.hotjar.com/c/hotjar-",".js?sv=");`;
    },
  },

  microsoft_clarity: {
    id: 'microsoft_clarity', name: 'Microsoft Clarity',
    category: 'analytics', icon: '🔵', placeholder: 'abcdefghij',
    configFields: [], defaultEvents: ['ViewContent'], hasServerSide: false,
    buildScript(pixelId, _cfg, _pageEvent, _data) {
      const pid = s(pixelId);
      return `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","${pid}");`;
    },
  },

  smartlook: {
    id: 'smartlook', name: 'Smartlook',
    category: 'analytics', icon: '👁️', placeholder: 'abcdef1234567890abcdef1234567890',
    configFields: [], defaultEvents: ['ViewContent'], hasServerSide: false,
    buildScript(pixelId, _cfg, _pageEvent, _data) {
      const pid = s(pixelId);
      return `window.smartlook||(function(d){var o=smartlook=function(){o.api.push(arguments)},h=d.getElementsByTagName("head")[0];var c=d.createElement("script");o.api=new Array();c.async=true;c.type="text/javascript";c.charset="utf-8";c.src="https://web-sdk.smartlook.com/recorder.js";h.appendChild(c)})(document);smartlook("init","${pid}",{region:"eu"});`;
    },
  },

  yandex_metrica: {
    id: 'yandex_metrica', name: 'Yandex.Metrica',
    category: 'analytics', icon: '🟡', placeholder: '12345678',
    configFields: [], defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const init = `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${pid},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,ecommerce:"dataLayer"});`;
      if (pageEvent === 'Purchase' && data) {
        return `${init}window.dataLayer=window.dataLayer||[];window.dataLayer.push({ecommerce:{purchase:{actionField:{id:"${s(data.orderId??'')}",revenue:${n(data.value)}},products:[{name:"Vstupenka",price:${n(data.value)},quantity:${data.items??1}}]}}});`;
      }
      return init;
    },
  },

  vwo: {
    id: 'vwo', name: 'VWO (Visual Website Optimizer)',
    category: 'analytics', icon: '🧪', placeholder: '123456',
    configFields: [], defaultEvents: ['ViewContent'], hasServerSide: false,
    buildScript(pixelId, _cfg, _pageEvent, _data) {
      const pid = s(pixelId);
      return `window.VWO=window.VWO||[];VWO.push(["account",${pid}]);(function(d,t){var s=d.createElement(t);s.src="https://dev.visualwebsiteoptimizer.com/j.php?a=${pid}&r="+0.01*Math.random()+"&v=1.3";var _s=d.getElementsByTagName(t)[0];_s.parentNode.insertBefore(s,_s)}(document,"script"));`;
    },
  },

  // ─── Marketing Automation ─────────────────────────────────────────────────

  klaviyo: {
    id: 'klaviyo', name: 'Klaviyo',
    category: 'automation', icon: '📧', placeholder: 'AbCdEf',
    configFields: [], defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const base = `var _learnq=_learnq||[];(function(){var b=document.createElement("script");b.type="text/javascript";b.async=true;b.src="https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=${pid}";var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(b,a)})();`;
      if (pageEvent === 'Purchase' && data) {
        return `${base}_learnq.push(["track","Placed Order",${j({ OrderId: data.orderId ?? '', OrderTotal: data.value ?? 0, ItemCount: data.items ?? 1 })}]);`;
      }
      if (pageEvent === 'ViewContent') return `${base}_learnq.push(["track","Viewed Product",${j({ Name: data?.contentName ?? '' })}]);`;
      return base;
    },
  },

  hubspot: {
    id: 'hubspot', name: 'HubSpot',
    category: 'automation', icon: '🧲', placeholder: '12345678',
    configFields: [], defaultEvents: ['ViewContent'], hasServerSide: false,
    buildScript(pixelId, _cfg, _pageEvent, _data) {
      const pid = s(pixelId);
      return `var _hsq=window._hsq=window._hsq||[];_hsq.push(["setPath",window.location.pathname]);(function(d,s,i){var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.defer=true;j.src="https://js.hs-scripts.com/"+i+".js";f.parentNode.insertBefore(j,f)})(document,"script","${pid}");`;
    },
  },

  activecampaign: {
    id: 'activecampaign', name: 'ActiveCampaign Site Tracking',
    category: 'automation', icon: '⚡', placeholder: 'yoursubdomain.activehosted.com',
    configFields: [
      { key: 'siteId', label: 'Site ID', type: 'text', required: true, placeholder: '12345', hint: 'Z Settings → Tracking → Your site ID' },
    ],
    defaultEvents: ['ViewContent'], hasServerSide: false,
    buildScript(pixelId, cfg, _pageEvent, _data) {
      const host = s(pixelId);
      const sid = s(cfg.siteId ?? '1');
      return `(function(e,t,o,n,p,r,i){e.visitorGlobalObjectAlias=n;e[n]=e[n]||function(){(e[n].q=e[n].q||[]).push(arguments)};e[n].l=(new Date).getTime();r=t.createElement("script");r.src=o;r.async=true;i=t.getElementsByTagName("script")[0];i.parentNode.insertBefore(r,i)})(window,document,"https://${host}/app/web_tracking/script/${sid}/script.js","vgo");vgo("setAccount","${sid}");vgo("setTrackByDefault",true);vgo("process");`;
    },
  },

  // ─── Product Analytics ────────────────────────────────────────────────────

  segment: {
    id: 'segment', name: 'Segment',
    category: 'analytics_product', icon: '🔵', placeholder: 'abc123def456',
    configFields: [], defaultEvents: ['ViewContent','InitiateCheckout','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const base = `!function(){var i="analytics",analytics=window[i]=window[i]||[];if(!analytics.initialize)if(analytics.invoked)window.console&&console.error&&console.error("Segment snippet included twice.");else{analytics.invoked=!0;analytics.methods=["trackSubmit","trackClick","trackLink","trackForm","pageview","identify","reset","group","track","ready","alias","debug","page","screen","once","off","on","addSourceMiddleware","addIntegrationMiddleware","setAnonymousId","addDestinationMiddleware","register"];analytics.factory=function(e){return function(){if(window[i].initialized)return window[i][e].apply(window[i],arguments);var n=Array.prototype.slice.call(arguments);if(["track","screen","alias","group","page","identify"].indexOf(e)>-1){var c=document.querySelector("link[rel='canonical']");n.push({__t:"bpc",c:c&&c.getAttribute("href")||void 0,p:location.pathname,u:location.href,s:location.search,t:document.title,r:document.referrer})}n.unshift(e);analytics.push(n);return analytics}};for(var n=0;n<analytics.methods.length;n++){var key=analytics.methods[n];analytics[key]=analytics.factory(key)}analytics.load=function(key,n){var t=document.createElement("script");t.type="text/javascript";t.async=!0;t.setAttribute("src","https://cdn.segment.com/analytics.js/v1/"+key+"/analytics.min.js");var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r);analytics._loadOptions=n};analytics._writeKey="${pid}";;analytics.SNIPPET_VERSION="5.2.1";analytics.load("${pid}");analytics.page();}}();`;
      if (pageEvent === 'Purchase' && data) {
        return `${base}analytics.track("Order Completed",${j({ orderId: data.orderId ?? '', total: data.value ?? 0, currency: data.currency ?? 'CZK' })});`;
      }
      if (pageEvent === 'InitiateCheckout') return `${base}analytics.track("Checkout Started",${j({ total: data?.value ?? 0 })});`;
      if (pageEvent === 'ViewContent') return `${base}analytics.track("Product Viewed",${j({ name: data?.contentName ?? '' })});`;
      return base;
    },
  },

  mixpanel: {
    id: 'mixpanel', name: 'Mixpanel',
    category: 'analytics_product', icon: '🔮', placeholder: 'abcdef1234567890abcdef12345678',
    configFields: [], defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const init = `(function(f,b){if(!b.__SV){var e,g,i,h;window.mixpanel=b;b._i=[];b.init=function(e,f,c){function g(a,d){var b=d.split(".");2==b.length&&(a=a[b[0]],d=b[1]);a[d]=function(){a.push([d].concat(Array.prototype.slice.call(arguments,0)))}}var a=b;"undefined"!==typeof c?a=b[c]=[]:c="mixpanel";a.people=a.people||[];a.toString=function(a){var d="mixpanel";"mixpanel"!==c&&(d+="."+c);a||(d+=" (stub)");return d};a.people.toString=function(){return a.toString(1)+".people (stub)"};i="disable time_event track track_pageview track_links track_forms register register_once alias unregister identify name_tag set_config reset people.set people.increment".split(" ");for(h=0;h<i.length;h++)g(a,i[h]);b._i.push([e,f,c])};b.__SV=1.2;e=f.createElement("script");e.type="text/javascript";e.async=!0;e.src="//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";g=f.getElementsByTagName("script")[0];g.parentNode.insertBefore(e,g)}})(document,window.mixpanel||[]);mixpanel.init("${pid}");`;
      if (pageEvent === 'Purchase' && data) {
        return `${init}mixpanel.track("Order Completed",${j({ order_id: data.orderId ?? '', revenue: data.value ?? 0, currency: data.currency ?? 'CZK' })});`;
      }
      return `${init}mixpanel.track("Page View");`;
    },
  },

  amplitude: {
    id: 'amplitude', name: 'Amplitude',
    category: 'analytics_product', icon: '📈', placeholder: 'abcdef1234567890',
    configFields: [], defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(pixelId, _cfg, pageEvent, data) {
      const pid = s(pixelId);
      const init = `(function(e,t){var r=e.amplitude||{_q:[],_iq:{}};if(r.invoked){e.console&&console.error&&console.error("Amplitude snippet has been loaded.");return}function n(e,t){e.prototype[t]=function(){return this._q.push({name:t,args:Array.prototype.slice.call(arguments,0)}),this}}function s(e,t,r){return function(n){e._q.push({name:t,args:[r,n]})}}var o=function(){this._q=[];return this};n(o,"add");n(o,"append");n(o,"clearAll");n(o,"prepend");n(o,"set");n(o,"setOnce");n(o,"unset");n(o,"preInsert");n(o,"postInsert");n(o,"remove");n(o,"getUserProperties");r.Identify=o;r.Revenue=o;var i=function(){this._q=[]};n(i,"setProductId");n(i,"setQuantity");n(i,"setPrice");n(i,"setRevenue");n(i,"setEventProperties");r.Revenue=i;var a=["init","logEvent","logRevenue","setUserId","setUserProperties","setOptOut","setVersionName","setDomain","setDeviceId","enableTracking","setGlobalUserProperties","identify","clearUserProperties","setGroup","logRevenueV2","regenerateDeviceId","groupIdentify","onInit","onNewSessionStart","logEventWithTimestamp","logEventWithGroups","setSessionId","resetSessionId","getDeviceId","getUserId","setMinTimeBetweenSessionsMillis","addEventMiddleware","ampRemoveEventMiddleware","setEventUploadThreshold","addChannelMappings"];for(var c=0;c<a.length;c++){r[a[c]]=s(r,a[c],a[c])}r.getInstance=function(e){return e=(!e||e.length===0?"$default_instance":e).toLowerCase(),Object.prototype.hasOwnProperty.call(r._iq,e)||(r._iq[e]={_q:[]},n(r._iq[e],"init")),r._iq[e]};e.amplitude=r})(window,document);amplitude.getInstance().init("${pid}");`;
      if (pageEvent === 'Purchase' && data) {
        return `${init}amplitude.getInstance().logEvent("Order Completed",${j({ order_id: data.orderId ?? '', revenue: data.value ?? 0, currency: data.currency ?? 'CZK' })});`;
      }
      return `${init}amplitude.getInstance().logEvent("Page Viewed",${j({ page: window.location.pathname })});`;
    },
  },

  // ─── Custom ───────────────────────────────────────────────────────────────

  custom_script: {
    id: 'custom_script', name: 'Custom Script',
    category: 'custom', icon: '⚙️', placeholder: 'Vlastní ID nebo popis',
    configFields: [
      { key: 'scriptContent', label: 'JavaScript kód', type: 'textarea', required: true, placeholder: '// sem vlož svůj tracking kód', hint: 'Kód se spustí jako afterInteractive script. Nepoužívej <script> tagy.' },
    ],
    defaultEvents: ['ViewContent','InitiateCheckout','Purchase'], hasServerSide: false,
    buildScript(_pixelId, cfg, _pageEvent, _data) {
      const code = cfg.scriptContent ?? '';
      if (!code.trim()) return null;
      // Basic XSS guard: reject if contains </script
      if (/(<\/script|javascript:)/i.test(code)) return null;
      return code;
    },
  },

  custom_image: {
    id: 'custom_image', name: 'Custom Image Pixel (1×1)',
    category: 'custom', icon: '🖼️', placeholder: 'Popis pixelu',
    configFields: [
      { key: 'imageUrl', label: 'URL obrázku (1×1 px)', type: 'text', required: true, placeholder: 'https://example.com/pixel.gif?id=123', hint: 'URL tracking pixelu — typicky .gif nebo .png' },
    ],
    defaultEvents: ['ViewContent','Purchase'], hasServerSide: false,
    buildScript(_pixelId, cfg, _pageEvent, _data) {
      const url = cfg.imageUrl ?? '';
      if (!url.startsWith('https://')) return null;
      const safeUrl = url.replace(/['"<>]/g, '');
      return `(function(){var i=new Image(1,1);i.src="${safeUrl}";})();`;
    },
  },
};

export const PIXEL_CATEGORIES: Record<string, string> = {
  advertising: 'Reklamní platformy',
  analytics: 'Analytika & CRO',
  automation: 'Marketing automation',
  analytics_product: 'Produktová analytika',
  custom: 'Vlastní',
};

export const ALL_PIXEL_TYPES = Object.values(PIXEL_REGISTRY);

export type PixelPlatform = keyof typeof PIXEL_REGISTRY;
