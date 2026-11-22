"""
Builds a searchable index of airports, navaids, and fixes from NASR and CIFP datasets.

Generates a JSON file mapping identifiers to their coordinates and metadata,
optimized for client-side search.
"""

import json
import os
import sys
from collections import defaultdict

from cifparse import CIFP


def build_search_index(
    cifp_path: str = "FAACIFP18",
    output_path: str = "../client/public/search_index.json",
    nasr_facilities_path: str = "data/nasr_facilities.json",
) -> dict:
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        print(f"Output directory {output_dir} does not exist. Creating it.")
        os.makedirs(output_dir, exist_ok=True)

    fixes = {}  # ident -> {lat, lon, type, name}
    seen_nasr_ids: set[str] = set()

    if nasr_facilities_path and os.path.exists(nasr_facilities_path):
        print(f"Loading NASR facilities from {nasr_facilities_path}...", flush=True)
        with open(nasr_facilities_path) as f:
            nasr_facilities = json.load(f)
        for fac in nasr_facilities:
            ident = (fac.get("id") or "").strip()
            lat, lon = fac.get("lat"), fac.get("lon")
            if ident and lat is not None and lon is not None:
                seen_nasr_ids.add(ident)
                for alias_key in ("arpt_id", "icao_id"):
                    alias = (fac.get(alias_key) or "").strip()
                    if alias:
                        seen_nasr_ids.add(alias)
                fixes[ident] = {
                    "lat": float(lat),
                    "lon": float(lon),
                    "type": "airport",
                    "name": fac.get("name"),
                }

    print(f"Loading CIFP from {cifp_path}...", flush=True)
    c = CIFP(cifp_path)

    print("Parsing data...", flush=True)
    c.parse_airports()
    c.parse_heliports()
    c.parse_vhf_navaids()
    c.parse_ndb_navaids()
    c.parse_enroute_waypoints()
    c.parse_terminal_waypoints()
    c.parse_procedures()
    c.parse_airway_points()

    print("Indexing fixes...", flush=True)

    # CIFP Airports (fallback / non-NASR records; before navaids so navaids win 3-letter collisions)
    for a in c.get_airports():
        if not a.has_primary():
            continue
        p = a.to_dict()["primary"]
        ident = (p.get("airport_id") or "").strip()
        lat, lon = p.get("lat"), p.get("lon")
        if ident and lat is not None and lon is not None and ident not in fixes and ident not in seen_nasr_ids:
            fixes[ident] = {
                "lat": float(lat),
                "lon": float(lon),
                "type": "airport",
                "name": p.get("airport_name"),
            }

    # CIFP Heliports (fallback / non-NASR records; before navaids)
    for h in c.get_heliports():
        if not h.has_primary():
            continue
        p = h.to_dict()["primary"]
        ident = (p.get("heliport_id") or "").strip()
        lat, lon = p.get("lat"), p.get("lon")
        if ident and lat is not None and lon is not None and ident not in fixes and ident not in seen_nasr_ids:
            fixes[ident] = {
                "lat": float(lat),
                "lon": float(lon),
                "type": "airport",
                "name": p.get("heliport_name"),
            }

    # Navaids
    for nav in c.get_vhf_navaids():
        p = nav.to_dict()["primary"]
        ident = (p.get("vhf_id") or p.get("dme_id") or "").strip()
        lat = p.get("lat") or p.get("dme_lat")
        lon = p.get("lon") or p.get("dme_lon")
        if ident and lat is not None and lon is not None:
            fixes[ident] = {
                "lat": float(lat),
                "lon": float(lon),
                "type": "navaid",
                "name": p.get("vhf_name"),
            }

    for nav in c.get_ndb_navaids():
        p = nav.to_dict()["primary"]
        ident = (p.get("ndb_id") or "").strip()
        lat, lon = p.get("lat"), p.get("lon")
        if ident and lat is not None and lon is not None:
            fixes[ident] = {
                "lat": float(lat),
                "lon": float(lon),
                "type": "navaid",
                "name": p.get("ndb_name"),
            }

    # Waypoints
    for wp in c.get_enroute_waypoints() + c.get_terminal_waypoints():
        p = wp.to_dict()["primary"]
        ident = (p.get("waypoint_id") or "").strip()
        lat, lon = p.get("lat"), p.get("lon")
        if ident and lat is not None and lon is not None:
            # Classify waypoint type
            raw_type = (p.get("type") or "").strip()
            if raw_type == "C":
                wpt_type = "compulsory"
            else:
                wpt_type = "waypoint"

            fixes[ident] = {"lat": float(lat), "lon": float(lon), "type": wpt_type}

    print("Indexing procedures...", flush=True)
    # Structure: procedures[airport_id][proc_name] = { transitions: { trans_id: [points] }, body: [points] }
    procedures = defaultdict(lambda: defaultdict(lambda: {"transitions": defaultdict(list), "body": []}))

    proc_list = c.get_procedures()
    grouped = defaultdict(list)
    for proc in proc_list:
        p = proc.to_dict()["primary"]
        # fac_id is airport, procedure_id is name (TECKY4), transition_id is transition (VLREE)
        key = (p.get("fac_id"), p.get("procedure_id"), p.get("transition_id"))
        grouped[key].append(p)

    for (airport, proc_id, trans_id), pts in grouped.items():
        if not airport or not proc_id:
            continue

        pts.sort(key=lambda x: x.get("seq_no") or 0)
        proc_points = []

        for p in pts:
            fix_id = (p.get("fix_id") or "").strip()
            lat, lon = None, None
            fix_type = "waypoint"
            fix_name = ""

            if fix_id in fixes:
                lat, lon = fixes[fix_id]["lat"], fixes[fix_id]["lon"]
                fix_type = fixes[fix_id].get("type", "waypoint")
                fix_name = fixes[fix_id].get("name", "")
            elif p.get("lat") is not None:
                lat, lon = float(p.get("lat")), float(p.get("lon"))

            if lat is not None and lon is not None:
                proc_points.append(
                    {
                        "coords": [lon, lat],
                        "id": fix_id,
                        "type": fix_type,
                        "name": fix_name,
                    }
                )

        if not proc_points:
            continue

        proc_entry = procedures[airport][proc_id]

        if not trans_id or trans_id.strip() == "":
            proc_entry["body"] = proc_points
        else:
            proc_entry["transitions"][trans_id] = proc_points

    # Convert defaultdict to regular dict
    final_procs = {}
    for apt, procs in procedures.items():
        final_procs[apt] = {}
        for pid, data in procs.items():
            final_procs[apt][pid] = data

    print("Indexing airways...", flush=True)
    airway_data = defaultdict(list)
    for ap in c.get_airway_points():
        p = ap.to_dict()["primary"]
        airway_id = p.get("airway_id")
        point_id = (p.get("point_id") or "").strip()
        seq_no = p.get("seq_no") or 0
        if airway_id and point_id:
            airway_data[airway_id].append({"id": point_id, "seq": seq_no})

    # Sort by sequence
    final_airways = {}
    for aid, pts in airway_data.items():
        pts.sort(key=lambda x: x["seq"])
        final_airways[aid] = [p["id"] for p in pts]

    index_data = {"fixes": fixes, "procedures": final_procs, "airways": final_airways}
    print(f"Writing index to {output_path}...", flush=True)
    with open(output_path, "w") as f:
        json.dump(index_data, f)

    print(f"Done. Index size: {os.path.getsize(output_path) / 1024 / 1024:.2f} MB")
    return index_data


def main():
    cifp_path = sys.argv[1] if len(sys.argv) > 1 else "FAACIFP18"
    build_search_index(cifp_path=cifp_path)


if __name__ == "__main__":
    main()
