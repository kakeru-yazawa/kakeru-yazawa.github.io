// Neural-network perception demo: a network trained on CSJ (Japanese) vowels, with the trained weights loaded
// from data/csj-vowel-network.json. Clicking the vowel chart on the left chooses F1 and F2 (speaker-wise z-scores);
// the network hears them as an auditory spectrum, and the panel on the right (input at the bottom, vowels at the
// top) shows every unit's actual value and which vowel is perceived.
// Network: 24 spectrum channels -> 8 tanh -> 8 tanh -> 5 softmax (outputs in the data file's order: a i u e o).
// The code also runs networks with two inputs (F1, F2) or place-coded inputs (NET.place), used in trials.
//
// How the network (data/csj-vowel-network.json) was trained
// ----------------------------------------------------------
// Source: a CSJ export (not in this repository) with one row per vowel token:
//   File (speaker), Gender, Vowel (a i u e o), Start, End, Duration (s), F1, F2 (Hz).
//   566,841 tokens from 201 speakers.
// 1. Per speaker, F1 and F2 are z-scored over all of that speaker's vowels; tokens beyond 3.5 z are dropped.
// 2. Measurement errors: tokens more than 3 robust SDs (1.4826 x MAD) from the median of the same speaker's
//    same vowel, in F1 or F2, are dropped (4.4% of tokens).
// 3. Speakers are split at random (seed 3): 21 for testing, 180 for training. 60,000 training tokens are
//    sampled at random, so the vowels keep their natural frequencies (a > o > e > i > u); 5,000 test tokens
//    are sampled from the test speakers.
// 4. Input: each token's F1 and F2 are turned into an auditory spectrum. z -> Hz for an average CSJ speaker
//    (F1 = 527 + 168 z, F2 = 1627 + 458 z); two resonances (bandwidths 80 and 100 Hz) read through 24 channels
//    spaced evenly on the ERB-rate scale from 100 to 3000 Hz (NET.spectrum.cf), each widened by its ERB;
//    pre-emphasis of 6 dB per octave; dB relative to the peak, 0..1 over 40 dB (function spectrum below).
//    The input holds no more than F1 and F2: networks given F1 and F2 directly, or place-coded, reach the same
//    accuracy, as does a Gaussian classifier on F1 and F2 (81.3%).
// 5. Training: weights start as Gaussian random numbers scaled by 1/sqrt(inputs) (fixed seed 5), biases at 0.
//    Cross-entropy loss, minibatch gradient descent (32 tokens), 30 epochs, learning rate falling linearly
//    from 0.1 to 0.005. Weights and biases are saved rounded to 3 decimals.
//    Accuracy on the test speakers: 81.5% (a 92%, i 72%, u 52%, e 80%, o 87%; u is mostly confused with o and e).
// 6. "tokens" in the file: 1,200 test tokens [F1 z, F2 z, vowel] drawn as the dots on the vowel chart.
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

  var NET = null, TOKENS = null, input = [0.6, 0.4], mapLabels = [];

  // Forward pass; returns every layer's values (inputs, two hidden layers, vowel probabilities)
  // Input layer: F1 and F2 themselves, or, if the network uses place coding (NET.place), each of them on
  // n units with Gaussian tuning curves spread evenly over [min, max] (z)
  function encode(f1, f2) {
    if (NET.spectrum) return spectrum(f1, f2);
    var P = NET.place;
    if (!P) return [f1, f2];
    var code = function (x) {
      return Array.from({ length: P.n }, function (_, k) {
        var c = P.min + (P.max - P.min) * k / (P.n - 1);
        return Math.exp(-(x - c) * (x - c) / (2 * P.sigma * P.sigma));
      });
    };
    return code(f1).concat(code(f2));
  }
  // Synthetic auditory spectrum (NET.spectrum): z -> Hz for an average CSJ speaker; two resonances (F1, F2) read
  // through channels spaced on the ERB-rate scale (NET.spectrum.cf), each smoothed by its ERB; pre-emphasis of
  // NET.spectrum.preemphasis dB per octave (as in speech front ends; the outer ear also boosts higher frequencies);
  // dB relative to the peak, 0..1 over 40 dB
  function spectrum(z1, z2) {
    var F = [527 + 168 * z1, 1627 + 458 * z2], B = [80, 100];
    var db = NET.spectrum.cf.map(function (f) {
      var e = 24.7 * (1 + 0.00437 * f), g = 0;
      F.forEach(function (Fi, i) {
        var b = Math.hypot(B[i], e);
        g += -10 * Math.log10((Math.pow(f * f - Fi * Fi, 2) + Math.pow(f * b, 2)) / Math.pow(Fi, 4));
      });
      return g + (NET.spectrum.preemphasis || 0) * Math.log2(f / 1000);
    });
    var top = Math.max.apply(null, db);
    return db.map(function (d) { return Math.max(0, 1 + (d - top) / 40); });
  }
  function forward(f1, f2) {
    var acts = [encode(f1, f2)];
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

  // ---- network (right), drawn bottom-up: input at the bottom, vowels at the top ----
  var N = null;   // unit positions
  function layoutNet() {
    var size = fit(netCanvas), left = 62, right = size.w - 10, top = 52, bottom = size.h - 40;
    var cols = [NET.layers[0].W[0].length].concat(NET.layers.map(function (L) { return L.b.length; }));
    N = { w: size.w, h: size.h, left: left, units: cols.map(function (n, c) {
      var y = bottom - (bottom - top) * c / (cols.length - 1);
      var slots = n + (c === 0 && NET.place ? 1 : 0);   // a blank slot between F1 and F2
      var gap = Math.min(c === 0 && n > 5 ? 14 : 44, (right - left) / slots), r = Math.min(14, gap / 2 - (c === 0 && n > 5 ? 1 : 3));
      var slot = function (i) {
        if (c === cols.length - 1) return SHOW.indexOf(i);   // vowels left to right as i e a o u
        return c === 0 && NET.place && i >= n / 2 ? i + 1 : i;   // spectrum channels: low frequencies on the left
      };
      var x0 = (left + right) / 2 - (slots - 1) / 2 * gap;
      return Array.from({ length: n }, function (_, i) { return { x: x0 + slot(i) * gap, y: y, r: r, gap: gap }; });
    }) };
  }
  // White -> crimson -> dark crimson for 0..1
  function heat(t) {
    var a = [255, 255, 255], b = POS, d = [60, 8, 18], u = Math.max(0, Math.min(1, t));
    var c = u < 0.7 ? a.map(function (v, k) { return v + (b[k] - v) * u / 0.7; }) : b.map(function (v, k) { return v + (d[k] - v) * (u - 0.7) / 0.3; });
    return "rgb(" + c.map(Math.round).join(",") + ")";
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
          var flow = wi * a[i], mag = Math.min(1, Math.abs(flow) / 2.5);
          nctx.strokeStyle = rgba(flow >= 0 ? POS : NEG, 0.1 + 0.75 * mag);
          nctx.lineWidth = 0.5 + 3.5 * mag;
          nctx.beginPath(); nctx.moveTo(from[i].x, from[i].y); nctx.lineTo(to[j].x, to[j].y); nctx.stroke();
        });
      });
    });
    // Input layer
    var inp = N.units[0], a0 = acts[0];
    if (NET.spectrum) {
      // Spectrum channels as small units; shading stretched to this spectrum's range so the formant peaks stand out
      var lo = Math.min.apply(null, a0), hi = Math.max.apply(null, a0);
      inp.forEach(function (u, i) {
        nctx.beginPath(); nctx.arc(u.x, u.y, u.r, 0, Math.PI * 2);
        nctx.fillStyle = heat(Math.pow((a0[i] - lo) / (hi - lo || 1), 1.3)); nctx.fill();
        nctx.lineWidth = 0.75; nctx.strokeStyle = "rgba(28,27,31,0.4)"; nctx.stroke();
      });
      // Under the units: the direction of the frequency axis
      var yb = inp[0].y + inp[0].r + 6;
      nctx.font = "10px system-ui, sans-serif"; nctx.fillStyle = "#6b6870"; nctx.textBaseline = "top";
      nctx.textAlign = "left"; nctx.fillText("low", inp[0].x - inp[0].r, yb);
      nctx.textAlign = "right"; nctx.fillText("high", inp[inp.length - 1].x + inp[0].r, yb);
      nctx.textAlign = "center"; nctx.fillText("frequency", (inp[0].x + inp[inp.length - 1].x) / 2, yb);
    } else {
      inp.forEach(function (u, i) {
        var v = a0[i], mag = Math.min(1, Math.abs(NET.place ? v : v / 2.5));
        nctx.beginPath(); nctx.arc(u.x, u.y, u.r, 0, Math.PI * 2);
        nctx.fillStyle = NET.place ? heat(v) : "#ffffff"; nctx.fill();
        if (!NET.place) { nctx.fillStyle = rgba(v >= 0 ? POS : NEG, 0.1 + 0.8 * mag); nctx.fill(); }
        nctx.lineWidth = 1; nctx.strokeStyle = "rgba(28,27,31,0.35)"; nctx.stroke();
        if (u.r >= 10) {
          nctx.font = "9px system-ui, sans-serif"; nctx.textAlign = "center"; nctx.textBaseline = "middle";
          nctx.fillStyle = mag > 0.55 ? "#ffffff" : "#1c1b1f"; nctx.fillText(v.toFixed(2), u.x, u.y);
        }
      });
      nctx.font = "600 12px system-ui, sans-serif"; nctx.fillStyle = "#1c1b1f"; nctx.textAlign = "center"; nctx.textBaseline = "top";
      if (NET.place) {
        [0, NET.place.n].forEach(function (s, g) {
          var mid = (inp[s].x + inp[s + NET.place.n - 1].x) / 2;
          nctx.fillText((g ? "F2 " : "F1 ") + input[g].toFixed(2), mid, inp[0].y + 10);
        });
      } else {
        inp.forEach(function (u, i) { nctx.fillText(i ? "F2" : "F1", u.x, u.y + u.r + 4); });
      }
    }
    // Hidden units, with their actual values
    [1, 2].forEach(function (l) {
      N.units[l].forEach(function (u, i) {
        var v = acts[l][i], mag = Math.min(1, Math.abs(v));
        nctx.beginPath(); nctx.arc(u.x, u.y, u.r, 0, Math.PI * 2);
        nctx.fillStyle = "#ffffff"; nctx.fill();
        nctx.fillStyle = rgba(v >= 0 ? POS : NEG, 0.1 + 0.8 * mag); nctx.fill();
        nctx.lineWidth = 1; nctx.strokeStyle = "rgba(28,27,31,0.35)"; nctx.stroke();
        if (u.r >= 10) {
          nctx.font = "9px system-ui, sans-serif"; nctx.textAlign = "center"; nctx.textBaseline = "middle";
          nctx.fillStyle = mag > 0.55 ? "#ffffff" : "#1c1b1f"; nctx.fillText(v.toFixed(2), u.x, u.y);
        }
      });
    });
    // Vowels: probability as fill, label and percentage above
    N.units[3].forEach(function (u, i) {
      var v = acts[3][i], r = u.r + 1;
      nctx.beginPath(); nctx.arc(u.x, u.y, r, 0, Math.PI * 2);
      nctx.fillStyle = rgba(COLORS[i], 0.12 + 0.88 * v); nctx.fill();
      nctx.lineWidth = i === best ? 3 : 1; nctx.strokeStyle = i === best ? "#1c1b1f" : "rgba(28,27,31,0.3)"; nctx.stroke();
      nctx.textAlign = "center"; nctx.textBaseline = "alphabetic";
      nctx.font = (i === best ? "700 " : "") + "12px system-ui, sans-serif"; nctx.fillStyle = "#1c1b1f";
      nctx.fillText(Math.round(100 * v) + "%", u.x, u.y - r - 5);
      nctx.font = (i === best ? "700 " : "") + "16px system-ui, sans-serif"; nctx.fillStyle = rgba(COLORS[i], 1);
      nctx.fillText(LABELS[i], u.x, u.y - r - 21);
    });
    // Layer names on the left
    nctx.font = "11px system-ui, sans-serif"; nctx.fillStyle = "#6b6870"; nctx.textAlign = "left"; nctx.textBaseline = "middle";
    ["Input", "Hidden 1", "Hidden 2", "Output"].forEach(function (t, c) { nctx.fillText(t, 2, N.units[c][0].y); });
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
  // Lay out again whenever the panes change size (including the first time they get a size)
  var pending = false, lastSize = "";
  function relayout() {
    pending = false;
    var a = mapCanvas.getBoundingClientRect(), b = netCanvas.getBoundingClientRect(), key = [a.width, a.height, b.width, b.height].map(Math.round).join();
    if (!NET || a.width < 50 || b.width < 50 || key === lastSize) return;
    lastSize = key;
    drawMapBase(); layoutNet(); drawMap(); drawNet();
  }
  function scheduleLayout() { if (!pending) { pending = true; requestAnimationFrame(relayout); } }
  if (window.ResizeObserver) new ResizeObserver(scheduleLayout).observe(root);
  window.addEventListener("resize", scheduleLayout);

  // Data can also be embedded (window.CSJ_NETWORK), e.g. for offline previews
  (window.CSJ_NETWORK ? Promise.resolve(window.CSJ_NETWORK) : fetch(root.dataset.src).then(function (r) { return r.json(); }))
    .then(function (d) {
      NET = d; TOKENS = d.tokens;
      relayout();
    })
    .catch(function () { root.textContent = "The network could not be loaded."; });
})();
