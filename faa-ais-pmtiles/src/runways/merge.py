"""
Merges and deduplicates runway data from CIFP and Airport Diagrams (AM).

Prioritizes AM runways (high-fidelity polygons) over CIFP runways (derived polygons).
Normalizes runway identifiers to ensure accurate matching.
"""

import geopandas as gpd
import pandas as pd
import re
import os
from src.common.utils import save_fgb

from collections import defaultdict

def normalize_runway_id(rid):
    """
    Normalizes a runway ID to a sorted tuple of ends.
    Examples:
      "RW19R" -> ("19R",)
      "01L/19R" -> ("01L", "19R")
      "19R/01L" -> ("01L", "19R")
    """
    if not rid:
        return tuple()
    
    # Remove 'RW' prefix if present
    clean_id = rid.replace("RW", "").strip()
    
    # Split by '/' or '-'
    parts = re.split(r'[/-]', clean_id)
    
    # Normalize parts (e.g. 01 vs 1) -> keep as 01 for standard
    # Actually, let's keep it simple: sorting them should be enough for "01L/19R" vs "19R/01L"
    return tuple(sorted(p.strip() for p in parts if p.strip()))

def merge_runways(cifp_path='data/cifp_runways.fgb', cifp_labels_path='data/cifp_runway_labels.fgb', am_path='data/am_runways.fgb', output_path='data/runways.fgb', output_labels_path='data/runway_labels.fgb'):
    print(f"Merging runways from {cifp_path} and {am_path}...", flush=True)
    
    cifp_exists = os.path.exists(cifp_path)
    am_exists = os.path.exists(am_path)
    labels_exists = os.path.exists(cifp_labels_path)

    if not cifp_exists and not am_exists:
        print("No runway data found. Skipping merge.")
        return

    gdfs = []
    
    # Lookup to find AM row indices by (airport, normalized_id)
    am_lookup = defaultdict(list)

    if am_exists:
        try:
            am_gdf = gpd.read_file(am_path, engine="pyogrio")
            if not am_gdf.empty:
                am_gdf['source'] = 'AM'
                
                # Normalize Identifier
                # Use ICAO ID if available, else FAA ID
                am_gdf['airport_id'] = am_gdf['icao_id'].fillna(am_gdf['faa_id'])
                
                # Normalize Runway ID
                am_gdf['runway_id'] = am_gdf['rwy_id']
                
                # Normalize Surface (rename)
                if 'surface' in am_gdf.columns:
                    am_gdf.rename(columns={'surface': 'surface_type'}, inplace=True)
                
                # Drop original divergent columns to clean up schema
                cols_to_drop = ['faa_id', 'icao_id', 'rwy_id']
                am_gdf.drop(columns=[c for c in cols_to_drop if c in am_gdf.columns], inplace=True)
                
                # Initialize enrichment columns if missing
                for col in ['length', 'width', 'bearing_1', 'bearing_2']:
                    if col not in am_gdf.columns:
                        am_gdf[col] = float('nan')

                # Build lookup
                for idx, row in am_gdf.iterrows():
                    apt = row.get('airport_id')
                    rwy = row.get('runway_id')
                    if apt and rwy:
                        norm_id = normalize_runway_id(rwy)
                        # Map full tuple -> index
                        am_lookup[(apt, norm_id)].append(idx)
                        # Map individual ends -> index (for partial matches)
                        for end in norm_id:
                            am_lookup[(apt, (end,))].append(idx)
                
                gdfs.append(am_gdf)
        except Exception as e:
            print(f"Error reading AM runways: {e}")

    if cifp_exists:
        try:
            cifp_gdf = gpd.read_file(cifp_path, engine="pyogrio")
            if not cifp_gdf.empty:
                cifp_gdf['source'] = 'CIFP'
                
                # Normalize Identifier
                cifp_gdf.rename(columns={'airport': 'airport_id', 'runway': 'runway_id'}, inplace=True)
                
                # Filter out CIFP runways that match AM runways
                to_keep = []
                for idx, row in cifp_gdf.iterrows():
                    apt = row.get('airport_id')
                    rwy = row.get('runway_id')
                    norm_id = normalize_runway_id(rwy)
                    
                    # Find matching AM indices
                    matches = set()
                    
                    # Exact match
                    if (apt, norm_id) in am_lookup:
                        matches.update(am_lookup[(apt, norm_id)])
                    
                    # Partial match (if exact not found, or to be safe)
                    for end in norm_id:
                        key = (apt, (end,))
                        if key in am_lookup:
                            matches.update(am_lookup[key])
                    
                    if matches:
                        # Enrich matched AM rows
                        # We modify am_gdf (which is gdfs[0]) in place
                        am_gdf = gdfs[0]
                        for am_idx in matches:
                            if pd.isna(am_gdf.at[am_idx, 'length']):
                                am_gdf.at[am_idx, 'length'] = row.get('length')
                            if pd.isna(am_gdf.at[am_idx, 'width']):
                                am_gdf.at[am_idx, 'width'] = row.get('width')
                            
                            # Copy bearings
                            if pd.isna(am_gdf.at[am_idx, 'bearing_1']):
                                am_gdf.at[am_idx, 'bearing_1'] = row.get('bearing_1')
                            if pd.isna(am_gdf.at[am_idx, 'bearing_2']):
                                am_gdf.at[am_idx, 'bearing_2'] = row.get('bearing_2')
                    else:
                        # No match, keep CIFP row
                        to_keep.append(idx)
                
                cifp_filtered = cifp_gdf.loc[to_keep]
                print(f"  Kept {len(cifp_filtered)} CIFP runways (enriched {len(cifp_gdf) - len(cifp_filtered)} AM matches).")
                gdfs.append(cifp_filtered)
                
        except Exception as e:
            print(f"Error reading CIFP runways: {e}")

    if not gdfs:
        print("No features to save.")
        return

    merged_gdf = pd.concat(gdfs, ignore_index=True)
    
    # Ensure rank is present (default to 5 if missing)
    if 'rank' not in merged_gdf.columns:
        merged_gdf['rank'] = 5
    merged_gdf['rank'] = merged_gdf['rank'].fillna(5)
    
    # Drop legacy 'bearing' column if it leaked through
    if 'bearing' in merged_gdf.columns:
        merged_gdf.drop(columns=['bearing'], inplace=True)
    
    # Reorder columns for consistency (move key IDs to front)
    # Get list of all columns present
    cols = merged_gdf.columns.tolist()
    # Define preferred order
    head_cols = ['airport_id', 'runway_id', 'length', 'width', 'bearing_1', 'bearing_2', 'surface_type', 'rank', 'source']
    # Filter head_cols to those that actually exist
    head_cols = [c for c in head_cols if c in cols]
    # Remaining cols
    tail_cols = [c for c in cols if c not in head_cols and c != 'geometry']
    # Construct final order
    final_order = head_cols + tail_cols + ['geometry']
    
    merged_gdf = merged_gdf[final_order]
    
    save_fgb(merged_gdf, output_path)
    print(f"Saved merged runways to {output_path}")

    # Process Labels
    if labels_exists:
        try:
            labels_gdf = gpd.read_file(cifp_labels_path, engine="pyogrio")
            if not labels_gdf.empty:
                # We only want labels for runways that exist in the final merged set.
                # Create a set of valid (airport_id, normalized_runway_id)
                valid_runways = set()
                for idx, row in merged_gdf.iterrows():
                    apt = row.get('airport_id')
                    rwy = row.get('runway_id')
                    if apt and rwy:
                        valid_runways.add((apt, normalize_runway_id(rwy)))
                
                # Filter labels
                to_keep_labels = []
                for idx, row in labels_gdf.iterrows():
                    apt = row.get('airport_id')
                    rwy = row.get('runway_id') # This is the combined ID e.g. 01/19 from CIFP
                    
                    if apt and rwy:
                        norm = normalize_runway_id(rwy)
                        if (apt, norm) in valid_runways:
                            to_keep_labels.append(idx)
                        else:
                            # Try partial match (if merged set has single end but label is double?)
                            # Actually, label runway_id comes from CIFP convert which uses combined ID if matched.
                            # merged_gdf has standardized IDs.
                            # If merged has "01/19", label has "01/19". Match.
                            pass
                
                final_labels = labels_gdf.loc[to_keep_labels]
                
                # Ensure rank is present (copy from parent runway or default)
                # Labels usually inherit rank from airport/runway for zoom visibility
                # For now, default to 5 or derived?
                if 'rank' not in final_labels.columns:
                    final_labels['rank'] = 5
                
                save_fgb(final_labels, output_labels_path)
                print(f"Saved {len(final_labels)} runway labels to {output_labels_path}")
                
        except Exception as e:
            print(f"Error processing labels: {e}")

def main():
    merge_runways()

if __name__ == "__main__":
    main()
