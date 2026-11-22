import os
import struct
import tempfile
import unittest

import geopandas as gpd
from PIL import Image
from shapely.geometry import Polygon

from src.adds.airspaces_3d import (
    BIT_B,
    BIT_C,
    BIT_D,
    BIT_SUA,
    BIT_TRSA,
    COORD_SCALE,
    MAGIC,
    VERSION,
    build_topological_airspaces_3d,
)
from src.adds.dem import MapterhornDemSampler, encode_terrarium_rgb


def decode_airspaces_3d(payload: bytes) -> tuple[list[dict], list[dict]]:
    magic, version, num_caps, num_wall_chains = struct.unpack_from("<4sIII", payload, 0)
    assert magic == MAGIC
    assert version == VERSION
    offset = 16

    caps: list[dict] = []
    for _ in range(num_caps):
        z_top, mask, is_agl, num_rings = struct.unpack_from("<fBBH", payload, offset)
        offset += 8
        rings: list[list[tuple[float, float]]] = []
        for _ in range(num_rings):
            (num_pts,) = struct.unpack_from("<I", payload, offset)
            offset += 4
            pts: list[tuple[float, float]] = []
            for _ in range(num_pts):
                ix, iy, _tm = struct.unpack_from("<iih", payload, offset)
                offset += 10
                pts.append((ix / COORD_SCALE, iy / COORD_SCALE))
            rings.append(pts)
        caps.append({"z": round(z_top, 2), "mask": mask, "is_agl": bool(is_agl), "rings": rings})

    wall_chains: list[dict] = []
    for _ in range(num_wall_chains):
        z0, z1, wall_mask, top_mask, bot_mask, agl_flags, num_pts = struct.unpack_from("<ffBBBBI", payload, offset)
        offset += 16
        pts = []
        for _ in range(num_pts):
            ix, iy, _tm = struct.unpack_from("<iih", payload, offset)
            offset += 10
            pts.append((ix / COORD_SCALE, iy / COORD_SCALE))
        wall_chains.append(
            {
                "z0": round(z0, 2),
                "z1": round(z1, 2),
                "wall_mask": wall_mask,
                "top_mask": top_mask,
                "bot_mask": bot_mask,
                "agl_flags": agl_flags,
                "pts": pts,
            }
        )

    assert offset == len(payload)
    return caps, wall_chains


def wall_segments_from_chains(chains: list[dict]) -> list[tuple[tuple[float, float], tuple[float, float], float, float, int]]:
    segs = []
    for ch in chains:
        pts = ch["pts"]
        for i in range(len(pts) - 1):
            p0, p1 = pts[i], pts[i + 1]
            key_pts = (p0, p1) if p0 < p1 else (p1, p0)
            segs.append((key_pts[0], key_pts[1], ch["z0"], ch["z1"], ch["wall_mask"]))
    return segs


class TestAirspaces3dTopology(unittest.TestCase):
    def test_disjoint_adjacent_walls_deduplicated_and_split_by_altitude(self) -> None:
        # Left square [0..1, 0..1] Class D (0..500m) touches Right square [1..2, 0..1] Class C (0..1000m)
        # along shared vertical boundary x=1, y=[0..1].
        gdf = gpd.GeoDataFrame(
            [
                {
                    "airspace_class": "D",
                    "is_sua": False,
                    "lower_m": 0.0,
                    "upper_m": 500.0,
                    "geometry": Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]),
                },
                {
                    "airspace_class": "C",
                    "is_sua": False,
                    "lower_m": 0.0,
                    "upper_m": 1000.0,
                    "geometry": Polygon([(1, 0), (2, 0), (2, 1), (1, 1)]),
                },
            ],
            crs="EPSG:4326",
        )

        payload, stats = build_topological_airspaces_3d(gdf, pre_simplify_tol=0.0, coverage_tol=0.0, precision_grid=1e-6)
        caps, wall_chains = decode_airspaces_3d(payload)

        self.assertEqual(stats["caps"], 2)
        self.assertEqual({(c["z"], c["mask"]) for c in caps}, {(500.0, BIT_D), (1000.0, BIT_C)})

        segs = wall_segments_from_chains(wall_chains)
        shared_segs = [s for s in segs if s[0] == (1.0, 0.0) and s[1] == (1.0, 1.0)]
        # Shared seam must split cleanly into exactly two non-overlapping vertical intervals:
        # [0, 500] carrying both C|D masks, and [500, 1000] carrying only C mask.
        self.assertEqual(
            sorted(shared_segs, key=lambda s: s[2]),
            [
                ((1.0, 0.0), (1.0, 1.0), 0.0, 500.0, BIT_C | BIT_D),
                ((1.0, 0.0), (1.0, 1.0), 500.0, 1000.0, BIT_C),
            ],
        )

        # Shared outline segment at z=500 must be claimed by at most one wall chain.
        z500_claims = 0
        for ch in wall_chains:
            pts = ch["pts"]
            for i in range(len(pts) - 1):
                pair = tuple(sorted((pts[i], pts[i + 1])))
                if pair == ((1.0, 0.0), (1.0, 1.0)):
                    if ch["z1"] == 500.0 and ch["top_mask"] != 0:
                        z500_claims += 1
                    if ch["z0"] == 500.0 and ch["bot_mask"] != 0:
                        z500_claims += 1
        self.assertEqual(z500_claims, 1)

    def test_overlapping_footprints_deduplicate_caps_and_shared_outer_walls(self) -> None:
        # Class B [0..2, 0..2] (0..3000m) and SUA [0..1, 0..2] (0..3000m) share left perimeter
        # on the SAME side and share top altitude 3000m across [0..1, 0..2].
        gdf = gpd.GeoDataFrame(
            [
                {
                    "airspace_class": "B",
                    "is_sua": False,
                    "lower_m": 0.0,
                    "upper_m": 3000.0,
                    "geometry": Polygon([(0, 0), (2, 0), (2, 2), (0, 2)]),
                },
                {
                    "airspace_class": "R",
                    "is_sua": True,
                    "lower_m": 0.0,
                    "upper_m": 3000.0,
                    "geometry": Polygon([(0, 0), (1, 0), (1, 2), (0, 2)]),
                },
            ],
            crs="EPSG:4326",
        )

        payload, _ = build_topological_airspaces_3d(gdf, pre_simplify_tol=0.0, coverage_tol=0.0, precision_grid=1e-6)
        caps, wall_chains = decode_airspaces_3d(payload)

        # Two disjoint merged cap cells at z=3000: left half (B|SUA) and right half (B).
        self.assertEqual({(c["z"], c["mask"]) for c in caps}, {(3000.0, BIT_B | BIT_SUA), (3000.0, BIT_B)})
        # Total cap area must equal 4.0 (no double-counted overlapping triangle area).
        total_area = sum(Polygon(c["rings"][0]).area for c in caps)
        self.assertAlmostEqual(total_area, 4.0, places=5)

        # Shared outer left wall x=0 must appear ONCE with mask B|SUA; interior split x=1 must emit ONLY SUA.
        segs = wall_segments_from_chains(wall_chains)
        left_walls = [s for s in segs if s[0] == (0.0, 0.0) and s[1] == (0.0, 2.0)]
        mid_walls = [s for s in segs if s[0] == (1.0, 0.0) and s[1] == (1.0, 2.0)]
        self.assertEqual(left_walls, [((0.0, 0.0), (0.0, 2.0), 0.0, 3000.0, BIT_B | BIT_SUA)])
        self.assertEqual(mid_walls, [((1.0, 0.0), (1.0, 2.0), 0.0, 3000.0, BIT_SUA)])

    def test_filters_non_3d_classes_and_inverted_altitudes(self) -> None:
        gdf = gpd.GeoDataFrame(
            [
                {
                    "airspace_class": "MODE_C",
                    "is_sua": False,
                    "lower_m": 0.0,
                    "upper_m": 3000.0,
                    "geometry": Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]),
                },
                {
                    "airspace_class": "TRSA",
                    "is_sua": False,
                    "lower_m": 500.0,
                    "upper_m": 500.0,
                    "geometry": Polygon([(2, 0), (3, 0), (3, 1), (2, 1)]),
                },
                {
                    "airspace_class": "TRSA",
                    "is_sua": False,
                    "lower_m": 500.0,
                    "upper_m": 1500.0,
                    "geometry": Polygon([(4, 0), (5, 0), (5, 1), (4, 1)]),
                },
            ],
            crs="EPSG:4326",
        )

        payload, stats = build_topological_airspaces_3d(gdf, pre_simplify_tol=0.0, coverage_tol=0.0, precision_grid=1e-6)
        caps, _ = decode_airspaces_3d(payload)
        self.assertEqual(stats["features"], 1)
        self.assertEqual(len(caps), 1)
        self.assertEqual(caps[0]["mask"], BIT_TRSA)
        self.assertEqual(caps[0]["z"], 1500.0)

    def test_string_false_agl_flags_and_symmetric_agl_segmentize(self) -> None:
        gdf = gpd.GeoDataFrame(
            [
                {
                    "airspace_class": "D",
                    "is_sua": False,
                    "lower_m": 0.0,
                    "upper_m": 500.0,
                    "lower_is_agl": "True",
                    "upper_is_agl": "False",
                    "geometry": Polygon([(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)]),
                },
                {
                    "airspace_class": "C",
                    "is_sua": False,
                    "lower_m": 0.0,
                    "upper_m": 1000.0,
                    "lower_is_agl": "True",
                    "upper_is_agl": "True",
                    "geometry": Polygon([(0.1, 0), (0.2, 0), (0.2, 0.1), (0.1, 0.1)]),
                },
            ],
            crs="EPSG:4326",
        )

        payload, _ = build_topological_airspaces_3d(
            gdf,
            pre_simplify_tol=0.0,
            coverage_tol=0.0,
            precision_grid=1e-6,
            agl_segment_deg=0.02,
        )
        caps, wall_chains = decode_airspaces_3d(payload)
        self.assertEqual([c["is_agl"] for c in sorted(caps, key=lambda c: c["z"])], [False, True])

        # Shared seam x=0.1, y=[0..0.1] splits into [0 AGL..500 MSL] (C|D) and [500 MSL..1000 AGL] (C);
        # both intervals touch terrain-relative endpoints and must subdivide 0.1 deg into 5 identical steps.
        segs = wall_segments_from_chains(wall_chains)
        seam_low = sorted(s for s in segs if s[0][0] == 0.1 and s[1][0] == 0.1 and s[2] == 0.0)
        seam_high = sorted(s for s in segs if s[0][0] == 0.1 and s[1][0] == 0.1 and s[2] == 500.0)
        self.assertEqual(len(seam_low), 5)
        self.assertEqual(len(seam_high), 5)
        self.assertEqual([(s[0], s[1]) for s in seam_low], [(s[0], s[1]) for s in seam_high])

    def test_mapterhorn_dem_sampler_bilinear_interpolation(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Build a zoom=0 512x512 lossless WebP tile with a known linear ramp in X (1000m..2000m).
            img = Image.new("RGB", (512, 512))
            px = img.load()
            assert px is not None
            for x in range(512):
                rgb = encode_terrarium_rgb(1000.0 + x * 2.0)
                for y in range(512):
                    px[x, y] = rgb
            img.save(os.path.join(tmpdir, "z0_0_0.webp"), format="WEBP", lossless=True)

            sampler = MapterhornDemSampler(zoom=0, cache_dir=tmpdir)
            sampler.prefetch([(-90.0, 0.0), (0.0, 0.0)])

            # Pixel center x=255.5 corresponds to lon = ((255.5 / 512) * 360) - 180;
            # bilinear between pixel 255 (1510m) and 256 (1512m) at lon=0 (gx=256.0 -> fx=255.5) = 1511.0m.
            elev = sampler(0.0, 0.0)
            self.assertAlmostEqual(elev, 1511.0, delta=0.05)


if __name__ == "__main__":
    unittest.main()
