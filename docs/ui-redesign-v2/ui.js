"use strict";
/* NovelForge UI Redesign v2 — primitives: icons, translation, markup helpers.
   Everything renders as HTML strings; app.js owns state and event delegation. */
(function (NF) {

  /* 24×24 stroke icons, all currentColor. */
  const P = {
    home: '<path d="M3 10.6 12 3l9 7.6"/><path d="M5.5 9.4V21h13V9.4"/><path d="M10 21v-6h4v6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    book: '<path d="M4 4.6A2.6 2.6 0 0 1 6.6 2H20v18H6.6A2.6 2.6 0 0 0 4 22z"/><path d="M8 7h8M8 11h6"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1.5A5.5 5.5 0 0 1 8.5 13h1A5.5 5.5 0 0 1 15 18.5V20"/><path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 20v-1.5a5.5 5.5 0 0 0-2-4.2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"/>',
    tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.3 1.3L6.5 5M3 12l1.3 1.3L6.5 11M3 18l1.3 1.3L6.5 17"/>',
    log: '<path d="M5 3h9l5 5v13H5z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
    activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    spark: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2L22 19.7l-2.3.7L19 22.6l-.7-2.2-2.3-.7 2.3-.7z"/>',
    output: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    focus: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M22 12h-2M4 12H2M18.4 5.6 17 7M7 17l-1.4 1.4M18.4 18.4 17 17M7 7 5.6 5.6"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.2H19a2 2 0 0 0 2-2A9 9 0 0 0 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    caret: '<path d="m8 10 4 4 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16 9.5"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8A3 3 0 0 0 8 18a3 3 0 0 0 4 2V4z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8A3 3 0 0 1 16 18a3 3 0 0 1-4 2"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    maximize: '<rect x="4" y="4" width="16" height="16" rx="1"/>',
    minimize: '<path d="M5 12h14"/>',
    restore: '<path d="M8 4h12v12"/><rect x="4" y="8" width="12" height="12" rx="1"/>',
    download: '<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>',
    upload: '<path d="M12 17V5M7 9l5-5 5 5M4 20h16"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    refresh: '<path d="M20 7a8 8 0 1 0 1 5"/><path d="M20 3v4h-4"/>',
    branch: '<circle cx="7" cy="5" r="2"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="9" r="2"/><path d="M7 7v10M17 11v2a4 4 0 0 1-4 4H7"/>',
    save: '<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="m14 6 4 4"/>',
    compare: '<path d="M12 3v18M5 6h4M5 12h4M5 18h4M15 6h4M15 12h4M15 18h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    cards: '<rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/>',
    board: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M15 4v16"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="m7 9 3 3-3 3M13 15h4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17v.5"/>',
    eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z"/><path d="M12 17v4"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.5M10 10h.5M14 10h.5M18 10h.5M6 14h12"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
    link: '<path d="M10 14a4 4 0 0 0 6 0l2-2a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-2 2a4 4 0 0 0 6 6l1-1"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    wand: '<path d="m4 20 12-12 3 3L7 23z" transform="translate(0,-2)"/><path d="M16 3v3M21 6h-3M17 2l1 2M6 3v3M9 6H6"/>',
    message: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    context: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    external: '<path d="M13 4h7v7M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    language: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21M12 3c-2.5 2.5-3.5 5.5-3.5 9S9.5 18.5 12 21"/>'
  };

  NF.icon = function (name, cls) {
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[name] || P.info) + '</svg>';
  };

  NF.esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* All user-visible copy goes through t(); source content does not. */
  NF.t = function (key) {
    const v = NF.S[key];
    if (Array.isArray(v)) return v[NF.state.locale] || v[0];
    return typeof v === 'string' ? v : String(key);
  };

  /* Accepts either a key, a three-language array, or plain source text. */
  NF.tx = function (value) {
    if (Array.isArray(value)) return value[NF.state.locale] || value[0];
    if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(NF.S, value)) return NF.t(value);
    return value == null ? '' : String(value);
  };

  NF.fmt = function (key, vars) {
    let out = NF.t(key);
    Object.keys(vars || {}).forEach(function (k) { out = out.replace('{' + k + '}', String(vars[k])); });
    return out;
  };

  NF.ib = function (name, action, title, cls, value) {
    return '<button class="icon-btn ' + (cls || '') + '" data-action="' + NF.esc(action) + '"' +
      (value != null ? ' data-value="' + NF.esc(value) + '"' : '') +
      ' title="' + NF.esc(NF.tx(title)) + '" aria-label="' + NF.esc(NF.tx(title)) + '">' + NF.icon(name) + '</button>';
  };

  NF.btn = function (label, opts) {
    const o = opts || {};
    return '<button class="btn ' + (o.cls || '') + '"' +
      (o.action ? ' data-action="' + NF.esc(o.action) + '"' : '') +
      (o.value != null ? ' data-value="' + NF.esc(o.value) + '"' : '') +
      (o.id ? ' id="' + NF.esc(o.id) + '"' : '') +
      (o.title ? ' title="' + NF.esc(NF.tx(o.title)) + '"' : '') + '>' +
      (o.icon ? NF.icon(o.icon) : '') + '<span>' + NF.esc(NF.tx(label)) + '</span>' +
      (o.kbd ? '<kbd>' + NF.esc(o.kbd) + '</kbd>' : '') + '</button>';
  };

  NF.badge = function (label, kind) {
    return '<span class="badge ' + (kind || '') + '">' + NF.esc(NF.tx(label)) + '</span>';
  };

  NF.segment = function (items, active, action) {
    return '<div class="segment">' + items.map(function (item) {
      return '<button data-action="' + NF.esc(action) + '" data-value="' + NF.esc(item.id) + '"' +
        (item.id === active ? ' class="active"' : '') + '>' + NF.esc(NF.tx(item.name || NF.tx(item.label))) + '</button>';
    }).join('') + '</div>';
  };

  NF.toast = function (message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = NF.tx(message);
    el.classList.add('visible');
    clearTimeout(NF._toastTimer);
    NF._toastTimer = setTimeout(function () { el.classList.remove('visible'); }, 2800);
  };

  NF.uid = (function () { let n = 0; return function (prefix) { return (prefix || 'id') + '-' + (++n); }; })();

})(window.NF);
