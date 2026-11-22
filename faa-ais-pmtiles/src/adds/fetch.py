"""Fetch FAA aeronautical data from NFDC shapefiles and ADDS ArcGIS Hub."""

import json
import os
import time
import zipfile

import requests

from src.common.utils import get_cycle_dates

NFDC_BASE = "https://nfdc.faa.gov/webContent/28DaySub/"
SHAPEFILE_FILENAME = "class_airspace_shape_files.zip"
SHAPEFILE_EXTRACT_DIR = "shapefiles"

# FAA ADDS ArcGIS Open Data Hub
# Download pattern: {ADDS_BASE}/{item_id}_0/downloads/data?format=geojson&spatialRefId=4326
ADDS_BASE = "https://adds-faa.opendata.arcgis.com/api/v3/datasets"

ADDS_DATASETS: dict[str, dict[str, str]] = {
    "sua": {
        "item_id": "dd0d1b726e504137ab3c41b21835d05b",
        "output": "data/sua_raw.geojson",
        "label": "Special Use Airspace",
    },
    "boundary": {
        "item_id": "67885972e4e940b2aa6d74024901c561",
        "output": "data/boundary_airspace_raw.geojson",
        "label": "Boundary Airspace (ARTCC/FIR)",
    },
    "holding": {
        "item_id": "ba57404f70184b858d2c929f99f7b40c",
        "output": "data/holding_patterns_raw.geojson",
        "label": "Holding Patterns",
    },
    "dof": {
        "item_id": "e202ff4e4cf943bda02ff63c0c44c9b7",
        "output": "data/dof_raw.geojson",
        "label": "Digital Obstacle File (DOF)",
    },
    "runways": {
        "item_id": "bc80e5ca97804c2fbc0c10482377adf5",
        "output": "data/am_runways_raw.geojson",
        "label": "Airport Diagram Runways",
    },
    "taxiways": {
        "item_id": "d1c02f9f3f7144af8ead3aca44961c59",
        "output": "data/am_taxiways_raw.geojson",
        "label": "Airport Diagram Taxiways",
    },
    "mode_c": {
        "url": "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/Class_Airspace/FeatureServer/0/query?where=LOCAL_TYPE%3D%27MODE+C%27&outFields=*&outSR=4326&f=geojson",
        "output": "data/mode_c_raw.geojson",
        "label": "Mode C Veils",
    },
    "mtr": {
        "query_url": "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/MTRSegment/FeatureServer/0/query",
        "where": "1=1",
        "outFields": "*",
        "oid_field": "OBJECTID",
        "output": "data/mtr_raw.geojson",
        "label": "Military Training Routes (MTR)",
    },
}


def find_latest_cycle() -> tuple[str, str]:
    """Find the latest cycle date and url using deterministic dates."""
    print("Finding latest FAA 28-day ADDS shapefile bundle...")
    dates = get_cycle_dates()

    for cycle_date in dates:
        folder_str = cycle_date.strftime("%Y-%m-%d")
        url = f"{NFDC_BASE}{folder_str}/{SHAPEFILE_FILENAME}"
        try:
            print(f"Checking {url}...")
            resp = requests.get(url, stream=True, timeout=10)
            if resp.status_code == 200:
                resp.close()
                return folder_str, url
            resp.close()
        except requests.RequestException:
            continue

    print("Could not find current cycle shapefile; using fallback logic.")
    return "2026-03-19", f"{NFDC_BASE}2026-03-19/{SHAPEFILE_FILENAME}"


def fetch_class_airspace_shapefiles(cycle_date: str, url: str) -> None:
    """Download and extract FAA Class Airspace shapefiles."""
    cycle_file = os.path.join(SHAPEFILE_EXTRACT_DIR, ".cycle")
    if os.path.exists(cycle_file):
        with open(cycle_file) as f:
            if f.read().strip() == cycle_date:
                print(f"Shapefiles for cycle {cycle_date} already exist. Skipping download.")
                return

    print(f"Downloading Class Airspace shapefiles from {url}...")

    zip_path = SHAPEFILE_FILENAME
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(zip_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)

    print(f"Extracting {zip_path} to {SHAPEFILE_EXTRACT_DIR}/...")
    os.makedirs(SHAPEFILE_EXTRACT_DIR, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(SHAPEFILE_EXTRACT_DIR)

    os.remove(zip_path)

    with open(cycle_file, "w") as f:
        f.write(cycle_date)

    print("  Done.")


def _fetch_arcgis_geojson_paged(
    base_query_url: str,
    where: str = "1=1",
    out_fields: str = "*",
    oid_field: str = "OBJECTID",
    page_size: int = 2000,
    timeout: int = 120,
    retries: int = 3,
    extra_params: dict[str, str | int] | None = None,
) -> dict:
    """Fetch all GeoJSON features from an ArcGIS FeatureServer via keyset pagination."""
    all_features: list[dict] = []
    last_oid: int | None = None

    while True:
        page_where = where if last_oid is None else f"({where}) AND {oid_field} > {last_oid}"
        params: dict[str, str | int] = {
            "where": page_where,
            "outFields": out_fields,
            "orderByFields": f"{oid_field} ASC",
            "resultRecordCount": page_size,
            "outSR": 4326,
            "f": "geojson",
        }
        if extra_params:
            params.update(extra_params)

        payload: dict | None = None
        last_err: Exception | None = None
        for attempt in range(retries):
            try:
                resp = requests.get(base_query_url, params=params, timeout=timeout)
                if resp.status_code != 200:
                    raise RuntimeError(f"Unexpected HTTP {resp.status_code} from {base_query_url}")
                data = resp.json()
                if not isinstance(data, dict) or "error" in data or not isinstance(data.get("features"), list):
                    err_detail = data.get("error") if isinstance(data, dict) else "non-dict JSON"
                    raise RuntimeError(f"Invalid ArcGIS GeoJSON payload from {base_query_url}: {err_detail}")
                payload = data
                break
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                last_err = exc
                if attempt < retries - 1:
                    time.sleep(2**attempt)

        if payload is None:
            assert last_err is not None
            raise last_err

        features = payload["features"]
        if not features:
            break

        all_features.extend(features)

        page_oids: list[int] = []
        for ft in features:
            raw_oid = (ft.get("properties") or {}).get(oid_field)
            if raw_oid is None:
                raw_oid = ft.get("id")
            if raw_oid is not None and not isinstance(raw_oid, bool):
                try:
                    page_oids.append(int(raw_oid))
                except TypeError, ValueError:
                    continue

        if not page_oids:
            break

        max_oid = max(page_oids)
        if last_oid is not None and max_oid <= last_oid:
            break
        last_oid = max_oid

        props = payload.get("properties") or {}
        if not props.get("exceededTransferLimit"):
            break

    return {"type": "FeatureCollection", "features": all_features}


def fetch_adds_dataset(key: str, info: dict[str, str], cycle_date: str) -> None:
    """Download a GeoJSON dataset from the ADDS ArcGIS Hub or FeatureServer."""
    output = info["output"]
    label = info["label"]
    cycle_file = f"{output}.cycle"

    if os.path.exists(output) and os.path.exists(cycle_file):
        with open(cycle_file) as f:
            if f.read().strip() == cycle_date:
                print(f"{label} for cycle {cycle_date} already exists. Skipping download.")
                return

    print(f"Downloading {label}...")
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)

    # DOF is large (~80MB) — use longer timeout
    timeout = 300 if key == "dof" else 120

    if "query_url" in info:
        data = _fetch_arcgis_geojson_paged(
            info["query_url"],
            where=info.get("where", "1=1"),
            out_fields=info.get("outFields", "*"),
            oid_field=info.get("oid_field", "OBJECTID"),
            timeout=timeout,
        )
        if "features" not in data or not isinstance(data["features"], list):
            raise RuntimeError(f"Invalid GeoJSON response for {label}: missing 'features'")
        with open(output, "w") as f:
            json.dump(data, f)
    else:
        url = info.get("url") or f"{ADDS_BASE}/{info['item_id']}_0/downloads/data?format=geojson&spatialRefId=4326"
        with requests.get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            if r.status_code != 200:
                raise RuntimeError(f"Unexpected HTTP {r.status_code} downloading {label}")
            with open(output, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
        if key == "mtr":
            with open(output) as f:
                data = json.load(f)
            if not isinstance(data, dict) or not isinstance(data.get("features"), list):
                os.remove(output)
                raise RuntimeError(f"Invalid GeoJSON saved for {label}: missing 'features'")

    size_mb = os.path.getsize(output) / (1024 * 1024)
    with open(cycle_file, "w") as f:
        f.write(cycle_date)
    print(f"  Saved to {output} ({size_mb:.1f} MB)")


def fetch_all_adds(cycle_date: str) -> None:
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = []
        for key, info in ADDS_DATASETS.items():
            futures.append(executor.submit(fetch_adds_dataset, key, info, cycle_date))
        concurrent.futures.wait(futures)
        for f in futures:
            f.result()


def main() -> None:
    cycle_date, url = find_latest_cycle()
    fetch_class_airspace_shapefiles(cycle_date, url)
    fetch_all_adds(cycle_date)
    print("All datasets fetched.")


if __name__ == "__main__":
    main()
