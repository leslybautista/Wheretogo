/* ──────────────────────────────────────────────────────────────────────
   WhereToGo · Data
   Origins, Europe outline, presets, and the async loader that hydrates
   WF.CITIES + WF.MONTHLY from destinations_all_months.json.

   destinations_all_months.json is built by build_destinations.py from
   the Travelpayouts/Amadeus cache (_tp_cache.json). Each cell carries
   either an `api` source (real fare/duration for that month) or a
   `fallback` source (the static value baked into the build script).
   ────────────────────────────────────────────────────────────────────── */

window.WF = window.WF || {};

WF.ORIGINS = {
  DRS:{name:"Dresden",    country:"Germany",        lat:51.0504, lon:13.7373, code:"DE"},
  BER:{name:"Berlin",     country:"Germany",        lat:52.5200, lon:13.4050, code:"DE"},
  MUC:{name:"Munich",     country:"Germany",        lat:48.1351, lon:11.5820, code:"DE"},
  FRA:{name:"Frankfurt",  country:"Germany",        lat:50.1109, lon: 8.6821, code:"DE"},
  VIE:{name:"Vienna",     country:"Austria",        lat:48.2082, lon:16.3738, code:"AT"},
  PRG:{name:"Prague",     country:"Czechia",        lat:50.0755, lon:14.4378, code:"CZ"},
  AMS:{name:"Amsterdam",  country:"Netherlands",    lat:52.3676, lon: 4.9041, code:"NL"},
  CDG:{name:"Paris",      country:"France",         lat:48.8566, lon: 2.3522, code:"FR"},
  LHR:{name:"London",     country:"United Kingdom", lat:51.5074, lon:-0.1278, code:"UK"},
  MAD:{name:"Madrid",     country:"Spain",          lat:40.4168, lon:-3.7038, code:"ES"},
  IST:{name:"Istanbul",   country:"Türkiye",        lat:41.0082, lon:28.9784, code:"TR"},
};

/* CITIES is populated by WF.loadDestinations() on boot. */
WF.CITIES = [];

/* WF.MONTHLY[origin][dest][YYYY-MM] = { flight, train, available }
   flight: { time, cost, co2 } | null
   train:  { time, cost, co2, cost_source } | null               */
WF.MONTHLY = null;
WF.MONTHS_LIST = [];

WF.loadDestinations = async function(url){
  url = url || "destinations_all_months.json";
  const res = await fetch(url, { cache: "no-cache" });
  if(!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const j = await res.json();

  // Hydrate CITIES — base metadata only; time/cost/co2 come from MONTHLY per cell
  WF.CITIES.length = 0;
  j.destinations.forEach(d => {
    WF.CITIES.push({
      iata:        d.iata,
      name:        d.name,
      country:     d.country,
      code:        d.code,
      lat:         d.lat,
      lon:         d.lon,
      co2Flight:   d.co2_flight,
      pop:         d.pop,
      photoId:     d.photoId,
      insight:     d.insight,
      // ── Enrichment fields (present only when city_enrichment.json was merged) ──
      budget:      d.budget      ?? null,   // "Low" | "Medium" | "High"
      walkability: d.walkability ?? null,   // "Poor" | "Fair" | "Good" | "Great"
      aqi:         d.aqi         ?? null,   // "Poor" | "Moderate" | "Good" | "Great"
      seasons:     d.seasons     ?? null,   // { low: [...], medium: [...], high: [...] }
      interests:   d.interests   ?? [],     // [{ type, title, text }, ...]
    });
  });

  // Lookup index: MONTHLY[origin][dest][month] = { flight, train, available }
  const M = {};
  j.destinations.forEach(d => {
    Object.entries(d.byOrigin || {}).forEach(([oIata, byMonth]) => {
      (M[oIata] = M[oIata] || {})[d.iata] = byMonth;
    });
  });
  WF.MONTHLY     = M;
  WF.MONTHS_LIST = j.meta.months || [];

  return j;
};

/* ────────────────────────────────────────────────────────────────
   EUROPE OUTLINE — simplified coastline polygons in [lat, lon].
   Hand-traced from real geographic landmarks (Cape Finisterre,
   Skagen, North Cape, Bosphorus, etc.) so the mini-map actually
   reads as Europe rather than an abstract blob.
   ──────────────────────────────────────────────────────────────── */

WF.EUROPE = {
  mainland: [
    // Gibraltar → Atlantic coast of Iberia (Algarve / Cape St Vincent bend)
    [36.0,-5.4],[36.0,-5.9],[36.2,-6.0],[36.3,-6.1],[36.6,-6.4],[36.8,-7.0],
    [37.0,-7.3],[37.1,-7.4],[37.2,-7.5],[37.0,-8.0],[37.0,-8.6],[37.0,-8.9],
    [37.2,-8.95],[37.5,-8.95],[37.8,-8.9],[38.0,-8.9],[38.4,-8.9],[38.5,-9.2],
    [38.6,-9.3],[38.7,-9.4],[38.7,-9.5],
    // Portugal central + north coast
    [39.0,-9.5],[39.3,-9.4],[39.5,-9.4],[39.8,-9.1],[40.0,-8.9],[40.3,-8.85],
    [40.6,-8.8],[40.8,-8.7],[41.0,-8.6],[41.2,-8.7],[41.5,-8.8],[41.7,-8.85],
    [42.0,-9.0],[42.2,-9.05],[42.5,-9.1],[42.7,-9.2],[43.0,-9.3],
    // Galicia / Cape Finisterre
    [43.3,-9.3],[43.4,-9.2],[43.5,-8.7],[43.6,-8.0],[43.7,-7.7],[43.8,-7.4],
    [43.7,-7.2],[43.6,-7.0],[43.6,-6.5],
    // Cantabrian coast (curving north Spain)
    [43.5,-6.0],[43.5,-5.5],[43.4,-5.0],[43.5,-4.5],[43.5,-4.0],[43.5,-3.5],
    [43.4,-3.0],[43.4,-2.5],[43.4,-1.8],[43.4,-1.5],[43.3,-1.3],
    // Landes / French Atlantic coast (low, sandy)
    [43.7,-1.4],[44.0,-1.4],[44.3,-1.3],[44.6,-1.2],[45.0,-1.1],[45.6,-1.1],
    [46.0,-1.15],[46.2,-1.2],[46.5,-1.5],[46.7,-1.9],[46.9,-2.2],
    // Loire / Vendée
    [47.0,-2.3],[47.3,-2.3],[47.5,-2.5],[47.5,-3.0],[47.6,-3.5],[47.8,-4.2],
    [48.0,-4.5],[48.4,-4.7],[48.6,-4.85],[48.7,-4.9],
    // Brittany cap (Finistère) and north coast
    [48.65,-4.55],[48.7,-4.3],[48.75,-3.7],[48.8,-3.3],[48.9,-2.8],[49.0,-2.0],
    [48.75,-1.7],[48.7,-1.5],[48.5,-1.7],[48.6,-2.0],
    // Normandy / Cotentin / Channel
    [49.0,-1.6],[49.5,-1.6],[49.6,-1.0],[49.7,0.0],[49.7,0.2],[50.0,1.0],
    [50.1,1.6],[50.5,1.6],[50.7,1.6],
    // Pas-de-Calais / Belgium / Netherlands
    [50.9,2.1],[51.0,2.6],[51.1,2.7],[51.2,2.9],[51.3,3.2],[51.4,3.6],
    [51.7,3.8],[51.9,4.0],[52.1,4.2],[52.4,4.6],[52.7,4.7],[52.9,4.8],
    [53.0,4.9],[53.2,5.5],[53.4,6.2],[53.4,6.6],[53.5,6.9],[53.5,7.2],
    [53.6,7.6],[53.6,8.0],
    // German Bight / Jutland west coast
    [53.7,8.4],[53.9,8.7],[54.1,8.9],[54.4,8.7],[54.9,8.3],[55.5,8.1],
    [55.7,8.2],[56.0,8.3],[56.4,8.2],[56.7,8.2],[57.0,9.0],[57.2,9.3],
    [57.5,9.5],
    // Kattegat / Skåne / Baltic west
    [57.6,10.5],[57.7,10.7],[57.5,10.8],[57.3,10.7],[57.0,10.6],[56.5,10.2],
    [56.0,10.0],[55.5,9.7],[55.0,10.5],[54.7,10.1],[54.4,9.7],
    // German / Polish Baltic coast
    [54.0,11.0],[54.0,12.0],[54.1,13.5],[54.3,14.5],[54.4,16.5],[54.5,17.5],
    [54.5,18.6],[54.4,19.6],[54.5,20.5],[55.0,20.9],
    // Baltic states
    [55.5,21.0],[55.7,21.1],[56.0,21.0],[56.3,21.1],[56.7,23.0],[56.9,24.1],
    [57.3,24.3],[57.7,24.4],[58.4,24.0],[58.9,24.5],[59.4,24.7],[59.5,28.0],
    // Eastern bound → Black Sea
    [58.0,30.0],[56.5,30.0],[55.0,30.0],[53.0,30.0],[51.0,30.0],[49.5,30.0],
    [48.0,29.5],[47.0,29.7],[46.5,30.0],[46.2,30.0],[46.0,30.0],[45.6,29.7],
    [45.2,28.9],
    // Romania / Bulgaria / Turkey Black Sea
    [44.5,28.8],[44.0,28.7],[43.6,28.2],[43.3,28.1],[43.0,28.0],[42.5,28.0],
    [42.2,28.1],[41.8,28.5],[41.4,28.7],[41.0,28.9],
    // Dardanelles / Aegean
    [40.6,27.0],[40.5,26.5],[40.2,26.2],[40.1,26.0],[40.0,25.5],[40.0,24.5],
    [39.9,23.7],[39.7,23.0],[39.0,22.5],[38.5,22.0],
    // Greek mainland / Peloponnese (the recognisable hand-shape)
    [38.3,22.6],[38.0,23.7],[37.7,23.2],[37.5,22.8],[37.2,22.6],[37.0,22.5],
    [36.7,22.0],[36.6,21.7],[36.8,21.7],[37.0,22.4],[37.2,21.6],[37.5,21.8],
    [37.8,21.5],[38.0,21.4],
    // Western Greece / Albanian coast
    [38.3,21.0],[38.5,20.7],[38.9,20.4],[39.2,20.1],[39.5,19.8],[40.0,19.5],
    [40.3,19.4],[40.6,19.5],[41.0,19.5],[41.5,19.5],
    // Montenegro / Croatia Adriatic (east side, dalmatian coast)
    [41.9,19.0],[42.0,18.5],[42.4,18.5],[42.7,17.8],[43.0,17.0],[43.4,16.4],
    [43.7,16.0],[44.0,15.5],[44.3,15.0],[44.5,14.8],[44.7,14.5],[45.0,14.0],
    [45.2,14.0],[45.4,13.7],[45.6,13.5],[45.7,13.3],[45.6,13.1],
    // Trieste / Istria / northern Adriatic (Italy is its own polygon)
    [45.5,13.5],[45.0,12.8],[44.5,12.3],
    // Ligurian coast: Po delta → Genoa → Monaco → Nice (fills the gap across N. Italy)
    [44.4,11.0],[44.2,9.8],[44.1,9.2],[43.95,8.6],[43.8,7.9],[43.8,7.5],
    // Riviera / south France
    [43.5,7.0],[43.4,6.5],[43.3,5.4],[43.2,5.1],[43.0,4.8],
    [43.0,4.5],[42.8,4.0],[42.7,3.0],
    // Cap de Creus / Catalan coast — enough resolution so Barcelona (41.38N, 2.17E)
    // sits clearly west of the coastline (inside the land polygon)
    [42.4,3.3],[42.1,3.1],[41.8,2.9],[41.5,2.45],[41.3,2.15],
    [41.1,1.55],[40.85,0.85],[40.5,0.2],[40.0,-0.1],[39.5,-0.35],[38.8,-0.05],
    [38.0,0.0],[37.6,-0.7],[37.2,-1.2],[37.0,-1.4],[36.7,-2.4],[36.7,-3.4],
    [36.7,-4.4],[36.4,-4.7],[36.2,-5.1],[36.0,-5.4],
  ],
  italy: [
    // Ligurian (NW, top-left of boot)
    [44.4,8.9],[44.2,9.3],[44.1,9.8],[44.0,10.1],
    // Tuscany — down the Tyrrhenian
    [43.6,10.3],[43.4,10.5],[43.1,11.2],[42.7,10.9],[42.4,11.1],
    [42.1,11.7],[41.7,12.1],
    // Lazio (Rome area) / Campania
    [41.4,12.9],[41.2,13.1],[41.0,13.8],[40.8,14.3],[40.6,14.9],
    // Calabria — the leg
    [40.2,15.5],[39.8,15.8],[39.4,16.0],[38.9,16.4],[38.4,16.0],
    [38.2,15.9],[37.9,15.7],
    // Toe / strait of Messina
    [38.0,16.1],[38.1,16.5],[38.6,16.5],
    // Ionian coast → heel (Taranto / Lecce)
    [39.4,17.2],[39.8,18.3],[40.0,18.4],
    // Heel tip (Santa Maria di Leuca)
    [39.8,18.4],[40.1,18.5],[40.6,18.1],
    // Puglia Adriatic coast going north
    [40.7,17.0],[41.1,16.9],[41.4,15.9],
    // Abruzzo / Marche / Romagna Adriatic
    [42.0,14.5],[42.4,14.2],[43.0,14.2],[43.5,13.6],[44.1,12.6],
    // Venice / Po delta
    [44.5,12.3],[44.8,12.4],[45.0,12.5],[45.4,12.3],
    // Trieste and back across Po valley to Genoa
    [45.5,13.5],[45.7,13.7],[45.8,13.1],[45.5,12.2],
    [45.3,10.9],[45.4,10.3],[45.5,9.3],[44.9,8.9],[44.4,8.9],
  ],
  scandinavia: [
    // Southern Sweden / Oresund
    [55.4,13.4],[55.6,14.3],[55.9,15.5],[56.2,16.0],
    // Swedish east coast
    [57.0,16.5],[57.4,16.6],[58.4,16.8],[59.0,18.0],[59.3,18.1],
    [59.7,18.7],[60.6,17.4],
    // Gulf of Bothnia
    [61.5,17.4],[62.4,17.6],[63.0,18.0],[64.0,21.0],
    [65.0,22.0],[65.5,22.3],[65.9,24.0],[66.0,24.9],[65.0,25.5],
    // Finnish coast
    [64.0,24.5],[63.5,22.5],[62.0,21.0],[61.5,21.5],[61.0,21.5],
    [60.4,22.3],[60.2,23.5],[60.1,24.9],[60.4,27.5],[60.6,28.7],
    // North (Norway border / Murmansk)
    [62.0,30.0],[65.0,30.0],[68.0,29.0],
    // North Norway cape
    [69.5,27.0],[70.0,25.7],[70.5,25.0],[71.0,23.0],[70.7,20.0],
    [70.0,19.5],[70.0,17.8],[69.0,17.5],[68.5,16.0],[67.5,14.5],
    // Mid Norway
    [66.0,14.0],[65.5,12.5],[65.0,11.5],[64.5,10.8],[63.4,10.4],
    // Trondheim fjord area
    [63.0,9.5],[62.9,8.0],[62.0,6.3],[61.0,5.0],[60.4,5.3],
    // Stavanger / Rogaland
    [59.0,5.5],[58.4,5.8],[58.0,6.6],[58.0,7.5],[58.2,8.1],
    // Oslo fjord / Skagerrak back
    [59.0,10.7],[59.4,10.7],[59.0,11.0],[58.6,11.1],[58.4,11.4],
  ],
  britain: [
    // SW England — Lizard / Land's End
    [50.1,-5.7],[50.0,-5.2],[49.9,-4.5],[50.0,-4.0],[50.5,-3.8],
    [50.7,-3.5],[50.8,-2.0],[50.7,-1.0],[50.9,0.3],[51.1,1.4],
    // East England
    [51.8,1.5],[52.0,1.8],[52.5,1.7],[52.9,1.5],[53.5,0.3],
    [53.8,0.1],[54.1,0.0],[54.5,-0.6],[55.0,-1.0],
    // Northumberland / Borders
    [55.3,-1.5],[55.8,-1.6],[55.9,-2.1],[56.2,-2.2],
    // Scotland east coast
    [56.7,-2.5],[57.0,-2.0],[57.5,-2.0],[57.7,-2.5],[58.0,-3.0],
    [58.6,-3.0],[58.8,-3.2],[58.9,-3.0],
    // Cape Wrath / NW Scotland
    [58.5,-4.4],[58.5,-5.0],[57.8,-5.8],[57.5,-6.0],
    // Kintyre / Galloway
    [57.0,-5.8],[56.5,-5.6],[56.0,-5.8],
    [55.5,-5.3],[54.7,-5.0],[54.3,-4.5],[54.0,-3.0],[53.8,-3.3],
    // Wales coast
    [53.4,-3.0],[53.0,-4.5],[52.8,-4.8],[52.5,-4.5],[52.0,-5.0],
    [51.9,-5.1],[51.6,-5.2],[51.4,-4.8],[51.4,-3.5],[51.3,-4.5],
    [50.5,-4.5],[50.3,-5.2],[50.1,-5.7],
  ],
  ireland: [
    [51.5,-9.5],[51.8,-9.8],[51.9,-9.6],[52.1,-10.5],[52.4,-10.0],[52.5,-10.4],
    [52.7,-9.9],[53.0,-10.2],[53.4,-10.0],[53.7,-9.9],[54.0,-10.1],[54.2,-9.9],
    [54.4,-9.8],[54.7,-8.6],[55.0,-8.1],[55.2,-7.6],[55.3,-7.3],[55.2,-6.4],
    [54.9,-6.0],[54.6,-5.7],[54.3,-5.5],[54.0,-6.0],[53.6,-6.0],[53.5,-6.0],
    [53.1,-6.0],[52.5,-6.4],[52.2,-6.7],[52.0,-7.0],[51.8,-8.5],[51.6,-9.2],
    [51.5,-9.5],
  ],
  iceland: [
    [63.4,-22.5],[63.4,-21.6],[63.5,-21.5],[63.8,-21.4],[64.0,-21.7],[64.0,-22.5],
    [64.0,-23.8],[64.4,-24.4],[64.7,-24.3],[65.0,-24.4],[65.6,-24.4],[66.0,-23.5],
    [66.4,-22.5],[66.5,-21.0],[66.5,-20.0],[66.4,-18.0],[66.4,-16.0],[65.8,-14.5],
    [65.5,-13.5],[64.8,-13.8],[64.4,-13.9],[64.1,-14.0],[63.7,-15.5],[63.6,-17.0],
    [63.4,-19.0],[63.2,-20.5],[63.4,-22.5],
  ],
  /* ───── Mediterranean islands — give the basin its real shape ───── */
  sicily: [
    [38.20,12.45],[38.15,12.85],[38.10,13.30],[38.10,13.90],[38.00,14.50],
    [38.05,15.00],[38.20,15.35],[38.20,15.55],[38.05,15.65],[37.85,15.30],
    [37.55,15.15],[37.40,15.10],[37.10,15.30],[36.70,15.10],[36.65,14.55],
    [36.80,14.05],[37.10,13.20],[37.50,12.50],[37.80,12.45],[38.05,12.40],
    [38.20,12.45],
  ],
  sardinia: [
    [41.25,9.20],[41.15,9.50],[40.90,9.65],[40.55,9.80],[40.10,9.70],[39.65,9.65],
    [39.20,9.55],[39.00,9.10],[39.10,8.80],[39.20,8.45],[39.50,8.40],
    [39.85,8.40],[40.20,8.30],[40.55,8.20],[40.85,8.40],[41.05,8.75],
    [41.20,9.05],[41.25,9.20],
  ],
  corsica: [
    [43.00,9.40],[42.95,9.55],[42.70,9.55],[42.40,9.55],[42.05,9.40],[41.85,9.30],
    [41.55,9.25],[41.45,9.10],[41.50,8.90],[41.70,8.70],[42.00,8.65],[42.35,8.70],
    [42.65,8.65],[42.90,8.75],[43.00,9.15],[43.00,9.40],
  ],
  crete: [
    [35.65,23.50],[35.55,23.85],[35.45,24.10],[35.40,24.45],[35.20,24.80],
    [35.10,25.20],[35.15,25.60],[35.20,26.00],[35.10,26.30],[34.95,26.00],
    [34.95,25.40],[34.95,24.80],[35.00,24.20],[35.15,23.80],[35.40,23.55],
    [35.65,23.50],
  ],
  cyprus: [
    [35.20,32.30],[35.30,32.70],[35.40,33.50],[35.40,34.10],[35.05,34.55],
    [34.85,34.05],[34.75,33.50],[34.70,32.90],[34.85,32.40],[35.05,32.25],
    [35.20,32.30],
  ],
  mallorca: [
    [39.95,3.20],[39.85,3.45],[39.55,3.45],[39.30,3.05],[39.30,2.65],
    [39.55,2.40],[39.85,2.55],[39.95,3.00],[39.95,3.20],
  ],
};

/* Presets are weights for: time, cost, co2, pop.
   Each must sum to 1.0. 'popInvert' flips popularity to favor low-pop cities. */
/* Preset order follows a UX progressive-disclosure logic:
   Row 1 — clear optimisation goals (transactional, most actionable)
   Row 2 — experiential modes  (contextual, more aspirational)
   Balanced sits 4th — a neutral "reset" between the two rows,
   not the default hero choice that could anchor users prematurely. */
WF.PRESETS = [
  { id:"fastest",     label:"Fastest",         hint:"Shortest door-to-door time",
    w:{ time:.70, cost:.10, co2:.10, pop:.10 } },
  { id:"cheapest",    label:"Cheapest",        hint:"Lowest round-trip fare",
    w:{ time:.10, cost:.70, co2:.10, pop:.10 } },
  { id:"sustainable", label:"Sustainable",     hint:"Minimum CO₂ per traveller",
    w:{ time:.15, cost:.10, co2:.65, pop:.10 } },
  { id:"balanced",    label:"Balanced",        hint:"All factors weighted evenly",
    w:{ time:.25, cost:.25, co2:.25, pop:.25 } },
  { id:"weekend",     label:"Weekend escape",  hint:"Quick, affordable, low-friction",
    w:{ time:.50, cost:.30, co2:.15, pop:.05 } },
  { id:"culture",     label:"Culture",         hint:"Reach a major cultural anchor",
    w:{ time:.20, cost:.15, co2:.10, pop:.55 }, popInvert:false },
  { id:"hidden",      label:"Hidden gems",     hint:"Underexplored cities, cleanly reached",
    w:{ time:.20, cost:.25, co2:.25, pop:.30 }, popInvert:true },
];
