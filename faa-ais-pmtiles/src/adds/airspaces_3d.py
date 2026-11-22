"""Build a planar-topological 3D airspace binary asset (`airspaces_3d.bin`).

Nodes touching/overlapping 2D airspace footprints into a disjoint planar coverage,
simplifies shared arcs topologically, deduplicates vertical wall intervals across
adjacent/overlapping sides via mod-2 boundary parity, dissolves horizontal caps per
(altitude, class_mask, is_agl), and claims each unique 3D horizontal outline edge once.
"""

from __future__ import annotations

import math
import os
import struct
import time
from collections import defaultdict
from collections.abc import Callable

import geopandas as gpd
import shapely
from shapely import Geometry, Polygon, STRtree
from shapely.ops import linemerge, polygonize, unary_union

from src.adds.dem import MapterhornDemSampler

MAGIC = b"A3D1"
VERSION = 2
COORD_SCALE = 10_000_000  # 1e-7 deg (~1.1 cm) encoded in signed int32

BIT_B = 1
BIT_C = 2
BIT_D = 4
BIT_SUA = 8
BIT_TRSA = 16

AGL_LOWER_BIT = 1
AGL_UPPER_BIT = 2
AGL_TOP_EDGE_BIT = 4
AGL_BOT_EDGE_BIT = 8

CLASS_BITS: dict[str, int] = {
    "B": BIT_B,
    "C": BIT_C,
    "D": BIT_D,
    "TRSA": BIT_TRSA,
}


def classify_3d_bit(is_sua: object, airspace_class: object) -> int:
    """Map feature properties to the 5-bit 3D airspace visibility/color mask."""
    if bool(is_sua):
        return BIT_SUA
    cls = str(airspace_class or "").strip().upper()
    return CLASS_BITS.get(cls, 0)


def _as_bool(val: object) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val != 0
    return str(val or "").strip().lower() in ("true", "1", "yes")


def _extract_polygons(geom: Geometry | None) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]  # type: ignore[list-item]
    if geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        out: list[Polygon] = []
        for sub in geom.geoms:  # type: ignore[attr-defined]
            out.extend(_extract_polygons(sub))
        return out
    return []


def _to_microdeg(x: float, y: float) -> tuple[int, int]:
    return (round(x * COORD_SCALE), round(y * COORD_SCALE))


def _clamp_i16(val: float) -> int:
    return max(-32768, min(32767, round(val)))


def _segmentize_microdeg_pts(
    pts: list[tuple[int, int]],
    max_step_microdeg: int,
) -> list[tuple[int, int]]:
    """Subdivide segments longer than max_step_microdeg deterministically regardless of direction."""
    if max_step_microdeg <= 0 or len(pts) < 2:
        return pts

    out: list[tuple[int, int]] = [pts[0]]
    for i in range(len(pts) - 1):
        a = pts[i]
        b = pts[i + 1]
        dx = b[0] - a[0]
        dy = b[1] - a[1]
        dist = math.hypot(dx, dy)
        steps = math.ceil(dist / max_step_microdeg) if dist > max_step_microdeg else 1
        if steps > 1:
            if a < b:
                for s in range(1, steps):
                    t = s / steps
                    out.append((round(a[0] + dx * t), round(a[1] + dy * t)))
            else:
                for s in range(steps - 1, 0, -1):
                    t = s / steps
                    out.append((round(b[0] - dx * t), round(b[1] - dy * t)))
        out.append(b)
    return out


def build_topological_airspaces_3d(
    gdf: gpd.GeoDataFrame,
    *,
    pre_simplify_tol: float = 5e-5,
    coverage_tol: float = 1e-4,
    precision_grid: float = 1e-5,
    agl_segment_deg: float = 0.02,
    terrain_sampler: Callable[[float, float], float] | None = None,
) -> tuple[bytes, dict[str, int | float]]:
    """Convert 2D airspace polygons with lower_m/upper_m into planar-deduplicated 3D binary."""
    t0 = time.perf_counter()

    if len(gdf) == 0:
        header = struct.pack("<4sIII", MAGIC, VERSION, 0, 0)
        return header, {"features": 0, "caps": 0, "wall_chains": 0, "wall_segments": 0, "seconds": 0.0}

    geoms: list[Geometry] = []
    bits: list[int] = []
    lows: list[float] = []
    highs: list[float] = []
    low_agls: list[bool] = []
    high_agls: list[bool] = []

    for _, row in gdf.iterrows():
        bit = classify_3d_bit(row.get("is_sua", False), row.get("airspace_class", ""))
        if bit == 0:
            continue
        low_m = float(row.get("lower_m") or 0.0)
        high_m = float(row.get("upper_m") or 0.0)
        if not (high_m > low_m):
            continue
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        if pre_simplify_tol > 0:
            geom = geom.simplify(pre_simplify_tol, preserve_topology=True)
        if precision_grid > 0:
            geom = shapely.set_precision(geom, precision_grid)
        if geom.is_empty:
            continue
        geoms.append(geom)
        bits.append(bit)
        lows.append(round(low_m, 2))
        highs.append(round(high_m, 2))
        low_agls.append(_as_bool(row.get("lower_is_agl", False)))
        high_agls.append(_as_bool(row.get("upper_is_agl", False)))

    n = len(geoms)
    if n == 0:
        header = struct.pack("<4sIII", MAGIC, VERSION, 0, 0)
        return header, {"features": 0, "caps": 0, "wall_chains": 0, "wall_segments": 0, "seconds": 0.0}

    # Partition intersecting/touching features into independent connected components.
    tree = STRtree(geoms)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    left, right = tree.query(geoms, predicate="intersects")
    for i, j in zip(left, right):
        ii, jj = int(i), int(j)
        if ii < jj:
            union(ii, jj)

    comps: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        comps[find(i)].append(i)

    raw_walls: list[tuple[tuple[int, int], tuple[int, int], float, float, int, bool, bool]] = []
    edge_mask_at: dict[tuple[tuple[int, int], tuple[int, int], float, bool], int] = defaultdict(int)
    grouped_caps: dict[tuple[float, int, bool], list[Polygon]] = defaultdict(list)

    for idxs in comps.values():
        sub_geoms = [geoms[i] for i in idxs]
        if len(idxs) == 1:
            cells = _extract_polygons(sub_geoms[0])
        else:
            boundaries = [g.boundary for g in sub_geoms if not g.is_empty]
            noded = shapely.unary_union(boundaries, grid_size=precision_grid if precision_grid > 0 else None)
            cells = list(polygonize(noded))

        if not cells:
            continue

        cell_pts = [c.representative_point() for c in cells]
        sub_tree = STRtree(sub_geoms)
        q_c, q_p = sub_tree.query(cell_pts, predicate="within")
        cell_polys: list[list[int]] = [[] for _ in range(len(cells))]
        for ci, pi in zip(q_c, q_p):
            cell_polys[int(ci)].append(idxs[int(pi)])

        if coverage_tol > 0:
            if len(cells) > 1 and shapely.coverage_is_valid(cells):
                simp_cells = list(shapely.coverage_simplify(cells, tolerance=coverage_tol))
            else:
                simp_cells = [c.simplify(coverage_tol, preserve_topology=True) for c in cells]
        else:
            simp_cells = cells

        edge_parity: dict[tuple[tuple[int, int], tuple[int, int]], set[int]] = defaultdict(set)
        for ci, sc in enumerate(simp_cells):
            if sc.is_empty or sc.area <= 0:
                continue
            polys_here = cell_polys[ci]
            if not polys_here:
                continue

            z_masks: dict[tuple[float, bool], int] = defaultdict(int)
            for pi in polys_here:
                z_masks[(highs[pi], high_agls[pi])] |= bits[pi]
            for (z_top, is_agl), mask in z_masks.items():
                for poly in _extract_polygons(sc):
                    if poly.area > 0:
                        grouped_caps[(z_top, mask, is_agl)].append(poly)

            for poly in _extract_polygons(sc):
                for ring in [poly.exterior] + list(poly.interiors):
                    coords = list(ring.coords)
                    for k in range(len(coords) - 1):
                        p0 = _to_microdeg(coords[k][0], coords[k][1])
                        p1 = _to_microdeg(coords[k + 1][0], coords[k + 1][1])
                        if p0 == p1:
                            continue
                        ekey = (p0, p1) if p0 < p1 else (p1, p0)
                        edge_parity[ekey].symmetric_difference_update(polys_here)

        for (p0, p1), wall_polys in edge_parity.items():
            if not wall_polys:
                continue
            bps = sorted({(lows[p], low_agls[p]) for p in wall_polys} | {(highs[p], high_agls[p]) for p in wall_polys})
            for zi in range(len(bps) - 1):
                (z0, l_agl), (z1, u_agl) = bps[zi], bps[zi + 1]
                if z1 < z0 or (z1 == z0 and l_agl == u_agl):
                    continue
                mask = 0
                for p in wall_polys:
                    p_lo = (lows[p], low_agls[p])
                    p_hi = (highs[p], high_agls[p])
                    if p_lo <= (z0, l_agl) and p_hi >= (z1, u_agl):
                        mask |= bits[p]
                if mask:
                    raw_walls.append((p0, p1, z0, z1, mask, l_agl, u_agl))
                    edge_mask_at[(p0, p1, z0, l_agl)] |= mask
                    edge_mask_at[(p0, p1, z1, u_agl)] |= mask

    raw_walls.sort(key=lambda w: (w[2], w[3], w[4], w[5], w[6], w[0], w[1]))
    claimed_edges: set[tuple[tuple[int, int], tuple[int, int], float, bool]] = set()
    walls_grouped: dict[tuple[float, float, int, int, int, int], list[tuple[tuple[int, int], tuple[int, int]]]] = defaultdict(list)

    for p0, p1, z0, z1, wmask, l_agl, u_agl in raw_walls:
        tk = (p0, p1, z1, u_agl)
        if tk not in claimed_edges:
            claimed_edges.add(tk)
            tmask = edge_mask_at[tk]
        else:
            tmask = 0

        bk = (p0, p1, z0, l_agl)
        if bk not in claimed_edges:
            claimed_edges.add(bk)
            bmask = edge_mask_at[bk]
        else:
            bmask = 0

        agl_flags = (
            (AGL_LOWER_BIT if l_agl else 0)
            | (AGL_UPPER_BIT if u_agl else 0)
            | (AGL_TOP_EDGE_BIT if (tmask and u_agl) else 0)
            | (AGL_BOT_EDGE_BIT if (bmask and l_agl) else 0)
        )
        walls_grouped[(z0, z1, wmask, tmask, bmask, agl_flags)].append((p0, p1))

    max_step_microdeg = round(agl_segment_deg * COORD_SCALE) if agl_segment_deg > 0 else 0

    encoded_caps: list[tuple[float, int, bool, list[list[tuple[int, int]]]]] = []
    for (z_top, mask, is_agl), glist in sorted(grouped_caps.items()):
        merged = unary_union(glist) if len(glist) > 1 else glist[0]
        for poly in _extract_polygons(merged):
            if poly.is_empty or poly.area <= 0:
                continue
            rings = [poly.exterior] + list(poly.interiors)
            encoded_rings: list[list[tuple[int, int]]] = []
            for r in rings:
                pts = [_to_microdeg(x, y) for x, y in list(r.coords)[:-1]]
                if len(pts) < 3:
                    continue
                if is_agl and max_step_microdeg > 0:
                    # Segmentize closed ring symmetrically so cap rims align with AGL walls.
                    pts = _segmentize_microdeg_pts(pts + [pts[0]], max_step_microdeg)[:-1]
                encoded_rings.append(pts)
            if encoded_rings:
                encoded_caps.append((z_top, mask, is_agl, encoded_rings))

    encoded_walls: list[tuple[float, float, int, int, int, int, list[tuple[int, int]]]] = []
    num_wall_segments = 0
    for (z0, z1, wmask, tmask, bmask, agl_flags), segs in sorted(walls_grouped.items()):
        mls = shapely.MultiLineString([[(p0[0], p0[1]), (p1[0], p1[1])] for p0, p1 in segs])
        merged_lines = linemerge(mls)
        line_list = [merged_lines] if merged_lines.geom_type == "LineString" else list(merged_lines.geoms)
        needs_terrain = (agl_flags & (AGL_LOWER_BIT | AGL_UPPER_BIT | AGL_TOP_EDGE_BIT | AGL_BOT_EDGE_BIT)) != 0
        for ln in line_list:
            coords = list(ln.coords)
            if len(coords) < 2:
                continue
            pts = [(round(x), round(y)) for x, y in coords]
            if needs_terrain and max_step_microdeg > 0:
                pts = _segmentize_microdeg_pts(pts, max_step_microdeg)
            num_wall_segments += len(pts) - 1
            encoded_walls.append((z0, z1, wmask, tmask, bmask, agl_flags, pts))

    if terrain_sampler is not None and hasattr(terrain_sampler, "prefetch"):
        dem_coords: list[tuple[float, float]] = []
        for _z_top, _mask, is_agl, rings in encoded_caps:
            if is_agl:
                for pts in rings:
                    for ix, iy in pts:
                        dem_coords.append((ix / COORD_SCALE, iy / COORD_SCALE))
        for _z0, _z1, _wm, _tm, _bm, agl_flags, pts in encoded_walls:
            if agl_flags != 0:
                for ix, iy in pts:
                    dem_coords.append((ix / COORD_SCALE, iy / COORD_SCALE))
        terrain_sampler.prefetch(dem_coords)

    terrain_cache: dict[tuple[int, int], int] = {}

    def sample_terrain_i16(ix: int, iy: int) -> int:
        if terrain_sampler is None:
            return 0
        key = (ix, iy)
        cached = terrain_cache.get(key)
        if cached is not None:
            return cached
        val = _clamp_i16(terrain_sampler(ix / COORD_SCALE, iy / COORD_SCALE))
        terrain_cache[key] = val
        return val

    cap_buf = bytearray()
    for z_top, mask, is_agl, encoded_rings in encoded_caps:
        cap_buf.extend(struct.pack("<fBBH", z_top, mask, 1 if is_agl else 0, len(encoded_rings)))
        for pts in encoded_rings:
            cap_buf.extend(struct.pack("<I", len(pts)))
            for ix, iy in pts:
                tm = sample_terrain_i16(ix, iy) if is_agl else 0
                cap_buf.extend(struct.pack("<iih", ix, iy, tm))

    wall_buf = bytearray()
    for z0, z1, wmask, tmask, bmask, agl_flags, pts in encoded_walls:
        needs_terrain = agl_flags != 0
        wall_buf.extend(struct.pack("<ffBBBBI", z0, z1, wmask, tmask, bmask, agl_flags, len(pts)))
        for ix, iy in pts:
            tm = sample_terrain_i16(ix, iy) if needs_terrain else 0
            wall_buf.extend(struct.pack("<iih", ix, iy, tm))

    header = struct.pack("<4sIII", MAGIC, VERSION, len(encoded_caps), len(encoded_walls))
    payload = header + bytes(cap_buf) + bytes(wall_buf)
    elapsed = round(time.perf_counter() - t0, 3)

    return payload, {
        "features": n,
        "caps": len(encoded_caps),
        "wall_chains": len(encoded_walls),
        "wall_segments": num_wall_segments,
        "bytes": len(payload),
        "seconds": elapsed,
    }


def convert_airspaces_3d(
    input_fgb: str = "data/airspaces.fgb",
    output_bin: str = "output/airspaces_3d.bin",
    terrain_sampler: Callable[[float, float], float] | None = None,
    *,
    use_dem: bool = True,
    dem_zoom: int = 8,
    dem_cache_dir: str = "data/dem_cache",
) -> dict[str, int | float]:
    """Read critical airspaces FlatGeobuf and write `airspaces_3d.bin`."""
    if not os.path.exists(input_fgb):
        raise FileNotFoundError(f"Airspace input file not found: {input_fgb}")

    sampler = terrain_sampler
    if sampler is None and use_dem:
        sampler = MapterhornDemSampler(zoom=dem_zoom, cache_dir=dem_cache_dir)

    gdf = gpd.read_file(input_fgb)
    payload, stats = build_topological_airspaces_3d(gdf, terrain_sampler=sampler)

    os.makedirs(os.path.dirname(output_bin) or ".", exist_ok=True)
    with open(output_bin, "wb") as f:
        f.write(payload)

    print(
        f"Built {output_bin}: {stats['features']} airspaces -> "
        f"{stats['caps']} caps, {stats['wall_chains']} wall chains ({stats['wall_segments']} quads), "
        f"{stats['bytes'] / 1024 / 1024:.2f} MB in {stats['seconds']:.2f}s"
    )
    return stats


if __name__ == "__main__":
    convert_airspaces_3d()
