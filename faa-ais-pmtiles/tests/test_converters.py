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
from src.nasr import fetch as nasr_fetch
from src.nasr.pja import convert_pja, parse_pja_csv


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
        self.assertEqual(p0["max_alt"], "14500 MSL")
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

                    # Cache hit when all 3 files exist
                    nasr_fetch.get_airport_metadata()
                    self.assertEqual(mock_get.call_count, 1)

                    # Remove pja_raw.geojson -> must re-download instead of skipping
                    os.remove("data/pja_raw.geojson")
                    nasr_fetch.get_airport_metadata()
                    self.assertEqual(mock_get.call_count, 2)
                    self.assertTrue(os.path.exists("data/pja_raw.geojson"))
            finally:
                os.chdir(orig_cwd)


if __name__ == "__main__":
    unittest.main()
