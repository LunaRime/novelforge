"use strict";
/* NovelForge UI Redesign v3 / Editorial Workbench — application logic.
   v2 workbench + v1 editorial loop + two work modes.
   All state is in-memory. No file, database, network or model access. */
(function (NF) {
  const S = NF.state;
  const V = NF.views;
  const D = NF.D;
  const T = function (k) { return NF.t(k); };
  const X = function (v) { return NF.tx(v); };
  const $ = function (id) { return document.getElementById(id); };

  Object.assign(S, {
    locale: 0, view: "project", contextCollapsed: false, assistantCollapsed: false,
    aiTab: "agent", partnerTab: "suggestions", partnerChat: [], composer: "",
    runtimeTab: "tasks", runtimeCollapsed: false, focus: false,
    workMode: "forge", paper: "auto", reduceMotion: false,
    settingsValues: {}, modelRoute: "elite",
    activeTab: "chapter", chapter: 7,
    tabs: [
      { id: "chapter", type: "chapter", chapter: 7 },
      { id: "overview", type: "overview", label: ["概览", "Overview", "Обзор"] },
      { id: "board", type: "board", label: ["章节看板", "Chapter board", "Доска глав"] },
      { id: "review", type: "review", label: ["审阅", "Review", "Рецензия"] },
      { id: "timeline", type: "timeline", label: ["世界观时间线", "World timeline", "Хронология мира"] },
      { id: "tokens", type: "tokens", label: ["设计系统", "Design system", "Дизайн-система"] }
    ],
    /* v1 editorial loop: per-chapter drafts, dirty/confirmed flags,
       per-proposal decisions and pre-restore memory backups. */
    draft: {}, dirty: {}, confirmed: {}, backups: {}, backup: null,
    decisions: [null, null], finalized: [1, 2, 3, 4], saveState: "saved",
    treeCollapsed: {}, treeFilter: "", kbFilter: "", charFilter: "", kbMode: 0, topK: 6,
    boardView: "card", activeTreeNode: null,
    mode: "light", palette: "jade", density: "normal", writingSize: "18",
    theme: "light", bg: "grid", bgImageData: null, bgImageName: null,
    bgStrength: 0.6, bgVeil: 10, bgBlur: 0, measure: 720, measureOverride: false,
    appearanceOpen: false, maximized: false, minimized: false,
    zoom: 100, cost: "¥ 0.42", model: "elite", thinking: "L2",
    settingsSection: "llm", settingsToggles: {}, settingsDirty: false,
    aiMessages: [], notesDismissed: false, logs: null,
    typewriter: true, paragraphFocus: false,
    modalKind: null, modalTrigger: null, commandQuery: ""
  });

  const TAB_LABELS = {
    board: ["章节看板", "Chapter board", "Доска глав"], review: ["审阅报告", "Review report", "Рецензия"],
    timeline: ["世界观时间线", "World timeline", "Хронология мира"], versions: ["版本历史", "Version history", "История версий"],
    memory: ["AI 记忆", "AI memory", "Память ИИ"], knowledge: ["检索总览", "Retrieval overview", "Обзор поиска"],
    character: ["角色档案", "Character card", "Карточка героя"], config: ["小说配置", "Novel config", "Настройки романа"],
    blueprint: ["章节蓝图", "Chapter blueprint", "План главы"], publication: ["连载监控", "Serial monitor", "Мониторинг публикаций"],
    diff: ["三栏合并", "Three-way merge", "Трёхстороннее слияние"], welcome: ["欢迎", "Welcome", "Приветствие"],
    overview: ["概览", "Overview", "Обзор"], tokens: ["设计系统", "Design system", "Дизайн-система"]
  };

  let refs = {};
  let lastTrigger = null;

  function initRefs() {
    refs = {
      stage: $("review-stage"), window: $("program-window"), titlebar: $("window-titlebar"),
      content: $("window-content"), app: $("app"), appearance: $("appearance-panel"),
      placeholder: $("window-placeholder"), modal: $("modal"), toast: $("toast")
    };
  }

  /* ------------------------------------------------------------- rendering */
  function renderStage() {
    const g = V.stage();
    $("showcase-kicker").innerHTML = g.kicker;
    $("showcase-title").innerHTML = g.title;
    $("showcase-subtitle").innerHTML = g.subtitle;
    $("showcase-controls").innerHTML = g.controls;
    $("brief-title").innerHTML = g.briefTitle;
    $("brief-grid").innerHTML = g.brief;
    $("comparison-kicker").innerHTML = g.comparisonKicker;
    $("comparison-title").innerHTML = g.comparisonTitle;
    $("comparison-desc").innerHTML = g.comparisonDesc;
    $("comparison-grid").innerHTML = g.comparison;
    $("icon-map-kicker").innerHTML = g.iconKicker;
    $("icon-map-title").innerHTML = g.iconTitle;
    $("icon-map-desc").innerHTML = g.iconDesc;
    $("icon-map-grid").innerHTML = g.iconMap;
    $("feature-map-kicker").innerHTML = g.mapKicker;
    $("feature-map-title").innerHTML = g.mapTitle;
    $("feature-map-desc").innerHTML = g.mapDesc;
    $("feature-legend").innerHTML = g.legend;
    $("feature-map-grid").innerHTML = g.cards;
    $("feature-backend").innerHTML = '<strong>' + g.backendTitle + '</strong><p>' + g.backendDesc + '</p>' +
      '<div class="row" style="flex-wrap:wrap">' + g.backendChips + '</div>';
    $("showcase-footer").innerHTML = g.footer;
  }

  function skeleton() {
    refs.app.innerHTML =
      '<div class="app-shell" id="app-shell">' +
      '<div class="title-strip" id="title-strip"></div>' +
      '<div class="workbench" id="workbench">' +
      '<nav class="rail" id="rail" aria-label="Activity rail"></nav>' +
      '<aside class="context" id="context"></aside>' +
      '<section class="workspace" id="workspace">' +
      '<div class="editor-area" id="editor-area">' +
      '<div class="tab-bar" id="tab-bar"></div>' +
      '<div class="editor-content" id="editor-content"></div></div>' +
      '<div class="runtime" id="runtime"></div></section>' +
      '<aside class="assistant" id="assistant"></aside></div>' +
      '<footer class="statusbar" id="statusbar"></footer></div>';
  }

  function renderTitlebar() { refs.titlebar.innerHTML = V.titlebar(); }
  function renderTitleStrip() { $("title-strip").innerHTML = V.titleStrip(); }
  function renderRail() { $("rail").innerHTML = V.rail(); }
  function renderContext() { $("context").innerHTML = V.context(); }
  function renderWorkspace() {
    $("tab-bar").innerHTML = V.tabBar();
    $("editor-content").innerHTML = V.workspace();
  }
  function renderRuntime() {
    $("runtime").innerHTML = V.runtime();
    $("workspace").dataset.runtime = S.runtimeCollapsed ? "collapsed" : "open";
  }
  function renderAssistant() { $("assistant").innerHTML = V.assistant(); }
  function renderStatusbar() { $("statusbar").innerHTML = V.statusbar(); }
  function renderAppearance() {
    refs.appearance.hidden = !S.appearanceOpen;
    if (S.appearanceOpen) refs.appearance.innerHTML = V.appearance();
  }
  function renderPlaceholder() {
    refs.placeholder.hidden = !S.minimized;
    if (S.minimized) refs.placeholder.innerHTML = V.placeholder();
  }

  function applyClasses() {
    const wb = $("workbench");
    if (!wb) return;
    wb.classList.toggle("context-collapsed", S.contextCollapsed);
    wb.classList.toggle("assistant-collapsed", S.assistantCollapsed);
    const width = refs.window.clientWidth;
    wb.classList.toggle("context-floating", !S.contextCollapsed && width <= 860);
    wb.classList.toggle("assistant-floating", !S.assistantCollapsed && width <= 1130);
    $("app-shell").classList.toggle("is-focus", S.focus);
    refs.stage.classList.toggle("is-maximized", S.maximized);
    refs.window.classList.toggle("is-minimized", S.minimized);
    if (NF.customScroll && typeof NF.customScroll.refresh === "function") NF.customScroll.refresh();
  }

  function renderAll() {
    renderTitlebar(); renderTitleStrip(); renderRail(); renderContext();
    renderWorkspace(); renderRuntime(); renderAssistant(); renderStatusbar();
    renderAppearance(); renderPlaceholder(); applyClasses(); applyAppearance();
  }

  /* ------------------------------------------------------------- appearance */
  function applyAppearance() {
    const w = refs.window;
    w.dataset.mode = S.mode;
    w.dataset.palette = S.palette;
    w.dataset.density = S.density;
    w.dataset.writingSize = S.writingSize;
    w.dataset.workmode = S.workMode;
    w.dataset.paper = S.paper;
    /* Work modes own the sheet width in CSS; a command can override it. */
    if (S.measureOverride) w.style.setProperty("--nf-layout-manuscript", S.measure + "px");
    else w.style.removeProperty("--nf-layout-manuscript");
    w.style.setProperty("--nf-bg-blur", S.bgBlur + "px");
    w.style.setProperty("--nf-bg-strength", String(S.bg === "image" ? S.bgStrength : S.bg === "mist" ? 0.55 : 0));
    w.style.setProperty("--nf-bg-veil", "color-mix(in srgb, var(--nf-color-overlay) " + S.bgVeil + "%, transparent)");
    w.style.setProperty("--nf-bg-surface-opacity", Math.max(60, 100 - Math.round(S.bgVeil * 0.6)) + "%");
    if (S.bg === "image" && S.bgImageData) {
      w.style.setProperty("--nf-bg-image", 'url("' + S.bgImageData + '")');
    } else if (S.bg === "mist") {
      w.style.setProperty("--nf-bg-image", "linear-gradient(135deg, var(--nf-color-info-soft), var(--nf-color-brand-soft), var(--nf-color-accent-soft))");
    } else {
      w.style.setProperty("--nf-bg-image", "none");
    }
    if (S.bg === "plain") w.style.setProperty("--nf-bg-grid-opacity", "0");
    else w.style.removeProperty("--nf-bg-grid-opacity");
    w.classList.toggle("has-wallpaper", S.bg === "image" || S.bg === "mist");
  }
  /* Exposed so the custom slider runtime can reapply tokens without knowing
     anything about this module's internals. */
  NF.applyAppearance = applyAppearance;

  /* View Transitions are deliberately disabled. Their top-layer snapshot of
     the manuscript remained visible after switching to another tab (and when
     switching back), which looked like a broken page. Updates stay synchronous;
     the sheet transitions its width in CSS instead. */
  function withTransition(fn) {
    fn();
    /* Re-sync custom scrollbars immediately so a bar from the previous tab
       never lingers over the new view. */
    if (NF.customScroll && typeof NF.customScroll.refresh === "function") NF.customScroll.refresh();
  }

  function applyTheme(id) {
    const map = {
      light: { mode: "light", palette: "jade" }, galaxy: { mode: "dark", palette: "cobalt" },
      paper: { mode: "light", palette: "ember" }, dark: { mode: "dark", palette: "jade" }
    };
    const t = map[id] || map.dark;
    S.theme = id; S.mode = t.mode; S.palette = t.palette;
    /* Tokens update in place; no mode-dependent markup in the title bar
       since the theme glyph is fixed, so avoid rebuilding those strips. */
    applyAppearance(); renderAppearance();
    NF.toast(["主题已切换 · " + id, "Theme switched · " + id, "Тема изменена · " + id]);
  }

  function setWritingSize(size) {
    S.writingSize = String(size);
    applyAppearance(); renderAppearance();
    NF.toast(T("demoOnly"));
  }

  /* --------------------------------------------------------- list popovers */
  /* Short, list-shaped informational dialogs become anchored list popovers.
     The <dialog> remains the top-layer container, so Esc / cancel, focus and
     the existing close actions keep working; only the surface changes. */
  const LIST_POPOVERS = {
    shortcuts: { icon: "keyboard", title: "shortcutHelp" },
    "dev-console": { icon: "terminal", title: "devConsole" },
    versions: { icon: "history", title: "versionTitle" },
    references: { icon: "link", title: "references" },
    info: { icon: "info", title: null }
  };

  function popoverModel(kind, data) {
    const d = data || {};
    const cfg = LIST_POPOVERS[kind] || LIST_POPOVERS.info;
    if (kind === "shortcuts") {
      return { icon: cfg.icon, title: T(cfg.title), rows: [
        { icon: "search", label: T("cmdPlaceholder"), value: "Ctrl+K" },
        { icon: "focus", label: T("focus"), value: "F11" },
        { icon: "settings", label: T("settingsTitle"), value: "Ctrl+," },
        { icon: "undo", label: T("undo") + " / " + T("redo"), value: "Ctrl+Z / Y" },
        { icon: "save", label: T("save"), value: "Ctrl+S" },
        { icon: "close", label: T("close"), value: "Esc" }
      ] };
    }
    if (kind === "dev-console") {
      return { icon: cfg.icon, title: T(cfg.title), rows: [
        { icon: "brain", label: T("contextBudget"), value: "46%" },
        { icon: "coin", label: T("sessionCost"), value: S.cost },
        { icon: "log", label: T("navLog"), value: "3" },
        { icon: "activity", label: T("activityTitle"), value: "1,284" }
      ] };
    }
    if (kind === "versions") {
      return { icon: cfg.icon, title: T(cfg.title), rows: [
        { icon: "history", label: T("initialVersion"), value: "read-only" },
        { icon: "save", label: T("backupRecover"), value: S.backups[S.chapter] ? "available" : "none" }
      ], actions: [{ label: T("restore"), icon: "restore", action: "restore-confirm" }] };
    }
    if (kind === "references") {
      return { icon: cfg.icon, title: T(cfg.title), rows: [
        { icon: "link", label: T("references"), value: "3" },
        { icon: "brain", label: T("contextBudget"), value: "46%" }
      ] };
    }
    return { icon: cfg.icon, title: X(d.title || T("appName")), rows: [
      { icon: "info", label: X(d.body || T("demoOnly")), value: "" }
    ] };
  }

  function listPopoverHTML(kind, data) {
    const m = popoverModel(kind, data);
    const rows = m.rows.map(function (r, i) {
      return '<div class="lp-row" style="--i:' + i + '">' +
        '<span class="lp-glyph">' + NF.icon(r.icon || "info") + '</span>' +
        '<span class="lp-copy"><strong>' + NF.esc(r.label) + '</strong></span>' +
        (r.value ? '<span class="lp-value">' + NF.esc(r.value) + '</span>' : '') + '</div>';
    }).join('');
    const actions = (m.actions || []).map(function (a) {
      return NF.btn(a.label, { action: a.action, icon: a.icon, cls: "sm lp-action" });
    }).join('');
    return { compact: false, html: '<div class="lp" data-kind="' + NF.esc(kind) + '">' +
      '<div class="lp-head"><span class="lp-head-icon">' + NF.icon(m.icon) + '</span>' +
      '<strong>' + NF.esc(m.title) + '</strong>' + NF.ib("close", "modal-close", "close", "sm") + '</div>' +
      '<div class="lp-rows">' + rows + '</div>' +
      (actions ? '<div class="lp-actions">' + actions + '</div>' : '') +
      '<div class="lp-foot">' + NF.esc(T("listPopoverHint")) + '</div></div>' };
  }

  function placePopover(anchor) {
    const dlg = refs.modal;
    const r0 = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    const r = r0 && (r0.width || r0.height) ? r0 : null;
    const vw = window.innerWidth || 1280, vh = window.innerHeight || 800;
    const w = 320, h = Math.min(420, dlg.offsetHeight || 320);
    let left = r ? r.left : (vw - w) / 2;
    let top = r ? r.bottom + 8 : 120;
    if (left + w > vw - 8) left = Math.max(8, vw - w - 8);
    if (top + h > vh - 8) top = r ? Math.max(8, r.top - h - 8) : 8;
    if (dlg.style) {
      dlg.style.left = Math.round(Math.max(8, left)) + "px";
      dlg.style.top = Math.round(Math.max(8, top)) + "px";
      dlg.style.right = "auto"; dlg.style.bottom = "auto";
    }
  }

  /* ------------------------------------------------------------------ modals */
  function openModal(kind, data) {
    S.modalTrigger = document.activeElement;
    S.modalKind = kind;
    const asPopover = Object.prototype.hasOwnProperty.call(LIST_POPOVERS, kind);
    refs.modal.classList.toggle("as-popover", asPopover);
    const out = asPopover ? listPopoverHTML(kind, data) : V.modal(kind, data);
    refs.modal.classList.toggle("compact", !!out.compact);
    refs.modal.innerHTML = out.html;
    if (!refs.modal.open) refs.modal.showModal();
    if (asPopover) placePopover(lastTrigger || S.modalTrigger);
    else if (refs.modal.style) {
      refs.modal.style.left = ""; refs.modal.style.top = "";
      refs.modal.style.right = ""; refs.modal.style.bottom = "";
    }
    lastTrigger = null;
    if (kind === "command") {
      const input = $("command-input");
      if (input) setTimeout(function () { input.focus(); }, 0);
    }
  }

  function closeModal() {
    if (refs.modal.open) refs.modal.close();
    refs.modal.classList.remove("as-popover");
    S.modalKind = null;
    if (S.modalTrigger && S.modalTrigger.isConnected) {
      try { S.modalTrigger.focus(); } catch (e) { /* detached */ }
    }
    S.modalTrigger = null;
  }

  function bindModalCancel() {
    refs.modal.addEventListener("cancel", function (e) {
      e.preventDefault();
      if (S.modalKind === "settings" && S.settingsDirty) openModal("settings-dirty");
      else closeModal();
    });
    /* A list popover has a transparent backdrop; clicking it dismisses. */
    refs.modal.addEventListener("click", function (e) {
      if (e.target === refs.modal && refs.modal.classList.contains("as-popover")) closeModal();
    });
  }

  /* ------------------------------------------------------------ tab handling */
  /* v1 discipline: capture the in-memory editor before any navigation that
     rebuilds the workspace, so switching work modes never loses a sentence. */
  function captureEditor() {
    const body = $("sheet-body");
    if (body && S.activeTab === "chapter" && !refs.window.classList.contains("is-minimized")) {
      S.draft[S.chapter] = body.innerHTML;
    }
    const ai = $("ai-input");
    if (ai) S.composer = ai.value;
  }

  function openTab(type) {
    captureEditor();
    if (type === "chapter") { S.activeTab = "chapter"; renderWorkspace(); renderStatusbar(); return; }
    let tab = S.tabs.find(function (x) { return x.id === type; });
    if (!tab) {
      tab = { id: type, type: type, label: TAB_LABELS[type] || [type, type, type] };
      S.tabs.push(tab);
    }
    S.activeTab = type;
    renderWorkspace();
  }

  function openChapter(n) {
    captureEditor();
    S.chapter = Number(n);
    const tab = S.tabs.find(function (x) { return x.type === "chapter"; });
    if (tab) tab.chapter = S.chapter;
    if (!S.draft[S.chapter]) S.draft[S.chapter] = V.proseHTML();
    S.activeTab = "chapter";
    S.saveState = "saved";
    renderWorkspace(); renderStatusbar(); renderContext();
  }

  function markDirty() {
    S.dirty[S.chapter] = true;
    S.confirmed[S.chapter] = false;
    if (S.saveState === "unsaved") return;
    S.saveState = "unsaved";
    renderStatusbar();
    const badge = document.querySelector(".doc-meta .badge");
    if (badge) { badge.className = "badge warning"; badge.textContent = T("unsaved"); }
    const confirm = document.querySelector(".doc-meta .btn.primary");
    if (confirm) { confirm.disabled = false; confirm.removeAttribute("title"); }
  }

  function filterSettings(query) {
    const q = String(query || "").trim().toLowerCase();
    document.querySelectorAll(".set-nav-item").forEach(function (item) {
      const hay = String(item.dataset.search || "").toLowerCase();
      item.hidden = !!q && hay.indexOf(q) === -1;
    });
    document.querySelectorAll(".set-nav-group").forEach(function (group) {
      const visible = group.querySelectorAll(".set-nav-item:not([hidden])").length;
      group.hidden = visible === 0;
    });
    /* The single clear button appears only while a filter is active. */
    const clear = document.querySelector(".set-search .set-clear");
    if (clear) clear.hidden = !q;
  }

  /* Partial settings updates: never rebuild the whole <dialog>, so clicking
     a section does not blank the panel or replay the entrance animation. */
  function updateSettingsSummary() {
    const sec = D.settingsSections.find(function (x) { return x.id === S.settingsSection; });
    if (!sec) return;
    const toggles = sec.rows.filter(function (r) { return r.toggle; }).length;
    const enabled = sec.rows.filter(function (r, i) { return r.toggle && S.settingsToggles[sec.id + ':' + i]; }).length;
    const metrics = document.querySelectorAll(".set-metric");
    if (metrics.length < 3) return;
    const strong = metrics[2].querySelector && metrics[2].querySelector("strong");
    if (strong) strong.textContent = String(enabled);
    const bar = metrics[2].querySelector && metrics[2].querySelector(".set-metric-bar > span");
    if (bar && bar.style) bar.style.width = (toggles ? enabled / toggles * 100 : 0) + "%";
  }

  function updateSettings(instant) {
    const pane = $("settings-pane");
    if (pane && typeof V.settingsPane === "function") pane.innerHTML = V.settingsPane();
    const layout = document.querySelector(".set-layout");
    if (layout) {
      if (instant) layout.dataset.animate = "instant";
      const tone = typeof V.settingsTone === "function" ? V.settingsTone() : "brand";
      layout.dataset.tone = tone;
      if (layout.style && layout.style.setProperty) {
        layout.style.setProperty("--nf-set-tone", "var(--nf-color-" + tone + ", var(--nf-color-brand))");
      }
    }
    document.querySelectorAll(".set-nav-item").forEach(function (item) {
      if (item.classList && item.classList.toggle) {
        item.classList.toggle("active", item.dataset.value === S.settingsSection);
      }
    });
    const note = document.querySelector(".modal-foot .note");
    if (note) note.textContent = S.settingsDirty ? T("settingsDirty") : T("setDialogNote");
  }

  /* ---------------------------------------------------------- command runner */
  function runCommand(hint) {
    const parts = String(hint).split(":");
    const kind = parts[0], value = parts.slice(1).join(":");
    if (kind === "view") { S.view = value; renderRail(); renderContext(); return; }
    if (kind === "tab") { openTab(value); return; }
    if (kind === "action") {
      const map = {
        "new-project": "new-project", "open-project": "open-project", "import-novel": "import-novel",
        "new-chapter": "new-chapter", "activity": "activity", "settings": "settings-open",
        "dev-console": "dev-console", "shortcuts": "shortcuts", "appearance": "appearance-open",
        "versions": "versions", "toggle-context": "toggle-context", "toggle-assistant": "toggle-assistant",
        "toggle-runtime": "toggle-runtime", "focus": "focus"
      };
      handle(map[value] || "noop", "", null);
      return;
    }
    if (kind === "setting") {
      if (value === "typewriter") S.typewriter = !S.typewriter;
      if (value === "paragraphFocus") S.paragraphFocus = !S.paragraphFocus;
      NF.toast(T("demoOnly"));
      return;
    }
    if (kind === "size") { setWritingSize(value); return; }
    if (kind === "measure") { S.measure = Number(value); S.measureOverride = true; applyAppearance(); NF.toast(T("demoOnly")); return; }
    if (kind === "theme") { applyTheme(value); return; }
    if (kind === "work") { handle("work-mode", value, null, null); return; }
    if (kind === "paper") { handle("set-paper", value, null, null); return; }
    if (kind === "zoom") { handle("zoom", value, null); return; }
    NF.toast(T("demoOnly"));
  }

  /* --------------------------------------------------------------- actions */
  function info(title, body) { openModal("info", { title: title, body: body }); }

  function handle(action, value, el, event) {
    switch (action) {
      /* stage / window chrome */
      case "locale": {
        captureEditor();
        S.locale = (Number(value) || 0) % 3;
        renderStage(); renderAll();
        if (S.modalKind) openModal(S.modalKind);
        return;
      }
      case "locale-cycle":
        captureEditor();
        S.locale = (S.locale + 1) % 3;
        renderStage(); renderAll();
        if (S.modalKind) openModal(S.modalKind);
        return;
      case "feature-map-jump":
        $("feature-map").scrollIntoView({ behavior: "smooth", block: "start" }); return;
      case "maximize":
        S.maximized = !S.maximized; renderStage(); renderTitlebar(); applyClasses(); return;
      case "minimize":
        S.minimized = true; renderPlaceholder(); renderTitlebar(); applyClasses(); return;
      case "restore":
        S.minimized = false; renderPlaceholder(); renderTitlebar(); applyClasses(); return;
      case "noop": return;
      case "theme-set": applyTheme(value); return;
      case "model-set":
        S.model = value || "elite";
        renderStatusbar(); renderAssistant(); renderAppearance();
        NF.toast(T("modelSetNote")); return;
      case "chapter-kind": return; /* custom chips are visual only */
      case "settings-edit": openModal("setting-edit", { key: value }); return;
      case "settings-clear": {
        const input = document.querySelector(".set-search input");
        if (input) { input.value = ""; if (input.focus) input.focus(); }
        filterSettings("");
        return;
      }
      case "setting-edit-save": {
        const input = $("setting-edit-input");
        if (input) {
          S.settingsValues[value] = String(input.value || "").trim();
          S.settingsDirty = true;
        }
        /* Reuse the already-open dialog instead of closing and re-showing it. */
        openModal("settings");
        const layout = document.querySelector(".set-layout");
        if (layout) layout.dataset.animate = "instant";
        NF.toast(T("demoOnly")); return;
      }
      case "model-route": {
        S.modelRoute = value || "elite";
        document.querySelectorAll(".set-route").forEach(function (route) {
          const on = route.dataset.value === S.modelRoute;
          if (route.classList && route.classList.toggle) route.classList.toggle("active", on);
          const badge = route.querySelector && route.querySelector(".set-route-default");
          if (on && !badge && route.insertAdjacentHTML) {
            route.insertAdjacentHTML("beforeend", '<span class="set-route-default">' + T("setDefaultRoute") + '</span>');
          }
          if (!on && badge && badge.remove) badge.remove();
        });
        NF.toast(T("demoOnly")); return;
      }
      case "reduce-motion-toggle":
        S.reduceMotion = !S.reduceMotion;
        refs.window.dataset.reduceMotion = S.reduceMotion ? "true" : "false";
        renderAppearance(); NF.toast(T("reduceMotionLabel")); return;

      /* v3: two work modes, sheet mode and the v1 writing partner */
      case "work-mode": case "set-workmode": {
        captureEditor();
        S.workMode = value === "compose" ? "compose" : "forge";
        withTransition(function () { applyAppearance(); renderAll(); renderStage(); });
        NF.toast(T(S.workMode === "compose" ? "workModeToastCompose" : "workModeToastForge"));
        return;
      }
      case "paper-toggle": {
        S.paper = S.paper === "light" ? "auto" : "light";
        applyAppearance(); renderTitlebar(); renderTitleStrip(); renderAppearance(); renderStatusbar();
        NF.toast(T("paperHint")); return;
      }
      case "set-paper":
        S.paper = value === "light" ? "light" : "auto";
        applyAppearance(); renderTitlebar(); renderTitleStrip(); renderAppearance(); renderStatusbar(); return;
      case "partner-tab": S.partnerTab = value; renderAssistant(); return;
      case "partner-send": {
        const input = $("ai-input");
        if (!input || !input.value.trim()) { NF.toast(T("noPrompt")); return; }
        S.partnerChat.push({ role: "user", text: input.value.trim() });
        S.partnerChat.push({ role: "ai", text: T("partnerAnswer") });
        renderAssistant(); NF.toast(T("partnerDemo")); return;
      }

      /* navigation */
      case "view": S.view = value; renderRail(); renderContext(); return;
      case "project-square": NF.toast(T("demoOnly")); return;
      case "refresh-context": renderContext(); NF.toast(T("demoOnly")); return;
      case "group": S.treeCollapsed[value] = !S.treeCollapsed[value]; renderContext(); return;
      case "tree-item": {
        let found = null;
        D.treeGroups.forEach(function (g) {
          g.items.forEach(function (item) { if (item.id === value) found = item; });
        });
        if (!found) return;
        S.activeTreeNode = value;
        if (found.chapter) openChapter(found.chapter);
        else if (found.tab) openTab(found.tab);
        else if (found.action === "auto-split") info(T("tabBoard"), T("demoOnly"));
        else NF.toast(T("demoOnly"));
        return;
      }
      case "kb-doc": openTab("knowledge"); return;
      case "kb-open": openTab("knowledge"); return;
      case "kb-mode": S.kbMode = Number(value); renderContext(); NF.toast(T("demoOnly")); return;
      case "kb-reindex": NF.toast(T("demoOnly")); return;
      case "char-open": openTab("character"); return;
      case "char-extract": case "char-scan": NF.toast(T("demoOnly")); return;

      /* tabs & document */
      case "tab": withTransition(function () { openTab(value); }); return;
      case "chapter": withTransition(function () { openChapter(Number(value)); }); return;
      case "close-tab": {
        if (S.tabs.length <= 1) { NF.toast(T("demoOnly")); return; }
        const i = S.tabs.findIndex(function (x) { return x.id === value; });
        if (i === -1) return;
        S.tabs.splice(i, 1);
        if (S.activeTab === value) S.activeTab = S.tabs[Math.max(0, i - 1)].id;
        renderWorkspace(); return;
      }
      case "tab-menu": NF.toast([S.tabs.length + " 个已打开标签 · " + T("demoOnly"), S.tabs.length + " open tabs · demo", S.tabs.length + " вкладок · демо"]); return;
      case "new-chapter": openModal("new-chapter"); return;
      case "create-chapter": {
        const input = $("new-chapter-title");
        if (!input || !input.value.trim()) { NF.toast(T("requiredTitle")); return; }
        closeModal(); NF.toast(T("createdDemo")); return;
      }
      case "save":
        captureEditor();
        S.saveState = "saved"; S.dirty[S.chapter] = false; S.confirmed[S.chapter] = true;
        renderWorkspace(); renderStatusbar(); NF.toast(T("confirmedNote")); return;
      case "undo": case "redo": {
        const body = $("sheet-body");
        if (body) { body.focus(); document.execCommand(action); S.draft[S.chapter] = body.innerHTML; }
        NF.toast(T("demoOnly")); return;
      }
      case "revise": case "finalize": NF.toast(T("demoOnly")); return;
      case "focus":
        captureEditor(); S.focus = !S.focus;
        withTransition(function () { renderAll(); });
        NF.toast(S.focus ? T("focus") : T("exitFocus")); return;
      case "toggle-context": S.contextCollapsed = !S.contextCollapsed; renderTitleStrip(); applyClasses(); return;
      case "toggle-assistant": S.assistantCollapsed = !S.assistantCollapsed; renderTitleStrip(); applyClasses(); return;
      case "toggle-runtime": S.runtimeCollapsed = !S.runtimeCollapsed; renderRuntime(); return;
      case "board-view": S.boardView = value; renderWorkspace(); return;

      /* rewrite / versions / review — v1 per-change editorial loop */
      case "rewrite-mode": case "rewrite-open": captureEditor(); openModal("rewrite", { index: 0 }); return;
      case "proposal-view": captureEditor(); openModal("rewrite", { index: Number(value) || 0 }); return;
      case "proposal-accept": case "proposal-apply": {
        const i = Number(value) || 0;
        const p = NF.V3.proposals[i];
        captureEditor();
        const current = (S.draft[S.chapter] || V.proseHTML())
          .replace(/<span class="note-anchor">([\s\S]*?)<\/span>/g, "$1");
        if (!p || current.indexOf(p.old) === -1) {
          closeModal(); NF.toast(T("conflictError")); return;
        }
        S.draft[S.chapter] = current.replace(p.old, p.next);
        S.decisions[i] = "accept";
        S.dirty[S.chapter] = true; S.confirmed[S.chapter] = false; S.saveState = "unsaved";
        closeModal(); renderWorkspace(); renderAssistant(); renderStatusbar();
        NF.toast(T("applied")); return;
      }
      case "proposal-reject": {
        S.decisions[Number(value) || 0] = "reject";
        renderWorkspace(); renderAssistant(); NF.toast(T("proposalRejected")); return;
      }
      case "apply-rewrite": handle("proposal-accept", "0", el, event); return;
      case "dismiss-note": S.notesDismissed = true; renderAssistant(); NF.toast(T("noNotes")); return;
      case "references-open": openModal("references"); return;
      case "versions": openModal("versions"); return;
      case "restore-confirm": openModal("restore"); return;
      case "restore-apply": {
        captureEditor();
        S.backups[S.chapter] = S.draft[S.chapter] || V.proseHTML();
        S.draft[S.chapter] = V.proseHTML();
        S.decisions = [null, null];
        S.dirty[S.chapter] = true; S.confirmed[S.chapter] = false; S.saveState = "unsaved";
        closeModal(); renderWorkspace(); renderAssistant(); renderStatusbar();
        NF.toast(T("restored")); return;
      }
      case "recover-backup": {
        const backup = S.backups[S.chapter];
        if (!backup) { NF.toast(T("demoOnly")); return; }
        S.draft[S.chapter] = backup; delete S.backups[S.chapter];
        renderWorkspace(); renderStatusbar(); NF.toast(T("backupRecovered")); return;
      }
      case "info-version": info(T("versionTitle"), T("restoreBody")); return;
      case "info-review": info(T("weightedScore"), T("reviewSummaryBody")); return;
      case "review-accept": NF.toast(T("applied")); return;
      case "review-reject": NF.toast(T("demoOnly")); return;
      case "memory-rebuild": NF.toast(T("demoOnly")); return;

      /* dialogs */
      case "command-open": openModal("command"); return;
      case "command-run": closeModal(); runCommand(value); return;
      case "settings-open": openModal("settings"); return;
      case "settings-section":
        S.settingsSection = value; updateSettings(true); return;
      case "settings-toggle": {
        S.settingsToggles[value] = !S.settingsToggles[value];
        S.settingsDirty = true;
        const on = !!S.settingsToggles[value];
        const sw = document.querySelector('[data-action="settings-toggle"][data-value="' + value + '"]');
        if (sw && sw.classList) {
          sw.classList.toggle("on", on);
          if (sw.setAttribute) sw.setAttribute("aria-checked", String(on));
          const row = sw.closest ? sw.closest(".set-row") : null;
          const stateEl = row && row.querySelector ? row.querySelector(".set-switch-state") : null;
          if (stateEl) {
            stateEl.textContent = T(on ? "setOn" : "setOff");
            if (stateEl.classList && stateEl.classList.toggle) stateEl.classList.toggle("on", on);
          }
          updateSettingsSummary();
        } else {
          updateSettings(true);
        }
        const note = document.querySelector(".modal-foot .note");
        if (note) note.textContent = T("settingsDirty");
        NF.toast(T("demoOnly")); return;
      }
      case "modal-close":
        if (S.modalKind === "settings" && S.settingsDirty) openModal("settings-dirty");
        else closeModal();
        return;
      case "settings-force-close": S.settingsDirty = false; closeModal(); return;
      case "activity": openModal("activity"); return;
      case "dev-console": openModal("dev-console"); return;
      case "shortcuts": openModal("shortcuts"); return;
      case "new-project": openModal("new-project"); return;
      case "open-project": openModal("open-project"); return;
      case "import-novel": openModal("import-novel"); return;
      case "info-about": info(T("appName"), T("footerNote")); return;

      /* assistant & runtime */
      case "ai-tab": S.aiTab = value; renderAssistant(); return;
      case "ai-send": {
        const input = $("ai-input");
        if (!input || !input.value.trim()) { NF.toast(T("noPrompt")); return; }
        const text = input.value.trim();
        S.aiMessages.push({ role: "user", text: text });
        S.aiMessages.push({ role: "ai", text: T("demoAnswer") });
        renderAssistant(); NF.toast(T("scriptedReply")); return;
      }
      case "ai-stop": NF.toast(T("demoOnly")); return;
      case "runtime-tab": S.runtimeTab = value; S.runtimeCollapsed = false; renderRuntime(); return;
      case "task-approve": info(T("viewResult"), T("rewriteGuard")); return;
      case "task-cancel": NF.toast(T("demoOnly")); return;
      case "inbox-open": info(T("runtimeInbox"), T("demoOnly")); return;
      case "log-clear": S.logs = []; renderRuntime(); NF.toast(T("demoOnly")); return;

      /* status bar */
      case "model-picker": {
        const models = ["elite", "standard", "budget", "local"];
        S.model = models[(models.indexOf(S.model) + 1) % models.length];
        renderStatusbar(); renderAssistant(); NF.toast([S.model + " · " + T("modelPicker"), S.model + " · " + T("modelPicker"), S.model + " · " + T("modelPicker")]); return;
      }
      case "thinking-cycle": {
        const levels = ["L1", "L2", "L3", "L4"];
        S.thinking = levels[(levels.indexOf(S.thinking) + 1) % levels.length];
        renderStatusbar(); renderAssistant(); return;
      }
      case "cost-reset": openModal("cost-reset"); return;
      case "cost-reset-apply": S.cost = "¥ 0.00"; closeModal(); renderStatusbar(); NF.toast(T("demoOnly")); return;
      case "notifications": info(T("notifications"), T("demoOnly")); return;
      case "zoom":
        if (value === "+") S.zoom = Math.min(150, S.zoom + 10);
        else if (value === "-") S.zoom = Math.max(70, S.zoom - 10);
        else S.zoom = 100;
        renderStatusbar(); return;

      /* themes & appearance */
      case "theme-cycle": {
        const order = ["light", "galaxy", "paper", "dark"];
        applyTheme(order[(order.indexOf(S.theme) + 1) % order.length]); return;
      }
      case "appearance-open": S.appearanceOpen = !S.appearanceOpen; renderAppearance(); renderTitlebar(); return;
      case "appearance-close": S.appearanceOpen = false; renderAppearance(); renderTitlebar(); return;
      case "appearance-reset":
        Object.assign(S, { mode: "light", palette: "jade", density: "normal", writingSize: "18", theme: "light", paper: "auto", bg: "grid", bgStrength: 0.6, bgVeil: 10, bgBlur: 0, bgImageData: null, bgImageName: null, measure: 720, measureOverride: false });
        applyAppearance(); renderAppearance(); renderTitleStrip(); renderTitlebar(); NF.toast(T("demoOnly")); return;
      case "set-mode": S.mode = value; applyAppearance(); renderAppearance(); return;
      case "set-palette": S.palette = value; applyAppearance(); renderAppearance(); return;
      case "set-density": S.density = value; applyAppearance(); renderAppearance(); return;
      case "set-writing-size": setWritingSize(value); return;
      case "set-bg":
        S.bg = value;
        if (value !== "image") { S.bgImageData = null; S.bgImageName = null; }
        applyAppearance(); renderAppearance(); return;
      case "bg-remove": S.bgImageData = null; S.bgImageName = null; S.bg = "grid"; applyAppearance(); renderAppearance(); return;
      default: NF.toast(T("demoOnly"));
    }
  }

  /* --------------------------------------------------------------- listeners */
  function bindEvents() {
    document.addEventListener("click", function (e) {
      const target = e.target.closest("[data-action]");
      if (!target || target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
      const action = target.dataset.action;
      if (!action) return;
      e.preventDefault();
      lastTrigger = target;
      handle(action, target.dataset.value != null ? target.dataset.value : "", target, e);
      /* Any interaction may change a panel's geometry; re-place the DOM bars. */
      if (NF.customScroll && typeof NF.customScroll.refresh === "function") NF.customScroll.refresh();
    });

    document.addEventListener("change", function (e) {
      const el = e.target;
      const action = el.dataset.action;
      if (action === "locale") {
        S.locale = Number(el.value) % 3;
        renderStage(); renderAll();
        if (S.modalKind) openModal(S.modalKind);
      } else if (action === "bg-upload") {
        const file = el.files && el.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
          S.bgImageData = String(reader.result);
          S.bgImageName = file.name;
          S.bg = "image";
          applyAppearance(); renderAppearance();
          NF.toast(T("bgUploadHint"));
        };
        reader.readAsDataURL(file); /* stays in page memory */
      }
    });

    document.addEventListener("input", function (e) {
      const el = e.target;
      const action = el.dataset.action;
      if (el.id === "sheet-body") {
        S.draft[S.chapter] = el.innerHTML;
        markDirty();
        const live = $("live-words");
        if (live) {
          const plain = String(el.innerText || el.textContent || "").replace(/\s/g, "");
          live.textContent = plain.length + " " + T("wordsUnit");
        }
      } else if (action === "settings-search") {
        filterSettings(el.value);
      } else if (action === "command-query") {
        S.commandQuery = el.value;
        const box = $("command-results");
        if (box) box.innerHTML = V.commandResults(el.value);
      } else if (action === "tree-filter") {
        S.treeFilter = el.value; renderContext();
        const input = document.querySelector('[data-action="tree-filter"]');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      } else if (action === "kb-filter") {
        S.kbFilter = el.value; renderContext();
        const input = document.querySelector('[data-action="kb-filter"]');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      } else if (action === "char-filter") {
        S.charFilter = el.value;
      } else if (action === "bg-strength") {
        S.bgStrength = Number(el.value) / 100; applyAppearance();
        const out = el.closest(".range-control").querySelector("output");
        if (out) out.textContent = el.value + "%";
      } else if (action === "bg-veil") {
        S.bgVeil = Number(el.value); applyAppearance();
        const out = el.closest(".range-control").querySelector("output");
        if (out) out.textContent = el.value + "%";
      } else if (action === "bg-blur") {
        S.bgBlur = Number(el.value); applyAppearance();
        const out = el.closest(".range-control").querySelector("output");
        if (out) out.textContent = el.value + "px";
      }
    });

    document.addEventListener("keydown", function (e) {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k") { e.preventDefault(); openModal("command"); return; }
      if (mod && key === ",") { e.preventDefault(); openModal("settings"); return; }
      if (mod && key === "m") { e.preventDefault(); handle("work-mode", S.workMode === "compose" ? "forge" : "compose", null, e); return; }
      if (mod && key === "s" && !refs.modal.open) { e.preventDefault(); handle("save", "", null, e); return; }
      if (key === "f11") { e.preventDefault(); handle("focus", "", null, e); return; }
      if (key === "escape") {
        /* An open <dialog> emits its own cancel event; let bindModalCancel
           handle it so dirty-settings confirmation is not closed twice. */
        if (refs.modal.open) return;
        if (S.appearanceOpen) handle("appearance-close", "", null, e);
        else if (S.focus) handle("focus", "", null, e);
        return;
      }
      if (refs.modal.open && S.modalKind === "command") {
        const rows = Array.prototype.slice.call(refs.modal.querySelectorAll(".command-row"));
        let idx = rows.findIndex(function (r) { return r.classList.contains("active"); });
        if (key === "arrowdown" || key === "arrowup") {
          e.preventDefault();
          if (!rows.length) return;
          idx = key === "arrowdown" ? (idx + 1) % rows.length : (idx - 1 + rows.length) % rows.length;
          rows.forEach(function (r, i) { r.classList.toggle("active", i === idx); });
          rows[idx].scrollIntoView({ block: "nearest" });
        } else if (key === "enter") {
          e.preventDefault();
          const active = rows[idx] || rows[0];
          if (active) { closeModal(); runCommand(active.dataset.value); }
        }
      }
    });

    /* Selection bubble: five real paragraph-rewrite modes. */
    document.addEventListener("mouseup", function (e) {
      const old = document.querySelector(".selection-bubble");
      if (old) old.remove();
      if (!e.target.closest || !e.target.closest("#sheet-body")) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      const host = $("document-scroll");
      if (!host) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const modes = [["扩写", "Expand", "Расширить"], ["缩写", "Condense", "Сократить"], ["改风格", "Change voice", "Сменить стиль"], ["增强冲突", "Add conflict", "Усилить конфликт"], ["润色", "Polish", "Отполировать"]];
      const bubble = document.createElement("div");
      bubble.className = "selection-bubble";
      bubble.innerHTML = modes.map(function (m, i) {
        return '<button data-action="rewrite-mode" data-value="' + i + '">' + NF.esc(X(m)) + '</button>';
      }).join('');
      bubble.style.left = Math.max(8, rect.left - hostRect.left + host.scrollLeft) + "px";
      bubble.style.top = Math.max(8, rect.top - hostRect.top + host.scrollTop - 34) + "px";
      host.appendChild(bubble);
    });

    window.addEventListener("resize", applyClasses);
    if (window.ResizeObserver) new ResizeObserver(applyClasses).observe(refs.window);
  }

  /* ------------------------------------------------------------------- boot */
  function boot() {
    initRefs();
    S.draft[S.chapter] = V.proseHTML();
    renderStage();
    skeleton();
    renderAll();
    bindEvents();
    bindModalCancel();
    NF.toast(T("prototypeReady"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

})(window.NF);
