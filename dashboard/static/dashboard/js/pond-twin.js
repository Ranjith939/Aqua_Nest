/* ==========================================================================
   AQUA NEST - pond-twin.js
   The Living Digital Twin.

   A procedural side-on cross-section of the pond, drawn with Canvas 2D. No
   model files, no WebGL context - the page already runs two of those for the
   background scene and the hero fish.

   WHAT IT DRAWS: the condition of the water and the fish in it. Deliberately
   NOT the AQUA NEST hardware - no sensors, probes, wires or device markers
   appear in the pond.

   HOW IT IS DRIVEN: only by the interpreted state object from the pond state
   engine:

     { pondState, oxygenState, waterQualityState,
       waterLevelState, fishActivityState, aeratorState }

   Nothing here reads a sensor value. Every visual target is looked up from
   those strings, then eased toward, so a state change animates rather than
   snapping - which is what makes critical -> recovering -> healthy read as a
   transition instead of a cut.

   A cross-section is the right projection because it is the only one that can
   show water level dropping, fish rising to the surface under oxygen stress,
   and clarity through the depth of the water all at once.
   ========================================================================== */

(function () {
  "use strict";

  var canvas = document.querySelector("[data-pond-twin]");
  var payloadNode = document.getElementById("pond-data");
  if (!canvas || !payloadNode) { return; }

  var PONDS = JSON.parse(payloadNode.textContent);
  var ctx = canvas.getContext("2d");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----------------------------------------------------------------------
     Palette, read from the stylesheet so the twin cannot drift off-theme
     ---------------------------------------------------------------------- */

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v || "").trim() || fallback;
  }

  var PALETTE = {
    biolume: cssVar("--biolume", "#70f3ff"),
    aqua: cssVar("--aqua", "#39d9d2"),
    deep: cssVar("--deep-ocean", "#0b3c5d"),
    abyss: cssVar("--abyss", "#061a24"),
    green: cssVar("--seaweed-green", "#4ee39a"),
    orange: cssVar("--reef-orange", "#ffb86b"),
    pink: cssVar("--coral-pink", "#ff6fae"),
    purple: cssVar("--reef-purple", "#8b6cff")
  };

  /* ----------------------------------------------------------------------
     State -> visual targets

     This table IS the contract. Adding a pond state means adding a row here,
     not touching the renderer.
     ---------------------------------------------------------------------- */

  //: clarity   1 = clear water, 0 = heavily clouded
  //: tint      water colour the body grades toward
  //: motes     suspended particle count
  var WATER_BY_QUALITY = {
    GOOD: { clarity: 1.0, motes: 10, tint: [46, 150, 178] },
    DECLINING: { clarity: 0.62, motes: 34, tint: [64, 148, 140] },
    DEGRADED: { clarity: 0.3, motes: 72, tint: [92, 138, 96] }
  };

  //: speed      lateral swim speed multiplier
  //: spread     how much of the water column the shoal uses (1 = all of it)
  //: rise       0 = normal depth, 1 = pinned to the surface
  //: tailBeat   tail animation rate multiplier
  var FISH_BY_ACTIVITY = {
    NORMAL: { speed: 1.0, spread: 1.0, rise: 0.0, tailBeat: 1.0 },
    REDUCED: { speed: 0.55, spread: 0.72, rise: 0.15, tailBeat: 0.7 },
    SURFACING: { speed: 0.3, spread: 0.34, rise: 0.86, tailBeat: 0.45 },
    RECOVERING: { speed: 0.8, spread: 0.88, rise: 0.22, tailBeat: 0.9 }
  };

  //: How high the water sits in the basin, 0..1 of usable depth.
  var LEVEL_BY_STATE = { NORMAL: 1.0, LOW: 0.62, CRITICAL: 0.4 };

  //: Accent used for the surface glow and the state wash.
  var ACCENT_BY_POND_STATE = {
    HEALTHY: PALETTE.biolume,
    RECOVERING: PALETTE.aqua,
    WARNING: PALETTE.orange,
    CRITICAL: PALETTE.pink
  };

  var FISH_COUNT = 11;

  /* ----------------------------------------------------------------------
     Eased visual model
     ---------------------------------------------------------------------- */

  var view = null;   // current, eased
  var target = null; // where the state says we should be

  function targetsFor(state) {
    var water = WATER_BY_QUALITY[state.waterQualityState] || WATER_BY_QUALITY.GOOD;
    var fish = FISH_BY_ACTIVITY[state.fishActivityState] || FISH_BY_ACTIVITY.NORMAL;
    var level = LEVEL_BY_STATE[state.waterLevelState];

    if (level === undefined) { level = 1.0; }

    // The reported percentage refines the level within its band, so a pond at
    // 47% and one at 58% do not draw identically.
    if (typeof state.waterLevelPercent === "number") {
      level = Math.max(0.34, Math.min(1.0, state.waterLevelPercent / 100));
    }

    var aerating = state.aeratorState === "ON";

    return {
      clarity: water.clarity,
      motes: water.motes,
      tint: water.tint,
      speed: fish.speed,
      spread: fish.spread,
      rise: fish.rise,
      tailBeat: fish.tailBeat,
      level: level,
      // Aeration lifts surface chop and adds bubble columns; flow nudges it.
      chop: aerating ? 1.0 : 0.34,
      bubbles: aerating ? 1.0 : 0.0,
      accent: ACCENT_BY_POND_STATE[state.pondState] || PALETTE.biolume
    };
  }

  function ease(from, to, k) { return from + (to - from) * k; }

  function stepView(k) {
    view.clarity = ease(view.clarity, target.clarity, k);
    view.motes = ease(view.motes, target.motes, k);
    view.speed = ease(view.speed, target.speed, k);
    view.spread = ease(view.spread, target.spread, k);
    view.rise = ease(view.rise, target.rise, k);
    view.tailBeat = ease(view.tailBeat, target.tailBeat, k);
    view.level = ease(view.level, target.level, k);
    view.chop = ease(view.chop, target.chop, k);
    view.bubbles = ease(view.bubbles, target.bubbles, k);
    for (var i = 0; i < 3; i += 1) {
      view.tint[i] = ease(view.tint[i], target.tint[i], k);
    }
    view.accent = target.accent;
  }

  /* ----------------------------------------------------------------------
     Population: fish, motes, bubbles
     ---------------------------------------------------------------------- */

  function rand(a, b) { return a + Math.random() * (b - a); }

  var fish = [];
  for (var f = 0; f < FISH_COUNT; f += 1) {
    fish.push({
      x: Math.random(),
      lane: rand(0.18, 0.9),      // resting depth, 0 = surface
      size: rand(0.6, 1.0),
      dir: Math.random() < 0.5 ? 1 : -1,
      rate: rand(0.7, 1.25),
      phase: rand(0, Math.PI * 2),
      wobble: rand(0.4, 1.1)
    });
  }

  var motes = [];
  for (var m = 0; m < 90; m += 1) {
    motes.push({
      x: Math.random(), y: Math.random(),
      r: rand(0.6, 2.1), drift: rand(0.004, 0.02), phase: rand(0, 6.3)
    });
  }

  var bubbles = [];
  for (var b = 0; b < 46; b += 1) {
    bubbles.push({
      col: Math.random(), y: Math.random(),
      r: rand(1.2, 3.4), speed: rand(0.1, 0.26), sway: rand(0.4, 1.5),
      phase: rand(0, 6.3)
    });
  }

  /* ----------------------------------------------------------------------
     Drawing
     ---------------------------------------------------------------------- */

  var W = 0, H = 0, dpr = 1;

  function resize() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) { return false; }

    // Match the backing store to the device pixel ratio, or the whole thing
    // renders soft on any high-DPI screen.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  /** Surface height in px for a given x, including the moving wave. */
  function surfaceAt(x, t, top) {
    var amp = 1.6 + view.chop * 4.2;
    return top +
      Math.sin(x * 0.021 + t * 0.9) * amp +
      Math.sin(x * 0.047 - t * 1.4) * amp * 0.45;
  }

  function drawFish(x, y, scale, dir, t, wobble) {
    var L = 22 * scale;
    var Hh = 9.2 * scale;
    var beat = Math.sin(t * 6 * view.tailBeat + wobble) * 0.5;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    // Tilt upward when the shoal is pushed to the surface.
    ctx.rotate(-view.rise * 0.32 * dir);

    // Body
    ctx.beginPath();
    ctx.moveTo(L, 0);
    ctx.quadraticCurveTo(L * 0.25, -Hh, -L * 0.5, -Hh * 0.42);
    ctx.quadraticCurveTo(-L * 0.72, 0, -L * 0.5, Hh * 0.42);
    ctx.quadraticCurveTo(L * 0.25, Hh, L, 0);
    ctx.fill();

    // Tail
    ctx.beginPath();
    ctx.moveTo(-L * 0.5, 0);
    ctx.lineTo(-L * 0.98, -Hh * (0.72 + beat * 0.3));
    ctx.lineTo(-L * 0.86, 0);
    ctx.lineTo(-L * 0.98, Hh * (0.72 - beat * 0.3));
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function render(t) {
    var top = H * 0.1;
    var floor = H * 0.94;
    var usable = floor - top;

    // Water sits lower in the basin as the level drops.
    var waterTop = floor - usable * view.level;

    ctx.clearRect(0, 0, W, H);

    /* --- air above the water ------------------------------------------ */
    var air = ctx.createLinearGradient(0, 0, 0, waterTop);
    air.addColorStop(0, "rgba(10,48,72,0.55)");
    air.addColorStop(1, "rgba(12,64,92,0.25)");
    ctx.fillStyle = air;
    ctx.fillRect(0, 0, W, Math.max(0, waterTop));

    /* --- the water body ----------------------------------------------- */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, waterTop - 14);
    for (var x = 0; x <= W; x += 6) {
      ctx.lineTo(x, surfaceAt(x, t, waterTop));
    }
    ctx.lineTo(W, floor);
    ctx.lineTo(0, floor);
    ctx.closePath();
    ctx.clip();

    var body = ctx.createLinearGradient(0, waterTop, 0, floor);
    // Clear water keeps its colour with depth; clouded water muddies fast.
    body.addColorStop(0, rgba(view.tint, 0.62 + view.clarity * 0.14));
    body.addColorStop(0.55, rgba(view.tint, 0.78));
    body.addColorStop(1, "rgba(6,32,48," + (0.82 + (1 - view.clarity) * 0.14) + ")");
    ctx.fillStyle = body;
    ctx.fillRect(0, waterTop - 20, W, floor - waterTop + 20);

    /* --- light shafts from the surface -------------------------------- */
    var shafts = 5;
    ctx.globalCompositeOperation = "screen";
    for (var s = 0; s < shafts; s += 1) {
      var sx = ((s + 0.5) / shafts) * W + Math.sin(t * 0.32 + s) * 22;
      var grad = ctx.createLinearGradient(sx, waterTop, sx - 28, floor);
      var strength = 0.1 * view.clarity;
      grad.addColorStop(0, "rgba(190,250,255," + strength + ")");
      grad.addColorStop(1, "rgba(190,250,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sx - 16, waterTop);
      ctx.lineTo(sx + 16, waterTop);
      ctx.lineTo(sx - 30, floor);
      ctx.lineTo(sx - 74, floor);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    /* --- suspended particles ------------------------------------------ */
    var moteCount = Math.round(view.motes);
    ctx.fillStyle = "rgba(206,232,214,0.4)";
    for (var i = 0; i < moteCount && i < motes.length; i += 1) {
      var p = motes[i];
      var my = waterTop + ((p.y + t * p.drift) % 1) * (floor - waterTop);
      var mx = p.x * W + Math.sin(t * 0.4 + p.phase) * 8;
      ctx.beginPath();
      ctx.arc(mx, my, p.r, 0, 6.283);
      ctx.fill();
    }

    /* --- fish ---------------------------------------------------------- */
    var depth = floor - waterTop;
    for (var k = 0; k < fish.length; k += 1) {
      var fs = fish[k];
      fs.x += fs.dir * fs.rate * view.speed * 0.00035 * (reduced ? 0 : 1);
      if (fs.x > 1.1) { fs.x = -0.1; }
      if (fs.x < -0.1) { fs.x = 1.1; }

      // Resting depth, compressed toward the surface as `rise` climbs.
      var lane = fs.lane * view.spread + (1 - view.spread) * 0.5;
      var restY = waterTop + depth * (lane * (1 - view.rise) + 0.06 * view.rise);
      var swim = Math.sin(t * 0.7 * fs.rate + fs.phase) * depth * 0.05 * view.spread;

      var fx = fs.x * W;
      var fy = Math.min(restY + swim, floor - 8);

      // Fish fade with depth in clouded water - the clarity cue that makes
      // degradation legible without a caption.
      var depthFrac = (fy - waterTop) / Math.max(depth, 1);
      var vis = 0.35 + 0.65 * view.clarity * (1 - depthFrac * 0.55);

      ctx.fillStyle = "rgba(255,196,120," + Math.max(0.12, vis) + ")";
      drawFish(fx, fy, fs.size * (0.9 + view.clarity * 0.1), fs.dir, t, fs.wobble);
    }

    /* --- aeration bubbles ---------------------------------------------
       Rising from the bed with no visible device: the twin shows the water
       responding, never the hardware doing it.
    -------------------------------------------------------------------- */
    if (view.bubbles > 0.02) {
      ctx.fillStyle = "rgba(226,252,255," + (0.5 * view.bubbles) + ")";
      for (var bi = 0; bi < bubbles.length; bi += 1) {
        var bb = bubbles[bi];
        var prog = (bb.y + t * bb.speed) % 1;
        var by = floor - prog * (floor - waterTop);
        // Two loose columns rather than an even curtain.
        var colX = (0.3 + 0.4 * bb.col) * W + Math.sin(prog * 6 + bb.phase) * bb.sway * 12;
        ctx.beginPath();
        ctx.arc(colX, by, bb.r * (0.6 + prog * 0.6), 0, 6.283);
        ctx.fill();
      }
    }
    ctx.restore();

    /* --- surface line -------------------------------------------------- */
    ctx.beginPath();
    ctx.moveTo(0, surfaceAt(0, t, waterTop));
    for (var sx2 = 0; sx2 <= W; sx2 += 6) {
      ctx.lineTo(sx2, surfaceAt(sx2, t, waterTop));
    }
    ctx.strokeStyle = "rgba(226,252,255,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // A soft glow on the surface, tinted by the pond's overall state.
    var glow = ctx.createLinearGradient(0, waterTop - 16, 0, waterTop + 26);
    glow.addColorStop(0, "rgba(255,255,255,0)");
    glow.addColorStop(0.5, hexToRgba(view.accent, 0.22));
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, waterTop - 16, W, 42);

    /* --- bed ----------------------------------------------------------- */
    ctx.beginPath();
    ctx.moveTo(0, floor);
    ctx.quadraticCurveTo(W * 0.3, floor - 12, W * 0.55, floor - 5);
    ctx.quadraticCurveTo(W * 0.8, floor + 2, W, floor - 9);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = "rgba(9,46,60,0.92)";
    ctx.fill();

    /* --- state wash ---------------------------------------------------- */
    // Faint, and only away from the centre, so it never fights the content.
    var wash = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.95);
    wash.addColorStop(0, "rgba(0,0,0,0)");
    wash.addColorStop(1, hexToRgba(view.accent, 0.14));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);
  }

  function hexToRgba(hex, a) {
    var h = (hex || "").replace("#", "");
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    var n = parseInt(h, 16);
    if (isNaN(n)) { return "rgba(112,243,255," + a + ")"; }
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  /* ----------------------------------------------------------------------
     Wiring the rest of the page to the same state
     ---------------------------------------------------------------------- */

  var TONE_BY_POND_STATE = {
    HEALTHY: "healthy", RECOVERING: "info",
    WARNING: "warning", CRITICAL: "critical"
  };

  function setDot(el, tone) {
    if (!el) { return; }
    el.className = "dot dot--" + tone;
  }

  function applyPond(id) {
    var pond = PONDS[id];
    if (!pond) { return; }

    target = targetsFor(pond.state);
    if (!view) {
      // First paint starts where it belongs rather than easing in from
      // nowhere; later changes ease.
      view = JSON.parse(JSON.stringify(target));
    }

    // Twin badge
    var label = document.querySelector("[data-twin-state-label]");
    if (label) { label.textContent = pond.state.pondState; }
    setDot(document.querySelector("[data-twin-dot]"),
           TONE_BY_POND_STATE[pond.state.pondState] || "info");

    var levelTag = document.querySelector("[data-twin-level]");
    if (levelTag) { levelTag.textContent = pond.state.waterLevelPercent; }

    var aerTag = document.querySelector("[data-twin-aer]");
    if (aerTag) { aerTag.hidden = pond.state.aeratorState !== "ON"; }

    // Health
    var score = document.querySelector("[data-health-score]");
    if (score) { score.textContent = pond.health.score; }

    var band = document.querySelector("[data-health-band]");
    if (band) {
      band.className = "health-score__band health-score__band--" + pond.health.tone;
      band.innerHTML = '<i class="dot dot--' + pond.health.tone + '"></i>' + pond.health.band;
    }

    var fill = document.querySelector("[data-health-fill]");
    if (fill) {
      fill.className = "health-meter__fill meter__fill--" + pond.health.tone;
      fill.style.setProperty("--meter", pond.health.score + "%");
    }

    // Sensors
    var rows = document.querySelectorAll("[data-sensor]");
    Array.prototype.forEach.call(rows, function (row, index) {
      var s = pond.sensors[index];
      if (!s) { return; }
      row.className = "sensor-row sensor-row--" + s.tone;
      row.setAttribute("data-sensor", s.key);
      row.querySelector(".sensor-row__label").textContent = s.label;
      row.querySelector("[data-sensor-value]").textContent = s.value;
      var unit = row.querySelector("[data-sensor-unit]");
      if (unit) { unit.textContent = s.unit; }
      row.querySelector("[data-sensor-status]").textContent = s.status;
      var icon = row.querySelector(".sensor-row__icon");
      icon.className = "sensor-row__icon status-icon status-icon--" + s.tone + " status-icon--sm";
    });

    // Condition
    var headline = document.querySelector("[data-condition-headline]");
    if (headline) {
      headline.className = "condition-headline condition-headline--" + pond.condition.tone;
    }
    setDot(document.querySelector("[data-condition-dot]"), pond.condition.tone);
    var title = document.querySelector("[data-condition-title]");
    if (title) { title.textContent = pond.condition.headline; }
    var detail = document.querySelector("[data-condition-detail]");
    if (detail) { detail.textContent = pond.condition.detail; }

    // Equipment
    var map = { aeration: pond.actuators.aeration, pump: pond.actuators.pump,
                feeder: pond.actuators.feeder };
    Object.keys(map).forEach(function (name) {
      var row = document.querySelector('[data-actuator="' + name + '"]');
      if (!row) { return; }
      row.querySelector("[data-actuator-value]").textContent = map[name];
      var dot = row.querySelector(".dot");
      if (dot) {
        setDot(dot, map[name] === "ON" ? "healthy" : "muted");
      }
    });
  }

  /* ----------------------------------------------------------------------
     Boot
     ---------------------------------------------------------------------- */

  var current = document.querySelector("[data-pond-select].is-active");
  applyPond(current ? current.getAttribute("data-pond-select") : "1");

  var picker = document.querySelector("[data-pond-picker]");

  /**
   * Select a pond from anywhere on the page.
   *
   * The numbered picker above the twin and the tiles on the farm map are two
   * doors into the same selection, so both are re-synced here rather than
   * each tracking its own idea of what is selected.
   */
  function selectPond(id) {
    if (!PONDS[id]) { return; }

    if (picker) {
      Array.prototype.forEach.call(
        picker.querySelectorAll("[data-pond-select]"),
        function (n) {
          n.classList.toggle("is-active", n.getAttribute("data-pond-select") === id);
        }
      );
    }

    Array.prototype.forEach.call(
      document.querySelectorAll(".pond[data-pond]"),
      function (tile) {
        tile.classList.toggle("is-selected", tile.getAttribute("data-pond") === id);
      }
    );

    applyPond(id);
  }

  if (picker) {
    picker.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-pond-select]");
      if (btn) { selectPond(btn.getAttribute("data-pond-select")); }
    });
  }

  // Clicking a pond on the farm map drives the twin, so the map is a way of
  // navigating the page rather than a second, separate picture of the farm.
  document.addEventListener("click", function (event) {
    var tile = event.target.closest(".pond[data-pond]");
    if (!tile) { return; }
    selectPond(tile.getAttribute("data-pond"));
    var stage = document.querySelector("[data-twin-stage]");
    if (stage) { stage.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });

  // Mark the pond the page opened on.
  selectPond(current ? current.getAttribute("data-pond-select") : "1");

  var running = true;
  var frame = 0;
  var startedAt = performance.now();

  function loop(now) {
    if (!running) { return; }
    frame = requestAnimationFrame(loop);
    if (!W || !H) { if (!resize()) { return; } }

    var t = (now - startedAt) / 1000;
    stepView(reduced ? 1 : 0.045);
    render(t);
  }

  if (resize()) {
    frame = requestAnimationFrame(loop);
  } else {
    // Laid out later (collapsed panel, slow fonts): retry once things settle.
    window.setTimeout(function () {
      if (resize()) { frame = requestAnimationFrame(loop); }
    }, 200);
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 150);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(frame);
    } else if (!running) {
      running = true;
      startedAt = performance.now() - 1000;
      frame = requestAnimationFrame(loop);
    }
  });
}());
