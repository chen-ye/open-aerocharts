"""
Builds a searchable index of airports, navaids, and fixes from the CIFP dataset.

Generates a JSON file mapping identifiers to their coordinates and metadata,
optimized for client-side search.
"""

import sys
import json
import os
from collections import defaultdict
from cifparse import CIFP
from src.common.utils import parse_altitude

def main():
    if len(sys.argv) < 2:
        print("Usage: python -m src.build_search_index <FAACIFP18_file>")
        sys.exit(1)

    cifp_path = sys.argv[1]
    output_dir = "../client/public"
    output_path = os.path.join(output_dir, "search_index.json")

    if not os.path.exists(output_dir):
        print(f"Output directory {output_dir} does not exist. Creating it.")
        os.makedirs(output_dir, exist_ok=True)

    print(f"Loading CIFP from {cifp_path}...", flush=True)
    c = CIFP(cifp_path)

    print("Parsing data...", flush=True)
    c.parse_airports()
    c.parse_vhf_navaids()
    c.parse_ndb_navaids()
    c.parse_enroute_waypoints()
    c.parse_terminal_waypoints()
    c.parse_procedures()

    fixes = {} # ident -> {lat, lon, type, name}
    
    print("Indexing fixes...", flush=True)
    
    # Airports
    for a in c.get_airports():
        p = a.to_dict()['primary']
        ident = p.get('airport_id', '').strip()
        lat, lon = p.get('lat'), p.get('lon')
        if ident and lat is not None and lon is not None:
            fixes[ident] = {
                'lat': float(lat), 
                'lon': float(lon), 
                'type': 'airport',
                'name': p.get('airport_name')
            }

    # Navaids
    for nav in c.get_vhf_navaids():
        p = nav.to_dict()['primary']
        ident = (p.get('vhf_id') or p.get('dme_id') or '').strip()
        lat = p.get('lat') or p.get('dme_lat')
        lon = p.get('lon') or p.get('dme_lon')
        if ident and lat is not None and lon is not None:
            fixes[ident] = {
                'lat': float(lat), 
                'lon': float(lon), 
                'type': 'navaid',
                'name': p.get('vhf_name')
            }
            
    for nav in c.get_ndb_navaids():
        p = nav.to_dict()['primary']
        ident = (p.get('ndb_id') or '').strip()
        lat, lon = p.get('lat'), p.get('lon')
        if ident and lat is not None and lon is not None:
            fixes[ident] = {
                'lat': float(lat), 
                'lon': float(lon), 
                'type': 'navaid',
                'name': p.get('ndb_name')
            }

    # Waypoints
    for wp in c.get_enroute_waypoints() + c.get_terminal_waypoints():
        p = wp.to_dict()['primary']
        ident = (p.get('waypoint_id') or '').strip()
        lat, lon = p.get('lat'), p.get('lon')
        if ident and lat is not None and lon is not None:
            # Classify waypoint type
            raw_type = (p.get('type') or '').strip()
            if raw_type == 'C':
                wpt_type = 'compulsory'
            else:
                wpt_type = 'waypoint'

            fixes[ident] = {
                'lat': float(lat), 
                'lon': float(lon), 
                'type': wpt_type
            }

    print("Indexing procedures...", flush=True)
    # Structure: procedures[airport_id][proc_name] = { transitions: { trans_id: [points] }, body: [points] }
    procedures = defaultdict(lambda: defaultdict(lambda: {'transitions': defaultdict(list), 'body': []}))
    
    proc_list = c.get_procedures()
    grouped = defaultdict(list)
    for proc in proc_list:
        p = proc.to_dict()['primary']
        # fac_id is airport, procedure_id is name (TECKY4), transition_id is transition (VLREE)
        key = (p.get('fac_id'), p.get('procedure_id'), p.get('transition_id'))
        grouped[key].append(p)

    for (airport, proc_id, trans_id), pts in grouped.items():
        if not airport or not proc_id:
            continue
        
        pts.sort(key=lambda x: x.get('seq_no') or 0)
        proc_points = []
        
        for p in pts:
            fix_id = (p.get('fix_id') or '').strip()
            lat, lon = None, None
            fix_type = 'waypoint'
            fix_name = ''
            
            if fix_id in fixes:
                lat, lon = fixes[fix_id]['lat'], fixes[fix_id]['lon']
                fix_type = fixes[fix_id].get('type', 'waypoint')
                fix_name = fixes[fix_id].get('name', '')
            elif p.get('lat') is not None:
                lat, lon = float(p.get('lat')), float(p.get('lon'))
            
            if lat is not None and lon is not None:
                proc_points.append({
                    'coords': [lon, lat],
                    'id': fix_id,
                    'type': fix_type,
                    'name': fix_name
                })
        
        if not proc_points:
            continue

        proc_entry = procedures[airport][proc_id]
        
        if not trans_id or trans_id.strip() == '':
            proc_entry['body'] = proc_points
        else:
            proc_entry['transitions'][trans_id] = proc_points

    # Convert defaultdict to regular dict
    final_procs = {}
    for apt, procs in procedures.items():
        final_procs[apt] = {}
        for pid, data in procs.items():
            final_procs[apt][pid] = data

    print(f"Writing index to {output_path}...", flush=True)
    with open(output_path, 'w') as f:
        json.dump({
            "fixes": fixes,
            "procedures": final_procs
        }, f)
    
    print(f"Done. Index size: {os.path.getsize(output_path) / 1024 / 1024:.2f} MB")

if __name__ == "__main__":
    main()
