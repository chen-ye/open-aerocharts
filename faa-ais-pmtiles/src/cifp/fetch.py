import os
import zipfile
import requests
import json
import re
from bs4 import BeautifulSoup

def check_latest_cycle():
    url = "https://aeronav.faa.gov/Upload_313-d/cifp/"
    response = requests.get(url)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, 'html.parser')

    zip_links = []
    for a in soup.find_all('a'):
        href = a.get('href')
        if href and 'CIFP_' in href and href.endswith('.zip'):
            # href is likely /Upload_313-d/cifp/CIFP_250123.zip
            zip_links.append(href.split('/')[-1])

    if not zip_links:
        print("No CIFP zip files found on the page.")
        return None, False, None, None

    zip_links.sort(reverse=True)
    latest_zip = zip_links[0]

    cycle_match = re.search(r'CIFP_(\d+)\.zip', latest_zip)
    cycle = cycle_match.group(1) if cycle_match else "unknown"

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
