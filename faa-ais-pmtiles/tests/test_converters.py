import io
import json
import os
import tempfile
import unittest
import zipfile
from unittest.mock import MagicMock, patch

import geopandas as gpd
import pyproj

from src.adds.convert import (
    convert_airspaces,
    convert_boundary_airspace,
    convert_mode_c,
    convert_obstacles,
    convert_sua,
    normalize_boundary_limit,
)
from src.cifp.convert import (
    RANK_MINZOOM,
    build_airport_features,
    build_grid_mora_features,
    build_pmtiles_fgb,
    compute_airport_rank,
    format_mora_parts,
    parse_mora_coord,
)
from src.common.utils import parse_altitude
from src.nasr import fetch as nasr_fetch
from src.nasr.facilities import classify_nasr_facility, parse_nasr_facilities, parse_nasr_runways
from src.nasr.pja import convert_pja, parse_pja_csv
from src.search.build_index import build_search_index
from src.vfr import fetch as vfr_fetch
from src.vfr.mtr import convert_mtrs
from src.vfr.passes import convert_passes, parse_elevation_ft
from src.vfr.powerlines import convert_powerlines
from src.vfr.wind_farms import convert_wind_farms


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
        self.assertEqual(normalize_boundary_limit(0, "FT", "HEI"), "SFC")
        self.assertEqual(normalize_boundary_limit(0, None, "hei"), "SFC")
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
        self.assertEqual(normalize_boundary_limit(500, "FT", "HEI"), "500 AGL")
        self.assertEqual(normalize_boundary_limit(1500.5, "FT", "hei"), "1500.5 AGL")
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


class TestSuaAltitudeNormalization(unittest.TestCase):
    def test_parse_altitude_handles_sfc_agl_fl_and_unl(self) -> None:
        self.assertEqual(parse_altitude("SFC"), 0.0)
        self.assertEqual(parse_altitude("GND"), 0.0)
        self.assertEqual(parse_altitude("500 AGL"), 500.0)
        self.assertEqual(parse_altitude("1200 MSL"), 1200.0)
        self.assertEqual(parse_altitude("FL180"), 18000.0)
        self.assertGreater(parse_altitude("UNL"), 60000.0)

    def test_convert_sua_normalizes_fl_unltd_and_agl_limits(self) -> None:
        sua_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-121.5, 36.5], [-121.0, 36.5], [-121.0, 37.0], [-121.5, 36.5]]],
                    },
                    "properties": {
                        "NAME": "A-632A",
                        "TYPE_CODE": "A",
                        "UPPER_VAL": "180",
                        "UPPER_UOM": "FL",
                        "UPPER_CODE": "STD",
                        "LOWER_VAL": "6000",
                        "LOWER_UOM": "FT",
                        "LOWER_CODE": "MSL",
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-120.5, 36.5], [-120.0, 36.5], [-120.0, 37.0], [-120.5, 36.5]]],
                    },
                    "properties": {
                        "NAME": "R-2202D",
                        "TYPE_CODE": "R",
                        "UPPER_VAL": "-9998",
                        "UPPER_UOM": None,
                        "UPPER_CODE": "UNLTD",
                        "LOWER_VAL": "310",
                        "LOWER_UOM": "FL",
                        "LOWER_CODE": "STD",
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[-119.5, 36.5], [-119.0, 36.5], [-119.0, 37.0], [-119.5, 36.5]]],
                    },
                    "properties": {
                        "NAME": "AVON EAST MOA",
                        "TYPE_CODE": "MOA",
                        "UPPER_VAL": "14000",
                        "UPPER_UOM": "FT",
                        "UPPER_CODE": "MSL",
                        "LOWER_VAL": "500",
                        "LOWER_UOM": "FT",
                        "LOWER_CODE": "SFC",
                    },
                },
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            sua_path = os.path.join(tmpdir, "sua_raw.geojson")
            with open(sua_path, "w") as f:
                json.dump(sua_geojson, f)

            feats = convert_sua(sua_path=sua_path)
            self.assertEqual(len(feats), 3)

            p0 = feats[0]["properties"]
            self.assertEqual(p0["upper_limit"], "FL180")
            self.assertEqual(p0["lower_limit"], "6000")
            self.assertAlmostEqual(p0["upper_m"], 18000.0 * 0.3048)
            self.assertAlmostEqual(p0["lower_m"], 6000.0 * 0.3048)

            p1 = feats[1]["properties"]
            self.assertEqual(p1["upper_limit"], "UNL")
            self.assertEqual(p1["lower_limit"], "FL310")
            self.assertGreater(p1["upper_m"], p1["lower_m"])

            p2 = feats[2]["properties"]
            self.assertEqual(p2["lower_limit"], "500 AGL")
            self.assertAlmostEqual(p2["lower_m"], 500.0 * 0.3048)
            self.assertGreater(p2["upper_m"], p2["lower_m"])


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
                    self.assertTrue(os.path.exists("data/nasr_facilities.json"))
                    self.assertTrue(os.path.exists("data/nasr_vfr_fixes.json"))
                    self.assertTrue(os.path.exists("data/nasr_mtr_raw.json"))

                    with open("data/nasr_vfr_fixes.json") as f:
                        self.assertEqual(json.load(f), {"vfr_waypoints": [], "sectional_fixes": []})
                    with open("data/nasr_mtr_raw.json") as f:
                        self.assertEqual(json.load(f), {"routes": {}, "points": {}})

                    with open("data/pja_raw.geojson") as f:
                        pja_fc = json.load(f)
                    self.assertEqual(len(pja_fc["features"]), 1)
                    self.assertEqual(pja_fc["features"][0]["properties"]["ident"], "PJA1")

                    # Cache hit when all 6 files exist
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

                    # Remove nasr_vfr_fixes.json -> must re-download instead of skipping
                    os.remove("data/nasr_vfr_fixes.json")
                    nasr_fetch.get_airport_metadata()
                    self.assertEqual(mock_get.call_count, 4)
                    self.assertTrue(os.path.exists("data/nasr_vfr_fixes.json"))

                    # Remove nasr_mtr_raw.json -> must re-download instead of skipping
                    os.remove("data/nasr_mtr_raw.json")
                    nasr_fetch.get_airport_metadata()
                    self.assertEqual(mock_get.call_count, 5)
                    self.assertTrue(os.path.exists("data/nasr_mtr_raw.json"))
            finally:
                os.chdir(orig_cwd)

    def test_parse_nasr_fixes_csv_and_mtr_csvs(self) -> None:
        fixes_csv = "\n".join(
            [
                "FIX_ID,LAT_DECIMAL,LONG_DECIMAL,FIX_USE_CODE,CHARTS,STATE_CODE,COMPULSORY,NAME",
                "VPBAY,37.80,-122.40,VFR,SAN FRANCISCO TERMINAL AREA,CA,N,BAY BRIDGE",
                "VPCOM,37.70,-122.30,VFR,SECTIONAL,CA,Y,",
                "SECFX,37.60,-122.20,RP,VFR Flyway Planning,CA,LOW/HIGH,SOUTH TOWER",
                "HELIFX,37.50,-122.10,CN,Helicopter Route,CA,NONE,HELI PT",
                "ENRTX,37.40,-122.00,RP,ENROUTE LOW,CA,N,IGNORED",
                ",37.30,-121.90,VFR,SECTIONAL,CA,N,MISSING ID",
                "BADCO,, -121.80,VFR,SECTIONAL,CA,N,BAD COORDS",
            ]
        )
        parsed_fixes = nasr_fetch.parse_nasr_fixes_csv(io.StringIO(fixes_csv))
        self.assertEqual(len(parsed_fixes["vfr_waypoints"]), 2)
        self.assertEqual(parsed_fixes["vfr_waypoints"][0]["id"], "VPBAY")
        self.assertEqual(parsed_fixes["vfr_waypoints"][0]["name"], "BAY BRIDGE")
        self.assertFalse(parsed_fixes["vfr_waypoints"][0]["compulsory"])
        self.assertEqual(parsed_fixes["vfr_waypoints"][1]["id"], "VPCOM")
        self.assertTrue(parsed_fixes["vfr_waypoints"][1]["compulsory"])
        self.assertNotIn("name", parsed_fixes["vfr_waypoints"][1])

        self.assertEqual([f["id"] for f in parsed_fixes["sectional_fixes"]], ["SECFX", "HELIFX"])
        self.assertEqual(parsed_fixes["sectional_fixes"][0]["fix_use"], "RP")
        self.assertTrue(parsed_fixes["sectional_fixes"][0]["compulsory"])
        self.assertFalse(parsed_fixes["sectional_fixes"][1]["compulsory"])
        self.assertEqual(parsed_fixes["sectional_fixes"][1]["name"], "HELI PT")

        mtr_base_csv = "\n".join(
            [
                "ROUTE_TYPE_CODE,ROUTE_ID,ARTCC,FSS,TIME_OF_USE",
                "VR,1205,ZOA,OAK,SR-SS",
                "IR,,ZLA,LAX,CONT",
            ]
        )
        mtr_pt_csv = "\n".join(
            [
                "ROUTE_TYPE_CODE,ROUTE_ID,ROUTE_PT_SEQ,LAT_DECIMAL,LONG_DECIMAL,ROUTE_PT_ID,SEGMENT_TEXT",
                "VR,1205,20,37.50,-120.50,B,SEG B",
                "VR,1205,5,37.20,-120.80,A,SEG A",
                "VR,1205,10,bad,-120.70,BAD,SKIP",
                "VR,,1,37.00,-120.00,NOID,SKIP",
            ]
        )
        parsed_mtr = nasr_fetch.parse_nasr_mtr_csvs(io.StringIO(mtr_base_csv), io.StringIO(mtr_pt_csv))
        self.assertEqual(
            parsed_mtr["routes"],
            {"VR1205": {"mtr_type": "VR", "artcc": "ZOA", "fss": "OAK", "time_of_use": "SR-SS"}},
        )
        self.assertEqual([pt["pt_id"] for pt in parsed_mtr["points"]["VR1205"]], ["A", "B"])
        self.assertEqual([pt["seq"] for pt in parsed_mtr["points"]["VR1205"]], [5, 20])

        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w") as z:
            z.writestr("APT_BASE.csv", "ARPT_ID,ICAO_ID,FUEL_TYPES,TWR_TYPE_CODE,FAR_139_TYPE_CODE\nSJC,KSJC,100LL,ATCT,I\n")
            z.writestr("FIX_BASE.csv", fixes_csv)
            z.writestr("MTR_BASE.csv", mtr_base_csv)
            z.writestr("MTR_PT.csv", mtr_pt_csv)

        mock_resp = MagicMock()
        mock_resp.content = zip_buf.getvalue()
        mock_resp.raise_for_status = MagicMock()

        orig_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                os.chdir(tmpdir)
                with (
                    patch("src.nasr.fetch.find_latest_csv_zip_url", return_value=("https://example.test/nasr.zip", "2026-10-29")),
                    patch("src.nasr.fetch.requests.get", return_value=mock_resp),
                ):
                    nasr_fetch.get_airport_metadata()
                    loaded_vfr = nasr_fetch.load_nasr_vfr_fixes()
                    loaded_mtr = nasr_fetch.load_nasr_mtr_data()
                    self.assertEqual(len(loaded_vfr["vfr_waypoints"]), 2)
                    self.assertEqual(len(loaded_vfr["sectional_fixes"]), 2)
                    self.assertIn("VR1205", loaded_mtr["routes"])
                    self.assertEqual(len(loaded_mtr["points"]["VR1205"]), 2)
            finally:
                os.chdir(orig_cwd)


class _DummyPrimary:
    def __init__(self, primary: dict) -> None:
        self._primary = primary

    def to_dict(self) -> dict:
        return self._primary


class _DummyCifpRecord:
    def __init__(self, primary: dict | None, has_primary_flag: bool = True) -> None:
        self._primary = primary
        self._has_primary = has_primary_flag
        self.primary = _DummyPrimary(primary) if (has_primary_flag and primary is not None) else None

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
            _DummyCifpRecord(None, has_primary_flag=False),
            _DummyCifpRecord({"vhf_id": "SJC", "vhf_name": "SAN JOSE", "lat": 37.37, "lon": -121.93}),
        ]
        mock_cifp.get_ndb_navaids.return_value = [
            _DummyCifpRecord(None, has_primary_flag=False),
            _DummyCifpRecord({"ndb_id": "MHM", "ndb_name": "MINCHUMINA NDB", "lat": 63.88, "lon": -152.31}),
        ]
        mock_cifp.get_enroute_waypoints.return_value = []
        mock_cifp.get_terminal_waypoints.return_value = []
        mock_cifp.get_procedures.return_value = [_DummyCifpRecord(None, has_primary_flag=False)]
        mock_cifp.get_airway_points.return_value = [_DummyCifpRecord(None, has_primary_flag=False)]

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
                    nasr_vfr_path="",
                )

            fixes = index_data["fixes"]
            self.assertEqual(fixes["KJRA"]["type"], "airport")
            self.assertEqual(fixes["0CL8"]["type"], "airport")
            self.assertEqual(fixes["KSJC"]["type"], "airport")
            self.assertEqual(fixes["SJC"]["type"], "navaid")
            self.assertEqual(fixes["MHM"]["type"], "navaid")
            self.assertNotIn("CLSD", fixes)

    def test_build_search_index_vfr_vs_nrs_and_nasr_vfr_merge(self) -> None:
        mock_cifp = MagicMock()
        mock_cifp.get_airports.return_value = []
        mock_cifp.get_heliports.return_value = []
        mock_cifp.get_vhf_navaids.return_value = []
        mock_cifp.get_ndb_navaids.return_value = []
        mock_cifp.get_enroute_waypoints.return_value = [
            _DummyCifpRecord({"waypoint_id": "VPVFR", "lat": 37.81, "lon": -122.48, "type": "V  "}),
            _DummyCifpRecord({"waypoint_id": "NRSIX", "lat": 38.10, "lon": -121.50, "type": " V "}),
            _DummyCifpRecord({"waypoint_id": "CMPFX", "lat": 37.50, "lon": -122.00, "type": "C  "}),
        ]
        mock_cifp.get_terminal_waypoints.return_value = [
            _DummyCifpRecord(None, has_primary_flag=False),
            _DummyCifpRecord({"waypoint_id": "TRVFR", "lat": 37.60, "lon": -122.30, "type": "VFR"}),
        ]
        mock_cifp.get_procedures.return_value = []
        mock_cifp.get_airway_points.return_value = []

        nasr_vfr_stub = {
            "vfr_waypoints": [
                {"id": "VPVFR", "lat": 37.81, "lon": -122.48, "name": "SHOULD NOT OVERWRITE CIFP"},
                {"id": "NASVP", "lat": 37.45, "lon": -121.95, "name": "COYOTE CREEK"},
            ],
            "sectional_fixes": [
                {"id": "SEC01", "lat": 37.30, "lon": -121.80, "name": "ALUM ROCK"},
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            fac_path = os.path.join(tmpdir, "nasr_facilities.json")
            vfr_path = os.path.join(tmpdir, "nasr_vfr_fixes.json")
            out_path = os.path.join(tmpdir, "search_index.json")
            with open(fac_path, "w") as f:
                json.dump([], f)
            with open(vfr_path, "w") as f:
                json.dump(nasr_vfr_stub, f)

            with patch("src.search.build_index.CIFP", return_value=mock_cifp):
                index_data = build_search_index(
                    cifp_path="DUMMY",
                    output_path=out_path,
                    nasr_facilities_path=fac_path,
                    nasr_vfr_path=vfr_path,
                )

            fixes = index_data["fixes"]
            self.assertEqual(fixes["VPVFR"]["type"], "vfr")
            self.assertNotIn("name", fixes["VPVFR"])
            self.assertEqual(fixes["TRVFR"]["type"], "vfr")
            self.assertEqual(fixes["NRSIX"]["type"], "waypoint")
            self.assertEqual(fixes["CMPFX"]["type"], "compulsory")
            self.assertEqual(fixes["NASVP"], {"lat": 37.45, "lon": -121.95, "type": "vfr", "name": "COYOTE CREEK"})
            self.assertNotIn("SEC01", fixes)


class TestGridMoraAndCifpVfrWaypoints(unittest.TestCase):
    def test_parse_mora_coord_and_format_parts(self) -> None:
        self.assertEqual(parse_mora_coord("N36", "W090"), (36, -90))
        self.assertEqual(parse_mora_coord("S29", "E150"), (-29, 150))
        self.assertEqual(parse_mora_coord(" n00 ", " e000 "), (0, 0))
        self.assertEqual(parse_mora_coord("N90", "W180"), (90, -180))

        for bad_lat, bad_lon in [
            ("", "W090"),
            ("N", "W090"),
            ("X36", "W090"),
            ("N36", "Z090"),
            ("N91", "W090"),
            ("N36", "E181"),
            ("NXX", "W090"),
        ]:
            with self.assertRaises(ValueError):
                parse_mora_coord(bad_lat, bad_lon)

        with self.assertRaises(ValueError):
            parse_mora_coord(None, "W090")  # type: ignore[arg-type]

        self.assertEqual(format_mora_parts(3500), ("3", "5", "35"))
        self.assertEqual(format_mora_parts(14000), ("14", "0", "140"))
        self.assertEqual(format_mora_parts(800), ("0", "8", "08"))
        self.assertEqual(format_mora_parts(14900), ("14", "9", "149"))

    def test_build_grid_mora_features_dedup_high_and_antimeridian(self) -> None:
        moras = [
            _DummyCifpRecord(None, has_primary_flag=False),
            _DummyCifpRecord({"start_lat": "", "start_lon": "W090", "mora_1": 3000}),
            _DummyCifpRecord(
                {
                    "start_lat": "N36",
                    "start_lon": "W090",
                    "mora_1": 5200,
                    "mora_2": 14500,
                    "mora_3": "UNK",
                    "mora_4": 0,
                    "mora_5": -100,
                }
            ),
            _DummyCifpRecord(
                {
                    "start_lat": "S10",
                    "start_lon": "E179",
                    "mora_1": 4000,
                    "mora_2": 14000,
                }
            ),
        ]

        line_features, label_features = build_grid_mora_features(moras)
        self.assertEqual(len(label_features), 4)

        by_cell = {f["properties"]["cell_id"]: f for f in label_features}
        c1 = by_cell["N36W090"]
        self.assertEqual(c1["geometry"]["coordinates"], [-89.5, 36.5])
        self.assertEqual(c1["properties"]["display"], "52")
        self.assertFalse(c1["properties"]["is_high"])
        self.assertEqual(c1["properties"]["rank"], 1)

        c2 = by_cell["N36W089"]
        self.assertEqual(c2["geometry"]["coordinates"], [-88.5, 36.5])
        self.assertEqual(c2["properties"]["thousands"], "14")
        self.assertEqual(c2["properties"]["hundreds"], "5")
        self.assertEqual(c2["properties"]["display"], "145")
        self.assertTrue(c2["properties"]["is_high"])

        # Anti-meridian wrap at E179 + 1 -> W180
        self.assertIn("S10E179", by_cell)
        self.assertIn("S10W180", by_cell)
        self.assertEqual(by_cell["S10W180"]["geometry"]["coordinates"], [-179.5, -9.5])
        self.assertTrue(by_cell["S10W180"]["properties"]["is_high"])

        # Two adjacent cells in N36 share 1 vertical edge -> 7 unique edges; E179 & W180 don't share coords after wrap -> 8 edges
        # Total = 15 deduplicated LineStrings; shared edge (-89, 36)->(-89, 37) must inherit is_high=True
        self.assertEqual(len(line_features), 15)
        shared = [f for f in line_features if sorted(tuple(pt) for pt in f["geometry"]["coordinates"]) == [(-89, 36), (-89, 37)]]
        self.assertEqual(len(shared), 1)
        self.assertTrue(shared[0]["properties"]["is_high"])

    def test_build_pmtiles_fgb_vfr_vs_nrs_separation(self) -> None:
        mock_cifp = MagicMock()
        mock_cifp.get_airports.return_value = []
        mock_cifp.get_heliports.return_value = []
        mock_cifp.get_vhf_navaids.return_value = [_DummyCifpRecord(None, has_primary_flag=False)]
        mock_cifp.get_ndb_navaids.return_value = [_DummyCifpRecord(None, has_primary_flag=False)]
        mock_cifp.get_enroute_waypoints.return_value = [
            _DummyCifpRecord({"waypoint_id": "VPBAY", "lat": 37.80, "lon": -122.40, "type": "V  ", "name_description": "CIFP BAY"}),
            _DummyCifpRecord(
                {"waypoint_id": "NRSPT", "lat": 38.00, "lon": -121.00, "type": " V ", "usage": "H", "name_description": "NRS PT"}
            ),
        ]
        mock_cifp.get_terminal_waypoints.return_value = [
            _DummyCifpRecord(
                {"waypoint_id": "RNAVX", "lat": 37.50, "lon": -122.10, "type": "R  ", "usage": "L", "name_description": "RNAV PT"}
            ),
            _DummyCifpRecord(
                {"waypoint_id": "SEC01", "lat": 37.30, "lon": -121.80, "type": "C  ", "usage": "L", "name_description": "ALUM ROCK"}
            ),
        ]
        mock_cifp.get_procedures.return_value = [_DummyCifpRecord(None, has_primary_flag=False)]
        mock_cifp.get_airway_points.return_value = [_DummyCifpRecord(None, has_primary_flag=False)]
        mock_cifp.get_runways.return_value = [_DummyCifpRecord(None, has_primary_flag=False)]
        mock_cifp.get_loc_gss.return_value = [_DummyCifpRecord(None, has_primary_flag=False)]
        mock_cifp.get_moras.return_value = [
            _DummyCifpRecord({"start_lat": "N37", "start_lon": "W123", "mora_1": 6500}),
        ]

        nasr_vfr_stub = {
            "vfr_waypoints": [
                {"id": "VPBAY", "lat": 37.80, "lon": -122.40, "name": "BAY BRIDGE", "charts": "SAN FRANCISCO", "state": "CA"},
                {
                    "id": "NASVP",
                    "lat": 37.45,
                    "lon": -121.95,
                    "name": "COYOTE",
                    "charts": "SAN FRANCISCO",
                    "state": "CA",
                    "compulsory": True,
                },
            ],
            "sectional_fixes": [
                {"id": "SEC01", "lat": 37.30, "lon": -121.80, "name": "ALUM ROCK", "charts": "SECTIONAL", "state": "CA"},
            ],
        }

        orig_cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                os.chdir(tmpdir)
                with (
                    patch("src.cifp.convert.CIFP", return_value=mock_cifp),
                    patch("src.cifp.convert.load_nasr_metadata", return_value={}),
                    patch("src.cifp.convert.load_nasr_facilities", return_value=[]),
                    patch("src.cifp.convert.load_nasr_vfr_fixes", return_value=nasr_vfr_stub),
                ):
                    build_pmtiles_fgb("DUMMY")

                wpt_gdf = gpd.read_file("data/waypoints.fgb", engine="pyogrio")
                vfr_gdf = gpd.read_file("data/vfr_waypoints.fgb", engine="pyogrio")
                mora_lines = gpd.read_file("data/grid_mora_lines.fgb", engine="pyogrio")
                mora_labels = gpd.read_file("data/grid_mora_labels.fgb", engine="pyogrio")

                # NRS " V " stays in waypoints.fgb as named; "V  " does NOT leak into waypoints.fgb
                self.assertEqual(set(wpt_gdf["id"]), {"NRSPT", "RNAVX", "SEC01"})
                nrs_row = wpt_gdf[wpt_gdf["id"] == "NRSPT"].iloc[0]
                self.assertEqual(nrs_row["type"], "named")

                # VPBAY is enriched from NASR and deduplicated; NASVP & SEC01 are appended
                self.assertEqual(set(vfr_gdf["id"]), {"VPBAY", "NASVP", "SEC01"})
                vpbay_row = vfr_gdf[vfr_gdf["id"] == "VPBAY"].iloc[0]
                self.assertEqual(vpbay_row["type"], "vfr")
                self.assertEqual(vpbay_row["name"], "BAY BRIDGE")
                self.assertEqual(vpbay_row["charts"], "SAN FRANCISCO")
                self.assertEqual(vpbay_row["rank"], 3)

                nasvp_row = vfr_gdf[vfr_gdf["id"] == "NASVP"].iloc[0]
                self.assertEqual(nasvp_row["type"], "vfr")
                self.assertTrue(bool(nasvp_row["compulsory"]))

                sec_row = vfr_gdf[vfr_gdf["id"] == "SEC01"].iloc[0]
                self.assertEqual(sec_row["type"], "sectional_fix")
                self.assertTrue(bool(sec_row["compulsory"]))
                self.assertEqual(sec_row["rank"], 4)

                self.assertEqual(len(mora_lines), 4)
                self.assertEqual(len(mora_labels), 1)
                self.assertEqual(mora_labels.iloc[0]["cell_id"], "N37W123")
            finally:
                os.chdir(orig_cwd)


class TestVfrMtrConversion(unittest.TestCase):
    def test_convert_mtrs_backfill_and_corridor_edge_cases(self) -> None:
        adds_geojson = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-120.0, 36.0], [-119.5, 36.0]]},
                    "properties": {
                        "MTR_TYPE": 1,
                        "IDENT": "100",
                        "LOWER_VAL": 0,
                        "LOWER_UOM": "FT",
                        "LOWER_CODE": "HEI",
                        "UPPER_VAL": 1500,
                        "UPPER_UOM": "FT",
                        "UPPER_CODE": "HEI",
                        "WIDTHLEFT": 0,
                        "WIDTHRIGHT": 0,
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-121.0, 38.0], [-120.5, 38.0]]},
                    "properties": {
                        "MTR_TYPE": "VR",
                        "IDENT": "VR101",
                        "LOWER_VAL": 500,
                        "LOWER_UOM": "FT",
                        "LOWER_CODE": "SFC",
                        "UPPER_VAL": 5000,
                        "UPPER_UOM": "FT",
                        "UPPER_CODE": "MSL",
                        "WIDTHLEFT": 5,
                        "WIDTHRIGHT": 0,
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-122.0, 36.0], [-121.5, 36.0]]},
                    "properties": {
                        "MTR_TYPE": 2,
                        "IDENT": "202",
                        "LOWER_VAL": 0,
                        "LOWER_UOM": "FT",
                        "LOWER_CODE": "SFC",
                        "UPPER_VAL": 3000,
                        "UPPER_UOM": "FT",
                        "UPPER_CODE": "MSL",
                        "WIDTHLEFT": 0,
                        "WIDTHRIGHT": 4,
                    },
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-120.0, 37.0], [-119.5, 37.0]]},
                    "properties": {
                        "MTR_TYPE": 0,
                        "IDENT": "IR303",
                        "LOWER_VAL": 1000,
                        "LOWER_UOM": "FT",
                        "LOWER_CODE": "MSL",
                        "UPPER_VAL": 12000,
                        "UPPER_UOM": "FT",
                        "UPPER_CODE": "MSL",
                        "WIDTHLEFT": 35,
                        "WIDTHRIGHT": 25,
                    },
                },
            ],
        }
        nasr_mtr = {
            "routes": {
                "VR101": {"mtr_type": "VR", "artcc": "ZOA", "fss": "OAK", "time_of_use": "SR-SS"},
                "VR999": {"mtr_type": "VR", "artcc": "ZLA", "fss": "LAX", "time_of_use": "CONT"},
            },
            "points": {
                # Duplicate of ADDS route -> must not duplicate in mtrs.fgb
                "VR101": [
                    {"seq": 1, "lat": 38.0, "lon": -121.0},
                    {"seq": 2, "lat": 38.0, "lon": -120.5},
                ],
                # Backfill route (unsorted seqs) -> must appear with source="nasr"
                "VR999": [
                    {"seq": 20, "lat": 35.5, "lon": -117.5},
                    {"seq": 10, "lat": 35.0, "lon": -118.0},
                ],
                # Single unique point -> must be skipped
                "VR000": [
                    {"seq": 1, "lat": 34.0, "lon": -118.0},
                    {"seq": 2, "lat": 34.0, "lon": -118.0},
                ],
            },
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "mtr_raw.geojson")
            nasr_path = os.path.join(tmpdir, "nasr_mtr_raw.json")
            mtrs_out = os.path.join(tmpdir, "mtrs.fgb")
            corridors_out = os.path.join(tmpdir, "mtr_corridors.fgb")
            with open(raw_path, "w") as f:
                json.dump(adds_geojson, f)
            with open(nasr_path, "w") as f:
                json.dump(nasr_mtr, f)

            convert_mtrs(raw_path=raw_path, nasr_mtr_path=nasr_path, mtrs_output=mtrs_out, corridors_output=corridors_out)

            gdf_m = gpd.read_file(mtrs_out, engine="pyogrio")
            self.assertEqual(set(gdf_m["route_id"]), {"VR100", "VR101", "SR202", "IR303", "VR999"})

            vr100 = gdf_m[gdf_m["route_id"] == "VR100"].iloc[0]
            self.assertEqual(vr100["lower_alt"], "SFC")
            self.assertEqual(vr100["upper_alt"], "1500 AGL")
            self.assertEqual(vr100["rank"], 3)

            vr101 = gdf_m[gdf_m["route_id"] == "VR101"].iloc[0]
            self.assertEqual(vr101["artcc"], "ZOA")
            self.assertEqual(vr101["fss"], "OAK")
            self.assertEqual(vr101["time_of_use"], "SR-SS")

            sr202 = gdf_m[gdf_m["route_id"] == "SR202"].iloc[0]
            self.assertEqual(sr202["rank"], 4)

            vr999 = gdf_m[gdf_m["route_id"] == "VR999"].iloc[0]
            self.assertEqual(vr999["source"], "nasr")
            self.assertEqual(vr999["mtr_type"], "VR")
            self.assertEqual(vr999["artcc"], "ZLA")
            self.assertEqual(list(vr999.geometry.coords), [(-118.0, 35.0), (-117.5, 35.5)])

            ir303_line = gdf_m[gdf_m["route_id"] == "IR303"].iloc[0]
            self.assertEqual(ir303_line["width_left"], 35.0)
            self.assertEqual(ir303_line["width_right"], 25.0)

            gdf_c = gpd.read_file(corridors_out, engine="pyogrio")
            # VR100 has (0, 0) width -> no corridor polygon
            self.assertEqual(set(gdf_c["route_id"]), {"VR101", "SR202", "IR303"})

            # Single-side 0: VR101 (left=5, right=0) extends north of lat 38.0 only
            c_101 = gdf_c[gdf_c["route_id"] == "VR101"].iloc[0].geometry
            self.assertIn(c_101.geom_type, ("Polygon", "MultiPolygon"))
            self.assertGreaterEqual(c_101.bounds[1], 37.998)
            self.assertGreater(c_101.bounds[3], 38.07)

            # Single-side 0: SR202 (left=0, right=4) extends south of lat 36.0 only
            c_202 = gdf_c[gdf_c["route_id"] == "SR202"].iloc[0].geometry
            self.assertIn(c_202.geom_type, ("Polygon", "MultiPolygon"))
            self.assertLessEqual(c_202.bounds[3], 36.002)
            self.assertLess(c_202.bounds[1], 35.94)

            # Clamped > 20 NM: IR303 (35, 25 -> 20, 20 NM = 37040 m per side)
            c_303 = gdf_c[gdf_c["route_id"] == "IR303"].iloc[0].geometry
            geod = pyproj.Geod(ellps="WGS84")
            north_dist_m = geod.inv(-119.75, 37.0, -119.75, c_303.bounds[3])[2]
            south_dist_m = geod.inv(-119.75, 37.0, -119.75, c_303.bounds[1])[2]
            self.assertAlmostEqual(north_dist_m, 20.0 * 1852.0, delta=400.0)
            self.assertAlmostEqual(south_dist_m, 20.0 * 1852.0, delta=400.0)

    def test_convert_mtrs_empty_inputs_graceful(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            mtrs_out = os.path.join(tmpdir, "mtrs.fgb")
            corridors_out = os.path.join(tmpdir, "mtr_corridors.fgb")
            convert_mtrs(
                raw_path=os.path.join(tmpdir, "missing.geojson"),
                nasr_mtr_path=os.path.join(tmpdir, "missing.json"),
                mtrs_output=mtrs_out,
                corridors_output=corridors_out,
            )
            self.assertFalse(os.path.exists(mtrs_out))
            self.assertFalse(os.path.exists(corridors_out))


class TestVfrPassesConversion(unittest.TestCase):
    def test_parse_elevation_ft(self) -> None:
        self.assertEqual(parse_elevation_ft("2072 ft"), 2072)
        self.assertEqual(parse_elevation_ft("2072 feet"), 2072)
        self.assertEqual(parse_elevation_ft("2,072'"), 2072)
        self.assertEqual(parse_elevation_ft("1890"), 6201)
        self.assertEqual(parse_elevation_ft("1,890 m"), 6201)
        self.assertEqual(parse_elevation_ft("1890 meters"), 6201)
        self.assertEqual(parse_elevation_ft(1000), 3281)
        self.assertEqual(parse_elevation_ft("bad;2072 ft"), 2072)
        self.assertEqual(parse_elevation_ft("1890;2072 ft"), 6201)
        self.assertEqual(parse_elevation_ft("99999 ft;1500 ft"), 1500)
        self.assertIsNone(parse_elevation_ft(None))
        self.assertIsNone(parse_elevation_ft(True))
        self.assertIsNone(parse_elevation_ft(""))
        self.assertIsNone(parse_elevation_ft("-500 ft"))
        self.assertIsNone(parse_elevation_ft("26000 ft"))
        self.assertIsNone(parse_elevation_ft(float("nan")))

    def test_convert_passes_wkt_dedup_and_unnamed_skip(self) -> None:
        sparql_json = {
            "results": {
                "bindings": [
                    {
                        "geom": {"value": "POINT(-120.3200 39.3100)"},
                        "name": {"value": "Donner Pass"},
                        "ele": None,
                    },
                    {
                        "geom": {"value": "LINESTRING(-120.3210 39.3105, -120.3190 39.3110)"},
                        "name": {"value": "donner pass"},
                        "ele": {"value": "2072;7056 ft"},
                    },
                    {
                        "geom": {"value": "POLYGON((-119.30 37.90, -119.20 37.90, -119.20 37.95, -119.30 37.95, -119.30 37.90))"},
                        "name": {"value": "Tioga Pass"},
                        "ele": {"value": "9943 ft"},
                    },
                    {
                        "geom": {"value": "POINT(-118.00 36.00)"},
                        "name": {"value": "   "},
                        "ele": {"value": "5000 ft"},
                    },
                    {
                        "geom": {"value": "POINT(-115.00 40.00)"},
                        "name": {"value": "Donner Pass"},
                        "ele": {},
                    },
                ]
            }
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "passes_raw.json")
            out_path = os.path.join(tmpdir, "mountain_passes.fgb")
            with open(raw_path, "w") as f:
                json.dump(sparql_json, f)

            convert_passes(raw_path=raw_path, output=out_path)
            self.assertTrue(os.path.exists(out_path))
            gdf = gpd.read_file(out_path, engine="pyogrio")

            # Unnamed pass skipped; nearby Donner Pass merged (upgraded to ele=2072 m -> 6798 ft); distant Donner Pass kept
            self.assertEqual(len(gdf), 3)

            tioga = gdf[gdf["name"] == "Tioga Pass"].iloc[0]
            self.assertEqual(tioga["elev_ft"], 9943)
            self.assertEqual(tioga["rank"], 3)
            self.assertEqual(tioga.geometry.geom_type, "Point")
            self.assertAlmostEqual(tioga.geometry.x, -119.25, delta=0.06)

            donners = gdf[gdf["name"].str.lower() == "donner pass"]
            self.assertEqual(len(donners), 2)
            upgraded = donners[donners["elev_ft"].notna()].iloc[0]
            self.assertEqual(upgraded["elev_ft"], 6798)
            self.assertEqual(upgraded["rank"], 3)

            unrated = donners[donners["elev_ft"].isna()].iloc[0]
            self.assertEqual(unrated["rank"], 4)


class TestVfrWindFarmsConversion(unittest.TestCase):
    def test_convert_wind_farms_clustering_collinear_naming_and_dof(self) -> None:
        # Three collinear turbines spaced ~1km apart along lat 35.10
        collinear_pts = [(-118.30, 35.10), (-118.29, 35.10), (-118.28, 35.10)]
        uswtdb_fc = {
            "type": "FeatureCollection",
            "features": [
                # Valid 3-turbine collinear farm with "unknown " prefix -> "Tehachapi Ridge"
                *[
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [lon, lat]},
                        "properties": {"p_name": "unknown Tehachapi Ridge", "t_state": "ca", "t_cap": 2000, "t_ttlh": 150},
                    }
                    for lon, lat in collinear_pts
                ],
                # Only 2 turbines -> skipped (< 3)
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-121.70, 38.10]},
                    "properties": {"p_name": "Too Small", "t_state": "CA", "p_cap": 5.0},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-121.69, 38.10]},
                    "properties": {"p_name": "Too Small", "t_state": "CA", "p_cap": 5.0},
                },
                # "unknown " prefix stripped and bare "unknown" -> "Wind Farm"
                *[
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [-116.50 + i * 0.005, 33.90]},
                        "properties": {"p_name": "unknown San Gorgonio", "t_state": "CA", "t_cap": 2000},
                    }
                    for i in range(3)
                ],
                *[
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [-115.50 + i * 0.005, 34.10]},
                        "properties": {"p_name": "unknown", "t_state": "CA", "t_cap": 1500},
                    }
                    for i in range(3)
                ],
            ],
        }

        dof_fc = {
            "type": "FeatureCollection",
            "features": [
                # Matches Tehachapi Ridge cluster -> enriches max_amsl_ft=4600, max_agl_ft=500
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-118.29, 35.10]},
                    "properties": {"Type_Code": "WINDMILL", "AMSL": 4600, "AGL": 500, "Lighting": "R"},
                },
                # Non-WINDMILL obstacle at same location -> must be ignored
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-118.29, 35.10]},
                    "properties": {"Type_Code": "TOWER", "AMSL": 9999, "AGL": 999, "Lighting": "R"},
                },
                # Unmatched WINDMILL obstacles outside USWTDB -> must NOT synthesize DOF-only farms
                *[
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [-100.00 + i * 0.01, 32.00]},
                        "properties": {"Type_Code": "WINDMILL", "AMSL": 2500, "AGL": 450, "Lighting": "R"},
                    }
                    for i in range(3)
                ],
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            uswtdb_path = os.path.join(tmpdir, "uswtdb_raw.geojson")
            dof_raw_path = os.path.join(tmpdir, "dof_raw.geojson")
            obstacles_path = os.path.join(tmpdir, "obstacles.fgb")
            out_path = os.path.join(tmpdir, "wind_farms.fgb")
            with open(uswtdb_path, "w") as f:
                json.dump(uswtdb_fc, f)
            with open(dof_raw_path, "w") as f:
                json.dump(dof_fc, f)

            convert_obstacles(raw_path=dof_raw_path, output=obstacles_path)
            convert_wind_farms(raw_path=uswtdb_path, obstacles_path=obstacles_path, output=out_path)

            gdf = gpd.read_file(out_path, engine="pyogrio")
            self.assertEqual(len(gdf), 3)

            tehachapi = gdf[gdf["name"] == "Tehachapi Ridge"].iloc[0]
            self.assertEqual(tehachapi.geometry.geom_type, "Polygon")
            self.assertTrue(tehachapi.geometry.is_valid)
            self.assertEqual(tehachapi["state"], "CA")
            self.assertEqual(tehachapi["turbines"], 3)
            self.assertAlmostEqual(tehachapi["capacity_mw"], 6.0)
            self.assertEqual(tehachapi["max_amsl_ft"], 4600)
            self.assertEqual(tehachapi["max_agl_ft"], 500)
            self.assertEqual(tehachapi["max_tip_ft"], round(150 * 3.28084))
            self.assertEqual(tehachapi["source"], "uswtdb")
            self.assertEqual(tehachapi["rank"], 4)

            san_gorgonio = gdf[gdf["name"] == "San Gorgonio"].iloc[0]
            self.assertAlmostEqual(san_gorgonio["capacity_mw"], 6.0)

            bare_unknown = gdf[gdf["name"] == "Wind Farm"].iloc[0]
            self.assertEqual(bare_unknown["source"], "uswtdb")
            self.assertAlmostEqual(bare_unknown["capacity_mw"], 4.5)


class TestVfrPowerlinesConversion(unittest.TestCase):
    def test_convert_powerlines_filters_and_minzoom_ranks(self) -> None:
        raw_fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-122.0, 37.0], [-121.9, 37.1]]},
                    "properties": {"STATUS": "IN SERVICE", "TYPE": "AC; OVERHEAD", "VOLTAGE": 138, "VOLT_CLASS": "100-161", "OWNER": "PGE"},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-122.1, 37.0], [-122.0, 37.1]]},
                    "properties": {"STATUS": "IN SERVICE", "TYPE": "AC; OVERHEAD", "VOLTAGE": 230, "VOLT_CLASS": "220-287", "OWNER": "PGE"},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-122.2, 37.0], [-122.1, 37.1]]},
                    "properties": {"STATUS": "IN SERVICE", "TYPE": "AC; OVERHEAD", "VOLTAGE": 500, "VOLT_CLASS": "500", "OWNER": "SCE"},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-122.3, 37.0], [-122.2, 37.1]]},
                    "properties": {"STATUS": "INACTIVE", "TYPE": "OVERHEAD", "VOLTAGE": 500},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-122.4, 37.0], [-122.3, 37.1]]},
                    "properties": {"STATUS": "proposed", "TYPE": "OVERHEAD", "VOLTAGE": 345},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-122.5, 37.0], [-122.4, 37.1]]},
                    "properties": {"STATUS": "IN SERVICE", "TYPE": "AC; UNDERGROUND", "VOLTAGE": 345},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[-122.6, 37.0], [-122.5, 37.1]]},
                    "properties": {"STATUS": "IN SERVICE", "TYPE": "OVERHEAD", "VOLTAGE": 69},
                },
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-122.7, 37.0]},
                    "properties": {"STATUS": "IN SERVICE", "TYPE": "OVERHEAD", "VOLTAGE": 345},
                },
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            raw_path = os.path.join(tmpdir, "powerlines_raw.geojson")
            out_path = os.path.join(tmpdir, "powerlines.geojson")
            with open(raw_path, "w") as f:
                json.dump(raw_fc, f)

            convert_powerlines(raw_path=raw_path, output=out_path)
            with open(out_path) as f:
                out_fc = json.load(f)

            feats = out_fc["features"]
            self.assertEqual(len(feats), 3)
            # Sorted by rank ascending (500kV -> rank 2, 230kV -> rank 3, 138kV -> rank 4)
            self.assertEqual(
                [(ft["properties"]["voltage_kv"], ft["properties"]["rank"], ft["tippecanoe"]["minzoom"]) for ft in feats],
                [
                    (500, 2, 6),
                    (230, 3, 7),
                    (138, 4, 9),
                ],
            )


class TestVfrFetch(unittest.TestCase):
    def test_fetch_passes_qlever_cache_and_fail_loud(self) -> None:
        qlever_resp = MagicMock()
        qlever_resp.status_code = 200
        qlever_resp.json.return_value = {
            "results": {
                "bindings": [
                    {
                        "node": {"value": "https://www.openstreetmap.org/node/1"},
                        "name": {"value": "Echo Summit"},
                        "ele": {"value": "2249"},
                        "geom": {"value": "POINT(-120.03 38.81)"},
                    }
                ]
            }
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = os.path.join(tmpdir, "passes_raw.geojson")

            # 1. QLever success + cycle cache hit
            with (
                patch("src.vfr.fetch.requests.request", return_value=qlever_resp) as mock_req,
                patch("src.vfr.fetch.time.sleep"),
            ):
                vfr_fetch.fetch_passes("2026-10-29", output=out_path)
                self.assertEqual(mock_req.call_count, 1)
                with open(out_path) as f:
                    data = json.load(f)
                self.assertEqual(len(data["features"]), 1)
                self.assertEqual(data["features"][0]["properties"]["source"], "osm")

                # Cache hit for same cycle
                vfr_fetch.fetch_passes("2026-10-29", output=out_path)
                self.assertEqual(mock_req.call_count, 1)

            # 2. QLever failure after 3 retries fails loudly without overwriting cache or writing empty FC
            err_resp = MagicMock()
            err_resp.status_code = 500
            out_fail = os.path.join(tmpdir, "passes_fail.geojson")
            with (
                patch("src.vfr.fetch.requests.request", return_value=err_resp) as mock_req,
                patch("src.vfr.fetch.time.sleep"),
                self.assertRaises(RuntimeError),
            ):
                vfr_fetch.fetch_passes("2026-11-26", output=out_fail)
            self.assertEqual(mock_req.call_count, 3)
            self.assertFalse(os.path.exists(out_fail))

    def test_fetch_uswtdb_and_powerlines_retries_and_fail_loud(self) -> None:
        uswtdb_zip_buf = io.BytesIO()
        with zipfile.ZipFile(uswtdb_zip_buf, "w") as zf:
            zf.writestr(
                "uswtdb.geojson",
                json.dumps(
                    {
                        "type": "FeatureCollection",
                        "features": [
                            {
                                "type": "Feature",
                                "geometry": {"type": "Point", "coordinates": [-118.0, 35.0]},
                                "properties": {"p_name": "F1"},
                            }
                        ],
                    }
                ),
            )
        uswtdb_ok = MagicMock()
        uswtdb_ok.status_code = 200
        uswtdb_ok.content = uswtdb_zip_buf.getvalue()
        err_resp = MagicMock()
        err_resp.status_code = 503

        with tempfile.TemporaryDirectory() as tmpdir:
            uswtdb_out = os.path.join(tmpdir, "uswtdb_raw.geojson")
            with (
                patch("src.vfr.fetch.requests.request", side_effect=[err_resp, uswtdb_ok]) as mock_req,
                patch("src.vfr.fetch.time.sleep"),
            ):
                vfr_fetch.fetch_uswtdb("2026-10-29", output=uswtdb_out)
                self.assertEqual(mock_req.call_count, 2)
                with open(uswtdb_out) as f:
                    self.assertEqual(len(json.load(f)["features"]), 1)

            uswtdb_fail = os.path.join(tmpdir, "uswtdb_fail.geojson")
            with (
                patch("src.vfr.fetch.requests.request", return_value=err_resp) as mock_req,
                patch("src.vfr.fetch.time.sleep"),
                self.assertRaises(RuntimeError),
            ):
                vfr_fetch.fetch_uswtdb("2026-10-29", output=uswtdb_fail)
            self.assertEqual(mock_req.call_count, 3)
            self.assertFalse(os.path.exists(uswtdb_fail))

            # Powerlines: retry on first page + keyset pagination across 2 pages
            page1_ok = MagicMock()
            page1_ok.status_code = 200
            page1_ok.json.return_value = {
                "type": "FeatureCollection",
                "properties": {"exceededTransferLimit": True},
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": [[-120, 37], [-119, 37]]},
                        "properties": {"OBJECTID_1": 10, "VOLTAGE": 230},
                    }
                ],
            }
            page2_ok = MagicMock()
            page2_ok.status_code = 200
            page2_ok.json.return_value = {
                "type": "FeatureCollection",
                "properties": {"exceededTransferLimit": False},
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": [[-119, 37], [-118, 37]]},
                        "properties": {"OBJECTID_1": 20, "VOLTAGE": 500},
                    }
                ],
            }

            pl_out = os.path.join(tmpdir, "powerlines_raw.geojson")
            with (
                patch("src.adds.fetch.requests.get", side_effect=[err_resp, page1_ok, page2_ok]) as mock_get,
                patch("src.adds.fetch.time.sleep"),
            ):
                vfr_fetch.fetch_powerlines("2026-10-29", output=pl_out)
                self.assertEqual(mock_get.call_count, 3)
                with open(pl_out) as f:
                    self.assertEqual(len(json.load(f)["features"]), 2)

            pl_fail = os.path.join(tmpdir, "powerlines_fail.geojson")
            with (
                patch("src.adds.fetch.requests.get", return_value=err_resp) as mock_get,
                patch("src.adds.fetch.time.sleep"),
                self.assertRaises(RuntimeError),
            ):
                vfr_fetch.fetch_powerlines("2026-10-29", output=pl_fail)
            self.assertEqual(mock_get.call_count, 3)
            self.assertFalse(os.path.exists(pl_fail))


if __name__ == "__main__":
    unittest.main()
