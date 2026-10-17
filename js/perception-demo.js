// Neural-network perception demo: a network trained on CSJ (Japanese) vowels, with the trained weights loaded
// from data/csj-vowel-network.json. Clicking the vowel chart on the left sets the input (F1, F2 as speaker-wise
// z-scores); the network on the right shows every unit's actual value and which vowel is perceived.
// Network: 2 inputs -> 8 tanh -> 8 tanh -> 5 softmax (outputs in the data file's order: a i u e o).
(function () {
  var root = document.querySelector(".nn-demo");
  if (!root) return;

  var LABELS = ["a", "i", "u", "e", "o"];
  var COLORS = [[194, 65, 12], [142, 27, 47], [67, 56, 202], [77, 124, 15], [3, 105, 161]];
  var SHOW = [1, 3, 0, 4, 2];   // output units listed as i e a o u
  var POS = [142, 23, 41], NEG = [3, 105, 161];   // positive and negative values (units and connections)
  var F2R = [2, -2], F1R = [-2, 2];               // front vowels on the left, high vowels at the top
  var GRID = 72;

  var mapCanvas = root.querySelector(".nn-map"), mctx = mapCanvas.getContext("2d");
  var netCanvas = root.querySelector(".nn-net"), nctx = netCanvas.getContext("2d");
  var grid = document.createElement("canvas"), gctx = grid.getContext("2d");
  grid.width = grid.height = GRID;

  var NET = null, TOKENS = null, input = [0.6, 0.4], hoverUnit = null, mapLabels = [];

  // Forward pass; returns every layer's values (inputs, two hidden layers, vowel probabilities)
  function forward(f1, f2) {
    var acts = [[f1, f2]];
    NET.layers.forEach(function (L, l) {
      var a = acts[acts.length - 1];
      var z = L.W.map(function (w, j) { return w.reduce(function (s, wi, i) { return s + wi * a[i]; }, L.b[j]); });
      if (l < NET.layers.length - 1) z = z.map(Math.tanh);
      else {
        var m = Math.max.apply(null, z), e = z.map(function (v) { return Math.exp(v - m); }), s = e.reduce(function (p, q) { return p + q; });
        z = e.map(function (v) { return v / s; });
      }
      acts.push(z);
    });
    return acts;
  }
  function argmax(p) { var b = 0; for (var i = 1; i < p.length; i++) if (p[i] > p[b]) b = i; return b; }
  function rgba(c, a) { return "rgba(" + c.join(",") + "," + a + ")"; }

  function fit(canvas) {
    var r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: r.width, h: r.height };
  }

  // ---- vowel chart (left) ----
  var M = null;   // map geometry
  function drawMapBase() {
    var size = fit(mapCanvas), k = Math.min((size.w - 40) / (F2R[0] - F2R[1]), (size.h - 40) / (F1R[1] - F1R[0]));
    var left = (size.w - k * (F2R[0] - F2R[1])) / 2 + 10, top = 8;
    M = { w: size.w, h: size.h, k: k, left: left, top: top, right: left + k * (F2R[0] - F2R[1]), bottom: top + k * (F1R[1] - F1R[0]) };
    M.sx = function (f2) { return M.left + (F2R[0] - f2) * M.k; };
    M.sy = function (f1) { return M.top + (f1 - F1R[0]) * M.k; };
    // The network's answer at every point, its vowels' colors mixed by probability and lightened
    var img = gctx.createImageData(GRID, GRID);
    for (var gy = 0; gy < GRID; gy++) for (var gx = 0; gx < GRID; gx++) {
      var f2 = F2R[0] + (F2R[1] - F2R[0]) * (gx + 0.5) / GRID, f1 = F1R[0] + (F1R[1] - F1R[0]) * (gy + 0.5) / GRID;
      var p = forward(f1, f2)[3], c = [0, 0, 0], o = 4 * (gy * GRID + gx);
      p.forEach(function (pv, v) { for (var ch = 0; ch < 3; ch++) c[ch] += pv * COLORS[v][ch]; });
      for (var ch = 0; ch < 3; ch++) img.data[o + ch] = 255 - 0.4 * (255 - c[ch]);
      img.data[o + 3] = 255;
    }
    gctx.putImageData(img, 0, 0);
    // Labels at the mean of each vowel's CSJ tokens
    var m = LABELS.map(function () { return [0, 0, 0]; });
    for (var i = 0; i < TOKENS.length; i += 3) { var t = m[TOKENS[i + 2]]; t[0] += TOKENS[i]; t[1] += TOKENS[i + 1]; t[2]++; }
    mapLabels = m.map(function (t) { return t[2] ? [t[0] / t[2], t[1] / t[2]] : null; });
  }
  function drawMap() {
    if (!M) return;
    mctx.clearRect(0, 0, M.w, M.h);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(grid, M.left, M.top, M.right - M.left, M.bottom - M.top);
    mctx.strokeStyle = "rgba(28,27,31,0.1)"; mctx.lineWidth = 1; mctx.fillStyle = "#6b6870"; mctx.font = "10px system-ui, sans-serif";
    for (var t = -2; t <= 2; t++) {
      mctx.beginPath(); mctx.moveTo(M.sx(t), M.top); mctx.lineTo(M.sx(t), M.bottom); mctx.stroke();
      mctx.beginPath(); mctx.moveTo(M.left, M.sy(t)); mctx.lineTo(M.right, M.sy(t)); mctx.stroke();
      mctx.textAlign = "center"; mctx.textBaseline = "top"; mctx.fillText(t, M.sx(t), M.bottom + 3);
      mctx.textAlign = "right"; mctx.textBaseline = "middle"; mctx.fillText(t, M.left - 5, M.sy(t));
    }
    mctx.font = "11px system-ui, sans-serif"; mctx.textAlign = "center"; mctx.textBaseline = "top";
    mctx.fillText("F2 (z)", (M.left + M.right) / 2, M.bottom + 16);
    mctx.save(); mctx.translate(M.left - 24, (M.top + M.bottom) / 2); mctx.rotate(-Math.PI / 2); mctx.textBaseline = "middle"; mctx.fillText("F1 (z)", 0, 0); mctx.restore();
    // CSJ vowels from speakers not used in training, colored by the vowel spoken
    mctx.save(); mctx.beginPath(); mctx.rect(M.left, M.top, M.right - M.left, M.bottom - M.top); mctx.clip();
    for (var i = 0; i < TOKENS.length; i += 3) {
      mctx.fillStyle = rgba(COLORS[TOKENS[i + 2]], 0.55);
      mctx.beginPath(); mctx.arc(M.sx(TOKENS[i + 1]), M.sy(TOKENS[i]), 1.5, 0, Math.PI * 2); mctx.fill();
    }
    mctx.restore();
    mctx.font = "700 18px system-ui, sans-serif"; mctx.textAlign = "center"; mctx.textBaseline = "middle";
    mapLabels.forEach(function (c, v) {
      if (!c) return;
      var x = M.sx(c[1]), y = M.sy(c[0]);
      mctx.lineWidth = 4; mctx.strokeStyle = "rgba(255,255,255,0.9)"; mctx.strokeText(LABELS[v], x, y);
      mctx.fillStyle = rgba(COLORS[v], 1); mctx.fillText(LABELS[v], x, y);
    });
    mctx.strokeStyle = "rgba(28,27,31,0.25)"; mctx.strokeRect(M.left, M.top, M.right - M.left, M.bottom - M.top);
    // The selected point
    var px = M.sx(input[1]), py = M.sy(input[0]);
    mctx.strokeStyle = "#1c1b1f"; mctx.lineWidth = 1;
    mctx.setLineDash([3, 3]);
    mctx.beginPath(); mctx.moveTo(px, M.top); mctx.lineTo(px, M.bottom); mctx.moveTo(M.left, py); mctx.lineTo(M.right, py); mctx.stroke();
    mctx.setLineDash([]);
    mctx.fillStyle = "#ffffff"; mctx.lineWidth = 2.5;
    mctx.beginPath(); mctx.arc(px, py, 6.5, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
  }

  // ---- network (right) ----
  var N = null;   // unit positions
  function layoutNet() {
    var size = fit(netCanvas), cols = [2, 8, 8, 5], x0 = 52, x1 = size.w - 92;
    N = { w: size.w, h: size.h, units: cols.map(function (n, c) {
      var x = x0 + (x1 - x0) * c / (cols.length - 1), gap = Math.min(36, (size.h - 30) / n);
      var row = function (i) { return c === cols.length - 1 ? SHOW.indexOf(i) : i; };   // vowels top to bottom as i e a o u
      return Array.from({ length: n }, function (_, i) { return { x: x, y: size.h / 2 + (row(i) - (n - 1) / 2) * gap }; });
    }), r: Math.min(14, (size.h - 30) / 8 / 2 - 2) };
  }
  function drawNet() {
    if (!N) return;
    var acts = forward(input[0], input[1]), best = argmax(acts[3]);
    nctx.clearRect(0, 0, N.w, N.h);
    // Connections: color by the sign of weight x incoming value, width by its size (what flows for this input)
    NET.layers.forEach(function (L, l) {
      var from = N.units[l], to = N.units[l + 1], a = acts[l];
      L.W.forEach(function (w, j) {
        w.forEach(function (wi, i) {
          var focus = hoverUnit && ((hoverUnit[0] === l + 1 && hoverUnit[1] === j) || (hoverUnit[0] === l && hoverUnit[1] === i));
          if (hoverUnit && !focus) return;
          var flow = wi * a[i], mag = Math.min(1, Math.abs(flow) / 2.5);
          nctx.strokeStyle = rgba(flow >= 0 ? POS : NEG, 0.12 + 0.75 * mag);
          nctx.lineWidth = 0.6 + 3.4 * mag;
          nctx.beginPath(); nctx.moveTo(from[i].x, from[i].y); nctx.lineTo(to[j].x, to[j].y); nctx.stroke();
          if (focus) {   // the weight itself, on the connection
            var mx = from[i].x + (to[j].x - from[i].x) * (hoverUnit[0] === l + 1 ? 0.3 : 0.7), my = from[i].y + (to[j].y - from[i].y) * (hoverUnit[0] === l + 1 ? 0.3 : 0.7);
            nctx.font = "10px system-ui, sans-serif"; nctx.textAlign = "center"; nctx.textBaseline = "middle";
            var t = wi.toFixed(2), tw = nctx.measureText(t).width + 6;
            nctx.fillStyle = "rgba(255,255,255,0.92)"; nctx.fillRect(mx - tw / 2, my - 7, tw, 14);
            nctx.fillStyle = rgba(wi >= 0 ? POS : NEG, 1); nctx.fillText(t, mx, my);
          }
        });
      });
    });
    // Units, with their actual values
    N.units.forEach(function (col, l) {
      col.forEach(function (u, i) {
        var v = acts[l][i], r = l === 3 ? N.r + 1 : N.r;
        nctx.beginPath(); nctx.arc(u.x, u.y, r, 0, Math.PI * 2);
        if (l === 3) {
          nctx.fillStyle = rgba(COLORS[i], 0.12 + 0.88 * v); nctx.fill();
          nctx.lineWidth = i === best ? 3 : 1; nctx.strokeStyle = i === best ? "#1c1b1f" : "rgba(28,27,31,0.3)"; nctx.stroke();
          nctx.font = (i === best ? "700 " : "") + "15px system-ui, sans-serif"; nctx.textAlign = "left"; nctx.textBaseline = "middle";
          nctx.fillStyle = rgba(COLORS[i], 1); nctx.fillText(LABELS[i], u.x + r + 8, u.y);
          nctx.font = (i === best ? "700 " : "") + "12px system-ui, sans-serif"; nctx.fillStyle = "#1c1b1f";
          nctx.fillText(Math.round(100 * v) + "%", u.x + r + 28, u.y);
        } else {
          var c = v >= 0 ? POS : NEG, mag = Math.min(1, Math.abs(l === 0 ? v / 2.5 : v));
          nctx.fillStyle = "#ffffff"; nctx.fill();
          nctx.fillStyle = rgba(c, 0.1 + 0.8 * mag); nctx.fill();
          nctx.lineWidth = hoverUnit && hoverUnit[0] === l && hoverUnit[1] === i ? 2.5 : 1; nctx.strokeStyle = "rgba(28,27,31,0.35)"; nctx.stroke();
          nctx.font = "9px system-ui, sans-serif"; nctx.textAlign = "center"; nctx.textBaseline = "middle";
          nctx.fillStyle = mag > 0.55 ? "#ffffff" : "#1c1b1f";
          nctx.fillText(v.toFixed(2), u.x, u.y);
          if (l === 0) {
            nctx.font = "600 12px system-ui, sans-serif"; nctx.textAlign = "right"; nctx.fillStyle = "#1c1b1f";
            nctx.fillText(i === 0 ? "F1" : "F2", u.x - r - 6, u.y);
          }
        }
      });
    });
    // Column titles
    nctx.font = "11px system-ui, sans-serif"; nctx.fillStyle = "#6b6870"; nctx.textAlign = "center"; nctx.textBaseline = "top";
    ["Input", "Hidden 1", "Hidden 2", "Vowel"].forEach(function (t, c) { nctx.fillText(t, N.units[c][0].x, 2); });
  }

  // ---- interaction ----
  function setFromMap(e) {
    var r = mapCanvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    x = Math.max(M.left, Math.min(M.right, x)); y = Math.max(M.top, Math.min(M.bottom, y));
    input = [F1R[0] + (y - M.top) / M.k, F2R[0] - (x - M.left) / M.k];
    drawMap(); drawNet();
  }
  var dragging = false;
  mapCanvas.addEventListener("pointerdown", function (e) { dragging = true; mapCanvas.setPointerCapture(e.pointerId); setFromMap(e); });
  mapCanvas.addEventListener("pointermove", function (e) { if (dragging) setFromMap(e); });
  mapCanvas.addEventListener("pointerup", function () { dragging = false; });
  netCanvas.addEventListener("pointermove", function (e) {
    var r = netCanvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hit = null;
    N.units.forEach(function (col, l) { col.forEach(function (u, i) { if (Math.hypot(u.x - x, u.y - y) <= N.r + 3) hit = [l, i]; }); });
    if (String(hit) !== String(hoverUnit)) { hoverUnit = hit; drawNet(); }
  });
  netCanvas.addEventListener("pointerleave", function () { hoverUnit = null; drawNet(); });
  window.addEventListener("resize", function () { drawMapBase(); layoutNet(); drawMap(); drawNet(); });

  // Data can also be embedded (window.CSJ_NETWORK), e.g. for offline previews
  (window.CSJ_NETWORK ? Promise.resolve(window.CSJ_NETWORK) : fetch(root.dataset.src).then(function (r) { return r.json(); }))
    .then(function (d) {
      NET = d; TOKENS = d.tokens;
      drawMapBase(); layoutNet(); drawMap(); drawNet();
    })
    .catch(function () { root.textContent = "The network could not be loaded."; });
})();
