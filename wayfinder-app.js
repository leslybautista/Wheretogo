/* ──────────────────────────────────────────────────────────────────────
   WhereToGo · App
   Entry screen → radial cartographic engine → right-side ranking panel.
   ────────────────────────────────────────────────────────────────────── */

(function(){

const { ORIGINS, CITIES, PRESETS, EUROPE } = window.WF;

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

const MONTHS = [
  ["Jan","01"],["Feb","02"],["Mar","03"],["Apr","04"],["May","05"],["Jun","06"],
  ["Jul","07"],["Aug","08"],["Sep","09"],["Oct","10"],["Nov","11"],["Dec","12"],
];

/* ────────── CANVAS GEOMETRY ────────── */
const VB = 1000;
const CX = VB/2, CY = VB/2;
const R_MIN = 90;
const R_MAX = 430;

/* Match-band labels for the rings (best inner → worst outer). */
const RING_BANDS = [
  { t:0.00, label:"Best match" },
  { t:0.25, label:"Strong" },
  { t:0.50, label:"Fair" },
  { t:0.75, label:"Stretch" },
  { t:1.00, label:"Outer band" },
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
function photoURL(id,w=640){
  return id ? `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70` : null;
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
let miniLandEl = null, miniDotsEl = null, miniGratEl = null;
let presetTrayEl = null, originSelectEl = null;
let insightEl=null, matchPctEl=null, matchNameEl=null, matchSubEl=null;
let rankCountEl=null, rankPresetEl=null;

function captureRefs(){
  gLayer = {
    rings:    document.getElementById("g-rings"),
    bearings: document.getElementById("g-bearings"),
    cardinal: document.getElementById("g-cardinal"),
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
  presetTrayEl = document.getElementById("preset-tray");
  originSelectEl = document.getElementById("origin-select");
  insightEl    = document.getElementById("insight-line");
  matchPctEl   = document.getElementById("match-pct");
  matchNameEl  = document.getElementById("match-name");
  matchSubEl   = document.getElementById("match-sub");
  rankCountEl  = document.getElementById("rank-count");
  rankPresetEl = document.getElementById("rank-preset");
}

/* ────────── DRAW: RINGS, BEARING LINES, CARDINALS ────────── */
function drawRings(){
  const g = gLayer.rings;
  g.innerHTML = "";
  // 5 rings — inner is highlighted, outer is solid.
  RING_BANDS.forEach((band, i) => {
    const r = R_MIN + band.t * (R_MAX - R_MIN);
    const isOuter = i === RING_BANDS.length-1;
    const isInner = i === 0;
    const cls = isOuter ? "wf-ring wf-ring-outer"
              : isInner ? "wf-ring wf-ring-emph"
              : "wf-ring";
    g.appendChild(svgEl("circle",{
      cx:CX, cy:CY, r,
      class: cls,
    }));
    // band label, placed at top edge of each ring
    if(band.label){
      const t = svgEl("text",{
        x: CX + 4,
        y: CY - r - 4,
        class:"wf-ring-label",
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
    const x2 = CX + (R_MAX + 16) * Math.cos(θ);
    const y2 = CY + (R_MAX + 16) * Math.sin(θ);
    g.appendChild(svgEl("line",{x1,y1,x2,y2,class:"wf-bearing-line"}));
  }
}
function drawCardinal(){
  const g = gLayer.cardinal;
  g.innerHTML = "";
  const cardinals  = [["N",0],["E",90],["S",180],["W",270]];
  const intercards = [["NE",45],["SE",135],["SW",225],["NW",315]];
  cardinals.forEach(([l,a])=>{
    const θ = toRad(a-90);
    const r = R_MAX + 38;
    const t = svgEl("text",{
      x: CX + r*Math.cos(θ),
      y: CY + r*Math.sin(θ),
      class:"wf-cardinal","text-anchor":"middle","dominant-baseline":"middle",
    });
    t.textContent = l;
    g.appendChild(t);
  });
  intercards.forEach(([l,a])=>{
    const θ = toRad(a-90);
    const r = R_MAX + 32;
    const t = svgEl("text",{
      x: CX + r*Math.cos(θ),
      y: CY + r*Math.sin(θ),
      class:"wf-intercardinal","text-anchor":"middle","dominant-baseline":"middle",
    });
    t.textContent = l;
    g.appendChild(t);
  });
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

function drawDots(data){
  // Halos for top tier
  const topData = data.filter(d => d.rank <= 5);
  updateByName(
    gLayer.halos, topData,
    () => svgEl("circle", { class:"wf-halo-top" }),
    (el, d) => {
      el.setAttribute("cx", d.x);
      el.setAttribute("cy", d.y);
      el.setAttribute("r", 15);
    }
  );
  // Dots
  updateByName(
    gLayer.dots, data,
    (d) => {
      const c = svgEl("circle", { class:"wf-dot" });
      // Bind interactions once — name is captured from creation closure.
      const name = d.name;
      c.addEventListener("mouseenter", () => onHover(name));
      c.addEventListener("mouseleave", () => onHover(null));
      c.addEventListener("click",      () => onSelect(name));
      return c;
    },
    (el, d) => {
      const tier = d.rank<=5 ? "top" : d.rank<=12 ? "mid" : "low";
      const r = tier==="top" ? 6.0 : tier==="mid" ? 4.5 : 3.4;
      el.setAttribute("cx", d.x);
      el.setAttribute("cy", d.y);
      el.setAttribute("r", r);
      const focusName = STATE.active || STATE.hovered;
      const isFocus = focusName === d.name;
      el.setAttribute("class", `wf-dot wf-dot-${tier}${isFocus ? " is-focus" : ""}`);
    }
  );
  // Has-focus state on group
  gLayer.dots.classList.toggle("has-focus", !!(STATE.active || STATE.hovered));
}
function drawLabels(data){
  const g = gLayer.labels;
  const limit = STATE.density==="rich" ? 14 : 7;
  const top = data.slice(0, limit);
  updateByName(
    g, top,
    (d) => svgEl("text", { class:"wf-label", "data-name": d.name }),
    (el, d) => {
      const θ = toRad(d.bearingDeg-90);
      const offset = 16;
      const lx = d.x + offset*Math.cos(θ);
      const ly = d.y + offset*Math.sin(θ);
      const anchor = Math.cos(θ) > 0.25 ? "start" : Math.cos(θ) < -0.25 ? "end" : "middle";
      // recompute class from current index in `top`
      const i = top.indexOf(d);
      const cls = i<3 ? "wf-label wf-label-major" : (i<7 ? "wf-label" : "wf-label wf-label-dim");
      el.setAttribute("class", cls);
      el.setAttribute("x", lx);
      el.setAttribute("y", ly);
      el.setAttribute("text-anchor", anchor);
      el.setAttribute("dominant-baseline", "middle");
      el.textContent = d.name;
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
  g.appendChild(svgEl("circle",{cx:d.x,cy:d.y,r:12,class:"wf-focus-ring"}));
  // 3) label
  const θ = toRad(d.bearingDeg-90);
  const lx = d.x + 20*Math.cos(θ);
  const ly = d.y + 20*Math.sin(θ);
  const anchor = Math.cos(θ) > 0.25 ? "start" : Math.cos(θ) < -0.25 ? "end" : "middle";
  const t = svgEl("text",{x:lx,y:ly,class:"wf-label wf-label-focus","text-anchor":anchor,"dominant-baseline":"middle"});
  t.textContent = d.name;
  g.appendChild(t);
}

/* ────────── MINI EUROPE MAP (real coastline) ────────── */
const MINI = { W: 200, H: 180, latMin: 34, latMax: 71, lonMin: -25, lonMax: 32 };
function miniProject(lat, lon){
  const x = (lon - MINI.lonMin) / (MINI.lonMax - MINI.lonMin) * MINI.W;
  // mild equirectangular squish: keep linear in lat but multiply by cos(latMid)
  const latMid = (MINI.latMin + MINI.latMax) / 2;
  const yScale = Math.cos(toRad(latMid));
  // back to linear lat (don't actually mercator; keep things simple)
  const y = (1 - (lat - MINI.latMin) / (MINI.latMax - MINI.latMin)) * MINI.H;
  return [x, y];
}
function polygonPath(latLonArr){
  return latLonArr.map(([la,lo], i)=>{
    const [x,y] = miniProject(la, lo);
    return (i===0?"M":"L") + x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ") + " Z";
}
function drawMiniLand(){
  if(!miniLandEl) return;
  miniLandEl.innerHTML = "";
  // graticule — every 10° lat & lon, very faint
  miniGratEl.innerHTML = "";
  for(let la = Math.ceil(MINI.latMin/10)*10; la <= MINI.latMax; la += 10){
    const [, y1] = miniProject(la, MINI.lonMin);
    const [, y2] = miniProject(la, MINI.lonMax);
    miniGratEl.appendChild(svgEl("line",{x1:0,y1,x2:MINI.W,y2,class:"wf-mini-grat"}));
  }
  for(let lo = Math.ceil(MINI.lonMin/10)*10; lo <= MINI.lonMax; lo += 10){
    const [x1] = miniProject(MINI.latMin, lo);
    const [x2] = miniProject(MINI.latMax, lo);
    miniGratEl.appendChild(svgEl("line",{x1,y1:0,x2,y2:MINI.H,class:"wf-mini-grat"}));
  }
  // landmasses
  ["mainland","scandinavia","britain","ireland","iceland"].forEach(k=>{
    const path = svgEl("path",{
      d: polygonPath(EUROPE[k]),
      class: "wf-mini-land",
    });
    miniLandEl.appendChild(path);
  });
}
function drawMini(data){
  if(!miniDotsEl) return;
  const g = miniDotsEl;
  const O = ORIGINS[STATE.originKey];
  const [ox,oy] = miniProject(O.lat, O.lon);

  // Origin pin — one ring + one fill, stable identity
  let originRing = g.querySelector(".wf-mini-origin-ring");
  let originDot  = g.querySelector(".wf-mini-origin");
  if(!originRing){
    originRing = svgEl("circle",{class:"wf-mini-origin-ring", r:8});
    originDot  = svgEl("circle",{class:"wf-mini-origin", r:3.5});
    g.appendChild(originRing);
    g.appendChild(originDot);
  }
  originRing.setAttribute("cx", ox); originRing.setAttribute("cy", oy);
  originDot.setAttribute("cx", ox);  originDot.setAttribute("cy", oy);

  // City dots — update by name
  updateByName(
    g, data,
    () => svgEl("circle", { class:"wf-mini-dot" }),
    (el, d) => {
      const [x,y] = miniProject(d.lat, d.lon);
      const tier = d.rank<=5 ? "top" : d.rank<=12 ? "mid" : "low";
      el.setAttribute("cx", x);
      el.setAttribute("cy", y);
      el.setAttribute("r", tier==="top" ? 2.4 : 1.6);
      el.setAttribute("class", `wf-mini-dot wf-mini-${tier}`);
    }
  );

  // Focus ring — stable single element
  let focusEl = g.querySelector(".wf-mini-focus");
  const focusName = STATE.active || STATE.hovered;
  const fd = focusName ? data.find(x=>x.name===focusName) : null;
  if(fd){
    const [x,y] = miniProject(fd.lat, fd.lon);
    if(!focusEl){
      focusEl = svgEl("circle",{class:"wf-mini-focus", r:5});
      g.appendChild(focusEl);
    }
    focusEl.setAttribute("cx", x);
    focusEl.setAttribute("cy", y);
  } else if(focusEl){
    focusEl.remove();
  }
}

/* ────────── RIGHT-SIDE RANKING ────────── */
const MEDAL = {
  1: { icon: "🏆", label: "Best match"   },
  2: { icon: "🥈", label: "Silver pick"  },
  3: { icon: "🥉", label: "Bronze pick"  },
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

    const url = photoURL(d.photoId, 240);
    const photoStyle = url ? `background-image:url(${url})` : "";

    const medal = MEDAL[d.rank];
    const medalHTML = medal
      ? `<div class="rank-medal"><div class="medal-pill"><span class="medal-icon">${medal.icon}</span>${medal.label}</div></div>`
      : "";
    const tagText = medal ? medal.label : "Top pick";

    el.innerHTML = `
      <div class="wf-rank-photo" style="${photoStyle}">
        <div class="rank-num-badge">${d.rank}</div>
        ${medalHTML}
        <div class="match-pill"><span class="match-num">${d.matchPct}</span><span class="match-unit">match</span></div>
      </div>
      <div class="wf-rank-body">
        <div class="wf-rank-head">
          <span class="wf-rank-ord">${d.rank}</span>
          <span class="wf-rank-tag">${tagText}</span>
        </div>
        <h4 class="wf-rank-name">${d.name}</h4>
        <div class="wf-rank-sub">
          <span>${d.country}</span>
          <span class="sep">·</span>
          <span>${d.bearingDeg.toFixed(0)}° ${bearingLabel(d.bearingDeg)}</span>
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

  // Hero image
  const url = photoURL(d.photoId, 800);
  hero.style.backgroundImage = url ? `url(${url})` : "";

  // Rank pill (medal style for top 3)
  rankEl.className = "wf-detail-hero-rank" + (d.rank <= 3 ? ` is-medal-${d.rank}` : "");
  const medal = MEDAL[d.rank];
  rankEl.innerHTML = medal
    ? `<span style="font-size:14px;">${medal.icon}</span> #${d.rank} · ${medal.label}`
    : `#${d.rank} · ${d.matchPct}% match`;

  // Name + meta
  nameEl.firstChild.nodeValue = d.name;
  countryEl.textContent = ` ${d.country}`;
  subEl.textContent = `${d.bearingDeg.toFixed(0)}° ${bearingLabel(d.bearingDeg)} · ${d.matchPct}% composite match`;

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

/* ────────── MAP ZOOM ────────── */
const ZOOM = { scale: 1, min: 0.7, max: 4 };
function applyZoom(){
  const g = document.getElementById("map-zoom");
  if(!g) return;
  g.setAttribute("transform", `translate(${500*(1-ZOOM.scale)} ${500*(1-ZOOM.scale)}) scale(${ZOOM.scale})`);
  const lvl = document.getElementById("zoom-level");
  if(lvl) lvl.textContent = Math.round(ZOOM.scale * 100) + "%";
}
function setZoom(s){
  ZOOM.scale = Math.max(ZOOM.min, Math.min(ZOOM.max, s));
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
    // Hide hint after first wheel use
    const hint = document.getElementById("zoom-hint");
    if(hint) hint.style.opacity = "0";
  }, { passive: false });
  ctrlIn  && ctrlIn .addEventListener("click", ()=> setZoom(ZOOM.scale * 1.25));
  ctrlOut && ctrlOut.addEventListener("click", ()=> setZoom(ZOOM.scale / 1.25));
  ctrlRst && ctrlRst.addEventListener("click", ()=> setZoom(1));
  applyZoom();
}
function drawHeadline(data){
  const focusName = STATE.active || STATE.hovered;
  const d = focusName ? data.find(x=>x.name===focusName) : data[0];
  if(!d) return;
  matchNameEl.textContent = d.name;
  const _hh=Math.floor(d.time),_mm=Math.round((d.time-_hh)*60);
  matchSubEl.textContent  = `${d.country} · ${d.bearingDeg.toFixed(0)}° ${bearingLabel(d.bearingDeg)} · ${_mm>0?`${_hh}h ${_mm}m`:`${_hh}h`} · €${d.cost} · ${d.co2}kg CO₂`;
  matchPctEl.textContent  = d.matchPct;
  insightEl.textContent   = d.insight;
}

/* ────────── INTERACTIONS ────────── */
let lastData = [];
function onHover(name){
  if(STATE.hovered === name) return;
  STATE.hovered = name;
  drawOverlay(lastData);
  drawMini(lastData);
  drawHeadline(lastData);
  if(listEl){
    listEl.querySelectorAll(".wf-rank-card").forEach(el=>{
      el.classList.toggle("is-hover", el.getAttribute("data-name")===name);
    });
  }
  gLayer.dots.classList.toggle("has-focus", !!(name || STATE.active));
  gLayer.dots.querySelectorAll(".wf-dot").forEach(el=>{
    const isFocus = el.getAttribute("data-name") === (name || STATE.active);
    el.classList.toggle("is-focus", isFocus);
  });
}
function onSelect(name){
  STATE.active = (STATE.active === name) ? null : name;
  drawOverlay(lastData);
  drawMini(lastData);
  drawHeadline(lastData);
  if(listEl){
    listEl.querySelectorAll(".wf-rank-card").forEach(el=>{
      el.classList.toggle("is-active", el.getAttribute("data-name")===STATE.active);
    });
  }
  gLayer.dots.classList.toggle("has-focus", !!(STATE.active || STATE.hovered));
  gLayer.dots.querySelectorAll(".wf-dot").forEach(el=>{
    const isFocus = el.getAttribute("data-name") === (STATE.active || STATE.hovered);
    el.classList.toggle("is-focus", isFocus);
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
  render();
}

function syncAdvancedFromState(){
  ["time","cost","co2","pop"].forEach(k=>{
    const s = document.querySelector(`input[data-w="${k}"]`);
    if(s){ s.value = Math.round(STATE.weights[k]*100); }
    const v = document.querySelector(`[data-vw="${k}"]`);
    if(v){ v.textContent = Math.round(STATE.weights[k]*100)+"%"; }
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
  document.querySelector('[data-vw="time"]').textContent = Math.round(STATE.weights.time*100)+"%";
  document.querySelector('[data-vw="cost"]').textContent = Math.round(STATE.weights.cost*100)+"%";
  document.querySelector('[data-vw="co2"]').textContent  = Math.round(STATE.weights.co2*100)+"%";
  document.querySelector('[data-vw="pop"]').textContent  = Math.round(STATE.weights.pop*100)+"%";
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
  document.querySelectorAll('#entry-adv-body input[data-ew]').forEach(el=>{
    const k = el.dataset.ew;
    el.value = Math.round((STATE.weights[k]||0) * 100);
    const v = document.querySelector(`#entry-adv-body [data-evw="${k}"]`);
    if(v) v.textContent = Math.round((STATE.weights[k]||0)*100) + "%";
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
  // Update displayed percentages
  document.querySelectorAll('#entry-adv-body [data-evw]').forEach(v=>{
    const k = v.dataset.evw;
    v.textContent = Math.round(STATE.weights[k]*100) + "%";
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
  drawRings();
  drawBearings();
  drawCardinal();
  drawOrigin();
  drawDots(data);
  drawLabels(data);
  drawOverlay(data);
  drawMini(data);
  drawRanking(data);
  drawHeadline(data);
}

/* ────────── SVG HELPERS ────────── */
function svgEl(tag, attrs){
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for(const k in attrs){
    if(attrs[k]!=null) el.setAttribute(k, attrs[k]);
  }
  return el;
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
  drawPresetTray();
  wireAdvanced();
  wireAbout();
  wireDetail();
  wireZoom();
  drawMiniLand();
  render();

  // Click outside dots/labels resets selection
  document.querySelector(".wf-stage-map").addEventListener("click", e=>{
    if(e.target.tagName === "svg" || e.target.closest("#g-rings") || e.target.closest("#g-bearings") || e.target.closest("#g-cardinal")){
      if(STATE.active){ STATE.active = null; render(); }
    }
  });

  // Setup (back) button
  const setupBtn = document.getElementById("btn-setup");
  if(setupBtn){
    setupBtn.addEventListener("click", openEntry);
  }
}

async function boot(){
  // Load monthly fare/duration data before showing entry. If the JSON is
  // missing or the fetch fails (e.g. opened via file://), the app still
  // works using each city's static fallback time/cost.
  try {
    if (typeof WF.loadDestinations === "function") {
      await WF.loadDestinations();
    }
  } catch (err) {
    console.warn("[WhereToGo] Could not load destinations_all_months.json — running with static fallbacks.", err);
  }
  drawEntry();
  // If the user wants to skip the entry (e.g. dev), they can call WF.skipEntry()
}
WF.skipEntry = finishEntry;

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

})();
