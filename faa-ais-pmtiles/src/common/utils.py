"""
Shared utility functions for geospatial calculations and file I/O.

Includes Haversine distance, altitude parsing, coordinate unwrapping (anti-meridian handling),
and FlatGeobuf saving.
"""

import math
import geopandas as gpd

def haversine(lon1, lat1, lon2, lat2):
    R = 3440.065 # Earth radius in NM
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = (math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
        math.sin(dLon / 2) * math.sin(dLon / 2))
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
    if 'rank' in gdf.columns:
        gdf.sort_values(by='rank', ascending=True, inplace=True)
    gdf.geometry = gdf.geometry.force_2d()
    # Disable spatial index to ensure linear reading order by tippecanoe
    gdf.to_file(output_path, driver="FlatGeobuf", engine="pyogrio", layer_options={'SPATIAL_INDEX': 'NO'})
