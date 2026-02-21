import sys
import geojson
import geopandas as gpd
import math
from collections import defaultdict
from cifparse import CIFP
from src import fetch_nasr

def load_nasr_metadata():
    return fetch_nasr.load_nasr_metadata()

def haversine(lon1, lat1, lon2, lat2):
    R = 3440.065 # Earth radius in NM
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat / 2) * math.sin(dLat / 2) + \
        math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * \
        math.sin(dLon / 2) * math.sin(dLon / 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c



def parse_altitude(alt_str):
    if not alt_str:
        return 0.0
    alt_str = str(alt_str).strip()
    if alt_str == 'GND':
        return 0.0
    if alt_str == 'UNL':
        return 60000.0
    try:
        val = float(alt_str)
        return val
    except ValueError:
        if alt_str.startswith('FL'):
            try:
                return float(alt_str[2:]) * 100
            except Exception:
                pass
        return 0.0

def unwrap_coordinates(coords):
    if not coords:
        return coords
    unwrapped = [coords[0]]
    for i in range(1, len(coords)):
        prev_lon = unwrapped[-1][0]
        curr_lon, lat, elev = coords[i]

        while curr_lon - prev_lon > 180:
            curr_lon -= 360
        while curr_lon - prev_lon < -180:
            curr_lon += 360

        unwrapped.append((curr_lon, lat, elev))
    return unwrapped

def save_fgb(features, output_path):
    if not features:
        print(f"  No features for {output_path}, skipping.")
        return
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    gdf.sort_values(by='rank', ascending=True, inplace=True)
    gdf.geometry = gdf.geometry.force_2d()
    # Disable spatial index to ensure linear reading order by tippecanoe
    gdf.to_file(output_path, driver="FlatGeobuf", engine="pyogrio", layer_options={'SPATIAL_INDEX': 'NO'})

def build_pmtiles_fgb(cifp_path):
    print("Fetching NASR airport metadata...", flush=True)
    airport_metadata = load_nasr_metadata()

    print("Loading CIFP...", flush=True)
    c = CIFP(cifp_path)

    print("Parsing everything needed...", flush=True)
    c.parse_airports()
    c.parse_vhf_navaids()
    c.parse_ndb_navaids()
    c.parse_enroute_waypoints()
    c.parse_terminal_waypoints()


    c.parse_procedures()
    c.parse_airway_points()
    c.parse_runways()
    c.parse_loc_gss()

    print("Building lookup dictionaries...", flush=True)
    fixes = {}
    airport_features = []

    print("Extracting Airports...", flush=True)
    airport_features_dict = {}
    for a in c.get_airports():
        p = a.to_dict()['primary']
        lat, lon = p.get('lat'), p.get('lon')
        if lat is not None and lon is not None:
            ident = p.get('airport_id', '').strip()
            if not ident:
                continue

            elev = float(p.get('elevation') or 0.0)

            surface = p.get('longest_surface')
            usage = p.get('usage')

            if surface == 'W':
                fac_type = 'seaplane'
            elif usage == 'M':
                fac_type = 'military'
            elif usage == 'P':
                fac_type = 'private'
            else:
                fac_type = 'civil_hard' if surface == 'H' else 'civil_soft'

            ident = p.get('airport_id', '').strip()
            # Try direct lookup (now robust with ICAO_ID indexing)
            meta = airport_metadata.get(ident)

            # Fallback for continental US if ICAO_ID was missing from NASR but present in CIFP
            if not meta and ident.startswith('K') and len(ident) == 4:
                meta = airport_metadata.get(ident[1:])

            meta = meta or {}
            has_fuel = meta.get('has_fuel', False)
            has_tower = meta.get('has_tower', False)
            far_139 = meta.get('far_139', '')
            longest_runway = int(p.get('longest') or 0)

            # Determine facility rank for decluttering (lower is more important)
            # Tier 1: Major Hubs (FAR 139 Index D/E)
            # Tier 2: Regional/Commercial (FAR 139 B/C OR Towered OR > 7500ft)
            # Tier 3: General Aviation (Starts with K OR > 4000ft)
            # Tier 4: Minor / Private / Others

            # FAR 139 Index D or E are major commercial hubs
            is_major_hub = any(idx in far_139 for idx in ['D', 'E'])
            # FAR 139 Index A, B, or C are standard commercial
            is_commercial = any(idx in far_139 for idx in ['A', 'B', 'C'])

            if is_major_hub:
                rank = 1
            elif is_commercial or has_tower or longest_runway >= 7500:
                rank = 2
            elif ident.startswith('K') and len(ident) == 4 or longest_runway >= 4000:
                rank = 3
            else:
                rank = 4

            # Ensure military bases with huge runways remain Rank 1 even if not FAR 139
            if usage == 'M' and longest_runway >= 10000:
                rank = 1

            properties = {
                'id': ident,
                'name': p.get('airport_name'),
                'type': 'airport',
                'facility_type': fac_type,
                'surface': surface,
                'is_military': usage == 'M',
                'is_ifr': bool(p.get('is_ifr')),
                'longest_runway': longest_runway,
                'has_fuel': has_fuel,
                'rank': rank
            }

            feat = geojson.Feature(
                geometry=geojson.Point((lon, lat, elev)),
                properties=properties,
                tippecanoe={ 'minzoom': 0 if rank == 1 else (rank + 1) } # Root-level control
            )

            airport_features_dict[ident] = feat
            fixes[ident] = (lon, lat, elev)

    with open('data/airports.geojson', 'w') as f:
        geojson.dump(geojson.FeatureCollection(list(airport_features_dict.values())), f)

    print("Extracting Navaids...", flush=True)
    navaid_features = []
    for nav in c.get_vhf_navaids():
        p = nav.to_dict()['primary']
        lat = p.get('lat') or p.get('dme_lat')
        lon = p.get('lon') or p.get('dme_lon')
        if lat is not None and lon is not None:
            elev = float(p.get('dme_elevation') or p.get('elevation') or 0.0)
            ident = (p.get('vhf_id') or p.get('dme_id') or '').strip()

            nav_class = p.get('nav_class') or '     '
            alt_class = nav_class[1:2] if len(nav_class) > 1 else ' '
            if alt_class == 'H':
                rank = 2
            elif alt_class == 'L':
                rank = 3
            elif alt_class == 'T':
                rank = 4
            else:
                rank = 5

            # Parse NAVAID type from class (e.g., 'V' for VOR/VORTAC/VORDME, 'T' for TACAN, 'D' for DME)
            nav_type = 'vhf'
            if nav_class.startswith('V'):
                if 'T' in nav_class:
                    nav_type = 'vortac'
                elif 'D' in nav_class:
                    nav_type = 'vordme'
                else:
                    nav_type = 'vor'
            elif nav_class.startswith('T') or nav_class.startswith('M'):
                nav_type = 'tacan'
            elif nav_class.startswith('D'):
                nav_type = 'dme'
            # (Note: ILS/Localizers are handled separately)

            navaid_features.append(geojson.Feature(
                geometry=geojson.Point((lon, lat, elev)),
                properties={'id': ident, 'name': p.get('vhf_name'), 'frequency': p.get('frequency'), 'type': nav_type, 'rank': rank}
            ))
            if ident:
                fixes[ident] = (lon, lat, elev)

    for nav in c.get_ndb_navaids():
        p = nav.to_dict()['primary']
        lat, lon = p.get('lat'), p.get('lon')
        if lat is not None and lon is not None:
            elev = float(p.get('elevation') or 0.0)
            ident = (p.get('ndb_id') or '').strip()
            navaid_features.append(geojson.Feature(
                geometry=geojson.Point((lon, lat, elev)),
                properties={'id': ident, 'name': p.get('ndb_name'), 'frequency': p.get('frequency'), 'type': 'ndb', 'rank': 5}
            ))
            if ident:
                fixes[ident] = (lon, lat, elev)

    print("Extracting Waypoints...", flush=True)
    waypoint_features = []
    for wp in c.get_enroute_waypoints() + c.get_terminal_waypoints():
        p = wp.to_dict()['primary']
        if p.get('lat') is not None and p.get('lon') is not None:
            ident = (p.get('waypoint_id') or '').strip()
            fixes[ident] = (p.get('lon'), p.get('lat'), 0.0)

            # Classify waypoint type from ARINC 424
            raw_type = (p.get('type') or '').strip()
            if raw_type == 'C':
                wpt_type = 'compulsory'
            elif raw_type == 'R':
                wpt_type = 'rnav'
            else:
                wpt_type = 'named'

            # Usage: H = high altitude, L = low altitude, B = both, blank = terminal/other
            usage = (p.get('usage') or '').strip()

            base_rank = 5
            if wpt_type == 'compulsory':
                base_rank = 3
            elif wpt_type == 'rnav':
                base_rank = 4

            if usage in ('H', 'B'):
                rank = base_rank
            elif usage == 'L':
                rank = base_rank + 1
            else:
                rank = base_rank + 2

            rank = min(rank, 6)

            waypoint_features.append(geojson.Feature(
                geometry=geojson.Point((p.get('lon'), p.get('lat'), 0.0)),
                properties={
                    'id': ident,
                    'type': wpt_type,
                    'usage': usage,
                    'name': (p.get('name_description') or '').strip(),
                    'rank': rank
                }
            ))

    save_fgb(waypoint_features, 'data/waypoints.fgb')

    save_fgb(navaid_features, 'data/navaids.fgb')

    print("Processing Procedures...", flush=True)
    proc_groups = defaultdict(list)
    for proc in c.get_procedures():
        p = proc.to_dict()['primary']
        key = (p.get('fac_id'), p.get('procedure_id'), p.get('transition_id'))
        proc_groups[key].append(p)

    procedure_features = []
    for key, pts in proc_groups.items():
        pts.sort(key=lambda x: x.get('seq_no') or 0)
        coords = []
        for p in pts:
            fix = (p.get('fix_id') or '').strip()
            if fix in fixes:
                lon, lat, elev = fixes[fix]
                proc_elev = parse_altitude(p.get('alt_1') or p.get('trans_alt'))
                coords.append((lon, lat, max(elev, proc_elev)))
            elif p.get('lat') is not None and p.get('lon') is not None:
                proc_elev = parse_altitude(p.get('alt_1') or p.get('trans_alt'))
                coords.append((p.get('lon'), p.get('lat'), proc_elev))

        if len(coords) >= 2:
            coords = unwrap_coordinates(coords)
            procedure_features.append(geojson.Feature(
                geometry=geojson.LineString(coords),
                properties={'airport': key[0], 'procedure': key[1], 'transition': key[2], 'rank': 5}
            ))

    save_fgb(procedure_features, 'data/procedures.fgb')

    print("Processing Airways...", flush=True)
    airway_groups = defaultdict(list)
    for ap in c.get_airway_points():
        p = ap.to_dict()['primary']
        key = p.get('airway_id')
        if key:
            airway_groups[key].append(p)

    airway_features = []
    for key, pts in airway_groups.items():
        pts.sort(key=lambda x: x.get('seq_no') or 0)
        valid_pts = []
        for p in pts:
            fix = (p.get('point_id') or '').strip()
            if fix in fixes:
                valid_pts.append((p, fixes[fix]))

        for i in range(len(valid_pts) - 1):
            p1, fix1 = valid_pts[i]
            p2, fix2 = valid_pts[i+1]
            lon1, lat1, elev1 = fix1
            lon2, lat2, elev2 = fix2

            c_unwrapped = unwrap_coordinates([(lon1, lat1, elev1), (lon2, lat2, elev2)])
            if len(c_unwrapped) == 2:
                ulon1, ulat1, _ = c_unwrapped[0]
                ulon2, ulat2, _ = c_unwrapped[1]

                if ulon1 == ulon2 and ulat1 == ulat2:
                    continue

                dist_nm = round(haversine(lon1, lat1, lon2, lat2))
                min_alt = p1.get('min_alt_1')
                if min_alt and str(min_alt).strip().isdigit():
                    mea_val = int(str(min_alt).strip())
                else:
                    try:
                        mea_val = int(parse_altitude(min_alt))
                    except (ValueError, TypeError):
                        mea_val = 0

                route_type = p1.get('route_type') or p1.get('airway_type')
                if not route_type:
                    if key.startswith('V'):
                        route_type = 'Victor'
                    elif key.startswith('Q') or key.startswith('T'):
                        route_type = 'GPS'
                    elif key.startswith('J'):
                        route_type = 'Victor'
                    else:
                        route_type = 'Unknown'

                coords = [
                    (ulon1, ulat1, max(elev1, parse_altitude(min_alt))),
                    (ulon2, ulat2, max(elev2, parse_altitude(min_alt)))
                ]

                structure = 'High' if key.startswith('J') or key.startswith('Q') else 'Low'

                airway_features.append(geojson.Feature(
                    geometry=geojson.LineString(coords),
                    properties={
                        'airway': key,
                        'mea': mea_val,
                        'distance': dist_nm,
                        'route_type': route_type,
                        'structure': structure,
                        'rank': 5
                    }
                ))

    save_fgb(airway_features, 'data/airways.fgb')

    print("Extracting Runways...", flush=True)
    runway_features = []
    for rw in c.get_runways():
        p = rw.to_dict()['primary']
        lat, lon = p.get('lat'), p.get('lon')
        if lat is not None and lon is not None:
            elev = float(p.get('threshold_elevation') or 0.0)
            runway_features.append(geojson.Feature(
                geometry=geojson.Point((lon, lat, elev)),
                properties={
                    'airport': p.get('airport_id'),
                    'runway': p.get('runway_id'),
                    'length': p.get('length'),
                    'bearing': p.get('bearing'),
                    'width': p.get('width'),
                    'type': 'runway',
                    'rank': 5
                }
            ))

    save_fgb(runway_features, 'data/runways.fgb')

    print("Extracting Localizers...", flush=True)
    loc_features = []
    for loc in c.get_loc_gss():
        p = loc.to_dict()['primary']
        lat, lon = p.get('loc_lat'), p.get('loc_lon')
        if lat is not None and lon is not None:
            elev = float(p.get('gs_elevation') or 0.0)
            loc_features.append(geojson.Feature(
                geometry=geojson.Point((lon, lat, elev)),
                properties={
                    'airport': p.get('airport_id'),
                    'runway': p.get('runway_id'),
                    'ident': p.get('loc_id'),
                    'frequency': p.get('frequency'),
                    'bearing': p.get('loc_bearing'),
                    'type': 'localizer',
                    'rank': 5
                }
            ))

    save_fgb(loc_features, 'data/localizers.fgb')

    print("FlatGeobuf generation complete.", flush=True)

def main():
    if len(sys.argv) < 2:
        print("Usage: <command> <FAACIFP18_file>")
        sys.exit(1)
    build_pmtiles_fgb(sys.argv[1])

if __name__ == "__main__":
    main()
