// Interactive vowel landscape: J-AESOP English vowels of Japanese speakers by L2 proficiency.
// Seen from above it is a vowel chart; tilted, each vowel becomes a hill (a 2D Gaussian scaled to peak at 1).
(function () {
  var root = document.querySelector(".vowel-landscape");
  if (!root) return;

  var LABELS = ["iː", "ɪ", "ɛ", "æ", "ʌ", "ɑː", "ɔː", "ʊ", "uː", "ɝ"];
  var COLORS = ["#8e1b2f", "#c2410c", "#b45309", "#4d7c0f", "#0f766e", "#0369a1", "#4338ca", "#6b3d91", "#a21caf", "#6b6870"];
  var RGB = COLORS.map(function (c) { return [1, 3, 5].map(function (i) { return parseInt(c.substr(i, 2), 16); }); });
  var F2R = [2.6, -2.2], F1R = [-2.0, 2.4];   // front vowels on the left, high vowels at the top
  var NX = 56, NY = 52, BANDWIDTH = 0.6;

  var canvas = root.querySelector("canvas"), ctx = canvas.getContext("2d");
  var prof = root.querySelector(".vl-prof"), out = root.querySelector(".vl-prof-value");
  var native = root.querySelector(".vl-native"), status = root.querySelector(".vl-status");
  var hint = root.querySelector(".vl-hint"), toggles = root.querySelector(".vl-vowels");
  var shown = LABELS.map(function () { return true; });
  var yaw = 0, pitch = 0, w = 0, h = 0;   // start from directly above, like a vowel chart
  var DATA = null, nativeMean = [];

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
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
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
        var tw = ctx.measureText(LABELS[v]).width + 10, th = 18;
        ctx.fillStyle = "#1c1b1f";
        ctx.beginPath(); ctx.roundRect(head.x - tw / 2, head.y - th, tw, th, 4); ctx.fill();
        ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(LABELS[v], head.x, head.y - th / 2 + 1);
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

    var near = DATA.J.filter(function (r) { return r[1] === 0 && Math.abs(r[0] - p) <= BANDWIDTH; }).length;
    status.textContent = near + " Japanese speakers within ±" + BANDWIDTH + " of proficiency " + p.toFixed(1) + ".";
  }

  function start(data) {
    DATA = data;
    nativeMean = LABELS.map(function (_, v) {
      var rows = DATA.E.filter(function (r) { return r[0] === v; });
      return [
        rows.reduce(function (s, r) { return s + r[1]; }, 0) / rows.length,
        rows.reduce(function (s, r) { return s + r[2]; }, 0) / rows.length
      ];
    });

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

    // One toggle button per vowel
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

    prof.addEventListener("input", draw);
    native.addEventListener("change", draw);
    window.addEventListener("resize", function () { resize(); draw(); });
    resize(); draw();
  }

  // Data can also be embedded (window.VOWEL_LANDSCAPE_DATA), e.g. for offline previews
  (window.VOWEL_LANDSCAPE_DATA
    ? Promise.resolve(window.VOWEL_LANDSCAPE_DATA)
    : fetch(root.dataset.src).then(function (res) { return res.json(); }))
    .then(start)
    .catch(function () { status.textContent = "The figure could not be loaded."; });
})();
