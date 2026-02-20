"""Fetch FAA aeronautical data from NFDC shapefiles and ADDS ArcGIS Hub."""

import os
import zipfile

import requests
from bs4 import BeautifulSoup

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
}


def find_latest_cycle_url() -> str:
    """Scrape the NFDC 28-day subscription page to find the latest cycle date."""
    try:
        resp = requests.get(NFDC_BASE, timeout=30)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        dates: list[str] = []
        for a in soup.find_all("a"):
            href = a.get("href", "")
            stripped = href.strip("/").split("/")[-1]
            if len(stripped) == 10 and stripped[4] == "-" and stripped[7] == "-":
                dates.append(stripped)

        if dates:
            dates.sort(reverse=True)
            return f"{NFDC_BASE}{dates[0]}/{SHAPEFILE_FILENAME}"
    except requests.RequestException:
        pass

    print("Could not scrape NFDC index; using known current cycle URL.")
    return f"{NFDC_BASE}2026-03-19/{SHAPEFILE_FILENAME}"


def fetch_class_airspace_shapefiles() -> None:
    """Download and extract FAA Class Airspace shapefiles."""
    url = find_latest_cycle_url()
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
    print("  Done.")


def fetch_adds_dataset(key: str, info: dict[str, str]) -> None:
    """Download a GeoJSON dataset from the ADDS ArcGIS Hub."""
    url = (
        f"{ADDS_BASE}/{info['item_id']}_0/downloads/data"
        f"?format=geojson&spatialRefId=4326"
    )
    output = info["output"]
    label = info["label"]

    print(f"Downloading {label}...")
    os.makedirs(os.path.dirname(output), exist_ok=True)

    # DOF is large (~80MB) — use longer timeout
    timeout = 300 if key == "dof" else 120

    with requests.get(url, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(output, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)

    size_mb = os.path.getsize(output) / (1024 * 1024)
    print(f"  Saved to {output} ({size_mb:.1f} MB)")


def main() -> None:
    fetch_class_airspace_shapefiles()
    for key, info in ADDS_DATASETS.items():
        fetch_adds_dataset(key, info)
    print("All datasets fetched.")


if __name__ == "__main__":
    main()
