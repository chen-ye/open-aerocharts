"""
Scrapes the FAA website for the latest 28-day cycle Coded Instrument Flight Procedures (CIFP) zip file and extracts it.
"""

import os
import zipfile
import requests
import json
from common.utils import get_cycle_dates

def check_latest_cycle():
    url = "https://aeronav.faa.gov/Upload_313-d/cifp/"

    dates = get_cycle_dates()
    latest_zip = None
    cycle = "unknown"

    for cycle_date in dates:
        # CIFP zip format is CIFP_250123.zip (YYMMDD)
        cycle_str = cycle_date.strftime("%y%m%d")
        candidate_zip = f"CIFP_{cycle_str}.zip"
        candidate_url = url + candidate_zip
        try:
            print(f"Checking {candidate_url}...")
            # Use GET with stream=True to avoid Akamai 503s on HEAD requests
            resp = requests.get(candidate_url, stream=True, timeout=10)
            if resp.status_code == 200:
                resp.close()
                latest_zip = candidate_zip
                cycle = cycle_str
                break
            resp.close()
        except requests.RequestException:
            continue

    if not latest_zip:
        print("Could not find current cycle CIFP zip.")
        return None, False, None, None

    metadata_path = "output/metadata.json"

    current_cycle = None
    if os.path.exists(metadata_path):
        with open(metadata_path, 'r') as f:
            try:
                metadata = json.load(f)
                current_cycle = metadata.get("cycle")
            except json.JSONDecodeError:
                pass

    is_new = current_cycle != cycle

    # Output for GitHub Actions
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
            f.write(f"cycle={cycle}\n")
            f.write(f"is_new={str(is_new).lower()}\n")

    download_url = url + latest_zip
    zip_path = latest_zip

    return cycle, is_new, download_url, zip_path

def download_cifp(download_url, zip_path):
    print(f"Downloading {download_url}...")
    with requests.get(download_url, stream=True) as r:
        r.raise_for_status()
        with open(zip_path, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)

    print(f"Extracting {zip_path}...")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(".")

    print("Done. Extracted contents.")

def fetch_latest_cifp():
    cycle, is_new, download_url, zip_path = check_latest_cycle()
    if not is_new:
        if zip_path:
            print(f"Latest CIFP ({zip_path}) is already processed (cycle {cycle}). Skipping download.")
        return cycle, False

    download_cifp(download_url, zip_path)

    # Save the cycle metadata
    metadata_path = "output/metadata.json"
    os.makedirs("output", exist_ok=True)
    metadata = {"cycle": cycle}
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f)

    return cycle, True

def main():
    fetch_latest_cifp()

if __name__ == "__main__":
    main()
