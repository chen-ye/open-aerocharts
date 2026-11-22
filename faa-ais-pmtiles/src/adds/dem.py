"""Bilinear Terrarium DEM tile sampler backed by Mapterhorn WebP tiles."""

from __future__ import annotations

import concurrent.futures
import io
import math
import os
import threading
from collections.abc import Iterable

import requests
from PIL import Image

MAX_MERCATOR_LAT = 85.05112878
DEFAULT_TILE_URL_TEMPLATE = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"


def decode_terrarium_rgb(r: int, g: int, b: int) -> float:
    """Decode Mapzen/Mapterhorn Terrarium RGB pixel into elevation in meters."""
    return (r * 256.0 + g + b / 256.0) - 32768.0


def encode_terrarium_rgb(elev_m: float) -> tuple[int, int, int]:
    """Encode elevation in meters into Terrarium (R, G, B) bytes (inverse of decode)."""
    v = max(0.0, min(65535.996, elev_m + 32768.0))
    r = int(v // 256.0)
    rem = v - r * 256.0
    g = int(rem)
    b = int(round((rem - g) * 256.0))
    if b >= 256:
        b = 0
        g += 1
        if g >= 256:
            g = 0
            r = min(255, r + 1)
    return (r, g, b)


class MapterhornDemSampler:
    """Concurrent-cached bilinear elevation sampler over Mapterhorn Terrarium tiles."""

    def __init__(
        self,
        *,
        zoom: int = 8,
        cache_dir: str = "data/dem_cache",
        tile_url_template: str = DEFAULT_TILE_URL_TEMPLATE,
        tile_size: int = 512,
        max_workers: int = 16,
    ) -> None:
        self.zoom = zoom
        self.cache_dir = cache_dir
        self.tile_url_template = tile_url_template
        self.tile_size = tile_size
        self.max_workers = max_workers
        self._tiles: dict[tuple[int, int], tuple[bytes, int, int] | None] = {}
        self._lock = threading.Lock()
        self._local = threading.local()

    def _get_session(self) -> requests.Session:
        sess = getattr(self._local, "session", None)
        if sess is None:
            sess = requests.Session()
            sess.headers.update({"User-Agent": "open-aerocharts/1.0"})
            self._local.session = sess
        return sess

    def _lon_lat_to_global_pixel(self, lon: float, lat: float) -> tuple[float, float]:
        n = 1 << self.zoom
        lat_c = max(-MAX_MERCATOR_LAT, min(MAX_MERCATOR_LAT, lat))
        gx = ((lon + 180.0) / 360.0) * n * self.tile_size
        gy = (1.0 - math.asinh(math.tan(math.radians(lat_c))) / math.pi) / 2.0 * n * self.tile_size
        return gx, gy

    def _tile_keys_for_coords(self, coords: Iterable[tuple[float, float]]) -> set[tuple[int, int]]:
        n = 1 << self.zoom
        ts = self.tile_size
        needed: set[tuple[int, int]] = set()
        for lon, lat in coords:
            gx, gy = self._lon_lat_to_global_pixel(lon, lat)
            ix0 = math.floor(gx - 0.5)
            iy0 = math.floor(gy - 0.5)
            for ix in (ix0, ix0 + 1):
                tx = (ix // ts) % n
                for iy in (iy0, iy0 + 1):
                    ty = max(0, min(n - 1, iy // ts))
                    needed.add((tx, ty))
        return needed

    def _load_or_fetch_tile(self, tx: int, ty: int) -> tuple[tuple[int, int], tuple[bytes, int, int] | None]:
        os.makedirs(self.cache_dir, exist_ok=True)
        cache_path = os.path.join(self.cache_dir, f"z{self.zoom}_{tx}_{ty}.webp")
        miss_path = f"{cache_path}.missing"

        if os.path.exists(miss_path):
            return (tx, ty), None

        raw: bytes | None = None
        if os.path.exists(cache_path):
            with open(cache_path, "rb") as f:
                raw = f.read()
        else:
            url = self.tile_url_template.format(z=self.zoom, x=tx, y=ty)
            try:
                resp = self._get_session().get(url, timeout=20)
                if resp.status_code == 404:
                    with open(miss_path, "wb"):
                        pass
                    return (tx, ty), None
                resp.raise_for_status()
                raw = resp.content
                tmp_path = f"{cache_path}.tmp.{threading.get_ident()}"
                with open(tmp_path, "wb") as f:
                    f.write(raw)
                os.replace(tmp_path, cache_path)
            except Exception as exc:
                print(f"  Warning: DEM tile z{self.zoom}/{tx}/{ty} fetch failed: {exc}")
                return (tx, ty), None

        try:
            with Image.open(io.BytesIO(raw)) as img:
                rgb = img.convert("RGB")
                return (tx, ty), (rgb.tobytes(), rgb.width, rgb.height)
        except Exception as exc:
            print(f"  Warning: DEM tile z{self.zoom}/{tx}/{ty} decode failed: {exc}")
            return (tx, ty), None

    def prefetch(self, coords: Iterable[tuple[float, float]]) -> int:
        """Fetch and decode all z-tiles needed for the given (lon, lat) coordinates."""
        needed = self._tile_keys_for_coords(coords)
        missing = [k for k in sorted(needed) if k not in self._tiles]
        if not missing:
            return 0

        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            for key, payload in executor.map(lambda xy: self._load_or_fetch_tile(xy[0], xy[1]), missing):
                with self._lock:
                    self._tiles[key] = payload
        return len(missing)

    def _pixel_elevation(self, gix: int, giy: int) -> float | None:
        n = 1 << self.zoom
        ts = self.tile_size
        tx = (gix // ts) % n
        ty = max(0, min(n - 1, giy // ts))

        tile = self._tiles.get((tx, ty))
        if tile is None and (tx, ty) not in self._tiles:
            _, tile = self._load_or_fetch_tile(tx, ty)
            self._tiles[(tx, ty)] = tile
        if tile is None:
            return None

        raw, width, height = tile
        lx = max(0, min(width - 1, gix % ts))
        ly = max(0, min(height - 1, giy % ts))
        idx = (ly * width + lx) * 3
        return decode_terrarium_rgb(raw[idx], raw[idx + 1], raw[idx + 2])

    def __call__(self, lon: float, lat: float) -> float:
        """Sample bilinear-interpolated ground elevation in meters MSL."""
        gx, gy = self._lon_lat_to_global_pixel(lon, lat)
        fx = gx - 0.5
        fy = gy - 0.5
        ix0 = math.floor(fx)
        iy0 = math.floor(fy)
        dx = fx - ix0
        dy = fy - iy0

        samples = [
            (self._pixel_elevation(ix0, iy0), (1.0 - dx) * (1.0 - dy)),
            (self._pixel_elevation(ix0 + 1, iy0), dx * (1.0 - dy)),
            (self._pixel_elevation(ix0, iy0 + 1), (1.0 - dx) * dy),
            (self._pixel_elevation(ix0 + 1, iy0 + 1), dx * dy),
        ]
        valid = [(val, w) for val, w in samples if val is not None]
        if not valid:
            return 0.0
        total_w = sum(w for _, w in valid)
        if total_w <= 0.0:
            return 0.0
        return sum(val * w for val, w in valid) / total_w
