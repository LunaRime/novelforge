"use strict";
/* NovelForge UI Redesign v3 — behaviour for the custom-drawn controls.
   Loaded after app.js. Everything here is pointer / keyboard handling on
   ordinary elements: no select, range, checkbox or popover API is used. */
(function (NF) {
  const T = function (k) { return NF.t(k); };
  const S = function () { return NF.state; };

  function root() { return document.getElementById("program-window"); }
  function closeAll() {
    document.querySelectorAll(".nf-select.open").forEach(function (box) {
      box.classList.remove("open");
      const trigger = box.querySelector("[data-select-trigger]");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  /* Reading progress line: scroll does not bubble, so listen in capture. */
  document.addEventListener("scroll", function (e) {
    const el = e.target;
    if (!el || !el.classList || !el.classList.contains) return;
    const scrollerClasses = ["scroll", "document-scroll", "view", "modal-body", "settings-pane",
      "settings-nav", "appearance-body", "command-results", "context-body", "ai-thread",
      "runtime-body", "set-nav", "set-pane", "lp-rows"];
    let isScroller = false;
    for (let i = 0; i < scrollerClasses.length; i++) {
      if (el.classList.contains(scrollerClasses[i])) { isScroller = true; break; }
    }
    if (!isScroller) return;
    if (el.classList.contains("document-scroll")) {
      const max = (el.scrollHeight || 0) - (el.clientHeight || 0);
      const p = max > 0 ? Math.max(0, Math.min(1, (el.scrollTop || 0) / max)) : 0;
      if (el.style && el.style.setProperty) el.style.setProperty("--nf-scroll-progress", p.toFixed(3));
    }
    if (el.classList.add) {
      el.classList.add("is-scrolling");
      clearTimeout(el._scrollTimer);
      el._scrollTimer = setTimeout(function () {
        if (el.classList && el.classList.remove) el.classList.remove("is-scrolling");
      }, 180);
    }
  }, true);

  /* --------------------------------------------------- custom dropdown */
  document.addEventListener("click", function (e) {
    const target = e.target;
    const closest = target && target.closest ? target.closest.bind(target) : null;
    if (!closest) return;
    const trigger = closest("[data-select-trigger]");
    if (trigger) {
      const box = trigger.closest(".nf-select");
      const wasOpen = box && box.classList.contains("open");
      closeAll();
      if (box && !wasOpen) {
        box.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
      }
      e.stopPropagation();
      return;
    }
    const option = closest(".nf-option");
    if (option) {
      const box = option.closest(".nf-select");
      if (box) {
        box.querySelectorAll(".nf-option").forEach(function (o) { o.setAttribute("aria-selected", "false"); });
        option.setAttribute("aria-selected", "true");
        const label = box.querySelector("[data-select-label]");
        const text = option.querySelector("span");
        if (label && text) label.textContent = text.textContent;
      }
      closeAll();
      return; /* let the app delegate handle data-action */
    }
    const chip = closest('[data-action="theme-set"],[data-action="model-set"],[data-action="chapter-kind"]');
    if (chip && chip.parentElement && chip.parentElement.querySelectorAll) {
      chip.parentElement.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("active"); });
      chip.classList.add("active");
    }
    closeAll();
  }, true);

  document.addEventListener("keydown", function (e) {
    const box = document.querySelector(".nf-select.open");
    if (box) {
      const keys = ["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter"];
      if (keys.indexOf(e.key) !== -1) {
        const opts = Array.prototype.slice.call(box.querySelectorAll(".nf-option"));
        let idx = opts.findIndex(function (o) { return o.classList.contains("cursor"); });
        if (e.key === "Escape") { closeAll(); e.preventDefault(); e.stopPropagation(); return; }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          idx = e.key === "ArrowDown" ? (idx + 1) % opts.length : (idx - 1 + opts.length) % opts.length;
          opts.forEach(function (o, i) { o.classList.toggle("cursor", i === idx); });
        } else if (e.key === "Home" || e.key === "End") {
          idx = e.key === "Home" ? 0 : opts.length - 1;
          opts.forEach(function (o, i) { o.classList.toggle("cursor", i === idx); });
        } else if (e.key === "Enter" && opts.length) {
          (opts[idx] || opts[0]).click();
        }
        e.preventDefault(); e.stopPropagation();
        return;
      }
    }
    /* Custom slider keyboard support. */
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains("nf-slider")) {
      const step = e.shiftKey ? 10 : 1;
      let delta = 0;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = step;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -step;
      if (e.key === "Home" || e.key === "End") {
        const min = Number(active.dataset.min) || 0, max = Number(active.dataset.max) || 100;
        setSliderValue(active, e.key === "Home" ? min : max);
        e.preventDefault(); return;
      }
      if (delta) {
        setSliderValue(active, Number(active.dataset.value) + delta);
        e.preventDefault();
      }
    }
  }, true);

  /* ------------------------------------------------------ custom slider */
  function setSliderValue(box, value) {
    if (!box) return;
    const min = Number(box.dataset.min || 0), max = Number(box.dataset.max || 100);
    const v = Math.max(min, Math.min(max, Math.round(value)));
    const unit = box.dataset.unit || "";
    const pct = Math.round((v - min) / (max - min) * 100);
    box.dataset.value = String(v);
    if (box.setAttribute) box.setAttribute("aria-valuenow", String(v));
    const fill = box.querySelector(".nf-slider-fill");
    const thumb = box.querySelector(".nf-slider-thumb");
    const out = box.querySelector(".nf-slider-output");
    if (fill) fill.style.width = pct + "%";
    if (thumb) thumb.style.left = pct + "%";
    if (out) out.textContent = v + unit;
    const st = S();
    const action = box.dataset.slider;
    if (action === "bg-strength") st.bgStrength = v / 100;
    else if (action === "bg-veil") st.bgVeil = v;
    else if (action === "bg-blur") st.bgBlur = v;
    if (typeof NF.applyAppearance === "function") NF.applyAppearance();
  }

  let drag = null;
  document.addEventListener("pointerdown", function (e) {
    const track = e.target && e.target.closest ? e.target.closest(".nf-slider-track") : null;
    if (!track) return;
    const box = track.closest(".nf-slider");
    if (!box) return;
    drag = { box: box, track: track };
    box.classList.add("dragging");
    updateFromPointer(e, track, box);
    if (track.setPointerCapture && e.pointerId != null) {
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
    }
    e.preventDefault();
  });
  function updateFromPointer(e, track, box) {
    const rect = track.getBoundingClientRect ? track.getBoundingClientRect() : { left: 0, width: 1 };
    const min = Number(box.dataset.min || 0), max = Number(box.dataset.max || 100);
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    setSliderValue(box, min + ratio * (max - min));
  }
  document.addEventListener("pointermove", function (e) {
    if (drag) updateFromPointer(e, drag.track, drag.box);
  });
  document.addEventListener("pointerup", function () {
    if (drag) drag.box.classList.remove("dragging");
    drag = null;
  });
  document.addEventListener("pointercancel", function () {
    if (drag) drag.box.classList.remove("dragging");
    drag = null;
  });

  /* ---------------------------------------------------- pane resizers */
  const PANE = {
    context: { css: "--nf-layout-context", def: 248, min: 190, max: 360 },
    assistant: { css: "--nf-layout-assistant", def: 320, min: 260, max: 440 },
    runtime: { css: "--nf-layout-runtime", def: 150, min: 96, max: 420 }
  };
  function paneValue(pane) {
    const cfg = PANE[pane] || PANE.assistant;
    const r = root();
    if (!r || !window.getComputedStyle) return cfg.def;
    const raw = parseInt(window.getComputedStyle(r).getPropertyValue(cfg.css), 10);
    return isNaN(raw) ? cfg.def : raw;
  }
  function setPane(pane, value) {
    const cfg = PANE[pane] || PANE.assistant;
    const r = root();
    if (!r || !r.style) return cfg.def;
    const v = Math.max(cfg.min, Math.min(cfg.max, Math.round(value)));
    r.style.setProperty(cfg.css, v + "px");
    return v;
  }
  function createResizers(workbench) {
    ["context", "assistant"].forEach(function (pane) {
      const el = document.createElement("div");
      el.className = "pane-resizer";
      el.dataset.pane = pane;
      el.tabIndex = 0;
      el.setAttribute("role", "separator");
      el.setAttribute("aria-orientation", "vertical");
      el.setAttribute("aria-label", T(pane === "context" ? "paneContext" : "paneAssistant"));
      workbench.appendChild(el);

      let startX = 0, startValue = 0, active = false;
      el.addEventListener("pointerdown", function (e) {
        active = true; startX = e.clientX; startValue = paneValue(pane);
        el.classList.add("dragging");
        if (el.setPointerCapture && e.pointerId != null) {
          try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        }
        e.preventDefault(); e.stopPropagation();
      });
      el.addEventListener("pointermove", function (e) {
        if (!active) return;
        const delta = pane === "context" ? e.clientX - startX : startX - e.clientX;
        setPane(pane, startValue + delta);
        if (NF.customScroll && typeof NF.customScroll.refresh === "function") NF.customScroll.refresh();
      });
      const end = function () { active = false; el.classList.remove("dragging"); };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      el.addEventListener("keydown", function (e) {
        const step = e.shiftKey ? 20 : 10;
        let delta = 0;
        if (e.key === "ArrowRight") delta = pane === "context" ? step : -step;
        if (e.key === "ArrowLeft") delta = pane === "context" ? -step : step;
        if (delta) { setPane(pane, paneValue(pane) + delta); e.preventDefault(); }
      });
    });
  }

  /* Vertical handle for tasks / logs / inbox. It lives in .workspace rather
     than .runtime, because renderRuntime() replaces the runtime innerHTML. */
  function createRuntimeResizer(workspace) {
    const cfg = PANE.runtime;
    const el = document.createElement("div");
    el.className = "runtime-resizer";
    el.dataset.pane = "runtime";
    el.tabIndex = 0;
    el.setAttribute("role", "separator");
    el.setAttribute("aria-orientation", "horizontal");
    el.setAttribute("aria-label", T("paneRuntime"));
    el.setAttribute("title", T("runtimeResizeHint"));
    el.setAttribute("aria-valuemin", String(cfg.min));
    el.setAttribute("aria-valuemax", String(cfg.max));
    el.setAttribute("aria-valuenow", String(paneValue("runtime")));
    workspace.appendChild(el);

    let startY = 0, startValue = 0, active = false;
    const apply = function (v) {
      const actual = setPane("runtime", v);
      el.setAttribute("aria-valuenow", String(actual));
      if (NF.customScroll && typeof NF.customScroll.refresh === "function") NF.customScroll.refresh();
    };
    el.addEventListener("pointerdown", function (e) {
      active = true; startY = e.clientY; startValue = paneValue("runtime");
      el.classList.add("dragging");
      if (el.setPointerCapture && e.pointerId != null) {
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      e.preventDefault(); e.stopPropagation();
    });
    el.addEventListener("pointermove", function (e) {
      if (!active) return;
      apply(startValue + (startY - e.clientY));
    });
    const end = function () { active = false; el.classList.remove("dragging"); };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", function (e) {
      const step = e.shiftKey ? 24 : 12;
      let next = null;
      if (e.key === "ArrowUp") next = paneValue("runtime") + step;
      if (e.key === "ArrowDown") next = paneValue("runtime") - step;
      if (e.key === "Home") next = cfg.min;
      if (e.key === "End") next = cfg.max;
      if (next != null) { apply(next); e.preventDefault(); }
    });
    el.addEventListener("dblclick", function () { apply(cfg.def); });
  }

  /* --------------------------------------------------------------- boot */
  let attempts = 0;
  function init() {
    const workbench = document.getElementById("workbench");
    const r = root();
    if (!workbench || !r) {
      if (attempts++ < 5) setTimeout(init, 0);
      return;
    }
    createResizers(workbench);
    const workspace = document.getElementById("workspace");
    if (workspace) createRuntimeResizer(workspace);
    r.dataset.reduceMotion = S().reduceMotion ? "true" : "false";
  }
  NF.customRuntime = { setSliderValue: setSliderValue, setPane: setPane, closeAllSelects: closeAll };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(window.NF);
