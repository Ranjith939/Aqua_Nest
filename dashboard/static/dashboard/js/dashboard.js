/* ==========================================================================
   AQUA NEST - dashboard.js

   UI behaviour only: the sidebar drawer, dropdown menus, the search
   shortcut, the live clock, KPI count-ups, click ripples and toasts.
   No data is fetched or mutated anywhere in this file.
   ========================================================================== */

(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----------------------------------------------------------------------
     Sidebar drawer (mobile / tablet)
     ---------------------------------------------------------------------- */

  var sidebar = document.querySelector("[data-sidebar]");
  var scrim = document.querySelector("[data-sidebar-scrim]");

  function openSidebar() {
    if (!sidebar) { return; }
    sidebar.classList.add("is-open");
    if (scrim) {
      scrim.hidden = false;
      // Next frame, so the opacity transition actually runs.
      requestAnimationFrame(function () { scrim.classList.add("is-visible"); });
    }
    document.body.style.overflow = "hidden";
  }

  function closeSidebar() {
    if (!sidebar) { return; }
    sidebar.classList.remove("is-open");
    if (scrim) {
      scrim.classList.remove("is-visible");
      window.setTimeout(function () { scrim.hidden = true; }, 320);
    }
    document.body.style.overflow = "";
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-sidebar-open]")) { openSidebar(); }
    if (event.target.closest("[data-sidebar-close]")) { closeSidebar(); }
    if (event.target.closest("[data-sidebar-scrim]")) { closeSidebar(); }
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth > 1024) { closeSidebar(); }
  });

  /* ----------------------------------------------------------------------
     Sidebar collapse (desktop)

     Collapsing narrows a flex item, so the main content genuinely reclaims
     the space rather than having a panel slide over it. The choice is
     remembered per browser.
     ---------------------------------------------------------------------- */

  var COLLAPSE_KEY = "aquanest:sidebar-collapsed";
  var collapseBtn = document.querySelector("[data-sidebar-collapse]");
  var collapseGlyph = document.querySelector("[data-collapse-glyph]");

  function setCollapsed(collapsed) {
    if (!sidebar) { return; }
    sidebar.classList.toggle("is-collapsed", collapsed);
    if (collapseGlyph) {
      collapseGlyph.innerHTML = collapsed ? "&#9654;" : "&#9664;";
    }
    if (collapseBtn) {
      collapseBtn.setAttribute("aria-expanded", String(!collapsed));
      collapseBtn.setAttribute(
        "aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar"
      );
    }
    // The 3D layer sizes to the window, not the column, so nothing to redraw;
    // the chart does need to remeasure its new width.
    window.dispatchEvent(new Event("resize"));
  }

  if (collapseBtn) {
    var stored = null;
    try { stored = window.localStorage.getItem(COLLAPSE_KEY); } catch (err) { stored = null; }
    if (stored === "1") { setCollapsed(true); }

    collapseBtn.addEventListener("click", function () {
      var next = !sidebar.classList.contains("is-collapsed");
      setCollapsed(next);
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch (err) { /* private mode */ }
    });
  }

  /* ----------------------------------------------------------------------
     Dropdown menus
     ---------------------------------------------------------------------- */

  var dropdowns = Array.prototype.slice.call(document.querySelectorAll("[data-dropdown]"));

  function closeDropdown(dropdown) {
    var menu = dropdown.querySelector("[data-dropdown-menu]");
    var toggle = dropdown.querySelector("[data-dropdown-toggle]");
    dropdown.classList.remove("is-open");
    if (menu) { menu.hidden = true; }
    if (toggle) { toggle.setAttribute("aria-expanded", "false"); }
  }

  function closeAllDropdowns(except) {
    dropdowns.forEach(function (dropdown) {
      if (dropdown !== except) { closeDropdown(dropdown); }
    });
  }

  dropdowns.forEach(function (dropdown) {
    var toggle = dropdown.querySelector("[data-dropdown-toggle]");
    var menu = dropdown.querySelector("[data-dropdown-menu]");
    if (!toggle || !menu) { return; }

    toggle.addEventListener("click", function (event) {
      event.stopPropagation();
      var isOpen = dropdown.classList.contains("is-open");
      closeAllDropdowns(dropdown);
      if (isOpen) {
        closeDropdown(dropdown);
      } else {
        dropdown.classList.add("is-open");
        menu.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
      }
    });

    // Selecting anything inside a menu closes it again.
    menu.addEventListener("click", function (event) {
      if (event.target.closest("button, a")) {
        window.setTimeout(function () { closeDropdown(dropdown); }, 90);
      }
    });
  });

  document.addEventListener("click", function () { closeAllDropdowns(null); });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeAllDropdowns(null);
      closeSidebar();
    }
  });

  /* ----------------------------------------------------------------------
     Farm selector - swaps the label in the top bar
     ---------------------------------------------------------------------- */

  var farmLabel = document.querySelector("[data-farm-name]");

  document.addEventListener("click", function (event) {
    var option = event.target.closest("[data-farm-option]");
    if (!option || !farmLabel) { return; }

    farmLabel.textContent = option.getAttribute("data-farm-option");

    var siblings = option.parentNode.querySelectorAll("[data-farm-option]");
    Array.prototype.forEach.call(siblings, function (node) {
      node.classList.toggle("is-selected", node === option);
    });

    toast("Switched to " + option.getAttribute("data-farm-option") + ".");
  });

  /* ----------------------------------------------------------------------
     Segmented controls (range pickers)
     ---------------------------------------------------------------------- */

  document.addEventListener("click", function (event) {
    var option = event.target.closest("[data-range-option]");
    if (!option) { return; }
    var group = option.closest("[data-range]");
    if (!group) { return; }

    Array.prototype.forEach.call(group.querySelectorAll("[data-range-option]"), function (node) {
      node.classList.toggle("is-active", node === option);
    });
  });

  /* ----------------------------------------------------------------------
     Search shortcut
     ---------------------------------------------------------------------- */

  var searchInput = document.querySelector("[data-search-input]");

  document.addEventListener("keydown", function (event) {
    if (!searchInput) { return; }

    var isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
    var isSlash = event.key === "/" && document.activeElement !== searchInput
      && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);

    if (isShortcut || isSlash) {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  /* ----------------------------------------------------------------------
     Live clock
     ---------------------------------------------------------------------- */

  // The hero card and the taskbar tray both show the time.
  var clockTimes = document.querySelectorAll("[data-clock-time]");
  var clockDate = document.querySelector("[data-clock-date]");

  function tickClock() {
    if (!clockTimes.length) { return; }
    var now = new Date();
    var stamp = now.toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", hour12: true
    });
    Array.prototype.forEach.call(clockTimes, function (node) {
      node.textContent = stamp;
    });
    if (clockDate) {
      clockDate.textContent = now.toLocaleDateString([], {
        weekday: "short", day: "numeric", month: "long", year: "numeric"
      });
    }
  }

  if (clockTimes.length) {
    tickClock();
    window.setInterval(tickClock, 20000);
  }

  /* ----------------------------------------------------------------------
     KPI count-up
     ---------------------------------------------------------------------- */

  function countUp(element) {
    var target = parseFloat(element.getAttribute("data-count-to"));
    if (isNaN(target) || reduced) { return; }

    var duration = 1100;
    var started = null;
    var frames = 0;

    function step(timestamp) {
      // Bail out and show the real number rather than counting forever.
      frames += 1;
      if (frames > 240) {
        element.textContent = String(target);
        return;
      }

      // Wait for the frame clock to actually advance before touching the
      // markup, so a stalled clock leaves the server-rendered value alone
      // instead of pinning the card to zero.
      if (started === null) {
        started = timestamp;
        requestAnimationFrame(step);
        return;
      }
      if (timestamp <= started) {
        requestAnimationFrame(step);
        return;
      }

      var progress = Math.min((timestamp - started) / duration, 1);
      // easeOutCubic
      var eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = String(Math.round(target * eased));
      if (progress < 1) { requestAnimationFrame(step); }
    }

    // The first frame writes "0"; if rAF never runs, the server-rendered
    // value simply stays put instead of being blanked.
    requestAnimationFrame(step);

    // Safety net: never leave a KPI stuck mid-count.
    window.setTimeout(function () {
      element.textContent = String(target);
    }, duration + 250);
  }

  Array.prototype.forEach.call(
    document.querySelectorAll("[data-count-to]"),
    function (element) { window.setTimeout(function () { countUp(element); }, 350); }
  );

  /* ----------------------------------------------------------------------
     Click ripple
     ---------------------------------------------------------------------- */

  document.addEventListener("click", function (event) {
    var host = event.target.closest(".action-btn, .btn, .pond");
    if (!host || reduced) { return; }

    var rect = host.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 2.2;
    var ripple = document.createElement("span");

    ripple.className = "ripple";
    ripple.style.width = size + "px";
    ripple.style.height = size + "px";
    ripple.style.left = (event.clientX - rect.left) + "px";
    ripple.style.top = (event.clientY - rect.top) + "px";

    host.appendChild(ripple);
    window.setTimeout(function () { ripple.remove(); }, 700);
  });

  /* ----------------------------------------------------------------------
     Toasts - acknowledge clicks on controls that have no backend yet
     ---------------------------------------------------------------------- */

  var toastStack = null;

  function toast(message) {
    if (!toastStack) {
      toastStack = document.createElement("div");
      toastStack.className = "toast-stack";
      document.body.appendChild(toastStack);
    }

    var node = document.createElement("div");
    node.className = "toast glass glass--pop";
    node.setAttribute("role", "status");
    node.textContent = message;
    toastStack.appendChild(node);

    window.setTimeout(function () {
      node.classList.add("is-leaving");
      window.setTimeout(function () { node.remove(); }, 400);
    }, 2600);
  }

  var ACTION_MESSAGES = {
    live: "Live data streams arrive with the sensor integration milestone.",
    report: "Report generation is not wired up in this UI preview.",
    devices: "Device management is part of the next milestone.",
    settings: "Farm settings will open once the backend is connected."
  };

  document.addEventListener("click", function (event) {
    var action = event.target.closest("[data-action]");
    if (action) {
      toast(ACTION_MESSAGES[action.getAttribute("data-action")] || "Coming soon.");
      return;
    }

    // On the Ponds page the Digital Twin handles pond clicks by switching
    // the selection, so the placeholder toast would contradict it.
    var pond = document.querySelector("[data-pond-twin]")
      ? null
      : event.target.closest("[data-pond]");
    if (pond) {
      var label = pond.querySelector(".pond__label-text strong");
      toast((label ? label.textContent : "This pond") + " detail view is coming soon.");
    }
  });
}());
