"use strict";
/* NovelForge UI Redesign v3 — custom control view layer.
   Loaded after v3-views.js and before app.js. Replaces every visible native
   control (select / range) with custom-drawn markup, and extends the command
   palette with v3 work-mode commands. */
(function (NF) {
  const V = NF.views;
  const prev = {};
  Object.keys(V).forEach(function (k) { prev[k] = V[k]; });
  const T = function (k) { return NF.t(k); };
  const X = function (v) { return NF.tx(v); };
  const I = function (n, c) { return NF.icon(n, c); };
  const E = function (v) { return NF.esc(v); };
  const S = function () { return NF.state; };
  const D = NF.D;

  /* Custom dropdown (used for the language switch on the review stage). */
  function dropdown(id, label, options, current, iconName) {
    const selected = options.find(function (o) { return String(o.value) === String(current); }) || options[0];
    return '<div class="nf-select" data-select="' + E(id) + '">' +
      '<button class="nf-select-trigger" data-select-trigger="' + E(id) + '" aria-haspopup="listbox" aria-expanded="false" aria-label="' + E(label) + '">' +
      (iconName ? I(iconName, "sm") : '') + '<span data-select-label>' + E(X(selected.name)) + '</span>' + I("chevron", "caret") + '</button>' +
      '<div class="nf-select-menu" role="listbox" aria-label="' + E(label) + '">' +
      '<div class="nf-select-caption">' + E(label) + '</div>' +
      options.map(function (o) {
        const on = String(o.value) === String(current);
        return '<button class="nf-option" role="option" aria-selected="' + on + '" data-action="' + E(o.action) + '" data-value="' + E(o.value) + '">' +
          (o.icon ? I(o.icon, "sm") : '') + '<span>' + E(X(o.name)) + '</span>' + I("check", "tick") + '</button>';
      }).join('') + '</div></div>';
  }

  /* Custom slider markup; behaviour lives in v3-controls-runtime.js. */
  function slider(action, label, out, max, value) {
    const unit = String(out).replace(/^\d+/, '');
    const pct = Math.max(0, Math.min(100, Math.round(Number(value) / Number(max) * 100)));
    return '<div class="nf-slider" data-slider="' + E(action) + '" data-min="0" data-max="' + E(max) + '" data-value="' + E(value) + '" data-unit="' + E(unit) + '" tabindex="0" role="slider" aria-label="' + E(label) + '" aria-valuemin="0" aria-valuemax="' + E(max) + '" aria-valuenow="' + E(value) + '">' +
      '<div class="nf-slider-label"><span>' + E(label) + '</span><output class="nf-slider-output">' + E(out) + '</output></div>' +
      '<div class="nf-slider-track"><div class="nf-slider-fill" style="width:' + pct + '%"></div>' +
      '<div class="nf-slider-thumb" style="left:' + pct + '%"></div></div>' +
      '<div class="nf-slider-hint">' + E(T("sliderHint")) + '</div></div>';
  }

  /* 1. Review stage: replace the native <select> with a custom dropdown. */
  const prevStage = prev.stage;
  V.stage = function () {
    const g = prevStage();
    const langs = [
      { value: 0, name: ["中文", "中文", "Китайский"], action: "locale" },
      { value: 1, name: ["English", "English", "Английский"], action: "locale" },
      { value: 2, name: ["Русский", "Russian", "Русский"], action: "locale" }
    ];
    const html = dropdown("locale", T("langMenuTitle"), langs, S().locale, "language");
    g.controls = String(g.controls).replace(/<select data-action="locale"[\s\S]*?<\/select>/, html);
    g.iconKicker = E(T("iconMapKicker"));
    g.iconTitle = E(T("iconMapTitle"));
    g.iconDesc = E(T("iconMapDesc"));
    g.iconMap = (NF.V3.iconGroups || []).map(function (group) {
      return '<div class="icon-group-card tone-' + E(group.tone) + '"><h3>' + E(X(group.title)) +
        '<small>' + group.items.length + ' / group</small></h3>' +
        group.items.map(function (item) {
          return '<div class="icon-entry"><span class="icon-glyph">' + I(item.icon) + '</span>' +
            '<span><strong>' + E(X(item.label)) + '</strong><code>' + E(item.icon) + '</code></span></div>';
        }).join('') + '</div>';
    }).join('');
    return g;
  };

  /* 2. Appearance panel: custom sliders + a custom-controls section. */
  const prevAppearance = prev.appearance;
  V.appearance = function () {
    let html = prevAppearance();
    html = html.replace(
      /<div class="range-control"><div class="row"><span>([^<]*)<\/span><output>([^<]*)<\/output><\/div><input type="range" data-action="([^"]+)" min="0" max="(\d+)" step="1" value="(\d+)"><\/div>/g,
      function (all, label, out, action, max, value) { return slider(action, label, out, max, value); }
    );
    const st = S();
    const themes = [
      { id: "light", name: ["浅色", "Light", "Светлая"] }, { id: "galaxy", name: ["星空", "Galaxy", "Галактика"] },
      { id: "paper", name: ["纸质", "Paper", "Бумага"] }, { id: "dark", name: ["黑夜", "Dark", "Тёмная"] }
    ].map(function (o) {
      return '<button class="chip' + (st.theme === o.id ? ' active' : '') + '" data-action="theme-set" data-value="' + o.id + '">' + E(X(o.name)) + '</button>';
    }).join('');
    const models = ["elite", "standard", "budget", "local"].map(function (m) {
      return '<button class="chip' + (st.model === m ? ' active' : '') + '" data-action="model-set" data-value="' + m + '">' + E(m) + '</button>';
    }).join('');
    const section = '<fieldset class="appearance-section"><legend>' + E(T("customSectionTitle")) + '</legend>' +
      '<div class="switch-row"><span>' + E(T("reduceMotionLabel")) + '</span>' +
      '<button class="switch' + (st.reduceMotion ? ' on' : '') + '" data-action="reduce-motion-toggle" role="switch" aria-checked="' + !!st.reduceMotion + '" aria-label="' + E(T("reduceMotionLabel")) + '"></button></div>' +
      '<div class="row" style="flex-wrap:wrap;gap:4px;margin-top:8px"><span class="kicker">' + E(T("themePresetLabel")) + '</span></div>' +
      '<div class="row" style="flex-wrap:wrap;gap:4px">' + themes + '</div>' +
      '<div class="row" style="flex-wrap:wrap;gap:4px;margin-top:8px"><span class="kicker">' + E(T("modelMenuTitle")) + '</span></div>' +
      '<div class="row" style="flex-wrap:wrap;gap:4px">' + models + '</div>' +
      '<div class="appearance-description muted" style="font-size:11px;line-height:1.7;margin-top:8px">' + E(T("customSectionNote")) + '</div></fieldset>';
    return html.replace('<div class="appearance-foot">', section + '<div class="appearance-foot">');
  };

  /* 3. Settings workbench: grouped nav + section dashboard + card grid. */
  function rowIcon(label) {
    const text = X(label);
    const rules = NF.V3.settingRowIconRules || [];
    for (let i = 0; i < rules.length; i++) {
      try { if (new RegExp(rules[i][0], "i").test(text)) return rules[i][1]; } catch (err) { /* skip bad rule */ }
    }
    return "sliders";
  }

  function settingRow(sec, row, key) {
    const st = S();
    const on = !!(st.settingsToggles && st.settingsToggles[key]);
    const stored = st.settingsValues && st.settingsValues[key];
    const value = stored || X(row.value);
    const label = X(row.label);
    const control = row.toggle
      ? '<span class="set-switch-wrap"><span class="set-switch-state' + (on ? ' on' : '') + '">' +
        E(T(on ? "setOn" : "setOff")) + '</span>' +
        '<button class="switch' + (on ? ' on' : '') + '" data-action="settings-toggle" data-value="' + E(key) +
        '" role="switch" aria-checked="' + on + '" aria-label="' + E(label) + '"></button></span>'
      : '<button class="set-value" data-action="settings-edit" data-value="' + E(key) + '" title="' + E(T("setEditTitle")) + '">' +
        '<span class="set-value-copy"><small>' + E(T("setCurrentValue")) + '</small><span title="' + E(value) + '">' + E(value) + '</span></span>' +
        I("edit", "sm") + '</button>';
    /* The label text needs its own shrinkable box; an anonymous flex item is
       clipped mid-glyph by the value capsule instead of ellipsising. */
    return '<div class="set-row"><span class="set-row-label"><span class="set-row-icon">' +
      I(rowIcon(row.label)) + '</span><span class="set-row-text" title="' + E(label) + '">' + E(label) + '</span></span>' +
      '<span class="set-row-control">' + control + '</span></div>';
  }

  function settingCard(title, desc, icon, sec, rows, offset, span, index) {
    return '<div class="set-card' + (span ? ' span-2' : '') + '" style="--i:' + index + '">' +
      '<div class="set-card-head"><span class="set-card-icon">' + I(icon) + '</span>' +
      '<div><h4>' + E(X(title)) + '</h4><p>' + E(X(desc)) + '</p></div>' +
      '<span class="set-card-count">' + rows.length + '</span></div><div class="set-rows">' +
      rows.map(function (row, i) { return settingRow(sec, row, sec.id + ':' + (offset + i)); }).join('') +
      '</div></div>';
  }

  function settingsGroupOf(id) {
    return (NF.V3.settingsGroups || []).find(function (g) { return g.items.indexOf(id) !== -1; });
  }
  function settingsToneFor(id) {
    const group = settingsGroupOf(id);
    return group ? ((NF.V3.settingsGroupTones || {})[group.id] || "brand") : "brand";
  }
  function settingsToneVar(tone) {
    return 'var(--nf-color-' + tone + ', var(--nf-color-brand))';
  }

  /* Navigation is built once per dialog; switching sections only toggles
     the active class (see updateSettings in app.js). No counters, no arrows. */
  function settingsNavMarkup() {
    const st = S();
    const groups = (NF.V3.settingsGroups || []).map(function (group, gi) {
      const tone = settingsToneFor(group.items[0]);
      const items = group.items.map(function (id) {
        const sec = D.settingsSections.find(function (x) { return x.id === id; });
        if (!sec) return '';
        const haystack = [sec.name.join(' '), sec.hint ? sec.hint.join(' ') : ''].join(' ').toLowerCase();
        return '<button class="set-nav-item' + (st.settingsSection === id ? ' active' : '') +
          '" data-tone="' + tone + '" data-action="settings-section" data-value="' + E(id) +
          '" data-search="' + E(haystack) + '">' +
          '<span class="set-nav-glyph">' + I(sec.icon) + '</span>' +
          '<span class="set-nav-copy"><strong>' + E(X(sec.name)) + '</strong><small>' +
          E(X(sec.hint || ['', '', ''])) + '</small></span></button>';
      }).join('');
      return '<div class="set-nav-group" data-tone="' + tone + '" style="--i:' + gi + '">' +
        '<div class="set-nav-label">' + I(group.icon, "sm") + '<span>' + E(X(group.title)) + '</span></div>' +
        items + '</div>';
    }).join('');
    /* type=text on purpose: type=search draws a second, native clear button in
       Chromium. Only our own clear button is visible, and only while filtering. */
    return '<aside class="set-nav scroll"><div class="set-search"><label class="field">' +
      I("search", "sm") + '<input type="text" data-action="settings-search" autocomplete="off" spellcheck="false" placeholder="' +
      E(T("settingsSearch")) + '" aria-label="' + E(T("settingsSearch")) + '"></label>' +
      '<button class="set-clear" data-action="settings-clear" hidden title="' + E(T("setSearchClear")) +
      '" aria-label="' + E(T("setSearchClear")) + '">' + I("close", "sm") + '</button></div>' +
      '<div class="set-nav-kicker"><span>' + E(T("setNavKicker")) + '</span></div>' +
      '<div class="set-nav-groups">' + groups + '</div>' +
      '<div class="set-nav-foot"><strong>' + E(T("pageMemory")) + '</strong>' + E(T("setSearchNote")) + '</div></aside>';
  }

  /* Pane markup is reusable so a section switch replaces only this column. */
  function settingsPaneMarkup() {
    const st = S();
    const sec = D.settingsSections.find(function (x) { return x.id === st.settingsSection; }) || D.settingsSections[0];
    const group = settingsGroupOf(sec.id);
    const toggles = sec.rows.filter(function (r) { return r.toggle; }).length;
    const enabled = sec.rows.filter(function (r, i) { return r.toggle && st.settingsToggles[sec.id + ':' + i]; }).length;
    const metric = function (label, value, ratio) {
      return '<div class="set-metric"><span>' + E(X(label)) + '</span><strong>' + E(value) +
        '</strong><div class="set-metric-bar"><span style="width:' + Math.max(0, Math.min(100, Math.round(ratio))) + '%"></span></div></div>';
    };
    const half = Math.ceil(sec.rows.length / 2);
    const cards =
      (sec.id === 'usage' ? '<div class="set-card span-2 usage-card" style="--i:0">' +
        (typeof V.usagePanel === "function" ? V.usagePanel() : '') + '</div>' : '') +
      (sec.id === 'llm' ? '<div class="set-card span-2" style="--i:0">' +
        '<div class="set-card-head"><span class="set-card-icon">' + I("layers") + '</span><div><h4>' +
        E(T("setRouteTitle")) + '</h4><p>' + E(T("setRouteDesc")) + '</p></div>' +
        '<span class="set-card-count">3</span></div><div class="set-route-grid">' +
        (NF.V3.routeOptions || []).map(function (o) {
          const active = (st.modelRoute || 'elite') === o.id;
          return '<button class="set-route' + (active ? ' active' : '') + '" data-action="model-route" data-value="' + E(o.id) + '">' +
            '<span class="set-route-head">' + I(o.icon) + I("check", "tick") + '</span>' +
            '<strong>' + E(X(o.name)) + '</strong><small>' + E(o.id) + '</small><code>' + E(o.model) + '</code>' +
            (active ? '<span class="set-route-default">' + E(T("setDefaultRoute")) + '</span>' : '') + '</button>';
        }).join('') + '</div></div>' : '') +
      settingCard(T("setCoreTitle"), T("setCoreDesc"), sec.icon, sec, sec.rows.slice(0, half), 0, false, 1) +
      settingCard(T("setAdvancedTitle"), T("setAdvancedDesc"), "sliders", sec, sec.rows.slice(half), half, false, 2);

    return '<section class="set-pane scroll" id="settings-pane">' +
      '<header class="set-head"><span class="set-head-watermark">' + I(sec.icon) + '</span>' +
      '<span class="set-head-glyph">' + I(sec.icon) + '</span>' +
      '<div class="set-head-copy"><div class="kicker">SETTINGS / ' + E(sec.id.toUpperCase()) +
      (group ? ' · ' + E(X(group.title)) : '') + '</div>' +
      '<h3>' + E(X(sec.name)) + '</h3><p>' + E(X(sec.desc)) + '</p></div>' +
      '<div class="set-head-state">' + NF.badge(T("setStateValue"), "brand") +
      NF.badge(String(sec.rows.length) + ' ' + T("setConfigCount")) + '</div></header>' +
      '<div class="set-summary">' + metric(T("setConfigCount"), sec.rows.length, 100) +
      metric(T("setSwitchCount"), toggles, sec.rows.length ? toggles / sec.rows.length * 100 : 0) +
      metric(T("setEnabledCount"), enabled, toggles ? enabled / toggles * 100 : 0) +
      metric(T("setStateLabel"), T("setStateValue"), 100) + '</div>' +
      '<div class="set-grid">' + cards + '</div>' +
      '<div class="set-foot-note"><strong>' + E(T("setNoteTitle")) + '</strong>' + E(T("setDialogNote")) + '</div></section>';
  }

  /* Exposed to app.js for partial, flicker-free updates. */
  V.settingsPane = settingsPaneMarkup;
  V.settingsNav = settingsNavMarkup;
  V.settingsTone = function () { return settingsToneFor(S().settingsSection); };

  function settingsModal() {
    const st = S();
    const tone = settingsToneFor(st.settingsSection);
    return { compact: false, html: prev.modalHead(T("settingsTitle")) +
      '<div class="set-layout" data-tone="' + tone + '" data-animate="enter" style="--nf-set-tone:' + settingsToneVar(tone) + '">' +
      settingsNavMarkup() + settingsPaneMarkup() + '</div>' +
      prev.modalFoot(st.settingsDirty ? T("settingsDirty") : T("setDialogNote"),
        NF.btn(T("done"), { action: "modal-close", cls: "sm primary" })) };
  }

  function settingEditModal(data) {
    const key = String(data.key || '');
    const parts = key.split(':');
    const sec = D.settingsSections.find(function (x) { return x.id === parts[0]; });
    const row = sec && sec.rows[Number(parts[1])];
    const current = (S().settingsValues && S().settingsValues[key]) || (row ? X(row.value) : '');
    return { compact: true, html: prev.modalHead(T("setEditTitle")) +
      '<div class="modal-body"><div class="set-edit-body">' +
      '<div class="set-edit-field"><span>' + E(T("setEditLabel")) + (row ? ' · ' + E(X(row.label)) : '') +
      '</span><input id="setting-edit-input" value="' + E(current) + '" aria-label="' + E(T("setEditLabel")) + '"></div>' +
      '<p class="set-edit-note">' + E(T("setMemoryNote")) + '</p></div></div>' +
      prev.modalFoot(T("demoOnly"), NF.btn(T("cancel"), { action: "modal-close", cls: "sm" }) +
        NF.btn(T("setEditSave"), { action: "setting-edit-save", value: key, cls: "sm primary" })) };
  }

  /* New-chapter dialog keeps its custom chips; settings is fully redesigned. */
  const prevModal = prev.modal;
  V.modal = function (kind, data) {
    if (kind === "settings") return settingsModal();
    if (kind === "setting-edit") return settingEditModal(data || {});
    const out = prevModal(kind, data);
    if (kind === "new-chapter" && out && out.html) {
      const chips = '<div class="row" style="gap:6px;flex-wrap:wrap">' +
        '<button class="chip active" data-action="chapter-kind" data-value="draft">' + E(T("chapterKindDraft")) + '</button>' +
        '<button class="chip" data-action="chapter-kind" data-value="blueprint">' + E(T("chapterKindBlueprint")) + '</button></div>';
      out.html = out.html.replace(/<div class="modal-field"><span>[^<]*<\/span><select>[\s\S]*?<\/select><\/div>/,
        '<div class="modal-field"><span>' + E(T("chapterKindLabel")) + '</span>' + chips + '</div>');
    }
    return out;
  };

  /* 4. Command palette: stagger + a v3 workbench command group. */
  const extraCommands = [
    { name: ["切换到写作态", "Switch to Compose", "В режим Текст"], icon: "edit", hint: "work:compose", kbd: "Ctrl M" },
    { name: ["切换到构建态", "Switch to Forge", "В режим Сборка"], icon: "layers", hint: "work:forge", kbd: "Ctrl M" },
    { name: ["恒亮暖稿纸", "Always-light sheet", "Всегда светлый лист"], icon: "book", hint: "paper:light" },
    { name: ["稿纸跟随模式", "Sheet follows mode", "Лист за режимом"], icon: "sun", hint: "paper:auto" },
    { name: ["打开设计系统", "Open design system", "Открыть дизайн-систему"], icon: "palette", hint: "tab:tokens" },
    { name: ["打开概览", "Open overview", "Открыть обзор"], icon: "home", hint: "tab:overview" }
  ];
  const prevResults = prev.commandResults;
  V.commandResults = function (query) {
    const q = String(query || "").trim().toLowerCase();
    let html = prevResults(q);
    if (html.indexOf('class="empty"') !== -1) html = '';
    let index = 0;
    html = html.replace(/<button class="command-row/g, function () {
      return '<button style="--i:' + (index++) + '" class="command-row';
    });
    const matches = extraCommands.filter(function (c) {
      return !q || X(c.name).toLowerCase().indexOf(q) !== -1 || c.hint.toLowerCase().indexOf(q) !== -1;
    });
    if (!matches.length) return html || '<div class="empty">' + E(T("cmdEmpty")) + '</div>';
    html += '<div class="command-group">' + E(T("commandGroupWorkspace")) + '</div>' + matches.map(function (c) {
      return '<button style="--i:' + (index++) + '" class="command-row" data-action="command-run" data-value="' + E(c.hint) + '">' +
        I(c.icon) + '<span>' + E(X(c.name)) + '</span>' + (c.kbd ? '<kbd>' + E(c.kbd) + '</kbd>' : '') + '</button>';
    }).join('');
    return html;
  };

  NF.customControls = { dropdown: dropdown, slider: slider };

})(window.NF);
