// Interactive vowel landscape: J-AESOP English vowels of Japanese speakers by L2 proficiency.
// Seen from above it is a vowel chart; tilted, each category becomes a hill (a 2D Gaussian scaled to peak at 1).
// Optional tabs (.vl-tabs [data-set]) switch the data set while keeping the view, proficiency and pins.
// A data set with view: "means" is shown instead as a flat chart of means and individual speakers (.vl-means).
(function () {
  var root = document.querySelector(".vowel-landscape");
  if (!root) return;

  // Categories of each data set, in the order of the category index in the data files
  var SETS = {
    vowels: {
      labels: ["iː", "ɪ", "ɛ", "æ", "ʌ", "ɑː", "ɔː", "ʊ", "uː", "ɝ"],
      colors: ["#8e1b2f", "#c2410c", "#b45309", "#4d7c0f", "#0f766e", "#0369a1", "#4338ca", "#6b3d91", "#a21caf", "#6b6870"]
    },
    // Reduced vowels in content words: learners by spelling (data J), natives as ə (AH0) and ɨ (IH0) (data N).
    // Values are relative to each speaker's stressed-vowel centroid, so (0, 0) is the center of their vowel space.
    unstressed: {
      view: "means",
      labels: ["⟨i⟩", "⟨e⟩", "⟨a⟩", "⟨o⟩", "⟨u⟩"],
      colors: ["#8e1b2f", "#b45309", "#4d7c0f", "#4338ca", "#a21caf"],
      nativeLabels: ["ə", "ɨ"]
    }
  };
  var LABELS, COLORS, RGB;
  var F2R = [2.6, -2.2], F1R = [-2.0, 2.4];   // front vowels on the left, high vowels at the top
  var NX = 84, NY = 78, BANDWIDTH = 0.6;

  var canvas = root.querySelector(".vl-stage > canvas"), ctx = canvas.getContext("2d");
  var meansEl = root.querySelector(".vl-means");
  var prof = root.querySelector(".vl-prof"), out = root.querySelector(".vl-prof-value");
  var native = root.querySelector(".vl-native"), status = root.querySelector(".vl-status");
  var hint = root.querySelector(".vl-hint"), toggles = root.querySelector(".vl-vowels");
  // Without tabs, the figure itself names its data set (data-set, data-src)
  var tabs = Array.prototype.slice.call(root.querySelectorAll(".vl-tabs [data-set]"));
  if (!tabs.length) tabs = [root];
  var shown = [];
  var yaw = 0, pitch = 0.26, w = 0, h = 0;   // start almost from above (about 15°), like a vowel chart
  var DATA = null, nativeMean = [], VIEW = "3d", cache = {}, ready = false;

  // Weighted mean and covariance of each vowel for speakers near proficiency p
  function fit(p) {
    var acc = LABELS.map(function () { return { w: 0, m1: 0, m2: 0, rows: [] }; });
    DATA.J.forEach(function (r) {
      var wgt = Math.exp(-Math.pow(r[0] - p, 2) / (2 * BANDWIDTH * BANDWIDTH));
      var a = acc[r[1]];
      a.w += wgt; a.m1 += wgt * r[2]; a.m2 += wgt * r[3]; a.rows.push([wgt, r[2], r[3]]);
    });
    return acc.map(function (a) {
      var m1 = a.m1 / a.w, m2 = a.m2 / a.w, s11 = 0, s22 = 0, s12 = 0;
      a.rows.forEach(function (q) {
        s11 += q[0] * (q[1] - m1) * (q[1] - m1);
        s22 += q[0] * (q[2] - m2) * (q[2] - m2);
        s12 += q[0] * (q[1] - m1) * (q[2] - m2);
      });
      s11 = s11 / a.w + 0.01; s22 = s22 / a.w + 0.01; s12 /= a.w;
      var det = s11 * s22 - s12 * s12;
      return { m1: m1, m2: m2, i11: s22 / det, i22: s11 / det, i12: -s12 / det };
    });
  }

  // Each vowel's Gaussian scaled to peak at 1, so heights do not depend on how spread out a vowel is
  function density(g, f1, f2) {
    var d1 = f1 - g.m1, d2 = f2 - g.m2;
    return Math.exp(-0.5 * (g.i11 * d1 * d1 + 2 * g.i12 * d1 * d2 + g.i22 * d2 * d2));
  }

  // Height of the surface at a point: the most likely vowel there (only vowels that are shown)
  function heightAt(gs, f1, f2) {
    return gs.reduce(function (acc, g, v) { return shown[v] ? Math.max(acc, density(g, f1, f2)) : acc; }, 0);
  }

  function surface(p) {
    var gs = fit(p), grid = [];
    for (var j = 0; j <= NY; j++) {
      var row = [];
      for (var i = 0; i <= NX; i++) {
        var f2 = F2R[0] + (F2R[1] - F2R[0]) * i / NX, f1 = F1R[0] + (F1R[1] - F1R[0]) * j / NY;
        var best = 0, bestV = 0;
        for (var v = 0; v < gs.length; v++) {
          if (!shown[v]) continue;
          var d = density(gs[v], f1, f2);
          if (d > best) { best = d; bestV = v; }
        }
        row.push({ f1: f1, f2: f2, z: best, v: bestV });
      }
      grid.push(row);
    }
    return { grid: grid, gs: gs };
  }

  // World coordinates: x = F2, y = F1 (depth), z = height (up)
  function world(f1, f2, z) {
    return [
      2 * (F2R[0] - f2) / (F2R[0] - F2R[1]) - 1,
      2 * (f1 - F1R[0]) / (F1R[1] - F1R[0]) - 1,
      z * 0.8
    ];
  }

  function project(q) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var x1 = q[0] * cy - q[1] * sy, y1 = q[0] * sy + q[1] * cy;   // turn around the vertical axis
    var y2 = y1 * cp - q[2] * sp, d = y1 * sp + q[2] * cp;          // tilt toward the viewer
    var scale = Math.min(w * 0.4, h * 0.46);
    return { x: w / 2 + x1 * scale, y: h / 2 + y2 * scale * 0.8 + 20 * sp, depth: d };
  }

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function line(a, b, color) {
    var p = project(a), q = project(b);
    ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }

  function text(s, q, size) {
    var p = project(q);
    ctx.fillStyle = "#6b6870"; ctx.font = size + "px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(s, p.x, p.y);
  }

  function draw() {
    if (!DATA) return;
    if (VIEW === "means") return drawMeans();
    var p = +prof.value;
    out.textContent = p.toFixed(1);
    ctx.clearRect(0, 0, w, h);
    var s = surface(p), grid = s.grid;

    // Floor grid and axis labels
    ctx.lineWidth = 1;
    for (var t = -2; t <= 2; t++) {
      line(world(F1R[0], t, 0), world(F1R[1], t, 0), "#eeebef");
      line(world(t, F2R[0], 0), world(t, F2R[1], 0), "#eeebef");
      text(t, world(F1R[1] + 0.25, t, 0), 10);
      text(t, world(t, F2R[1] - 0.25, 0), 10);
    }
    text("F2 (z)", world(F1R[1] + 0.55, 0.2, 0), 12);
    text("F1 (z)", world(F1R[0] - 0.4, F2R[1] - 0.25, 0), 12);

    // Surface quads, far to near
    var quads = [];
    for (var j = 0; j < NY; j++) {
      for (var i = 0; i < NX; i++) {
        var c = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
        var zAvg = (c[0].z + c[1].z + c[2].z + c[3].z) / 4;
        if (zAvg < 0.02) continue;   // skip the flat floor so the grid shows through
        var pts = c.map(function (k) { return project(world(k.f1, k.f2, k.z)); });
        var depth = (pts[0].depth + pts[1].depth + pts[2].depth + pts[3].depth) / 4;
        var slope = (c[1].z + c[2].z - c[0].z - c[3].z) * 6;   // simple shading from the slope along F2
        quads.push({ pts: pts, depth: depth, v: c[0].v, z: zAvg, shade: slope });
      }
    }
    quads.sort(function (a, b) { return a.depth - b.depth; });
    quads.forEach(function (q) {
      var light = 0.55 + 0.35 * (1 - Math.min(1, q.z)) + Math.max(-0.15, Math.min(0.15, q.shade));
      var col = RGB[q.v].map(function (ch) { return Math.round(ch + (255 - ch) * Math.max(0, Math.min(1, light - 0.25))); });
      ctx.fillStyle = "rgb(" + col.join(",") + ")";
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(q.pts[0].x, q.pts[0].y);
      for (var k = 1; k < 4; k++) ctx.lineTo(q.pts[k].x, q.pts[k].y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    });

    // Native English means: black pins at a fixed height, drawn on top so they are never buried
    if (native.checked) {
      nativeMean.forEach(function (m, v) {
        if (!shown[v]) return;
        var foot = project(world(m[0], m[1], 0)), head = project(world(m[0], m[1], 1.12));
        ctx.strokeStyle = "#1c1b1f"; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(foot.x, foot.y); ctx.lineTo(head.x, head.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "600 13px system-ui, sans-serif";
        var tag = LABELS[v], tw = ctx.measureText(tag).width + 10, th = 18;
        ctx.fillStyle = "#1c1b1f";
        ctx.beginPath(); ctx.roundRect(head.x - tw / 2, head.y - th, tw, th, 4); ctx.fill();
        ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(tag, head.x, head.y - th / 2 + 1);
      });
    }

    // Learners' vowel labels above each peak, in the vowel's color
    s.gs.forEach(function (g, v) {
      if (!shown[v]) return;
      var c = project(world(g.m1, g.m2, heightAt(s.gs, g.m1, g.m2)));
      ctx.font = "700 16px system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeText(LABELS[v], c.x, c.y - 6);
      ctx.fillStyle = COLORS[v];
      ctx.fillText(LABELS[v], c.x, c.y - 6);
    });
  }

  // Mean F1 and F2 of the rows ([category, F1, F2]) in category v
  function average(rows, v) {
    var rs = rows.filter(function (r) { return r[0] === v; });
    return [1, 2].map(function (k) { return rs.reduce(function (s, r) { return s + r[k]; }, 0) / rs.length; });
  }

  // ---------- Flat chart of means (view: "means") ----------

  var MAP = { c: meansEl && meansEl.querySelector("canvas") };
  var natTags = [];
  var MF2 = [2.4, -2.2], MF1 = [-2.0, 2.2];

  function weight(r0, p) { return Math.exp(-Math.pow(r0 - p, 2) / (2 * BANDWIDTH * BANDWIDTH)); }

  // Learners' weighted mean of category v at proficiency p
  function meanAt(v, p) {
    var w = 0, a = 0, b = 0;
    DATA.J.forEach(function (r) {
      if (r[1] !== v) return;
      var k = weight(r[0], p); w += k; a += k * r[2]; b += k * r[3];
    });
    return [a / w, b / w];
  }

  function useMeans(def) {
    natTags = def.nativeLabels.map(function (label, v) { return { label: label, m: average(DATA.N, v) }; });
    resizeMeans();
  }

  function resizeMeans() {
    var dpr = window.devicePixelRatio || 1;
    MAP.w = MAP.c.clientWidth; MAP.h = MAP.c.clientHeight;
    MAP.c.width = MAP.w * dpr; MAP.c.height = MAP.h * dpr;
    MAP.ctx = MAP.c.getContext("2d"); MAP.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rgba(v, a) { return "rgba(" + RGB[v].join(",") + "," + a + ")"; }

  function drawMeans() {
    var p = +prof.value;
    out.textContent = p.toFixed(1);
    drawMap(p);
  }

  function drawMap(p) {
    var c = MAP.ctx, w = MAP.w, h = MAP.h;
    // Same scale on both axes, centered; the top leaves room for the tabs
    var k = Math.min((w - 46) / (MF2[0] - MF2[1]), (h - 80) / (MF1[1] - MF1[0]));
    var pw = k * (MF2[0] - MF2[1]), ph = k * (MF1[1] - MF1[0]);
    var pad = { l: (w - pw) / 2 + 11, t: 46 }; pad.r = w - pad.l - pw; pad.b = h - pad.t - ph;
    var sx = function (f2) { return pad.l + (MF2[0] - f2) * k; };
    var sy = function (f1) { return pad.t + (f1 - MF1[0]) * k; };
    c.clearRect(0, 0, w, h);
    c.strokeStyle = "#eeebef"; c.lineWidth = 1; c.fillStyle = "#6b6870"; c.font = "10px system-ui, sans-serif";
    for (var t = -2; t <= 2; t++) {
      c.beginPath(); c.moveTo(sx(t), pad.t); c.lineTo(sx(t), h - pad.b); c.stroke();
      c.beginPath(); c.moveTo(pad.l, sy(t)); c.lineTo(w - pad.r, sy(t)); c.stroke();
      c.textAlign = "center"; c.textBaseline = "top"; c.fillText(t, sx(t), h - pad.b + 4);
      c.textAlign = "right"; c.textBaseline = "middle"; c.fillText(t, pad.l - 6, sy(t));
    }
    c.font = "12px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "top";
    c.fillText("F2 (z)", (pad.l + w - pad.r) / 2, h - pad.b + 19);
    c.save(); c.translate(pad.l - 26, (pad.t + h - pad.b) / 2); c.rotate(-Math.PI / 2); c.textBaseline = "middle"; c.fillText("F1 (z)", 0, 0); c.restore();

    // Center of the vowel space (each speaker's stressed-vowel centroid)
    c.strokeStyle = "#9b97a0"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(sx(0) - 6, sy(0)); c.lineTo(sx(0) + 6, sy(0)); c.moveTo(sx(0), sy(0) - 6); c.lineTo(sx(0), sy(0) + 6); c.stroke();

    // Individual learners, fading with distance from the selected proficiency
    c.save(); c.beginPath(); c.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b); c.clip();
    DATA.J.forEach(function (r) {
      if (!shown[r[1]]) return;
      var k = weight(r[0], p);
      if (k < 0.05) return;
      c.fillStyle = rgba(r[1], 0.6 * k);
      c.beginPath(); c.arc(sx(r[3]), sy(r[2]), 2.6, 0, Math.PI * 2); c.fill();
    });
    c.restore();

    // Native English means: black tags
    if (native.checked) {
      natTags.forEach(function (n) {
        var x = sx(n.m[1]), y = sy(n.m[0]);
        c.font = "600 13px system-ui, sans-serif";
        var tw = c.measureText(n.label).width + 10, th = 18;
        c.fillStyle = "#1c1b1f";
        c.beginPath(); c.roundRect(x - tw / 2, y - th / 2, tw, th, 4); c.fill();
        c.fillStyle = "#ffffff"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(n.label, x, y + 1);
      });
    }

    // Learners' means: the label itself marks the spot
    c.font = "700 17px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    LABELS.forEach(function (label, v) {
      if (!shown[v]) return;
      var m = meanAt(v, p), x = sx(m[1]), y = sy(m[0]);
      c.lineWidth = 4; c.lineJoin = "round"; c.strokeStyle = "rgba(255,255,255,0.95)"; c.strokeText(label, x, y);
      c.fillStyle = COLORS[v]; c.fillText(label, x, y);
    });
  }

  // Switch to a data set: its categories, toggle buttons and the native means
  function use(set, data) {
    LABELS = SETS[set].labels; COLORS = SETS[set].colors;
    RGB = COLORS.map(function (c) { return [1, 3, 5].map(function (i) { return parseInt(c.substr(i, 2), 16); }); });
    DATA = data;
    shown = LABELS.map(function () { return true; });
    nativeMean = DATA.E ? LABELS.map(function (_, v) { return average(DATA.E, v); }) : [];

    // Show the 3D landscape or the flat chart of means
    VIEW = SETS[set].view || "3d";
    canvas.hidden = VIEW === "means";
    if (hint) hint.hidden = VIEW === "means";
    if (meansEl) {
      meansEl.hidden = VIEW !== "means";
      if (VIEW === "means") useMeans(SETS[set]);
    }
    if (VIEW === "3d" && ready) resize();   // the canvas may have been resized while hidden

    // One toggle button per category
    toggles.innerHTML = "";
    LABELS.forEach(function (label, v) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", "true");
      b.innerHTML = '<i style="background:' + COLORS[v] + '"></i>' + label;
      b.addEventListener("click", function () {
        shown[v] = !shown[v];
        b.setAttribute("aria-pressed", shown[v] ? "true" : "false");
        draw();
      });
      toggles.appendChild(b);
    });
    draw();
  }

  // Data can also be embedded (window.VOWEL_LANDSCAPE_DATA = { vowels: ... }), e.g. for offline previews
  function load(tab) {
    var set = tab.dataset.set, embedded = window.VOWEL_LANDSCAPE_DATA;
    if (!cache[set]) {
      cache[set] = embedded && embedded[set]
        ? Promise.resolve(embedded[set])
        : fetch(tab.dataset.src).then(function (res) { return res.json(); });
    }
    status.textContent = "";
    return cache[set].then(function (data) {
      if (tab !== root) tabs.forEach(function (t) { t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
      use(set, data);
      if (!ready) { ready = true; start(); }
    }).catch(function () { status.textContent = "The figure could not be loaded."; });
  }

  function start() {
    // Drag to tilt and rotate
    var dragging = false, lastX = 0, lastY = 0;
    canvas.addEventListener("pointerdown", function (e) {
      dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId);
      hint.classList.add("is-hidden");
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      yaw += (e.clientX - lastX) * 0.01;
      pitch = Math.max(0, Math.min(1.45, pitch + (e.clientY - lastY) * 0.01));
      lastX = e.clientX; lastY = e.clientY;
      draw();
    });
    canvas.addEventListener("pointerup", function () { dragging = false; });

    prof.addEventListener("input", draw);
    native.addEventListener("change", draw);
    window.addEventListener("resize", function () { resize(); if (VIEW === "means") resizeMeans(); draw(); });
    resize(); draw();
  }

  tabs.forEach(function (tab) { if (tab !== root) tab.addEventListener("click", function () { load(tab); }); });
  load(tabs[0]);
})();
