import geopandas as gpd
import os

def check_fgb(path):
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return
    gdf = gpd.read_file(path, engine="pyogrio")
    print(f"=== {path} ===")
    print(f"Columns: {gdf.columns.tolist()}")
    print(f"Sample data:")
    print(gdf.head(5))
    if "airspace_class" in gdf.columns:
        print(f"Airspace Class counts:")
        print(gdf['airspace_class'].value_counts())
    if "type" in gdf.columns:
        print(f"Type counts:")
        print(gdf['type'].value_counts())

if __name__ == "__main__":
    check_fgb("data/airspaces.fgb")
    check_fgb("data/airspaces_e.fgb")
