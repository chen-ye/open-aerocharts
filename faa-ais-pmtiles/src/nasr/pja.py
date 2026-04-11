import csv
import io
import json
import os
import zipfile

import geopandas as gpd
import requests

from src.common.utils import get_cycle_dates

NFDC_BASE = "https://nfdc.faa.gov/webContent/28DaySub/"


def find_latest_csv_zip_url() -> tuple[str, str]:
    dates = get_cycle_dates()
    for cycle_date in dates:
        folder_date = cycle_date.strftime("%Y-%m-%d")
        file_date = cycle_date.strftime("%d_%b_%Y")

        urls_to_try = [
            f"{NFDC_BASE}{folder_date}/28DaySubscription_CSV.zip",
            f"{NFDC_BASE}extra/{file_date}_CSV.zip",
        ]

        for url in urls_to_try:
            try:
                print(f"Checking {url}...")
                resp = requests.get(url, stream=True, timeout=10)
                if resp.status_code == 200:
                    resp.close()
                    return url, folder_date
                resp.close()
            except requests.RequestException:
                continue

    return (
        "https://nfdc.faa.gov/webContent/28DaySub/2026-03-19/28DaySubscription_CSV.zip",
        "2026-03-19",
    )


def extract_pja_data():
    url, cycle_date = find_latest_csv_zip_url()
    print(f"Downloading NASR CSV bundle from {url} to extract PJAs...")

    try:
        r = requests.get(url, timeout=120)
        r.raise_for_status()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 503:
            extra_url = "https://nfdc.faa.gov/webContent/28DaySub/extra/19_Mar_2026_CSV.zip"
            r = requests.get(extra_url, timeout=120)
            r.raise_for_status()
        else:
            raise

    features = []
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        if "PJA_BASE.csv" not in z.namelist():
            print("PJA_BASE.csv not found in NASR zip.")
            return

        with z.open("PJA_BASE.csv") as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))
            for row in reader:
                lat = row.get("LAT_DECIMAL")
                lon = row.get("LONG_DECIMAL")
                radius_nm = row.get("PJA_RADIUS")

                if not lat or not lon:
                    continue

                try:
                    lat = float(lat)
                    lon = float(lon)
                    radius_nm = float(radius_nm) if radius_nm else 1.5
                except ValueError:
                    continue

                feature = {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "name": (row.get("DROP_ZONE_NAME") or row.get("CITY") or row.get("ARPT_ID") or "").strip(),
                        "ident": (row.get("PJA_ID") or "").strip(),
                        "radius_nm": radius_nm,
                        "max_alt": (row.get("MAX_ALTITUDE") or "").strip(),
                        "time_of_use": (row.get("TIME_OF_USE") or "").strip(),
                    },
                }
                features.append(feature)

    os.makedirs("data", exist_ok=True)
    raw_path = "data/pja_raw.geojson"
    with open(raw_path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)

    print(f"Saved {len(features)} PJAs to {raw_path}")


def convert_pja():
    raw_path = "data/pja_raw.geojson"
    output = "data/parachute_areas.fgb"

    if not os.path.exists(raw_path):
        print(f"PJA file not found at {raw_path}")
        return

    print("Processing Parachute Jump Areas (PJA)...")
    gdf = gpd.read_file(raw_path)

    # Reproject to a metric CRS (e.g. Web Mercator EPSG:3857) to buffer in meters
    gdf_metric = gdf.to_crs("EPSG:3857")

    # 1 Nautical Mile = 1852 meters
    # We buffer each point by its radius in meters
    gdf_metric.geometry = gdf_metric.geometry.buffer(gdf_metric["radius_nm"] * 1852)

    # Reproject back to WGS84 (EPSG:4326)
    gdf_wgs84 = gdf_metric.to_crs("EPSG:4326")

    gdf_wgs84.to_file(
        output,
        driver="FlatGeobuf",
        engine="pyogrio",
        layer_options={"SPATIAL_INDEX": "NO"},
    )
    print(f"Wrote {len(gdf)} PJA features to {output}")


if __name__ == "__main__":
    extract_pja_data()
    convert_pja()
