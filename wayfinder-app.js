/* ──────────────────────────────────────────────────────────────────────
   WhereToGo · App
   Entry screen → radial cartographic engine → right-side ranking panel.
   ────────────────────────────────────────────────────────────────────── */

(function(){

const { ORIGINS, CITIES, PRESETS } = window.WF;

/* ────────── STATE ────────── */
const STATE = {
  originKey:  "VIE",
  month:      7,        // 0..11
  presetId:   "balanced",
  weights:    { time:.25, cost:.25, co2:.25, pop:.25 },
  popInvert:  false,
  active:     null,
  hovered:    null,
  density:    "rich",
  entryDone:  false,
};

/* Legend layer toggles — all OFF by default */
const LEGEND = {
  transport: false,
  co2:       false,
  pop:       false,
};

const MONTHS = [
  ["Jan","01"],["Feb","02"],["Mar","03"],["Apr","04"],["May","05"],["Jun","06"],
  ["Jul","07"],["Aug","08"],["Sep","09"],["Oct","10"],["Nov","11"],["Dec","12"],
];

/* ────────── CANVAS GEOMETRY ────────── */
const VB = 1000;
const CX = VB/2, CY = VB/2;
const R_MIN = 90;
const R_MAX = 430;

/* Match-band labels for the rings (best inner → worst outer).
   Outermost ring is the cartographic boundary — no label needed. */
const RING_BANDS = [
  { t:0.00, label:"Best match" },
  { t:0.25, label:"Strong" },
  { t:0.50, label:"Fair" },
  { t:0.75, label:"Stretch" },
  { t:1.00, label:null },
];

/* ────────── HELPERS ────────── */
const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;
const ord = n => {
  const s = ["th","st","nd","rd"], v=n%100;
  return n + (s[(v-20)%10]||s[v]||s[0]);
};

const INTEREST_ICON = { see:"👁", do:"🏃", eat:"🍽", drink:"🍸", sleep:"🛏", shop:"🛍" };

function buildDetailHTML(d){
  const parts = [];

  if(d.budget || d.walkability || d.aqi){
    const chips = [];
    if(d.budget)      chips.push(`<span class="wf-detail-chip" data-quality="${d.budget}"><span class="chip-icon">💰</span>${d.budget}</span>`);
    if(d.walkability) chips.push(`<span class="wf-detail-chip" data-quality="${d.walkability}"><span class="chip-icon">🚶</span>${d.walkability}</span>`);
    if(d.aqi)         chips.push(`<span class="wf-detail-chip" data-quality="${d.aqi}"><span class="chip-icon">🌬</span>Air: ${d.aqi}</span>`);
    parts.push(`<div class="wf-detail-chips">${chips.join("")}</div>`);
  }

  if(d.seasons && (d.seasons.high?.length || d.seasons.medium?.length || d.seasons.low?.length)){
    const SHORT = {January:"Jan",February:"Feb",March:"Mar",April:"Apr",May:"May",
                   June:"Jun",July:"Jul",August:"Aug",September:"Sep",
                   October:"Oct",November:"Nov",December:"Dec"};
    const ORDER = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"];
    const highSet = new Set(d.seasons.high   || []);
    const medSet  = new Set(d.seasons.medium || []);
    const monthPills = ORDER.map(m => {
      const cls = highSet.has(m) ? "" : medSet.has(m) ? " is-med" : " is-low";
      return `<span class="wf-detail-month${cls}">${SHORT[m]||m}</span>`;
    }).join("");
    parts.push(`<div class="wf-detail-season"><span class="wf-detail-season-label">Season</span><div class="wf-detail-season-months">${monthPills}</div></div>`);
  }

  if(d.interests && d.interests.length){
    const MAX_VISIBLE = 5;
    const shown = d.interests.slice(0, MAX_VISIBLE);
    const extra = d.interests.length - MAX_VISIBLE;
    const rows = shown.map(it => {
      const icon = INTEREST_ICON[it.type] || "📍";
      const safeTitle = it.title.replace(/</g,"&lt;").replace(/>/g,"&gt;");
      return `<div class="wf-detail-interest" title="${it.text ? it.text.replace(/"/g,"&quot;") : ""}"><span class="wf-detail-interest-icon">${icon}</span><span class="wf-detail-interest-title">${safeTitle}</span></div>`;
    }).join("");
    const moreRow = extra > 0 ? `<div class="wf-detail-more">+${extra} more</div>` : "";
    parts.push(`<div class="wf-detail-interests"><div class="wf-detail-interests-head">Highlights</div>${rows}${moreRow}</div>`);
  }

  if(!parts.length) return "";
  return `<div class="wf-rank-detail">${parts.join("")}</div>`;
}

function bearing(lat1,lon1,lat2,lon2){
  const φ1=toRad(lat1),φ2=toRad(lat2),Δλ=toRad(lon2-lon1);
  const y=Math.sin(Δλ)*Math.cos(φ2);
  const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (toDeg(Math.atan2(y,x))+360)%360;
}
function bearingLabel(b){
  return ["N","NE","E","SE","S","SW","W","NW"][Math.round(b/45)%8];
}
function normalize(arr,key,inverse=false){
  const vals=arr.map(d=>d[key]);
  const mn=Math.min(...vals), mx=Math.max(...vals);
  arr.forEach(d=>{
    const n=(d[key]-mn)/(mx-mn||1);
    d["n_"+key]= inverse ? 1-n : n;
  });
}
/* Known broken Unsplash IDs — some photoIds in destinations.json point to
   unrelated stock photos (Naples → a space photo, etc). These force a
   direct fallback to the deterministic IATA-seeded Picsum image. */
const BAD_PHOTOS = new Set([
  "1583000186270-d3b0fec0d2c8", // Naples → was a space photo
]);
function photoURL(id,w=640){
  if(!id || BAD_PHOTOS.has(id)) return null;
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;
}
/* Deterministic fallback image (Picsum seed) — always resolves to a real photo,
   so cards never show empty grey rectangles when Unsplash IDs 404. */
function fallbackPhotoURL(seed, w=240){
  const s = encodeURIComponent(String(seed || "city").toLowerCase());
  return `https://picsum.photos/seed/${s}/${w}/${Math.round(w*0.72)}`;
}

function currentMonthKey(){
  if (STATE.month == null || !Array.isArray(WF.MONTHS_LIST) || !WF.MONTHS_LIST.length) return null;
  const mm = String(STATE.month + 1).padStart(2, "0");
  return WF.MONTHS_LIST.find(m => m.endsWith("-" + mm)) || null;
}

/* ────────── TRANSPORT MODE SELECTION ──────────
   Compares train vs flight using the same WLC logic as the main ranking:
   normalise time, cost and co2 *between the two options*, apply user weights,
   pick the lower (better) score. Returns true when train is preferred.
   Gracefully handles missing modes. ─────────── */
function pickBestMode(train, flight, weights){
  if(!train)  return false;   // only flight available
  if(!flight) return true;    // only train available

  const tTime = train.time,  fTime = flight.time;
  const tCost = train.cost,  fCost = flight.cost;
  const tCo2  = train.co2  ?? 9999, fCo2 = flight.co2 ?? 9999;

  const timeRange = Math.abs(fTime - tTime) || 1;
  const costRange = Math.abs(fCost - tCost) || 1;
  const co2Range  = Math.abs(fCo2  - tCo2 ) || 1;

  // Lower score = better (lower time / cost / co2)
  const scoreOf = (t, c, e) =>
    weights.time * (t - Math.min(tTime, fTime)) / timeRange +
    weights.cost * (c - Math.min(tCost, fCost)) / costRange +
    weights.co2  * (e - Math.min(tCo2,  fCo2 )) / co2Range;

  return scoreOf(tTime, tCost, tCo2) <= scoreOf(fTime, fCost, fCo2);
}

/* ────────── COMPUTE ────────── */
function compute(){
  const O = ORIGINS[STATE.originKey];
  const popInverse = !!STATE.popInvert;

  const mk      = currentMonthKey();
  const monthly = (WF.MONTHLY && mk) ? (WF.MONTHLY[STATE.originKey] || null) : null;

  const data = CITIES
    .filter(c => c.name !== O.name)
    .map(c => {
      const cell = monthly && c.iata ? (monthly[c.iata] || {})[mk] : null;

      // If the JSON has real data for this (origin, dest, month):
      if (cell && cell.available) {
        const preferTrain = pickBestMode(cell.train, cell.flight, STATE.weights);
        const chosen = preferTrain ? cell.train : cell.flight;

        return {
          ...c,
          time:      chosen.time,
          cost:      chosen.cost,
          co2:       chosen.co2 ?? c.co2Flight,
          transport: preferTrain ? "train" : "flight",
          hasFlight: !!cell.flight,
          hasTrain:  !!cell.train,
          bearingDeg: bearing(O.lat, O.lon, c.lat, c.lon),
        };
      }

      // Cell unavailable (no real data) → exclude from ranking
      return null;
    })
    .filter(Boolean);   // drop unavailable cities

  normalize(data,"time");
  normalize(data,"cost");
  normalize(data,"co2");
  normalize(data,"pop", !popInverse);

  const w = STATE.weights;
  data.forEach(d=>{
    d.score = w.time*d.n_time + w.cost*d.n_cost + w.co2*d.n_co2 + w.pop*d.n_pop;
  });
  data.sort((a,b)=>a.score-b.score);
  data.forEach((d,i)=>d.rank=i+1);

  const sMin=data[0].score, sMax=data[data.length-1].score;
  data.forEach(d=>{
    d.scoreNorm = (d.score-sMin)/(sMax-sMin||1);
    d.matchPct  = Math.round((1-d.scoreNorm)*100);
    const r = R_MIN + d.scoreNorm * (R_MAX-R_MIN);
    const θ = toRad(d.bearingDeg-90);
    d.x = CX + r*Math.cos(θ);
    d.y = CY + r*Math.sin(θ);
  });
  return data;
}

/* ────────── DOM REFS (created after entry) ────────── */
let gLayer = null;
let listEl = null;
let tipEl  = null;
let miniLandEl = null, miniDotsEl = null, miniGratEl = null, miniHitsEl = null;
let presetTrayEl = null, originSelectEl = null, monthSelectEl = null;
let insightEl=null, matchPctEl=null, matchNameEl=null, matchSubEl=null;
let rankCountEl=null, rankPresetEl=null;
let dotPopupEl=null, dotPopupNameEl=null, dotPopupCountryEl=null,
    dotPopupRankEl=null, dotPopupMatchEl=null, dotPopupPhotoEl=null,
    dotPopupMetricsEl=null, dotPopupTagsEl=null, dotPopupInsightEl=null;

function captureRefs(){
  gLayer = {
    rings:    document.getElementById("g-rings"),
    bearings: document.getElementById("g-bearings"),
    cardinal: document.getElementById("g-cardinal"),
    popGlow:  document.getElementById("g-pop-glow"),
    halos:    document.getElementById("g-halos"),
    dots:     document.getElementById("g-dots"),
    labels:   document.getElementById("g-labels"),
    origin:   document.getElementById("g-origin"),
    active:   document.getElementById("g-active"),
  };
  listEl       = document.getElementById("rank-list");
  tipEl        = document.getElementById("tip");
  miniLandEl   = document.getElementById("mini-land");
  miniDotsEl   = document.getElementById("mini-dots");
  miniGratEl   = document.getElementById("mini-grat");
  miniHitsEl   = document.getElementById("mini-hits");
  presetTrayEl = document.getElementById("preset-tray");
  originSelectEl = document.getElementById("origin-select");
  monthSelectEl  = document.getElementById("month-select");
  insightEl    = document.getElementById("insight-line");
  matchPctEl   = document.getElementById("match-pct");
  matchNameEl  = document.getElementById("match-name");
  matchSubEl   = document.getElementById("match-sub");
  rankCountEl  = document.getElementById("rank-count");
  rankPresetEl = document.getElementById("rank-preset");
  dotPopupEl        = document.getElementById("dot-popup");
  dotPopupNameEl    = document.getElementById("dot-popup-name");
  dotPopupCountryEl = document.getElementById("dot-popup-country");
  dotPopupRankEl    = document.getElementById("dot-popup-rank");
  dotPopupMatchEl   = document.getElementById("dot-popup-match");
  dotPopupPhotoEl   = document.getElementById("dot-popup-photo");
  dotPopupMetricsEl = document.getElementById("dot-popup-metrics");
  dotPopupTagsEl    = document.getElementById("dot-popup-tags");
  dotPopupInsightEl = document.getElementById("dot-popup-insight");
  if(dotPopupEl){
    document.getElementById("dot-popup-close").addEventListener("click", closeDotPopup);
  }
}

/* ────────── DRAW: RINGS, BEARING LINES, CARDINALS ────────── */
function drawRings(){
  const g = gLayer.rings;
  g.innerHTML = "";
  // Inner rings only — the outermost ring is owned by the static compass layer.
  RING_BANDS.forEach((band, i) => {
    if(i === RING_BANDS.length - 1) return; // outer ring drawn in drawCardinal (static)
    const r = R_MIN + band.t * (R_MAX - R_MIN);
    const isInner = i === 0;
    const cls = isInner ? "wf-ring wf-ring-emph" : "wf-ring";
    g.appendChild(svgEl("circle",{ cx:CX, cy:CY, r, class: cls }));
    if(band.label){
      const t = svgEl("text",{
        x: CX + 4,
        y: CY - r - 4,
        class: "wf-ring-label",
        "text-anchor": "middle",
      });
      t.textContent = band.label.toUpperCase();
      g.appendChild(t);
    }
  });
}
function drawBearings(){
  const g = gLayer.bearings;
  g.innerHTML = "";
  // 8 radial rays — N, NE, E, SE, S, SW, W, NW
  for(let i=0; i<8; i++){
    const a = i * 45;
    const θ = toRad(a-90);
    const x1 = CX + R_MIN * Math.cos(θ);
    const y1 = CY + R_MIN * Math.sin(θ);
    const x2 = CX + R_MAX * Math.cos(θ);
    const y2 = CY + R_MAX * Math.sin(θ);
    g.appendChild(svgEl("line",{x1,y1,x2,y2,class:"wf-bearing-line"}));
  }
}
function drawCardinal(){
  const g = gLayer.cardinal;
  g.innerHTML = "";

  /* ── g-cardinal is now in the static layer (never zooms/pans).
     It owns the outer ring circle so the bezel is always fully visible. ── */
  const R_TICK_IN      = R_MAX - 9;
  const R_TICK_OUT     = R_MAX + 9;
  const R_MINOR_IN     = R_MAX - 5;
  const R_MINOR_OUT    = R_MAX + 5;
  const R_LABEL        = R_MAX + 34;

  // Outer boundary ring (the compass bezel frame)
  g.appendChild(svgEl("circle",{
    cx:CX, cy:CY, r:R_MAX,
    class:"wf-ring wf-ring-outer"
  }));

  // One subtle inner deco ring for compass depth
  g.appendChild(svgEl("circle",{
    cx:CX, cy:CY, r: R_MAX - 16,
    stroke:"rgba(255,255,255,0.05)", "stroke-width":0.8, fill:"none"
  }));

  // 16 tick marks: major at every 45° (8), minor at every 22.5° (8 intermediate)
  for(let i=0;i<16;i++){
    const a = i*22.5;
    const θ = toRad(a-90);
    const isMajor = (i%2===0);
    const r1 = isMajor ? R_TICK_IN  : R_MINOR_IN;
    const r2 = isMajor ? R_TICK_OUT : R_MINOR_OUT;
    g.appendChild(svgEl("line",{
      x1: CX+r1*Math.cos(θ), y1: CY+r1*Math.sin(θ),
      x2: CX+r2*Math.cos(θ), y2: CY+r2*Math.sin(θ),
      stroke: isMajor ? "rgba(255,255,255,0.50)" : "rgba(255,255,255,0.20)",
      "stroke-width": isMajor ? 1.6 : 1,
    }));
  }

  // North triangle — accent-filled, straddles the outer ring at bearing 0°
  // Tip points inward; base sits outside the ring
  const triH   = 10;
  const triW   = triH * 2 / Math.sqrt(3);
  const triTipY  = CY - R_TICK_OUT;  // tip outside the ring
const triBaseY = CY - R_TICK_IN;       // base inside the ring
  g.appendChild(svgEl("polygon",{
    points:`${CX},${triTipY} ${CX-triW/2},${triBaseY} ${CX+triW/2},${triBaseY}`,
    fill:"var(--wf-accent)"
  }));

  // Cardinal labels N/S/E/W
  [["N",0],["E",90],["S",180],["W",270]].forEach(([l,a])=>{
    const θ = toRad(a-90);
    const t = svgEl("text",{
      x: CX+R_LABEL*Math.cos(θ),
      y: CY+R_LABEL*Math.sin(θ),
      class:"wf-cardinal","text-anchor":"middle","dominant-baseline":"middle",
    });
    t.textContent = l;
    g.appendChild(t);
  });

  // Intercardinal labels NE/SE/SW/NW
  [["NE",45],["SE",135],["SW",225],["NW",315]].forEach(([l,a])=>{
    const θ = toRad(a-90);
    const t = svgEl("text",{
      x: CX+R_LABEL*Math.cos(θ),
      y: CY+R_LABEL*Math.sin(θ),
      class:"wf-intercardinal","text-anchor":"middle","dominant-baseline":"middle",
    });
    t.textContent = l;
    g.appendChild(t);
  });
}

/* ────────── DRAW: BASEMAP ──────────
   Azimuthal-equidistant projection of European coastlines, centred on the
   current origin. Distance from centre is real great-circle distance scaled
   to ~5000 km → R_MAX*1.4 (so even Iceland and the Aegean fit on screen).
   Bearing matches the polar plot exactly — that's the whole point. */
const EARTH_KM_PER_RAD = 6371;
const BASEMAP_KM_REACH = 5200;
const BASEMAP_PX_REACH = R_MAX * 1.45;

function azProject(lat, lon, oLat, oLon){
  if (Math.abs(lat - oLat) < 1e-6 && Math.abs(lon - oLon) < 1e-6) return [CX, CY];
  const φ1 = toRad(oLat), φ2 = toRad(lat);
  const Δλ = toRad(lon - oLon);
  const cosC = Math.sin(φ1)*Math.sin(φ2) + Math.cos(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  const c = Math.acos(Math.max(-1, Math.min(1, cosC)));   // angular distance
  const distKm = c * EARTH_KM_PER_RAD;
  const r = (distKm / BASEMAP_KM_REACH) * BASEMAP_PX_REACH;
  const θ = toRad(bearing(oLat, oLon, lat, lon) - 90);
  return [CX + r*Math.cos(θ), CY + r*Math.sin(θ)];
}
function azPolygonPath(latLonArr, oLat, oLon){
  return latLonArr.map(([la,lo], i)=>{
    const [x,y] = azProject(la, lo, oLat, oLon);
    return (i===0?"M":"L") + x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ") + " Z";
}

function geoJSONPolygonPath(coords, oLat, oLon){
  return coords.map(ring => {
    return ring.map(([lon, lat], i) => {
      const [x, y] = azProject(lat, lon, oLat, oLon);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ") + " Z";
  }).join(" ");
}

function drawBasemap(){
  const g = document.getElementById("g-basemap");
  if (!g) return;
  g.innerHTML = "";

  const O = ORIGINS[STATE.originKey];
  const geo = window.WF.EUROPE_GEOJSON;
  if (!geo || !geo.features) return;

  [1000, 2000, 3000, 4000].forEach(km => {
    const r = km / BASEMAP_KM_REACH * BASEMAP_PX_REACH;
    g.appendChild(svgEl("circle", {
      cx: CX,
      cy: CY,
      r,
      class: "wf-basemap-graticule"
    }));
  });

  geo.features.forEach(f => {
    const geom = f.geometry;
    if (!geom) return;

    if (geom.type === "Polygon") {
      g.appendChild(svgEl("path", {
        d: geoJSONPolygonPath(geom.coordinates, O.lat, O.lon),
        class: "wf-basemap-land"
      }));
    }

    if (geom.type === "MultiPolygon") {
      geom.coordinates.forEach(poly => {
        g.appendChild(svgEl("path", {
          d: geoJSONPolygonPath(poly, O.lat, O.lon),
          class: "wf-basemap-land"
        }));
      });
    }
  });
}

function drawMini(data){
  if (!miniDotsEl) return;

  const O = ORIGINS[STATE.originKey];
  const focusName = STATE.active || STATE.hovered;

  /* ── Dots layer: same tier/size/color logic as the radial map ── */
  const gDots = miniDotsEl;
  gDots.innerHTML = "";

  // Origin dot
  const [ox, oy] = miniProject(O.lat, O.lon);
  gDots.appendChild(svgEl("circle", { cx: ox, cy: oy, r: 4.5, class: "wf-mini-origin" }));
  gDots.appendChild(svgEl("circle", { cx: ox, cy: oy, r: 7,   class: "wf-mini-origin-ring" }));

  // Destination dots — same tier colour as radial (top/mid/low)
  data.forEach(d => {
    const [x, y] = miniProject(d.lat, d.lon);
    const tier = d.rank <= 5 ? "top" : d.rank <= 12 ? "mid" : "low";
    const r    = tier === "top" ? 2.8 : tier === "mid" ? 2 : 1.5;
    const isFocus = focusName === d.name;
    const cls  = `wf-mini-dot wf-mini-${tier}${isFocus ? " wf-mini-is-focus" : ""}`;
    gDots.appendChild(svgEl("circle", { cx: x, cy: y, r, class: cls }));
  });

  // Focus accent ring on active/hovered city
  if(focusName){
    const fd = data.find(x => x.name === focusName);
    if(fd){
      const [fx, fy] = miniProject(fd.lat, fd.lon);
      gDots.appendChild(svgEl("circle", { cx: fx, cy: fy, r: 6.5, class: "wf-mini-focus" }));
    }
  }

  /* ── Hit targets layer: transparent circles that receive clicks/hovers ── */
  if (!miniHitsEl) return;
  const gHits = miniHitsEl;
  gHits.innerHTML = "";

  data.forEach(d => {
    const [x, y] = miniProject(d.lat, d.lon);
    const hit = svgEl("circle", { cx: x, cy: y, r: 9, class: "wf-mini-hit" });
    hit.addEventListener("mouseenter", () => {
      STATE.hovered = d.name;
      drawOverlay(lastData);
      drawMini(lastData);
      drawHeadline(lastData);
      _syncLabelVisibility();
      gLayer.dots.classList.add("has-focus");
      gLayer.dots.querySelectorAll(".wf-dot-g").forEach(g => {
        const dot = g.querySelector(".wf-dot");
        if(dot) dot.classList.toggle("is-focus", g.getAttribute("data-name") === d.name);
      });
      if(listEl) listEl.querySelectorAll(".wf-rank-card").forEach(el => {
        el.classList.toggle("is-hover", el.getAttribute("data-name") === d.name);
      });
    });
    hit.addEventListener("mouseleave", () => {
      STATE.hovered = null;
      drawOverlay(lastData);
      drawMini(lastData);
      drawHeadline(lastData);
      _syncLabelVisibility();
      gLayer.dots.classList.toggle("has-focus", !!STATE.active);
      gLayer.dots.querySelectorAll(".wf-dot-g").forEach(g => {
        const dot = g.querySelector(".wf-dot");
        if(dot) dot.classList.toggle("is-focus", g.getAttribute("data-name") === STATE.active);
      });
      if(listEl) listEl.querySelectorAll(".wf-rank-card").forEach(el => {
        el.classList.remove("is-hover");
      });
    });
    hit.addEventListener("click", () => {
      STATE.active = (STATE.active === d.name) ? null : d.name;
      drawOverlay(lastData);
      _syncLabelVisibility();
      drawMini(lastData);
      drawHeadline(lastData);
      gLayer.dots.classList.toggle("has-focus", !!(STATE.active || STATE.hovered));
      gLayer.dots.querySelectorAll(".wf-dot-g").forEach(g => {
        const dot = g.querySelector(".wf-dot");
        if(dot) dot.classList.toggle("is-focus", g.getAttribute("data-name") === (STATE.active || STATE.hovered));
      });
      if(listEl){
        listEl.querySelectorAll(".wf-rank-card").forEach(el => {
          el.classList.toggle("is-active", el.getAttribute("data-name") === STATE.active);
        });
        if(STATE.active){
          const cardEl = listEl.querySelector(`.wf-rank-card[data-name="${CSS.escape(STATE.active)}"]`);
          if(cardEl){
            const top = cardEl.offsetTop - listEl.offsetTop - 12;
            listEl.scrollTo({ top, behavior: "smooth" });
          }
        }
      }
      if(STATE.active) openDetail(STATE.active);
    });
    gHits.appendChild(hit);
  });
}



/* ────────── DRAW: COMPASS ROSE ──────────
   Subtle 8-petal rose behind the origin marker. Pure decoration but it
   makes the centre feel like a cartographic anchor, not a void. */
function drawRose(){
  const g = document.getElementById("g-rose");
  if(!g) return;
  g.innerHTML = "";
  const R1 = 22, R2 = 42, R3 = 58;
  // Outer guide ring
  g.appendChild(svgEl("circle", { cx:CX, cy:CY, r:R3, class:"wf-rose-ring" }));
  g.appendChild(svgEl("circle", { cx:CX, cy:CY, r:R1, class:"wf-rose-ring" }));
  // 8 petals
  for(let i=0;i<8;i++){
    const a   = toRad(i*45 - 90);
    const ap  = toRad(i*45 - 45 - 90);
    const an  = toRad(i*45 + 45 - 90);
    const longR = (i % 2 === 0) ? R3 : R2;     // cardinals reach farther
    const tipX = CX + longR*Math.cos(a),  tipY = CY + longR*Math.sin(a);
    const lX  = CX + R1*Math.cos(ap),     lY  = CY + R1*Math.sin(ap);
    const rX  = CX + R1*Math.cos(an),     rY  = CY + R1*Math.sin(an);
    const d = `M${CX} ${CY} L${lX} ${lY} L${tipX} ${tipY} L${rX} ${rY} Z`;
    g.appendChild(svgEl("path", { d, class:"wf-rose-petal" }));
  }
  // Tiny radial tick marks every 22.5° for a navigator's feel
  for(let i=0;i<16;i++){
    const a = toRad(i*22.5 - 90);
    const x1 = CX + R3*Math.cos(a),  y1 = CY + R3*Math.sin(a);
    const x2 = CX + (R3+4)*Math.cos(a), y2 = CY + (R3+4)*Math.sin(a);
    g.appendChild(svgEl("line", { x1, y1, x2, y2, class:"wf-rose-tick" }));
  }
}

/* ────────── DRAW: ORIGIN ────────── */
function drawOrigin(){
  const g = gLayer.origin;
  g.innerHTML = "";
  const O = ORIGINS[STATE.originKey];
  // Soft halo
  g.appendChild(svgEl("circle",{cx:CX,cy:CY,r:34,class:"wf-origin-halo"}));
  g.appendChild(svgEl("circle",{cx:CX,cy:CY,r:24,class:"wf-origin-ring-soft"}));
  g.appendChild(svgEl("circle",{cx:CX,cy:CY,r:14,class:"wf-origin-ring"}));
  // Crosshair small ticks
  [0,90,180,270].forEach(a=>{
    const θ = toRad(a-90);
    const x1 = CX + 14*Math.cos(θ), y1 = CY + 14*Math.sin(θ);
    const x2 = CX + 20*Math.cos(θ), y2 = CY + 20*Math.sin(θ);
    g.appendChild(svgEl("line",{x1,y1,x2,y2,stroke:"var(--wf-accent)","stroke-width":1.1,opacity:.8}));
  });
  // Centre pin
  g.appendChild(svgEl("circle",{cx:CX,cy:CY,r:6, class:"wf-origin-pin"}));

  const sub = svgEl("text",{x:CX,y:CY-44,class:"wf-origin-sub","text-anchor":"middle"});
  sub.textContent = "ORIGIN";
  g.appendChild(sub);
  const label = svgEl("text",{x:CX,y:CY-26,class:"wf-origin-label","text-anchor":"middle"});
  label.textContent = O.name;
  g.appendChild(label);
}

/* ────────── DRAW: DOTS + HALOS (update-in-place for animation) ────────── */
function updateByName(g, items, makeFn, updateFn){
  // Map existing children keyed by data-name
  const existing = new Map();
  Array.from(g.children).forEach(el => {
    const n = el.getAttribute("data-name");
    if(n) existing.set(n, el);
  });
  const wanted = new Set();
  items.forEach(d => {
    wanted.add(d.name);
    let el = existing.get(d.name);
    if(!el){
      el = makeFn(d);
      el.setAttribute("data-name", d.name);
      g.appendChild(el);
    }
    updateFn(el, d);
  });
  // Remove orphans (e.g. when origin changes)
  existing.forEach((el, name) => {
    if(!wanted.has(name)) el.remove();
  });
}

function _co2Color(co2){
  if(co2 == null) return null;
  if(co2 < 15)  return "rgba(79,158,212,.85)";   // steel blue
  if(co2 < 60)  return "rgba(210,165,75,.85)";   // muted amber
  return          "rgba(154,96,32,.85)";          // dark amber-brown
}

function drawDots(data){
  // Halos: top 5 always; extend to top 8 when zoomed in for added legibility
  const haloThreshold = ZOOM.scale > 1.8 ? 8 : 5;
  const topData = data.filter(d => d.rank <= haloThreshold);
  updateByName(
    gLayer.halos, topData,
    () => svgEl("circle", { class:"wf-halo-top" }),
    (el, d) => {
      el.setAttribute("cx", d.x);
      el.setAttribute("cy", d.y);
      el.setAttribute("r", 15 / Math.pow(ZOOM.scale, 1.5));
    }
  );

  // Dots — <g> containing: hit target, shape (circle=flight / rect=train), optional train ring.
  updateByName(
    gLayer.dots, data,
    (d) => {
      const g = svgEl("g", { class:"wf-dot-g" });
      const hit = svgEl("circle", { class:"wf-dot-hit" });
      g.appendChild(hit);
      const name = d.name;
      g.addEventListener("mouseenter", () => onHover(name));
      g.addEventListener("mouseleave", () => onHover(null));
      g.addEventListener("click", (e) => {
        if(d.rank > 10){
          e.stopPropagation();
          const currentData = lastData ? lastData.find(x => x.name === name) : null;
          if(currentData) showDotPopup(currentData, e);
        } else {
          closeDotPopup();
          onSelect(name);
        }
      });
      return g;
    },
    (el, d) => {
      const tier    = d.rank<=5 ? "top" : d.rank<=12 ? "mid" : "low";
      // Zoom-aware radius: top cities grow on screen (prominence), mid stays stable,
      // low shrinks at overview zoom to reduce visual noise.
      const s = ZOOM.scale;
      const baseR = tier==="top" ? 6.0 : tier==="mid" ? 4.5 : 3.4;
      // Dots shrink as zoom increases: divide by s^1.5 so on-screen size = baseR / √s
      // (at zoom=2 → ~71% of original, at zoom=4 → 50%). Low tier shrinks faster.
      const exp = tier==="low" ? 1.8 : 1.5;
      const r = baseR / Math.pow(s, exp);
      const isTrain = d.transport === "train";
      const focusName = STATE.active || STATE.hovered;
      const isFocus   = focusName === d.name;
      const co2Color  = _co2Color(d.co2);

      // Legend gate: only show train glyph when transport layer is ON
      const showAsTrain = LEGEND.transport && isTrain;

      // Hit target
      const hit = el.querySelector(".wf-dot-hit");
      hit.setAttribute("cx", d.x);
      hit.setAttribute("cy", d.y);
      hit.setAttribute("r", 14 / Math.pow(ZOOM.scale, 1.5));

      // Shape — replace element if glyph type changed (circle ↔ rect)
      let shape = el.querySelector(".wf-dot-shape");
      const needsRect = showAsTrain;
      const hasRect   = shape && shape.tagName.toLowerCase() === "rect";
      if(!shape || needsRect !== hasRect){
        if(shape) shape.remove();
        shape = svgEl(showAsTrain ? "rect" : "circle", { class:"wf-dot-shape wf-dot" });
        const ring = el.querySelector(".wf-dot-mode-ring");
        ring ? el.insertBefore(shape, ring) : el.appendChild(shape);
      }

      if(showAsTrain){
        const s = r * 1.75;
        shape.setAttribute("x",      d.x - s / 2);
        shape.setAttribute("y",      d.y - s / 2);
        shape.setAttribute("width",  s);
        shape.setAttribute("height", s);
        shape.setAttribute("rx",     s * 0.28);
        shape.setAttribute("ry",     s * 0.28);
      } else {
        shape.setAttribute("cx", d.x);
        shape.setAttribute("cy", d.y);
        shape.setAttribute("r",  r);
      }

      shape.setAttribute("class", `wf-dot-shape wf-dot wf-dot-${tier}${isFocus ? " is-focus" : ""}`);
      // CO₂ colour: only when legend CO₂ layer is ON; focus accent overrides anyway
      shape.style.fill = (LEGEND.co2 && co2Color && !isFocus) ? co2Color : "";

      // Mode ring (outer cyan ring): only when transport layer is ON and train is available
      let modeRing = el.querySelector(".wf-dot-mode-ring");
      if(LEGEND.transport && d.hasTrain){
        if(!modeRing){
          modeRing = svgEl("circle", { class:"wf-dot-mode-ring" });
          el.appendChild(modeRing);
        }
        modeRing.setAttribute("cx", d.x);
        modeRing.setAttribute("cy", d.y);
        modeRing.setAttribute("r",  r + 3.5);
      } else if(modeRing){
        modeRing.remove();
      }
    }
  );

  gLayer.dots.classList.toggle("has-focus", !!(STATE.active || STATE.hovered));
}
function drawLabels(data){
  const g = gLayer.labels;
  const baseLimit = STATE.density==="rich" ? 12 : 6;
  const zoomBonus = Math.round(Math.pow(ZOOM.scale - 1, 0.8) * 14);
  const limit = Math.min(data.length, Math.max(4, baseLimit + zoomBonus));

  // Only label cities whose dot is currently inside the clip circle.
  // Transform dot position to SVG viewport space and check against R_MAX.
  const s = ZOOM.scale;
  function dotInView(d){
    const dx = s * (d.x - CX) + ZOOM.tx;
    const dy = s * (d.y - CY) + ZOOM.ty;
    return Math.hypot(dx, dy) < R_MAX - 4;
  }

  const top = data.slice(0, limit).filter(dotInView);
  const focusName = STATE.active || STATE.hovered;

  const placed = [];
  const approxCharW = 7.5;
  const approxH = 18;

  // Candidate placement angles: bearing direction first, then perpendiculars,
  // then opposite — gives us 8 distinct positions to try before giving up.
  function candidateAngles(bearingDeg){
    const b = bearingDeg - 90; // SVG angle
    return [b, b+90, b-90, b+45, b-45, b+135, b-135, b+180].map(toRad);
  }

  updateByName(
    g, top,
    (d) => {
      const el = svgEl("text", { class:"wf-label", "data-name": d.name });
      el.addEventListener("mouseenter", () => onHover(d.name));
      el.addEventListener("mouseleave", () => onHover(null));
      el.addEventListener("click",      () => onSelect(d.name));
      return el;
    },
    (el, d) => {
      const candidates = candidateAngles(d.bearingDeg);
      let lx, ly, bx, by, w, anchor;
      const baseOffset = 16;
      let placed_ok = false;

      // Effective clip radius in local map-zoom coordinates.
      // A label corner at local (x,y) is inside if Math.hypot(x-CX, y-CY) < R_CLIP_LOCAL.
      const R_CLIP_LOCAL = (R_MAX - 6) / ZOOM.scale;
      function boxFitsInClip(bx2, by2, w2, h2){
        const corners = [
          [bx2,      by2     ],
          [bx2 + w2, by2     ],
          [bx2,      by2 + h2],
          [bx2 + w2, by2 + h2],
        ];
        return corners.every(([cx3, cy3]) =>
          Math.hypot(cx3 - CX, cy3 - CY) < R_CLIP_LOCAL
        );
      }

      outer:
      for(let offStep = 0; offStep < 4; offStep++){
        const offset = baseOffset + offStep * 12;
        for(const θ of candidates){
          const cx2 = d.x + offset * Math.cos(θ);
          const cy2 = d.y + offset * Math.sin(θ);
          const anc  = Math.cos(θ) > 0.25 ? "start" : Math.cos(θ) < -0.25 ? "end" : "middle";
          w  = d.name.length * approxCharW;
          bx = anc === "start" ? cx2 : anc === "end" ? cx2 - w : cx2 - w/2;
          by = cy2 - approxH/2;
          const overlap = placed.some(p =>
            bx < p.bx + p.w + 4 && bx + w > p.bx - 4 &&
            by < p.by + p.h + 2 && by + p.h > p.by - 2
          );
          if(!overlap && boxFitsInClip(bx, by, w, approxH)){
            lx = cx2; ly = cy2; anchor = anc;
            placed_ok = true;
            break outer;
          }
        }
      }
      if(!placed_ok){
        // Fallback: place toward center (inward) so it stays inside the clip.
        const inwardθ = Math.atan2(CY - d.y, CX - d.x);
        const offset = baseOffset + 4;
        lx = d.x + offset * Math.cos(inwardθ);
        ly = d.y + offset * Math.sin(inwardθ);
        anchor = Math.cos(inwardθ) > 0.25 ? "start" : Math.cos(inwardθ) < -0.25 ? "end" : "middle";
        w  = d.name.length * approxCharW;
        bx = anchor === "start" ? lx : anchor === "end" ? lx - w : lx - w/2;
        by = ly - approxH/2;
      }
      placed.push({ bx, by, w, h: approxH });

      const i = top.indexOf(d);
      const cls = i<3 ? "wf-label wf-label-major" : (i<7 ? "wf-label" : "wf-label wf-label-dim");
      el.setAttribute("class", cls);
      el.setAttribute("x", lx);
      el.setAttribute("y", ly);
      el.setAttribute("text-anchor", anchor);
      el.setAttribute("dominant-baseline", "middle");
      el.textContent = d.name;

      el.style.display = (focusName && focusName === d.name) ? "none" : "";
    }
  );
}

/* ────────── DRAW: ACTIVE/HOVER OVERLAY ────────── */
function drawOverlay(data){
  const g = gLayer.active;
  g.innerHTML = "";
  const focus = STATE.active || STATE.hovered;
  if(!focus) return;
  const d = data.find(x=>x.name===focus);
  if(!d) return;
  // 1) connector origin→destination
  g.appendChild(svgEl("line",{
    x1:CX, y1:CY, x2:d.x, y2:d.y,
    class:"wf-connector"
  }));
  // 2) ring at destination
  g.appendChild(svgEl("circle",{cx:d.x,cy:d.y,r:12/Math.pow(ZOOM.scale,1.5),class:"wf-focus-ring"}));
  // 3) label — placed using the same clip-aware logic as drawLabels
  const approxCharW = 7.5, approxH = 20;
  const R_CLIP_LOCAL = (R_MAX - 6) / ZOOM.scale;
  function fitsInClip(bx2, by2, w2, h2){
    return [[bx2,by2],[bx2+w2,by2],[bx2,by2+h2],[bx2+w2,by2+h2]]
      .every(([cx3,cy3]) => Math.hypot(cx3-CX, cy3-CY) < R_CLIP_LOCAL);
  }
  const w = d.name.length * approxCharW;
  // Try bearing direction first, then inward, then the 6 other candidates
  const bearingθ = toRad(d.bearingDeg - 90);
  const inwardθ  = Math.atan2(CY - d.y, CX - d.x);
  const tryAngles = [bearingθ, inwardθ,
    bearingθ+Math.PI/2, bearingθ-Math.PI/2,
    bearingθ+Math.PI/4, bearingθ-Math.PI/4, bearingθ+Math.PI];
  let lx = d.x + 20*Math.cos(bearingθ);
  let ly = d.y + 20*Math.sin(bearingθ);
  let anchor = Math.cos(bearingθ) > 0.25 ? "start" : Math.cos(bearingθ) < -0.25 ? "end" : "middle";
  for(const a of tryAngles){
    const cx2 = d.x + 20*Math.cos(a);
    const cy2 = d.y + 20*Math.sin(a);
    const anc  = Math.cos(a) > 0.25 ? "start" : Math.cos(a) < -0.25 ? "end" : "middle";
    const bx2  = anc==="start" ? cx2 : anc==="end" ? cx2-w : cx2-w/2;
    const by2  = cy2 - approxH/2;
    if(fitsInClip(bx2, by2, w, approxH)){ lx=cx2; ly=cy2; anchor=anc; break; }
  }
  const t = svgEl("text",{x:lx,y:ly,class:"wf-label wf-label-focus","text-anchor":anchor,"dominant-baseline":"middle"});
  t.textContent = d.name;
  t.addEventListener("mouseenter", () => onHover(focus));
  t.addEventListener("mouseleave", () => onHover(null));
  t.addEventListener("click",      () => onSelect(focus));
  g.appendChild(t);
  // Apply current zoom scale so the focus label is always the right screen size
  const sqrtS = Math.sqrt(ZOOM.scale);
  t.style.fontSize = (20 / sqrtS) + "px";
}

/* ────────── MINI EUROPE MAP (real coastline) ────────── */
const MINI = { W: 240, H: 216, latMin: 34, latMax: 71, lonMin: -25, lonMax: 32 };
function miniProject(lat, lon){
  const x = (lon - MINI.lonMin) / (MINI.lonMax - MINI.lonMin) * MINI.W;
  // Mercator projection — gives Europe its familiar realistic proportions
  const merc = l => Math.log(Math.tan(Math.PI / 4 + toRad(l) / 2));
  const yMin = merc(MINI.latMin);
  const yMax = merc(MINI.latMax);
  const y = (1 - (merc(lat) - yMin) / (yMax - yMin)) * MINI.H;
  return [x, y];
}
function polygonPath(latLonArr){
  return latLonArr.map(([la,lo], i)=>{
    const [x,y] = miniProject(la, lo);
    return (i===0?"M":"L") + x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ") + " Z";
}

function miniGeoJSONPolygonPath(coords){
  return coords.map(ring => {
    return ring.map(([lon, lat], i) => {
      const [x, y] = miniProject(lat, lon);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ") + " Z";
  }).join(" ");
}

function drawMiniLand(){
  if (!miniLandEl) return;
  miniLandEl.innerHTML = "";
  miniGratEl.innerHTML = "";

  for (let la = Math.ceil(MINI.latMin / 10) * 10; la <= MINI.latMax; la += 10) {
    const [, y1] = miniProject(la, MINI.lonMin);
    miniGratEl.appendChild(svgEl("line", {
      x1: 0, y1, x2: MINI.W, y2: y1, class: "wf-mini-grat"
    }));
  }

  for (let lo = Math.ceil(MINI.lonMin / 10) * 10; lo <= MINI.lonMax; lo += 10) {
    const [x1] = miniProject(MINI.latMin, lo);
    miniGratEl.appendChild(svgEl("line", {
      x1, y1: 0, x2: x1, y2: MINI.H, class: "wf-mini-grat"
    }));
  }

  const geo = window.WF.EUROPE_GEOJSON;
  if (!geo || !geo.features) return;

  geo.features.forEach(f => {
    const geom = f.geometry;
    if (!geom) return;

    if (geom.type === "Polygon") {
      miniLandEl.appendChild(svgEl("path", {
        d: miniGeoJSONPolygonPath(geom.coordinates),
        class: "wf-mini-land"
      }));
    }

    if (geom.type === "MultiPolygon") {
      geom.coordinates.forEach(poly => {
        miniLandEl.appendChild(svgEl("path", {
          d: miniGeoJSONPolygonPath(poly),
          class: "wf-mini-land"
        }));
      });
    }
  });
}

/* ────────── POPULARITY GLOW LAYER ────────── */
/* Visual language: "elevation plateau" — violet-silver halo that only
   appears for genuinely popular destinations (pop ≥ 35). Below that
   threshold nothing renders so low-tourism spots stay invisible in this
   layer, creating a clear hierarchy. The colour is --wf-violet so it
   doesn't clash with the orange/red/green CO₂ palette. */
function drawPopGlow(data){
  const g = gLayer.popGlow;
  if(!g) return;
  g.innerHTML = "";
  if(!LEGEND.pop) return;

  /* Ensure a single <defs> + blur filter lives in the parent SVG. */
  const svg = g.closest("svg");
  let defs = svg.querySelector("defs");
  if(!defs){ defs = svgEl("defs", {}); svg.insertBefore(defs, svg.firstChild); }

  /* Soft diffuse glow filter */
  const FBLUR_ID = "wf-pop-blur";
  if(!defs.querySelector(`#${FBLUR_ID}`)){
    const flt = svgEl("filter", {
      id: FBLUR_ID, x:"-120%", y:"-120%", width:"340%", height:"340%",
      colorInterpolationFilters: "sRGB",
    });
    const blur = svgEl("feGaussianBlur", { in:"SourceGraphic", stdDeviation:"9" });
    flt.appendChild(blur);
    defs.appendChild(flt);
  }

  /* Tight inner glow filter */
  const FBLUR_TIGHT = "wf-pop-blur-tight";
  if(!defs.querySelector(`#${FBLUR_TIGHT}`)){
    const flt2 = svgEl("filter", {
      id: FBLUR_TIGHT, x:"-80%", y:"-80%", width:"260%", height:"260%",
      colorInterpolationFilters: "sRGB",
    });
    const blur2 = svgEl("feGaussianBlur", { in:"SourceGraphic", stdDeviation:"4" });
    flt2.appendChild(blur2);
    defs.appendChild(flt2);
  }

  /* Colour: violet-silver — harmonious with palette, unambiguously ≠ CO₂ */
  const C = "var(--wf-violet)";     // #9d8fc7

/* =========================================================
 * POPULARITY ELEVATION LAYER
 *
 * Visual philosophy:
 * - low popularity  -> almost invisible atmosphere
 * - medium          -> visible soft elevation
 * - high            -> structured prominence
 * - elite           -> topographic peak
 *
 * IMPORTANT:
 * Hierarchy comes from STRUCTURE,
 * not just opacity.
 * ========================================================= */

data.forEach(d => {

  const pop = d.pop ?? 0;

  // Ignore weak destinations
  if (pop < 55) return;

  const tRaw = Math.max(
    0,
    Math.min(1, (pop - 55) / 45)
  );

  // Softer emphasis curve
  // Keeps mid-tier destinations visible
  const t = Math.pow(tRaw, 1.2);


  /* =========================================================
   * SUBTLE POSITION JITTER
   *
   * Prevents "perfect Photoshop glow" look.
   * Tiny offsets only for outer atmospheres.
   * ========================================================= */

  const jx = (Math.random() - 0.5) * 1.2;
  const jy = (Math.random() - 0.5) * 1.2;


  /* =========================================================
   * LAYER 1 — ATMOSPHERIC DIFFUSION
   *
   * Large soft halo.
   * Creates regional presence.
   * ========================================================= */

  {
    const r = 8 + t * 44;               // 8 → 52
    const opacity = 0.05 + t * 0.22;   // 0.05 → 0.27

    g.appendChild(svgEl("circle", {
      cx: d.x + jx,
      cy: d.y + jy,
      r,
      fill: C,
      opacity,
      class: "wf-pop-glow-outer",
    }));
  }


  /* =========================================================
   * LAYER 2 — ELEVATION MASS
   *
   * Main visible hotspot body.
   * ========================================================= */

  {
    const r = 5 + t * 22;               // 5 → 27
    const opacity = 0.08 + t * 0.30;   // 0.08 → 0.38

    g.appendChild(svgEl("circle", {
      cx: d.x,
      cy: d.y,
      r,
      fill: C,
      opacity,
      class: "wf-pop-glow-inner",
    }));
  }


  /* =========================================================
   * LAYER 3 — INNER CORE
   *
   * Bright focal hotspot.
   * ========================================================= */

  if (pop >= 68) {

    const tCore = Math.max(
      0,
      Math.min(1, (pop - 68) / 32)
    );

    const r = 1.6 + tCore * 3.2;        // 1.6 → 4.8
    const opacity = 0.30 + tCore * 0.45;

    g.appendChild(svgEl("circle", {
      cx: d.x,
      cy: d.y,
      r,
      fill: "#ffffff",
      opacity,
      class: "wf-pop-core",
    }));
  }


  /* =========================================================
   * LAYER 4 — PRIMARY TOPOGRAPHIC RING
   *
   * Analytical contour ring.
   * ========================================================= */

  if (pop >= 82) {

    const tRing = Math.max(
      0,
      Math.min(1, (pop - 82) / 18)
    );

    g.appendChild(svgEl("circle", {
      cx: d.x,
      cy: d.y,
      r: 10 + tRing * 4,                // 10 → 14
      fill: "none",
      stroke: C,
      "stroke-width": 0.8 + tRing * 0.6,
      opacity: 0.22 + tRing * 0.28,
      class: "wf-pop-ring",
    }));
  }


  /* =========================================================
   * LAYER 5 — ELITE SECONDARY CONTOUR
   *
   * Reserved for top-tier destinations.
   * ========================================================= */

  if (pop >= 93) {

    const tElite = Math.max(
      0,
      Math.min(1, (pop - 93) / 7)
    );

    g.appendChild(svgEl("circle", {
      cx: d.x,
      cy: d.y,
      r: 18 + tElite * 5,               // 18 → 23
      fill: "none",
      stroke: "#ffffff",
      "stroke-width": 0.5,
      opacity: 0.12 + tElite * 0.18,
      class: "wf-pop-ring wf-pop-ring--outer",
    }));
  }

});

}

/* ────────── RIGHT-SIDE RANKING ────────── */
const MEDAL = {
  1: { icon: "🏆", label: "Best match"   },
  2: { icon: "🥈", label: "Silver pick"  },
  3: { icon: "🥉", label: "Bronze pick"  },
  4: { label: "4th"  }, 5: { label: "5th"  }, 6: { label: "6th"  },
  7: { label: "7th"  }, 8: { label: "8th"  }, 9: { label: "9th"  },
  10:{ label: "10th" },
};

function drawRanking(data){
  if(!listEl) return;
  const top = data.slice(0, 10);
  rankCountEl.textContent = top.length;
  const preset = PRESETS.find(p=>p.id===STATE.presetId);
  rankPresetEl.textContent = preset ? preset.label.toLowerCase() : STATE.presetId;

  // ───── FLIP: capture old positions of cards still in DOM ─────
  const oldRects = new Map();
  Array.from(listEl.querySelectorAll(".wf-rank-card")).forEach(el => {
    oldRects.set(el.getAttribute("data-name"), el.getBoundingClientRect());
  });

  // ───── Re-render ─────
  listEl.innerHTML = "";
  top.forEach((d, i)=>{
    const el = document.createElement("button");
    const rankCls = d.rank <= 3 ? ` is-rank-${d.rank}` : "";
    el.className = "wf-rank-card" + (i===0 ? " is-top" : "") + rankCls;
    el.setAttribute("data-name", d.name);
    if(STATE.active === d.name) el.classList.add("is-active");
    if(STATE.hovered === d.name) el.classList.add("is-hover");
    
    const primaryUrl = d.photoUrl || photoURL(d.photoId, 240);
    const fallbackUrl = fallbackPhotoURL(d.iata || d.name, 240);
    const imgTag = `<img class="wf-rank-photo-img" src="${primaryUrl || fallbackUrl}" data-fb="${fallbackUrl}" alt="" loading="lazy" onerror="if(this.dataset.fb && this.src!==this.dataset.fb){this.src=this.dataset.fb;}else{this.style.display='none';}">`;

    const medal = MEDAL[d.rank];
    /* Rank badge for all top-10 cards. Ranks 1–3 get a filled medal disc;
       ranks 4–10 get a subtle ghost disc so position is still readable. */
    const medalInline = medal
      ? `<span class="wf-rank-medal-inline is-rank-${d.rank}" title="${medal.label}" aria-label="${medal.label}"><span class="medal-disc">${d.rank}</span></span>`
      : "";

    el.innerHTML = `
      <div class="wf-rank-photo">
        ${imgTag}
        <div class="match-pill"><span class="match-num">${d.matchPct}</span><span class="match-unit">match</span></div>
      </div>
      <div class="wf-rank-body">
        <div class="wf-rank-title-row">
          <h4 class="wf-rank-name">${d.name}</h4>
          ${medalInline}
        </div>
        <div class="wf-rank-sub">
          <span>${d.country}</span>
        </div>
        <div class="wf-rank-metrics">
          <div class="wf-rank-m"><span class="wf-rank-m-v">${(()=>{const hh=Math.floor(d.time),mm=Math.round((d.time-hh)*60);return mm>0?`${hh}h ${mm}m`:`${hh}h`;})()}</span><span class="wf-rank-m-l">Travel</span></div>
          <div class="wf-rank-m"><span class="wf-rank-m-v">€${d.cost}</span><span class="wf-rank-m-l">Fare</span></div>
          <div class="wf-rank-m"><span class="wf-rank-m-v">${d.co2}kg</span><span class="wf-rank-m-l">CO₂</span></div>
          <div class="wf-rank-m"><span class="wf-rank-m-v" style="color:var(--wf-highlight);font-size:11px;letter-spacing:.04em;">${"★".repeat(Math.round((d.pop||0)/20))}${"☆".repeat(5-Math.round((d.pop||0)/20))}</span><span class="wf-rank-m-l">Popularity</span></div>
        </div>
      </div>
    `;
    el.addEventListener("mouseenter", ()=> onHover(d.name));
    el.addEventListener("mouseleave", ()=> onHover(null));
    el.addEventListener("click",      ()=> openDetail(d.name));
    listEl.appendChild(el);
  });

  // ───── FLIP: animate cards from their old positions to new ones ─────
  Array.from(listEl.querySelectorAll(".wf-rank-card")).forEach(el => {
    const name = el.getAttribute("data-name");
    const old = oldRects.get(name);
    if(!old) return;
    const cur = el.getBoundingClientRect();
    const dy = old.top - cur.top;
    if(Math.abs(dy) < 1) return;
    el.style.transform = `translateY(${dy}px)`;
    el.style.transition = "none";
    // Force reflow, then animate to zero.
    el.getBoundingClientRect();
    el.style.transition = "transform .5s cubic-bezier(.2,.7,.2,1), border-color .25s, background .25s, box-shadow .25s";
    el.style.transform = "";
  });
}

/* ────────── DETAIL MODAL ────────── */

// Build a quality-bucket label from the underlying metrics.
function emissionTag(co2){
  if(co2 == null) return { lab:"—",       cls:"is-neutral" };
  if(co2 < 15)    return { lab:"Pure",    cls:"is-pure"    };
  if(co2 < 60)    return { lab:"Moderate",cls:"is-neutral" };
  return                  { lab:"Heavy",  cls:"is-tight"   };
}
function popularityTag(pop){
  if(pop == null) return { lab:"—",       cls:"is-neutral" };
  if(pop >= 75)   return { lab:"Tight",   cls:"is-tight"   };
  if(pop >= 45)   return { lab:"Active",  cls:"is-neutral" };
  return                  { lab:"Serene", cls:"is-serene"  };
}
function seasonalityTag(d){
  if(!d.seasons || !STATE.month==null) return { lab:"Open", cls:"is-neutral" };
  const ORDER = ["January","February","March","April","May","June",
                 "July","August","September","October","November","December"];
  const m = ORDER[STATE.month];
  if(!m || !d.seasons) return { lab:"Open", cls:"is-neutral" };
  if(d.seasons.high   && d.seasons.high.includes(m))   return { lab:"Tight",  cls:"is-tight"   };
  if(d.seasons.medium && d.seasons.medium.includes(m)) return { lab:"Active", cls:"is-neutral" };
  if(d.seasons.low    && d.seasons.low.includes(m))    return { lab:"Serene", cls:"is-serene"  };
  return { lab:"Open", cls:"is-neutral" };
}

const TRANSPORT_ICON = {
  train: `<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="14" rx="3"/><line x1="5" y1="11" x2="19" y2="11"/><circle cx="9" cy="14" r="1" fill="currentColor"/><circle cx="15" cy="14" r="1" fill="currentColor"/><line x1="7" y1="20" x2="9" y2="17"/><line x1="17" y1="20" x2="15" y2="17"/></svg>`,
  flight: `<svg viewBox="0 0 24 24"><path d="M21 12c0-.7-.4-1.2-1-1.4l-7-2.4V3.5c0-.8-.7-1.5-1.5-1.5S10 2.7 10 3.5v4.7L3 10.6c-.6.2-1 .8-1 1.4 0 .5.4 1 1 1l7-1v4.6l-2 1.4v1l3-.6 3 .6v-1l-2-1.4V12l7 1c.6 0 1-.5 1-1z" stroke="none" fill="currentColor"/></svg>`,
};

function getCellFor(city){
  const mk = currentMonthKey();
  if(!mk || !WF.MONTHLY) return null;
  const byO = WF.MONTHLY[STATE.originKey];
  if(!byO || !city.iata) return null;
  const byM = byO[city.iata];
  return (byM && byM[mk]) || null;
}

function modePillCo2(co2){
  if(co2 == null) return "";
  const cls = co2 < 15 ? "low" : co2 < 60 ? "mid" : "high";
  return `<span class="co2-dot ${cls}"></span>`;
}

function transportRowHTML(mode, info, isBest, isNA){
  const icon = TRANSPORT_ICON[mode] || "";
  if(isNA){
    return `<div class="wf-transport-row is-na">
      <div class="wf-transport-icon">${icon}</div>
      <div class="wf-transport-main">
        <div class="wf-transport-co2">— CO₂e</div>
        <div class="wf-transport-mode">${mode}</div>
      </div>
      <div class="wf-transport-side">
        <div class="wf-transport-time">unavailable</div>
        <div class="wf-transport-cost">—</div>
      </div>
    </div>`;
  }
  const co2 = info.co2 ?? "?";
  const hh = Math.floor(info.time);
  const mm = Math.round((info.time - hh) * 60);
  const timeStr = `${hh} hr ${mm.toString().padStart(2,"0")} min`;
  const cost = info.cost!=null ? `€${info.cost}` : "—";
  return `<div class="wf-transport-row${isBest ? " is-best" : ""}">
    <div class="wf-transport-icon">${icon}</div>
    <div class="wf-transport-main">
      <div class="wf-transport-co2">${co2} kg CO₂e ${modePillCo2(info.co2)}</div>
      <div class="wf-transport-mode">${mode}</div>
    </div>
    <div class="wf-transport-side">
      <div class="wf-transport-time">${timeStr}</div>
      <div class="wf-transport-cost">${cost}</div>
    </div>
  </div>`;
}

function buildDetailModalBody(d, cell){
  const emis = emissionTag(d.co2);
  const popT = popularityTag(d.pop);
  const seas = seasonalityTag(d);

  const hasFlight = !!(cell && cell.flight);
  const hasTrain  = !!(cell && cell.train);
  const preferTrain = pickBestMode(
    hasTrain  ? cell.train  : null,
    hasFlight ? cell.flight : null,
    STATE.weights
  );

  const seasonStrip = (()=>{
    if(!d.seasons) return "";
    const SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const ORDER = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"];
    const highSet = new Set(d.seasons.high   || []);
    const medSet  = new Set(d.seasons.medium || []);
    const curIdx  = STATE.month; // 0-based, null if not set
    const pills = ORDER.map((m,i) => {
      const cls = highSet.has(m) ? "" : medSet.has(m) ? " is-med" : " is-low";
      const isCur = (curIdx === i) ? " is-current" : "";
      const tipText = highSet.has(m) ? "Peak season — high demand & prices" :
                      medSet.has(m)  ? "Shoulder season — good balance" :
                                       "Off-peak — quieter, cheaper";
      return `<span class="wf-detail-month${cls}${isCur}" title="${tipText}">${SHORT[i]}</span>`;
    }).join("");
    return `<div class="wf-detail-season">
      <div class="wf-detail-season-header">
        <div class="wf-detail-season-label">Best time to visit
          <span class="wf-season-help" title="Colour guide: teal = peak season (busy &amp; pricey), amber = shoulder (great balance), grey = off-peak (quietest). Your selected month is highlighted.">?</span>
        </div>
        <div class="wf-season-legend">
          <span class="wf-season-legend-dot is-high"></span><span>Peak</span>
          <span class="wf-season-legend-dot is-med"></span><span>Shoulder</span>
          <span class="wf-season-legend-dot is-low"></span><span>Off-peak</span>
        </div>
      </div>
      <div class="wf-detail-season-months">${pills}</div>
    </div>`;
  })();

  const interestsHTML = (()=>{
    if(!d.interests || !d.interests.length) return "";
    const MAX = 6;
    const shown = d.interests.slice(0, MAX);
    const extra = d.interests.length - MAX;
    const rows = shown.map(it => {
      const icon = INTEREST_ICON[it.type] || "📍";
      const safeTitle = (it.title||"").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      return `<div class="wf-detail-interest" title="${it.text ? it.text.replace(/"/g,"&quot;") : ""}"><span class="wf-detail-interest-icon">${icon}</span><span class="wf-detail-interest-title">${safeTitle}</span></div>`;
    }).join("");
    const moreRow = extra > 0 ? `<div class="wf-detail-more">+${extra} more highlights</div>` : "";
    return `<div>
      <div class="wf-detail-section-head">
        <h4 class="wf-detail-section-title">Highlights</h4>
        <div class="wf-detail-section-meta">curated from wikivoyage</div>
      </div>
      <div class="wf-detail-interests">${rows}${moreRow}</div>
    </div>`;
  })();

  let smartLabel = "—";
  let smartReason = `based on your current weights (CO₂ ${Math.round(STATE.weights.co2*100)}%)`;
  if(hasFlight || hasTrain){
    smartLabel = preferTrain ? "Train" : "Flight";
    if(hasFlight && hasTrain){
      const tr = cell.train, fl = cell.flight;
      const timeDiff = Math.abs(fl.time - tr.time);
      const costSave = fl.cost - tr.cost;
      if(preferTrain && costSave > 20 && timeDiff < 3)
        smartReason = `saves €${costSave} with only ${Math.round(timeDiff*60)} min extra`;
      else if(!preferTrain && fl.time < tr.time * 0.7)
        smartReason = `${Math.round((tr.time - fl.time)*60)} min faster`;
      else if(!preferTrain && fl.cost > tr.cost * 1.5)
        smartReason = `time weight (${Math.round(STATE.weights.time*100)}%) outweighs cost saving`;
    }
  }

  return `
    <p class="wf-detail-insight">${d.insight || ""}</p>

    <div class="wf-detail-badges">
      <div class="wf-detail-badge">
        <div class="wf-detail-badge-label">Emission impact</div>
        <div class="wf-detail-badge-pill ${emis.cls}"><span class="pip"></span>${emis.lab}</div>
      </div>
      <div class="wf-detail-badge">
        <div class="wf-detail-badge-label">Popularity</div>
        <div class="wf-detail-badge-pill ${popT.cls}"><span class="pip"></span>${popT.lab}</div>
      </div>
      <div class="wf-detail-badge">
        <div class="wf-detail-badge-label">Seasonality</div>
        <div class="wf-detail-badge-pill ${seas.cls}"><span class="pip"></span>${seas.lab}</div>
      </div>
    </div>

    <div>
      <div class="wf-detail-section-head">
        <h4 class="wf-detail-section-title">Compare transportation</h4>
        <div class="wf-detail-section-meta" title="Door-to-door estimate: includes check-in buffer, transfers and last-mile travel">${currentMonthKey() || "—"} · door-to-door ⓘ</div>
      </div>
      <div class="wf-transport-list">
        ${hasTrain
          ? transportRowHTML("Train",  cell.train,  preferTrain, false)
          : transportRowHTML("Train",  null, false, true)}
        ${hasFlight
          ? transportRowHTML("Flight", cell.flight, !preferTrain && hasFlight, false)
          : transportRowHTML("Flight", null, false, true)}
      </div>
    </div>

    <div class="wf-smart-choice">
      <span class="lightbulb">💡</span>
      <span>Smart choice <b>${smartLabel}</b> — ${smartReason}.</span>
    </div>

    ${seasonStrip}
    ${interestsHTML}
  `;
}

function openDetail(name){
  const d = lastData.find(x=>x.name===name);
  if(!d) return;
  STATE.active = name;
  drawOverlay(lastData);
  drawMini(lastData);
  drawHeadline(lastData);
  if(listEl){
    listEl.querySelectorAll(".wf-rank-card").forEach(el=>{
      el.classList.toggle("is-active", el.getAttribute("data-name")===name);
    });
  }

  const overlay = document.getElementById("detail-overlay");
  const hero    = document.getElementById("detail-hero");
  const rankEl  = document.getElementById("detail-rank");
  const nameEl  = document.getElementById("detail-name");
  const countryEl = document.getElementById("detail-country");
  const subEl   = document.getElementById("detail-sub");
  const bodyEl  = document.getElementById("detail-body");
  if(!overlay) return;

  // Hero image — use <img> so onerror fallback works.
  hero.style.backgroundImage = "";
  let heroImg = hero.querySelector(".wf-detail-hero-img");
  if(!heroImg){
    heroImg = document.createElement("img");
    heroImg.className = "wf-detail-hero-img";
    heroImg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;";
    hero.insertBefore(heroImg, hero.firstChild);
  }

  const primary = d.photoUrl || photoURL(d.photoId, 800);  
  const fallback = fallbackPhotoURL(d.iata || d.name, 800);
  heroImg.src = primary || fallback;
  heroImg.style.display = "";
  heroImg.onerror = () => {
    if(heroImg.src !== fallback){ heroImg.src = fallback; }
    else { heroImg.style.display = "none"; }
  };

  // Rank pill (medal style for top 3)
  rankEl.className = "wf-detail-hero-rank" + (d.rank <= 3 ? ` is-medal-${d.rank}` : "");
  const medal = MEDAL[d.rank];
  rankEl.innerHTML = medal
    ? `<span style="font-size:14px;">${medal.icon}</span> #${d.rank} · ${medal.label}`
    : `#${d.rank} · ${d.matchPct}% match`;

  // Name + meta
  nameEl.firstChild.nodeValue = d.name;
  countryEl.textContent = ` ${d.country}`;
  subEl.textContent = `${d.matchPct}% composite match · ${currentMonthKey() || "—"}`;

  // Body
  const cell = getCellFor(d);
  bodyEl.innerHTML = buildDetailModalBody(d, cell);

  overlay.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function closeDetail(){
  const overlay = document.getElementById("detail-overlay");
  if(!overlay) return;
  overlay.classList.remove("is-open");
  document.body.style.overflow = "";
}

function wireDetail(){
  const overlay = document.getElementById("detail-overlay");
  const close   = document.getElementById("detail-close");
  if(!overlay || !close) return;
  close.addEventListener("click", closeDetail);
  overlay.addEventListener("click", (e)=>{
    if(e.target === overlay) closeDetail();
  });
  document.addEventListener("keydown", e=>{
    if(e.key === "Escape" && overlay.classList.contains("is-open")) closeDetail();
  });
}

/* ────────── ABOUT MODAL ────────── */
function wireAbout(){
  const overlay = document.getElementById("about-overlay");
  const btn     = document.getElementById("btn-about");
  const close   = document.getElementById("about-close");
  const close2  = document.getElementById("about-close-2");
  if(!overlay || !btn) return;
  const open  = ()=> { overlay.classList.add("is-open"); document.body.style.overflow="hidden"; };
  const shut  = ()=> { overlay.classList.remove("is-open"); document.body.style.overflow=""; };
  btn.addEventListener("click", open);
  close && close.addEventListener("click", shut);
  close2 && close2.addEventListener("click", shut);
  overlay.addEventListener("click", e=>{ if(e.target === overlay) shut(); });
}

/* ────────── MAP ZOOM + PAN ────────── */
const ZOOM = { scale: 1, min: 0.7, max: 4, tx: 0, ty: 0 };
function applyZoom(){
  const g = document.getElementById("map-zoom");
  if(!g) return;
  const baseT = 500 * (1 - ZOOM.scale);
  g.setAttribute("transform",
    `translate(${baseT + ZOOM.tx} ${baseT + ZOOM.ty}) scale(${ZOOM.scale})`);
  const lvl = document.getElementById("zoom-level");
  if(lvl) lvl.textContent = Math.round(ZOOM.scale * 100) + "%";
  // Re-render labels: counter-scale font + adjust semantic-zoom limit.
  if(lastData && lastData.length){ drawDots(lastData); drawLabels(lastData); }
  // Counter-scale label font so text stays readable at high zoom,
  // while preserving the major/normal/dim tier sizes.
  // Counter-scale by sqrt(zoom) so labels grow visibly when zooming in
  // (full 1/zoom would keep them constant; no division would make them huge).
  const sqrtScale = Math.sqrt(ZOOM.scale);
  const sizeFor = (cls)=>
    !cls ? 17 :
    cls.indexOf("wf-label-major") >= 0 ? 21 :
    cls.indexOf("wf-label-dim")   >= 0 ? 14 :
    17;
  g.querySelectorAll(".wf-label").forEach(el => {
    el.style.fontSize = (sizeFor(el.getAttribute("class")) / sqrtScale) + "px";
  });
  // Counter-scale inner structural labels (inside zoom group)
  g.querySelectorAll(".wf-ring-label").forEach(el => el.style.fontSize = (11 / ZOOM.scale) + "px");
  g.querySelectorAll(".wf-origin-label").forEach(el => el.style.fontSize = (20 / ZOOM.scale) + "px");
  g.querySelectorAll(".wf-origin-sub").forEach(el => el.style.fontSize = (9 / ZOOM.scale) + "px");
  // Cardinals are in the static layer — no counter-scale needed
}
function setZoom(s){
  ZOOM.scale = Math.max(ZOOM.min, Math.min(ZOOM.max, s));
  // Re-clamp pan whenever scale changes so tx/ty stay within the new bound.
  const maxPan = R_MAX * (ZOOM.scale - 1) / ZOOM.scale;
  ZOOM.tx = Math.max(-maxPan, Math.min(maxPan, ZOOM.tx));
  ZOOM.ty = Math.max(-maxPan, Math.min(maxPan, ZOOM.ty));
  applyZoom();
}
function resetView(){
  ZOOM.scale = 1; ZOOM.tx = 0; ZOOM.ty = 0;
  applyZoom();
}
function wireZoom(){
  const svg = document.getElementById("map");
  const ctrlIn  = document.getElementById("zoom-in");
  const ctrlOut = document.getElementById("zoom-out");
  const ctrlRst = document.getElementById("zoom-reset");
  if(!svg) return;
  svg.addEventListener("wheel", (e)=>{
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setZoom(ZOOM.scale * factor);
    const hint = document.getElementById("zoom-hint");
    if(hint) hint.classList.add("is-faded");
  }, { passive: false });
  ctrlIn  && ctrlIn .addEventListener("click", ()=> { setZoom(ZOOM.scale * 1.25); const h=document.getElementById("zoom-hint"); if(h) h.classList.add("is-faded"); });
  ctrlOut && ctrlOut.addEventListener("click", ()=> { setZoom(ZOOM.scale / 1.25); const h=document.getElementById("zoom-hint"); if(h) h.classList.add("is-faded"); });
  ctrlRst && ctrlRst.addEventListener("click", resetView);
  /* Hint auto-fades after a few seconds even if the user never zooms,
     so it doesn't sit on top of the map indefinitely. */
  setTimeout(()=>{
    const h = document.getElementById("zoom-hint");
    if(h) h.classList.add("is-faded");
  }, 5500);

  // Drag to pan — only kicks in when the pointer started on empty map
  // (not on a dot, label, or origin marker) so clicks still select cities.
  let dragging = false, startX=0, startY=0, startTx=0, startTy=0;
  svg.addEventListener("pointerdown", (e)=>{
    if(e.target.closest(".wf-dot-g, .wf-rank-card, #g-origin")) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    startTx = ZOOM.tx;  startTy = ZOOM.ty;
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = "grabbing";
  });
  svg.addEventListener("pointermove", (e)=>{
    if(!dragging) return;
    // Convert pixel delta to viewBox units (viewBox is 1000 wide, but SVG
    // is sized via CSS; rect gives us the px size of the visible SVG).
    const r = svg.getBoundingClientRect();
    const vbScale = 1000 / r.width;
    const rawTx = startTx + (e.clientX - startX) * vbScale;
    const rawTy = startTy + (e.clientY - startY) * vbScale;
    // Clamp pan so the origin can't leave the outer ring.
    // At scale s, the max meaningful offset in SVG units is R_MAX*(s-1)/s
    // — beyond that the centre of the map would exit the compass frame.
    const maxPan = R_MAX * (ZOOM.scale - 1) / ZOOM.scale;
    ZOOM.tx = Math.max(-maxPan, Math.min(maxPan, rawTx));
    ZOOM.ty = Math.max(-maxPan, Math.min(maxPan, rawTy));
    applyZoom();
  });
  const endDrag = (e)=>{
    if(!dragging) return;
    dragging = false;
    try { svg.releasePointerCapture(e.pointerId); } catch(_){}
    svg.style.cursor = "";
  };
  svg.addEventListener("pointerup",     endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("pointerleave",  endDrag);

  applyZoom();
}
function drawHeadline(data){
  const focusName = STATE.active || STATE.hovered;
  const d = focusName ? data.find(x=>x.name===focusName) : data[0];
  if(!d) return;
  /* City + country on one row — country as a small inline meta string,
     not a separate line, so the panel reads as one block. */
  matchNameEl.innerHTML = `${d.name}<span class="wf-headline-country">${d.country}</span>`;
  const eyebrowEl = document.getElementById("match-eyebrow");
  if(eyebrowEl){
    eyebrowEl.textContent = focusName
      ? (`Rank · ${ord(d.rank)}`)
      : "Best match · composite score";
  }
  const _hh=Math.floor(d.time),_mm=Math.round((d.time-_hh)*60);
  /* Bearing removed — the radial position on the map already encodes direction.
     Subtitle shows the three core travel metrics, cleanly grouped. */
  const _timeStr = _mm>0 ? `${_hh}h ${_mm}m` : `${_hh}h`;
  matchSubEl.innerHTML  = `<span class="wf-h-metric"><b>${_timeStr}</b><i>travel</i></span><span class="wf-h-metric"><b>€${d.cost}</b><i>fare</i></span><span class="wf-h-metric"><b>${d.co2}<u>kg</u></b><i>CO₂</i></span>`;
  matchPctEl.textContent  = d.matchPct;
  insightEl.textContent   = d.insight;
}

/* ────────── INTERACTIONS ────────── */
let lastData = [];
function onHover(name){
  if(STATE.hovered === name) return;
  STATE.hovered = name;
  drawOverlay(lastData);
  // Hide the g-labels text for whichever city now has the overlay label,
  // so it doesn't double-render (white text behind the green italic one).
  _syncLabelVisibility();
  drawMini(lastData);
  drawHeadline(lastData);
  if(listEl){
    listEl.querySelectorAll(".wf-rank-card").forEach(el=>{
      el.classList.toggle("is-hover", el.getAttribute("data-name")===name);
    });
  }
  gLayer.dots.classList.toggle("has-focus", !!(name || STATE.active));
  gLayer.dots.querySelectorAll(".wf-dot-g").forEach(g=>{
    const isFocus = g.getAttribute("data-name") === (name || STATE.active);
    const dot = g.querySelector(".wf-dot");
    if(dot) dot.classList.toggle("is-focus", isFocus);
  });
}
function _syncLabelVisibility(){
  if(!gLayer || !gLayer.labels) return;
  const focus = STATE.active || STATE.hovered;
  gLayer.labels.querySelectorAll("[data-name]").forEach(el => {
    el.style.display = (focus && el.getAttribute("data-name") === focus) ? "none" : "";
  });
}
function closeDotPopup(){
  if(dotPopupEl) dotPopupEl.hidden = true;
}

function showDotPopup(d, clickEvent){
  if(!dotPopupEl) return;

  // Position popup using the click coordinates relative to the stage container
  const stageRect = dotPopupEl.parentElement.getBoundingClientRect();
  const dotX = clickEvent.clientX - stageRect.left;
  const dotY = clickEvent.clientY - stageRect.top;

  const popW = 220, popH = 290;
  let left = dotX + 12;
  let top  = dotY - 50;
  if(left + popW > stageRect.width - 8)  left = dotX - popW - 12;
  if(top + popH  > stageRect.height - 8) top  = stageRect.height - popH - 8;
  if(top < 8) top = 8;
  dotPopupEl.style.left = left + "px";
  dotPopupEl.style.top  = top  + "px";

  // Populate content
  dotPopupRankEl.textContent    = `#${d.rank}`;
  dotPopupNameEl.textContent    = d.name;
  dotPopupCountryEl.textContent = d.country;
  dotPopupMatchEl.textContent   = `${d.matchPct}%`;

  const photoSrc = d.photoUrl || photoURL(d.photoId, 240) || fallbackPhotoURL(d.iata || d.name, 240);
  const fbSrc    = fallbackPhotoURL(d.iata || d.name, 240);
  dotPopupPhotoEl.src = photoSrc || fbSrc;
  dotPopupPhotoEl.dataset.fb = fbSrc;
  dotPopupPhotoEl.onerror = function(){
    if(this.dataset.fb && this.src !== this.dataset.fb){ this.src = this.dataset.fb; }
    else { this.style.display = "none"; }
  };

  const hh = Math.floor(d.time), mm = Math.round((d.time - hh) * 60);
  const timeStr = mm > 0 ? `${hh}h ${mm}m` : `${hh}h`;
  dotPopupMetricsEl.innerHTML = `
    <div class="wf-dot-popup-metric"><span class="wf-dot-popup-metric-v">${timeStr}</span><span class="wf-dot-popup-metric-l">Travel</span></div>
    <div class="wf-dot-popup-metric"><span class="wf-dot-popup-metric-v">€${d.cost}</span><span class="wf-dot-popup-metric-l">Fare</span></div>
    <div class="wf-dot-popup-metric"><span class="wf-dot-popup-metric-v">${d.co2}kg</span><span class="wf-dot-popup-metric-l">CO₂</span></div>
  `;

  // Tags: budget, walkability, aqi
  const tags = [];
  const city = WF.CITIES.find(c => c.name === d.name);
  if(city){
    if(city.budget)      tags.push({ label: city.budget + " budget",  cls: city.budget === "Low" ? "is-good" : city.budget === "High" ? "is-mid" : "" });
    if(city.walkability) tags.push({ label: "Walk: " + city.walkability, cls: (city.walkability === "Great" || city.walkability === "Good") ? "is-good" : "" });
    if(city.aqi)         tags.push({ label: "Air: " + city.aqi,          cls: (city.aqi === "Great" || city.aqi === "Good") ? "is-good" : city.aqi === "Poor" ? "is-mid" : "" });
  }
  dotPopupTagsEl.innerHTML = tags.map(t => `<span class="wf-dot-popup-tag ${t.cls}">${t.label}</span>`).join("");

  dotPopupInsightEl.textContent = (city && city.insight) ? city.insight : (d.insight || "");

  dotPopupEl.hidden = false;
}

function onSelect(name){
  STATE.active = (STATE.active === name) ? null : name;
  drawOverlay(lastData);
  _syncLabelVisibility();
  drawMini(lastData);
  drawHeadline(lastData);
  if(listEl){
    listEl.querySelectorAll(".wf-rank-card").forEach(el=>{
      el.classList.toggle("is-active", el.getAttribute("data-name")===STATE.active);
    });
  }
  gLayer.dots.classList.toggle("has-focus", !!(STATE.active || STATE.hovered));
  gLayer.dots.querySelectorAll(".wf-dot-g").forEach(g=>{
    const isFocus = g.getAttribute("data-name") === (STATE.active || STATE.hovered);
    const dot = g.querySelector(".wf-dot");
    if(dot) dot.classList.toggle("is-focus", isFocus);
  });
  if(STATE.active && listEl){
    const el = listEl.querySelector(`.wf-rank-card[data-name="${CSS.escape(STATE.active)}"]`);
    if(el){
      const top = el.offsetTop - listEl.offsetTop - 12;
      listEl.scrollTo({top, behavior:"smooth"});
    }
  }
}

/* ────────── PRESETS / ORIGIN SELECT / ADVANCED ────────── */
function drawPresetTray(){
  if(!presetTrayEl) return;
  presetTrayEl.innerHTML = "";
  PRESETS.forEach(p=>{
    const b = document.createElement("button");
    b.className = "wf-preset" + (p.id===STATE.presetId ? " is-active" : "");
    b.setAttribute("data-preset", p.id);
    b.textContent = p.label;
    b.title = p.hint;
    b.addEventListener("click", ()=> applyPreset(p.id));
    presetTrayEl.appendChild(b);
  });
}
function applyPreset(id){
  const p = PRESETS.find(x=>x.id===id);
  if(!p) return;
  STATE.presetId  = id;
  STATE.weights   = { ...p.w };
  STATE.popInvert = !!p.popInvert;
  syncAdvancedFromState();
  if(presetTrayEl){
    presetTrayEl.querySelectorAll(".wf-preset").forEach(b=>{
      b.classList.toggle("is-active", b.getAttribute("data-preset")===id);
    });
  }
  STATE.active = null;
  closeDotPopup();
  render();
}

function syncAdvancedFromState(){
  // Scale preset weights so the dominant factor shows 100 and others are proportional.
  // This gives each slider a clear 0–100 "importance" reading independent of the others.
  const keys = ["time","cost","co2","pop"];
  const maxW = Math.max(...keys.map(k => STATE.weights[k] || 0)) || 1;
  keys.forEach(k=>{
    const raw = Math.round((STATE.weights[k] / maxW) * 100);
    const s = document.querySelector(`input[data-w="${k}"]`);
    if(s){ s.value = raw; }
    const v = document.querySelector(`[data-vw="${k}"]`);
    if(v){ v.textContent = raw + "%"; }
  });
  const inv = document.getElementById("pop-invert");
  if(inv) inv.checked = !!STATE.popInvert;
}
function readAdvanced(){
  const t=+document.querySelector('input[data-w="time"]').value;
  const c=+document.querySelector('input[data-w="cost"]').value;
  const e=+document.querySelector('input[data-w="co2"]').value;
  const p=+document.querySelector('input[data-w="pop"]').value;
  const s=t+c+e+p||1;
  STATE.weights = { time:t/s, cost:c/s, co2:e/s, pop:p/s };
  STATE.popInvert = document.getElementById("pop-invert").checked;
  // Show raw slider value (0–100) so each factor feels independent
  document.querySelector('[data-vw="time"]').textContent = t + "%";
  document.querySelector('[data-vw="cost"]').textContent = c + "%";
  document.querySelector('[data-vw="co2"]').textContent  = e + "%";
  document.querySelector('[data-vw="pop"]').textContent  = p + "%";
  STATE.presetId = "custom";
  if(presetTrayEl) presetTrayEl.querySelectorAll(".wf-preset").forEach(b=>b.classList.remove("is-active"));
}

function drawOriginSelect(){
  if(!originSelectEl) return;
  originSelectEl.innerHTML = "";
  Object.entries(ORIGINS).forEach(([k,o])=>{
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = o.name;
    if(k===STATE.originKey) opt.selected = true;
    originSelectEl.appendChild(opt);
  });
  originSelectEl.addEventListener("change", e=>{
    STATE.originKey = e.target.value;
    STATE.active = null;
    closeDotPopup();
    render();
  });
}

function drawMonthSelect(){
  if(!monthSelectEl) return;
  monthSelectEl.innerHTML = "";
  MONTHS.forEach(([label], i)=>{
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = label;
    if(i === (STATE.month ?? 0)) opt.selected = true;
    monthSelectEl.appendChild(opt);
  });
  monthSelectEl.addEventListener("change", e=>{
    STATE.month = parseInt(e.target.value, 10);
    STATE.active = null;
    closeDotPopup();
    render();
  });
}

/* ────────── ENTRY SCREEN ────────── */
function drawEntry(){
  // Origin select
  const sel = document.getElementById("entry-origin");
  sel.innerHTML = "";
  Object.entries(ORIGINS).forEach(([k,o])=>{
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = `${o.name}, ${o.country}`;
    if(k===STATE.originKey) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", e=>{
    STATE.originKey = e.target.value;
    updateEntrySummary();
  });

  // Months
  const monthsEl = document.getElementById("entry-months");
  monthsEl.innerHTML = "";
  const nowMonth = new Date().getMonth();
  MONTHS.forEach(([label,num], i)=>{
    const b = document.createElement("button");
    b.className = "wf-month" + (STATE.month===i ? " is-active" : "");
    b.innerHTML = `<span class="num">${num}</span><span>${label}</span>`;
    b.addEventListener("click", ()=>{
      STATE.month = i;
      monthsEl.querySelectorAll(".wf-month").forEach(x=>x.classList.remove("is-active"));
      b.classList.add("is-active");
      updateEntrySummary();
    });
    monthsEl.appendChild(b);
  });
  if(STATE.month === null){
    STATE.month = nowMonth;
    monthsEl.children[nowMonth].classList.add("is-active");
  }

  // Vibes (presets)
  const vibesEl = document.getElementById("entry-vibes");
  vibesEl.innerHTML = "";
  PRESETS.forEach(p=>{
    const b = document.createElement("button");
    b.className = "wf-vibe" + (STATE.presetId===p.id ? " is-active" : "");
    b.setAttribute("data-preset", p.id);
    b.innerHTML = `
      <div class="wf-vibe-tick"></div>
      <div class="wf-vibe-name">${p.label}</div>
      <div class="wf-vibe-hint">${p.hint}</div>
    `;
    b.addEventListener("click", ()=>{
      STATE.presetId = p.id;
      STATE.weights = { ...p.w };
      STATE.popInvert = !!p.popInvert;
      vibesEl.querySelectorAll(".wf-vibe").forEach(x=>x.classList.remove("is-active"));
      b.classList.add("is-active");
      syncEntrySliders();
      updateEntrySummary();
    });
    vibesEl.appendChild(b);
  });

  // Move the adv-toggle button INTO entry-vibes as the 8th grid card.
  // It lives in the HTML outside the grid so innerHTML="" above doesn't destroy it,
  // then we re-insert it here as the final grid item.
  const advToggleCard = document.getElementById("entry-adv-toggle");
  advToggleCard.style.display = ""; // unhide from staging position
  vibesEl.appendChild(advToggleCard);

  // Entry advanced disclosure
  const advRoot   = document.getElementById("entry-adv");
  const advToggle = document.getElementById("entry-adv-toggle");
  const advBody   = document.getElementById("entry-adv-body");
  advToggle.addEventListener("click", ()=>{
    const open = !advRoot.classList.contains("is-open");
    advRoot.classList.toggle("is-open", open);
    advBody.hidden = !open;
    advToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if(open) syncEntrySliders();
  });

  // Entry sliders
  advBody.querySelectorAll('input[data-ew]').forEach(el=>{
    el.addEventListener("input", readEntrySliders);
  });
  advBody.querySelector('input[data-epop-invert]').addEventListener("change", readEntrySliders);

  syncEntrySliders();
  updateEntrySummary();

  document.getElementById("entry-cta").addEventListener("click", finishEntry);
}
function syncEntrySliders(){
  const keys = ["time","cost","co2","pop"];
  const maxW = Math.max(...keys.map(k => STATE.weights[k] || 0)) || 1;
  document.querySelectorAll('#entry-adv-body input[data-ew]').forEach(el=>{
    const k = el.dataset.ew;
    const raw = Math.round(((STATE.weights[k]||0) / maxW) * 100);
    el.value = raw;
    const v = document.querySelector(`#entry-adv-body [data-evw="${k}"]`);
    if(v) v.textContent = raw + "%";
  });
  const inv = document.querySelector('#entry-adv-body input[data-epop-invert]');
  if(inv) inv.checked = !!STATE.popInvert;
  updateEntryAdvSummary();
}
function readEntrySliders(){
  const sliders = document.querySelectorAll('#entry-adv-body input[data-ew]');
  let sum = 0; const raw = {};
  sliders.forEach(el => { raw[el.dataset.ew] = +el.value; sum += +el.value; });
  sum = sum || 1;
  STATE.weights = {
    time: (raw.time||0)/sum,
    cost: (raw.cost||0)/sum,
    co2:  (raw.co2||0) /sum,
    pop:  (raw.pop||0) /sum,
  };
  STATE.popInvert = document.querySelector('#entry-adv-body input[data-epop-invert]').checked;
  STATE.presetId = "custom";
  // De-select vibes
  document.querySelectorAll("#entry-vibes .wf-vibe").forEach(x=>x.classList.remove("is-active"));
  // Show raw slider value (0–100) so each factor feels independent
  document.querySelectorAll('#entry-adv-body [data-evw]').forEach(v=>{
    const k = v.dataset.evw;
    v.textContent = (raw[k] || 0) + "%";
  });
  updateEntryAdvSummary();
  updateEntrySummary();
}
function updateEntryAdvSummary(){
  const sum = document.getElementById("entry-adv-summary");
  if(!sum) return;
  const w = STATE.weights;
  sum.textContent = `Time ${Math.round(w.time*100)} · Cost ${Math.round(w.cost*100)} · CO₂ ${Math.round(w.co2*100)} · Pop ${Math.round(w.pop*100)}`;
}
function updateEntrySummary(){
  const sum = document.getElementById("entry-summary");
  if(!sum) return;
  const o = ORIGINS[STATE.originKey];
  const m = MONTHS[STATE.month ?? new Date().getMonth()][0];
  const p = STATE.presetId === "custom"
    ? "Custom"
    : (PRESETS.find(x=>x.id===STATE.presetId)?.label || "Balanced");
  sum.innerHTML = `<b>${o.name}</b> · <b>${m}</b> · <b>${p}</b>`;
}
function finishEntry(){
  STATE.entryDone = true;
  const entry = document.getElementById("wf-entry");
  const shell = document.getElementById("wf-shell");
  entry.style.transition = "opacity .25s";
  entry.style.opacity = "0";
  setTimeout(()=>{
    entry.hidden = true;
    shell.hidden = false;
    // First render after the app is visible. Use setTimeout (not rAF) so it
    // also runs when the iframe is in a hidden state.
    setTimeout(bootApp, 0);
  }, 240);
}
function openEntry(){
  const entry = document.getElementById("wf-entry");
  const shell = document.getElementById("wf-shell");
  entry.hidden = false;
  entry.style.opacity = "1";
  shell.hidden = true;
  // Sync UI from current STATE
  document.querySelectorAll("#entry-months .wf-month").forEach((el,i)=>{
    el.classList.toggle("is-active", i===STATE.month);
  });
  document.querySelectorAll("#entry-vibes .wf-vibe").forEach(el=>{
    el.classList.toggle("is-active", el.getAttribute("data-preset")===STATE.presetId);
  });
  syncEntrySliders();
  updateEntrySummary();
}

/* ────────── MASTER RENDER ────────── */
function render(){
  const data = compute();
  lastData = data;
  // Clear basemap — Europe outline is only shown in the mini map, not behind the radial plot
  const gBasemap = document.getElementById("g-basemap");
  if(gBasemap) gBasemap.innerHTML = "";
  // Rose removed — origin uses simple pulse ring; g-rose kept empty
  const gRose = document.getElementById("g-rose");
  if(gRose) gRose.innerHTML = "";
  drawRings();
  drawBearings();
  drawCardinal();
  drawOrigin();
  drawPopGlow(data);
  drawDots(data);
  drawLabels(data);
  drawOverlay(data);
  drawMini(data);
  drawRanking(data);
  drawHeadline(data);
  syncUrlFromState();
  if(originSelectEl) originSelectEl.value = STATE.originKey;
  if(monthSelectEl)  monthSelectEl.value  = String(STATE.month ?? 0);
}

/* ────────── URL STATE ────────── */
function syncUrlFromState(){
  if(!STATE.entryDone) return;
  try {
    const params = new URLSearchParams();
    params.set("from", STATE.originKey);
    params.set("m",    String((STATE.month ?? 0) + 1));
    params.set("p",    STATE.presetId);
    history.replaceState(null, "", "?" + params.toString());
  } catch (_) { /* file:// or sandboxed iframe — ignore */ }
}
function syncStateFromUrl(){
  try {
    const params = new URLSearchParams(location.search);
    const from = params.get("from");
    const m    = parseInt(params.get("m"), 10);
    const p    = params.get("p");
    if (from && ORIGINS[from]) STATE.originKey = from;
    if (m >= 1 && m <= 12)     STATE.month = m - 1;
    const preset = p && PRESETS.find(x=>x.id===p);
    if (preset){
      STATE.presetId  = preset.id;
      STATE.weights   = { ...preset.w };
      STATE.popInvert = !!preset.popInvert;
    }
  } catch (_) {}
}

/* ────────── SVG HELPERS ────────── */
function svgEl(tag, attrs){
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for(const k in attrs){
    if(attrs[k]!=null) el.setAttribute(k, attrs[k]);
  }
  return el;
}

/* ────────── LEGEND PANEL ────────── */
function wireLegend(){
  function toggleLayer(layer){
    LEGEND[layer] = !LEGEND[layer];
    const row = document.getElementById(`legend-${layer}`);
    if(row){
      row.classList.toggle("is-on", LEGEND[layer]);
      row.setAttribute("aria-pressed", LEGEND[layer]);
    }
    if(layer === "co2"){
      const strip = document.getElementById("legend-co2-strip");
      if(strip){
        strip.classList.toggle("is-visible", LEGEND[layer]);
        strip.setAttribute("aria-hidden", String(!LEGEND[layer]));
      }
    }
    if(layer === "pop" && lastData && lastData.length){
      drawPopGlow(lastData);
      return;
    }
    if(lastData && lastData.length) drawDots(lastData);
  }

  ["transport","co2","pop"].forEach(layer=>{
    const el = document.getElementById(`legend-${layer}`);
    if(!el) return;
    el.addEventListener("click", ()=> toggleLayer(layer));
    el.addEventListener("keydown", e=>{ if(e.key===" "||e.key==="Enter"){ e.preventDefault(); toggleLayer(layer); } });
  });

  /* Collapse / expand toggle on the legend chrome — the panel folds into a
     tiny pill so the map stays uncovered when the legend isn't needed. */
  const legend  = document.getElementById("wf-legend");
  const toggle  = document.getElementById("legend-toggle");
  const reopen  = document.getElementById("legend-reopen");
  function setCollapsed(v){
    if(!legend) return;
    legend.classList.toggle("is-collapsed", v);
    if(reopen) reopen.hidden = !v;
    try { localStorage.setItem("wf-legend-collapsed", v ? "1" : "0"); } catch(_){}
  }
  if(toggle) toggle.addEventListener("click", ()=> setCollapsed(true));
  if(reopen) reopen.addEventListener("click", ()=> setCollapsed(false));
  try {
    if(localStorage.getItem("wf-legend-collapsed") === "1") setCollapsed(true);
  } catch(_){}
}

/* ────────── ADVANCED DOCK ────────── */
function wireAdvanced(){
  const btn = document.getElementById("btn-advanced");
  const sheet = document.getElementById("sheet");
  const close = document.getElementById("sheet-close");
  function open(){
    sheet.classList.add("is-open");
    btn.classList.add("is-on");
    syncAdvancedFromState();
  }
  function shut(){
    sheet.classList.remove("is-open");
    btn.classList.remove("is-on");
  }
  btn.addEventListener("click", (e)=>{
    e.stopPropagation();
    sheet.classList.contains("is-open") ? shut() : open();
  });
  close.addEventListener("click", shut);
  document.querySelectorAll('#sheet input[data-w]').forEach(el=>{
    el.addEventListener("input", ()=>{ readAdvanced(); render(); });
  });
  document.getElementById("pop-invert").addEventListener("change", ()=>{ readAdvanced(); render(); });
  // Outside-click dismisses (no backdrop — map stays fully visible & interactive).
  document.addEventListener("click", (e)=>{
    if(!sheet.classList.contains("is-open")) return;
    if(sheet.contains(e.target)) return;
    if(e.target.closest("#btn-advanced")) return;
    shut();
  });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") shut(); });
}

/* ────────── TWEAK API ────────── */
WF.setDensity = function(mode){ STATE.density = mode; if(STATE.entryDone) render(); };
WF.setAccent = function(hex){ document.documentElement.style.setProperty("--wf-accent", hex); };
WF.setHighlightColor = function(hex){ document.documentElement.style.setProperty("--wf-highlight", hex); };
WF.setLayout = function(){ /* layout is fixed to panel now */ };
WF.setMiniMap = function(visible){
  const el = document.querySelector(".wf-mini");
  if(el) el.style.display = visible ? "" : "none";
};
WF.setBackgroundMode = function(mode){ document.documentElement.setAttribute("data-bg", mode); };

/* ────────── BOOT ────────── */
let appBooted = false;
function bootApp(){
  captureRefs();
  if(appBooted){
    // Already booted — just re-render with current state.
    render();
    return;
  }
  appBooted = true;
  drawOriginSelect();
  drawMonthSelect();
  drawPresetTray();
  wireAdvanced();
  wireAbout();
  wireDetail();
  wireLegend();
  wireZoom();
  drawMiniLand();
  render();

  // Click outside dots/labels resets selection and closes popup
  document.querySelector(".wf-stage-map").addEventListener("click", e=>{
    if(e.target.tagName === "svg" || e.target.closest("#g-rings") || e.target.closest("#g-bearings") || e.target.closest("#g-cardinal")){
      if(STATE.active){ STATE.active = null; render(); }
      closeDotPopup();
    }
  });

  // Setup (back) button
  const setupBtn = document.getElementById("btn-setup");
  if(setupBtn){
    setupBtn.addEventListener("click", openEntry);
  }
}

async function boot(){
  // Hydrate STATE from ?from=…&m=…&p=… so users can share URLs.
  syncStateFromUrl();

  // Loading state — visible while destinations_all_months.json fetches.
  const loaderEl = document.getElementById("wf-loading");
  if(loaderEl) loaderEl.hidden = false;

  // Load monthly fare/duration data before showing entry. If the JSON is
  // missing or the fetch fails (e.g. opened via file://), the app still
  // works using each city's static fallback time/cost.
  try {
    if (typeof WF.loadDestinations === "function") {
await Promise.all([
  WF.loadDestinations(),
  WF.loadEuropeGeoJSON("europe.geojson")
]);    }
  } catch (err) {
    console.warn("[WhereToGo] Could not load destinations_all_months.json — running with static fallbacks.", err);
  }
  if(loaderEl) loaderEl.hidden = true;
  drawEntry();

  // If the URL contained valid params, jump straight to the main view so
  // shared links land on the map instead of the entry screen.
  const params = new URLSearchParams(location.search);
  if (params.has("from") && params.has("m") && params.has("p")) {
    finishEntry();
  }
  // If the user wants to skip the entry (e.g. dev), they can call WF.skipEntry()
}
WF.skipEntry = finishEntry;

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

})();
