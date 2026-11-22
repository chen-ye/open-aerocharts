"""Fetch external VFR reference datasets with cycle caching and deterministic failure on upstream errors.

Sources:
  - Mountain Passes: QLever OSM Planet SPARQL (`mountain_pass=yes`)
  - Wind Farms: USGS/LBNL US Wind Turbine Database (USWTDB GeoJSON)
  - High-Voltage Powerlines: HIFLD ArcGIS FeatureServer (>= 115 kV overhead lines)
"""

import concurrent.futures
import io
import json
import os
import time
import zipfile

import requests
import shapely
from shapely.geometry import mapping

from src.adds.fetch import _fetch_arcgis_geojson_paged
from src.common.utils import get_cycle_dates

QLEVER_ENDPOINT = "https://qlever.cs.uni-freiburg.de/api/osm-planet"
QLEVER_PASSES_QUERY = """
PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX osmrel: <https://www.openstreetmap.org/relation/>
PREFIX ogc: <http://www.opengis.net/rdf#>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
SELECT ?node (SAMPLE(?n) AS ?name) (SAMPLE(?e) AS ?ele) (SAMPLE(?g) AS ?geom) WHERE {
  osmrel:148838 ogc:sfContains ?node .
  ?node osmkey:mountain_pass "yes" .
  ?node geo:hasGeometry/geo:asWKT ?g .
  OPTIONAL { ?node osmkey:name ?n }
  OPTIONAL { ?node osmkey:ele ?e }
} GROUP BY ?node
""".strip()

USWTDB_ZIP_URL = "https://energy.usgs.gov/uswtdb/assets/data/uswtdbGeoJSON.zip"
POWERLINES_QUERY_URL = (
    "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0/query"
)
POWERLINES_WHERE = (
    "VOLTAGE >= 115 AND (TYPE IS NULL OR TYPE NOT LIKE '%UNDERGROUND%') AND (STATUS IS NULL OR STATUS NOT IN ('INACTIVE', 'PROPOSED'))"
)


def _is_cached(output: str, cycle_date: str) -> bool:
    cycle_file = f"{output}.cycle"
    if os.path.exists(output) and os.path.exists(cycle_file):
        with open(cycle_file) as f:
            return f.read().strip() == cycle_date
    return False


def _write_geojson(output: str, data: dict, cycle_date: str) -> None:
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    with open(output, "w") as f:
        json.dump(data, f)
    with open(f"{output}.cycle", "w") as f:
        f.write(cycle_date)


def _request_with_retries(
    method: str,
    url: str,
    *,
    retries: int = 3,
    backoff_base: float = 2.0,
    timeout: int = 120,
    expect_json: bool = False,
    **kwargs: object,
) -> requests.Response:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            resp = requests.request(method, url, timeout=timeout, **kwargs)
            if resp.status_code != 200:
                raise RuntimeError(f"Unexpected HTTP {resp.status_code} from {url}")
            if expect_json:
                payload = resp.json()
                if not isinstance(payload, dict) or "error" in payload:
                    err_detail = payload.get("error") if isinstance(payload, dict) else "non-dict JSON"
                    raise RuntimeError(f"Error payload from {url}: {err_detail}")
            return resp
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            last_err = exc
            if attempt < retries - 1:
                time.sleep(backoff_base**attempt)

    assert last_err is not None
    raise last_err


def _fetch_passes_qlever() -> list[dict]:
    resp = _request_with_retries(
        "POST",
        QLEVER_ENDPOINT,
        retries=3,
        timeout=60,
        expect_json=True,
        data={"query": QLEVER_PASSES_QUERY},
        headers={"Accept": "application/sparql-results+json"},
    )
    payload = resp.json()
    bindings = (payload.get("results") or {}).get("bindings")
    if not isinstance(bindings, list) or not bindings:
        raise RuntimeError("QLever returned no mountain_pass bindings")

    features: list[dict] = []
    for row in bindings:
        geom_wkt = (row.get("geom") or {}).get("value")
        if not geom_wkt:
            continue
        try:
            geom = shapely.from_wkt(geom_wkt)
        except Exception:
            continue
        if geom.is_empty:
            continue

        name = ((row.get("name") or {}).get("value") or "").strip()
        ele = (row.get("ele") or {}).get("value")
        node_uri = (row.get("node") or {}).get("value") or ""

        features.append(
            {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {
                    "name": name,
                    "ele": ele,
                    "source": "osm",
                    "osm_id": node_uri,
                },
            }
        )

    if not features:
        raise RuntimeError("QLever returned zero valid mountain_pass geometries")
    return features


def fetch_passes(cycle_date: str, output: str = "data/passes_raw.geojson") -> None:
    """Download mountain passes from QLever OSM Planet."""
    if _is_cached(output, cycle_date):
        print(f"Mountain passes for cycle {cycle_date} already exist. Skipping download.")
        return

    print("Downloading Mountain Passes (QLever OSM Planet)...")
    features = _fetch_passes_qlever()
    _write_geojson(output, {"type": "FeatureCollection", "features": features}, cycle_date=cycle_date)
    print(f"  Saved {len(features)} OSM mountain passes to {output}")


def fetch_uswtdb(cycle_date: str, output: str = "data/uswtdb_raw.geojson") -> None:
    """Download USWTDB wind turbine GeoJSON zip and extract in memory."""
    if _is_cached(output, cycle_date):
        print(f"USWTDB for cycle {cycle_date} already exist. Skipping download.")
        return

    print("Downloading USWTDB wind turbines...")
    resp = _request_with_retries("GET", USWTDB_ZIP_URL, retries=3, timeout=120)
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        geojson_name = next((n for n in zf.namelist() if n.lower().endswith(".geojson")), None)
        if geojson_name is None:
            raise RuntimeError("No .geojson file found inside uswtdbGeoJSON.zip")
        with zf.open(geojson_name) as gf:
            data = json.load(gf)

    if not isinstance(data, dict) or not isinstance(data.get("features"), list):
        raise RuntimeError("Invalid USWTDB GeoJSON payload: missing 'features'")

    _write_geojson(output, data, cycle_date=cycle_date)
    print(f"  Saved {len(data['features'])} USWTDB turbines to {output}")


def fetch_powerlines(cycle_date: str, output: str = "data/powerlines_raw.geojson") -> None:
    """Download HIFLD high-voltage overhead transmission lines via keyset pagination."""
    if _is_cached(output, cycle_date):
        print(f"Powerlines for cycle {cycle_date} already exist. Skipping download.")
        return

    print("Downloading HIFLD high-voltage powerlines (>= 115 kV)...")
    data = _fetch_arcgis_geojson_paged(
        POWERLINES_QUERY_URL,
        where=POWERLINES_WHERE,
        out_fields="OBJECTID_1,VOLTAGE,VOLT_CLASS,TYPE,STATUS,OWNER",
        oid_field="OBJECTID_1",
        page_size=2000,
        timeout=120,
        retries=3,
        extra_params={"geometryPrecision": 5},
    )
    if "features" not in data or not isinstance(data["features"], list):
        raise RuntimeError("Invalid powerlines GeoJSON payload: missing 'features'")

    _write_geojson(output, data, cycle_date=cycle_date)
    print(f"  Saved {len(data['features'])} powerline features to {output}")


def fetch_all_vfr(cycle_date: str) -> None:
    """Fetch all external VFR datasets concurrently."""
    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = [
            executor.submit(fetch_passes, cycle_date),
            executor.submit(fetch_uswtdb, cycle_date),
            executor.submit(fetch_powerlines, cycle_date),
        ]
        concurrent.futures.wait(futures)
        for future in futures:
            future.result()


def main() -> None:
    cycle_date = get_cycle_dates()[0].strftime("%Y-%m-%d")
    fetch_all_vfr(cycle_date)


if __name__ == "__main__":
    main()
