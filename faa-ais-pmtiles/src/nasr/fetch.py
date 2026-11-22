"""
Fetch FAA NASR 28-day data for airport facilities, VFR fixes, MTRs, and metadata.

Retrieves fuel availability, control tower presence, FAR 139 certification status,
operational facility/runway attributes, parachute jump areas, VFR/sectional fixes,
and military training routes to support ingestion, ranking, and filtering.
"""

import csv
import io
import json
import math
import os
import zipfile
from collections import defaultdict
from collections.abc import Iterable

import requests

from src.common.utils import get_cycle_dates
from src.nasr.facilities import _open_csv_stream, _parse_coord, parse_nasr_facilities
from src.nasr.pja import parse_pja_csv

NFDC_BASE = "https://nfdc.faa.gov/webContent/28DaySub/"

SECTIONAL_FIX_CHARTS = (
    "SECTIONAL",
    "VFR TERMINAL AREA",
    "VFR FLYWAY PLANNING",
    "HELICOPTER ROUTE",
    "GULF COAST VFR CHART",
)


def _parse_seq(value: object) -> int | float:
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        num = float(text)
    except ValueError:
        return 0
    if not math.isfinite(num):
        return 0
    return int(num) if num.is_integer() else num


def parse_nasr_fixes_csv(csv_stream: Iterable[str] | str | os.PathLike[str]) -> dict:
    """Parse NASR `FIX_BASE.csv` into VFR waypoints and sectional fixes."""
    stream, should_close = _open_csv_stream(csv_stream)
    vfr_waypoints: list[dict] = []
    sectional_fixes: list[dict] = []

    try:
        reader = csv.DictReader(stream)
        for row in reader:
            fix_id = (row.get("FIX_ID") or "").strip()
            if not fix_id:
                continue

            coords = _parse_coord(row.get("LAT_DECIMAL"), row.get("LONG_DECIMAL"))
            if coords is None:
                continue
            lat, lon = coords

            fix_use = (row.get("FIX_USE_CODE") or "").strip()
            charts = (row.get("CHARTS") or "").strip()
            state = (row.get("STATE_CODE") or "").strip()
            compulsory_raw = (row.get("COMPULSORY") or row.get("ATC_COMPULSORY") or "").strip().upper()
            compulsory = bool(compulsory_raw) and compulsory_raw not in {"N", "NO", "NONE"}
            name = (row.get("NAME") or "").strip()

            if fix_use.upper() == "VFR":
                entry: dict = {
                    "id": fix_id,
                    "lat": lat,
                    "lon": lon,
                    "state": state,
                    "charts": charts,
                    "compulsory": compulsory,
                }
                if name:
                    entry["name"] = name
                vfr_waypoints.append(entry)
            else:
                charts_upper = charts.upper()
                if any(chart in charts_upper for chart in SECTIONAL_FIX_CHARTS):
                    entry = {
                        "id": fix_id,
                        "lat": lat,
                        "lon": lon,
                        "state": state,
                        "charts": charts,
                        "fix_use": fix_use,
                        "compulsory": compulsory,
                    }
                    if name:
                        entry["name"] = name
                    sectional_fixes.append(entry)
    finally:
        if should_close and hasattr(stream, "close"):
            stream.close()

    return {"vfr_waypoints": vfr_waypoints, "sectional_fixes": sectional_fixes}


def parse_nasr_mtr_csvs(
    mtr_base_stream: Iterable[str] | str | os.PathLike[str] | None,
    mtr_pt_stream: Iterable[str] | str | os.PathLike[str] | None,
) -> dict:
    """Parse NASR `MTR_BASE.csv` and `MTR_PT.csv` into route metadata and sorted point sequences."""
    routes: dict[str, dict] = {}
    points: dict[str, list[dict]] = defaultdict(list)

    if mtr_base_stream is not None:
        base_stream, should_close_base = _open_csv_stream(mtr_base_stream)
        try:
            reader = csv.DictReader(base_stream)
            for row in reader:
                type_code = (row.get("ROUTE_TYPE_CODE") or "").strip()
                route_id_str = (row.get("ROUTE_ID") or "").strip()
                if not route_id_str:
                    continue
                route_id = f"{type_code}{route_id_str}"
                routes[route_id] = {
                    "mtr_type": type_code,
                    "artcc": (row.get("ARTCC") or "").strip(),
                    "fss": (row.get("FSS") or "").strip(),
                    "time_of_use": (row.get("TIME_OF_USE") or "").strip(),
                }
        finally:
            if should_close_base and hasattr(base_stream, "close"):
                base_stream.close()

    if mtr_pt_stream is not None:
        pt_stream, should_close_pt = _open_csv_stream(mtr_pt_stream)
        try:
            reader = csv.DictReader(pt_stream)
            for row in reader:
                type_code = (row.get("ROUTE_TYPE_CODE") or "").strip()
                route_id_str = (row.get("ROUTE_ID") or "").strip()
                if not route_id_str:
                    continue
                coords = _parse_coord(row.get("LAT_DECIMAL"), row.get("LONG_DECIMAL"))
                if coords is None:
                    continue
                lat, lon = coords
                route_id = f"{type_code}{route_id_str}"
                points[route_id].append(
                    {
                        "seq": _parse_seq(row.get("ROUTE_PT_SEQ")),
                        "lat": lat,
                        "lon": lon,
                        "pt_id": (row.get("ROUTE_PT_ID") or "").strip(),
                        "segment_text": (row.get("SEGMENT_TEXT") or "").strip(),
                    }
                )
        finally:
            if should_close_pt and hasattr(pt_stream, "close"):
                pt_stream.close()

    for pts in points.values():
        pts.sort(key=lambda pt: pt["seq"])

    return {"routes": routes, "points": dict(points)}


def find_latest_csv_zip_url() -> tuple[str, str]:
    """Find the latest CSV zip by trying generated cycle dates. Returns (url, cycle_date)."""
    print("Finding latest FAA 28-day NASR CSV bundle...")
    dates = get_cycle_dates()

    for cycle_date in dates:
        folder_date = cycle_date.strftime("%Y-%m-%d")
        file_date = cycle_date.strftime("%d_%b_%Y")

        # Try both the standard location and the 'extra' folder
        urls_to_try = [
            f"{NFDC_BASE}{folder_date}/28DaySubscription_CSV.zip",
            f"{NFDC_BASE}extra/{file_date}_CSV.zip",
        ]

        for url in urls_to_try:
            try:
                print(f"Checking {url}...")
                # Use GET with stream=True to avoid Akamai 503s on HEAD requests
                resp = requests.get(url, stream=True, timeout=10)
                if resp.status_code == 200:
                    resp.close()
                    return url, folder_date
                resp.close()
            except requests.RequestException:
                continue

    # Fallback to a hardcoded baseline if all else fails
    print("Could not find NASR bundle; using fallback logic.")
    return (
        "https://nfdc.faa.gov/webContent/28DaySub/2026-03-19/28DaySubscription_CSV.zip",
        "2026-03-19",
    )


def get_airport_metadata() -> dict[str, dict]:
    """Download NASR CSV zip and return a dict of {airport_id: {has_fuel, has_tower, far_139}}."""
    url, cycle_date = find_latest_csv_zip_url()

    cache_path = "data/nasr_metadata.json"
    facilities_path = "data/nasr_facilities.json"
    cycle_path = "data/nasr_metadata.cycle"
    pja_raw_path = "data/pja_raw.geojson"
    vfr_fixes_path = "data/nasr_vfr_fixes.json"
    nasr_mtr_path = "data/nasr_mtr_raw.json"

    if (
        os.path.exists(cache_path)
        and os.path.exists(facilities_path)
        and os.path.exists(cycle_path)
        and os.path.exists(pja_raw_path)
        and os.path.exists(vfr_fixes_path)
        and os.path.exists(nasr_mtr_path)
    ):
        with open(cycle_path) as f:
            if f.read().strip() == cycle_date:
                print(f"NASR airport metadata, PJA, VFR fixes, and MTR data for cycle {cycle_date} already exist. Skipping download.")
                with open(cache_path) as cache_f:
                    return json.load(cache_f)
    print(f"Downloading NASR CSV bundle from {url}...")

    try:
        r = requests.get(url, timeout=120)
        r.raise_for_status()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 503:
            # Hardcoded fallback for now if cycle dates fail
            extra_url = "https://nfdc.faa.gov/webContent/28DaySub/extra/19_Mar_2026_CSV.zip"
            print(f"HTTP 503 Error. Retrying with fallback URL: {extra_url}")
            r = requests.get(extra_url, timeout=120)
            r.raise_for_status()
        else:
            raise

    os.makedirs("data", exist_ok=True)
    facilities: list[dict] = []
    metadata_lookup: dict[str, dict] = {}
    vfr_fixes: dict = {"vfr_waypoints": [], "sectional_fixes": []}
    mtr_data: dict = {"routes": {}, "points": {}}

    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        apt_filename = None
        rwy_filename = None
        pja_filename = None
        fix_filename = None
        mtr_base_filename = None
        mtr_pt_filename = None
        for name in z.namelist():
            upper_name = name.upper()
            if apt_filename is None and upper_name.endswith("APT_BASE.CSV"):
                apt_filename = name
            elif rwy_filename is None and upper_name.endswith("APT_RWY.CSV"):
                rwy_filename = name
            elif pja_filename is None and upper_name.endswith("PJA_BASE.CSV"):
                pja_filename = name
            elif fix_filename is None and upper_name.endswith("FIX_BASE.CSV"):
                fix_filename = name
            elif mtr_base_filename is None and upper_name.endswith("MTR_BASE.CSV"):
                mtr_base_filename = name
            elif mtr_pt_filename is None and upper_name.endswith("MTR_PT.CSV"):
                mtr_pt_filename = name

        if apt_filename:
            print(f"Parsing {apt_filename} for airport facilities and metadata...")
            with z.open(apt_filename) as f:
                apt_stream = io.TextIOWrapper(f, encoding="utf-8", errors="replace")
                if rwy_filename:
                    print(f"Parsing {rwy_filename} for runway surface and length...")
                    with z.open(rwy_filename) as rf:
                        rwy_stream = io.TextIOWrapper(rf, encoding="utf-8", errors="replace")
                        facilities, metadata_lookup = parse_nasr_facilities(apt_stream, rwy_stream)
                else:
                    facilities, metadata_lookup = parse_nasr_facilities(apt_stream, None)
        else:
            print("Warning: APT_BASE.csv not found in the NASR zip.")

        if pja_filename:
            print(f"Parsing {pja_filename} for parachute jump areas...")
            with z.open(pja_filename) as f:
                pja_features = parse_pja_csv(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
            with open(pja_raw_path, "w") as f:
                json.dump({"type": "FeatureCollection", "features": pja_features}, f)
            print(f"Saved {len(pja_features)} PJAs to {pja_raw_path}")
        else:
            print("Warning: PJA_BASE.csv not found in the NASR zip.")

        if fix_filename:
            print(f"Parsing {fix_filename} for VFR waypoints and sectional fixes...")
            with z.open(fix_filename) as f:
                vfr_fixes = parse_nasr_fixes_csv(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
            print(f"Parsed {len(vfr_fixes['vfr_waypoints'])} VFR waypoints and {len(vfr_fixes['sectional_fixes'])} sectional fixes.")
        else:
            print("Warning: FIX_BASE.csv not found in the NASR zip.")

        if mtr_base_filename or mtr_pt_filename:
            print(f"Parsing MTR CSVs ({mtr_base_filename}, {mtr_pt_filename})...")
            if mtr_base_filename and mtr_pt_filename:
                with z.open(mtr_base_filename) as bf, z.open(mtr_pt_filename) as pf:
                    mtr_data = parse_nasr_mtr_csvs(
                        io.TextIOWrapper(bf, encoding="utf-8", errors="replace"),
                        io.TextIOWrapper(pf, encoding="utf-8", errors="replace"),
                    )
            elif mtr_base_filename:
                with z.open(mtr_base_filename) as bf:
                    mtr_data = parse_nasr_mtr_csvs(
                        io.TextIOWrapper(bf, encoding="utf-8", errors="replace"),
                        None,
                    )
            else:
                with z.open(mtr_pt_filename) as pf:
                    mtr_data = parse_nasr_mtr_csvs(
                        None,
                        io.TextIOWrapper(pf, encoding="utf-8", errors="replace"),
                    )
            print(f"Parsed {len(mtr_data['routes'])} MTR routes and {len(mtr_data['points'])} MTR point sequences.")
        else:
            print("Warning: MTR_BASE.csv and MTR_PT.csv not found in the NASR zip.")

    if not apt_filename:
        return metadata_lookup

    print(f"Found {len(facilities)} operational facilities and metadata for {len(metadata_lookup)} airport IDs.")

    with open(cache_path, "w") as f:
        json.dump(metadata_lookup, f)
    with open(facilities_path, "w") as f:
        json.dump(facilities, f)
    with open(vfr_fixes_path, "w") as f:
        json.dump(vfr_fixes, f)
    with open(nasr_mtr_path, "w") as f:
        json.dump(mtr_data, f)
    with open(cycle_path, "w") as f:
        f.write(cycle_date)

    return metadata_lookup


def load_nasr_metadata() -> dict[str, dict]:
    """Fast check: returns the cached metadata if it exists, otherwise empty dict."""
    cache_path = "data/nasr_metadata.json"
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            return json.load(f)
    return {}


def load_nasr_facilities() -> list[dict]:
    """Fast check: returns the cached operational NASR facilities list if it exists, otherwise empty list."""
    facilities_path = "data/nasr_facilities.json"
    if os.path.exists(facilities_path):
        with open(facilities_path) as f:
            return json.load(f)
    return []


def load_nasr_vfr_fixes() -> dict:
    """Fast check: returns the cached NASR VFR waypoints and sectional fixes if they exist, otherwise empty stub."""
    vfr_fixes_path = "data/nasr_vfr_fixes.json"
    if os.path.exists(vfr_fixes_path):
        with open(vfr_fixes_path) as f:
            return json.load(f)
    return {"vfr_waypoints": [], "sectional_fixes": []}


def load_nasr_mtr_data() -> dict:
    """Fast check: returns the cached NASR MTR routes and points if they exist, otherwise empty stub."""
    nasr_mtr_path = "data/nasr_mtr_raw.json"
    if os.path.exists(nasr_mtr_path):
        with open(nasr_mtr_path) as f:
            return json.load(f)
    return {"routes": {}, "points": {}}
