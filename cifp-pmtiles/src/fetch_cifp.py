import os
import zipfile
import requests
from bs4 import BeautifulSoup

def fetch_latest_cifp():
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
        return

    zip_links.sort(reverse=True)
    latest_zip = zip_links[0]

    download_url = url + latest_zip
    print(f"Downloading {download_url}...")

    zip_path = latest_zip
    with requests.get(download_url, stream=True) as r:
        r.raise_for_status()
        with open(zip_path, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)

    print(f"Extracting {zip_path}...")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(".")

    print("Done. Extracted contents.")

if __name__ == "__main__":
    fetch_latest_cifp()
