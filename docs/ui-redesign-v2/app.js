"use strict";
/* NovelForge UI Redesign v2 — application logic.
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
    aiTab: "agent", runtimeTab: "tasks", runtimeCollapsed: false, focus: false,
    activeTab: "chapter", chapter: 7,
    tabs: [
      { id: "chapter", type: "chapter", chapter: 7 },
      { id: "board", type: "board", label: ["章节看板", "Chapter board", "Доска глав"] },
      { id: "review", type: "review", label: ["审阅报告", "Review report", "Рецензия"] },
      { id: "timeline", type: "timeline", label: ["世界观时间线", "World timeline", "Хронология мира"] }
    ],
    draft: {}, backup: null, saveState: "saved",
    treeCollapsed: {}, treeFilter: "", kbFilter: "", charFilter: "", kbMode: 0, topK: 6,
    boardView: "card", activeTreeNode: null,
    mode: "dark", palette: "cobalt", density: "normal", writingSize: "17",
    theme: "dark", bg: "grid", bgImageData: null, bgImageName: null,
    bgStrength: 0.6, bgVeil: 10, bgBlur: 0, measure: 720,
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
    diff: ["三栏合并", "Three-way merge", "Трёхстороннее слияние"], welcome: ["欢迎", "Welcome", "Приветствие"]
  };

  let refs = {};

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
    w.style.setProperty("--nf-layout-manuscript", S.measure + "px");
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

  function applyTheme(id) {
    const map = {
      light: { mode: "light", palette: "cobalt" }, galaxy: { mode: "dark", palette: "orchid" },
      paper: { mode: "light", palette: "ember" }, dark: { mode: "dark", palette: "cobalt" }
    };
    const t = map[id] || map.dark;
    S.theme = id; S.mode = t.mode; S.palette = t.palette;
    applyAppearance(); renderAppearance(); renderTitleStrip(); renderTitlebar();
    NF.toast(["主题已切换 · " + id, "Theme switched · " + id, "Тема изменена · " + id]);
  }

  function setWritingSize(size) {
    S.writingSize = String(size);
    applyAppearance(); renderAppearance();
    NF.toast(T("demoOnly"));
  }

  /* ------------------------------------------------------------------ modals */
  function openModal(kind, data) {
    S.modalTrigger = document.activeElement;
    S.modalKind = kind;
    const out = V.modal(kind, data);
    refs.modal.classList.toggle("compact", !!out.compact);
    refs.modal.innerHTML = out.html;
    if (!refs.modal.open) refs.modal.showModal();
    if (kind === "command") {
      const input = $("command-input");
      if (input) setTimeout(function () { input.focus(); }, 0);
    }
  }

  function closeModal() {
    if (refs.modal.open) refs.modal.close();
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
  }

  /* ------------------------------------------------------------ tab handling */
  function openTab(type) {
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
    S.chapter = Number(n);
    const tab = S.tabs.find(function (x) { return x.type === "chapter"; });
    if (tab) tab.chapter = S.chapter;
    if (!S.draft[S.chapter]) S.draft[S.chapter] = V.proseHTML();
    S.activeTab = "chapter";
    S.saveState = "saved";
    renderWorkspace(); renderStatusbar(); renderContext();
  }

  function markDirty() {
    if (S.saveState === "unsaved") return;
    S.saveState = "unsaved";
    renderStatusbar();
    const badge = document.querySelector(".doc-meta .badge");
    if (badge) { badge.className = "badge warning"; badge.textContent = T("unsaved"); }
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
    if (kind === "measure") { S.measure = Number(value); applyAppearance(); NF.toast(T("demoOnly")); return; }
    if (kind === "theme") { applyTheme(value); return; }
    if (kind === "zoom") { handle("zoom", value, null); return; }
    NF.toast(T("demoOnly"));
  }

  /* --------------------------------------------------------------- actions */
  function info(title, body) { openModal("info", { title: title, body: body }); }

  function handle(action, value, el, event) {
    switch (action) {
      /* stage / window chrome */
      case "locale": return;
      case "locale-cycle":
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
      case "tab": openTab(value); return;
      case "chapter": openChapter(Number(value)); return;
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
        S.saveState = "saved"; renderWorkspace(); renderStatusbar(); NF.toast(T("saved")); return;
      case "undo": case "redo": {
        const body = $("sheet-body");
        if (body) { body.focus(); document.execCommand(action); S.draft[S.chapter] = body.innerHTML; }
        NF.toast(T("demoOnly")); return;
      }
      case "revise": case "finalize": NF.toast(T("demoOnly")); return;
      case "focus":
        S.focus = !S.focus; renderAll(); NF.toast(S.focus ? T("focus") : T("exitFocus")); return;
      case "toggle-context": S.contextCollapsed = !S.contextCollapsed; renderTitleStrip(); applyClasses(); return;
      case "toggle-assistant": S.assistantCollapsed = !S.assistantCollapsed; renderTitleStrip(); applyClasses(); return;
      case "toggle-runtime": S.runtimeCollapsed = !S.runtimeCollapsed; renderRuntime(); return;
      case "board-view": S.boardView = value; renderWorkspace(); return;

      /* rewrite / versions / review */
      case "rewrite-mode": case "rewrite-open": openModal("rewrite"); return;
      case "apply-rewrite": {
        const original = "「你终于来了。」";
        const replacement = "守塔人把灯罩往下压了压，没有回头。";
        const current = S.draft[S.chapter] || V.proseHTML();
        if (current.indexOf(original) === -1) { closeModal(); NF.toast(T("conflictError")); return; }
        S.draft[S.chapter] = current.replace(original, replacement);
        S.saveState = "unsaved";
        closeModal(); renderWorkspace(); renderStatusbar(); NF.toast(T("applied")); return;
      }
      case "dismiss-note": S.notesDismissed = true; renderAssistant(); NF.toast(T("noNotes")); return;
      case "references-open": openModal("references"); return;
      case "versions": openModal("versions"); return;
      case "restore-confirm": openModal("restore"); return;
      case "restore-apply": {
        S.backup = S.draft[S.chapter] || V.proseHTML();
        S.draft[S.chapter] = V.proseHTML();
        S.saveState = "unsaved";
        closeModal(); renderWorkspace(); renderStatusbar(); NF.toast(T("restored")); return;
      }
      case "recover-backup":
        if (!S.backup) { NF.toast(T("demoOnly")); return; }
        S.draft[S.chapter] = S.backup; S.backup = null;
        renderWorkspace(); renderStatusbar(); NF.toast(T("backupRecovered")); return;
      case "info-version": info(T("versionTitle"), T("restoreBody")); return;
      case "info-review": info(T("weightedScore"), T("reviewSummaryBody")); return;
      case "review-accept": NF.toast(T("applied")); return;
      case "review-reject": NF.toast(T("demoOnly")); return;
      case "memory-rebuild": NF.toast(T("demoOnly")); return;

      /* dialogs */
      case "command-open": openModal("command"); return;
      case "command-run": closeModal(); runCommand(value); return;
      case "settings-open": openModal("settings"); return;
      case "settings-section": S.settingsSection = value; openModal("settings"); return;
      case "settings-toggle":
        S.settingsToggles[value] = !S.settingsToggles[value];
        S.settingsDirty = true; openModal("settings"); NF.toast(T("demoOnly")); return;
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
        Object.assign(S, { mode: "dark", palette: "cobalt", density: "normal", writingSize: "17", theme: "dark", bg: "grid", bgStrength: 0.6, bgVeil: 10, bgBlur: 0, bgImageData: null, bgImageName: null, measure: 720 });
        applyAppearance(); renderAppearance(); renderTitleStrip(); NF.toast(T("demoOnly")); return;
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
      handle(action, target.dataset.value != null ? target.dataset.value : "", target, e);
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
