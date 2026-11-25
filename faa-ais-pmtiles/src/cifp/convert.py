"""
Converts raw CIFP (ARINC 424) data into FlatGeobuf format.

Extracts airports, navaids, airways, procedures, runways, and localizers using the `cifparse` library.
Enriches airport data with metadata from NASR (fuel, tower, FAR 139 status).
"""

import os
import sys
from collections import defaultdict

import geojson
from cifparse import CIFP

from src.common.utils import haversine, parse_altitude, save_fgb, unwrap_coordinates
from src.nasr import fetch as nasr
from src.runways.geometry import (
    calculate_destination,
    create_runway_poly,
    get_opposite_runway_id,
)


def load_nasr_metadata():
    return nasr.load_nasr_metadata()


def load_nasr_facilities():
    return nasr.load_nasr_facilities()


def load_nasr_vfr_fixes():
    return nasr.load_nasr_vfr_fixes()


def parse_mora_coord(start_lat: str, start_lon: str) -> tuple[int, int]:
    """Parse ARINC 424 Grid MORA starting lat/lon strings (e.g. 'N36', 'W090', 'S29', 'E150') into integer SW corner coords."""
    if not isinstance(start_lat, str) or not isinstance(start_lon, str):
        raise ValueError("MORA start_lat and start_lon must be non-empty strings.")
    lat_str = start_lat.strip().upper()
    lon_str = start_lon.strip().upper()
    if len(lat_str) < 2 or len(lon_str) < 2:
        raise ValueError(f"Invalid MORA coordinates: start_lat={start_lat!r}, start_lon={start_lon!r}")

    lat_hemi = lat_str[0]
    lon_hemi = lon_str[0]
    if lat_hemi not in ("N", "S") or lon_hemi not in ("E", "W"):
        raise ValueError(f"Invalid MORA hemisphere: start_lat={start_lat!r}, start_lon={start_lon!r}")

    lat_val = int(lat_str[1:])
    lon_val = int(lon_str[1:])
    if not (0 <= lat_val <= 90 and 0 <= lon_val <= 180):
        raise ValueError(f"MORA coordinates out of range: start_lat={start_lat!r}, start_lon={start_lon!r}")

    lat0 = -lat_val if lat_hemi == "S" else lat_val
    lon0 = -lon_val if lon_hemi == "W" else lon_val
    return lat0, lon0


def format_mora_parts(mora_ft: int) -> tuple[str, str, str]:
    """Format Grid MORA altitude in feet into (thousands, hundreds, display) strings."""
    val = int(mora_ft)
    thousands = str(val // 1000)
    hundreds = str((val % 1000) // 100)
    display = f"{thousands}{hundreds}"
    return thousands, hundreds, display


def build_grid_mora_features(moras: list) -> tuple[list[geojson.Feature], list[geojson.Feature]]:
    """Build deduplicated 1-degree Grid MORA border LineStrings and center label Points."""
    line_features: list[geojson.Feature] = []
    label_features: list[geojson.Feature] = []
    edges: dict[tuple[tuple[int, int], tuple[int, int]], bool] = {}

    for m in moras:
        if hasattr(m, "has_primary") and not m.has_primary():
            continue
        p = m.primary.to_dict() if m.primary else {}
        start_lat = p.get("start_lat")
        start_lon = p.get("start_lon")
        if not start_lat or not start_lon:
            continue
        lat0, lon0 = parse_mora_coord(start_lat, start_lon)

        for i in range(30):
            val = p.get(f"mora_{i + 1}")
            if val is None:
                continue
            try:
                mora_ft = int(val)
            except ValueError, TypeError:
                continue
            if mora_ft <= 0:
                continue

            lon_left = lon0 + i
            if lon_left >= 180:
                lon_left = ((lon_left + 180) % 360) - 180
            lon_right = lon_left + 1

            thousands, hundreds, display = format_mora_parts(mora_ft)
            is_high = mora_ft >= 14000
            cell_id = f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}{'E' if lon_left >= 0 else 'W'}{abs(lon_left):03d}"

            label_features.append(
                geojson.Feature(
                    geometry=geojson.Point((lon_left + 0.5, lat0 + 0.5)),
                    properties={
                        "cell_id": cell_id,
                        "mora_ft": mora_ft,
                        "thousands": thousands,
                        "hundreds": hundreds,
                        "display": display,
                        "is_high": is_high,
                        "rank": 1,
                    },
                )
            )

            bl = (lon_left, lat0)
            br = (lon_right, lat0)
            tr = (lon_right, lat0 + 1)
            tl = (lon_left, lat0 + 1)
            for pt1, pt2 in ((bl, br), (tl, tr), (bl, tl), (br, tr)):
                edge_key = (min(pt1, pt2), max(pt1, pt2))
                edges[edge_key] = edges.get(edge_key, False) or is_high

    for (pt1, pt2), edge_is_high in edges.items():
        line_features.append(
            geojson.Feature(
                geometry=geojson.LineString([pt1, pt2]),
                properties={
                    "is_high": edge_is_high,
                    "rank": 1,
                },
            )
        )

    return line_features, label_features


RANK_MINZOOM = {1: 0, 2: 3, 3: 4, 4: 5, 5: 7}


def compute_airport_rank(
    ident: str,
    facility_type: str,
    facility_use: str,
    longest_runway: int,
    has_tower: bool,
    far_139: str,
    is_ifr: bool,
    is_military: bool,
) -> int:
    """Compute airport/heliport declutter rank (1=major hub .. 5=minor/private/medical)."""
    if any(idx in far_139 for idx in ("D", "E")) or (facility_type == "military" and longest_runway >= 10000):
        return 1
    if (
        any(idx in far_139 for idx in ("A", "B", "C"))
        or has_tower
        or (facility_type in {"civil_hard", "civil_soft", "military"} and longest_runway >= 7500)
    ):
        return 2
    if (
        facility_type in {"civil_hard", "civil_soft", "seaplane", "military"}
        and ((ident.startswith("K") and len(ident) == 4) or longest_runway >= 4000)
    ) or (facility_type == "heliport" and (facility_use == "PU" or is_ifr or is_military)):
        return 3
    if (
        facility_type in {"civil_hard", "civil_soft", "seaplane", "military"}
        or (facility_type in {"ultralight", "gliderport", "balloonport"} and facility_use == "PU")
        or (facility_type in {"private", "seaplane_private"} and (longest_runway >= 3000 or is_ifr))
    ):
        return 4
    return 5


def build_airport_features(
    cifp_airports: list,
    cifp_heliports: list,
    nasr_facilities: list[dict],
    airport_metadata: dict[str, dict],
) -> tuple[dict[str, geojson.Feature], dict[str, tuple[float, float, float]]]:
    """Merge NASR facilities and CIFP airport/heliport records into GeoJSON features and fix coords."""
    cifp_airport_records: dict[str, dict] = {}
    for a in cifp_airports:
        if not a.has_primary():
            continue
        p = a.primary.to_dict()
        lat, lon = p.get("lat"), p.get("lon")
        ident = (p.get("airport_id") or "").strip()
        if not ident or lat is None or lon is None:
            continue
        existing = cifp_airport_records.get(ident)
        if existing is None:
            cifp_airport_records[ident] = {
                "id": ident,
                "name": p.get("airport_name"),
                "lat": float(lat),
                "lon": float(lon),
                "elevation": float(p.get("elevation") or 0.0),
                "surface": p.get("longest_surface"),
                "usage": p.get("usage"),
                "longest_runway": int(p.get("longest") or 0),
                "is_ifr": bool(p.get("is_ifr")),
            }
        else:
            existing["is_ifr"] = existing["is_ifr"] or bool(p.get("is_ifr"))

    cifp_heliport_records: dict[str, dict] = {}
    for h in cifp_heliports:
        if not h.has_primary():
            continue
        p = h.primary.to_dict()
        lat, lon = p.get("lat"), p.get("lon")
        ident = (p.get("heliport_id") or "").strip()
        if not ident or lat is None or lon is None:
            continue
        existing = cifp_heliport_records.get(ident)
        if existing is None:
            cifp_heliport_records[ident] = {
                "id": ident,
                "name": p.get("heliport_name"),
                "lat": float(lat),
                "lon": float(lon),
                "elevation": float(p.get("elevation") or 0.0),
                "usage": p.get("usage"),
                "is_ifr": bool(p.get("is_ifr")),
            }
        else:
            existing["is_ifr"] = existing["is_ifr"] or bool(p.get("is_ifr"))

    airport_features_dict: dict[str, geojson.Feature] = {}
    fixes: dict[str, tuple[float, float, float]] = {}
    seen_nasr_ids: set[str] = set()

    def _add_feature(
        ident: str,
        name: str | None,
        lat: float,
        lon: float,
        elev: float,
        fac_type: str,
        surface: str,
        facility_use: str,
        is_military: bool,
        is_ifr: bool,
        longest_runway: int,
        has_fuel: bool,
        has_tower: bool,
        far_139: str,
    ) -> None:
        rank = compute_airport_rank(
            ident=ident,
            facility_type=fac_type,
            facility_use=facility_use,
            longest_runway=longest_runway,
            has_tower=has_tower,
            far_139=far_139,
            is_ifr=is_ifr,
            is_military=is_military,
        )
        properties = {
            "id": ident,
            "name": name,
            "type": "airport",
            "facility_type": fac_type,
            "surface": surface,
            "is_military": is_military,
            "is_ifr": is_ifr,
            "longest_runway": longest_runway,
            "has_fuel": has_fuel,
            "rank": rank,
        }
        feat = geojson.Feature(
            geometry=geojson.Point((lon, lat, elev)),
            properties=properties,
            tippecanoe={"minzoom": RANK_MINZOOM[rank]},
        )
        airport_features_dict[ident] = feat
        fixes[ident] = (lon, lat, elev)

    for fac in nasr_facilities:
        ident = (fac.get("id") or "").strip()
        lat, lon = fac.get("lat"), fac.get("lon")
        if not ident or lat is None or lon is None:
            continue
        seen_nasr_ids.add(ident)
        for alias_key in ("arpt_id", "icao_id"):
            alias = (fac.get(alias_key) or "").strip()
            if alias:
                seen_nasr_ids.add(alias)
        elev = float(fac.get("elevation") or 0.0)
        is_ifr = bool((cifp_airport_records.get(ident) or {}).get("is_ifr") or (cifp_heliport_records.get(ident) or {}).get("is_ifr"))
        _add_feature(
            ident=ident,
            name=fac.get("name"),
            lat=float(lat),
            lon=float(lon),
            elev=elev,
            fac_type=fac.get("facility_type") or "civil_soft",
            surface=fac.get("surface") or "S",
            facility_use=(fac.get("facility_use") or "").strip().upper(),
            is_military=bool(fac.get("is_military")),
            is_ifr=is_ifr,
            longest_runway=int(fac.get("longest_runway") or 0),
            has_fuel=bool(fac.get("has_fuel")),
            has_tower=bool(fac.get("has_tower")),
            far_139=str(fac.get("far_139") or ""),
        )

    for ident, rec in cifp_airport_records.items():
        if ident in airport_features_dict or ident in seen_nasr_ids:
            continue
        meta = airport_metadata.get(ident)
        if not meta and ident.startswith("K") and len(ident) == 4:
            meta = airport_metadata.get(ident[1:])
        meta = meta or {}

        surface = rec.get("surface") or "S"
        usage = rec.get("usage")
        if surface == "W":
            fac_type = "seaplane_private" if usage == "P" else "seaplane"
        elif usage == "M":
            fac_type = "military"
        elif usage == "P":
            fac_type = "private"
        else:
            fac_type = "civil_hard" if surface == "H" else "civil_soft"

        _add_feature(
            ident=ident,
            name=rec.get("name"),
            lat=rec["lat"],
            lon=rec["lon"],
            elev=rec["elevation"],
            fac_type=fac_type,
            surface=surface,
            facility_use="PR" if usage == "P" else "PU",
            is_military=usage == "M",
            is_ifr=rec["is_ifr"],
            longest_runway=rec["longest_runway"],
            has_fuel=bool(meta.get("has_fuel", False)),
            has_tower=bool(meta.get("has_tower", False)),
            far_139=str(meta.get("far_139", "")),
        )

    for ident, rec in cifp_heliport_records.items():
        if ident in airport_features_dict or ident in seen_nasr_ids:
            continue
        meta = airport_metadata.get(ident)
        if not meta and ident.startswith("K") and len(ident) == 4:
            meta = airport_metadata.get(ident[1:])
        meta = meta or {}

        usage = rec.get("usage")
        _add_feature(
            ident=ident,
            name=rec.get("name"),
            lat=rec["lat"],
            lon=rec["lon"],
            elev=rec["elevation"],
            fac_type="heliport",
            surface="S",
            facility_use="PR" if usage == "P" else "PU",
            is_military=usage == "M",
            is_ifr=rec["is_ifr"],
            longest_runway=0,
            has_fuel=bool(meta.get("has_fuel", False)),
            has_tower=bool(meta.get("has_tower", False)),
            far_139=str(meta.get("far_139", "")),
        )

    return airport_features_dict, fixes


def build_pmtiles_fgb(cifp_path):
    print("Fetching NASR airport metadata...", flush=True)
    os.makedirs("data", exist_ok=True)
    airport_metadata = load_nasr_metadata()
    nasr_facilities = load_nasr_facilities()
    nasr_vfr_fixes = load_nasr_vfr_fixes() or {}
    nasr_vfr_waypoints = nasr_vfr_fixes.get("vfr_waypoints") or []
    nasr_sectional_fixes = nasr_vfr_fixes.get("sectional_fixes") or []
    nasr_vfr_by_id: dict[str, dict] = {}
    for item in nasr_vfr_waypoints:
        item_id = (item.get("id") or "").strip()
        if item_id and item_id not in nasr_vfr_by_id:
            nasr_vfr_by_id[item_id] = item

    print("Loading CIFP...", flush=True)
    c = CIFP(cifp_path)

    print("Parsing everything needed...", flush=True)
    c.parse_airports()
    c.parse_heliports()
    c.parse_vhf_navaids()
    c.parse_ndb_navaids()
    c.parse_enroute_waypoints()
    c.parse_terminal_waypoints()

    c.parse_procedures()
    c.parse_airway_points()
    c.parse_runways()
    c.parse_loc_gss()
    c.parse_moras()

    print("Building lookup dictionaries...", flush=True)
    print("Extracting Airports...", flush=True)
    airport_features_dict, fixes = build_airport_features(
        cifp_airports=c.get_airports(),
        cifp_heliports=c.get_heliports(),
        nasr_facilities=nasr_facilities,
        airport_metadata=airport_metadata,
    )

    with open("data/airports.geojson", "w") as f:
        geojson.dump(geojson.FeatureCollection(list(airport_features_dict.values())), f)

    print("Extracting Navaids...", flush=True)
    navaid_features = []
    for nav in c.get_vhf_navaids():
        if hasattr(nav, "has_primary") and not nav.has_primary():
            continue
        p = nav.primary.to_dict()
        lat = p.get("lat") or p.get("dme_lat")
        lon = p.get("lon") or p.get("dme_lon")
        if lat is not None and lon is not None:
            elev = float(p.get("dme_elevation") or p.get("elevation") or 0.0)
            ident = (p.get("vhf_id") or p.get("dme_id") or "").strip()

            nav_class = p.get("nav_class") or "     "
            alt_class = nav_class[1:2] if len(nav_class) > 1 else " "
            if alt_class == "H":
                rank = 2
            elif alt_class == "L":
                rank = 3
            elif alt_class == "T":
                rank = 4
            else:
                rank = 5

            # Parse NAVAID type from class (e.g., 'V' for VOR/VORTAC/VORDME, 'T' for TACAN, 'D' for DME)
            nav_type = "vhf"
            if nav_class.startswith("V"):
                if "T" in nav_class:
                    nav_type = "vortac"
                elif "D" in nav_class:
                    nav_type = "vordme"
                else:
                    nav_type = "vor"
            elif nav_class.startswith("T") or nav_class.startswith("M"):
                nav_type = "tacan"
            elif nav_class.startswith("D"):
                nav_type = "dme"
            # (Note: ILS/Localizers are handled separately)

            navaid_features.append(
                geojson.Feature(
                    geometry=geojson.Point((lon, lat, elev)),
                    properties={
                        "id": ident,
                        "name": p.get("vhf_name"),
                        "frequency": p.get("frequency"),
                        "type": nav_type,
                        "rank": rank,
                    },
                )
            )
            if ident:
                fixes[ident] = (lon, lat, elev)

    for nav in c.get_ndb_navaids():
        if hasattr(nav, "has_primary") and not nav.has_primary():
            continue
        p = nav.primary.to_dict()
        lat, lon = p.get("lat"), p.get("lon")
        if lat is not None and lon is not None:
            elev = float(p.get("elevation") or 0.0)
            ident = (p.get("ndb_id") or "").strip()
            navaid_features.append(
                geojson.Feature(
                    geometry=geojson.Point((lon, lat, elev)),
                    properties={
                        "id": ident,
                        "name": p.get("ndb_name"),
                        "frequency": p.get("frequency"),
                        "type": "ndb",
                        "rank": 5,
                    },
                )
            )
            if ident:
                fixes[ident] = (lon, lat, elev)

    print("Extracting Waypoints...", flush=True)
    waypoint_features = []
    vfr_waypoint_features = []
    seen_vfr_keys: set[tuple[str, str]] = set()
    cifp_compulsory_ids: set[str] = set()
    for wp in c.get_enroute_waypoints() + c.get_terminal_waypoints():
        if hasattr(wp, "has_primary") and not wp.has_primary():
            continue
        p = wp.primary.to_dict()
        if p.get("lat") is not None and p.get("lon") is not None:
            ident = (p.get("waypoint_id") or "").strip()
            fixes[ident] = (p.get("lon"), p.get("lat"), 0.0)

            raw_type_field = p.get("type") or "   "
            if len(raw_type_field) > 0 and raw_type_field[0] == "V":
                key = (ident, "vfr")
                if ident and key not in seen_vfr_keys:
                    seen_vfr_keys.add(key)
                    nasr_info = nasr_vfr_by_id.get(ident) or {}
                    vfr_name = (nasr_info.get("name") or p.get("name_description") or "").strip()
                    vfr_waypoint_features.append(
                        geojson.Feature(
                            geometry=geojson.Point((p.get("lon"), p.get("lat"), 0.0)),
                            properties={
                                "id": ident,
                                "type": "vfr",
                                "name": vfr_name,
                                "charts": (nasr_info.get("charts") or "").strip(),
                                "state": (nasr_info.get("state") or "").strip(),
                                "compulsory": bool(nasr_info.get("compulsory", False)),
                                "rank": 3,
                            },
                        )
                    )
                continue

            # Classify waypoint type from ARINC 424
            raw_type = raw_type_field.strip()
            if raw_type == "C":
                wpt_type = "compulsory"
                if ident:
                    cifp_compulsory_ids.add(ident)
            elif raw_type == "R":
                wpt_type = "rnav"
            else:
                wpt_type = "named"

            # Usage: H = high altitude, L = low altitude, B = both, blank = terminal/other
            usage = (p.get("usage") or "").strip()

            base_rank = 5
            if wpt_type == "compulsory":
                base_rank = 3
            elif wpt_type == "rnav":
                base_rank = 4

            if usage in ("H", "B"):
                rank = base_rank
            elif usage == "L":
                rank = base_rank + 1
            else:
                rank = base_rank + 2

            rank = min(rank, 6)

            waypoint_features.append(
                geojson.Feature(
                    geometry=geojson.Point((p.get("lon"), p.get("lat"), 0.0)),
                    properties={
                        "id": ident,
                        "type": wpt_type,
                        "usage": usage,
                        "name": (p.get("name_description") or "").strip(),
                        "rank": rank,
                    },
                )
            )

    for item in nasr_vfr_waypoints:
        item_id = (item.get("id") or "").strip()
        lat, lon = item.get("lat"), item.get("lon")
        if not item_id or lat is None or lon is None:
            continue
        key = (item_id, "vfr")
        if key in seen_vfr_keys:
            continue
        seen_vfr_keys.add(key)
        vfr_waypoint_features.append(
            geojson.Feature(
                geometry=geojson.Point((float(lon), float(lat), 0.0)),
                properties={
                    "id": item_id,
                    "type": "vfr",
                    "name": (item.get("name") or "").strip(),
                    "charts": (item.get("charts") or "").strip(),
                    "state": (item.get("state") or "").strip(),
                    "compulsory": bool(item.get("compulsory", False)),
                    "rank": 3,
                },
            )
        )

    for item in nasr_sectional_fixes:
        item_id = (item.get("id") or "").strip()
        lat, lon = item.get("lat"), item.get("lon")
        if not item_id or lat is None or lon is None:
            continue
        key = (item_id, "sectional_fix")
        if key in seen_vfr_keys:
            continue
        seen_vfr_keys.add(key)
        vfr_waypoint_features.append(
            geojson.Feature(
                geometry=geojson.Point((float(lon), float(lat), 0.0)),
                properties={
                    "id": item_id,
                    "type": "sectional_fix",
                    "name": (item.get("name") or "").strip(),
                    "charts": (item.get("charts") or "").strip(),
                    "state": (item.get("state") or "").strip(),
                    "compulsory": bool(item.get("compulsory", False)) or (item_id in cifp_compulsory_ids),
                    "rank": 4,
                },
            )
        )

    save_fgb(waypoint_features, "data/waypoints.fgb")
    save_fgb(vfr_waypoint_features, "data/vfr_waypoints.fgb")

    save_fgb(navaid_features, "data/navaids.fgb")

    print("Processing Procedures...", flush=True)
    proc_groups = defaultdict(list)
    for proc in c.get_procedures():
        if hasattr(proc, "has_primary") and not proc.has_primary():
            continue
        p = proc.primary.to_dict()
        key = (p.get("fac_id"), p.get("procedure_id"), p.get("transition_id"))
        proc_groups[key].append(p)

    procedure_features = []
    for key, pts in proc_groups.items():
        pts.sort(key=lambda x: x.get("seq_no") or 0)
        coords = []
        for p in pts:
            fix = (p.get("fix_id") or "").strip()
            if fix in fixes:
                lon, lat, elev = fixes[fix]
                proc_elev = parse_altitude(p.get("alt_1") or p.get("trans_alt"))
                coords.append((lon, lat, max(elev, proc_elev)))
            elif p.get("lat") is not None and p.get("lon") is not None:
                proc_elev = parse_altitude(p.get("alt_1") or p.get("trans_alt"))
                coords.append((p.get("lon"), p.get("lat"), proc_elev))

        if len(coords) >= 2:
            coords = unwrap_coordinates(coords)
            procedure_features.append(
                geojson.Feature(
                    geometry=geojson.LineString(coords),
                    properties={
                        "airport": key[0],
                        "procedure": key[1],
                        "transition": key[2],
                        "rank": 5,
                    },
                )
            )

    save_fgb(procedure_features, "data/procedures.fgb")

    print("Processing Airways...", flush=True)
    airway_groups = defaultdict(list)
    for ap in c.get_airway_points():
        if hasattr(ap, "has_primary") and not ap.has_primary():
            continue
        p = ap.primary.to_dict()
        key = p.get("airway_id")
        if key:
            airway_groups[key].append(p)

    airway_features = []
    for key, pts in airway_groups.items():
        pts.sort(key=lambda x: x.get("seq_no") or 0)
        valid_pts = []
        for p in pts:
            fix = (p.get("point_id") or "").strip()
            if fix in fixes:
                valid_pts.append((p, fixes[fix]))

        for i in range(len(valid_pts) - 1):
            p1, fix1 = valid_pts[i]
            p2, fix2 = valid_pts[i + 1]
            lon1, lat1, elev1 = fix1
            lon2, lat2, elev2 = fix2

            c_unwrapped = unwrap_coordinates([(lon1, lat1, elev1), (lon2, lat2, elev2)])
            if len(c_unwrapped) == 2:
                ulon1, ulat1, _ = c_unwrapped[0]
                ulon2, ulat2, _ = c_unwrapped[1]

                if ulon1 == ulon2 and ulat1 == ulat2:
                    continue

                dist_nm = round(haversine(lon1, lat1, lon2, lat2))
                min_alt = p1.get("min_alt_1")
                if min_alt and str(min_alt).strip().isdigit():
                    mea_val = int(str(min_alt).strip())
                else:
                    try:
                        mea_val = int(parse_altitude(min_alt))
                    except ValueError, TypeError:
                        mea_val = 0

                route_type = p1.get("route_type") or p1.get("airway_type")
                if not route_type:
                    if key.startswith("V"):
                        route_type = "Victor"
                    elif key.startswith("Q") or key.startswith("T"):
                        route_type = "GPS"
                    elif key.startswith("J"):
                        route_type = "Victor"
                    else:
                        route_type = "Unknown"

                coords = [
                    (ulon1, ulat1, max(elev1, parse_altitude(min_alt))),
                    (ulon2, ulat2, max(elev2, parse_altitude(min_alt))),
                ]

                structure = "High" if key.startswith("J") or key.startswith("Q") else "Low"

                airway_features.append(
                    geojson.Feature(
                        geometry=geojson.LineString(coords),
                        properties={
                            "airway": key,
                            "mea": mea_val,
                            "distance": dist_nm,
                            "route_type": route_type,
                            "structure": structure,
                            "rank": 5,
                        },
                    )
                )

    save_fgb(airway_features, "data/airways.fgb")

    print("Extracting Runways...", flush=True)
    thresholds = []
    for rw in c.get_runways():
        if hasattr(rw, "has_primary") and not rw.has_primary():
            continue
        p = rw.primary.to_dict()
        lat, lon = p.get("lat"), p.get("lon")
        if lat is not None and lon is not None:
            elev = float(p.get("threshold_elevation") or 0.0)
            thresholds.append(
                geojson.Feature(
                    geometry=geojson.Point((lon, lat, elev)),
                    properties={
                        "airport": p.get("airport_id"),
                        "runway": p.get("runway_id"),
                        "length": p.get("length"),
                        "bearing": p.get("bearing"),
                        "width": p.get("width"),
                        "type": "runway",
                        "rank": 5,
                    },
                )
            )

    # Post-process thresholds into polygons and labels
    runway_features = []
    label_features = []
    by_airport = defaultdict(list)
    for t in thresholds:
        by_airport[t.properties["airport"]].append(t)

    for airport_id, airport_thresholds in by_airport.items():
        processed = set()
        for t1 in airport_thresholds:
            id1 = t1.properties["runway"]
            if id1 in processed:
                continue

            id2 = get_opposite_runway_id(id1)
            t2 = next((t for t in airport_thresholds if t.properties["runway"] == id2), None)

            width_ft = float(t1.properties.get("width") or 100.0)
            length_ft = float(t1.properties.get("length") or 0.0)

            if t2:
                # Two ends matched!
                p1 = t1.geometry.coordinates
                p2 = t2.geometry.coordinates
                poly = create_runway_poly(p1, p2, width_ft)

                # Sort bearings
                b1 = float(t1.properties.get("bearing") or 0.0)
                b2 = float(t2.properties.get("bearing") or 0.0)
                bearings = sorted([b1, b2])

                combined_id = f"{id1.replace('RW', '')}/{id2.replace('RW', '')}"

                if poly:
                    props = t1.properties.copy()
                    props.update(
                        {
                            "runway": combined_id,
                            "bearing_1": bearings[0],
                            "bearing_2": bearings[1],
                        }
                    )
                    props.pop("bearing", None)

                    runway_features.append(geojson.Feature(geometry=poly, properties=props))

                # Create label features for both ends
                # t1
                l1_props = {
                    "label": id1.replace("RW", ""),
                    "runway_id": combined_id,
                    "airport_id": airport_id,
                    "bearing": b1,
                    "type": "runway_label",
                }
                label_features.append(geojson.Feature(geometry=t1.geometry, properties=l1_props))

                # t2
                l2_props = {
                    "label": id2.replace("RW", ""),
                    "runway_id": combined_id,
                    "airport_id": airport_id,
                    "bearing": b2,
                    "type": "runway_label",
                }
                label_features.append(geojson.Feature(geometry=t2.geometry, properties=l2_props))

                processed.add(id1)
                processed.add(id2)
            else:
                # One end only, use bearing and length if available
                p1 = t1.geometry.coordinates
                bearing = t1.properties.get("bearing")

                if bearing is not None and length_ft > 0:
                    try:
                        b_val = float(bearing)
                        p2 = calculate_destination(p1, b_val, length_ft)
                        poly = create_runway_poly(p1, p2, width_ft)
                        if poly:
                            props = t1.properties.copy()
                            props.update({"bearing_1": b_val, "bearing_2": None})
                            props.pop("bearing", None)

                            runway_features.append(geojson.Feature(geometry=poly, properties=props))

                            # Label for the known end
                            l1_props = {
                                "label": id1.replace("RW", ""),
                                "runway_id": t1.properties.get("runway"),  # No combined ID if single
                                "airport_id": airport_id,
                                "bearing": b_val,
                                "type": "runway_label",
                            }
                            label_features.append(geojson.Feature(geometry=t1.geometry, properties=l1_props))

                    except ValueError, TypeError:
                        # Fallback to point if bearing invalid
                        runway_features.append(t1)
                else:
                    # Fallback to point if no bearing/length
                    runway_features.append(t1)
                processed.add(id1)

    save_fgb(runway_features, "data/cifp_runways.fgb")
    save_fgb(label_features, "data/cifp_runway_labels.fgb")

    print("Extracting Localizers...", flush=True)
    loc_features = []
    for loc in c.get_loc_gss():
        if hasattr(loc, "has_primary") and not loc.has_primary():
            continue
        p = loc.primary.to_dict()
        lat, lon = p.get("loc_lat"), p.get("loc_lon")
        if lat is not None and lon is not None:
            elev = float(p.get("gs_elevation") or 0.0)
            loc_features.append(
                geojson.Feature(
                    geometry=geojson.Point((lon, lat, elev)),
                    properties={
                        "airport": p.get("airport_id"),
                        "runway": p.get("runway_id"),
                        "ident": p.get("loc_id"),
                        "frequency": p.get("frequency"),
                        "bearing": p.get("loc_bearing"),
                        "type": "localizer",
                        "rank": 5,
                    },
                )
            )

    save_fgb(loc_features, "data/localizers.fgb")

    print("Extracting Grid MORA...", flush=True)
    mora_line_features, mora_label_features = build_grid_mora_features(c.get_moras())
    save_fgb(mora_line_features, "data/grid_mora_lines.fgb")
    save_fgb(mora_label_features, "data/grid_mora_labels.fgb")

    print("FlatGeobuf generation complete.", flush=True)


def main():
    if len(sys.argv) < 2:
        print("Usage: <command> <FAACIFP18_file>")
        sys.exit(1)
    build_pmtiles_fgb(sys.argv[1])


if __name__ == "__main__":
    main()
