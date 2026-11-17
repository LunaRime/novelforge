"use strict";
/* NovelForge UI Redesign v3 — synthesis view layer.
   Loaded after views.js: it keeps v2's complete workbench and overrides the
   surfaces that must carry v1's reading experience / editorial loop. */
(function (NF) {
  const V = NF.views;
  const base = {};
  Object.keys(V).forEach(function (k) { base[k] = V[k]; });
  const T = function (k) { return NF.t(k); };
  const X = function (v) { return NF.tx(v); };
  const I = function (n, c) { return NF.icon(n, c); };
  const E = function (v) { return NF.esc(v); };
  const S = function () { return NF.state; };
  const D = NF.D;

  /* ------------------------------------------------------------ review stage */
  V.stage = function () {
    const st = S();
    const langNames = ["中文", "English", "Русский"];
    const controls =
      '<select data-action="locale" aria-label="' + E(T("btnLanguage")) + '" title="' + E(T("btnLanguage")) + '">' +
      langNames.map(function (n, i) { return '<option value="' + i + '"' + (st.locale === i ? ' selected' : '') + '>' + E(n) + '</option>'; }).join('') + '</select>' +
      '<div class="segment">' +
      NF.V3.workModes.map(function (m) {
        return '<button data-action="work-mode" data-value="' + m.id + '"' + (st.workMode === m.id ? ' class="active"' : '') + '>' +
          I(m.icon, "sm") + ' ' + E(X(m.name)) + '</button>';
      }).join('') + '</div>' +
      NF.btn(T("btnAppearance"), { action: "appearance-open", icon: "palette", cls: "stage-button" }) +
      NF.btn(T("btnFeatures"), { action: "feature-map-jump", icon: "grid", cls: "stage-button" }) +
      NF.btn(st.maximized ? T("btnRestore") : T("btnMaximize"), { action: "maximize", icon: st.maximized ? "restore" : "maximize", cls: "stage-button" + (st.maximized ? " active" : "") });

    const brief = [
      ["v3Brief1Title", "v3Brief1Body", "01"], ["v3Brief2Title", "v3Brief2Body", "02"], ["v3Brief3Title", "v3Brief3Body", "03"]
    ].map(function (b) {
      return '<div class="brief-item"><span class="mono">' + b[2] + ' / EDITORIAL WORKBENCH</span><strong>' + E(T(b[0])) + '</strong><p>' + E(T(b[1])) + '</p></div>';
    }).join('');

    /* Static review copy, not user input: <b> emphasis is intentional. */
    const comparison =
      '<div class="comparison-row head">' +
      ['colDimension', 'colV1', 'colV2', 'colV3'].map(function (k, i) {
        return '<div class="comparison-cell' + (i === 3 ? ' v3' : '') + '">' + E(T(k)) + '</div>';
      }).join('') + '</div>' +
      NF.V3.comparison.map(function (row) {
        return '<div class="comparison-row">' + row.map(function (cell, i) {
          const cls = i === 0 ? 'comparison-cell dim' : 'comparison-cell' + (i === 3 ? ' v3' : '');
          return '<div class="' + cls + '">' + (i === 0 ? E(X(cell)) : X(cell)) + '</div>';
        }).join('') + '</div>';
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
      return '<div class="feature-card"><h3>' + E(X(g.title)) + '<small>' + g.items.length + '</small></h3><ul>' + items + '</ul></div>';
    }).join('');
    const backend = D.backendList.map(function (b) { return '<span class="chip">' + E(X(b)) + '</span>'; }).join('');

    return {
      kicker: E(T("v3Kicker")), title: E(T("v3Title")), subtitle: E(T("v3Subtitle")),
      controls: controls, briefTitle: E(T("v3BriefTitle")), brief: brief,
      comparisonKicker: E(T("comparisonKicker")), comparisonTitle: E(T("comparisonTitle")),
      comparisonDesc: E(T("comparisonDesc")), comparison: comparison,
      mapKicker: E(T("mapKicker")),
      mapTitle: E(X(["真实功能 → v3 落点", "Real features → where they live in v3", "Реальные функции → где они в v3"])),
      mapDesc: E(T("mapDesc")), legend: legend, cards: cards,
      backendTitle: E(T("backendTitle")), backendDesc: E(T("backendDesc")), backendChips: backend,
      footer: '<span>' + E(T("footerNote")) + '</span><code>' + E(T("footerFiles")) + ' · ' + E(T("v3Status")) + '</code>'
    };
  };

  /* ---------------------------------------------------------- window chrome */
  V.titlebar = function () {
    const st = S();
    return '<div class="window-app-title">' + I("layers", "brand-glyph") +
      '<strong>' + E(T("appName")) + '</strong><span class="window-title-sep">/</span>' +
      '<span class="window-title-note">Editorial Workbench v3 · ' + E(T("projectName")) + ' · ' + E(T("windowHint")) + '</span></div>' +
      '<div class="window-controls">' +
      '<button class="window-control' + (st.paper === "light" ? ' is-active' : '') + '" data-action="paper-toggle" title="' + E(T("paperLabel")) + '" aria-label="' + E(T("paperLabel")) + '">' + I("book") + '</button>' +
      '<button class="window-control' + (st.appearanceOpen ? ' is-active' : '') + '" data-action="appearance-open" title="' + E(T("btnAppearance")) + '" aria-label="' + E(T("btnAppearance")) + '">' + I("palette") + '</button>' +
      '<span class="titlebar-sep"></span>' +
      '<button class="window-control" data-action="minimize" title="' + E(T("close")) + '" aria-label="' + E(T("close")) + '">' + I("minimize") + '</button>' +
      '<button class="window-control' + (st.maximized ? ' is-active' : '') + '" data-action="maximize" title="' + E(st.maximized ? T("btnRestore") : T("btnMaximize")) + '" aria-label="' + E(T("btnMaximize")) + '">' + I(st.maximized ? "restore" : "maximize") + '</button>' +
      '<button class="window-control close-control" data-action="minimize" title="' + E(T("close")) + '" aria-label="' + E(T("close")) + '">' + I("close") + '</button>' +
      '</div>';
  };

  /* --------------------------------------------------------------- title bar */
  V.titleStrip = function () {
    const st = S();
    const langShort = ["中文", "EN", "RU"][st.locale];
    const modes = NF.V3.workModes.map(function (m) {
      return '<button class="' + (st.workMode === m.id ? 'active' : '') + '" data-action="work-mode" data-value="' + m.id + '" title="' + E(T(m.id === "forge" ? "workModeForgeHint" : "workModeComposeHint")) + '">' +
        I(m.icon, "sm") + '<span>' + E(X(m.name)) + '</span></button>';
    }).join('');
    return '<div class="brand-lockup">' + I("layers", "brand-glyph") + '<span>' + E(T("appName")) + '</span></div>' +
      '<span class="title-sep"></span>' +
      '<div class="project-crumb"><span>' + E(T("projectName")) + '</span><span class="muted">·</span><span class="truncate">' + E(T("projectTag")) + '</span></div>' +
      '<span class="title-sep"></span>' +
      '<div class="mode-switch" role="group" aria-label="' + E(T("workModeLabel")) + '">' + modes + '</div>' +
      '<button class="cmd-trigger" data-action="command-open">' + I("search") + '<span>' + E(T("cmdPlaceholder")) + '</span><kbd>Ctrl K</kbd></button>' +
      '<div class="spacer"></div><div class="top-actions">' +
      NF.ib("book", "paper-toggle", "paperLabel", st.paper === "light" ? "active" : "") +
      NF.ib("context", "toggle-context", "hideContext", st.contextCollapsed ? "" : "active") +
      NF.ib("sidebar", "toggle-assistant", "hideAssistant", st.assistantCollapsed ? "" : "active") +
      NF.ib("focus", "focus", "focus", st.focus ? "active" : "") +
      NF.btn(langShort, { action: "locale-cycle", icon: "language", cls: "ghost sm", title: T("languageMenu") }) +
      NF.ib("theme", "theme-cycle", "themeMenu") +
      NF.ib("settings", "settings-open", "settingsTitle") + '</div>';
  };

  /* --------------------------------------------------------------- document */
  V.document = function (tab) {
    const st = S();
    const finalized = (st.finalized || []).indexOf(tab.chapter) !== -1;
    /* Strip the render-only marker before re-marking, so capturing the editor
       never nests markers or keeps one after a decision. */
    let body = (st.draft[tab.chapter] || base.proseHTML())
      .replace(/<span class="note-anchor">([\s\S]*?)<\/span>/g, "$1");
    const p0 = NF.V3.proposals[0];
    if (!st.decisions || !st.decisions[0]) {
      if (body.indexOf(p0.old) !== -1) body = body.replace(p0.old, '<span class="note-anchor">' + E(p0.old) + '</span>');
    }
    const words = base.plainWords(body);
    const title = base.chapterTitle(tab.chapter);
    const dirty = !!(st.dirty && st.dirty[tab.chapter]);
    const confirmed = !!(st.confirmed && st.confirmed[tab.chapter]);
    const hint = T(st.workMode === "compose" ? "workModeComposeHint" : "workModeForgeHint");

    const toolbar = '<div class="mode-hint">' + I(st.workMode === "compose" ? "edit" : "layers") + '<span>' + E(hint) + '</span></div>' +
      '<div class="document-toolbar"><div class="doc-tools">' +
      NF.ib("undo", "undo", "undo", "small") + NF.ib("redo", "redo", "redo", "small") +
      '<span class="title-sep"></span>' +
      NF.btn(T("draftTools"), { action: "revise", icon: "wand", cls: "sm" }) +
      NF.btn(T("tabReview"), { action: "tab", value: "review", cls: "sm", icon: "checkCircle" }) +
      NF.btn(T("rewrite"), { action: "rewrite-open", icon: "edit", cls: "sm" }) +
      NF.btn(T("versionTitle"), { action: "tab", value: "versions", cls: "sm", icon: "history" }) +
      '</div><div class="spacer"></div><div class="doc-meta">' +
      '<span class="mono">' + words + ' ' + E(T("wordsUnit")) + '</span>' +
      (finalized ? NF.badge(T("readonlyNote"), "info") : NF.badge(dirty ? T("unsaved") : confirmed ? T("saved") : T("prototypeReady"), dirty ? "warning" : confirmed ? "success" : "")) +
      NF.btn(T("confirmEdits"), { action: "save", icon: "confirm", cls: "sm primary", disabled: !dirty, title: dirty ? "" : T("confirmHint") }) +
      NF.ib("focus", "focus", "focus", "small") + '</div></div>';

    const sheet = '<div class="document-scroll" id="document-scroll"><div class="sheet">' +
      '<div class="sheet-head"><div><div class="chapter-no">CHAPTER ' + String(tab.chapter).padStart(2, "0") + ' / ' + (finalized ? 'FINAL' : 'DRAFT') + '</div>' +
      '<h2>' + E(title) + '</h2><div class="sheet-tags"><span class="paper-chip">' + E(T("projectName")) + '</span>' +
      '<span class="paper-chip">' + E(T("docStatus").replace("{n}", tab.chapter)) + '</span></div></div>' +
      '<div class="col" style="align-items:flex-end;gap:4px"><span class="paper-chip mono">' + words + ' ' + E(T("wordsUnit")) + '</span>' +
      '<span class="paper-chip">' + E(T("pageMemory")) + '</span></div></div>' +
      '<div class="sheet-body" id="sheet-body" contenteditable="' + (finalized ? 'false' : 'true') + '" spellcheck="false" aria-readonly="' + finalized + '" aria-label="' + E(T("tabChapter")) + '">' + body + '</div>' +
      '<div class="sheet-foot"><span>' + E(T("captureNote")) + '</span>' +
      '<div class="sheet-foot-right"><span class="mono" id="live-words">' + words + ' ' + E(T("wordsUnit")) + '</span>' +
      '<span>' + E(T("tipMemoryOnly")) + '</span></div></div></div></div>';
    return toolbar + sheet;
  };

  /* ------------------------------------------------------------ views / tabs */
  V.view = function (type) {
    const st = S();
    const head = function (title, desc, actions) {
      return '<div class="view-head"><div><h2>' + E(X(title)) + '</h2><p>' + E(X(desc)) + '</p></div><div class="row">' + (actions || '') + '</div></div>';
    };
    const wrap = function (content) { return '<div class="view scroll">' + content + '</div>'; };

    if (type === "overview") {
      const words = base.plainWords(st.draft[st.chapter] || base.proseHTML());
      const goals = '<div class="goal-card"><div class="row"><span>' + E(T("goalTitle")) + '</span>' + I("edit", "sm") + '</div>' +
        '<strong>' + words + ' <span class="muted" style="font-size:11px">/ 2,000 ' + E(T("wordsUnit")) + '</span></strong>' +
        '<div class="progress"><span style="width:' + Math.min(100, Math.round(words / 20)) + '%"></span></div></div>';
      const next = [["next1", "next1Desc"], ["next2", "next2Desc"], ["next3", "next3Desc"]].map(function (n) {
        return '<div class="next-entry"><span class="axis"></span><div><strong>' + E(T(n[0])) + '</strong><p>' + E(T(n[1])) + '</p></div></div>';
      }).join('');
      const recent = [7, 6, 5].map(function (n) {
        return '<div class="list-row"><span class="grow"><strong>' + E(base.chapterTitle(n)) + '</strong></span>' +
          NF.badge(T("chapterShort").replace("{n}", n)) + NF.btn(T("openManuscript"), { action: "chapter", value: n, cls: "sm" }) + '</div>';
      }).join('');
      return wrap(head(T("tabOverview"), T("overviewDesc")) +
        '<div class="overview-hero"><div><div class="kicker">' + E(T("novelTag")) + '</div><h2>' + E(T("projectName")) + '</h2>' +
        '<p>' + E(T("novelSynopsis")) + '</p>' + NF.btn(T("continueWriting"), { action: "chapter", value: 7, cls: "primary", icon: "arrow" }) + '</div>' +
        '<div class="book-art"><div class="book-cover"><span class="kicker">NOVELFORGE / 01</span><h3>雾港<br>来信</h3><div class="cover-lines"></div><span class="kicker">A STORY BY LUNA</span></div></div></div>' +
        '<div class="stat-grid">' + base.stat(T("totalWords"), "42,860") + base.stat(T("finalized"), "4") + base.stat(T("modelCalls"), "1,284") + base.stat(T("cost"), "¥38.60") + '</div>' +
        '<div class="panel" style="display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:24px">' +
        '<div><h3>' + E(T("nextTitle")) + '</h3><div class="next-list">' + next + '</div><h3 style="margin-top:20px">' + E(T("recentTitle")) + '</h3><div class="list-rows" style="margin-top:8px">' + recent + '</div></div>' +
        '<div>' + goals + '<div class="context-callout" style="margin-top:12px">' + E(T("partnerNote")) + '</div></div></div>');
    }

    if (type === "review") {
      const pending = (st.decisions || []).filter(function (d) { return !d; }).length;
      const cards = NF.V3.proposals.map(function (p, i) {
        const decision = st.decisions ? st.decisions[i] : null;
        return '<div class="proposal-card' + (decision === 'accept' ? ' decided-accept' : decision === 'reject' ? ' decided-reject' : '') + '">' +
          '<div class="proposal-head"><strong>' + E(X(p.title)) + '</strong>' +
          (decision === 'accept' ? NF.badge(T("proposalAccepted"), "success") : decision === 'reject' ? NF.badge(T("proposalRejected"), "info") : NF.badge(T("proposalPending"), "warning")) + '</div>' +
          '<p class="proposal-note">' + E(T(p.body[0])) + '</p>' +
          '<div class="proposal-body">' +
          (decision === 'accept' ? '<span class="diff-new">' + E(p.next) + '</span>' : decision === 'reject' ? '<span>' + E(p.old) + '</span>' :
            '<span class="diff-old">' + E(p.old) + '</span><span class="diff-new">' + E(p.next) + '</span>') + '</div>' +
          '<div class="proposal-actions">' + (decision ? '' :
            NF.btn(T("proposalView"), { action: "proposal-view", value: i, cls: "sm", icon: "eye" }) +
            NF.btn(T("proposalAccept"), { action: "proposal-accept", value: i, cls: "sm primary", icon: "check" }) +
            NF.btn(T("proposalReject"), { action: "proposal-reject", value: i, cls: "sm" })) +
          '<span class="spacer"></span><span class="proposal-note">' + E(T("proposalGuard")) + '</span></div></div>';
      }).join('');
      const roles = D.reviewRoles.map(function (r) {
        return '<div class="review-role"><strong>' + E(X(r.name)) + '</strong><span class="score">' + r.score + '</span><p>' + E(X(r.note)) + '</p></div>';
      }).join('');
      return wrap(head(T("tabReview"), T("reviewSummaryBody"), NF.badge(T("proposalCount").replace("{n}", pending), pending ? "warning" : "success")) +
        '<div class="review-layout"><div>' + cards + (pending ? '' : '<div class="panel"><p class="muted">' + E(T("proposalAllDone")) + '</p></div>') + '</div>' +
        '<div><div class="panel"><h3>' + E(T("reviewSummary")) + '</h3><p class="muted">' + E(T("reviewSummaryBody")) + '</p></div>' +
        '<div class="panel" style="margin-top:12px"><h3>' + E(T("originalKept")) + '</h3><p class="muted">' + E(T("restoreBody")) + '</p>' +
        '<div class="row" style="margin-top:12px;flex-wrap:wrap">' + NF.btn(T("versionTitle"), { action: "tab", value: "versions", cls: "sm" }) +
        NF.btn(T("backupRecover"), { action: "recover-backup", cls: "sm" }) + '</div></div>' +
        '<div class="panel" style="margin-top:12px"><h3>' + E(T("editorBoardRoles")) + '</h3><div class="review-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">' + roles + '</div></div></div></div>');
    }

    if (type === "tokens") {
      const swatches = NF.V3.designSpec.map(function (spec) {
        return '<div class="swatch"><div class="swatch-color" style="background:var(' + spec[1] + ')"></div>' +
          '<div class="swatch-info"><strong>' + E(X(spec[0])) + '</strong><code>' + E(spec[1]) + '</code></div></div>';
      }).join('');
      const scale = [1, 2, 3, 4, 5, 6, 8, 10].map(function (n) {
        return '<div class="scale-item"><i style="width:' + (n * 4) + 'px;height:' + (n * 4) + 'px"></i><span>' + (n * 4) + '</span></div>';
      }).join('');
      return wrap(head(T("designTitle"), T("designDesc"),
        '<a class="btn sm" href="./tokens.css" target="_blank" rel="noopener">tokens.css</a>' +
        '<a class="btn sm" href="./tokens.json" target="_blank" rel="noopener">tokens.json</a>') +
        '<div class="v3-section"><h3>' + E(T("designColors")) + '</h3><div class="swatch-grid">' + swatches + '</div>' +
        '<p class="token-note">' + E(T("designColorNote")) + '</p></div>' +
        '<div class="v3-section"><h3>' + E(T("designType")) + '</h3><div class="specimen-grid">' +
        '<div class="type-specimen"><span class="kicker">' + E(T("designTypeUI")) + '</span><div class="display">A quieter place to write.</div><p>' + E(T("designTypeNote")) + '</p></div>' +
        '<div class="type-specimen writing"><span class="kicker">' + E(T("designTypeWriting")) + '</span><div class="display">雾是在凌晨四点漫上来的。</div><p>' + E(T("designTypeNote")) + '</p></div></div></div>' +
        '<div class="v3-section"><h3>' + E(T("designScale")) + '</h3><div class="token-scale">' + scale + '</div><p class="token-note">' + E(T("designScaleNote")) + '</p></div>' +
        '<div class="v3-section"><h3>' + E(T("designStates")) + '</h3>' +
        '<div class="row" style="flex-wrap:wrap;gap:8px">' + NF.badge(T("saved"), "success") + NF.badge(T("unsaved"), "warning") +
        NF.badge(T("awaiting"), "warning") + NF.badge(T("running"), "brand") + NF.badge(T("completed"), "success") + NF.badge(T("cancelled"), "info") + '</div>' +
        '<p class="token-note">' + E(T("designStateNote")) + '</p></div>');
    }
    return base.view(type);
  };

  /* ------------------------------------------------------------- AI column */
  V.assistant = function () {
    const st = S();
    if (st.workMode !== "compose") return base.assistant();
    const tab = st.partnerTab || "suggestions";
    const head = '<div class="ai-head"><strong>' + E(T("partner")) + '</strong>' +
      NF.ib("close", "toggle-assistant", "hideAssistant", "small") + '</div>' +
      '<div class="ai-tabs">' +
      '<button class="ai-tab' + (tab === "suggestions" ? ' active' : '') + '" data-action="partner-tab" data-value="suggestions">' + E(T("partnerSuggestions")) + '</button>' +
      '<button class="ai-tab' + (tab === "context" ? ' active' : '') + '" data-action="partner-tab" data-value="context">' + E(T("partnerContext")) + '</button></div>';
    let thread = '<div class="partner-intro"><h3>' + E(T("partnerTitle")).replace(/\n/g, '<br>') + '</h3><p>' + E(T("partnerIntro")) + '</p></div>';
    if (tab === "context") {
      thread += '<div class="partner-note"><strong>' + E(T("partnerRefs")) + '</strong><p>' + E(T("partnerRefsBody")) + '</p></div>' +
        ['林澈 / 沈雁', '雾港时间规则', '第 07 章蓝图'].map(function (name) {
          return '<button class="context-item" data-action="references-open">' + I("link", "sm") + '<span>' + E(name) + '</span></button>';
        }).join('') + '<div class="partner-note"><p>' + E(T("partnerNote")) + '</p></div>';
    } else {
      NF.V3.proposals.forEach(function (p, i) {
        if (st.decisions && st.decisions[i]) return;
        thread += '<div class="partner-note"><strong>' + E(X(p.title)) + '</strong><p>' + E(T(p.body[0])) + '</p>' +
          '<blockquote>' + E(p.old) + '</blockquote><div class="row">' +
          NF.btn(T("proposalView"), { action: "proposal-view", value: i, cls: "sm primary" }) +
          NF.btn(T("proposalReject"), { action: "proposal-reject", value: i, cls: "sm" }) + '</div></div>';
      });
      if (!st.decisions || st.decisions.every(function (d) { return !!d; })) {
        thread += '<div class="partner-note"><p>' + E(T("partnerNoNotes")) + '</p></div>';
      }
      (st.partnerChat || []).forEach(function (m) {
        thread += '<div class="msg ' + (m.role === 'user' ? 'msg-user' : 'msg-ai') + '">' + E(m.text) + '</div>';
      });
      thread += '<div class="context-ring"><div class="ring"><b>46%</b></div><div class="col"><strong>' + E(T("contextBudget")) + '</strong><span>' + E(T("contextBreakdown")) + '</span></div></div>';
    }
    const compose = '<div class="ai-compose"><div class="compose-box"><textarea id="ai-input" placeholder="' + E(T("partnerAsk")) + '" aria-label="' + E(T("partnerSend")) + '"></textarea>' +
      '<div class="compose-tools"><span class="chip">@ ' + E(T("partnerContext")) + '</span><span class="spacer"></span>' +
      NF.btn(T("partnerSend"), { action: "partner-send", icon: "arrow", cls: "sm primary" }) + '</div></div>' +
      '<div class="compose-hint">' + E(T("partnerDemo")) + ' · ' + E(T("tipMemoryOnly")) + '</div></div>';
    return head + '<div class="ai-thread scroll">' + thread + '</div>' + compose;
  };

  /* -------------------------------------------------------------- status bar */
  V.statusbar = function () {
    const st = S();
    if (st.workMode !== "compose") return base.statusbar();
    const words = base.plainWords(st.draft[st.chapter] || base.proseHTML());
    return '<div class="status-left"><button class="status-btn" data-action="info-about"><strong>' + E(T("appName")) + '</strong> <span class="mono">v3</span></button>' +
      '<span class="status-sep"></span><button class="status-btn" data-action="tab" data-value="chapter">' + I("file", "sm") +
      '<span>' + E(T("chapterShort").replace("{n}", st.chapter)) + ' · ' + words + ' ' + E(T("wordsUnit")) + '</span>' +
      '<i class="dot ' + (st.dirty && st.dirty[st.chapter] ? 'warning' : 'success') + '"></i></button>' +
      '<span class="status-sep"></span><span class="status-btn">' + E(T("workModeCompose")) + ' · ' + E(T("pageMemory")) + '</span></div>' +
      '<div class="status-right"><button class="status-btn" data-action="paper-toggle">' + I("book", "sm") + '<span>' + E(T("paperLabel")) + '</span></button>' +
      NF.ib("settings", "settings-open", "settingsTitle", "small") +
      '<div class="zoom-group">' + NF.ib("minus", "zoom", "zoom", "small", "-") +
      '<button class="status-btn mono" data-action="zoom" data-value="reset">' + (st.zoom || 100) + '%</button>' +
      NF.ib("plus", "zoom", "zoom", "small", "+") + '</div></div>';
  };

  /* -------------------------------------------------------------- appearance */
  V.appearance = function () {
    const st = S();
    const section = function (title, content) { return '<div class="appearance-section"><h3>' + E(title) + '</h3>' + content + '</div>'; };
    const modeSeg = NF.segment(D.modes, st.mode, "set-mode");
    const paletteOptions = '<div class="palette-options">' + D.palettes.map(function (p) {
      return '<button class="palette-option' + (st.palette === p.id ? ' active' : '') + '" data-action="set-palette" data-value="' + p.id + '">' +
        '<i class="palette-dot ' + p.id + '"></i><span>' + E(X(p.name)) + '</span></button>';
    }).join('') + '</div>';
    const workSeg = NF.segment(NF.V3.workModes.map(function (m) { return { id: m.id, name: m.name }; }), st.workMode, "set-workmode");
    const paperSeg = NF.segment([{ id: "auto", name: ["跟随模式", "Follow mode", "За режимом"] }, { id: "light", name: ["恒亮暖纸", "Always light", "Всегда светлый"] }], st.paper, "set-paper");
    const densitySeg = NF.segment(D.densities, st.density, "set-density");
    const sizeSeg = NF.segment([{ id: "17", name: ["17px", "17px", "17px"] }, { id: "18", name: ["18px", "18px", "18px"] }], st.writingSize, "set-writing-size");
    const bgOptions = '<div class="background-options">' +
      [["plain", "bgPlain", ""], ["grid", "bgGrid", "grid"], ["mist", "bgMist", "mist"]].map(function (b) {
        return '<button class="background-option' + (st.bg === b[0] ? ' active' : '') + '" data-action="set-bg" data-value="' + b[0] + '">' +
          '<i class="background-sample ' + b[2] + '"></i><span>' + E(T(b[1])) + '</span></button>';
      }).join('') + '</div>';
    const upload = '<label class="upload-area">' + I("upload") + '<span>' + E(T("bgUpload")) + '</span>' +
      '<input type="file" accept="image/*" data-action="bg-upload"><small>' + E(T("bgUploadHint")) + '</small></label>' +
      (st.bgImageName ? '<div class="image-current"><img src="' + E(st.bgImageData) + '" alt=""><span>' + E(st.bgImageName) + '</span>' +
        NF.ib("close", "bg-remove", "bgRemove", "small") + '</div>' : '');
    const slider = function (label, action, value, max, unit) {
      return '<div class="range-control"><div class="row"><span>' + E(T(label)) + '</span><output>' + E(value + unit) + '</output></div>' +
        '<input type="range" data-action="' + action + '" min="0" max="' + max + '" step="1" value="' + value + '"></div>';
    };
    return '<div class="appearance-head"><h2 id="appearance-title">' + E(T("appearanceTitle")) + '</h2>' +
      NF.ib("close", "appearance-close", "close", "small") + '</div><div class="appearance-body scroll">' +
      section(T("modeLabel"), modeSeg) +
      section(T("paletteLabel"), paletteOptions) +
      section(T("workModeLabel"), workSeg) +
      section(T("paperLabel"), paperSeg + '<div class="appearance-description muted" style="font-size:11px;line-height:1.7">' + E(T("paperHint")) + '</div>') +
      section(T("densityLabel"), densitySeg) +
      section(T("writingSizeLabel"), sizeSeg) +
      section(T("backgroundLabel"), bgOptions + upload +
        slider("bgStrength", "bg-strength", Math.round(st.bgStrength * 100), 100, "%") +
        slider("bgVeil", "bg-veil", st.bgVeil, 80, "%") +
        slider("bgBlur", "bg-blur", st.bgBlur, 12, "px")) +
      '<div class="appearance-description muted" style="font-size:11px;line-height:1.7">' + E(T("appearanceNote")) + '</div>' +
      '</div><div class="appearance-foot">' + NF.btn(T("resetAppearance"), { action: "appearance-reset", cls: "sm" }) +
      NF.btn(T("done"), { action: "appearance-close", cls: "sm primary" }) + '</div>';
  };

  /* ------------------------------------------------------------------ modals */
  V.modal = function (kind, data) {
    const d = data || {};
    if (kind === "rewrite") {
      const index = Number(d.index || 0);
      const p = NF.V3.proposals[index] || NF.V3.proposals[0];
      return { compact: false, html: base.modalHead(T("proposalRewriteTitle")) +
        '<div class="modal-body"><div class="diff-grid"><div class="diff-col"><h3>' + E(T("proposalOriginal")) + '</h3><p>' + E(p.old) + '</p></div>' +
        '<div class="diff-col"><h3>' + E(T("proposalReplacement")) + '</h3><p>' + E(p.next) + '</p></div></div>' +
        '<p style="margin-top:12px">' + E(T("proposalGuard")) + '</p></div>' +
        base.modalFoot(T("demoOnly"), NF.btn(T("cancel"), { action: "modal-close", cls: "sm" }) +
          NF.btn(T("proposalRewriteApply"), { action: "proposal-apply", value: index, cls: "sm primary" })) };
    }
    return base.modal(kind, data);
  };

})(window.NF);
