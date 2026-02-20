"""Convert FAA aeronautical data to FlatGeobuf with frontend-compatible properties.

Sources:
  - Class Airspace: ESRI Shapefiles from NFDC (B, C, D, E)
  - Special Use Airspace: GeoJSON from ADDS ArcGIS Hub (MOA, R, P, W, A)
  - Boundary Airspace: GeoJSON from ADDS ArcGIS Hub (ARTCC, FIR, CTA, ADIZ)
  - Holding Patterns: GeoJSON from ADDS ArcGIS Hub
  - Digital Obstacle File: GeoJSON from ADDS ArcGIS Hub
"""

import glob
import json
import os

import geojson
import geopandas as gpd
import shapefile


# ---------------------------------------------------------------------------
# Class Airspace (Shapefiles)
# ---------------------------------------------------------------------------

LOCAL_TYPE_TO_CLASS: dict[str, str] = {
    "CLASS_B": "B",
    "CLASS_C": "C",
    "CLASS_D": "D",
    "CLASS_E": "E",
    "CLASS_E2": "E",
    "CLASS_E3": "E",
    "CLASS_E4": "E",
    "CLASS_E5": "E",
    "CLASS_E6": "E",
    "CLASS_E7": "E",
    "TRSA": "TRSA",
    "MODE C": "MODE_C",
}


def classify_controlled_airspace(record: dict) -> dict:
    """Derive frontend-compatible properties from shapefile attributes."""
    raw_class = (record.get("CLASS") or "").strip().upper()
    local_type = (record.get("LOCAL_TYPE") or "").strip().upper()
    name = (record.get("NAME") or record.get("IDENT") or "").strip()

    airspace_class = LOCAL_TYPE_TO_CLASS.get(local_type, raw_class)
    display_type = airspace_class if airspace_class == "E" else local_type

    return {
        "name": name,
        "type": display_type,
        "airspace_class": airspace_class,
        "is_sua": False,
        "upper_limit": record.get("UPPER_VAL") or "",
        "lower_limit": record.get("LOWER_VAL") or "",
        "local_type": local_type,
    }


def shape_to_geojson_geometry(
    shape: shapefile.Shape,
) -> geojson.Polygon | geojson.MultiPolygon | None:
    """Convert a pyshp Shape to a GeoJSON geometry."""
    geo = shape.__geo_interface__
    geom_type = geo.get("type")

    if geom_type == "Polygon":
        return geojson.Polygon(geo["coordinates"])
    elif geom_type == "MultiPolygon":
        return geojson.MultiPolygon(geo["coordinates"])
    return None


def convert_class_airspace(shp_dir: str = "shapefiles") -> list[geojson.Feature]:
    """Read Class Airspace shapefiles and return features."""
    shp_files = glob.glob(os.path.join(shp_dir, "**", "*.shp"), recursive=True)
    if not shp_files:
        print(f"  No .shp files found in {shp_dir}/")
        return []

    features: list[geojson.Feature] = []
    for shp_path in shp_files:
        print(f"  Reading {shp_path}...")
        sf = shapefile.Reader(shp_path)
        field_names = [f[0] for f in sf.fields[1:]]

        for sr in sf.shapeRecords():
            record = dict(zip(field_names, sr.record))
            geom = shape_to_geojson_geometry(sr.shape)
            if geom is None:
                continue
            props = classify_controlled_airspace(record)
            features.append(geojson.Feature(geometry=geom, properties=props))

    print(f"  {len(features)} controlled airspace features")
    return features


# ---------------------------------------------------------------------------
# SUA (ADDS GeoJSON)
# ---------------------------------------------------------------------------

def convert_sua(sua_path: str = "data/sua_raw.geojson") -> list[geojson.Feature]:
    """Read SUA GeoJSON and return features with mapped properties."""
    if not os.path.exists(sua_path):
        print(f"  SUA file not found at {sua_path}")
        return []

    with open(sua_path) as f:
        data = json.load(f)

    features: list[geojson.Feature] = []
    for ft in data.get("features", []):
        raw_props = ft.get("properties", {})
        geom = ft.get("geometry")
        if geom is None:
            continue

        type_code = (raw_props.get("TYPE_CODE") or "").strip().upper()
        name = (raw_props.get("NAME") or "").strip()

        features.append(geojson.Feature(
            geometry=geom,
            properties={
                "name": name,
                "type": type_code,
                "airspace_class": type_code,
                "is_sua": True,
                "upper_limit": raw_props.get("UPPER_VAL") or "",
                "lower_limit": raw_props.get("LOWER_VAL") or "",
                "local_type": type_code,
            },
        ))

    print(f"  {len(features)} SUA features")
    return features


# ---------------------------------------------------------------------------
# Airspaces (merged output)
# ---------------------------------------------------------------------------

def convert_airspaces(output: str = "data/airspaces.fgb") -> None:
    """Merge controlled airspace + SUA into a single FlatGeobuf file, dissolving overlaps."""
    print("Processing controlled airspace (shapefiles)...")
    controlled = convert_class_airspace()

    print("Processing SUA (ArcGIS GeoJSON)...")
    sua = convert_sua()

    all_features = controlled + sua
    os.makedirs(os.path.dirname(output), exist_ok=True)

    gdf = gpd.GeoDataFrame.from_features(all_features, crs="EPSG:4326")
    # Force 2D
    gdf.geometry = gdf.geometry.force_2d()

    # Clean topological errors (like self-intersections) that cause shapely union_all to crash
    gdf.geometry = gdf.geometry.buffer(0)

    # Class E5, E6, E7 airspaces don't need distinct names and should merge perfectly
    e_non_surface = gdf["local_type"].isin(["CLASS_E5", "CLASS_E6", "CLASS_E7"])
    gdf.loc[e_non_surface, "name"] = ""

    # Dissolve overlapping geometries that share the exact same properties
    # E.g. merging adjacent or overlapping Class E5 segments with the same name
    dissolution_cols = ["name", "type", "airspace_class", "is_sua", "upper_limit", "lower_limit", "local_type"]

    print(f"Dissolving {len(gdf)} airspace geometries by {dissolution_cols}...")
    # fillna because dissolve groups by exact value, and NaNs break it
    gdf[dissolution_cols] = gdf[dissolution_cols].fillna("")
    gdf = gdf.dissolve(by=dissolution_cols, as_index=False)

    gdf.sort_values(by='rank', ascending=True, inplace=True) if 'rank' in gdf.columns else None
    gdf.to_file(output, driver="FlatGeobuf", engine="pyogrio", layer_options={'SPATIAL_INDEX': 'NO'})

    print(f"Wrote {len(gdf)} dissolved airspace features to {output}")


# ---------------------------------------------------------------------------
# Boundary Airspace (ARTCC/FIR)
# ---------------------------------------------------------------------------

def convert_boundary_airspace(
    raw_path: str = "data/boundary_airspace_raw.geojson",
    output: str = "data/boundary_airspace.fgb",
) -> None:
    """Convert boundary airspace GeoJSON with simplified properties to FlatGeobuf."""
    if not os.path.exists(raw_path):
        print(f"  Boundary airspace file not found at {raw_path}")
        return

    print("Processing Boundary Airspace...")
    with open(raw_path) as f:
        data = json.load(f)

    features: list[geojson.Feature] = []
    for ft in data.get("features", []):
        raw = ft.get("properties", {})
        geom = ft.get("geometry")
        if geom is None:
            continue

        type_code = (raw.get("TYPE_CODE") or "").strip().upper()
        name = (raw.get("NAME") or raw.get("IDENT") or "").strip()

        features.append(geojson.Feature(
            geometry=geom,
            properties={
                "name": name,
                "type": type_code,
                "ident": (raw.get("IDENT") or "").strip(),
                "local_type": (raw.get("LOCAL_TYPE") or "").strip(),
                "upper_limit": raw.get("UPPER_VAL") or "",
                "lower_limit": raw.get("LOWER_VAL") or "",
            },
        ))

    os.makedirs(os.path.dirname(output), exist_ok=True)
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    gdf.geometry = gdf.geometry.force_2d()
    gdf.sort_values(by='rank', ascending=True, inplace=True) if 'rank' in gdf.columns else None
    gdf.to_file(output, driver="FlatGeobuf", engine="pyogrio", layer_options={'SPATIAL_INDEX': 'NO'})

    print(f"  Wrote {len(features)} boundary airspace features to {output}")


# ---------------------------------------------------------------------------
# Holding Patterns
# ---------------------------------------------------------------------------

def convert_holding_patterns(
    raw_path: str = "data/holding_patterns_raw.geojson",
    output: str = "data/holding_patterns.fgb",
) -> None:
    """Convert holding pattern GeoJSON with simplified properties to FlatGeobuf."""
    if not os.path.exists(raw_path):
        print(f"  Holding patterns file not found at {raw_path}")
        return

    print("Processing Holding Patterns...")
    with open(raw_path) as f:
        data = json.load(f)

    features: list[geojson.Feature] = []
    for ft in data.get("features", []):
        raw = ft.get("properties", {})
        geom = ft.get("geometry")
        if geom is None:
            continue

        features.append(geojson.Feature(
            geometry=geom,
            properties={
                "name": (raw.get("NAME") or "").strip(),
                "ident": (raw.get("IDENT") or "").strip(),
                "course_out": raw.get("CRSOUT"),
                "course_in": raw.get("CRSIN"),
                "turn_dir": (raw.get("DIRTURN") or "").strip(),
                "structures": (raw.get("STRUCTURES") or "").strip(),
                "speed_limit": raw.get("SPEEDLIMIT"),
                "rank": 5,
            },
        ))

    os.makedirs(os.path.dirname(output), exist_ok=True)
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    gdf.geometry = gdf.geometry.force_2d()
    gdf.sort_values(by='rank', ascending=True, inplace=True) if 'rank' in gdf.columns else None
    gdf.to_file(output, driver="FlatGeobuf", engine="pyogrio", layer_options={'SPATIAL_INDEX': 'NO'})

    print(f"  Wrote {len(features)} holding pattern features to {output}")


# ---------------------------------------------------------------------------
# Digital Obstacle File (DOF)
# ---------------------------------------------------------------------------

def convert_obstacles(
    raw_path: str = "data/dof_raw.geojson",
    output: str = "data/obstacles.fgb",
) -> None:
    """Convert DOF GeoJSON with simplified properties to FlatGeobuf."""
    if not os.path.exists(raw_path):
        print(f"  DOF file not found at {raw_path}")
        return

    print("Processing Digital Obstacle File...")
    with open(raw_path) as f:
        data = json.load(f)

    features: list[geojson.Feature] = []
    for ft in data.get("features", []):
        raw = ft.get("properties", {})
        geom = ft.get("geometry")
        if geom is None:
            continue

        obstacle_type = (raw.get("Type_Code") or "").strip()
        agl = raw.get("AGL")
        amsl = raw.get("AMSL")

        features.append(geojson.Feature(
            geometry=geom,
            properties={
                "type": obstacle_type,
                "agl": agl,
                "amsl": amsl,
                "lighting": (raw.get("Lighting") or "").strip(),
                # "city": (raw.get("City") or "").strip(),
                # "state": (raw.get("State") or "").strip(),
                "rank": 6,
            },
        ))

    os.makedirs(os.path.dirname(output), exist_ok=True)
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    gdf.geometry = gdf.geometry.force_2d()
    gdf.sort_values(by='rank', ascending=True, inplace=True) if 'rank' in gdf.columns else None
    gdf.to_file(output, driver="FlatGeobuf", engine="pyogrio", layer_options={'SPATIAL_INDEX': 'NO'})

    print(f"  Wrote {len(features)} obstacle features to {output}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    convert_airspaces()
    convert_boundary_airspace()
    convert_holding_patterns()
    convert_obstacles()


if __name__ == "__main__":
    main()
