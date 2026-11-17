"use strict";
/* NovelForge UI Redesign v2 — view builders. Pure HTML strings, no state
   mutation. Every user-visible string resolves through NF.t / NF.tx. */
(function (NF) {
  const V = NF.views = {};
  const T = function (k) { return NF.t(k); };
  const X = function (v) { return NF.tx(v); };
  const I = function (n, c) { return NF.icon(n, c); };
  const E = function (v) { return NF.esc(v); };
  const s = function () { return NF.state; };
  const D = NF.D;

  /* ------------------------------------------------------------ review stage */
  V.stage = function () {
    const st = s();
    const langNames = ["中文", "English", "Русский"];
    const controls =
      '<select data-action="locale" aria-label="' + E(T("btnLanguage")) + '" title="' + E(T("btnLanguage")) + '">' +
      langNames.map(function (n, i) { return '<option value="' + i + '"' + (st.locale === i ? ' selected' : '') + '>' + E(n) + '</option>'; }).join('') +
      '</select>' +
      NF.btn(T("btnAppearance"), { action: "appearance-open", icon: "palette", cls: "stage-button", value: "" }) +
      NF.btn(T("btnFeatures"), { action: "feature-map-jump", icon: "grid", cls: "stage-button" }) +
      NF.btn(st.maximized ? T("btnRestore") : T("btnMaximize"), { action: "maximize", icon: st.maximized ? "restore" : "maximize", cls: "stage-button" + (st.maximized ? " active" : "") });

    const brief = [
      ["brief1Title", "brief1Body", "01"], ["brief2Title", "brief2Body", "02"], ["brief3Title", "brief3Body", "03"]
    ].map(function (b) {
      return '<div class="brief-item"><span class="mono">' + b[2] + ' / FORGE CONSOLE</span><strong>' + E(T(b[0])) + '</strong><p>' + E(T(b[1])) + '</p></div>';
    }).join('');

    const legend = [
      ["legendUI", "--nf-color-brand"], ["legendSpec", "--nf-color-info"], ["legendBackend", "--nf-stage-muted"]
    ].map(function (l) {
      return '<span><i class="legend-dot" style="background:var(' + l[1] + ')"></i>' + E(T(l[0])) + '</span>';
    }).join('');

    const kindColor = { ui: "--nf-color-brand", spec: "--nf-color-info", backend: "--nf-stage-muted" };
    const cards = D.featureGroups.map(function (g) {
      const items = g.items.map(function (it) {
        const name = [it[0], it[1], it[2]][st.locale];
        const target = [it[3], it[4], it[5]][st.locale];
        const kind = it[6];
        const label = T(kind === "ui" ? "legendUI" : kind === "spec" ? "legendSpec" : "legendBackend");
        return '<li title="' + E(label) + '"><i class="legend-dot" style="background:var(' + kindColor[kind] + ')"></i> ' +
          '<b>' + E(name) + '</b> → ' + E(target) + '</li>';
      }).join('');
      return '<div class="feature-card"><h3>' + E(X(g.title)) + '<small>' + g.items.length + ' / ' + E(T("viewTab")) + '</small></h3><ul>' + items + '</ul></div>';
    }).join('');

    const backend = D.backendList.map(function (b) {
      return '<span class="chip">' + E(X(b)) + '</span>';
    }).join('');

    return {
      kicker: E(T("stageKicker")),
      title: E(T("stageTitle")),
      subtitle: E(T("stageSubtitle")),
      controls: controls,
      briefTitle: E(T("briefTitle")),
      brief: brief,
      mapKicker: E(T("mapKicker")),
      mapTitle: E(T("mapTitle")),
      mapDesc: E(T("mapDesc")),
      legend: legend,
      cards: cards,
      backendTitle: E(T("backendTitle")),
      backendDesc: E(T("backendDesc")),
      backendChips: backend,
      footer: '<span>' + E(T("footerNote")) + '</span><code>' + E(T("footerFiles")) + ' · ' + E(T("stageStatus")) + '</code>'
    };
  };

  /* ---------------------------------------------------------- window chrome */
  V.titlebar = function () {
    const st = s();
    return '<div class="window-app-title">' + I("layers", "brand-glyph") +
      '<strong>' + E(T("appName")) + '</strong><span class="window-title-sep">/</span>' +
      '<span class="window-title-note">' + E(T("projectName")) + ' · ' + E(T("windowHint")) + '</span></div>' +
      '<div class="window-controls">' +
      '<button class="window-control' + (st.appearanceOpen ? ' is-active' : '') + '" data-action="appearance-open" title="' + E(T("btnAppearance")) + '" aria-label="' + E(T("btnAppearance")) + '">' + I("palette") + '</button>' +
      '<span class="titlebar-sep"></span>' +
      '<button class="window-control" data-action="minimize" title="' + E(T("close")) + '" aria-label="' + E(T("close")) + '">' + I("minimize") + '</button>' +
      '<button class="window-control' + (st.maximized ? ' is-active' : '') + '" data-action="maximize" title="' + E(st.maximized ? T("btnRestore") : T("btnMaximize")) + '" aria-label="' + E(T("btnMaximize")) + '">' + I(st.maximized ? "restore" : "maximize") + '</button>' +
      '<button class="window-control close-control" data-action="minimize" title="' + E(T("close")) + '" aria-label="' + E(T("close")) + '">' + I("close") + '</button>' +
      '</div>';
  };

  V.placeholder = function () {
    return '<strong>' + E(T("windowMinimized")) + '</strong><p>' + E(T("windowRestoreHint")) + '</p>' +
      NF.btn(T("reopen"), { action: "restore", cls: "primary", icon: "restore" });
  };

  /* --------------------------------------------------------------- title bar */
  V.titleStrip = function () {
    const st = s();
    const langShort = ["中文", "EN", "RU"][st.locale];
    return '<div class="brand-lockup">' + I("layers", "brand-glyph") + '<span>' + E(T("appName")) + '</span></div>' +
      '<span class="title-sep"></span>' +
      '<div class="project-crumb"><span>' + E(T("projectName")) + '</span><span class="muted">·</span><span class="truncate">' + E(T("projectTag")) + '</span></div>' +
      '<span class="title-sep"></span>' +
      '<div class="title-center">' +
      '<button class="cmd-trigger" data-action="command-open">' + I("search") + '<span>' + E(T("cmdPlaceholder")) + '</span><kbd>Ctrl K</kbd></button>' +
      '</div><div class="spacer"></div>' +
      '<div class="top-actions">' +
      NF.ib("context", "toggle-context", st.contextCollapsed ? "showContext" : "hideContext", st.contextCollapsed ? "" : "active") +
      NF.ib("sidebar", "toggle-assistant", st.assistantCollapsed ? "showAssistant" : "hideAssistant", st.assistantCollapsed ? "" : "active") +
      NF.ib("focus", "focus", "focus", st.focus ? "active" : "") +
      NF.ib("language", "locale-cycle", "languageMenu", "", "") +
      '<button class="btn ghost sm" data-action="theme-cycle" title="' + E(T("themeMenu")) + '">' + I(st.mode === "dark" ? "moon" : "sun", "sm") + '<span>' + E(langShort) + '</span></button>' +
      NF.ib("settings", "settings-open", "settingsTitle") +
      '</div>';
  };

  /* --------------------------------------------------------------- left rail */
  V.rail = function () {
    const st = s();
    const views = [
      ["home", "home", "navHome"], ["project", "folder", "navProject"],
      ["knowledge", "book", "navKnowledge"], ["characters", "users", "navCharacters"]
    ];
    const top = views.map(function (v) {
      return '<button class="rail-btn' + (st.view === v[0] ? ' active' : '') + '" data-action="view" data-value="' + v[0] + '" title="' + E(T(v[2])) + '" aria-label="' + E(T(v[2])) + '">' + I(v[1]) + '</button>';
    }).join('');
    const squares = ["雾", "灯", "潮", "信"].map(function (ch, i) {
      return '<button class="project-square' + (i === 0 ? ' active' : '') + '" data-action="project-square" data-value="' + i + '" title="' + E(T("navProjects")) + '">' + E(ch) + '</button>';
    }).join('');
    const bottom = [
      ["tasks", "runtime-tab", "tasks", "navTasks"], ["log", "runtime-tab", "log", "navLog"],
      ["activity", "action", "activity", "navActivity"], ["settings", "action", "settings-open", "navSettings"]
    ].map(function (b) {
      const act = b[1] === "runtime-tab" ? "runtime-tab" : b[2];
      const value = b[1] === "runtime-tab" ? b[2] : "";
      return '<button class="rail-btn" data-action="' + act + '"' + (value ? ' data-value="' + value + '"' : '') +
        ' title="' + E(T(b[3])) + '" aria-label="' + E(T(b[3])) + '">' + I(b[0]) +
        (b[0] === "tasks" ? '<i class="rail-dot dot brand pulse"></i>' : '') + '</button>';
    }).join('');
    return top + '<span class="rail-sep"></span><div class="rail-squares" title="' + E(T("navProjects")) + '">' + squares + '</div>' +
      '<div class="rail-bottom"><span class="rail-sep"></span>' + bottom + '</div>';
  };

  /* ---------------------------------------------------------- context column */
  V.context = function () {
    const st = s();
    if (st.view === "project") return V.contextProject();
    if (st.view === "knowledge") return V.contextKnowledge();
    if (st.view === "characters") return V.contextCharacters();
    return V.contextHome();
  };

  V.contextFrame = function (title, tools, body, foot) {
    return '<div class="context-head"><strong>' + E(title) + '</strong>' +
      NF.ib("refresh", "refresh-context", "refresh", "small") +
      NF.ib("sidebar", "toggle-context", "hideContext", "small") + '</div>' +
      (tools ? '<div class="context-tools">' + tools + '</div>' : '') +
      '<div class="context-body scroll">' + body + '</div>' +
      (foot ? '<div class="context-foot">' + foot + '</div>' : '');
  };

  V.contextProject = function () {
    const st = s();
    const filter = '<label class="field">' + I("search", "sm") + '<input data-action="tree-filter" value="' + E(st.treeFilter) + '" placeholder="' + E(T("search")) + '" aria-label="' + E(T("search")) + '"></label>';
    const q = st.treeFilter.trim().toLowerCase();
    const groups = D.treeGroups.map(function (g) {
      const collapsed = !!st.treeCollapsed[g.id];
      const rows = g.items.map(function (item) {
        const label = X(item.name);
        if (q && label.toLowerCase().indexOf(q) === -1) return '';
        const active = (item.chapter === st.chapter && item.active !== false) || st.activeTreeNode === item.id;
        return '<button class="tree-row' + (active ? ' active' : '') + '" data-action="tree-item" data-value="' + E(item.id) + '" title="' + E(label) + '">' +
          I(item.icon) + '<span class="tree-label">' + E(label) + '</span>' +
          (item.chapter ? '<span class="num">' + String(item.chapter).padStart(2, '0') + '</span>' : '') + '</button>';
      }).join('');
      if (q && !rows) return '';
      return '<div class="tree-group' + (collapsed ? ' collapsed' : '') + '" data-group="' + E(g.id) + '">' +
        '<button class="tree-group-head" data-action="group" data-value="' + E(g.id) + '">' +
        I("caret", "caret") + I(g.icon, "sm") + '<span class="group-name">' + E(X(g.name)) + '</span>' +
        NF.badge(X(g.badge), g.badgeKind) + '</button>' +
        '<div class="tree-children">' + rows + '</div></div>';
    }).join('');
    return V.contextFrame(T("contextTitle"), filter, groups || '<div class="empty">' + E(T("cmdEmpty")) + '</div>',
      '<span>' + E(T("treeCount").replace("{n}", "9")) + '</span>' + NF.badge(T("pageMemory")));
  };

  V.contextKnowledge = function () {
    const st = s();
    const filter = '<label class="field">' + I("search", "sm") + '<input data-action="kb-filter" placeholder="' + E(T("search")) + '" aria-label="' + E(T("search")) + '"></label>';
    const modes = [["混合", "Hybrid", "Гибрид"], ["BM25", "BM25", "BM25"], ["FTS+向量", "FTS+vector", "FTS+вектор"]];
    const chips = modes.map(function (m, i) {
      return '<button class="chip' + (st.kbMode === i ? ' active' : '') + '" data-action="kb-mode" data-value="' + i + '">' + E(X(m)) + '</button>';
    }).join('');
    const docs = D.knowledgeDocs.filter(function (d) {
      return !st.kbFilter || X(d.name).toLowerCase().indexOf(st.kbFilter.toLowerCase()) !== -1;
    }).map(function (d, i) {
      return '<button class="tree-row" data-action="kb-doc" data-value="' + i + '" title="' + E(X(d.name)) + '">' +
        I("file") + '<span class="tree-label">' + E(X(d.name)) + '</span><span class="num">' + d.chunks + '</span></button>';
    }).join('');
    const body = '<div class="context-section"><div class="kicker">RETRIEVAL</div><div class="row" style="flex-wrap:wrap">' + chips + '</div>' +
      '<div class="row between"><span class="muted">Top K</span><span class="mono">' + (st.topK || 6) + '</span></div>' +
      '<div class="row"><button class="btn sm" data-action="kb-open">' + I("search", "sm") + '<span>' + E(T("tabKnowledge")) + '</span></button>' +
      '<button class="btn sm" data-action="kb-reindex">' + I("refresh", "sm") + '<span>' + E(T("refresh")) + '</span></button></div></div>' +
      '<div class="tree-group"><div class="tree-group-head"><span class="group-name">' + E(T("navKnowledge")) + '</span>' + NF.badge(String(D.knowledgeDocs.length), "info") + '</div>' +
      '<div class="tree-children">' + docs + '</div></div>' +
      '<div class="context-callout">' + E(T("footerNote")) + '</div>';
    return V.contextFrame(T("navKnowledge"), filter, body,
      '<span>' + D.knowledgeDocs.length + ' docs · 68 chunks</span>' + NF.badge(T("pageMemory")));
  };

  V.contextCharacters = function () {
    const filter = '<label class="field">' + I("search", "sm") + '<input data-action="char-filter" placeholder="' + E(T("search")) + '" aria-label="' + E(T("search")) + '"></label>';
    const rows = D.characters.map(function (c, i) {
      return '<button class="tree-row" data-action="char-open" data-value="' + i + '">' + I("users") +
        '<span class="tree-label">' + E(X(c.name)) + '</span><span class="num">' + E(X(c.tier)[0]) + '</span></button>';
    }).join('');
    const body = '<div class="context-section"><div class="kicker">CAST</div>' +
      '<div class="col" style="gap:6px">' +
      NF.btn(["从定稿生成档案", "Build profiles from finalised", "Профили из завершённых глав"], { action: "char-extract", icon: "spark", cls: "sm" }) +
      NF.btn(["出场统计扫描", "Appearance scan", "Скан появлений"], { action: "char-scan", icon: "activity", cls: "sm" }) + '</div></div>' +
      '<div class="tree-group"><div class="tree-group-head"><span class="group-name">' + E(T("navCharacters")) + '</span>' + NF.badge(String(D.characters.length), "info") + '</div>' +
      '<div class="tree-children">' + rows + '</div></div>' +
      '<div class="context-callout">' + E(T("rewriteGuard")) + '</div>';
    return V.contextFrame(T("navCharacters"), filter, body, '<span>3 profiles · 2 tiers</span>' + NF.badge(T("pageMemory")));
  };

  V.contextHome = function () {
    const body = '<div class="context-section"><div class="kicker">CURRENT PROJECT</div>' +
      '<strong>' + E(T("projectName")) + '</strong><p class="muted" style="font-size:11px">' + E(T("projectTag")) + '</p>' +
      NF.badge(["写作中", "In progress", "В работе"], "brand") + '</div>' +
      '<div class="context-section"><div class="kicker">ACTIONS</div><div class="col" style="gap:6px">' +
      NF.btn(T("newProject"), { action: "new-project", icon: "plus", cls: "sm" }) +
      NF.btn(T("openProject"), { action: "open-project", icon: "folder", cls: "sm" }) +
      NF.btn(T("importNovel"), { action: "import-novel", icon: "download", cls: "sm" }) + '</div></div>' +
      '<div class="tree-group"><div class="tree-group-head"><span class="group-name">' + E(T("navProjects")) + '</span>' + NF.badge("4", "info") + '</div>' +
      '<div class="tree-children">' + ["雾港来信", "灯塔以西", "第七封信", "潮汐表"].map(function (n, i) {
        return '<button class="tree-row" data-action="project-square" data-value="' + i + '">' + I("book") + '<span class="tree-label">' + E(n) + '</span></button>';
      }).join('') + '</div></div>';
    return V.contextFrame(T("navHome"), '', body, '<span>' + E(T("tipMemoryOnly")) + '</span>');
  };

  /* -------------------------------------------------------------------- tabs */
  V.tabBar = function () {
    const st = s();
    const tabs = st.tabs.map(function (tab) {
      const label = V.tabLabel(tab);
      return '<button class="tab' + (st.activeTab === tab.id ? ' active' : '') + '" data-action="tab" data-value="' + E(tab.id) + '" title="' + E(label) + '">' +
        I(V.tabIcon(tab.type), "sm") + '<span class="tab-label">' + E(label) + '</span>' +
        (tab.type === "chapter" && st.saveState === "unsaved" ? '<i class="dot warning"></i>' : '') +
        '<span class="icon-btn small" data-action="close-tab" data-value="' + E(tab.id) + '" title="' + E(T("tabClose")) + '">' + I("close", "sm") + '</span></button>';
    }).join('');
    return '<div class="tab-list">' + tabs + '</div><div class="tab-actions">' +
      NF.ib("plus", "new-chapter", "newChapter", "small") +
      NF.ib("more", "tab-menu", "tabMenu", "small") + '</div>';
  };

  V.tabLabel = function (tab) {
    if (tab.type === "chapter") return T("chapterShort").replace("{n}", tab.chapter) + " · " + T("tabChapter");
    return X(tab.label);
  };

  V.tabIcon = function (type) {
    const map = { chapter: "edit", board: "board", review: "checkCircle", timeline: "clock", versions: "history", memory: "brain", knowledge: "search", character: "users", config: "sliders", blueprint: "cards", publication: "activity", diff: "compare", welcome: "home" };
    return map[type] || "file";
  };

  /* --------------------------------------------------------------- workspace */
  V.workspace = function () {
    const st = s();
    const tab = st.tabs.find(function (x) { return x.id === st.activeTab; });
    const type = tab ? tab.type : "welcome";
    if (type === "chapter") return V.document(tab);
    return V.view(type, tab);
  };

  V.document = function (tab) {
    const st = s();
    const body = st.draft[tab.chapter] || V.proseHTML(tab.chapter);
    const words = V.plainWords(body);
    const title = V.chapterTitle(tab.chapter);
    const toolbar = '<div class="document-toolbar"><div class="doc-tools">' +
      NF.ib("refresh", "undo", "undo", "small") + NF.ib("refresh", "redo", "redo", "small") +
      '<span class="title-sep"></span>' +
      NF.btn(T("draftTools"), { action: "revise", icon: "wand", cls: "sm" }) +
      NF.btn(T("reviewTools"), { action: "tab", value: "review", cls: "sm", icon: "checkCircle" }) +
      NF.btn(T("rewrite"), { action: "rewrite-open", icon: "edit", cls: "sm" }) +
      NF.btn(T("finalize"), { action: "finalize", icon: "check", cls: "sm primary" }) +
      '</div><div class="spacer"></div><div class="doc-meta">' +
      '<span class="mono">' + words + ' ' + E(T("wordsUnit")) + '</span>' +
      NF.badge(st.saveState === "saved" ? T("saved") : T("unsaved"), st.saveState === "saved" ? "success" : "warning") +
      NF.ib("save", "save", "save", "small") + NF.ib("focus", "focus", "focus", "small") + '</div></div>';
    const sheet = '<div class="document-scroll" id="document-scroll"><div class="sheet">' +
      '<div class="sheet-head"><div><div class="chapter-no">CHAPTER ' + String(tab.chapter).padStart(2, "0") + ' / DRAFT</div>' +
      '<h2>' + E(title) + '</h2><div class="sheet-tags"><span class="paper-chip">' + E(T("projectName")) + '</span>' +
      '<span class="paper-chip">' + E(T("docStatus").replace("{n}", tab.chapter)) + '</span></div></div>' +
      '<div class="col" style="align-items:flex-end;gap:4px"><span class="paper-chip mono">' + words + ' ' + E(T("wordsUnit")) + '</span>' +
      '<span class="paper-chip">' + E(T("pageMemory")) + '</span></div></div>' +
      '<div class="sheet-body" id="sheet-body" contenteditable="true" spellcheck="false" aria-label="' + E(T("tabChapter")) + '">' + body + '</div>' +
      '<div class="sheet-foot"><span>' + E(T("tipMemoryOnly")) + '</span><span>' + E(T("autoNoteSafe")) + '</span></div>' +
      '</div></div>';
    return toolbar + sheet;
  };

  V.proseHTML = function () {
    return D.prose.map(function (p) { return '<p>' + E(p) + '</p>'; }).join('');
  };

  V.plainWords = function (html) {
    return String(html).replace(/<[^>]*>/g, "").replace(/\s/g, "").length;
  };

  V.chapterTitle = function (n) {
    const map = { 1: ["明天的日期", "Tomorrow's date", "Завтрашняя дата"], 4: ["无人的灯塔", "The empty lighthouse", "Пустой маяк"], 5: ["潮汐表", "Tide table", "Таблица приливов"], 6: ["铜钥匙", "The brass key", "Латунный ключ"], 7: ["盐粒与信封", "Salt on the envelope", "Соль на конверте"], 8: ["逆流的门", "The upstream door", "Дверь против течения"] };
    return X(map[n] || ["第 " + n + " 章", "Chapter " + n, "Глава " + n]);
  };

  V.view = function (type) {
    const st = s();
    const head = function (title, desc, actions) {
      return '<div class="view-head"><div><h2>' + E(X(title)) + '</h2>' + (desc ? '<p>' + E(X(desc)) + '</p>' : '') + '</div>' +
        '<div class="row">' + (actions || '') + '</div></div>';
    };
    const wrap = function (content) { return '<div class="view scroll">' + content + '</div>'; };

    if (type === "board") {
      const cols = [
        ["待创作", "Planned", "Запланировано", "planned"],
        ["写作中", "In progress", "В работе", "drafting"],
        ["审阅中", "In review", "На рецензии", "review"],
        ["已定稿", "Finalised", "Завершено", "done"]
      ];
      const cards = D.blueprints.map(function (b) {
        return '<button class="board-card' + (b.chapter === st.chapter ? ' active' : '') + '" data-action="chapter" data-value="' + b.chapter + '">' +
          '<span class="mono faint">CH ' + String(b.chapter).padStart(2, "0") + '</span><strong>' + E(X(b.title)) + '</strong>' +
          '<p>' + E(X(b.goal)) + '</p><span class="row">' + NF.badge(X(b.state === "done" ? ["已定稿", "Finalised", "Завершено"] : b.state === "drafting" ? ["写作中", "In progress", "В работе"] : ["待创作", "Planned", "Запланировано"]), b.state === "done" ? "success" : b.state === "drafting" ? "brand" : "") + '</span></button>';
      }).join('');
      const colHtml = cols.map(function (c, i) {
        return '<div class="board-col"><h3>' + E(X([c[0], c[1], c[2]])) + NF.badge(String(i === 1 ? 2 : 1)) + '</h3>' +
          (i === 1 ? cards : i === 2 ? '<div class="board-card"><span class="mono faint">CH 06</span><strong>' + E(X(D.blueprints[2].title)) + '</strong><p>' + E(T("reviewSummaryBody")) + '</p></div>' :
            i === 3 ? '<div class="board-card"><span class="mono faint">CH 01—04</span><strong>' + E(T("tabVersions")) + '</strong><p>' + E(T("originalKept")) + '</p></div>' : '') + '</div>';
      }).join('');
      const views = [["card", "cardView"], ["list", "listView"], ["outline", "outlineView"], ["timeline", "timelineView"]].map(function (v) {
        return '<button class="chip' + (st.boardView === v[0] ? ' active' : '') + '" data-action="board-view" data-value="' + v[0] + '">' + E(T(v[1])) + '</button>';
      }).join('');
      return wrap(head(T("tabBoard"), ["每一章都有自己的任务。", "Give every chapter a purpose.", "У каждой главы своя задача."],
        NF.btn(T("newBlueprint"), { action: "new-chapter", icon: "plus", cls: "sm" })) +
        '<div class="row" style="margin-bottom:12px;flex-wrap:wrap">' + views + '</div>' +
        '<div class="stat-grid">' + V.stat(["12 章蓝图", "12 blueprints", "12 планов"], "12") + V.stat(T("totalWords"), "42,860") + V.stat(T("finalized") || "定稿", "4") + V.stat(T("projectProgress") || "进度", "36%") + '</div>' +
        '<div class="board' + (st.boardView === "list" ? ' board-list' : '') + '">' + colHtml + '</div>');
    }

    if (type === "review") {
      const roles = D.reviewRoles.map(function (r) {
        return '<div class="review-role"><strong>' + E(X(r.name)) + '</strong><span class="score">' + r.score + '</span>' +
          '<div class="progress"><span style="width:' + (parseFloat(r.score) * 10) + '%"></span></div><p>' + E(X(r.note)) + '</p></div>';
      }).join('');
      return wrap(head(T("tabReview"), T("reviewSummaryBody"), NF.btn(T("weightedScore"), { action: "info-review", icon: "activity", cls: "sm" })) +
        '<div class="review-grid">' + roles + '</div>' +
        '<div class="panel" style="margin-top:16px"><h3>' + E(T("reviewSummary")) + '</h3><p class="muted">' + E(T("reviewSummaryBody")) + '</p>' +
        '<div class="row" style="margin-top:12px;flex-wrap:wrap">' +
        NF.btn(T("accept"), { action: "review-accept", cls: "sm primary", icon: "check" }) +
        NF.btn(T("reject"), { action: "review-reject", cls: "sm", icon: "close" }) +
        NF.btn(T("originalKept"), { action: "versions", cls: "sm", icon: "history" }) + '</div></div>' +
        '<div class="panel" style="margin-top:12px"><h3>' + E(T("safety") || T("originalKept")) + '</h3><p class="muted">' + E(T("rewriteGuard")) + '</p></div>');
    }

    if (type === "timeline") {
      const rows = [
        ["第 01 天", "Day 01", "День 01", ["雾港封港", "Harbour closes", "Порт закрыт"]],
        ["第 07 天", "Day 07", "День 07", ["明天的信抵达", "Tomorrow's letter arrives", "Письмо из завтра"]],
        ["第 14 天", "Day 14", "День 14", ["铜钥匙交接", "Brass key handover", "Передача ключа"]],
        ["第 21 天", "Day 21", "День 21", ["灯塔熄灯", "Lighthouse dark", "Маяк погас"]],
        ["第 30 天", "Day 30", "День 30", ["退潮开门", "Door opens at low tide", "Дверь в отлив"]]
      ].map(function (r) {
        return '<div class="timeline-row"><span class="when">' + E(X([r[0], r[1], r[2]])) + '</span><span class="axis"></span>' +
          '<div class="what"><strong>' + E(X(r[3])) + '</strong>' + E(T("projectName")) + ' · ' + E(T("pageMemory")) + '</div></div>';
      }).join('');
      return wrap(head(T("tabTimeline"), ["12 个世界实体 · 8 条时间线事件", "12 world entities · 8 timeline events", "12 сущностей · 8 событий"]) +
        '<div class="panel"><div class="timeline">' + rows + '</div></div>');
    }

    if (type === "versions") {
      const rows = [["初稿 v1 · 原型基线", "Initial v1 · Demo baseline", "Черновик v1 · База"], ["编辑建议 v2 · 未应用", "Editorial proposal v2 · Not applied", "Предложение v2 · Не применено"], ["当前内存草稿", "Current in-memory draft", "Текущий черновик в памяти"]].map(function (n, i) {
        return '<div class="list-row"><span class="mono faint">v' + (i + 1) + '</span><span class="grow"><strong>' + E(X(n)) + '</strong></span>' +
          NF.badge(i === 2 ? T("pageMemory") : T("originalKept"), i === 2 ? "brand" : "success") +
          NF.btn(T("restore"), { action: i === 2 ? "info-version" : "restore-version", cls: "sm" }) + '</div>';
      }).join('');
      return wrap(head(T("versionTitle"), T("restoreBody"), NF.btn(T("backupRecover"), { action: "recover-backup", icon: "history", cls: "sm" })) +
        '<div class="list-rows">' + rows + '</div><div class="panel" style="margin-top:12px"><h3>' + E(T("originalKept")) + '</h3><p class="muted">' + E(T("restoreBody")) + '</p></div>');
    }

    if (type === "memory") {
      const rows = [["章节记忆 · 第 07 章", "Chapter memory · 07", "Память главы · 07", "success", ["已生成", "Ready", "Готово"]],
      ["卷记忆 · 第一卷", "Volume memory · I", "Память тома · I", "success", ["已生成", "Ready", "Готово"]],
      ["全书状态 · 第 3 卷", "Book state · Volume 3", "Состояние книги · Том 3", "warning", ["待重建", "Needs rebuild", "Требует пересборки"]]].map(function (r) {
        return '<div class="list-row"><span class="grow"><strong>' + E(X([r[0], r[1], r[2]])) + '</strong></span>' +
          NF.badge(X(r[4]), r[3]) + NF.btn(T("refresh"), { action: "memory-rebuild", cls: "sm" }) + '</div>';
      }).join('');
      return wrap(head(T("tabMemory"), T("contextNote"), NF.btn(T("restore"), { action: "memory-rebuild", icon: "refresh", cls: "sm" })) +
        '<div class="list-rows">' + rows + '</div><div class="context-callout" style="margin-top:12px">' + E(T("contextNote")) + '</div>');
    }

    if (type === "knowledge") {
      const rows = D.knowledgeDocs.map(function (d, i) {
        return '<div class="kb-row"><span class="grow">' + E(X(d.name)) + '</span><span>' + E(X(d.type)) + '</span>' +
          '<span class="mono">' + (0.94 - i * 0.07).toFixed(2) + '</span><span class="mono">' + d.chunks + '</span></div>';
      }).join('');
      return wrap(head(T("tabKnowledge"), ["混合检索 · Top K 6 · 3 项引用已注入", "Hybrid retrieval · Top K 6 · 3 references injected", "Гибридный поиск · Top K 6 · 3 источника"]) +
        '<div class="panel"><h3>' + E(T("references")) + '</h3><div class="kb-table"><div class="kb-row head"><span>' + E(T("name") || "名称") + '</span><span>TYPE</span><span>SCORE</span><span>CHUNKS</span></div>' + rows + '</div></div>' +
        '<div class="panel" style="margin-top:12px"><h3>' + E(T("contextBudget")) + '</h3><p class="muted">' + E(T("contextNote")) + '</p></div>');
    }

    if (type === "character") {
      return wrap(head(T("tabCharacter"), T("contextNote")) + '<div class="char-grid">' + D.characters.map(function (c) {
        return '<div class="char-card"><div class="avatar">' + E(X(c.name)[0]) + '</div><strong>' + E(X(c.name)) + '</strong>' +
          NF.badge(X(c.tier), "brand") + '<p>' + E(X(c.desc)) + '</p>' +
          '<div class="row" style="flex-wrap:wrap">' + NF.badge(X(c.role), "info") + NF.badge(["反向链接 3", "3 backlinks", "3 ссылки"]) + '</div></div>';
      }).join('') + '</div>');
    }

    if (type === "config") {
      const rows = [["题材", "Genre", "Жанр", ["悬疑 · 近未来", "Mystery · Near future", "Детектив · Будущее"]],
      ["视角", "POV", "POV", ["第三人称限知", "Limited third person", "Ограниченное 3-е лицо"]],
      ["篇幅", "Length", "Объём", ["120,000 字", "120,000 chars", "120 000 зн."]],
      ["节奏", "Pacing", "Ритм", ["慢热 · 三幕", "Slow burn · 3 acts", "Медленный · 3 акта"]]].map(function (r) {
        return '<div class="setting-line"><span>' + E(X([r[0], r[1], r[2]])) + '</span><span class="value">' + E(X(r[3])) + '</span></div>';
      }).join('');
      return wrap(head(T("tabConfig"), T("projectTag")) + '<div class="panel" style="max-width:620px"><h3>' + E(T("projectName")) + '</h3>' + rows + '</div>');
    }

    if (type === "blueprint") {
      const b = D.blueprints[0];
      const rows = [["sceneGoal", "本章目标", "Цель главы", b.goal], ["conflict", "核心冲突", "Конфликт", b.conflict], ["ending", "结尾钩子", "Крючок", b.hook]].map(function (r) {
        return '<div class="setting-line"><span>' + E(T(r[0]) || r[1]) + '</span><span class="value">' + E(X(r[3])) + '</span></div>';
      }).join('');
      return wrap(head(T("tabBlueprint"), X(b.title), NF.btn(T("openManuscript"), { action: "tab", value: "chapter", cls: "sm primary", icon: "edit" })) +
        '<div class="panel" style="max-width:680px"><h3>' + E(X(b.title)) + '</h3>' + rows +
        '<div class="row" style="margin-top:12px;flex-wrap:wrap">' + D.characters.map(function (c) { return NF.badge(X(c.name), "info"); }).join('') + '</div></div>');
    }

    if (type === "publication") {
      const rows = [["平台第 07 章", "Platform ch. 07", "Глава 07 на платформе", "92%"], ["平台第 08 章", "Platform ch. 08", "Глава 08 на платформе", "87%"], ["平台第 09 章", "Platform ch. 09", "Глава 09 на платформе", "—"]].map(function (r) {
        return '<div class="list-row"><span class="grow"><strong>' + E(X([r[0], r[1], r[2]])) + '</strong></span>' +
          NF.badge(r[3], "warning") + NF.btn(T("importNovel"), { action: "import-novel", cls: "sm" }) + '</div>';
      }).join('');
      return wrap(head(T("tabPublication"), ["相似度审计 · 只读", "Similarity audit · Read-only", "Аудит сходства · Только чтение"]) + '<div class="list-rows">' + rows + '</div>');
    }

    if (type === "diff") {
      return wrap(head(T("tabDiff"), T("rewriteGuard")) + '<div class="diff-grid"><div class="diff-col"><h3>' + E(T("original")) + '</h3><p>' + E(D.prose[2]) + '</p></div>' +
        '<div class="diff-col"><h3>' + E(T("replacement") || T("rewrite")) + '</h3><p><span class="removed">' + E("「你终于来了。」") + '</span> <span class="added">' + E("守塔人把灯罩往下压了压，没有回头。") + '</span></p></div></div>');
    }

    /* welcome */
    return wrap(head(T("tabWelcome"), T("windowHint")) +
      '<div class="stat-grid">' + V.stat(T("totalWords"), "42,860") + V.stat(T("modelCalls"), "1,284") + V.stat(T("tokens"), "2.41M") + V.stat(T("cost"), "¥38.60") + '</div>' +
      '<div class="char-grid">' +
      NF.btn(T("newProject"), { action: "new-project", icon: "plus" }) +
      NF.btn(T("openProject"), { action: "open-project", icon: "folder" }) +
      NF.btn(T("importNovel"), { action: "import-novel", icon: "download" }) + '</div>');
  };

  V.stat = function (label, value) {
    return '<div class="stat"><span class="kicker">' + E(X(label)) + '</span><strong>' + E(value) + '</strong><small>' + E(T("pageMemory")) + '</small></div>';
  };

  /* -------------------------------------------------------------- runtime bar */
  V.runtime = function () {
    const st = s();
    const tabs = [["tasks", "runtimeTasks", "tasks"], ["log", "runtimeLog", "log"], ["inbox", "runtimeInbox", "bell"]].map(function (t) {
      return '<button class="runtime-tab' + (st.runtimeTab === t[0] ? ' active' : '') + '" data-action="runtime-tab" data-value="' + t[0] + '">' +
        I(t[2], "sm") + '<span>' + E(T(t[1])) + '</span>' +
        (t[0] === "inbox" ? NF.badge("2", "warning") : t[0] === "tasks" ? NF.badge("2", "brand") : '') + '</button>';
    }).join('');
    let body = '';
    if (st.runtimeTab === "tasks") {
      body = D.tasks.map(function (task, i) {
        const stateKey = { awaiting: "awaiting", running: "running", completed: "completed" }[task.state];
        return '<div class="task-row"><i class="dot ' + (task.state === "running" ? "brand pulse" : task.state === "awaiting" ? "warning" : "success") + '"></i>' +
          '<div class="task-main"><div class="row between"><strong>' + E(X(task.name)) + '</strong>' + NF.badge(T(stateKey), task.state === "awaiting" ? "warning" : task.state === "completed" ? "success" : "brand") + '</div>' +
          '<small>' + E(X(task.scope)) + '</small><div class="progress"><span style="width:' + task.progress + '%"></span></div></div>' +
          '<div class="row">' + (task.state === "awaiting" ? NF.btn(T("viewResult"), { action: "task-approve", value: i, cls: "sm primary" }) : task.state === "running" ? NF.btn(T("cancelTask"), { action: "task-cancel", value: i, cls: "sm" }) : NF.badge(T("completed"), "success")) + '</div></div>';
      }).join('');
    } else if (st.runtimeTab === "log") {
      body = (st.logs || D.logs).map(function (l) {
        return '<div class="log-row"><span>' + E(l.time) + '</span><span class="lv-' + l.level + '">' + E(l.level.toUpperCase()) + '</span><span class="truncate">' + E(l.text) + '</span></div>';
      }).join('');
    } else {
      body = D.inbox.map(function (n, i) {
        return '<div class="inbox-row' + (n.unread ? ' unread' : '') + '">' + I("bell", "sm") +
          '<span class="grow">' + E(X(n.name)) + '</span>' + NF.badge(X(n.tag), n.unread ? "warning" : "success") +
          NF.btn(T("viewResult"), { action: "inbox-open", value: i, cls: "sm" }) + '</div>';
      }).join('');
    }
    const actions = '<div class="runtime-actions">' +
      (st.runtimeTab === "log" ? NF.ib("trash", "log-clear", "clearLog", "small") : '') +
      NF.ib("chevron", "toggle-runtime", st.runtimeCollapsed ? "viewResult" : "runtimeTasks", "small", "") + '</div>';
    return '<div class="runtime-tabs">' + tabs + actions + '</div>' +
      (st.runtimeCollapsed ? '' : '<div class="runtime-body scroll">' + body + '</div>');
  };

  /* ------------------------------------------------------------ AI assistant */
  V.assistant = function () {
    const st = s();
    const head = '<div class="ai-head"><strong>' + E(T("agentTitle")) + '</strong><div class="row">' +
      NF.ib("spark", "ai-tab", "agentTab", "small" + (st.aiTab === "agent" ? " active" : ""), "agent") +
      NF.ib("output", "ai-tab", "outputTab", "small" + (st.aiTab === "output" ? " active" : ""), "output") +
      NF.ib("focus", "focus", "focus", "small") +
      NF.ib("sun", "theme-cycle", "themeMenu", "small") +
      NF.ib("close", "toggle-assistant", "hideAssistant", "small") + '</div></div>';
    const tabs = '<div class="ai-tabs">' +
      '<button class="ai-tab' + (st.aiTab === "agent" ? ' active' : '') + '" data-action="ai-tab" data-value="agent">' + E(T("agentTab")) + '</button>' +
      '<button class="ai-tab' + (st.aiTab === "output" ? ' active' : '') + '" data-action="ai-tab" data-value="output">' + E(T("outputTab")) + '</button></div>';
    if (st.aiTab === "output") {
      const steps = [
        ["正文入库", "Store manuscript", "Сохранение текста"],
        ["剧情提取", "Extract plot", "Извлечение сюжета"],
        ["角色更新", "Update characters", "Обновление персонажей"],
        ["伏笔扫描", "Scan foreshadowing", "Сканирование намёков"]
      ].map(function (x, i) {
        return '<div class="output-step"><div class="row between"><strong>' + E(X([x[0], x[1], x[2]])) + '</strong>' + NF.badge(i < 2 ? T("completed") : i === 2 ? T("running") : T("awaiting"), i < 2 ? "success" : i === 2 ? "brand" : "warning") + '</div>' +
          '<p>' + E(T("outputRunning")) + ' · ' + E(T("pageMemory")) + '</p></div>';
      }).join('');
      return head + tabs + '<div class="ai-thread scroll">' + steps +
        '<div class="panel"><h3>' + E(T("history")) + '</h3><div class="list-rows">' +
        '<div class="list-row"><span class="grow"><strong>' + E(T("task1") || "连续性校检") + '</strong></span>' + NF.badge("10", "info") + '</div></div></div></div>' +
        '<div class="ai-compose">' + NF.btn(T("abortGeneration"), { action: "ai-stop", icon: "stop", cls: "sm" }) +
        '<div class="compose-hint">' + E(T("scriptedReply")) + '</div></div>';
    }
    const initial = '<div class="msg msg-ai"><div class="msg-meta">' + I("spark", "sm") + '<span>' + E(T("agentTitle")) + ' · ' + E(T("scriptedReply")) + '</span></div>' +
      '<div class="plan-steps">' +
      '<div class="plan-step done">' + I("check", "sm") + '<span>' + E(T("references")) + ' · 3</span></div>' +
      '<div class="plan-step done">' + I("check", "sm") + '<span>' + E(T("contextBudget")) + ' · 46%</span></div>' +
      '<div class="plan-step running">' + I("activity", "sm") + '<span>' + E(T("running")) + ' · ' + E(T("suggestionContinuity")) + '</span></div></div>' +
      '<div class="tool-call"><strong>retrieval.hybrid_search</strong><span>' + E(T("referencesBody")) + '</span></div>' +
      '<div class="artifact-card"><strong>' + E(T("reviewSummary")) + '</strong><p>' + E(T("reviewSummaryBody")) + '</p>' +
      '<button class="btn sm" data-action="references-open">' + I("link", "sm") + '<span>' + E(T("references")) + '</span></button></div>' +
      (st.notesDismissed ? '' : '<div class="suggestion"><strong>' + E(T("suggestionPacing")) + '</strong><p>' + E(T("suggestionPacingBody")) + '</p>' +
        '<div class="row">' + NF.btn(T("viewRewrite"), { action: "rewrite-open", cls: "sm primary" }) + NF.btn(T("dismiss"), { action: "dismiss-note", cls: "sm" }) + '</div></div>' +
        '<div class="suggestion"><strong>' + E(T("suggestionContinuity")) + '</strong><p>' + E(T("suggestionContinuityBody")) + '</p>' +
        '<div class="row">' + NF.btn(T("goReview") || T("viewResult"), { action: "tab", value: "review", cls: "sm" }) + '</div></div>') +
      '<div class="context-ring"><div class="ring"><b>46%</b></div><div class="col"><strong>' + E(T("contextBudget")) + '</strong><span>' + E(T("contextBreakdown")) + '</span></div>' +
      NF.ib("info", "references-open", "references", "small") + '</div></div>';
    const extra = (st.aiMessages || []).map(function (m) {
      return '<div class="msg ' + (m.role === "user" ? "msg-user" : "msg-ai") + '">' + E(m.text) + '</div>';
    }).join('');
    const compose = '<div class="ai-compose"><div class="compose-box"><textarea id="ai-input" placeholder="' + E(T("composePlaceholder")) + '" aria-label="' + E(T("send")) + '"></textarea>' +
      '<div class="compose-tools"><span class="chip">@ ' + E(T("references")) + '</span><span class="chip">/ ' + E(T("commandGroupGeneral")) + '</span>' +
      '<span class="chip" data-action="model-picker" data-value="' + E(st.model || "elite") + '">' + E(st.model || "elite") + '</span>' +
      '<span class="chip" data-action="thinking-cycle">' + E(T("thinking")) + ' · ' + E(st.thinking || "L2") + '</span>' +
      '<span class="spacer"></span>' + NF.btn(T("send"), { action: "ai-send", icon: "arrow", cls: "sm primary" }) + '</div></div>' +
      '<div class="compose-hint">' + E(T("scriptedReply")) + ' · ' + E(T("tipMemoryOnly")) + '</div></div>';
    return head + tabs + '<div class="ai-thread scroll">' + initial + extra + '</div>' + compose;
  };

  /* --------------------------------------------------------------- status bar */
  V.statusbar = function () {
    const st = s();
    const chapterWords = V.plainWords(st.draft[st.chapter] || V.proseHTML());
    const left = '<div class="status-left">' +
      '<button class="status-btn" data-action="info-about"><strong>' + E(T("appName")) + '</strong> <span class="mono">v0.1.7-beta.3</span></button>' +
      '<span class="status-sep"></span>' +
      '<button class="status-btn hide-in-focus" data-action="tab" data-value="chapter">' + I("file", "sm") +
      '<span>' + E(T("chapterShort").replace("{n}", st.chapter)) + ' · ' + chapterWords + ' ' + E(T("wordsUnit")) + '</span>' +
      '<i class="dot ' + (st.saveState === "saved" ? "success" : "warning") + '"></i></button>' +
      '<span class="status-sep"></span>' +
      '<button class="status-btn" data-action="versions">' + I("branch", "sm") + '<span>' + E(T("branchMain")) + '</span></button>' +
      '</div>';
    const right = '<div class="status-right">' +
      '<button class="status-btn" data-action="toggle-assistant">' + I("spark", "sm") + '<span>' + E(st.aiTab === "output" ? T("agentBusy") : T("agentIdle")) + '</span></button>' +
      '<button class="status-btn" data-action="cost-reset" title="' + E(T("sessionCost")) + '">' + I("coin", "sm") + '<span class="mono">' + E(st.cost || "¥ 0.42") + '</span></button>' +
      '<span class="task-capsule"><i class="dot brand pulse"></i><span>' + E(T("running")) + ' 2/4</span><span class="progress"><span style="width:62%"></span></span></span>' +
      '<button class="status-btn optional" data-action="thinking-cycle">' + I("brain", "sm") + '<span>' + E(st.thinking || "L2") + '</span></button>' +
      '<button class="status-btn optional" data-action="model-picker" data-value="' + E(st.model || "elite") + '">' + I("spark", "sm") + '<span>' + E(st.model || "elite") + '</span></button>' +
      '<button class="status-btn optional" data-action="notifications">' + I("bell", "sm") + '<span class="dot warning"></span></button>' +
      '<div class="zoom-group">' +
      NF.ib("minus", "zoom", "zoom", "small", "-") +
      '<button class="status-btn mono" data-action="zoom" data-value="reset">' + (st.zoom || 100) + '%</button>' +
      NF.ib("plus", "zoom", "zoom", "small", "+") + '</div></div>';
    return left + right;
  };

  /* ---------------------------------------------------------- appearance UI */
  V.appearance = function () {
    const st = s();
    const section = function (title, content) { return '<div class="appearance-section"><h3>' + E(title) + '</h3>' + content + '</div>'; };
    const modes = NF.segment(D.modes, st.mode, "set-mode");
    const palettes = '<div class="palette-options">' + D.palettes.map(function (p) {
      return '<button class="palette-option' + (st.palette === p.id ? ' active' : '') + '" data-action="set-palette" data-value="' + p.id + '">' +
        '<i class="palette-dot ' + p.id + '"></i><span>' + E(X(p.name)) + '</span></button>';
    }).join('') + '</div>';
    const densities = NF.segment(D.densities, st.density, "set-density");
    const sizes = NF.segment([{ id: "17", name: ["17px", "17px", "17px"] }, { id: "18", name: ["18px", "18px", "18px"] }], st.writingSize, "set-writing-size");
    const backgrounds = '<div class="background-options">' +
      [["plain", "bgPlain", "plain"], ["grid", "bgGrid", "grid"], ["mist", "bgMist", "mist"]].map(function (b) {
        return '<button class="background-option' + (st.bg === b[0] ? ' active' : '') + '" data-action="set-bg" data-value="' + b[0] + '">' +
          '<i class="background-sample ' + (b[0] === "grid" ? "grid" : b[0] === "mist" ? "mist" : "") + '"></i><span>' + E(T(b[1])) + '</span></button>';
      }).join('') + '</div>';
    const upload = '<label class="upload-area">' + I("upload") + '<span>' + E(T("bgUpload")) + '</span>' +
      '<input type="file" accept="image/*" data-action="bg-upload"><small>' + E(T("bgUploadHint")) + '</small></label>' +
      (st.bgImageName ? '<div class="image-current"><img src="' + E(st.bgImageData) + '" alt=""><span>' + E(st.bgImageName) + '</span>' +
        NF.ib("close", "bg-remove", "bgRemove", "small") + '</div>' : '');
    const slider = function (label, action, value, min, max, step, out) {
      return '<div class="range-control"><div class="row"><span>' + E(T(label)) + '</span><output>' + E(out) + '</output></div>' +
        '<input type="range" data-action="' + action + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></div>';
    };
    return '<div class="appearance-head"><h2 id="appearance-title">' + E(T("appearanceTitle")) + '</h2>' +
      NF.ib("close", "appearance-close", "close", "small") + '</div>' +
      '<div class="appearance-body scroll">' +
      section(T("modeLabel"), modes) +
      section(T("paletteLabel"), palettes) +
      section(T("densityLabel"), densities) +
      section(T("writingSizeLabel"), sizes) +
      section(T("backgroundLabel"), backgrounds + upload +
        slider("bgStrength", "bg-strength", Math.round(st.bgStrength * 100), 0, 100, 1, Math.round(st.bgStrength * 100) + "%") +
        slider("bgVeil", "bg-veil", st.bgVeil, 0, 80, 1, st.bgVeil + "%") +
        slider("bgBlur", "bg-blur", st.bgBlur, 0, 12, 1, st.bgBlur + "px")) +
      '<div class="appearance-description muted" style="font-size:11px;line-height:1.7">' + E(T("appearanceNote")) + '</div>' +
      '</div><div class="appearance-foot">' + NF.btn(T("resetAppearance"), { action: "appearance-reset", cls: "sm" }) +
      NF.btn(T("done"), { action: "appearance-close", cls: "sm primary" }) + '</div>';
  };

  /* ------------------------------------------------------------------ modals */
  V.modalHead = function (title) {
    return '<div class="modal-head"><h2 id="modal-title">' + E(X(title)) + '</h2>' + NF.ib("close", "modal-close", "close", "small") + '</div>';
  };
  V.modalFoot = function (note, buttons) {
    return '<div class="modal-foot">' + (note ? '<span class="note">' + E(X(note)) + '</span>' : '') + buttons + '</div>';
  };

  V.commandResults = function (query) {
    const q = String(query || "").trim().toLowerCase();
    let html = '', total = 0;
    D.commands.forEach(function (group) {
      const matches = group.items.filter(function (c) {
        if (!q) return true;
        return [c.name[0], c.name[1], c.name[2]].join(" ").toLowerCase().indexOf(q) !== -1;
      });
      if (!matches.length) return;
      total += matches.length;
      html += '<div class="command-group">' + E(T(group.group)) + '</div>' + matches.map(function (c, i) {
        return '<button class="command-row' + (total - matches.length + i === 0 ? ' active' : '') + '" data-action="command-run" data-value="' + E(c.hint) + '">' +
          I(c.icon) + '<span>' + E(X(c.name)) + '</span>' + (c.kbd ? '<kbd>' + E(c.kbd) + '</kbd>' : '') + '</button>';
      }).join('');
    });
    return html || '<div class="empty">' + E(T("cmdEmpty")) + '</div>';
  };

  V.modal = function (kind, data) {
    const st = s();
    const d = data || {};
    if (kind === "command") {
      return { compact: false, html: V.modalHead(T("cmdPlaceholder")) +
        '<div class="command-input">' + I("search") + '<input id="command-input" data-action="command-query" placeholder="' + E(T("cmdPlaceholder")) + '" autocomplete="off" aria-label="' + E(T("cmdPlaceholder")) + '"><kbd>ESC</kbd></div>' +
        '<div class="command-results" id="command-results">' + V.commandResults("") + '</div>' +
        V.modalFoot(T("cmdHint"), '') };
    }
    if (kind === "settings") {
      const nav = '<div class="field">' + I("search", "sm") + '<input placeholder="' + E(T("settingsSearch")) + '" aria-label="' + E(T("settingsSearch")) + '"></div>' +
        D.settingsSections.map(function (sec) {
          return '<button class="settings-nav-item' + (st.settingsSection === sec.id ? ' active' : '') + '" data-action="settings-section" data-value="' + sec.id + '">' + I(sec.icon, "sm") + '<span>' + E(X(sec.name)) + '</span></button>';
        }).join('');
      const sec = D.settingsSections.find(function (x) { return x.id === st.settingsSection; }) || D.settingsSections[0];
      const rows = sec.rows.map(function (r, i) {
        const control = r.toggle
          ? '<button class="switch' + (st.settingsToggles[sec.id + ":" + i] ? ' on' : '') + '" data-action="settings-toggle" data-value="' + sec.id + ':' + i + '" aria-label="' + E(X(r.label)) + '"></button>'
          : '<span class="value">' + E(X(r.value)) + '</span>';
        return '<div class="setting-line"><span>' + E(X(r.label)) + '</span>' + control + '</div>';
      }).join('');
      const route = sec.id === "llm" ? '<div class="route-grid">' +
        [["elite", "创意写作", "Creative writing", "Креатив"], ["standard", "标准分析", "Analysis", "Анализ"], ["budget", "轻量处理", "Light tasks", "Лёгкие задачи"]].map(function (r) {
          return '<div class="route-card"><strong>' + E(X([r[1], r[2], r[3]])) + '</strong><small>' + r[0] + '</small><small>' + E(T("pageMemory")) + '</small></div>';
        }).join('') + '</div>' : '';
      const pane = '<h3>' + E(X(sec.name)) + '</h3><p class="muted">' + E(X(sec.desc)) + '</p>' +
        (route ? '<div class="settings-block"><h4>' + E(T("modelRoute") || "分层模型路由") + '</h4>' + route + '</div>' : '') +
        '<div class="settings-block"><h4>' + E(T("settingsTitle")) + '</h4>' + rows + '</div>' +
        '<div class="context-callout">' + E(T("appearanceNote")) + '</div>';
      return { compact: false, html: V.modalHead(T("settingsTitle")) +
        '<div class="settings-layout"><div class="settings-nav scroll">' + nav + '</div><div class="settings-pane scroll" id="settings-pane">' + pane + '</div></div>' +
        V.modalFoot(st.settingsDirty ? T("settingsDirty") : T("tipMemoryOnly"), NF.btn(T("done"), { action: "modal-close", cls: "sm primary" })) };
    }
    if (kind === "activity") {
      let cells = '';
      for (let i = 0; i < 182; i++) {
        const level = (i * 7 + (i % 13) * 3) % 11;
        cells += '<i class="heat-cell ' + (level > 8 ? "l4" : level > 6 ? "l3" : level > 4 ? "l2" : level > 2 ? "l1" : "") + '" title="day ' + (i + 1) + '"></i>';
      }
      const bars = [32, 48, 40, 62, 55, 71, 66, 82, 74, 90, 78, 58].map(function (v, i) {
        return '<div class="bar-col"><span style="height:' + v + '%"></span><small>' + (i + 1) + '</small></div>';
      }).join('');
      const body = '<div class="stat-grid">' + V.stat(T("totalWords"), "42,860") + V.stat(T("modelCalls"), "1,284") + V.stat(T("tokens"), "2.41M") + V.stat(T("cost"), "¥38.60") + '</div>' +
        '<div class="activity-grid"><div class="activity-block"><h3>' + E(T("heatmapTitle")) + '</h3><div class="heatmap">' + cells + '</div></div>' +
        '<div class="activity-block"><h3>' + E(T("trendTitle")) + '</h3><div class="bar-chart">' + bars + '</div></div></div>' +
        '<div class="activity-block" style="margin-top:12px"><h3>' + E(T("globalStats")) + '</h3><p class="muted">' + E(T("footerNote")) + '</p></div>';
      return { compact: false, html: V.modalHead(T("activityTitle")) + '<div class="modal-body">' + body + '</div>' + V.modalFoot(T("pageMemory"), NF.btn(T("done"), { action: "modal-close", cls: "sm primary" })) };
    }
    if (kind === "new-chapter") {
      const body = '<div class="modal-field"><span>' + E(T("chapterTitleField")) + '</span><input id="new-chapter-title" placeholder="' + E(T("chapterTitleField")) + '"></div>' +
        '<div class="modal-field"><span>' + E(T("tabBlueprint")) + '</span><select><option>' + E(T("tabChapter")) + '</option><option>' + E(T("tabBlueprint")) + '</option></select></div>' +
        '<div class="facts"><div><span>' + E(T("pageMemory")) + '</span><b>Only in page memory</b></div></div>';
      return { compact: true, html: V.modalHead(T("newChapter")) + '<div class="modal-body">' + body + '</div>' +
        V.modalFoot(T("tipMemoryOnly"), NF.btn(T("cancel"), { action: "modal-close", cls: "sm" }) + NF.btn(T("createDemo"), { action: "create-chapter", cls: "sm primary" })) };
    }
    if (kind === "import-novel" || kind === "new-project" || kind === "open-project") {
      const title = kind === "import-novel" ? T("importNovel") : kind === "new-project" ? T("newProject") : T("openProject");
      const body = '<p>' + E(T("importNote")) + '</p><div class="modal-field"><span>' + E(T("projectName")) + '</span><input placeholder="' + E(T("projectName")) + '"></div>' +
        '<div class="facts"><div><span>Storage</span><b>SQLite + LanceDB · local</b></div><div><span>Network</span><b>Model requests only</b></div></div>';
      return { compact: true, html: V.modalHead(title) + '<div class="modal-body">' + body + '</div>' +
        V.modalFoot(T("demoOnly"), NF.btn(T("done"), { action: "modal-close", cls: "sm primary" })) };
    }
    if (kind === "versions") {
      const body = '<p>' + E(T("restoreBody")) + '</p><div class="facts"><div><span>' + E(T("initialVersion")) + '</span><b>read-only</b></div>' +
        '<div><span>' + E(T("backupRecover")) + '</span><b>' + (st.backup ? "available" : "none") + '</b></div></div>';
      return { compact: true, html: V.modalHead(T("versionTitle")) + '<div class="modal-body">' + body + '</div>' +
        V.modalFoot(T("tipMemoryOnly"), NF.btn(T("restore"), { action: "restore-confirm", cls: "sm" }) + NF.btn(T("done"), { action: "modal-close", cls: "sm primary" })) };
    }
    if (kind === "restore") {
      return { compact: true, html: V.modalHead(T("restoreTitle")) + '<div class="modal-body"><p>' + E(T("restoreBody")) + '</p></div>' +
        V.modalFoot(T("tipMemoryOnly"), NF.btn(T("cancel"), { action: "modal-close", cls: "sm" }) + NF.btn(T("restore"), { action: "restore-apply", cls: "sm primary" })) };
    }
    if (kind === "rewrite") {
      const body = '<div class="diff-grid"><div class="diff-col"><h3>' + E(T("original") || "原文") + '</h3><p>' + E(D.prose[2]) + '</p></div>' +
        '<div class="diff-col"><h3>' + E(T("replacement") || "建议改写") + '</h3><p>' + E("守塔人把灯罩往下压了压，没有回头，只说：「它比昨天晚了三分钟。」") + '</p></div></div>' +
        '<p style="margin-top:12px">' + E(T("rewriteGuard")) + '</p>';
      return { compact: false, html: V.modalHead(T("rewrite")) + '<div class="modal-body">' + body + '</div>' +
        V.modalFoot(T("demoOnly"), NF.btn(T("cancel"), { action: "modal-close", cls: "sm" }) + NF.btn(T("applyRewrite"), { action: "apply-rewrite", cls: "sm primary" })) };
    }
    if (kind === "references") {
      const body = '<div class="facts"><div><span>' + E(T("references")) + '</span><b>3</b></div><div><span>' + E(T("contextBudget")) + '</span><b>46%</b></div></div>' +
        '<p>' + E(T("referencesBody")) + '</p><p>' + E(T("contextNote")) + '</p>';
      return { compact: true, html: V.modalHead(T("references")) + '<div class="modal-body">' + body + '</div>' + V.modalFoot(T("pageMemory"), NF.btn(T("done"), { action: "modal-close", cls: "sm primary" })) };
    }
    if (kind === "cost-reset") {
      return { compact: true, html: V.modalHead(T("resetCost")) + '<div class="modal-body"><p>' + E(T("resetCostBody")) + '</p></div>' +
        V.modalFoot(T("demoOnly"), NF.btn(T("cancel"), { action: "modal-close", cls: "sm" }) + NF.btn(T("confirm"), { action: "cost-reset-apply", cls: "sm primary" })) };
    }
    if (kind === "shortcuts") {
      const rows = [["Ctrl+K", T("cmdPlaceholder")], ["F11", T("focus")], ["Ctrl+,", T("settingsTitle")], ["Ctrl+Z / Ctrl+Y", T("undo") + " / " + T("redo")], ["Ctrl+S", T("save")], ["Esc", T("close")]].map(function (r) {
        return '<div class="setting-line"><span>' + E(r[1]) + '</span><span class="value">' + E(r[0]) + '</span></div>';
      }).join('');
      return { compact: true, html: V.modalHead(T("shortcutHelp")) + '<div class="modal-body"><div class="settings-block">' + rows + '</div></div>' +
        V.modalFoot(T("pageMemory"), NF.btn(T("done"), { action: "modal-close", cls: "sm primary" })) };
    }
    if (kind === "dev-console") {
      const body = '<p>' + E(T("devTabs")) + '</p><div class="facts"><div><span>IPC</span><b>whitelisted channels</b></div><div><span>Agent</span><b>running: 1</b></div><div><span>DB</span><b>read-only</b></div></div>' +
        '<div class="settings-block"><h4>' + E(T("devConsole")) + '</h4>' + [T("contextBudget"), T("sessionCost"), T("navLog"), T("activityTitle")].map(function (x) {
          return '<div class="setting-line"><span>' + E(x) + '</span><span class="value">demo</span></div>';
        }).join('') + '</div>';
      return { compact: true, html: V.modalHead(T("devConsole")) + '<div class="modal-body">' + body + '</div>' + V.modalFoot(T("pageMemory"), NF.btn(T("done"), { action: "modal-close", cls: "sm primary" })) };
    }
    if (kind === "settings-dirty") {
      return { compact: true, html: V.modalHead(T("settingsTitle")) + '<div class="modal-body"><p>' + E(T("settingsDirty")) + '</p></div>' +
        V.modalFoot(T("tipMemoryOnly"), NF.btn(T("cancel"), { action: "modal-close", cls: "sm" }) + NF.btn(T("confirm"), { action: "settings-force-close", cls: "sm primary" })) };
    }
    /* generic info / demo action */
    return { compact: true, html: V.modalHead(X(d.title || T("appName"))) + '<div class="modal-body"><p>' + E(X(d.body || T("demoOnly"))) + '</p></div>' +
      V.modalFoot(T("demoOnly"), NF.btn(T("done"), { action: "modal-close", cls: "sm primary" })) };
  };

})(window.NF);
