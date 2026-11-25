import { getAirspaceColorRgb } from "./airspaceColors.ts";

export const AIRSPACE_3D_MAGIC = "A3D1";
export const AIRSPACE_3D_VERSION = 2;
export const AIRSPACE_3D_COORD_SCALE = 10_000_000;

export const AIRSPACE_3D_BIT = {
	B: 1,
	C: 2,
	D: 4,
	SUA: 8,
	TRSA: 16,
} as const;

const AGL_TOP_EDGE_BIT = 4;
const AGL_BOT_EDGE_BIT = 8;

export interface BBox2d {
	minLon: number;
	minLat: number;
	maxLon: number;
	maxLat: number;
}

export interface GeoViewportBounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

export interface AirspaceCap3d extends BBox2d {
	polygonFlat: [number, number, number][][];
	polygonTerrain: [number, number, number][][];
	mask: number;
}

export interface AirspaceEdge3d extends BBox2d {
	pathFlat: [number, number, number][];
	pathTerrain: [number, number, number][];
	mask: number;
}

export interface AirspaceWallBinaryData {
	length: number;
	attributes: {
		instanceSourcePositions: { value: Float64Array; size: 3 };
		instanceTargetPositions: { value: Float64Array; size: 3 };
		instanceElevations: { value: Float32Array; size: 1 };
		instanceMasks: { value: Float32Array; size: 1 };
		instanceSourceTerrain: { value: Float32Array; size: 1 };
		instanceTargetTerrain: { value: Float32Array; size: 1 };
		instanceAglFlags: { value: Float32Array; size: 1 };
	};
}

export interface AirspaceWallChainIndex {
	count: number;
	startSeg: Uint32Array;
	segCount: Uint32Array;
	masks: Uint8Array;
	minLon: Float64Array;
	minLat: Float64Array;
	maxLon: Float64Array;
	maxLat: Float64Array;
}

export interface ParsedAirspaces3d {
	caps: AirspaceCap3d[];
	edges: AirspaceEdge3d[];
	walls: AirspaceWallBinaryData;
	wallChains: AirspaceWallChainIndex;
}

export interface SelectedAirspaces3d {
	caps: AirspaceCap3d[];
	edges: AirspaceEdge3d[];
	walls: AirspaceWallBinaryData;
}

export const EMPTY_AIRSPACES_3D: SelectedAirspaces3d = {
	caps: [],
	edges: [],
	walls: {
		length: 0,
		attributes: {
			instanceSourcePositions: { value: new Float64Array(0), size: 3 },
			instanceTargetPositions: { value: new Float64Array(0), size: 3 },
			instanceElevations: { value: new Float32Array(0), size: 1 },
			instanceMasks: { value: new Float32Array(0), size: 1 },
			instanceSourceTerrain: { value: new Float32Array(0), size: 1 },
			instanceTargetTerrain: { value: new Float32Array(0), size: 1 },
			instanceAglFlags: { value: new Float32Array(0), size: 1 },
		},
	},
};

export type RgbaFloatTuple = [number, number, number, number];

export function getAirspace3dVisibleMask(params: {
	showAirspaceMaster: boolean;
	controlledAirspace: boolean;
	suaMoa: boolean;
	trsa: boolean;
}): number {
	if (!params.showAirspaceMaster) return 0;
	let mask = 0;
	if (params.controlledAirspace) {
		mask |= AIRSPACE_3D_BIT.B | AIRSPACE_3D_BIT.C | AIRSPACE_3D_BIT.D;
	}
	if (params.suaMoa) {
		mask |= AIRSPACE_3D_BIT.SUA;
	}
	if (params.trsa) {
		mask |= AIRSPACE_3D_BIT.TRSA;
	}
	return mask;
}

export function pickAirspaceMaskColorRgb(
	mask: number,
	visibleMask: number,
): [number, number, number] | null {
	const active = mask & visibleMask;
	if (active === 0) return null;
	if (active & AIRSPACE_3D_BIT.B) return getAirspaceColorRgb("B", false);
	if (active & AIRSPACE_3D_BIT.C) return getAirspaceColorRgb("C", false);
	if (active & AIRSPACE_3D_BIT.D) return getAirspaceColorRgb("D", false);
	if (active & AIRSPACE_3D_BIT.SUA) return getAirspaceColorRgb("", true);
	if (active & AIRSPACE_3D_BIT.TRSA) return getAirspaceColorRgb("TRSA", false);
	return null;
}

export function getAirspace3dPalette(alphaByte: number): {
	colorB: RgbaFloatTuple;
	colorC: RgbaFloatTuple;
	colorD: RgbaFloatTuple;
	colorSua: RgbaFloatTuple;
	colorTrsa: RgbaFloatTuple;
} {
	const alpha = alphaByte / 255;
	const toNorm = ([r, g, b]: [number, number, number]): RgbaFloatTuple => [
		r / 255,
		g / 255,
		b / 255,
		alpha,
	];
	return {
		colorB: toNorm(getAirspaceColorRgb("B", false)),
		colorC: toNorm(getAirspaceColorRgb("C", false)),
		colorD: toNorm(getAirspaceColorRgb("D", false)),
		colorSua: toNorm(getAirspaceColorRgb("", true)),
		colorTrsa: toNorm(getAirspaceColorRgb("TRSA", false)),
	};
}

export function parseAirspaces3dBinary(buffer: ArrayBuffer): ParsedAirspaces3d {
	const view = new DataView(buffer);
	if (buffer.byteLength < 16) {
		throw new Error(`Invalid airspaces_3d binary length: ${buffer.byteLength}`);
	}

	const magic = String.fromCharCode(
		view.getUint8(0),
		view.getUint8(1),
		view.getUint8(2),
		view.getUint8(3),
	);
	if (magic !== AIRSPACE_3D_MAGIC) {
		throw new Error(`Unexpected airspaces_3d magic: ${magic}`);
	}

	const version = view.getUint32(4, true);
	if (version !== AIRSPACE_3D_VERSION) {
		throw new Error(`Unsupported airspaces_3d version: ${version}`);
	}

	const numCaps = view.getUint32(8, true);
	const numWallChains = view.getUint32(12, true);

	let offset = 16;
	const caps: AirspaceCap3d[] = new Array(numCaps);

	for (let c = 0; c < numCaps; c++) {
		const z = view.getFloat32(offset, true);
		const mask = view.getUint8(offset + 4);
		const isAgl = view.getUint8(offset + 5) !== 0;
		const numRings = view.getUint16(offset + 6, true);
		offset += 8;

		const polygonFlat: [number, number, number][][] = new Array(numRings);
		const polygonTerrain: [number, number, number][][] = isAgl
			? new Array(numRings)
			: polygonFlat;

		let capMinLon = Infinity;
		let capMinLat = Infinity;
		let capMaxLon = -Infinity;
		let capMaxLat = -Infinity;

		for (let r = 0; r < numRings; r++) {
			const numPts = view.getUint32(offset, true);
			offset += 4;
			const ringFlat: [number, number, number][] = new Array(numPts);
			const ringTerrain: [number, number, number][] = isAgl
				? new Array(numPts)
				: ringFlat;
			for (let p = 0; p < numPts; p++) {
				const lon = view.getInt32(offset, true) / AIRSPACE_3D_COORD_SCALE;
				const lat = view.getInt32(offset + 4, true) / AIRSPACE_3D_COORD_SCALE;
				const terrainM = view.getInt16(offset + 8, true);
				offset += 10;
				if (lon < capMinLon) capMinLon = lon;
				if (lon > capMaxLon) capMaxLon = lon;
				if (lat < capMinLat) capMinLat = lat;
				if (lat > capMaxLat) capMaxLat = lat;
				ringFlat[p] = [lon, lat, z];
				if (isAgl) {
					ringTerrain[p] = [lon, lat, z + terrainM];
				}
			}
			polygonFlat[r] = ringFlat;
			if (isAgl) {
				polygonTerrain[r] = ringTerrain;
			}
		}
		caps[c] = {
			polygonFlat,
			polygonTerrain,
			mask,
			minLon: capMinLon,
			minLat: capMinLat,
			maxLon: capMaxLon,
			maxLat: capMaxLat,
		};
	}

	// Pass 1 over wall chains: count total wall segments to allocate typed arrays once.
	const wallChainsStart = offset;
	let totalSegments = 0;
	for (let w = 0; w < numWallChains; w++) {
		const numPts = view.getUint32(offset + 12, true);
		offset += 16 + numPts * 10;
		if (numPts >= 2) {
			totalSegments += numPts - 1;
		}
	}

	const sourcePositions = new Float64Array(totalSegments * 3);
	const targetPositions = new Float64Array(totalSegments * 3);
	const elevations = new Float32Array(totalSegments);
	const masks = new Float32Array(totalSegments);
	const sourceTerrain = new Float32Array(totalSegments);
	const targetTerrain = new Float32Array(totalSegments);
	const aglFlagsArr = new Float32Array(totalSegments);
	const chainStartSeg = new Uint32Array(numWallChains);
	const chainSegCount = new Uint32Array(numWallChains);
	const chainMasks = new Uint8Array(numWallChains);
	const chainMinLon = new Float64Array(numWallChains);
	const chainMinLat = new Float64Array(numWallChains);
	const chainMaxLon = new Float64Array(numWallChains);
	const chainMaxLat = new Float64Array(numWallChains);
	const edges: AirspaceEdge3d[] = [];

	offset = wallChainsStart;
	let segIdx = 0;

	for (let w = 0; w < numWallChains; w++) {
		const z0 = view.getFloat32(offset, true);
		const z1 = view.getFloat32(offset + 4, true);
		const wallMask = view.getUint8(offset + 8);
		const topMask = view.getUint8(offset + 9);
		const botMask = view.getUint8(offset + 10);
		const aglFlags = view.getUint8(offset + 11);
		const numPts = view.getUint32(offset + 12, true);
		offset += 16;

		const dz = z1 - z0;
		const topIsAgl = (aglFlags & AGL_TOP_EDGE_BIT) !== 0;
		const botIsAgl = (aglFlags & AGL_BOT_EDGE_BIT) !== 0;

		const topFlat: [number, number, number][] | null =
			topMask !== 0 ? new Array(numPts) : null;
		const topTerrain: [number, number, number][] | null =
			topMask !== 0 ? (topIsAgl ? new Array(numPts) : topFlat) : null;

		const botFlat: [number, number, number][] | null =
			botMask !== 0 ? new Array(numPts) : null;
		const botTerrain: [number, number, number][] | null =
			botMask !== 0 ? (botIsAgl ? new Array(numPts) : botFlat) : null;

		const botZFlat = z0 === 0 ? 2 : z0;

		const chainFirstSeg = segIdx;
		let cMinLon = Infinity;
		let cMinLat = Infinity;
		let cMaxLon = -Infinity;
		let cMaxLat = -Infinity;

		let prevLon = 0;
		let prevLat = 0;
		let prevTerrain = 0;

		for (let p = 0; p < numPts; p++) {
			const lon = view.getInt32(offset, true) / AIRSPACE_3D_COORD_SCALE;
			const lat = view.getInt32(offset + 4, true) / AIRSPACE_3D_COORD_SCALE;
			const terrainM = view.getInt16(offset + 8, true);
			offset += 10;

			if (lon < cMinLon) cMinLon = lon;
			if (lon > cMaxLon) cMaxLon = lon;
			if (lat < cMinLat) cMinLat = lat;
			if (lat > cMaxLat) cMaxLat = lat;

			if (topFlat) {
				topFlat[p] = [lon, lat, z1];
				if (topIsAgl && topTerrain) {
					topTerrain[p] = [lon, lat, z1 + terrainM];
				}
			}
			if (botFlat) {
				botFlat[p] = [lon, lat, botZFlat];
				if (botIsAgl && botTerrain) {
					botTerrain[p] = [lon, lat, (z0 === 0 ? 2 : z0) + terrainM];
				}
			}

			if (p > 0) {
				const base = segIdx * 3;
				sourcePositions[base] = prevLon;
				sourcePositions[base + 1] = prevLat;
				sourcePositions[base + 2] = z0;
				targetPositions[base] = lon;
				targetPositions[base + 1] = lat;
				targetPositions[base + 2] = z0;
				elevations[segIdx] = dz;
				masks[segIdx] = wallMask;
				sourceTerrain[segIdx] = prevTerrain;
				targetTerrain[segIdx] = terrainM;
				aglFlagsArr[segIdx] = aglFlags;
				segIdx++;
			}

			prevLon = lon;
			prevLat = lat;
			prevTerrain = terrainM;
		}

		chainStartSeg[w] = chainFirstSeg;
		chainSegCount[w] = segIdx - chainFirstSeg;
		chainMasks[w] = wallMask;
		chainMinLon[w] = cMinLon;
		chainMinLat[w] = cMinLat;
		chainMaxLon[w] = cMaxLon;
		chainMaxLat[w] = cMaxLat;

		if (topFlat && topTerrain) {
			edges.push({
				pathFlat: topFlat,
				pathTerrain: topTerrain,
				mask: topMask,
				minLon: cMinLon,
				minLat: cMinLat,
				maxLon: cMaxLon,
				maxLat: cMaxLat,
			});
		}
		if (botFlat && botTerrain) {
			edges.push({
				pathFlat: botFlat,
				pathTerrain: botTerrain,
				mask: botMask,
				minLon: cMinLon,
				minLat: cMinLat,
				maxLon: cMaxLon,
				maxLat: cMaxLat,
			});
		}
	}

	return {
		caps,
		edges,
		walls: {
			length: totalSegments,
			attributes: {
				instanceSourcePositions: { value: sourcePositions, size: 3 },
				instanceTargetPositions: { value: targetPositions, size: 3 },
				instanceElevations: { value: elevations, size: 1 },
				instanceMasks: { value: masks, size: 1 },
				instanceSourceTerrain: { value: sourceTerrain, size: 1 },
				instanceTargetTerrain: { value: targetTerrain, size: 1 },
				instanceAglFlags: { value: aglFlagsArr, size: 1 },
			},
		},
		wallChains: {
			count: numWallChains,
			startSeg: chainStartSeg,
			segCount: chainSegCount,
			masks: chainMasks,
			minLon: chainMinLon,
			minLat: chainMinLat,
			maxLon: chainMaxLon,
			maxLat: chainMaxLat,
		},
	};
}

export function normalizeLonIntervals(
	west: number,
	east: number,
): [number, number][] {
	const span = east - west;
	if (!Number.isFinite(span) || span >= 360) {
		return [[-180, 180]];
	}
	if (span < 0) {
		// Defensive handle for raw antimeridian bounds where east < west
		return [
			[Math.max(-180, west), 180],
			[-180, Math.min(180, east)],
		];
	}
	const w = ((((west + 180) % 360) + 360) % 360) - 180;
	const e = w + span;
	if (e <= 180) {
		return [[w, e]];
	}
	return [
		[w, 180],
		[-180, e - 360],
	];
}

export function computePaddedCullBounds(
	view: GeoViewportBounds,
): GeoViewportBounds | null {
	const spanLon = view.east - view.west;
	if (!Number.isFinite(spanLon) || spanLon >= 180) {
		return null;
	}
	const clampedSpanLon = Math.max(0.01, spanLon);
	const clampedSpanLat = Math.max(0.01, view.north - view.south);
	const padLon = Math.min(20, Math.max(0.25, clampedSpanLon * 0.5));
	const padLat = Math.min(20, Math.max(0.25, clampedSpanLat * 0.5));
	return {
		west: view.west - padLon,
		south: Math.max(-90, view.south - padLat),
		east: view.east + padLon,
		north: Math.min(90, view.north + padLat),
	};
}

export function isViewInsideCullBounds(
	view: GeoViewportBounds,
	cull: GeoViewportBounds | null,
): boolean {
	const viewSpanLon = Math.max(0.01, view.east - view.west);
	if (cull === null) {
		// Stay unculled while wide; re-tighten once user zooms below 90° span.
		return viewSpanLon >= 90;
	}
	if (
		view.west < cull.west ||
		view.east > cull.east ||
		view.south < cull.south ||
		view.north > cull.north
	) {
		return false;
	}
	const viewSpanLat = Math.max(0.01, view.north - view.south);
	const cullSpanLon = cull.east - cull.west;
	const cullSpanLat = cull.north - cull.south;
	if (
		cullSpanLon > Math.max(1.5, viewSpanLon * 4) ||
		cullSpanLat > Math.max(1.5, viewSpanLat * 4)
	) {
		return false;
	}
	return true;
}

function overlapsLonIntervals(
	minLon: number,
	maxLon: number,
	intervals: [number, number][],
): boolean {
	for (let i = 0; i < intervals.length; i++) {
		const [w, e] = intervals[i];
		if (maxLon >= w && minLon <= e) return true;
	}
	return false;
}

export function selectVisibleAirspaces3d(
	parsed: ParsedAirspaces3d,
	visibleMask: number,
	cullBounds: GeoViewportBounds | null,
): SelectedAirspaces3d {
	if (visibleMask === 0) {
		return EMPTY_AIRSPACES_3D;
	}

	const lonIntervals = cullBounds
		? normalizeLonIntervals(cullBounds.west, cullBounds.east)
		: null;
	const south = cullBounds ? cullBounds.south : -90;
	const north = cullBounds ? cullBounds.north : 90;

	const caps = parsed.caps.filter(
		(c) =>
			(c.mask & visibleMask) !== 0 &&
			c.maxLat >= south &&
			c.minLat <= north &&
			(!lonIntervals || overlapsLonIntervals(c.minLon, c.maxLon, lonIntervals)),
	);

	const edges = parsed.edges.filter(
		(e) =>
			(e.mask & visibleMask) !== 0 &&
			e.maxLat >= south &&
			e.minLat <= north &&
			(!lonIntervals || overlapsLonIntervals(e.minLon, e.maxLon, lonIntervals)),
	);

	const { wallChains, walls: srcWalls } = parsed;
	const chainCount = wallChains.count;
	const matchedChains: number[] = [];
	let totalSelectedSegs = 0;

	for (let i = 0; i < chainCount; i++) {
		const segCount = wallChains.segCount[i];
		if (segCount === 0 || (wallChains.masks[i] & visibleMask) === 0) {
			continue;
		}
		if (
			cullBounds &&
			(wallChains.maxLat[i] < south ||
				wallChains.minLat[i] > north ||
				(lonIntervals &&
					!overlapsLonIntervals(
						wallChains.minLon[i],
						wallChains.maxLon[i],
						lonIntervals,
					)))
		) {
			continue;
		}
		matchedChains.push(i);
		totalSelectedSegs += segCount;
	}

	let walls: AirspaceWallBinaryData;
	if (totalSelectedSegs === 0) {
		walls = EMPTY_AIRSPACES_3D.walls;
	} else if (totalSelectedSegs === srcWalls.length) {
		walls = srcWalls;
	} else {
		const srcAttr = srcWalls.attributes;
		const srcPos = srcAttr.instanceSourcePositions.value;
		const dstPos = srcAttr.instanceTargetPositions.value;
		const srcElev = srcAttr.instanceElevations.value;
		const srcMask = srcAttr.instanceMasks.value;
		const srcSrcTerr = srcAttr.instanceSourceTerrain.value;
		const srcDstTerr = srcAttr.instanceTargetTerrain.value;
		const srcAgl = srcAttr.instanceAglFlags.value;

		const outSrcPos = new Float64Array(totalSelectedSegs * 3);
		const outDstPos = new Float64Array(totalSelectedSegs * 3);
		const outElev = new Float32Array(totalSelectedSegs);
		const outMask = new Float32Array(totalSelectedSegs);
		const outSrcTerr = new Float32Array(totalSelectedSegs);
		const outDstTerr = new Float32Array(totalSelectedSegs);
		const outAgl = new Float32Array(totalSelectedSegs);

		let outSeg = 0;
		for (let idx = 0; idx < matchedChains.length; idx++) {
			const c = matchedChains[idx];
			const start = wallChains.startSeg[c];
			const count = wallChains.segCount[c];
			const end = start + count;
			const start3 = start * 3;
			const end3 = end * 3;
			const out3 = outSeg * 3;

			outSrcPos.set(srcPos.subarray(start3, end3), out3);
			outDstPos.set(dstPos.subarray(start3, end3), out3);
			outElev.set(srcElev.subarray(start, end), outSeg);
			outMask.set(srcMask.subarray(start, end), outSeg);
			outSrcTerr.set(srcSrcTerr.subarray(start, end), outSeg);
			outDstTerr.set(srcDstTerr.subarray(start, end), outSeg);
			outAgl.set(srcAgl.subarray(start, end), outSeg);
			outSeg += count;
		}

		walls = {
			length: totalSelectedSegs,
			attributes: {
				instanceSourcePositions: { value: outSrcPos, size: 3 },
				instanceTargetPositions: { value: outDstPos, size: 3 },
				instanceElevations: { value: outElev, size: 1 },
				instanceMasks: { value: outMask, size: 1 },
				instanceSourceTerrain: { value: outSrcTerr, size: 1 },
				instanceTargetTerrain: { value: outDstTerr, size: 1 },
				instanceAglFlags: { value: outAgl, size: 1 },
			},
		};
	}

	return { caps, edges, walls };
}

const cachedLoads = new Map<string, Promise<ParsedAirspaces3d>>();

export function loadAirspaces3d(url: string): Promise<ParsedAirspaces3d> {
	const existing = cachedLoads.get(url);
	if (existing) return existing;

	const promise = fetch(url)
		.then((res) => {
			if (!res.ok) {
				throw new Error(
					`Failed to fetch ${url}: ${res.status} ${res.statusText}`,
				);
			}
			return res.arrayBuffer();
		})
		.then(parseAirspaces3dBinary)
		.catch((err) => {
			cachedLoads.delete(url);
			throw err;
		});

	cachedLoads.set(url, promise);
	return promise;
}
