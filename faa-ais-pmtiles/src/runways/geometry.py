"""
Utilities for processing runway geometry.

Provides functions to match opposite runway ends (e.g., 19R and 01L), calculate
destination points based on bearing and distance, and generate rectangular polygons
representing runway surfaces.
"""

import re
import math
import geojson

def get_opposite_runway_id(rw_id):
    if not rw_id:
        return None
    # Handle both "RW19R" and "19R"
    prefix = ""
    if rw_id.startswith("RW"):
        prefix = "RW"
        rw_id = rw_id[2:]

    match = re.match(r'(\d+)([LRC]?)', rw_id)
    if not match:
        return None

    num_str, suffix = match.groups()
    num = int(num_str)

    opp_num = (num + 18)
    if opp_num > 36:
        opp_num -= 36

    opp_suffix = ''
    if suffix == 'L':
        opp_suffix = 'R'
    elif suffix == 'R':
        opp_suffix = 'L'
    elif suffix == 'C':
        opp_suffix = 'C'

    return f"{prefix}{opp_num:02d}{opp_suffix}"

def calculate_destination(p1, bearing, distance_ft):
    # R_ft = 3440.065 NM * 6076.12 ft/NM
    R_ft = 3440.065 * 6076.12
    lat_rad = math.radians(p1[1])
    lon_rad = math.radians(p1[0])
    bearing_rad = math.radians(bearing)

    d_over_R = distance_ft / R_ft

    lat2 = math.asin(math.sin(lat_rad) * math.cos(d_over_R) +
                    math.cos(lat_rad) * math.sin(d_over_R) * math.cos(bearing_rad))
    lon2 = lon_rad + math.atan2(math.sin(bearing_rad) * math.sin(d_over_R) * math.cos(lat_rad),
                               math.cos(d_over_R) - math.sin(lat_rad) * math.sin(lat2))

    return [math.degrees(lon2), math.degrees(lat2), p1[2]]

def create_runway_poly(p1, p2, width_ft):
    # p1, p2 are [lon, lat, elev]
    lat_avg = math.radians((p1[1] + p2[1]) / 2.0)
    # Approximate degree to feet conversion
    ft_to_deg_lat = 1.0 / 364173.0
    ft_to_deg_lon = 1.0 / (364173.0 * math.cos(lat_avg))

    # Centerline vector in feet-equivalents
    dx = (p2[0] - p1[0]) / ft_to_deg_lon
    dy = (p2[1] - p1[1]) / ft_to_deg_lat

    length = math.sqrt(dx*dx + dy*dy)
    if length == 0:
        return None

    # Unit normal vector
    nx = -dy / length
    ny = dx / length

    # Half width in feet
    hw = width_ft / 2.0
    # Offset in degrees
    off_x = nx * hw * ft_to_deg_lon
    off_y = ny * hw * ft_to_deg_lat

    coords = [
        (p1[0] + off_x, p1[1] + off_y, p1[2]),
        (p2[0] + off_x, p2[1] + off_y, p2[2]),
        (p2[0] - off_x, p2[1] - off_y, p2[2]),
        (p1[0] - off_x, p1[1] - off_y, p1[2]),
        (p1[0] + off_x, p1[1] + off_y, p1[2])
    ]
    return geojson.Polygon([coords])
