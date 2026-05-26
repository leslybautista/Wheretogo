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

/* EUROPE_GEOJSON is populated by WF.loadEuropeGeoJSON() on boot. */
WF.EUROPE_GEOJSON = null;

WF.loadEuropeGeoJSON = async function(url){
  url = url || "europe.geojson";
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  WF.EUROPE_GEOJSON = await res.json();
  return WF.EUROPE_GEOJSON;
};

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
      photoId:     d.photoUrl ? null : d.photoId,
      photoUrl:    d.photoUrl ?? null,
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
