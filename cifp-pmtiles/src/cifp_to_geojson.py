import sys
import geojson
import math
from collections import defaultdict
from cifparse import CIFP

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
        # Check if it looks like a flight level string e.g. "FL180", wait we already tried float
        return val
    except ValueError:
        # e.g. "FL180"
        if alt_str.startswith('FL'):
            try:
                return float(alt_str[2:]) * 100
            except:
                pass
        return 0.0

def unwrap_coordinates(coords):
    if not coords: return coords
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

def build_pmtiles_geojson(cifp_path):
    print("Loading CIFP...", flush=True)
    c = CIFP(cifp_path)

    print("Parsing everything needed...", flush=True)
    c.parse_airports()
    c.parse_vhf_navaids()
    c.parse_ndb_navaids()
    c.parse_enroute_waypoints()
    c.parse_terminal_waypoints()
    c.parse_controlled()
    c.parse_restrictive()
    c.parse_procedures()
    c.parse_airway_points()
    c.parse_runways()
    c.parse_loc_gss()

    print("Building lookup dictionaries...", flush=True)
    fixes = {}
    airport_features = []

    print("Extracting Airports...", flush=True)
    for a in c.get_airports():
        p = a.to_dict()['primary']
        lat, lon = p.get('lat'), p.get('lon')
        if lat is not None and lon is not None:
            elev = float(p.get('elevation') or 0.0)

            # Determine facility type for toggles
            is_heliport = (p.get('airport_name') or '').upper().find('HELIPORT') != -1 or (p.get('airport_id') or '').startswith('H')
            is_private = (p.get('public_military') or '') == 'P'
            if is_heliport:
                fac_type = 'heliport'
            elif is_private:
                fac_type = 'private'
            else:
                fac_type = 'public'

            airport_features.append(geojson.Feature(
                geometry=geojson.Point((lon, lat, elev)),
                properties={
                    'id': p.get('airport_id'),
                    'name': p.get('airport_name'),
                    'type': 'airport',
                    'facility_type': fac_type
                }
            ))
            if p.get('airport_id'):
                fixes[p.get('airport_id').strip()] = (lon, lat, elev)

    with open('data/airports.geojson', 'w') as f:
        geojson.dump(geojson.FeatureCollection(airport_features), f)

    print("Extracting Navaids...", flush=True)
    navaid_features = []
    for nav in c.get_vhf_navaids():
        p = nav.to_dict()['primary']
        lat = p.get('lat') or p.get('dme_lat')
        lon = p.get('lon') or p.get('dme_lon')
        if lat is not None and lon is not None:
            elev = float(p.get('dme_elevation') or p.get('elevation') or 0.0)
            ident = (p.get('vhf_id') or p.get('dme_id') or '').strip()
            navaid_features.append(geojson.Feature(
                geometry=geojson.Point((lon, lat, elev)),
                properties={'id': ident, 'name': p.get('vhf_name'), 'frequency': p.get('frequency'), 'type': 'vhf'}
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
                properties={'id': ident, 'name': p.get('ndb_name'), 'frequency': p.get('frequency'), 'type': 'ndb'}
            ))
            if ident:
                fixes[ident] = (lon, lat, elev)

    # Add waypoints to lookup too
    for wp in c.get_enroute_waypoints() + c.get_terminal_waypoints():
        p = wp.to_dict()['primary']
        if p.get('lat') is not None and p.get('lon') is not None:
            fixes[(p.get('waypoint_id') or '').strip()] = (p.get('lon'), p.get('lat'), 0.0)

    with open('data/navaids.geojson', 'w') as f:
        geojson.dump(geojson.FeatureCollection(navaid_features), f)

    print("Processing Airspaces...", flush=True)
    airspace_groups = defaultdict(list)
    for asp in c.get_controlled():
        p = asp.to_dict()['primary']
        key = (p.get('airspace_name'), p.get('airspace_type'), p.get('mult_code'))
        airspace_groups[key].append(p)
    for asp in c.get_restrictive():
        p = asp.to_dict()['primary']
        key = (p.get('restrictive_name'), p.get('restrictive_type'), p.get('mult_code'))
        airspace_groups[key].append(p)

    airspace_features = []
    for key, pts in airspace_groups.items():
        pts.sort(key=lambda x: x.get('seq_no') or 0)
        coords = []
        for p in pts:
            lat, lon = p.get('lat'), p.get('lon')
            if lat is not None and lon is not None:
                elev = parse_altitude(p.get('upper_limit'))
                coords.append((lon, lat, elev))

        if len(coords) >= 3:
            coords = unwrap_coordinates(coords)
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            airspace_features.append(geojson.Feature(
                geometry=geojson.Polygon([coords]),
                properties={
                    'name': key[0],
                    'type': key[1],
                    'airspace_class': key[1],
                    'is_sua': key[1] in ['P', 'R', 'W', 'A', 'MOA']
                }
            ))
        elif len(coords) == 2:
            coords = unwrap_coordinates(coords)
            airspace_features.append(geojson.Feature(
                geometry=geojson.LineString(coords),
                properties={
                    'name': key[0],
                    'type': key[1],
                    'airspace_class': key[1],
                    'is_sua': key[1] in ['P', 'R', 'W', 'A', 'MOA']
                }
            ))

    with open('data/airspaces.geojson', 'w') as f:
        geojson.dump(geojson.FeatureCollection(airspace_features), f)

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
                # Direct coordinates in the leg
                proc_elev = parse_altitude(p.get('alt_1') or p.get('trans_alt'))
                coords.append((p.get('lon'), p.get('lat'), proc_elev))

        if len(coords) >= 2:
            coords = unwrap_coordinates(coords)
            procedure_features.append(geojson.Feature(
                geometry=geojson.LineString(coords),
                properties={'airport': key[0], 'procedure': key[1], 'transition': key[2]}
            ))

    with open('data/procedures.geojson', 'w') as f:
        geojson.dump(geojson.FeatureCollection(procedure_features), f)

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

                # Filter out dupes
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
                    if key.startswith('V'): route_type = 'Victor'
                    elif key.startswith('Q') or key.startswith('T'): route_type = 'GPS'
                    elif key.startswith('J'): route_type = 'Victor' # High Victor
                    else: route_type = 'Unknown'

                coords = [
                    (ulon1, ulat1, max(elev1, parse_altitude(min_alt))),
                    (ulon2, ulat2, max(elev2, parse_altitude(min_alt)))
                ]

                # Determine Low vs High airway structure
                structure = 'High' if key.startswith('J') or key.startswith('Q') else 'Low'

                airway_features.append(geojson.Feature(
                    geometry=geojson.LineString(coords),
                    properties={
                        'airway': key,
                        'mea': mea_val,
                        'distance': dist_nm,
                        'route_type': route_type,
                        'structure': structure
                    }
                ))

    with open('data/airways.geojson', 'w') as f:
        geojson.dump(geojson.FeatureCollection(airway_features), f)

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
                    'type': 'runway'
                }
            ))

    with open('data/runways.geojson', 'w') as f:
        geojson.dump(geojson.FeatureCollection(runway_features), f)

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
                    'type': 'localizer'
                }
            ))

    with open('data/localizers.geojson', 'w') as f:
        geojson.dump(geojson.FeatureCollection(loc_features), f)

    print("GeoJSON generation complete.", flush=True)

def main():
    if len(sys.argv) < 2:
        print("Usage: <command> <FAACIFP18_file>")
        sys.exit(1)
    build_pmtiles_geojson(sys.argv[1])

if __name__ == "__main__":
    main()
