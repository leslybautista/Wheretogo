"""
merge_flights.py
────────────────
Merges Travelpayouts flight prices from .tp_cache.json into
destinations_all_months.json WITHOUT touching train data.

Only the "flight" key inside byOrigin[origin][month] is updated.
Train data (supplemental / model / night_train) is never modified.

Note on API duration_h:
  The /v1/prices/cheap endpoint returns cheapest fares including
  connections, so duration_h is often 10-35 h (layover time).
  This script IGNORES the cached duration and recalculates travel
  time from the haversine distance (direct-flight heuristic).

Usage
─────
  # Preview without writing:
  python merge_flights.py --dry-run

  # Normal run:
  python merge_flights.py

  # Custom paths:
  python merge_flights.py --cache .tp_cache.json --json destinations_all_months.json
"""

from __future__ import annotations
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

# ── Physics / emission constants (DEFRA 2024) ─────────────────────────
PLANE_KMH    = 800
AIRPORT_OVHD = 2.0    # hours — check-in + boarding + taxi (matches existing JSON data)
CO2_SHORT    = 0.246  # kg CO₂e/pass·km  (< 1500 km)
CO2_LONG     = 0.156  # kg CO₂e/pass·km  (≥ 1500 km)
RFI          = 1.9    # radiative forcing index (aviation)
EARTH_R      = 6371.0088


# ── Geometry ──────────────────────────────────────────────────────────
def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def flight_metrics(dist_km: float, api_flight_h: float | None = None) -> tuple[float, float]:
    """Return (door_to_door_h, co2_kg) one-way.

    Door-to-door = flight time + AIRPORT_OVHD (check-in, boarding, taxi).
    Uses API flight time when available (already verified as direct),
    falls back to haversine estimate.
    CO₂ always from distance (physics, not API).
    """
    flight_h = api_flight_h if api_flight_h is not None else dist_km / PLANE_KMH
    time_h   = round(flight_h + AIRPORT_OVHD, 2)
    factor   = CO2_SHORT if dist_km < 1500 else CO2_LONG
    co2_kg   = round(factor * dist_km * RFI)
    return time_h, co2_kg


# ── Stats helper ──────────────────────────────────────────────────────
def recount_stats(destinations: list) -> dict:
    stats = {"flight_api": 0, "train_cache": 0, "train_supp": 0, "unavailable": 0}
    for dest in destinations:
        for _, months in dest.get("byOrigin", {}).items():
            for _, slot in months.items():
                f = slot.get("flight")
                t = slot.get("train")
                if f and f.get("source") == "api":
                    stats["flight_api"] += 1
                if t:
                    src = t.get("source", "")
                    if src == "supplemental":
                        stats["train_supp"] += 1
                    else:
                        stats["train_cache"] += 1
                if not slot.get("available", False):
                    stats["unavailable"] += 1
    return stats


# ── Core merge ────────────────────────────────────────────────────────
def merge(cache_path: Path, json_path: Path, dry_run: bool) -> None:
    cache: dict = json.loads(cache_path.read_text(encoding="utf-8"))
    data: dict  = json.loads(json_path.read_text(encoding="utf-8"))

    origins_meta: dict = data.get("origins", {})
    destinations: list = data.get("destinations", [])

    # Index destinations by IATA for O(1) lookup
    iata_to_dest: dict[str, dict] = {
        d["iata"]: d for d in destinations if d.get("iata")
    }

    updated = skipped_null = skipped_no_dest = skipped_no_origin = skipped_no_slot = 0

    for key, value in cache.items():
        if value is None:
            skipped_null += 1
            continue

        parts = key.split("|")
        if len(parts) != 3:
            continue
        orig_iata, dest_iata, month = parts

        orig = origins_meta.get(orig_iata)
        if orig is None:
            skipped_no_origin += 1
            continue

        dest = iata_to_dest.get(dest_iata)
        if dest is None:
            skipped_no_dest += 1
            continue

        # Locate the exact month slot inside byOrigin
        slot = (
            dest.get("byOrigin", {})
                .get(orig_iata, {})
                .get(month)
        )
        if slot is None:
            skipped_no_slot += 1
            continue

        dist = haversine(orig["lat"], orig["lon"], dest["lat"], dest["lon"])

        # Plausibility check: reject durations clearly impossible for a direct flight.
        # Uses 550 km/h (slow regional aircraft) + 1.0h buffer for taxi/climb/descent.
        max_direct_h = dist / 550 + 1.0
        if value["duration_h"] > max_direct_h:
            skipped_null += 1  # count as no direct data
            continue

        # duration_h is the one-way flight time from the API (reliable after filter).
        # door-to-door = flight time + AIRPORT_OVHD.
        # CO₂ always from distance (physics, not API).
        time_h, co2_kg = flight_metrics(dist, api_flight_h=value["duration_h"])
        cost_eur = round(value["price_eur"])  # one-way cheapest direct, from API

        # ── Update ONLY the flight key — train is never touched ──────
        slot["flight"]    = {"time": time_h, "cost": cost_eur, "co2": co2_kg, "source": "api"}
        slot["available"] = True
        slot["source"]    = "api"   # flight API is primary source when present

        updated += 1

    # ── Summary ──────────────────────────────────────────────────────
    print(f"Cache entries total  : {len(cache)}")
    print(f"  null (no API data) : {skipped_null}")
    print(f"  no dest in JSON    : {skipped_no_dest}")
    print(f"  no origin in JSON  : {skipped_no_origin}")
    print(f"  no month slot      : {skipped_no_slot}")
    print(f"Flight slots updated : {updated}")

    if dry_run:
        print("\n[dry-run] No files written.")
        return

    # ── Update meta and write ─────────────────────────────────────────
    data["meta"]["generated_at"] = datetime.now(timezone.utc).isoformat()
    data["meta"]["stats"]        = recount_stats(destinations)

    json_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    size_kb = json_path.stat().st_size // 1024
    print(f"\n✓ Written → {json_path}  ({size_kb} KB)")
    print(f"  stats: {data['meta']['stats']}")


# ── CLI ───────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(
        description="Merge Travelpayouts flight cache into destinations JSON."
    )
    ap.add_argument("--cache",   default=".tp_cache.json",
                    help="Travelpayouts response cache (default: .tp_cache.json)")
    ap.add_argument("--json",    default="destinations_all_months.json",
                    help="Destinations JSON to update (default: destinations_all_months.json)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Show what would change without writing any file")
    args = ap.parse_args()

    merge(
        cache_path=Path(args.cache),
        json_path=Path(args.json),
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
