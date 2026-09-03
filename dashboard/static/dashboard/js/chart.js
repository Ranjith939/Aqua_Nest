/* ==========================================================================
   AQUA NEST - chart.js

   Draws the "Water Quality Trends" placeholder chart as inline SVG from the
   JSON block rendered by the template (#wq-chart-data).

   The three readings use very different units, so each series is normalised
   into the plot area and the exact values are shown in the legend and the
   hover tooltip - the gridlines are deliberately unlabelled rather than
   implying one shared axis.
   ========================================================================== */

(function () {
  "use strict";

  var payload = document.getElementById("wq-chart-data");
  var root = document.querySelector("[data-chart]");
  if (!payload || !root) { return; }

  var DATA = JSON.parse(payload.textContent);
  var NS = "http://www.w3.org/2000/svg";

  var svg = root.querySelector("[data-chart-svg]");
  var plot = root.querySelector("[data-chart-plot]");
  var axis = root.querySelector("[data-chart-axis]");
  var tooltip = root.querySelector("[data-chart-tooltip]");
  var legend = document.querySelector("[data-chart-legend]");
  var pondLabel = document.querySelector("[data-chart-pond-label]");

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var PAD = { top: 16, right: 12, bottom: 12, left: 12 };

  /** Share of the plot height each series band occupies. */
  var BAND_HEIGHT = 0.6;

  var state = {
    pond: "1",
    hidden: {},
    animate: true,
    points: {}
  };

  /* ----------------------------------------------------------------------
     Geometry helpers
     ---------------------------------------------------------------------- */

  function visibleSeries() {
    return DATA.series.filter(function (series) { return !state.hidden[series.key]; });
  }

  /**
   * Maps one series onto the plot box using its own min/max.
   *
   * The three readings share no common unit, so each one also gets its own
   * horizontal band inside the plot. Without that the curves - which follow
   * the same daily rhythm - collapse on top of each other and read as a
   * single ribbon.
   */
  function toPoints(series, box, bandIndex, bandCount) {
    var values = DATA.ponds[state.pond][series.key];
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = max - min || 1;

    // Breathing room so the curves never touch their band edges.
    min -= span * 0.22;
    max += span * 0.22;

    var innerW = box.width - PAD.left - PAD.right;
    var innerH = box.height - PAD.top - PAD.bottom;

    var bandH = bandCount > 1 ? innerH * BAND_HEIGHT : innerH;
    var bandTop = PAD.top + (bandCount > 1
      ? ((innerH - bandH) / (bandCount - 1)) * bandIndex
      : 0);

    var step = values.length > 1 ? innerW / (values.length - 1) : 0;

    return values.map(function (value, index) {
      return {
        x: PAD.left + step * index,
        y: bandTop + bandH - ((value - min) / (max - min)) * bandH,
        value: value
      };
    });
  }

  /** Catmull-Rom -> cubic bezier, with a gentle tension to avoid overshoot. */
  function smoothPath(points) {
    if (!points.length) { return ""; }
    if (points.length < 3) {
      return "M" + points.map(function (p) { return p.x + "," + p.y; }).join("L");
    }

    var tension = 0.82;
    var d = "M" + points[0].x + "," + points[0].y;

    for (var i = 0; i < points.length - 1; i += 1) {
      var p0 = points[i - 1] || points[i];
      var p1 = points[i];
      var p2 = points[i + 1];
      var p3 = points[i + 2] || p2;

      var c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
      var c1y = p1.y + ((p2.y - p0.y) / 6) * tension;
      var c2x = p2.x - ((p3.x - p1.x) / 6) * tension;
      var c2y = p2.y - ((p3.y - p1.y) / 6) * tension;

      d += "C" + c1x + "," + c1y + " " + c2x + "," + c2y + " " + p2.x + "," + p2.y;
    }
    return d;
  }

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function format(series, value) {
    return value.toFixed(series.decimals) + (series.unit ? " " + series.unit : "");
  }

  /* ----------------------------------------------------------------------
     Render
     ---------------------------------------------------------------------- */

  function render() {
    var box = plot.getBoundingClientRect();
    if (!box.width || !box.height) { return; }

    svg.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);
    svg.innerHTML = "";
    state.points = {};

    var defs = el("defs");
    svg.appendChild(defs);

    /* Horizontal gridlines - unlabelled, purely for rhythm. */
    var rows = 4;
    for (var r = 0; r <= rows; r += 1) {
      var y = PAD.top + ((box.height - PAD.top - PAD.bottom) / rows) * r;
      svg.appendChild(el("line", {
        x1: PAD.left, y1: y,
        x2: box.width - PAD.right, y2: y,
        "class": "chart-grid-line" + (r === rows ? " chart-grid-line--base" : "")
      }));
    }

    /* One group per series: area fill, line, endpoint marker. */
    DATA.series.forEach(function (series, bandIndex) {
      var points = toPoints(series, box, bandIndex, DATA.series.length);
      state.points[series.key] = points;

      var group = el("g", {
        "class": "chart-series" + (state.hidden[series.key] ? " chart-series--hidden" : "")
      });

      var gradient = el("linearGradient", {
        id: "grad-" + series.key, x1: "0", y1: "0", x2: "0", y2: "1"
      });
      gradient.appendChild(el("stop", { offset: "0%", "stop-color": series.color, "stop-opacity": "0.32" }));
      gradient.appendChild(el("stop", { offset: "100%", "stop-color": series.color, "stop-opacity": "0" }));
      defs.appendChild(gradient);

      var line = smoothPath(points);
      var floor = box.height - PAD.bottom;

      group.appendChild(el("path", {
        d: line + "L" + points[points.length - 1].x + "," + floor + "L" + points[0].x + "," + floor + "Z",
        fill: "url(#grad-" + series.key + ")",
        "class": "chart-area"
      }));

      var stroke = el("path", { d: line, stroke: series.color, "class": "chart-line" });
      group.appendChild(stroke);

      var last = points[points.length - 1];
      group.appendChild(el("circle", {
        cx: last.x, cy: last.y, r: 4,
        fill: series.color, stroke: "rgba(255,255,255,.85)", "stroke-width": "1.6"
      }));

      svg.appendChild(group);

      if (state.animate && !reduced) {
        var length = stroke.getTotalLength();
        stroke.style.strokeDasharray = length;
        stroke.style.strokeDashoffset = length;
        stroke.style.transition = "stroke-dashoffset 1.15s cubic-bezier(.4,.1,.2,1)";
        requestAnimationFrame(function () { stroke.style.strokeDashoffset = "0"; });
      }
    });

    /* Hover crosshair + dots, added last so they sit on top. */
    var cursor = el("line", {
      "class": "chart-cursor",
      x1: 0, y1: PAD.top, x2: 0, y2: box.height - PAD.bottom,
      opacity: "0"
    });
    svg.appendChild(cursor);

    var markers = el("g", { opacity: "0" });
    DATA.series.forEach(function (series) {
      markers.appendChild(el("circle", {
        r: 5, fill: series.color, stroke: "rgba(255,255,255,.9)", "stroke-width": "2",
        "data-marker": series.key, cx: 0, cy: 0
      }));
    });
    svg.appendChild(markers);

    svg._cursor = cursor;
    svg._markers = markers;

    state.animate = false;
    renderAxis();
    updateLegendValues(DATA.labels.length - 1);
  }

  function renderAxis() {
    if (!axis) { return; }
    axis.innerHTML = "";
    DATA.labels.forEach(function (label) {
      var span = document.createElement("span");
      span.textContent = label;
      axis.appendChild(span);
    });
  }

  function updateLegendValues(index) {
    DATA.series.forEach(function (series) {
      var node = document.querySelector('[data-series-value="' + series.key + '"]');
      var points = state.points[series.key];
      if (node && points && points[index]) {
        node.textContent = format(series, points[index].value);
      }
    });
  }

  /* ----------------------------------------------------------------------
     Hover interaction
     ---------------------------------------------------------------------- */

  function nearestIndex(x, box) {
    var innerW = box.width - PAD.left - PAD.right;
    var step = innerW / (DATA.labels.length - 1);
    var index = Math.round((x - PAD.left) / step);
    return Math.max(0, Math.min(DATA.labels.length - 1, index));
  }

  function showTooltip(index, box) {
    var series = visibleSeries();
    if (!series.length) { return; }

    var rows = series.map(function (item) {
      var point = state.points[item.key][index];
      return '<div class="chart__tooltip-row" style="--series:' + item.color + '">'
        + "<i></i><span>" + item.label + "</span><strong>"
        + format(item, point.value) + "</strong></div>";
    }).join("");

    tooltip.innerHTML = '<p class="chart__tooltip-time">' + DATA.labels[index] + "</p>" + rows;
    tooltip.hidden = false;

    var anchorX = state.points[series[0].key][index].x;
    var topY = Math.min.apply(null, series.map(function (item) {
      return state.points[item.key][index].y;
    }));

    // Keep the card inside the panel near the edges.
    var clampedX = Math.max(80, Math.min(box.width - 80, anchorX));
    tooltip.style.left = clampedX + "px";
    tooltip.style.top = Math.max(38, topY) + "px";

    svg._cursor.setAttribute("x1", anchorX);
    svg._cursor.setAttribute("x2", anchorX);
    svg._cursor.setAttribute("opacity", "1");
    svg._markers.setAttribute("opacity", "1");

    DATA.series.forEach(function (item) {
      var marker = svg._markers.querySelector('[data-marker="' + item.key + '"]');
      var point = state.points[item.key][index];
      marker.setAttribute("cx", point.x);
      marker.setAttribute("cy", point.y);
      marker.setAttribute("opacity", state.hidden[item.key] ? "0" : "1");
    });

    updateLegendValues(index);
  }

  function hideTooltip() {
    tooltip.hidden = true;
    if (svg._cursor) { svg._cursor.setAttribute("opacity", "0"); }
    if (svg._markers) { svg._markers.setAttribute("opacity", "0"); }
    updateLegendValues(DATA.labels.length - 1);
  }

  plot.addEventListener("pointermove", function (event) {
    var box = plot.getBoundingClientRect();
    showTooltip(nearestIndex(event.clientX - box.left, box), box);
  });

  plot.addEventListener("pointerleave", hideTooltip);

  /* ----------------------------------------------------------------------
     Controls
     ---------------------------------------------------------------------- */

  if (legend) {
    legend.addEventListener("click", function (event) {
      var button = event.target.closest("[data-series]");
      if (!button) { return; }

      var key = button.getAttribute("data-series");
      // Never let the reader switch every series off.
      if (!state.hidden[key] && visibleSeries().length === 1) { return; }

      state.hidden[key] = !state.hidden[key];
      button.classList.toggle("is-active", !state.hidden[key]);
      button.setAttribute("aria-pressed", String(!state.hidden[key]));
      render();
    });
  }

  document.addEventListener("click", function (event) {
    var option = event.target.closest("[data-chart-pond]");
    if (!option) { return; }

    state.pond = option.getAttribute("data-chart-pond");
    state.animate = true;

    if (pondLabel) { pondLabel.textContent = option.textContent.trim(); }

    var siblings = option.parentNode.querySelectorAll("[data-chart-pond]");
    Array.prototype.forEach.call(siblings, function (node) {
      node.classList.toggle("is-selected", node === option);
    });

    hideTooltip();
    render();
  });

  /* ----------------------------------------------------------------------
     Boot + resize
     ---------------------------------------------------------------------- */

  function boot() {
    render();
    // Re-render once fonts and layout have settled.
    window.setTimeout(render, 120);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(render, 160);
  });
}());
