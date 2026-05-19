/* ──────────────────────────────────────────────────────────────────────
   Wayfinder · Data
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
    [36.0,-5.4],[36.0,-6.5],[37.2,-7.5],[38.7,-9.5],[40.6,-8.8],
    [42.0,-9.0],[43.0,-9.3],[43.6,-8.0],[43.5,-5.5],[43.4,-3.0],
    [43.4,-1.8],[44.6,-1.2],[46.2,-1.2],[47.5,-3.0],[48.4,-4.7],
    [48.6,-2.0],[49.5,-1.6],[50.7,1.6],[51.0,2.6],[51.4,3.6],
    [51.9,4.0],[52.4,4.6],[53.0,4.9],[53.4,6.6],[53.6,8.0],
    [53.9,8.7],[54.4,8.7],[55.5,8.1],[56.7,8.2],[57.5,9.5],
    [57.7,10.7],[57.0,10.6],[55.5,9.7],[54.4,9.7],
    [54.0,11.0],[54.1,13.5],[54.4,16.5],[54.5,18.6],[54.4,19.6],
    [55.7,21.1],[56.9,24.1],[57.7,24.4],[59.4,24.7],
    [58.0,30.0],[54.0,30.0],[50.0,30.0],[46.0,30.0],[44.0,28.7],
    [43.0,28.0],[42.0,27.9],[41.0,28.9],[40.5,26.5],[40.0,25.5],
    [39.7,23.0],[38.0,23.7],[37.0,22.5],[36.6,21.7],
    [38.5,20.7],[40.0,19.5],[41.5,19.5],[42.5,18.5],[43.4,16.4],
    [44.5,14.8],[45.4,13.7],[45.7,13.3],
    [44.5,12.3],[42.0,14.5],[40.7,17.0],[40.0,18.4],[39.8,17.2],
    [40.0,15.7],[40.6,14.9],[41.5,13.0],[43.5,10.3],[44.2,9.8],
    [44.3,8.5],[43.5,7.0],[43.3,5.4],[42.7,3.0],[41.4,2.2],
    [39.5,-0.4],[37.6,-0.7],[36.7,-2.4],[36.7,-4.4],[36.0,-5.4],
  ],
  scandinavia: [
    [58.4,11.4],[57.7,12.0],[56.2,12.6],[55.4,13.4],[55.6,14.3],
    [56.2,16.0],[57.0,16.5],[58.4,16.8],[59.3,18.1],[60.6,17.4],
    [62.4,17.6],[64.0,21.0],[65.5,22.3],[65.9,24.0],[65.0,25.5],
    [63.5,22.5],[61.5,21.5],[60.4,22.3],[60.1,24.9],[60.4,27.5],
    [60.6,28.7],
    [62.0,30.0],[65.0,30.0],[68.0,29.0],[69.5,27.0],[70.5,25.0],
    [71.0,23.0],[70.0,19.5],[69.0,17.5],[67.5,14.5],[65.5,12.5],
    [63.4,10.4],[62.0,6.3],[60.4,5.3],[59.0,5.5],[58.0,6.6],
    [58.2,8.1],[59.4,10.7],[59.0,11.0],[58.4,11.4],
  ],
  britain: [
    [50.1,-5.7],[50.7,-3.5],[50.7,-1.0],[51.1,1.4],[52.5,1.7],
    [53.5,0.3],[54.5,-0.6],[55.8,-1.6],[57.5,-2.0],[58.6,-3.0],
    [58.5,-5.0],[57.5,-6.0],[56.0,-5.8],[54.7,-5.0],[54.0,-3.0],
    [53.4,-3.0],[52.8,-4.8],[51.6,-5.2],[51.4,-3.5],[50.5,-4.5],
    [50.1,-5.7],
  ],
  ireland: [
    [51.5,-9.5],[52.1,-10.5],[53.4,-10.0],[54.4,-9.8],[55.3,-7.3],
    [54.6,-5.7],[53.5,-6.0],[52.5,-6.4],[51.5,-9.5],
  ],
  iceland: [
    [63.4,-22.5],[64.0,-23.8],[65.6,-24.4],[66.4,-22.5],[66.4,-16.0],
    [65.5,-13.5],[64.1,-14.0],[63.4,-19.0],[63.4,-22.5],
  ],
};

/* Presets are weights for: time, cost, co2, pop.
   Each must sum to 1.0. 'popInvert' flips popularity to favor low-pop cities. */
WF.PRESETS = [
  { id:"balanced",    label:"Balanced",        hint:"All factors weighted evenly",
    w:{ time:.25, cost:.25, co2:.25, pop:.25 } },
  { id:"fastest",     label:"Fastest",         hint:"Shortest door-to-door time",
    w:{ time:.70, cost:.10, co2:.10, pop:.10 } },
  { id:"cheapest",    label:"Cheapest",        hint:"Lowest round-trip fare",
    w:{ time:.10, cost:.70, co2:.10, pop:.10 } },
  { id:"sustainable", label:"Sustainable",     hint:"Minimum CO₂ per traveller",
    w:{ time:.15, cost:.10, co2:.65, pop:.10 } },
  { id:"weekend",     label:"Weekend escape",  hint:"Quick, affordable, low-friction",
    w:{ time:.50, cost:.30, co2:.15, pop:.05 } },
  { id:"culture",     label:"Culture",         hint:"Reach a major cultural anchor",
    w:{ time:.20, cost:.15, co2:.10, pop:.55 }, popInvert:false },
  { id:"hidden",      label:"Hidden gems",     hint:"Underexplored cities, cleanly reached",
    w:{ time:.20, cost:.25, co2:.25, pop:.30 }, popInvert:true },
];
