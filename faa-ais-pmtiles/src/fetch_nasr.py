"""Fetch FAA NASR 28-day data for airport fuel availability."""

import csv
import io
import zipfile
import requests
from bs4 import BeautifulSoup

NFDC_BASE = "https://nfdc.faa.gov/webContent/28DaySub/"

def get_session():
    import requests
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1"
    })
    return session

def get_cycle_dates() -> list[tuple[str, str]]:
    """Return a list of (folder_date, file_date) for recent and upcoming cycles.
    Known cycle anchor: 2024-03-21 -> 21_Mar_2024. Next is 2024-04-18, etc.
    """
    import datetime
    # A known anchor date for the 28-day cycle
    anchor = datetime.date(2024, 3, 21)
    today = datetime.date.today()

    # Calculate how many 28-day cycles have passed since the anchor
    delta = today - anchor
    cycles_passed = delta.days // 28

    # Generate the current cycle and the next few cycles
    dates = []
    for offset in range(-1, 2):
        cycle_date = anchor + datetime.timedelta(days=(cycles_passed + offset) * 28)
        folder_str = cycle_date.strftime("%Y-%m-%d")
        file_str = cycle_date.strftime("%d_%b_%Y")
        dates.append((folder_str, file_str))

    # Sort descending so we try the most recent current/future dates first
    dates.sort(reverse=True)
    return dates

def find_latest_csv_zip_url(session) -> tuple[str, str, str]:
    """Find the latest CSV zip by trying generated cycle dates. Returns (url, cycle_date)."""
    print("Finding latest FAA 28-day NASR CSV bundle...")
    dates = get_cycle_dates()

    for folder_date, file_date in dates:
        # Try both the standard location and the 'extra' folder
        urls_to_try = [
            f"{NFDC_BASE}{folder_date}/28DaySubscription_CSV.zip",
            f"{NFDC_BASE}extra/{file_date}_CSV.zip"
        ]

        for url in urls_to_try:
            try:
                print(f"Checking {url}...")
                # Use GET with stream=True to avoid Akamai 503s on HEAD requests
                resp = session.get(url, stream=True, timeout=10)
                if resp.status_code == 200:
                    resp.close()
                    return url, folder_date
                resp.close()
            except requests.RequestException:
                continue

    # Fallback to a hardcoded baseline if all else fails
    print("Could not find NASR bundle; using fallback logic.")
    return "https://nfdc.faa.gov/webContent/28DaySub/2026-03-19/28DaySubscription_CSV.zip", "2026-03-19"


def get_airport_fuel() -> dict[str, bool]:
    """Download NASR CSV zip and return a dict of {airport_id: has_fuel}."""
    import os
    import json
    session = get_session()
    url, cycle_date = find_latest_csv_zip_url(session)

    cache_path = "data/nasr_fuel.json"
    cycle_path = "data/nasr_fuel.cycle"

    if os.path.exists(cache_path) and os.path.exists(cycle_path):
        with open(cycle_path, "r") as f:
            if f.read().strip() == cycle_date:
                print(f"NASR fuel tracking for cycle {cycle_date} already exists. Skipping download.")
                with open(cache_path, "r") as cache_f:
                    return json.load(cache_f)
    print(f"Downloading NASR CSV bundle from {url}...")

    try:
        r = session.get(url, timeout=120)
        r.raise_for_status()
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 503:
            # Akamai blocking or unavailable? Try the extra folder or just return empty
            extra_url = "https://nfdc.faa.gov/webContent/28DaySub/extra/19_Mar_2026_CSV.zip"
            print(f"HTTP 503 Error. Retrying with fallback URL: {extra_url}")
            r = session.get(extra_url, timeout=120)
            r.raise_for_status()
        else:
            raise

    fuel_lookup = {}

    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        # The file inside the zip is usually APT_BASE.csv
        apt_filename = None
        for name in z.namelist():
            if name.upper().endswith("APT_BASE.CSV"):
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

    os.makedirs("data", exist_ok=True)
    with open(cache_path, "w") as f:
        json.dump(fuel_lookup, f)
    with open(cycle_path, "w") as f:
        f.write(cycle_date)

    return fuel_lookup
