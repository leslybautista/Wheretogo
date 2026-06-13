"""
build_destinations_v3.py
─────────────────────────
Pre-computes destinations for ALL months the user wants to query.

Output: data/destinations_all_months.json
Structure:
{
  "metadata": { "origins": [...], "months": [...], "built_at": "..." },
  "data": [
    {
      "origin": "DRS", "city": "Paris", ...,
      "months": {
        "2026-01": {"time_h": 8.1, "cost_eur": 180, "co2_kg": 320, "source": "travelpayouts"},
        "2026-02": {"time_h": 8.1, "cost_eur": 155, "co2_kg": 320, "source": "travelpayouts"},
        ...
      }
    },
    ...
  ]
}

NOTE:
  - time_h and co2_kg are stable across months (physics doesn't change).
  - cost_eur changes per month (seasonal pricing).
  - The frontend sends cost_eur[selectedMonth] into the WLC scorer.

Usage
─────
  # Heuristic only (no token):
  python build_destinations_v3.py

  # With Travelpayouts (recommended):
  export TP_TOKEN=your_token
  python build_destinations_v3.py --refresh-prices

  # Custom month range:
  python build_destinations_v3.py --refresh-prices --start 2026-01 --end 2026-12

  # Single origin for testing:
  python build_destinations_v3.py --refresh-prices --origins DRS --start 2026-06 --end 2026-08
"""

from __future__ import annotations
import argparse
import json
import math
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    print("⚠  pip install requests", file=sys.stderr)

# ──────────────────────────────────────────────────────────
# SEEDS
# ──────────────────────────────────────────────────────────
ORIGINS: dict[str, dict] = {
    # Original
    "DRS": dict(name="Dresden",    country="Germany",        iata="DRS", lat=51.0504, lon=13.7373),
    "BER": dict(name="Berlin",     country="Germany",        iata="BER", lat=52.5200, lon=13.4050),
    "MUC": dict(name="Munich",     country="Germany",        iata="MUC", lat=48.1351, lon=11.5820),
    "VIE": dict(name="Vienna",     country="Austria",        iata="VIE", lat=48.2082, lon=16.3738),
    "PRG": dict(name="Prague",     country="Czechia",        iata="PRG", lat=50.0755, lon=14.4378),
    # New
    "LHR": dict(name="London",     country="United Kingdom", iata="LHR", lat=51.4700, lon=-0.4543),
    "IST": dict(name="Istanbul",   country="Türkiye",        iata="IST", lat=41.2753, lon=28.7519),
    "CDG": dict(name="Paris",      country="France",         iata="CDG", lat=49.0097, lon=2.5479),
    "AMS": dict(name="Amsterdam",  country="Netherlands",    iata="AMS", lat=52.3105, lon=4.7683),
    "FRA": dict(name="Frankfurt",  country="Germany",        iata="FRA", lat=50.0379, lon=8.5622),
    "MAD": dict(name="Madrid",     country="Spain",          iata="MAD", lat=40.4719, lon=-3.5626),
}

DESTINATIONS: list[tuple] = [
    ("Paris",       "France",         "CDG", "🇫🇷", 48.8566,   2.3522, True),
    ("Amsterdam",   "Netherlands",    "AMS", "🇳🇱", 52.3676,   4.9041, True),
    ("Brussels",    "Belgium",        "BRU", "🇧🇪", 50.8503,   4.3517, True),
    ("London",      "United Kingdom", "LHR", "🇬🇧", 51.5074,  -0.1278, True),
    ("Madrid",      "Spain",          "MAD", "🇪🇸", 40.4168,  -3.7038, False),
    ("Barcelona",   "Spain",          "BCN", "🇪🇸", 41.3851,   2.1734, False),
    ("Lisbon",      "Portugal",       "LIS", "🇵🇹", 38.7223,  -9.1393, False),
    ("Rome",        "Italy",          "FCO", "🇮🇹", 41.9028,  12.4964, False),
    ("Milan",       "Italy",          "MXP", "🇮🇹", 45.4642,   9.1900, True),
    ("Florence",    "Italy",          "FLR", "🇮🇹", 43.7696,  11.2558, False),
    ("Venice",      "Italy",          "VCE", "🇮🇹", 45.4408,  12.3155, True),
    ("Naples",      "Italy",          "NAP", "🇮🇹", 40.8518,  14.2681, False),
    ("Vienna",      "Austria",        "VIE", "🇦🇹", 48.2082,  16.3738, True),
    ("Salzburg",    "Austria",        "SZG", "🇦🇹", 47.8095,  13.0550, True),
    ("Zurich",      "Switzerland",    "ZRH", "🇨🇭", 47.3769,   8.5417, True),
    ("Geneva",      "Switzerland",    "GVA", "🇨🇭", 46.2044,   6.1432, False),
    ("Munich",      "Germany",        "MUC", "🇩🇪", 48.1351,  11.5820, True),
    ("Hamburg",     "Germany",        "HAM", "🇩🇪", 53.5511,   9.9937, True),
    ("Frankfurt",   "Germany",        "FRA", "🇩🇪", 50.1109,   8.6821, True),
    ("Cologne",     "Germany",        "CGN", "🇩🇪", 50.9375,   6.9603, True),
    ("Copenhagen",  "Denmark",        "CPH", "🇩🇰", 55.6761,  12.5683, True),
    ("Stockholm",   "Sweden",         "ARN", "🇸🇪", 59.3293,  18.0686, False),
    ("Oslo",        "Norway",         "OSL", "🇳🇴", 59.9139,  10.7522, False),
    ("Helsinki",    "Finland",        "HEL", "🇫🇮", 60.1699,  24.9384, False),
    ("Reykjavik",   "Iceland",        "KEF", "🇮🇸", 64.1466, -21.9426, False),
    ("Dublin",      "Ireland",        "DUB", "🇮🇪", 53.3498,  -6.2603, False),
    ("Edinburgh",   "United Kingdom", "EDI", "🇬🇧", 55.9533,  -3.1883, False),
    ("Warsaw",      "Poland",         "WAW", "🇵🇱", 52.2297,  21.0122, True),
    ("Krakow",      "Poland",         "KRK", "🇵🇱", 50.0647,  19.9450, True),
    ("Prague",      "Czechia",        "PRG", "🇨🇿", 50.0755,  14.4378, True),
    ("Budapest",    "Hungary",        "BUD", "🇭🇺", 47.4979,  19.0402, True),
    ("Bratislava",  "Slovakia",       "BTS", "🇸🇰", 48.1486,  17.1077, True),
    ("Ljubljana",   "Slovenia",       "LJU", "🇸🇮", 46.0569,  14.5058, True),
    ("Zagreb",      "Croatia",        "ZAG", "🇭🇷", 45.8150,  15.9819, True),
    ("Athens",      "Greece",         "ATH", "🇬🇷", 37.9838,  23.7275, False),
    ("Istanbul",    "Türkiye",        "IST", "🇹🇷", 41.0082,  28.9784, False),
    ("Sofia",       "Bulgaria",       "SOF", "🇧🇬", 42.6977,  23.3219, False),
    ("Bucharest",   "Romania",        "OTP", "🇷🇴", 44.4268,  26.1025, False),
    ("Tallinn",     "Estonia",        "TLL", "🇪🇪", 59.4370,  24.7536, False),
    ("Riga",        "Latvia",         "RIX", "🇱🇻", 56.9496,  24.1052, False),
]

POPULARITY: dict[str, int] = {
    "Paris":95,"Amsterdam":88,"Brussels":70,"London":96,"Madrid":82,
    "Barcelona":90,"Lisbon":75,"Rome":92,"Milan":80,"Florence":84,
    "Venice":86,"Naples":72,"Vienna":78,"Salzburg":64,"Zurich":70,
    "Geneva":66,"Munich":74,"Hamburg":62,"Frankfurt":58,"Cologne":60,
    "Copenhagen":76,"Stockholm":74,"Oslo":68,"Helsinki":60,"Reykjavik":70,
    "Dublin":78,"Edinburgh":76,"Warsaw":62,"Krakow":80,"Prague":84,
    "Budapest":80,"Bratislava":54,"Ljubljana":60,"Zagreb":64,"Athens":86,
    "Istanbul":82,"Sofia":56,"Bucharest":58,"Tallinn":64,"Riga":60,
}

PHOTOS: dict[str, str] = {
    "Paris":"1502602898657-3e91760cbb34","Amsterdam":"1534351590666-13e3e96c5017",
    "Brussels":"1559113202-c916b8e44373","London":"1513635269975-59663e0ac1ad",
    "Madrid":"1543783207-ec64e4d95325","Barcelona":"1583422409516-2895a77efded",
    "Lisbon":"1585208798174-6cedd86e019a","Rome":"1552832230-c0197dd311b5",
    "Milan":"1520440229-6469a149ac59","Florence":"1543429776-2782fc8e1acd",
    "Venice":"1514890547357-a9ee288728e0","Naples":"1583000186270-d3b0fec0d2c8",
    "Vienna":"1516550893923-42d28e5677af","Salzburg":"1527668752968-14dc70a27c95",
    "Zurich":"1515488764276-beab7607c1e6","Geneva":"1573646039569-4554bd8a4f1f",
    "Munich":"1595867818082-083862f3d630","Hamburg":"1552751753-0fc84ae45d76",
    "Frankfurt":"1577462281852-279f56bcc5fc","Cologne":"1597531072931-8af557b9e1bc",
    "Copenhagen":"1513622470522-26c3c8a854bc","Stockholm":"1509356843151-3e7d96241e4f",
    "Oslo":"1565127872875-15cba4f2c63e","Helsinki":"1559682468-a6a29e7d9517",
    "Reykjavik":"1504541989296-bcbc1bf18086","Dublin":"1518005020951-eccb494ad742",
    "Edinburgh":"1581345628965-9adb6e6b6e07","Warsaw":"1607427293702-036933bbf746",
    "Krakow":"1546874177-9e664107314e","Prague":"1519677100203-a0e668c92439",
    "Budapest":"1541849546-216549ae216d","Bratislava":"1568797629192-d4eb6b35915a",
    "Ljubljana":"1601370690183-1c7796ecec64","Zagreb":"1591375372226-1c5e3c39a40f",
    "Athens":"1555993539-1732b0258235","Istanbul":"1524231757912-21f4fe3a7200",
    "Sofia":"1601225998000-04e4d1b1d5ae","Bucharest":"1567696911980-d3f99bcd1a02",
    "Tallinn":"1567181255830-69d2a7a1b0c1","Riga":"1601224335112-b9c0e6b7a4c1",
}

# ──────────────────────────────────────────────────────────
# EMISSION FACTORS — DEFRA 2024
# ──────────────────────────────────────────────────────────
CO2_PLANE_SHORT = 0.246   # kg CO₂e/pass·km  < 1500 km
CO2_PLANE_LONG  = 0.156   # kg CO₂e/pass·km  ≥ 1500 km
CO2_TRAIN_EU    = 0.035   # kg CO₂e/pass·km
RFI             = 1.9     # radiative forcing index (aviation only)

PLANE_KMH       = 800
TRAIN_KMH       = 130
AIRPORT_OVHD    = 3.0     # hours
STATION_OVHD    = 0.5     # hours

FARE_PLANE_BASE = 60.0
FARE_PLANE_KM   = 0.085
FARE_TRAIN_BASE = 35.0
FARE_TRAIN_KM   = 0.055

# Seasonal multipliers for heuristic prices (index 0 = January)
# Based on typical European low-cost carrier pricing patterns
SEASON = [0.75, 0.72, 0.80, 0.90, 1.00, 1.15,
          1.40, 1.35, 1.05, 0.88, 0.78, 0.95]

EARTH_R = 6371.0088


# ──────────────────────────────────────────────────────────
# GEODESY
# ──────────────────────────────────────────────────────────
def haversine(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * EARTH_R * math.asin(math.sqrt(a))

def bearing(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1)*math.sin(p2) - math.sin(p1)*math.cos(p2)*math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def choose_mode(dist_km: float, train_ok: bool) -> str:
    return "train" if (train_ok and dist_km < 600) else "plane"


# ──────────────────────────────────────────────────────────
# HEURISTIC MODELS
# ──────────────────────────────────────────────────────────
def heuristic_plane_oneway(dist_km: float, month_idx: int) -> tuple[float, float, float]:
    """Returns (time_h, cost_eur, co2_kg) one-way."""
    t    = dist_km / PLANE_KMH + AIRPORT_OVHD
    base = FARE_PLANE_BASE + FARE_PLANE_KM * dist_km
    cost = base * SEASON[month_idx]
    factor = CO2_PLANE_SHORT if dist_km < 1500 else CO2_PLANE_LONG
    co2  = factor * dist_km * RFI
    return t, cost, co2

def heuristic_train_oneway(dist_km: float, month_idx: int) -> tuple[float, float, float]:
    """Returns (time_h, cost_eur, co2_kg) one-way."""
    rail = dist_km * 1.25
    t    = rail / TRAIN_KMH + STATION_OVHD
    base = FARE_TRAIN_BASE + FARE_TRAIN_KM * rail
    cost = base * SEASON[month_idx]
    co2  = CO2_TRAIN_EU * rail
    return t, cost, co2


# ──────────────────────────────────────────────────────────
# MONTH RANGE HELPER
# ──────────────────────────────────────────────────────────
def month_range(start: str, end: str) -> list[str]:
    """Return list of 'YYYY-MM' strings from start to end inclusive."""
    months = []
    y, m = int(start[:4]), int(start[5:7])
    ey, em = int(end[:4]), int(end[5:7])
    while (y, m) <= (ey, em):
        months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return months


# ──────────────────────────────────────────────────────────
# TRAVELPAYOUTS API
# ──────────────────────────────────────────────────────────
TP_BASE = "https://api.travelpayouts.com"

def tp_fetch(token: str, origin_iata: str, dest_iata: str,
             month: str, cache: dict) -> dict | None:
    """
    GET /v1/prices/cheap  — cheapest price + duration for a route/month.
    Returns {"price_eur": float, "duration_h": float} or None.
    Caches responses to avoid repeat calls.
    """
    key = f"{origin_iata}|{dest_iata}|{month}"
    if key in cache:
        return cache[key]

    try:
        r = requests.get(
            f"{TP_BASE}/v1/prices/cheap",
            headers={"X-Access-Token": token},
            params={
                "origin":      origin_iata,
                "destination": dest_iata,
                "depart_date": month,
                "return_date": "",
                "currency":    "eur",
                "limit":       1,
            },
            timeout=12,
        )
        if r.status_code != 200:
            cache[key] = None
            return None

        data = r.json().get("data", {})
        for _, offers in data.items():
            for _, offer in offers.items():
                price    = offer.get("price")
                duration = offer.get("duration")  # minutes
                if price and duration:
                    result = {
                        "price_eur":  float(price),
                        "duration_h": float(duration) / 60.0,
                    }
                    cache[key] = result
                    return result

        cache[key] = None
        return None

    except Exception as e:
        print(f"    ! TP error {origin_iata}→{dest_iata} {month}: {e}", file=sys.stderr)
        cache[key] = None
        return None


# ──────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────
def build(origins: list[str], months: list[str], refresh: bool,
          out_path: Path, cache_path: Path) -> None:

    # Load disk cache
    cache: dict = {}
    if cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            cache = {}

    token = os.environ.get("TP_TOKEN", "")
    if refresh and not token:
        print("⚠  TP_TOKEN not set — using heuristic prices for all months.", file=sys.stderr)
        refresh = False

    rows = []
    total_tp = 0
    total_heuristic = 0

    for okey in origins:
        if okey not in ORIGINS:
            print(f"! unknown origin '{okey}'", file=sys.stderr)
            continue
        O = ORIGINS[okey]
        print(f"\n▶ Origin: {O['name']} ({okey})")

        for city, country, iata, flag, lat, lon, train_ok in DESTINATIONS:
            if city == O["name"]:
                continue

            dist = haversine(O["lat"], O["lon"], lat, lon)
            brg  = bearing(O["lat"], O["lon"], lat, lon)
            mode = choose_mode(dist, train_ok)

            # CO₂ is stable — does not change per month
            if mode == "plane":
                factor = CO2_PLANE_SHORT if dist < 1500 else CO2_PLANE_LONG
                co2_ow = factor * dist * RFI
                t_base, _, _ = heuristic_plane_oneway(dist, 8)  # baseline time
            else:
                co2_ow = CO2_TRAIN_EU * dist * 1.25
                t_base, _, _ = heuristic_train_oneway(dist, 8)

            # Build per-month pricing
            month_data: dict[str, dict] = {}

            for month in months:
                month_idx = int(month[5:7]) - 1  # 0-based

                tp_result = None
                if refresh and mode == "plane":
                    tp_result = tp_fetch(token, O["iata"], iata, month, cache)
                    time.sleep(0.12)

                if tp_result:
                    t_ow   = tp_result["duration_h"] + AIRPORT_OVHD
                    cost_ow = tp_result["price_eur"]
                    src    = "travelpayouts"
                    total_tp += 1
                elif mode == "plane":
                    t_ow, cost_ow, _ = heuristic_plane_oneway(dist, month_idx)
                    src = "heuristic"
                    total_heuristic += 1
                else:
                    t_ow, cost_ow, _ = heuristic_train_oneway(dist, month_idx)
                    src = "heuristic"
                    total_heuristic += 1

                month_data[month] = {
                    "time_h":   round(t_ow * 2, 1),      # round-trip
                    "cost_eur": round(cost_ow * 2),       # round-trip
                    "co2_kg":   round(co2_ow * 2),        # round-trip (stable)
                    "source":   src,
                }

            rows.append({
                "origin":       O["iata"],
                "origin_name":  O["name"],
                "city":         city,
                "country":      country,
                "iata":         iata,
                "flag":         flag,
                "lat":          lat,
                "lon":          lon,
                "distance_km":  round(dist, 1),
                "bearing_deg":  round(brg, 1),
                "mode":         mode,
                "popularity":   POPULARITY.get(city, 50),
                "photo_id":     PHOTOS.get(city, ""),
                "months":       month_data,
            })

        n = len([r for r in rows if r["origin"] == okey])
        print(f"  ✓ {n} destinations × {len(months)} months = {n*len(months)} price points")

    # Save API cache to disk
    cache_path.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Write master JSON
    out_path.parent.mkdir(parents=True, exist_ok=True)
    output = {
        "metadata": {
            "origins":    origins,
            "months":     months,
            "built_at":   date.today().isoformat(),
            "co2_source": "DEFRA2024+RFI1.9",
            "pop_source": "TourMIS_proxy",
            "price_note": "round-trip EUR, cheapest available per month",
        },
        "data": rows,
    }
    out_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    total = total_tp + total_heuristic
    print(f"\n{'─'*50}")
    print(f"  ✓ {len(rows)} routes × {len(months)} months")
    print(f"  ✓ price points: {total_tp} Travelpayouts · {total_heuristic} heuristic")
    print(f"  ✓ output → {out_path}  ({out_path.stat().st_size//1024} KB)")


# ──────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(
        description="Build PerceMap multi-month destinations JSON."
    )
    ap.add_argument("--origins", nargs="+", default=list(ORIGINS.keys()),
                    help="Origin airport codes (default: all 5)")
    ap.add_argument("--start",   default="2026-01",
                    help="First month YYYY-MM (default: 2026-01)")
    ap.add_argument("--end",     default="2026-12",
                    help="Last month YYYY-MM  (default: 2026-12)")
    ap.add_argument("--refresh-prices", action="store_true",
                    help="Call Travelpayouts API (requires TP_TOKEN env var)")
    ap.add_argument("--out",     default="data/destinations_all_months.json",
                    help="Output JSON path")
    ap.add_argument("--cache",   default=".tp_cache.json",
                    help="Local Travelpayouts response cache")
    args = ap.parse_args()

    months = month_range(args.start, args.end)

    print("PerceMap · multi-month destination builder v3")
    print(f"  origins : {' '.join(args.origins)}")
    print(f"  months  : {months[0]} → {months[-1]}  ({len(months)} months)")
    print(f"  prices  : {'Travelpayouts API' if args.refresh_prices else 'heuristic (seasonal multipliers)'}")
    print(f"  CO₂     : DEFRA 2024 + RFI 1.9  (stable, not month-dependent)")
    print(f"  pop     : TourMIS proxy  (stable)")

    build(
        origins    = args.origins,
        months     = months,
        refresh    = args.refresh_prices,
        out_path   = Path(args.out),
        cache_path = Path(args.cache),
    )

    print()
    print("  Next: place destinations_all_months.json next to percemap_v4.html")
    print("  Refresh prices monthly: python build_destinations_v3.py --refresh-prices")


if __name__ == "__main__":
    main()
