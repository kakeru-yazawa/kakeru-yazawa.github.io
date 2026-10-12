// Interactive vowel chart: J-AESOP English vowels of Japanese speakers by L2 proficiency.
// For the selected proficiency, each category shows the learners' mean (its label), the individual speakers
// near that proficiency (dots fading with distance) and an ellipse covering about 68% of them.
// Native English means are shown as black tags.
// Diphthongs (view: "trajectory") are drawn instead as arrows from 20% through 50% to 80% of the vowel.
// Tabs (.vl-tabs [data-set]) switch the data set while keeping the proficiency and settings.
(function () {
  var root = document.querySelector(".vowel-landscape");
  if (!root) return;

  // Categories of each data set, in the order of the category index in the data files.
  // Data: J = learners [proficiency, category, F1 z, F2 z]; E = natives in the same categories [category, F1, F2];
  // N = natives in their own categories (nativeLabels) [category, F1, F2].
  var SETS = {
    vowels: {
      labels: ["iː", "ɪ", "ɛ", "æ", "ʌ", "ɑː", "ɔː", "ʊ", "uː", "ɝ"],
      colors: ["#8e1b2f", "#c2410c", "#b45309", "#4d7c0f", "#0f766e", "#0369a1", "#4338ca", "#6b3d91", "#a21caf", "#6b6870"]
    },
    // Reduced vowels in content words: learners by spelling; natives as ə (AH0) and ɨ (IH0).
    unstressed: {
      labels: ["⟨i⟩", "⟨e⟩", "⟨a⟩", "⟨o⟩", "⟨u⟩"],
      colors: ["#8e1b2f", "#b45309", "#4d7c0f", "#4338ca", "#a21caf"],
      nativeLabels: ["ə", "ɨ"]
    },
    // Rows hold F1 and F2 (z) at 20%, 50% and 80% of the vowel: J [proficiency, category, 6 values], E [category, 6 values]
    diphthongs: {
      view: "trajectory",
      labels: ["eɪ", "aɪ", "aʊ", "oʊ"],
      colors: ["#b45309", "#8e1b2f", "#4d7c0f", "#0369a1"]
    }
  };
  var F2R = [2.4, -2.2], F1R = [-2.0, 2.2];   // front vowels on the left, high vowels at the top
  var BANDWIDTH = 0.6, ELLIPSE = 1.51;          // 1.51 SD covers about 68% of a 2D normal distribution

  var canvas = root.querySelector(".vl-stage canvas"), ctx = canvas.getContext("2d");
  var prof = root.querySelector(".vl-prof"), out = root.querySelector(".vl-prof-value");
  var native = root.querySelector(".vl-native"), status = root.querySelector(".vl-status");
  var toggles = root.querySelector(".vl-vowels");
  var tabs = Array.prototype.slice.call(root.querySelectorAll(".vl-tabs [data-set]"));
  var w = 0, h = 0, cache = {}, ready = false;
  var DATA = null, VIEW = "", LABELS = [], COLORS = [], RGB = [], shown = [], natives = [];

  function weight(r0, p) { return Math.exp(-Math.pow(r0 - p, 2) / (2 * BANDWIDTH * BANDWIDTH)); }
  function rgba(v, a) { return "rgba(" + RGB[v].join(",") + "," + a + ")"; }

  // Weighted mean and covariance of points [weight, F1, F2]
  function spread(pts) {
    var sw = 0, m1 = 0, m2 = 0, s11 = 0, s22 = 0, s12 = 0;
    pts.forEach(function (q) { sw += q[0]; m1 += q[0] * q[1]; m2 += q[0] * q[2]; });
    m1 /= sw; m2 /= sw;
    pts.forEach(function (q) {
      s11 += q[0] * (q[1] - m1) * (q[1] - m1); s22 += q[0] * (q[2] - m2) * (q[2] - m2); s12 += q[0] * (q[1] - m1) * (q[2] - m2);
    });
    return { m1: m1, m2: m2, s11: s11 / sw, s22: s22 / sw, s12: s12 / sw };
  }

  function ellipse(g, sx, sy) {
    var tr = g.s11 + g.s22, det = g.s11 * g.s22 - g.s12 * g.s12, d = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    var l1 = tr / 2 + d, l2 = Math.max(0, tr / 2 - d), a = Math.atan2(l1 - g.s11, g.s12 || 1e-9);
    ctx.beginPath();
    for (var t = 0; t <= 64; t++) {
      var th = t / 64 * Math.PI * 2, u = ELLIPSE * Math.sqrt(l1) * Math.cos(th), v = ELLIPSE * Math.sqrt(l2) * Math.sin(th);
      // (u, v) along the principal axes, rotated back to (F1, F2)
      var f2 = g.m2 + u * Math.cos(a) - v * Math.sin(a), f1 = g.m1 + u * Math.sin(a) + v * Math.cos(a);
      t ? ctx.lineTo(sx(f2), sy(f1)) : ctx.moveTo(sx(f2), sy(f1));
    }
    ctx.closePath();
  }

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function label(text, x, y, color, font) {
    ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  function draw() {
    if (!DATA) return;
    var p = +prof.value;
    out.textContent = p.toFixed(1);
    ctx.clearRect(0, 0, w, h);

    // Same scale on both axes, centered; the top leaves room for the tabs
    var k = Math.min((w - 46) / (F2R[0] - F2R[1]), (h - 80) / (F1R[1] - F1R[0]));
    var left = (w - k * (F2R[0] - F2R[1])) / 2 + 11, top = 46, bottom = top + k * (F1R[1] - F1R[0]), right = left + k * (F2R[0] - F2R[1]);
    var sx = function (f2) { return left + (F2R[0] - f2) * k; };
    var sy = function (f1) { return top + (f1 - F1R[0]) * k; };

    // Axes
    ctx.strokeStyle = "#eeebef"; ctx.lineWidth = 1; ctx.fillStyle = "#6b6870"; ctx.font = "10px system-ui, sans-serif";
    for (var t = -2; t <= 2; t++) {
      ctx.beginPath(); ctx.moveTo(sx(t), top); ctx.lineTo(sx(t), bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(left, sy(t)); ctx.lineTo(right, sy(t)); ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(t, sx(t), bottom + 4);
      ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(t, left - 6, sy(t));
    }
    ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("F2 (z)", (left + right) / 2, bottom + 19);
    ctx.save(); ctx.translate(left - 26, (top + bottom) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "middle"; ctx.fillText("F1 (z)", 0, 0); ctx.restore();

    if (VIEW === "trajectory") return drawTrajectories(p, sx, sy, left, top, right, bottom);

    // Learners near this proficiency: dots, then each category's ellipse and mean
    var groups = LABELS.map(function () { return []; });
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    DATA.J.forEach(function (r) {
      if (!shown[r[1]]) return;
      var wt = weight(r[0], p);
      groups[r[1]].push([wt, r[2], r[3]]);
      if (wt < 0.05) return;
      ctx.fillStyle = rgba(r[1], 0.6 * wt);
      ctx.beginPath(); ctx.arc(sx(r[3]), sy(r[2]), 2.6, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
    var means = [];
    groups.forEach(function (pts, v) {
      if (!shown[v] || !pts.length) return;
      var g = spread(pts);
      ellipse(g, sx, sy);
      ctx.fillStyle = rgba(v, 0.08); ctx.fill();
      ctx.strokeStyle = rgba(v, 0.75); ctx.lineWidth = 1.5; ctx.stroke();
      means.push({ v: v, x: sx(g.m2), y: sy(g.m1) });
    });
    means.forEach(function (m) { label(LABELS[m.v], m.x, m.y, COLORS[m.v], "700 17px system-ui, sans-serif"); });

    // Native English means: black tags on top, independent of the category toggles
    if (native.checked) natives.forEach(function (n) { tag(n.label, sx(n.m[1]), sy(n.m[0])); });
  }

  function tag(text, x, y) {
    ctx.font = "600 13px system-ui, sans-serif";
    var tw = ctx.measureText(text).width + 10, th = 18;
    ctx.fillStyle = "#1c1b1f";
    ctx.beginPath(); ctx.roundRect(x - tw / 2, y - th / 2, tw, th, 4); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y + 1);
  }

  // A smooth curve through three points [F1, F2], with an arrowhead of the given size at the end
  function arrow(pts, sx, sy, color, width, dash, head) {
    var a = [sx(pts[0][1]), sy(pts[0][0])], b = [sx(pts[1][1]), sy(pts[1][0])], c = [sx(pts[2][1]), sy(pts[2][0])];
    var cp = [2 * b[0] - (a[0] + c[0]) / 2, 2 * b[1] - (a[1] + c[1]) / 2];   // control point so the curve passes through b
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(cp[0], cp[1], c[0], c[1]); ctx.stroke(); ctx.setLineDash([]);
    if (!head) return;
    var ang = Math.atan2(c[1] - cp[1], c[0] - cp[0]);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(c[0], c[1]);
    ctx.lineTo(c[0] - head * Math.cos(ang - 0.4), c[1] - head * Math.sin(ang - 0.4));
    ctx.lineTo(c[0] - head * Math.cos(ang + 0.4), c[1] - head * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }

  // Rows' six values (F1, F2 at 20%, 50%, 80%) as three points
  function points(vals) { return [[vals[0], vals[1]], [vals[2], vals[3]], [vals[4], vals[5]]]; }

  function drawTrajectories(p, sx, sy, left, top, right, bottom) {
    // Individual learners near this proficiency: thin arrows, fading with distance from it
    var acc = LABELS.map(function () { return { w: 0, v: [0, 0, 0, 0, 0, 0] }; });
    ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
    DATA.J.forEach(function (r) {
      if (!shown[r[1]]) return;
      var wt = weight(r[0], p), vals = r.slice(2), a = acc[r[1]];
      a.w += wt; vals.forEach(function (x, i) { a.v[i] += wt * x; });
      if (wt > 0.1) arrow(points(vals), sx, sy, rgba(r[1], 0.3 * wt), 1, null, 4);
    });
    ctx.restore();

    // Learners' average trajectory, with the label at the onset
    acc.forEach(function (a, v) {
      if (!shown[v] || !a.w) return;
      var m = points(a.v.map(function (x) { return x / a.w; }));
      arrow(m, sx, sy, "rgba(255,255,255,0.9)", 7, null, 0);
      arrow(m, sx, sy, COLORS[v], 3.5, null, 13);
      ctx.fillStyle = COLORS[v]; ctx.beginPath(); ctx.arc(sx(m[0][1]), sy(m[0][0]), 4.5, 0, Math.PI * 2); ctx.fill();
      label(LABELS[v], sx(m[0][1]), sy(m[0][0]) + 16, COLORS[v], "700 17px system-ui, sans-serif");
    });

    // Native English: dashed black trajectories with a tag at the onset, independent of the toggles
    if (native.checked) {
      natives.forEach(function (n) {
        var m = points(n.m);
        arrow(m, sx, sy, "#1c1b1f", 1.8, [5, 4], 10);
        tag(n.label, sx(m[0][1]), sy(m[0][0]));
      });
    }
  }

  // Mean of the values after the category in the rows ([category, ...values]) of category v
  function average(rows, v) {
    var rs = rows.filter(function (r) { return r[0] === v; });
    return rs[0].slice(1).map(function (_, i) { return rs.reduce(function (s, r) { return s + r[i + 1]; }, 0) / rs.length; });
  }

  // Switch to a data set: its categories, toggle buttons and the native references
  function use(set, data) {
    var def = SETS[set];
    LABELS = def.labels; COLORS = def.colors; DATA = data; VIEW = def.view || "";
    RGB = COLORS.map(function (c) { return [1, 3, 5].map(function (i) { return parseInt(c.substr(i, 2), 16); }); });
    shown = LABELS.map(function () { return true; });

    // Natives have their own categories (nativeLabels, data N) or share the learners' ones (data E)
    var rows = def.nativeLabels ? DATA.N : DATA.E;
    natives = (def.nativeLabels || LABELS).map(function (l, v) {
      return { label: l, m: average(rows, v) };
    });

    // One toggle button per category, then "Show all" and "Hide all" at the right
    toggles.innerHTML = "";
    var buttons = [];
    function setAll(on) {
      shown = shown.map(function () { return on; });
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", on ? "true" : "false"); });
      draw();
    }
    LABELS.forEach(function (l, v) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", "true");
      b.innerHTML = '<i style="background:' + COLORS[v] + '"></i>' + l;
      b.addEventListener("click", function () {
        shown[v] = !shown[v];
        b.setAttribute("aria-pressed", shown[v] ? "true" : "false");
        draw();
      });
      buttons.push(b);
      toggles.appendChild(b);
    });
    var group = document.createElement("span");
    group.className = "vl-all";
    [["Show all", true], ["Hide all", false]].forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = a[0];
      b.addEventListener("click", function () { setAll(a[1]); });
      group.appendChild(b);
    });
    toggles.appendChild(group);
    draw();
  }

  // Data can also be embedded (window.VOWEL_LANDSCAPE_DATA = { vowels: ..., unstressed: ... }), e.g. for offline previews
  function load(tab) {
    var set = tab.dataset.set, embedded = window.VOWEL_LANDSCAPE_DATA;
    if (!cache[set]) {
      cache[set] = embedded && embedded[set]
        ? Promise.resolve(embedded[set])
        : fetch(tab.dataset.src).then(function (res) { return res.json(); });
    }
    status.textContent = "";
    return cache[set].then(function (data) {
      tabs.forEach(function (t) { t.setAttribute("aria-selected", t === tab ? "true" : "false"); });
      if (!ready) { ready = true; resize(); }
      use(set, data);
    }).catch(function () { status.textContent = "The figure could not be loaded."; });
  }

  tabs.forEach(function (tab) { tab.addEventListener("click", function () { load(tab); }); });
  prof.addEventListener("input", draw);
  native.addEventListener("change", draw);
  window.addEventListener("resize", function () { resize(); draw(); });
  load(tabs[0]);
})();
