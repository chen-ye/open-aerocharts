"""
Parse FAA NASR 28-day airport facilities (`APT_BASE.csv`) and runways (`APT_RWY.csv`).

Provides runway surface/length aggregation keyed by `(SITE_NO, SITE_TYPE_CODE)`,
facility classification for airports/heliports/seaplanes/ultralights/gliderports/balloonports,
and tower/fuel/FAR 139 metadata extraction.
"""

import csv
import io
import math
import os
import re
from collections import defaultdict
from collections.abc import Iterable

HARD_SURFACE_TOKENS = frozenset({"ASPH", "CONC", "PEM", "PFC", "BRICK", "ALUM", "STEEL", "METAL", "ROOF", "DECK", "MATS"})
UNPAVED_BASE_TOKENS = frozenset({"GRVL", "GRAVEL", "DIRT", "TURF", "GRASS", "SAND", "SOD", "CLAY"})
MILITARY_OWNERSHIP_CODES = frozenset({"MA", "MN", "MR", "CG"})


def _open_csv_stream(csv_input: Iterable[str] | str | os.PathLike[str]) -> tuple[Iterable[str], bool]:
    """Normalize a file path, CSV string, or line iterable into a CSV stream."""
    if isinstance(csv_input, os.PathLike):
        return open(csv_input, encoding="utf-8", errors="replace"), True
    if isinstance(csv_input, str):
        if "\n" not in csv_input and ("," not in csv_input or os.path.exists(csv_input)):
            return open(csv_input, encoding="utf-8", errors="replace"), True
        return io.StringIO(csv_input), False
    return csv_input, False


def _surface_tokens(surface_code: str | None) -> set[str]:
    raw = (surface_code or "").strip().upper()
    if not raw:
        return set()
    return {tok.strip() for tok in re.split(r"[-/]", raw) if tok.strip()}


def _is_hard_surface(tokens: set[str]) -> bool:
    if not tokens:
        return False
    if tokens & HARD_SURFACE_TOKENS:
        return True
    if ("TRTD" in tokens or "TREATED" in tokens) and not (tokens & UNPAVED_BASE_TOKENS):
        return True
    return False


def _parse_runway_length(value: object) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        length = float(text)
    except ValueError:
        return 0
    if not math.isfinite(length) or length <= 0:
        return 0
    return int(round(length))


def _parse_coord(lat_raw: str | None, lon_raw: str | None) -> tuple[float, float] | None:
    lat_str = (lat_raw or "").strip()
    lon_str = (lon_raw or "").strip()
    if not lat_str or not lon_str:
        return None
    try:
        lat = float(lat_str)
        lon = float(lon_str)
    except ValueError:
        return None
    if not (math.isfinite(lat) and math.isfinite(lon)):
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    return lat, lon


def _parse_elevation(elev_raw: str | None) -> float:
    text = (elev_raw or "").strip()
    if not text:
        return 0.0
    try:
        elev = float(text)
    except ValueError:
        return 0.0
    return elev if math.isfinite(elev) else 0.0


def parse_nasr_runways(csv_stream: Iterable[str] | str | os.PathLike[str]) -> dict[tuple[str, str] | str, dict]:
    """Aggregate `APT_RWY.csv` rows by `(SITE_NO, SITE_TYPE_CODE)` with `SITE_NO` fallback when `SITE_TYPE_CODE` is blank."""
    stream, should_close = _open_csv_stream(csv_stream)
    grouped: dict[tuple[str, str], list[tuple[int, bool, bool, bool]]] = defaultdict(list)

    try:
        reader = csv.DictReader(stream)
        for row in reader:
            site_no = (row.get("SITE_NO") or "").strip()
            if not site_no:
                continue

            site_type = (row.get("SITE_TYPE_CODE") or "").strip().upper()
            rwy_id = (row.get("RWY_ID") or "").strip().upper()
            tokens = _surface_tokens(row.get("SURFACE_TYPE_CODE"))
            length = _parse_runway_length(row.get("RWY_LEN"))
            is_hard = _is_hard_surface(tokens)
            is_water = "WATER" in tokens
            is_fixed_wing_land = not rwy_id.startswith("H") and not is_water
            grouped[(site_no, site_type)].append((length, is_hard, is_water, is_fixed_wing_land))
    finally:
        if should_close and hasattr(stream, "close"):
            stream.close()

    runways: dict[tuple[str, str] | str, dict] = {}
    for (site_no, site_type), rows in grouped.items():
        if site_type not in ("H", "V", "C"):
            land_rows = [r for r in rows if r[3]]
            active_rows = land_rows if land_rows else rows
        else:
            active_rows = rows

        longest_runway = max((r[0] for r in active_rows), default=0)
        has_hard_surface = any(r[1] for r in active_rows)
        has_water_surface = any(r[2] for r in active_rows)
        surface = "H" if has_hard_surface else ("W" if site_type == "C" or has_water_surface else "S")

        summary = {
            "longest_runway": longest_runway,
            "has_hard_surface": has_hard_surface,
            "has_water_surface": has_water_surface,
            "surface": surface,
        }
        runways[(site_no, site_type)] = summary
        if not site_type:
            runways[site_no] = summary

    return runways


def classify_nasr_facility(
    site_type: str | None,
    facility_use: str | None,
    ownership: str | None,
    surface: str | None,
) -> tuple[str, bool]:
    """Return `(facility_type, is_military)` from NASR site, use, ownership, and surface codes."""
    st = (site_type or "").strip().upper()
    use = (facility_use or "").strip().upper()
    own = (ownership or "").strip().upper()
    surf = (surface or "").strip().upper()

    is_military = own in MILITARY_OWNERSHIP_CODES

    if st in ("H", "V"):
        return "heliport", is_military
    if st == "U":
        return "ultralight", is_military
    if st == "G":
        return "gliderport", is_military
    if st == "B":
        return "balloonport", is_military
    if st == "C":
        return ("seaplane" if use == "PU" else "seaplane_private"), is_military

    if is_military:
        return "military", True
    if use != "PU":
        return "private", False
    if surf == "H":
        return "civil_hard", False
    return "civil_soft", False


def parse_nasr_facilities(
    apt_base_stream: Iterable[str] | str | os.PathLike[str],
    apt_rwy_stream: Iterable[str] | str | os.PathLike[str] | None = None,
) -> tuple[list[dict], dict[str, dict]]:
    """Parse `APT_BASE.csv` (+ optional `APT_RWY.csv`) into `(facilities, metadata_lookup)`."""
    runways = parse_nasr_runways(apt_rwy_stream) if apt_rwy_stream is not None else {}

    stream, should_close = _open_csv_stream(apt_base_stream)
    facilities: list[dict] = []
    metadata_lookup: dict[str, dict] = {}

    try:
        reader = csv.DictReader(stream)
        for row in reader:
            arpt_id = (row.get("ARPT_ID") or "").strip()
            if not arpt_id:
                continue

            status = (row.get("ARPT_STATUS") or "").strip().upper()
            if status and status != "O":
                continue

            icao_id = (row.get("ICAO_ID") or "").strip()
            fuel_types = (row.get("FUEL_TYPES") or "").strip()
            twr_type = (row.get("TWR_TYPE_CODE") or "").strip().upper()
            far_139 = (row.get("FAR_139_TYPE_CODE") or "").strip()

            has_fuel = bool(fuel_types)
            has_tower = twr_type.startswith("ATCT")

            metadata = {
                "has_fuel": has_fuel,
                "has_tower": has_tower,
                "far_139": far_139,
            }
            metadata_lookup[arpt_id] = metadata
            if icao_id:
                metadata_lookup[icao_id] = metadata

            if status != "O":
                continue

            coords = _parse_coord(row.get("LAT_DECIMAL"), row.get("LONG_DECIMAL"))
            if coords is None:
                continue
            lat, lon = coords

            ident = icao_id or arpt_id
            if not ident:
                continue

            site_no = (row.get("SITE_NO") or "").strip()
            site_type = (row.get("SITE_TYPE_CODE") or "").strip().upper()
            facility_use = (row.get("FACILITY_USE_CODE") or "").strip().upper()
            ownership = (row.get("OWNERSHIP_TYPE_CODE") or "").strip().upper()

            runway_info = runways.get((site_no, site_type)) or (runways.get(site_no) if site_no else None) or {}
            longest_runway = int(runway_info.get("longest_runway", 0))
            has_hard_surface = bool(runway_info.get("has_hard_surface", False))
            has_water_surface = bool(runway_info.get("has_water_surface", False))
            surface = "H" if has_hard_surface else ("W" if site_type == "C" or has_water_surface else "S")

            facility_type, is_military = classify_nasr_facility(site_type, facility_use, ownership, surface)

            facilities.append(
                {
                    "id": ident,
                    "arpt_id": arpt_id,
                    "icao_id": icao_id,
                    "name": (row.get("ARPT_NAME") or "").strip(),
                    "lat": lat,
                    "lon": lon,
                    "elevation": _parse_elevation(row.get("ELEV")),
                    "site_type": site_type,
                    "facility_use": facility_use,
                    "ownership": ownership,
                    "longest_runway": longest_runway,
                    "surface": surface,
                    "facility_type": facility_type,
                    "is_military": is_military,
                    "has_fuel": has_fuel,
                    "has_tower": has_tower,
                    "far_139": far_139,
                }
            )
    finally:
        if should_close and hasattr(stream, "close"):
            stream.close()

    return facilities, metadata_lookup
