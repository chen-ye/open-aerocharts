"""Fetch FAA NASR 28-day data for airport fuel availability."""

import csv
import io
import zipfile
import requests
from bs4 import BeautifulSoup

NFDC_BASE = "https://nfdc.faa.gov/webContent/28DaySub/"

def find_latest_csv_zip_url() -> str:
    """Scrape the NFDC 28-day subscription page for the latest CSV zip."""
    print("Finding latest FAA 28-day NASR CSV bundle...")
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
            latest_date = dates[0]
            # Now find the CSV zip inside this folder
            sub_url = f"{NFDC_BASE}{latest_date}/"
            resp_sub = requests.get(sub_url, timeout=30)
            resp_sub.raise_for_status()
            soup_sub = BeautifulSoup(resp_sub.text, "html.parser")
            for a in soup_sub.find_all("a"):
                href = a.get("href", "")
                if href.endswith(".zip") and "CSV" in href.upper():
                    return f"{sub_url}{href}"
    except requests.RequestException as e:
        print(f"Error scraping NFDC: {e}")

    # Fallback to a known pattern
    print("Could not scrape NFDC index; using fallback logic.")
    return "https://nfdc.faa.gov/webContent/28DaySub/2026-03-19/28DaySubscription_CSV.zip"


def get_airport_fuel() -> dict[str, bool]:
    """Download NASR CSV zip and return a dict of {airport_id: has_fuel}."""
    url = find_latest_csv_zip_url()
    print(f"Downloading NASR CSV bundle from {url}...")

    try:
        r = requests.get(url, timeout=120)
        r.raise_for_status()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 503:
            # Akamai blocking or unavailable? Try the extra folder or just return empty
            extra_url = "https://nfdc.faa.gov/webContent/28DaySub/extra/19_Feb_2026_CSV.zip"
            print(f"HTTP 503 Error. Retrying with fallback URL: {extra_url}")
            r = requests.get(extra_url, timeout=120)
            r.raise_for_status()
        else:
            raise

    fuel_lookup = {}

    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        # The file inside the zip is usually APT_BASE.csv
        apt_filename = None
        for name in z.namelist():
            if name.upper().endswith("APT_BASE.csv"):
                apt_filename = name
                break

        if not apt_filename:
            print("Warning: APT_BASE.csv not found in the NASR zip.")
            return fuel_lookup

        print(f"Parsing {apt_filename} for fuel data...")
        with z.open(apt_filename) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))
            for row in reader:
                site_no = row.get("SITE_NO")
                arpt_id = row.get("ARPT_ID")
                fuel_types = row.get("FUEL_TYPES", "").strip()

                # If there's any non-empty string in FUEL_TYPES, we consider it to have fuel
                has_fuel = bool(fuel_types)

                if arpt_id:
                    fuel_lookup[arpt_id.strip()] = has_fuel
                if site_no:
                    # sometimes the id matches site_no in other sources
                    fuel_lookup[site_no.strip()] = has_fuel

    print(f"Found fuel data for {sum(1 for v in fuel_lookup.values() if v)} out of {len(fuel_lookup)} airports.")
    return fuel_lookup
