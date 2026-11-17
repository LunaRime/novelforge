"use strict";
/* NovelForge UI Redesign v3 — DOM scrollbar engine.
   Native bars are hidden by custom-scroll.css. This module draws, positions
   and drives an ordinary element for every scroll container, so the browser
   supplies scrolling behaviour but none of the scrollbar chrome. */
(function (NF) {
  const SELECTOR = [
    ".scroll", ".document-scroll", ".view", ".modal-body", ".settings-pane",
    ".settings-nav", ".appearance-body", ".command-results", ".context-body",
    ".ai-thread", ".runtime-body", ".set-nav", ".set-pane", ".lp-rows"
  ].join(",");
  const WIDTH = 10;
  const entries = new Map();
  let seq = 0;
  let host = null;
  let observer = null;
  let resizeObserver = null;
  let sentinel = null;
  let pending = false;
  let mutating = false;

  function setStyle(el, prop, value) {
    if (el && el.style && el.style[prop] !== value) el.style[prop] = value;
  }
  function rectKeyOf(cr, c) {
    return [Math.round(cr.left), Math.round(cr.top), Math.round(cr.right), Math.round(cr.bottom),
      Math.round(c.scrollHeight || 0), Math.round(c.clientHeight || 0)].join("|");
  }

  function toneFor(container) {
    if (container.closest && container.closest(".set-nav, .set-pane, .appearance-body, .command-results")) return "brand";
    if (container.classList && container.classList.contains("document-scroll")) return "accent";
    if (container.closest && container.closest(".runtime")) return "info";
    if (container.classList && container.classList.contains("ai-thread")) return "success";
    return "brand";
  }

  function layerFor(container) {
    if (container.closest) {
      const dialog = container.closest("dialog");
      if (dialog) return dialog;
    }
    return host;
  }

  function create() {
    const bar = document.createElement("div");
    bar.className = "nf-scrollbar";
    bar.tabIndex = 0;
    bar.setAttribute("role", "scrollbar");
    bar.setAttribute("aria-orientation", "vertical");
    bar.setAttribute("aria-label", "Scroll");
    bar.innerHTML = '<div class="nf-scrollbar-track"><div class="nf-scrollbar-thumb"></div></div>' +
      '<span class="nf-scrollbar-value">0%</span>';
    return bar;
  }

  function register(container) {
    if (!container || !container.dataset || container.dataset.csbId) return;
    const layer = layerFor(container);
    if (!layer || !layer.appendChild) return;
    const id = "csb-" + (++seq);
    container.dataset.csbId = id;
    const bar = create();
    bar.dataset.for = id;
    bar.dataset.tone = toneFor(container);
    mutating = true;
    try { layer.appendChild(bar); } catch (err) { mutating = false; return; }
    mutating = false;
    const entry = {
      id: id, container: container, bar: bar, layer: layer,
      track: bar.querySelector(".nf-scrollbar-track"),
      thumb: bar.querySelector(".nf-scrollbar-thumb"),
      value: bar.querySelector(".nf-scrollbar-value"),
      height: 0, thumbHeight: 26, scrollTimer: null, rectKey: "", ro: null
    };
    entries.set(id, entry);
    bind(entry);
    layout(entry);
    sync(entry);
    /* Each scroller gets its own observer: panel resize, content growth,
       font loading or a collapsed sibling all change its geometry. */
    if (typeof window.ResizeObserver === "function") {
      try {
        entry.ro = new window.ResizeObserver(function () { layout(entry); sync(entry); });
        if (entry.ro.observe) entry.ro.observe(container);
      } catch (err) { entry.ro = null; }
    }
  }

  function layout(entry) {
    const c = entry.container, bar = entry.bar;
    const cr = c.getBoundingClientRect ? c.getBoundingClientRect() : null;
    const lr = entry.layer.getBoundingClientRect ? entry.layer.getBoundingClientRect() : null;
    if (!cr || !lr) return;
    const overflow = (c.scrollHeight || 0) - (c.clientHeight || 0);
    entry.rectKey = rectKeyOf(cr, c);
    /* Too short or too narrow: no bar at all, instead of a broken overlay. */
    if (overflow <= 1 || cr.height < 24 || cr.width < 40) {
      bar.hidden = true; entry.height = 0; return;
    }
    bar.hidden = false;
    entry.height = cr.height;
    const layerWidth = lr.width || 0;
    const left = Math.max(0, Math.min(layerWidth - WIDTH, cr.right - lr.left - WIDTH - 2));
    setStyle(bar, "left", left + "px");
    setStyle(bar, "top", (cr.top - lr.top) + "px");
    setStyle(bar, "height", cr.height + "px");
    const ratio = Math.max(0.12, Math.min(1, (c.clientHeight || 0) / (c.scrollHeight || 1)));
    entry.thumbHeight = Math.min(
      Math.max(26, Math.round(cr.height * ratio)),
      Math.max(20, cr.height - 4)
    );
  }

  function sync(entry) {
    const c = entry.container, bar = entry.bar;
    if (bar.hidden || !entry.height) return;
    const max = Math.max(0, (c.scrollHeight || 0) - (c.clientHeight || 0));
    const travel = Math.max(1, entry.height - entry.thumbHeight);
    const top = Math.max(0, Math.min(travel, (c.scrollTop || 0) / (max || 1) * travel));
    entry.thumb.style.height = entry.thumbHeight + "px";
    entry.thumb.style.top = top + "px";
    const percent = max > 0 ? Math.round((c.scrollTop || 0) / max * 100) : 0;
    if (entry.value) {
      entry.value.textContent = percent + "%";
      entry.value.style.top = (top + entry.thumbHeight / 2) + "px";
    }
    bar.setAttribute("aria-valuenow", String(percent));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
  }

  function flash(entry) {
    entry.bar.classList.add("is-scrolling");
    clearTimeout(entry.scrollTimer);
    entry.scrollTimer = setTimeout(function () { entry.bar.classList.remove("is-scrolling"); }, 260);
  }

  function bind(entry) {
    const c = entry.container, bar = entry.bar, track = entry.track, thumb = entry.thumb;
    if (c.addEventListener) {
      c.addEventListener("scroll", function () { sync(entry); flash(entry); });
    }
    if (thumb && thumb.addEventListener) {
      thumb.addEventListener("pointerdown", function (e) {
        const max = Math.max(0, (c.scrollHeight || 0) - (c.clientHeight || 0));
        const travel = Math.max(1, entry.height - entry.thumbHeight);
        const startY = e.clientY, startScroll = c.scrollTop || 0;
        bar.classList.add("dragging");
        if (thumb.setPointerCapture && e.pointerId != null) {
          try { thumb.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        }
        const move = function (ev) {
          c.scrollTop = startScroll + (ev.clientY - startY) * (max / travel);
        };
        const up = function () {
          bar.classList.remove("dragging");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        e.preventDefault(); e.stopPropagation();
      });
    }
    if (track && track.addEventListener) {
      track.addEventListener("pointerdown", function (e) {
        if (e.target === thumb) return;
        const rect = track.getBoundingClientRect ? track.getBoundingClientRect() : null;
        if (!rect) return;
        const max = Math.max(0, (c.scrollHeight || 0) - (c.clientHeight || 0));
        const usable = Math.max(1, rect.height - entry.thumbHeight);
        const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top - entry.thumbHeight / 2) / usable));
        c.scrollTop = ratio * max;
        e.preventDefault();
      });
    }
    if (bar.addEventListener) {
      bar.addEventListener("keydown", function (e) {
        const step = 40;
        let delta = 0;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") delta = step;
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") delta = -step;
        if (e.key === "PageDown") delta = (c.clientHeight || 200) * 0.8;
        if (e.key === "PageUp") delta = -(c.clientHeight || 200) * 0.8;
        if (e.key === "Home") { c.scrollTop = 0; e.preventDefault(); return; }
        if (e.key === "End") { c.scrollTop = c.scrollHeight || 0; e.preventDefault(); return; }
        if (delta) { c.scrollTop = (c.scrollTop || 0) + delta; e.preventDefault(); }
      });
    }
  }

  /* ---------------------------------------------------------- wheel routing */
  /* Decorative overflow:hidden boxes used to be real scroll containers and
     swallowed the wheel (they are now overflow:clip). This is the safety net:
     the wheel always reaches the panel's own scroller, including from the
     dialog head/foot, the custom bar, toolbars and any nested ghost box. */
  function registeredFrom(node) {
    let cur = node;
    while (cur && cur.nodeType === 1) {
      const id = cur.dataset && cur.dataset.csbId;
      if (id && entries.has(id)) return entries.get(id);
      cur = cur.parentNode;
    }
    return null;
  }

  function ghostBetween(target, container) {
    let cur = target;
    while (cur && cur !== container && cur.nodeType === 1) {
      if (!(cur.dataset && cur.dataset.csbId) && window.getComputedStyle) {
        const cs = window.getComputedStyle(cur);
        const oy = cs && cs.overflowY;
        if (oy && oy !== "visible" && oy !== "clip") return true;
      }
      cur = cur.parentNode;
    }
    return false;
  }

  function largestScroller(accept) {
    let best = null, area = 0;
    entries.forEach(function (entry) {
      const c = entry.container;
      if (!c || !c.isConnected || entry.bar.hidden || !accept(c)) return;
      const a = (c.clientHeight || 0) * (c.clientWidth || 0);
      if (a > area) { area = a; best = entry; }
    });
    return best;
  }

  function onWheel(e) {
    if (e.defaultPrevented || e.ctrlKey) return; /* leave pinch zoom alone */
    const dy = e.deltaY || 0;
    if (!dy) return;
    const target = e.target;
    let entry = registeredFrom(target);
    const inside = !!entry;
    const ghost = inside ? ghostBetween(target, entry.container) : false;
    if (!entry) {
      const dlg = target && target.closest ? target.closest("dialog") : null;
      entry = dlg
        ? largestScroller(function (c) { return dlg.contains ? dlg.contains(c) : false; })
        : largestScroller(function (c) { return !(c.closest && c.closest("dialog")); });
    }
    if (!entry) return;
    const c = entry.container;
    const max = Math.max(0, (c.scrollHeight || 0) - (c.clientHeight || 0));
    if (max <= 1) return;
    /* No obstruction: let the browser scroll natively (keeps smooth/trackpad
       behaviour). Only take over when something would swallow the wheel. */
    if (inside && !ghost) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (c.clientHeight || 400) : 1;
    c.scrollTop = Math.max(0, Math.min(max, (c.scrollTop || 0) + dy * unit));
    if (e.preventDefault) e.preventDefault();
    sync(entry); flash(entry);
  }

  function refresh() {
    host = host || document.getElementById("window-content");
    if (!host) return;
    let nodes = [];
    try { nodes = Array.prototype.slice.call(document.querySelectorAll(SELECTOR)); } catch (err) { nodes = []; }
    nodes.forEach(register);
    entries.forEach(function (entry, id) {
      if (!entry.container || !entry.container.isConnected) {
        if (entry.ro && entry.ro.disconnect) entry.ro.disconnect();
        if (entry.bar && entry.bar.parentNode && entry.bar.parentNode.removeChild) {
          mutating = true;
          try { entry.bar.parentNode.removeChild(entry.bar); } catch (err) { /* ignore */ }
          mutating = false;
        }
        entries.delete(id);
        return;
      }
      /* A scroller may move between the window layer and a dialog layer. */
      const wanted = layerFor(entry.container);
      if (wanted && wanted !== entry.layer && wanted.appendChild) {
        mutating = true;
        try {
          if (entry.bar.parentNode && entry.bar.parentNode.removeChild) {
            entry.bar.parentNode.removeChild(entry.bar);
          }
          wanted.appendChild(entry.bar);
          entry.layer = wanted;
        } catch (err) { /* ignore */ }
        mutating = false;
      }
      layout(entry);
      sync(entry);
    });
  }

  function schedule() {
    if (pending) return;
    pending = true;
    const run = function () { pending = false; refresh(); };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function init() {
    refresh();
    if (typeof window.MutationObserver === "function") {
      const targets = ["app", "modal", "appearance-panel", "window-content"]
        .map(function (id) { return document.getElementById(id); })
        .filter(Boolean);
      observer = new window.MutationObserver(function (records) {
        if (mutating) return;
        const relevant = records.some(function (r) {
          if (r.type === "attributes") {
            const t = r.target;
            /* Ignore our own bar style writes to avoid a feedback loop. */
            return !(t && t.classList && t.classList.contains("nf-scrollbar"));
          }
          const added = Array.prototype.slice.call(r.addedNodes || []);
          const removed = Array.prototype.slice.call(r.removedNodes || []);
          return added.concat(removed).some(function (n) {
            return n && n.nodeType === 1 && !(n.classList && n.classList.contains("nf-scrollbar"));
          });
        });
        if (relevant) schedule();
      });
      targets.forEach(function (t) {
        observer.observe(t, {
          childList: true, subtree: true, attributes: true,
          attributeFilter: ["class", "style", "hidden", "data-workmode", "data-runtime",
            "data-mode", "data-density", "data-paper", "data-animate", "data-reduce-motion"]
        });
      });
    }
    if (typeof window.ResizeObserver === "function") {
      resizeObserver = new window.ResizeObserver(schedule);
      if (host && resizeObserver.observe) resizeObserver.observe(host);
    }
    if (window.addEventListener) {
      window.addEventListener("resize", schedule);
      window.addEventListener("scroll", schedule, true);
    }
    if (document.addEventListener) {
      try { document.addEventListener("wheel", onWheel, { capture: true, passive: false }); }
      catch (err) { document.addEventListener("wheel", onWheel, true); }
    }
    /* Geometry sentinel: catches CSS transitions, window resizing, drag
       resizing and any change the observers above miss. Cheap: compare a
       cached rect signature, only relayout when it actually changed. */
    if (typeof setInterval === "function") {
      sentinel = setInterval(function () {
        if (document.hidden) return;
        entries.forEach(function (entry) {
          const c = entry.container;
          if (!c || !c.isConnected || !c.getBoundingClientRect) return;
          const cr = c.getBoundingClientRect();
          if (rectKeyOf(cr, c) !== entry.rectKey) { layout(entry); sync(entry); }
        });
      }, 200);
    }
  }

  NF.customScroll = {
    refresh: refresh,
    syncAll: function () { entries.forEach(sync); },
    layoutAll: function () { entries.forEach(function (e) { layout(e); sync(e); }); },
    routeWheel: onWheel,
    count: function () { return entries.size; }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(window.NF);
