import io
import json
import os
import tempfile
import unittest
import zipfile
from unittest.mock import MagicMock, patch

import geopandas as gpd
import pyproj

from src.adds.convert import convert_airspaces, convert_boundary_airspace, convert_mode_c, normalize_boundary_limit
from src.cifp.convert import (
    RANK_MINZOOM,
    build_airport_features,
    classify_vhf_navaid,
    classify_waypoint,
    compute_airport_rank,
)
from src.nasr import fetch as nasr_fetch
from src.nasr.facilities import classify_nasr_facility, parse_nasr_facilities, parse_nasr_runways
from src.nasr.pja import convert_pja, parse_pja_csv
from src.search.build_index import build_search_index


class TestNormalizeBoundaryLimit(unittest.TestCase):
    def test_none_and_negative_values(self) -> None:
        self.assertEqual(normalize_boundary_limit(None, None, "UNLTD"), "UNL")
        self.assertEqual(normalize_boundary_limit(None, None, None), "")
        self.assertEqual(normalize_boundary_limit(-9998, None, "UNLTD"), "UNL")
        self.assertEqual(normalize_boundary_limit(-9998, "FT", "UNLTD"), "UNL")
        self.assertEqual(normalize_boundary_limit(-9998, "FL", "UNLTD"), "UNL")
        self.assertEqual(normalize_boundary_limit(-9998, None, None), "")
        self.assertEqual(normalize_boundary_limit(-100, "FT", None), "")
        self.assertEqual(normalize_boundary_limit(-100, "FT", "UNLTD"), "UNL")
        self.assertEqual(normalize_boundary_limit(float("nan"), "FT", None), "")
        self.assertEqual(normalize_boundary_limit(float("inf"), "FT", None), "")
        self.assertEqual(normalize_boundary_limit(float("-inf"), "FT", "UNLTD"), "UNL")

    def test_zero_not_treated_as_falsy(self) -> None:
        self.assertEqual(normalize_boundary_limit(0, "FT", "SFC"), "SFC")
        self.assertEqual(normalize_boundary_limit(0, None, None), "SFC")
        self.assertEqual(normalize_boundary_limit(0, "FT", ""), "SFC")
        self.assertEqual(normalize_boundary_limit(0, "FT", "MSL"), "0")
        self.assertEqual(normalize_boundary_limit(0.0, "FT", "MSL"), "0")

    def test_positive_values(self) -> None:
        self.assertEqual(normalize_boundary_limit(45, "FL", "STD"), "FL045")
        self.assertEqual(normalize_boundary_limit(600, "FL", "STD"), "FL600")
        self.assertEqual(normalize_boundary_limit(45.5, "FL", "STD"), "FL45.5")
        self.assertEqual(normalize_boundary_limit(700, "FT", "SFC"), "700 AGL")
        self.assertEqual(normalize_boundary_limit(700.5, "FT", "SFC"), "700.5 AGL")
        self.assertEqual(normalize_boundary_limit(18000, "FT", "MSL"), "18000")
        self.assertEqual(normalize_boundary_limit(1234.5, "FT", "MSL"), "1234.5")


class TestConvertBoundaryAirspace(unittest.TestCase):
    def test_convert_boundary_airspace_end_to_end(self) -> None:
        raw_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-122.0, 37.0], [-121.0, 37.0], [-121.0, 38.0], [-122.0, 37.0]]],
                    },
                    "properties": {
                        "NAME": "OAKLAND ARTCC",
                        "IDENT": "ZOA",
                        "TYPE_CODE": "artcc",
                        "LOCAL_TYPE": " artcc_high ",
                        "SECTOR": " Sector 1 ",
                        "UPPER_VAL": -9998,
                        "UPPER_UOM": None,
                        "UPPER_CODE": "UNLTD",
                        "LOWER_VAL": 0,
                        "LOWER_UOM": "FT",
                        "LOWER_CODE": "SFC",
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-120.0, 36.0], [-119.0, 36.0], [-119.0, 37.0], [-120.0, 36.0]]],
                    },
                    "properties": {
                        "NAME": "PACIFIC CTA",
                        "IDENT": "ZOA",
                        "TYPE_CODE": "CTA",
                        "LOCAL_TYPE": "cta",
                        "SECTOR": "",
                        "UPPER_VAL": 600,
                        "UPPER_UOM": "FL",
                        "UPPER_CODE": "STD",
                        "LOWER_VAL": 45,
                        "LOWER_UOM": "FL",
                        "LOWER_CODE": "STD",
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-118.0, 35.0], [-117.0, 35.0], [-117.0, 36.0], [-118.0, 35.0]]],
                    },
                    "properties": {
                        "NAME": "TRANSITION",
                        "IDENT": "TR",
                        "TYPE_CODE": "CLASS",
                        "LOCAL_TYPE": "class_e",
                        "SECTOR": None,
                        "UPPER_VAL": 18000,
                        "UPPER_UOM": "FT",
                        "UPPER_CODE": "MSL",
                        "LOWER_VAL": 700,
                        "LOWER_UOM": "FT",
                        "LOWER_CODE": "SFC",
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-116.0, 34.0], [-115.0, 34.0], [-115.0, 35.0], [-116.0, 34.0]]],
                    },
                    "properties": {
                        "NAME": "UNSPECIFIED",
                        "IDENT": "UN",
                        "TYPE_CODE": "FIR",
                        "LOCAL_TYPE": "",
                        "UPPER_VAL": -9998,
                        "UPPER_UOM": None,
                        "UPPER_CODE": None,
                        "LOWER_VAL": 0,
                        "LOWER_UOM": "FT",
                        "LOWER_CODE": "MSL",
                    },
                },
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "boundary_raw.geojson")
            out_path = os.path.join(tmpdir, "boundary.fgb")
            with open(raw_path, "w") as f:
                json.dump(raw_geojson, f)

            convert_boundary_airspace(raw_path=raw_path, output=out_path)
            self.assertTrue(os.path.exists(out_path))

            gdf = gpd.read_file(out_path, engine="pyogrio")
            self.assertEqual(len(gdf), 4)

            row0 = gdf.iloc[0]
            self.assertEqual(row0["upper_limit"], "UNL")
            self.assertEqual(row0["lower_limit"], "SFC")
            self.assertEqual(row0["sector"], "Sector 1")
            self.assertEqual(row0["local_type"], "ARTCC_HIGH")

            row1 = gdf.iloc[1]
            self.assertEqual(row1["upper_limit"], "FL600")
            self.assertEqual(row1["lower_limit"], "FL045")
            self.assertEqual(row1["local_type"], "CTA")

            row2 = gdf.iloc[2]
            self.assertEqual(row2["upper_limit"], "18000")
            self.assertEqual(row2["lower_limit"], "700 AGL")

            row3 = gdf.iloc[3]
            self.assertEqual(row3["upper_limit"], "")
            self.assertEqual(row3["lower_limit"], "0")


class TestModeCAirspace(unittest.TestCase):
    def test_convert_mode_c_and_merge_into_airspaces(self) -> None:
        mode_c_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-122.5, 37.5], [-122.0, 37.5], [-122.0, 38.0], [-122.5, 37.5]]],
                    },
                    "properties": {
                        "IDENT": "SFO",
                        "NAME": "SAN FRANCISCO INTL MODE C",
                        "LOCAL_TYPE": "MODE C",
                        "UPPER_VAL": 10000,
                        "UPPER_UOM": "FT",
                        "UPPER_CODE": "MSL",
                        "LOWER_VAL": 0,
                        "LOWER_UOM": "FT",
                        "LOWER_CODE": "SFC",
                    },
                }
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "mode_c_raw.geojson")
            out_critical = os.path.join(tmpdir, "airspaces.fgb")
            out_e = os.path.join(tmpdir, "airspaces_e.fgb")
            empty_sua = os.path.join(tmpdir, "missing_sua.geojson")
            empty_shp = os.path.join(tmpdir, "missing_shp")
            with open(raw_path, "w") as f:
                json.dump(mode_c_geojson, f)

            feats = convert_mode_c(raw_path=raw_path)
            self.assertEqual(len(feats), 1)
            props = feats[0]["properties"]
            self.assertEqual(props["airspace_class"], "MODE_C")
            self.assertEqual(props["lower_limit"], "SFC")
            self.assertEqual(props["upper_limit"], "10000")
            self.assertFalse(props["is_sua"])

            convert_airspaces(
                output_critical=out_critical,
                output_e=out_e,
                shp_dir=empty_shp,
                sua_path=empty_sua,
                mode_c_path=raw_path,
            )
            gdf = gpd.read_file(out_critical, engine="pyogrio")
            self.assertEqual(len(gdf), 1)
            self.assertEqual(gdf.iloc[0]["airspace_class"], "MODE_C")
            self.assertEqual(gdf.iloc[0]["lower_limit"], "SFC")
            self.assertEqual(gdf.iloc[0]["upper_limit"], "10000")


class TestPjaParsingAndConversion(unittest.TestCase):
    def test_parse_pja_csv_defaults_and_filtering(self) -> None:
        csv_text = "\n".join(
            [
                "PJA_ID,ARPT_ID,DROP_ZONE_NAME,CITY,LAT_DECIMAL,LONG_DECIMAL,PJA_RADIUS,MAX_ALTITUDE,MAX_ALTITUDE_TYPE_CODE,TIME_OF_USE,PJA_USE",
                "PJA001,E16,SKYDIVE MORGAN HILL,SAN MARTIN,37.0815,-121.597,2.5,14500,MSL,SR-SS,CIVIL",
                "PJA002,PAFA,NORTHERN JUMP,FAIRBANKS,64.75,-147.35,,,UNR,DAYLIGHT,MILITARY",
                "PJA003,KMER,ZERO RADIUS,MERCED,37.3,-120.5,0,10500,AGL,SR-SS,CIVIL",
                "PJA004,KSJC,INVALID RADIUS,SAN JOSE,37.36,-121.92,abc,12000,,24HR,CIVIL",
                "PJA005,KSQL,NEGATIVE RADIUS,SAN CARLOS,37.51,-122.25,-3,,,",
                "PJA006,KLAX,MISSING COORDS,LOS ANGELES,,,,10000,MSL,,",
                "PJA007,KSFO,BAD COORDS,SAN FRANCISCO,not_a_lat,-122.37,2.0,5000,MSL,,",
            ]
        )

        features = parse_pja_csv(io.StringIO(csv_text))
        self.assertEqual(len(features), 5)

        p0 = features[0]["properties"]
        self.assertEqual(p0["ident"], "PJA001")
        self.assertEqual(p0["name"], "SKYDIVE MORGAN HILL")
        self.assertEqual(p0["radius_nm"], 2.5)
        self.assertEqual(p0["max_alt"], "14500")
        self.assertEqual(p0["rank"], 5)

        p1 = features[1]["properties"]
        self.assertEqual(p1["radius_nm"], 1.5)
        self.assertEqual(p1["max_alt"], "UNL")
        self.assertEqual(p1["rank"], 5)

        p2 = features[2]["properties"]
        self.assertEqual(p2["radius_nm"], 1.5)
        self.assertEqual(p2["max_alt"], "10500 AGL")

        p3 = features[3]["properties"]
        self.assertEqual(p3["radius_nm"], 1.5)
        self.assertEqual(p3["max_alt"], "12000")

        p4 = features[4]["properties"]
        self.assertEqual(p4["radius_nm"], 1.5)
        self.assertEqual(p4["max_alt"], "")

    def test_convert_pja_high_latitude_geodesic_accuracy(self) -> None:
        center_lat = 64.75
        center_lon = -147.35
        radius_nm = 3.0
        expected_meters = radius_nm * 1852.0

        raw_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [center_lon, center_lat]},
                    "properties": {
                        "ident": "PJA_AK",
                        "name": "ALASKA DROP ZONE",
                        "radius_nm": radius_nm,
                        "max_alt": "UNL",
                        "time_of_use": "SR-SS",
                        "rank": 5,
                    },
                }
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "pja_raw.geojson")
            out_path = os.path.join(tmpdir, "parachute_areas.fgb")
            with open(raw_path, "w") as f:
                json.dump(raw_geojson, f)

            convert_pja(raw_path=raw_path, output=out_path)
            self.assertTrue(os.path.exists(out_path))

            gdf = gpd.read_file(out_path, engine="pyogrio")
            self.assertEqual(len(gdf), 1)
            self.assertEqual(gdf.iloc[0]["rank"], 5)
            self.assertEqual(gdf.iloc[0]["max_alt"], "UNL")

            poly = gdf.iloc[0].geometry
            self.assertEqual(poly.geom_type, "Polygon")

            geod = pyproj.Geod(ellps="WGS84")
            distances_m = [geod.inv(center_lon, center_lat, x, y)[2] for x, y in poly.exterior.coords[:-1]]
            self.assertGreater(len(distances_m), 16)
            for dist_m in distances_m:
                # AEQD buffering should stay within 1 meter of true geodesic radius even at 64.75° N
                # (EPSG:3857 Web Mercator would shrink radius by ~57% to ~2370m instead of 5556m)
                self.assertAlmostEqual(dist_m, expected_meters, delta=1.0)

    def test_convert_pja_empty_input_handled_gracefully(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "pja_empty.geojson")
            out_path = os.path.join(tmpdir, "parachute_areas.fgb")
            with open(raw_path, "w") as f:
                json.dump({"type": "FeatureCollection", "features": []}, f)

            convert_pja(raw_path=raw_path, output=out_path)
            self.assertFalse(os.path.exists(out_path))

            missing_path = os.path.join(tmpdir, "does_not_exist.geojson")
            convert_pja(raw_path=missing_path, output=out_path)
            self.assertFalse(os.path.exists(out_path))


class TestNasrFetch(unittest.TestCase):
    def test_single_zip_extracts_apt_and_pja_and_respects_cache_guard(self) -> None:
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w") as z:
            z.writestr(
                "CSV_Data/APT_BASE.csv",
                "ARPT_ID,ICAO_ID,FUEL_TYPES,TWR_TYPE_CODE,FAR_139_TYPE_CODE\nSJC,KSJC,100LL,ATCT,I\n",
            )
            pja_bytes = (
                b"PJA_ID,ARPT_ID,DROP_ZONE_NAME,CITY,LAT_DECIMAL,LONG_DECIMAL,PJA_RADIUS,MAX_ALTITUDE,MAX_ALTITUDE_TYPE_CODE,TIME_OF_USE,PJA_USE\n"
                b"PJA1,E16,DZ \xff NAME,SAN MARTIN,37.08,-121.59,2.0,14500,MSL,SR-SS,CIVIL\n"
            )
            z.writestr("nested/pja_base.csv", pja_bytes)

        mock_resp = MagicMock()
        mock_resp.content = zip_buf.getvalue()
        mock_resp.raise_for_status = MagicMock()

        orig_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                os.chdir(tmpdir)
                with (
                    patch("src.nasr.fetch.find_latest_csv_zip_url", return_value=("https://example.test/nasr.zip", "2026-10-29")),
                    patch("src.nasr.fetch.requests.get", return_value=mock_resp) as mock_get,
                ):
                    meta = nasr_fetch.get_airport_metadata()
                    self.assertEqual(mock_get.call_count, 1)
                    self.assertIn("KSJC", meta)
                    self.assertTrue(os.path.exists("data/nasr_metadata.json"))
                    self.assertTrue(os.path.exists("data/nasr_metadata.cycle"))
                    self.assertTrue(os.path.exists("data/pja_raw.geojson"))

                    with open("data/pja_raw.geojson") as f:
                        pja_fc = json.load(f)
                    self.assertEqual(len(pja_fc["features"]), 1)
                    self.assertEqual(pja_fc["features"][0]["properties"]["ident"], "PJA1")

                    # Cache hit when all 4 files exist
                    nasr_fetch.get_airport_metadata()
                    self.assertEqual(mock_get.call_count, 1)

                    # Remove pja_raw.geojson -> must re-download instead of skipping
                    os.remove("data/pja_raw.geojson")
                    nasr_fetch.get_airport_metadata()
                    self.assertEqual(mock_get.call_count, 2)
                    self.assertTrue(os.path.exists("data/pja_raw.geojson"))
                    self.assertTrue(os.path.exists("data/nasr_facilities.json"))

                    # Remove nasr_facilities.json -> must re-download instead of skipping
                    os.remove("data/nasr_facilities.json")
                    nasr_fetch.get_airport_metadata()
                    self.assertEqual(mock_get.call_count, 3)
                    self.assertTrue(os.path.exists("data/nasr_facilities.json"))
            finally:
                os.chdir(orig_cwd)


class _DummyCifpRecord:
    def __init__(self, primary: dict | None, has_primary_flag: bool = True) -> None:
        self._primary = primary
        self._has_primary = has_primary_flag

    def has_primary(self) -> bool:
        return self._has_primary

    def to_dict(self) -> dict:
        return {"primary": self._primary}


class TestNasrFacilitiesAndRunways(unittest.TestCase):
    def test_parse_nasr_runways_composite_keys_surface_tokens_and_land_filter(self) -> None:
        rwy_csv = "\n".join(
            [
                "SITE_NO,SITE_TYPE_CODE,RWY_ID,RWY_LEN,SURFACE_TYPE_CODE",
                "001,A,09/27,2400,TURF",
                "001,A,H1,60,CONC",
                "001,A,18W/36W,12000,WATER",
                "001,H,H1,80,ROOF-TOP",
                "002,A,01/19,5000,PFC",
                "003,A,04/22,3200,GRVL-TRTD",
                "004,A,10/28,4100,TRTD",
                "005,,05/23,3500,ASPH",
            ]
        )

        runways = parse_nasr_runways(io.StringIO(rwy_csv))

        # Grass A strip must ignore on-airport concrete H1 and WATER lane
        self.assertEqual(
            runways[("001", "A")],
            {"longest_runway": 2400, "has_hard_surface": False, "has_water_surface": False, "surface": "S"},
        )
        # Co-located H site stays isolated from A site
        self.assertEqual(
            runways[("001", "H")],
            {"longest_runway": 80, "has_hard_surface": True, "has_water_surface": False, "surface": "H"},
        )
        # Co-located C site with no rows does not fall back to A site
        self.assertNotIn("001", runways)

        # PFC is hard; GRVL-TRTD is soft; standalone TRTD is hard
        self.assertEqual(runways[("002", "A")]["surface"], "H")
        self.assertEqual(runways[("003", "A")]["surface"], "S")
        self.assertEqual(runways[("004", "A")]["surface"], "H")

        # Blank SITE_TYPE_CODE registers SITE_NO fallback
        self.assertEqual(runways["005"]["surface"], "H")
        self.assertEqual(runways["005"]["longest_runway"], 3500)

        # Missing path-like string fails loudly instead of silently returning empty
        with self.assertRaises(FileNotFoundError):
            parse_nasr_runways("nonexistent_apt_rwy.csv")

    def test_parse_nasr_facilities_classification_towers_and_closed_exclusion(self) -> None:
        base_csv = "\n".join(
            [
                "SITE_NO,SITE_TYPE_CODE,ARPT_ID,ICAO_ID,ARPT_NAME,OWNERSHIP_TYPE_CODE,FACILITY_USE_CODE,LAT_DECIMAL,LONG_DECIMAL,ELEV,ARPT_STATUS,FAR_139_TYPE_CODE,FUEL_TYPES,TWR_TYPE_CODE",
                "001,A,E16,KE16,SAN MARTIN,PU,PU,37.08,-121.59,281,O,,100LL,NON-ATCT",
                "002,A,GRASS,,GRASS STRIP,PU,PU,37.10,-121.60,100,O,,,NON-ATCT",
                "003,A,PRIV,,PRIVATE FIELD,PR,PR,37.12,-121.61,150,O,,,NON-ATCT",
                "004,A,NUQ,KNUQ,MOFFETT,MR,PU,37.41,-122.05,32,O,,A,ATCT-TRACON",
                "005,H,JRA,KJRA,WEST 30TH ST,PU,PU,40.75,-74.00,7,O,,A,NON-ATCT",
                "006,H,MH1,,MED HELIPAD,PR,PR,37.20,-121.80,200,O,,,NON-ATCT",
                "007,H,MHL,,MIL HELIPORT,MA,PR,37.21,-121.81,210,O,,,ATCT-RAPCON",
                "008,V,VRT,,VERTIPORT,PU,PU,37.22,-121.82,12,O,,,NON-ATCT",
                "009,C,SEA1,,PUBLIC SEAPLANE,PU,PU,47.60,-122.33,0,O,,,NON-ATCT",
                "010,C,L11,,PEBBLY BEACH,PR,PR,33.33,-118.31,0,O,,,NON-ATCT",
                "011,U,0CL8,,TERA,PR,PR,35.59,-117.63,2510,O,,,NON-ATCT",
                "012,G,CA69,,AVENAL,PR,PR,36.00,-120.14,782,O,,,NON-ATCT",
                "013,B,BAL1,,BALLOON FIELD,PU,PU,35.10,-106.60,5100,O,,,ATCT-A/C",
                "014,A,CLSD,,CLOSED STRIP,PU,PU,37.50,-122.10,10,CI,,100LL,ATCT-RATCF",
                "015,H,CLSP,,CLOSED PAD,PR,PR,37.51,-122.11,10,CP,,,NON-ATCT",
            ]
        )
        rwy_csv = "\n".join(
            [
                "SITE_NO,SITE_TYPE_CODE,RWY_ID,RWY_LEN,SURFACE_TYPE_CODE",
                "001,A,14/32,3095,ASPH",
                "002,A,09/27,2200,GRVL-TRTD",
                "002,A,H1,50,CONC",
                "002,A,18W/36W,9000,WATER",
                "004,A,14L/32R,9200,PFC",
                "010,C,NW/SE,15000,WATER",
            ]
        )

        facs, meta = parse_nasr_facilities(io.StringIO(base_csv), io.StringIO(rwy_csv))
        by_id = {f["id"]: f for f in facs}

        # Closed CI / CP must be excluded from both facilities and metadata
        self.assertNotIn("CLSD", by_id)
        self.assertNotIn("CLSP", by_id)
        self.assertNotIn("CLSD", meta)
        self.assertNotIn("CLSP", meta)

        self.assertEqual(by_id["KE16"]["facility_type"], "civil_hard")
        self.assertFalse(by_id["KE16"]["has_tower"])
        self.assertTrue(by_id["KE16"]["has_fuel"])

        self.assertEqual(by_id["GRASS"]["facility_type"], "civil_soft")
        self.assertEqual(by_id["GRASS"]["longest_runway"], 2200)
        self.assertEqual(by_id["GRASS"]["surface"], "S")

        self.assertEqual(by_id["PRIV"]["facility_type"], "private")

        self.assertEqual(by_id["KNUQ"]["facility_type"], "military")
        self.assertTrue(by_id["KNUQ"]["is_military"])
        self.assertTrue(by_id["KNUQ"]["has_tower"])
        self.assertEqual(by_id["KNUQ"]["surface"], "H")

        self.assertEqual(by_id["KJRA"]["facility_type"], "heliport")
        self.assertFalse(by_id["KJRA"]["is_military"])
        self.assertEqual(by_id["MH1"]["facility_type"], "heliport")
        self.assertEqual(by_id["MHL"]["facility_type"], "heliport")
        self.assertTrue(by_id["MHL"]["is_military"])
        self.assertTrue(by_id["MHL"]["has_tower"])
        self.assertEqual(by_id["VRT"]["facility_type"], "heliport")

        self.assertEqual(by_id["SEA1"]["facility_type"], "seaplane")
        self.assertEqual(by_id["SEA1"]["surface"], "W")
        self.assertEqual(by_id["L11"]["facility_type"], "seaplane_private")
        self.assertEqual(by_id["L11"]["surface"], "W")
        self.assertEqual(by_id["L11"]["longest_runway"], 15000)

        self.assertEqual(by_id["0CL8"]["facility_type"], "ultralight")
        self.assertEqual(by_id["CA69"]["facility_type"], "gliderport")
        self.assertEqual(by_id["BAL1"]["facility_type"], "balloonport")
        self.assertTrue(by_id["BAL1"]["has_tower"])

        # Direct classification checks across ownerships
        self.assertEqual(classify_nasr_facility("H", "PR", "CG", "H"), ("heliport", True))
        self.assertEqual(classify_nasr_facility("A", "PR", "MN", "S"), ("military", True))


class TestCifpNasrMergeAndSearchIndex(unittest.TestCase):
    def test_merge_heliport_pads_ranking_caps_and_cifp_fallbacks(self) -> None:
        nasr_facilities = [
            {
                "id": "KSFO",
                "arpt_id": "SFO",
                "icao_id": "KSFO",
                "name": "SAN FRANCISCO INTL",
                "lat": 37.62,
                "lon": -122.37,
                "elevation": 13.0,
                "facility_use": "PU",
                "longest_runway": 11870,
                "surface": "H",
                "facility_type": "civil_hard",
                "is_military": False,
                "has_fuel": True,
                "has_tower": True,
                "far_139": "I E S",
            },
            {
                "id": "KJRA",
                "name": "WEST 30TH ST",
                "lat": 40.75,
                "lon": -74.00,
                "elevation": 7.0,
                "facility_use": "PU",
                "longest_runway": 45,
                "surface": "H",
                "facility_type": "heliport",
                "is_military": False,
                "has_fuel": True,
                "has_tower": False,
                "far_139": "",
            },
            {
                "id": "S76",
                "name": "BROOKS SEAPLANE",
                "lat": 47.70,
                "lon": -116.80,
                "elevation": 2128.0,
                "facility_use": "PU",
                "longest_runway": 15000,
                "surface": "W",
                "facility_type": "seaplane",
                "is_military": False,
                "has_fuel": False,
                "has_tower": False,
                "far_139": "",
            },
            {
                "id": "L11",
                "name": "PEBBLY BEACH",
                "lat": 33.33,
                "lon": -118.31,
                "elevation": 0.0,
                "facility_use": "PR",
                "longest_runway": 15000,
                "surface": "W",
                "facility_type": "seaplane_private",
                "is_military": False,
                "has_fuel": False,
                "has_tower": False,
                "far_139": "",
            },
            {
                "id": "CA69",
                "name": "AVENAL",
                "lat": 36.00,
                "lon": -120.14,
                "elevation": 782.0,
                "facility_use": "PR",
                "longest_runway": 8000,
                "surface": "S",
                "facility_type": "gliderport",
                "is_military": False,
                "has_fuel": False,
                "has_tower": False,
                "far_139": "",
            },
        ]

        cifp_airports = [
            _DummyCifpRecord(
                {
                    "airport_id": "KSFO",
                    "airport_name": "SAN FRANCISCO INTL",
                    "lat": 37.62,
                    "lon": -122.37,
                    "elevation": 13.0,
                    "longest_surface": "H",
                    "usage": "C",
                    "longest": 11870,
                    "is_ifr": True,
                }
            ),
            _DummyCifpRecord(
                {
                    "airport_id": "SFO",
                    "airport_name": "SAN FRANCISCO INTL",
                    "lat": 37.62,
                    "lon": -122.37,
                    "elevation": 13.0,
                    "longest_surface": "H",
                    "usage": "C",
                    "longest": 11870,
                    "is_ifr": True,
                }
            ),
            _DummyCifpRecord(
                {
                    "airport_id": "XNON",
                    "airport_name": "CIFP ONLY FIELD",
                    "lat": 38.0,
                    "lon": -121.0,
                    "elevation": 50.0,
                    "longest_surface": "H",
                    "usage": "C",
                    "longest": 5000,
                    "is_ifr": True,
                }
            ),
        ]
        cifp_heliports = [
            _DummyCifpRecord(None, has_primary_flag=False),
            _DummyCifpRecord(
                {
                    "heliport_id": "KJRA",
                    "heliport_name": "WEST 30TH ST",
                    "lat": 40.75,
                    "lon": -74.00,
                    "elevation": 7.0,
                    "usage": "C",
                    "is_ifr": False,
                }
            ),
            _DummyCifpRecord(
                {
                    "heliport_id": "KJRA",
                    "heliport_name": "WEST 30TH ST",
                    "lat": 40.75,
                    "lon": -74.00,
                    "elevation": 7.0,
                    "usage": "C",
                    "is_ifr": True,
                }
            ),
            _DummyCifpRecord(
                {
                    "heliport_id": "XHLP",
                    "heliport_name": "CIFP ONLY PAD",
                    "lat": 39.0,
                    "lon": -120.0,
                    "elevation": 100.0,
                    "usage": "P",
                    "is_ifr": False,
                }
            ),
        ]

        feats, fixes = build_airport_features(cifp_airports, cifp_heliports, nasr_facilities, {})

        # FAR 139 "I E S" -> rank 1, minzoom 0
        self.assertEqual(feats["KSFO"]["properties"]["rank"], 1)
        self.assertEqual(feats["KSFO"]["tippecanoe"]["minzoom"], 0)
        self.assertTrue(feats["KSFO"]["properties"]["is_ifr"])

        # Multi-pad heliport boolean-ORs is_ifr across H1/H2
        self.assertEqual(feats["KJRA"]["properties"]["facility_type"], "heliport")
        self.assertTrue(feats["KJRA"]["properties"]["is_ifr"])
        self.assertEqual(feats["KJRA"]["properties"]["rank"], 3)
        self.assertEqual(feats["KJRA"]["tippecanoe"]["minzoom"], 4)

        # 15,000' water lanes must NOT leak into rank 2
        self.assertEqual(feats["S76"]["properties"]["rank"], 3)
        self.assertEqual(feats["L11"]["properties"]["rank"], 4)

        # Private 8,000' gliderport stays rank 5 (minzoom 7 <= 10)
        self.assertEqual(feats["CA69"]["properties"]["rank"], 5)
        self.assertEqual(feats["CA69"]["tippecanoe"]["minzoom"], 7)
        self.assertLessEqual(feats["CA69"]["tippecanoe"]["minzoom"], 10)

        # CIFP-only fallbacks retained
        self.assertEqual(feats["XNON"]["properties"]["facility_type"], "civil_hard")
        self.assertEqual(feats["XHLP"]["properties"]["facility_type"], "heliport")
        self.assertEqual(feats["XHLP"]["properties"]["rank"], 5)

        # Canonical IDs only in fixes (no stripped 3-letter SFO/JRA aliases or duplicate fallback)
        self.assertIn("KSFO", fixes)
        self.assertNotIn("SFO", fixes)
        self.assertNotIn("SFO", feats)
        self.assertIn("KJRA", fixes)
        self.assertNotIn("JRA", fixes)

        for rank, mz in RANK_MINZOOM.items():
            self.assertLessEqual(mz, 10)
        self.assertEqual(compute_airport_rank("KXYZ", "civil_hard", "PU", 5000, False, "", False, False), 3)

    def test_build_search_index_seeds_nasr_and_preserves_navaid_precedence(self) -> None:
        base_csv = "\n".join(
            [
                "SITE_NO,SITE_TYPE_CODE,ARPT_ID,ICAO_ID,ARPT_NAME,OWNERSHIP_TYPE_CODE,FACILITY_USE_CODE,LAT_DECIMAL,LONG_DECIMAL,ELEV,ARPT_STATUS,FAR_139_TYPE_CODE,FUEL_TYPES,TWR_TYPE_CODE",
                "001,A,SJC,KSJC,SAN JOSE INTL,PU,PU,37.36,-121.92,62,O,I D,100LL,ATCT",
                "002,H,JRA,KJRA,WEST 30TH ST,PU,PU,40.75,-74.00,7,O,,,NON-ATCT",
                "003,U,0CL8,,TERA,PR,PR,35.59,-117.63,2510,O,,,NON-ATCT",
                "004,H,MHM,,MINCHUMINA HELIPORT,PR,PR,63.88,-152.30,680,O,,,NON-ATCT",
                "005,A,CLSD,,CLOSED FIELD,PU,PU,37.50,-122.10,10,CI,,,NON-ATCT",
            ]
        )
        nasr_facilities, _ = parse_nasr_facilities(io.StringIO(base_csv))

        mock_cifp = MagicMock()
        mock_cifp.get_airports.return_value = [
            _DummyCifpRecord({"airport_id": "KSJC", "airport_name": "SAN JOSE INTL", "lat": 37.36, "lon": -121.92}),
        ]
        mock_cifp.get_heliports.return_value = [
            _DummyCifpRecord(None, has_primary_flag=False),
            _DummyCifpRecord({"heliport_id": "KJRA", "heliport_name": "WEST 30TH ST", "lat": 40.75, "lon": -74.00}),
        ]
        mock_cifp.get_vhf_navaids.return_value = [
            _DummyCifpRecord({"vhf_id": "SJC", "vhf_name": "SAN JOSE", "lat": 37.37, "lon": -121.93}),
        ]
        mock_cifp.get_ndb_navaids.return_value = [
            _DummyCifpRecord({"ndb_id": "MHM", "ndb_name": "MINCHUMINA NDB", "lat": 63.88, "lon": -152.31}),
        ]
        mock_cifp.get_enroute_waypoints.return_value = []
        mock_cifp.get_terminal_waypoints.return_value = []
        mock_cifp.get_procedures.return_value = []
        mock_cifp.get_airway_points.return_value = []

        with tempfile.TemporaryDirectory() as tmpdir:
            fac_path = os.path.join(tmpdir, "nasr_facilities.json")
            out_path = os.path.join(tmpdir, "search_index.json")
            with open(fac_path, "w") as f:
                json.dump(nasr_facilities, f)

            with patch("src.search.build_index.CIFP", return_value=mock_cifp):
                index_data = build_search_index(
                    cifp_path="DUMMY",
                    output_path=out_path,
                    nasr_facilities_path=fac_path,
                )

            fixes = index_data["fixes"]
            self.assertEqual(fixes["KJRA"]["type"], "airport")
            self.assertEqual(fixes["0CL8"]["type"], "airport")
            self.assertEqual(fixes["KSJC"]["type"], "airport")
            self.assertEqual(fixes["SJC"]["type"], "navaid")
            self.assertEqual(fixes["MHM"]["type"], "navaid")
            self.assertNotIn("CLSD", fixes)

    def test_classify_vhf_navaid_columns(self) -> None:
        self.assertEqual(classify_vhf_navaid("VTHW "), ("vortac", 2))
        self.assertEqual(classify_vhf_navaid("VTLA "), ("vortac", 3))
        self.assertEqual(classify_vhf_navaid("VDHW "), ("vordme", 2))
        self.assertEqual(classify_vhf_navaid("VDTW "), ("vordme", 4))
        self.assertEqual(classify_vhf_navaid("V LW "), ("vor", 3))
        self.assertEqual(classify_vhf_navaid("V TW "), ("vor", 4))
        self.assertEqual(classify_vhf_navaid(" TLW "), ("tacan", 3))
        self.assertEqual(classify_vhf_navaid(" MTW "), ("tacan", 4))
        self.assertEqual(classify_vhf_navaid(" DHW "), ("dme", 2))
        self.assertEqual(classify_vhf_navaid(" DLW "), ("dme", 3))
        self.assertEqual(classify_vhf_navaid(" DUW "), ("dme", 5))
        self.assertEqual(classify_vhf_navaid(" ITW "), ("dme", 5))

    def test_classify_waypoint_arinc_types_and_ranks(self) -> None:
        self.assertEqual(classify_waypoint("C  ", " L"), ("compulsory", 4))
        self.assertEqual(classify_waypoint("C  ", " H"), ("compulsory", 3))
        self.assertEqual(classify_waypoint("W  ", None), ("rnav", 6))
        self.assertEqual(classify_waypoint("W  ", " H"), ("rnav", 4))
        self.assertEqual(classify_waypoint(" W ", None), ("rnav", 6))
        self.assertEqual(classify_waypoint("V  ", None), ("vfr", 6))
        self.assertEqual(classify_waypoint(" V ", None), ("named", 6))
        self.assertEqual(classify_waypoint("R  ", " L"), ("named", 6))
        self.assertEqual(classify_waypoint("R  ", " B"), ("named", 5))
        self.assertEqual(classify_waypoint("A  ", None), ("named", 6))


if __name__ == "__main__":
    unittest.main()
