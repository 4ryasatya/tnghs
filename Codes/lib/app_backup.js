(function () {
  var $ = function (id) { return document.getElementById(id); };
  var LAGS = [0, 1, 2, 3];
  var MN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  var rows = [], units = [], byUnit = {}, spiCols = [], dates = [], stats = {};
  var map, geoLayer, legendEl, idKey = "unit_id";

  var css = function (v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); };
  var fmt = function (x, d) { d = d == null ? 2 : d; return isFinite(x) ? x.toLocaleString("id-ID", {minimumFractionDigits: d, maximumFractionDigits: d}) : "–"; };
  var num = function (v) { return v === "" || v == null ? NaN : +String(v).replace(",", "."); };
  var dateStr = function (t) { var y = Math.floor(t / 12), m = t % 12; return y + "-" + (m < 9 ? "0" : "") + (m + 1) + "-01"; };
  var dateLabel = function (t) { return MN[t % 12] + " " + Math.floor(t / 12); };
  var mean = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };

  /* ---------- pembacaan data ---------- */
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, "");
    var lines = text.replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); });
    var sep = lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
    var head = lines[0].split(sep).map(function (h) { return h.trim().replace(/^"|"$/g, ""); });
    return lines.slice(1).map(function (l) {
      var c = l.split(sep), o = {};
      head.forEach(function (h, i) { o[h] = (c[i] || "").trim().replace(/^"|"$/g, ""); });
      return o;
    });
  }
  function getText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + " tidak ditemukan (HTTP " + r.status + ")");
      return r;
    });
  }
  function init() {
    var boundary = fetch("data/batas_tnghs.geojson").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    Promise.all([getText("data/tnghs_all_vars.csv").then(function (r) { return r.text(); }),
                 getText("data/grid_tnghs.geojson").then(function (r) { return r.json(); }),
                 boundary])
      .then(function (res) { setup(parseCSV(res[0]), res[1], res[2]); })
      .catch(function (e) {
        console.error(e);
        $("content").hidden = true;
        var b = $("err"); b.hidden = false;
        b.innerHTML = "Data tidak dapat dimuat: " + e.message + ".<br>Pastikan halaman dibuka lewat server (Live Server atau <code>python -m http.server</code>), bukan klik dua kali berkas, dan folder <code>data/</code> berisi kedua berkas.";
      });
  }

  function setup(raw, geo, boundary) {
    var keys = Object.keys(raw[0]);
    var need = ["unit_id", "year", "month", "EVI", "EVI_anomaly"].filter(function (k) { return keys.indexOf(k) < 0; });
    if (need.length) throw new Error("kolom wajib tidak ada di CSV: " + need.join(", "));
    spiCols = keys.filter(function (k) { return /^SPI\d+$/.test(k); });
    rows = raw.map(function (r) {
      var o = {u: String(r.unit_id), y: +r.year, m: +r.month, lulc: r.lulc_dominant};
      o.t = o.y * 12 + (o.m - 1);
      o.EVI = num(r.EVI); o.anom = num(r.EVI_anomaly); o.pr = num(r.precip_mm);
      spiCols.forEach(function (s) { o[s] = num(r[s]); });
      return o;
    });
    byUnit = {};
    rows.forEach(function (r) { (byUnit[r.u] = byUnit[r.u] || {})[r.t] = r; });
    units = Object.keys(byUnit).sort();
    var ts = {}; rows.forEach(function (r) { ts[r.t] = 1; });
    dates = Object.keys(ts).map(Number).sort(function (a, b) { return a - b; });

    $("unit").innerHTML = '<option value="*">Rata-rata semua unit (' + units.length + ")</option>" +
      units.map(function (u) { return "<option>" + u + "</option>"; }).join("");
    $("spi").innerHTML = spiCols.map(function (s) { return '<option value="' + s + '">' + s.replace("SPI", "SPI-") + "</option>"; }).join("");
    if (spiCols.indexOf("SPI6") >= 0) $("spi").value = "SPI6";
    var ys = rows.map(function (r) { return r.y; });
    $("y0").value = Math.min.apply(null, ys); $("y1").value = Math.max.apply(null, ys);
    var sl = $("slider"); sl.max = dates.length - 1;
    var ai = dates.indexOf(2023 * 12 + 7); sl.value = ai >= 0 ? ai : dates.length - 1;

    idKey = detectIdKey(geo);
    initMap(geo, boundary);
    ["unit", "spi", "y0", "y1", "season", "mode", "layer", "slider"].forEach(function (id) {
      $(id).addEventListener(id === "slider" ? "input" : "change", update);
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", update);
    update();
  }

  function uid(f) { return String(f.properties[idKey]).trim(); }
  function detectIdKey(geo) {
    var feats = geo.features || [], keys = feats.length ? Object.keys(feats[0].properties || {}) : [], best = "unit_id", bn = -1;
    keys.forEach(function (k) {
      var n = feats.filter(function (f) { return byUnit[String(f.properties[k]).trim()]; }).length;
      if (n > bn) { bn = n; best = k; }
    });
    var warn = $("err");
    if (bn < units.length || bn < feats.length) {
      warn.hidden = false;
      warn.innerHTML = "Peringatan: hanya " + Math.max(bn, 0) + " dari " + feats.length + " sel geojson yang cocok dengan " + units.length + " unit di CSV. " +
        "Kolom ID geojson: <code>" + keys.join(", ") + "</code>. Contoh ID geojson: <code>" + (feats[0] ? String(feats[0].properties[best]) : "–") +
        "</code>, contoh ID CSV: <code>" + units[0] + "</code>. Sel yang tidak cocok akan tampil tanpa data.";
    }
    return best;
  }

  /* ---------- peta ---------- */
  var DIV = {min: -0.6, max: 0.6, stops: ["#b2182b", "#f7f7f7", "#2166ac"]};
  var SCALES = {
    rdom:   {kind: "cont", min: -0.6, max: 0.6, stops: ["#b2182b", "#f7f7f7", "#2166ac"], title: "r pada lag dominan", f: function (v) { return fmt(v); }},
    lagdom: {kind: "cat", colors: ["#d6e6f4", "#86b6dc", "#2f78b7", "#0d3a66"], title: "Lag dominan (bulan)", f: function (v) { return "lag " + v + " bln"; }},
    EVI:    {kind: "cont", min: 0, max: 0.8, stops: ["#ffffcc", "#a1d76a", "#238443"], title: "EVI", f: function (v) { return fmt(v, 3); }},
    anom:   {kind: "cont", min: -0.3, max: 0.3, stops: ["#a6611a", "#f5f5f5", "#018571"], title: "Anomali EVI", f: function (v) { return fmt(v, 3); }},
    spi:    {kind: "cont", min: -3, max: 3, stops: ["#b2182b", "#f7f7f7", "#2166ac"], title: "SPI", f: function (v) { return fmt(v); }},
    pr:     {kind: "cont", min: 0, max: 600, stops: ["#ffffff", "#6baed6", "#08306b"], title: "Curah hujan (mm)", f: function (v) { return fmt(v, 0); }}
  };
  function hex(c) { return [1, 3, 5].map(function (i) { return parseInt(c.substr(i, 2), 16); }); }
  function ramp(stops, p) {
    p = Math.max(0, Math.min(1, p));
    var seg = p * (stops.length - 1), i = Math.min(Math.floor(seg), stops.length - 2), w = seg - i;
    var a = hex(stops[i]), b = hex(stops[i + 1]);
    return "rgb(" + a.map(function (x, k) { return Math.round(x + (b[k] - x) * w); }).join(",") + ")";
  }
  function colorOf(sc, v) {
    if (!isFinite(v)) return "#999999";
    return sc.kind === "cat" ? sc.colors[v] : ramp(sc.stops, (v - sc.min) / (sc.max - sc.min));
  }
  function valueFor(u) {
    var L = $("layer").value, s = stats[u];
    if (L === "rdom") return s && s.best >= 0 ? s.l[s.best].r : NaN;
    if (L === "lagdom") return s && s.best >= 0 ? s.best : NaN;
    var r = byUnit[u] && byUnit[u][dates[+$("slider").value]];
    if (!r) return NaN;
    return L === "spi" ? r[$("spi").value] : r[L];
  }
  function initMap(geo, boundary) {
    map = L.map("map", {scrollWheelZoom: false});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 18, attribution: "© OpenStreetMap"}).addTo(map);
    geoLayer = L.geoJSON(geo, {
      onEachFeature: function (f, layer) {
        var u = uid(f);
        layer.bindTooltip(u, {sticky: true});
        layer.on("click", function () { if (byUnit[u]) { $("unit").value = u; update(); } });
      }
    }).addTo(map);
    var overlays = {"Sel grid analisis": geoLayer};
    if (boundary) {
      var bl = L.geoJSON(boundary, {interactive: false, style: {color: "#c2561a", weight: 2.5, fill: false, dashArray: "6 4"}}).addTo(map);
      overlays["Batas taman nasional"] = bl;
    }
    L.control.layers(null, overlays, {collapsed: false, position: "topright"}).addTo(map);
    map.fitBounds((boundary ? L.geoJSON(boundary) : geoLayer).getBounds(), {padding: [10, 10]});
    var C = L.control({position: "bottomright"});
    C.onAdd = function () { legendEl = L.DomUtil.create("div", "legend"); return legendEl; };
    C.addTo(map);
  }
  function drawMap() {
    var L_ = $("layer").value, sc = SCALES[L_], monthly = ["EVI", "anom", "spi", "pr"].indexOf(L_) >= 0;
    $("slider").disabled = !monthly;
    $("dlabel").textContent = dateLabel(dates[+$("slider").value]);
    var sel = $("unit").value;
    geoLayer.eachLayer(function (l) {
      var u = uid(l.feature), v = valueFor(u), isSel = sel === u;
      l.setStyle({fillColor: colorOf(sc, v), fillOpacity: isFinite(v) ? 0.85 : 0.15, color: isSel ? css("--hi") : "#33443b", weight: isSel ? 4 : 1});
      l.setTooltipContent("<b>" + u + "</b><br>" + sc.title + ": " + (isFinite(v) ? sc.f(v) : "tidak ada data"));
    });
    if (sc.kind === "cat") {
      legendEl.innerHTML = "<b>" + sc.title + "</b><br>" + sc.colors.map(function (c, i) { return '<i style="background:' + c + '"></i>' + i; }).join("&nbsp;&nbsp;");
    } else {
      legendEl.innerHTML = "<b>" + sc.title + '</b><div class="ramp" style="background:linear-gradient(to right,' + sc.stops.join(",") + ')"></div><div class="ends"><span>' + sc.min + "</span><span>" + sc.max + "</span></div>";
    }
  }

  /* ---------- statistik ---------- */
  function pearson(a, b) {
    var n = a.length; if (n < 4) return {r: NaN, n: n};
    var ma = mean(a), mb = mean(b), sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < n; i++) { var x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return {r: saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN, n: n};
  }
  function erf(x) {
    var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  }
  function pval(r, n) { if (!isFinite(r) || n <= 3) return NaN; var z = Math.abs(0.5 * Math.log((1 + r) / (1 - r))) * Math.sqrt(n - 3); return 1 - erf(z / Math.SQRT2); }
  function fp(p) { return !isFinite(p) ? "–" : p < 0.001 ? "<0,001" : fmt(p, 3); }
  function filt() { return {y0: +$("y0").value, y1: +$("y1").value, season: $("season").value, spi: $("spi").value}; }
  function inSeason(m, s) { return s === "all" || (s === "dry" ? (m >= 5 && m <= 9) : (m >= 11 || m <= 4)); }
  function unitLag(u, lag, f) {
    var map_ = byUnit[u], a = [], b = [];
    Object.keys(map_).forEach(function (k) {
      var r = map_[k]; if (r.y < f.y0 || r.y > f.y1 || !inSeason(r.m, f.season)) return;
      var r2 = map_[r.t + lag]; if (!r2) return;
      var s = r[f.spi], e = r2.anom; if (isFinite(s) && isFinite(e)) { a.push(s); b.push(e); }
    });
    return pearson(a, b);
  }
  function pickBest(rs) {
    var abs = $("mode").value === "abs", bi = -1, bv = -Infinity;
    rs.forEach(function (r, i) { var v = abs ? Math.abs(r) : r; if (isFinite(v) && v > bv) { bv = v; bi = i; } });
    return bi;
  }
  function computeStats() {
    var f = filt(); stats = {};
    units.forEach(function (u) {
      var l = LAGS.map(function (L) { return unitLag(u, L, f); });
      stats[u] = {l: l, best: pickBest(l.map(function (x) { return x.r; }))};
    });
  }

  /* ---------- grafik ---------- */
  function drawCharts() {
    if (typeof Plotly === "undefined") { $("verdict").textContent = "Grafik tidak tampil: pustaka Plotly gagal dimuat (periksa koneksi atau ikuti langkah salinan lokal)."; return; }
    var f = filt(), sel = $("unit").value, selU = sel === "*" ? units : [sel], spiName = f.spi.replace("SPI", "SPI-");
    var rl = LAGS.map(function (L, i) {
      var rs = selU.map(function (u) { return stats[u].l[i]; }).filter(function (x) { return isFinite(x.r); });
      return {r: rs.length ? mean(rs.map(function (x) { return x.r; })) : NaN, n: rs.length ? Math.round(mean(rs.map(function (x) { return x.n; }))) : 0,
              lo: rs.length ? Math.min.apply(null, rs.map(function (x) { return x.r; })) : NaN, hi: rs.length ? Math.max.apply(null, rs.map(function (x) { return x.r; })) : NaN};
    });
    var bi = pickBest(rl.map(function (x) { return x.r; }));
    if (bi < 0) { $("verdict").textContent = "Pasangan data valid terlalu sedikit untuk pengaturan yang dipilih."; }
    else {
      var b = rl[bi], p = pval(b.r, b.n), one = sel !== "*";
      $("verdict").innerHTML = "Lag dominan <b>" + bi + " bulan</b>, r = " + fmt(b.r) + " (" + spiName + "), n ≈ " + b.n + " bulan per unit" +
        (one ? ", p " + (fp(p)[0] === "<" ? "" : "= ") + fp(p) : "") + ". " +
        (Math.abs(b.r) < 0.3 ? "Korelasi tergolong lemah." : Math.abs(b.r) < 0.5 ? "Korelasi tergolong sedang." : "Korelasi tergolong kuat.");
    }
    var base = {font: {color: css("--ink"), family: "IBM Plex Sans"}, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)"};
    var grid = css("--line"), cfg = {displayModeBar: false, responsive: true};
    var ax = function (t) { return {title: t, gridcolor: grid, zerolinecolor: css("--mute")}; };

    Plotly.react("cLag", [{type: "bar", x: LAGS.map(function (l) { return "Lag " + l; }), y: rl.map(function (x) { return x.r; }),
      marker: {color: LAGS.map(function (l, i) { return i === bi ? css("--hi") : css("--spi"); })},
      error_y: sel === "*" ? {type: "data", symmetric: false, array: rl.map(function (x) { return x.hi - x.r; }), arrayminus: rl.map(function (x) { return x.r - x.lo; }), color: css("--mute")} : undefined,
      text: rl.map(function (x) { return fmt(x.r); }), textposition: "outside", hovertemplate: "%{x}<br>r = %{y:.3f}<extra></extra>"}],
      Object.assign({margin: {t: 10, r: 10, b: 36, l: 52}, yaxis: Object.assign(ax("r Pearson"), {range: [-1, 1]}), xaxis: {gridcolor: grid}}, base), cfg);

    var by = {};
    selU.forEach(function (u) { Object.keys(byUnit[u]).forEach(function (k) {
      var r = byUnit[u][k]; if (r.y < f.y0 || r.y > f.y1) return;
      var o = by[k] = by[k] || {t: r.t, s: [], e: []};
      if (isFinite(r[f.spi])) o.s.push(r[f.spi]); if (isFinite(r.anom)) o.e.push(r.anom);
    }); });
    var ts = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.t - b.t; });
    var cur = dateStr(dates[+$("slider").value]);
    Plotly.react("cTs", [
      {x: ts.map(function (o) { return dateStr(o.t); }), y: ts.map(function (o) { return mean(o.s); }), name: spiName, line: {color: css("--spi"), width: 1.6}},
      {x: ts.map(function (o) { return dateStr(o.t); }), y: ts.map(function (o) { return mean(o.e); }), name: "Anomali EVI", yaxis: "y2", line: {color: css("--evi"), width: 1.6}}],
      Object.assign({margin: {t: 10, r: 56, b: 40, l: 52}, legend: {orientation: "h", y: -0.18}, xaxis: {gridcolor: grid},
        yaxis: Object.assign(ax(spiName), {range: [-3, 3]}), yaxis2: {title: "Anomali EVI", overlaying: "y", side: "right", showgrid: false, range: [-0.3, 0.3]},
        shapes: [{type: "line", xref: "x", yref: "paper", x0: cur, x1: cur, y0: 0, y1: 1, line: {color: css("--hi"), dash: "dot", width: 1.5}}]}, base), cfg);

    var mo = []; for (var m = 0; m < 12; m++) mo.push({e: [], p: []});
    selU.forEach(function (u) { Object.keys(byUnit[u]).forEach(function (k) {
      var r = byUnit[u][k]; if (r.y < f.y0 || r.y > f.y1) return;
      if (isFinite(r.EVI)) mo[r.m - 1].e.push(r.EVI); if (isFinite(r.pr)) mo[r.m - 1].p.push(r.pr);
    }); });
    Plotly.react("cSea", [
      {type: "bar", x: MN, y: mo.map(function (o) { return mean(o.p); }), name: "Curah hujan (mm)", marker: {color: css("--spi"), opacity: 0.35}, yaxis: "y2"},
      {x: MN, y: mo.map(function (o) { return mean(o.e); }), name: "EVI", mode: "lines+markers", line: {color: css("--evi"), width: 2}}],
      Object.assign({margin: {t: 10, r: 56, b: 40, l: 52}, legend: {orientation: "h", y: -0.2}, xaxis: {gridcolor: grid},
        yaxis: ax("EVI"), yaxis2: {title: "mm", overlaying: "y", side: "right", showgrid: false}}, base), cfg);

    var yy = {};
    selU.forEach(function (u) { Object.keys(byUnit[u]).forEach(function (k) {
      var r = byUnit[u][k], o = yy[r.y] = yy[r.y] || {n: 0, k: 0}; o.n++; if (!isFinite(r.EVI)) o.k++;
    }); });
    var yrs = Object.keys(yy).map(Number).sort();
    Plotly.react("cNan", [{type: "bar", x: yrs, y: yrs.map(function (y) { return 100 * yy[y].k / yy[y].n; }), marker: {color: css("--hi")}, hovertemplate: "%{x}: %{y:.0f}% kosong<extra></extra>"}],
      Object.assign({margin: {t: 10, r: 10, b: 36, l: 52}, xaxis: {gridcolor: grid}, yaxis: Object.assign(ax("% kosong"), {range: [0, 100]})}, base), cfg);
  }

  function drawTable() {
    var head = "<tr><th>Unit</th><th>Kelas</th>" + LAGS.map(function (l) { return "<th>r lag " + l + "</th>"; }).join("") + "<th>Lag dominan</th><th>n</th><th>EVI kosong</th></tr>";
    var body = units.map(function (u) {
      var s = stats[u], rs = s.l.map(function (x) { return x.r; }), mp = byUnit[u], ks = Object.keys(mp), k = 0;
      ks.forEach(function (t) { if (!isFinite(mp[t].EVI)) k++; });
      return "<tr><td>" + u + "</td><td>" + (mp[ks[0]].lulc || "–") + "</td>" +
        rs.map(function (r, i) { return '<td class="' + (i === s.best ? "best" : "") + '">' + fmt(r) + "</td>"; }).join("") +
        "<td>" + (s.best < 0 ? "–" : s.best + " bln") + "</td><td>" + (s.best < 0 ? "–" : s.l[s.best].n) + "</td><td>" + fmt(100 * k / ks.length, 0) + "%</td></tr>";
    }).join("");
    $("tbl").innerHTML = "<table>" + head + body + "</table>";
  }

  function update() { computeStats(); drawMap(); drawCharts(); drawTable(); }
  init();
})();
