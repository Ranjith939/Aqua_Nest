/* ==========================================================================
   AQUA NEST - ocean.js

   Populates the decorative background with bubbles and drifting motes.
   Everything it creates is styled by ocean.css; this file only decides how
   many elements exist and gives each one its own random rhythm.
   ========================================================================== */

(function () {
  "use strict";

  var scene = document.querySelector(".ocean");
  if (!scene) { return; }

  var bubbleLayer = scene.querySelector("[data-ocean-bubbles]");
  var moteLayer = scene.querySelector("[data-ocean-particles]");

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var cores = navigator.hardwareConcurrency || 8;
  var isSmall = window.innerWidth < 900;

  // Fewer, cheaper elements on small screens, low-core devices and whenever
  // the visitor has asked for reduced motion.
  var lite = isSmall || cores <= 4 || prefersReduced;
  if (lite) { scene.classList.add("is-lite"); }

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function px(value) {
    return value.toFixed(1) + "px";
  }

  function spawn(layer, count, decorate) {
    if (!layer) { return; }
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < count; i += 1) {
      var node = document.createElement("span");
      decorate(node, i, count);
      fragment.appendChild(node);
    }
    layer.appendChild(fragment);
  }

  /* Rising bubbles -------------------------------------------------------- */

  spawn(bubbleLayer, lite ? 14 : 30, function (node, index, total) {
    var size = rand(4, 17);
    node.className = "bubble";
    // Spread the columns evenly, then jitter so it never looks like a grid.
    node.style.setProperty("--x", (index / total) * 100 + rand(-4, 4) + "%");
    node.style.setProperty("--size", px(size));
    node.style.setProperty("--dur", rand(15, 34).toFixed(1) + "s");
    node.style.setProperty("--delay", (-rand(0, 34)).toFixed(1) + "s");
    node.style.setProperty("--drift", px(rand(-46, 46)));
    // Small bubbles sit further back, so they stay fainter.
    node.style.setProperty("--peak", (0.26 + (size / 17) * 0.42).toFixed(2));
  });

  /* Suspended motes ------------------------------------------------------- */

  spawn(moteLayer, lite ? 18 : 48, function (node) {
    var size = rand(1.5, 3.6);
    node.className = "mote";
    node.style.setProperty("--x", rand(0, 100).toFixed(1) + "%");
    node.style.setProperty("--y", rand(4, 96).toFixed(1) + "%");
    node.style.setProperty("--size", px(size));
    node.style.setProperty("--dx", px(rand(-70, 70)));
    node.style.setProperty("--dy", px(rand(-110, -30)));
    node.style.setProperty("--dur", rand(18, 46).toFixed(1) + "s");
    node.style.setProperty("--delay", (-rand(0, 26)).toFixed(1) + "s");
    node.style.setProperty("--peak", rand(0.2, 0.6).toFixed(2));
  });

  /* Pause the whole scene while the tab is hidden. */
  document.addEventListener("visibilitychange", function () {
    scene.style.animationPlayState = document.hidden ? "paused" : "running";
    var animated = scene.querySelectorAll("*");
    for (var i = 0; i < animated.length; i += 1) {
      animated[i].style.animationPlayState = document.hidden ? "paused" : "running";
    }
  });
}());
