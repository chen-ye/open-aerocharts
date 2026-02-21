import os
import geopandas as gpd
import pandas as pd
from pathlib import Path

def list_enums(data_dir):
    data_path = Path(data_dir)
    if not data_path.exists():
        print(f"Directory not found: {data_dir}")
        return

    # Files to ignore (raw or intermediate data)
    ignore_files = ["faa.db", "tmp_nasr"]

    # Extensions to process
    extensions = [".fgb", ".geojson"]

    # Heuristic: any string-like column with a relatively low number of unique values
    # is likely an enumeration.
    MAX_ENUM_VALUES = 100

    for file_path in sorted(data_path.iterdir()):
        if file_path.name in ignore_files or file_path.suffix not in extensions:
            continue

        # Skip _raw files which are just source dumps
        if "_raw" in file_path.name:
            continue

        print(f"\n=== {file_path.name} ===")
        try:
            # Using pyogrio for speed if available
            gdf = gpd.read_file(file_path, engine="pyogrio")

            if gdf.empty:
                print("  (Empty file)")
                continue

            for col in gdf.columns:
                if col == "geometry":
                    continue

                # Heuristic: any column with low cardinality is a potential enum.
                # This naturally excludes high-cardinality strings (names) and
                # continuous floats (coordinates/altitudes).
                num_unique = gdf[col].nunique(dropna=False)
                if 0 < num_unique < MAX_ENUM_VALUES:
                    unique_counts = gdf[col].value_counts(dropna=False)
                    print(f"\n  [{col}] ({len(unique_counts)} unique values):")
                    for val, count in unique_counts.items():
                        # Handle None/NaN for display
                        display_val = "None" if pd.isna(val) else val
                        print(f"    - {display_val}: {count}")

        except Exception as e:
            print(f"  Error reading file: {e}")

def main():
    list_enums("data")

if __name__ == "__main__":
    main()
