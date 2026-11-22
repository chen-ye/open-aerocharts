import { getAirspaceColorRgb } from "./airspaceColors";

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

export interface AirspaceCap3d {
	polygonFlat: [number, number, number][][];
	polygonTerrain: [number, number, number][][];
	mask: number;
}

export interface AirspaceEdge3d {
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

export interface ParsedAirspaces3d {
	caps: AirspaceCap3d[];
	edges: AirspaceEdge3d[];
	walls: AirspaceWallBinaryData;
}

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
		caps[c] = { polygonFlat, polygonTerrain, mask };
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

		let prevLon = 0;
		let prevLat = 0;
		let prevTerrain = 0;

		for (let p = 0; p < numPts; p++) {
			const lon = view.getInt32(offset, true) / AIRSPACE_3D_COORD_SCALE;
			const lat = view.getInt32(offset + 4, true) / AIRSPACE_3D_COORD_SCALE;
			const terrainM = view.getInt16(offset + 8, true);
			offset += 10;

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

		if (topFlat && topTerrain) {
			edges.push({ pathFlat: topFlat, pathTerrain: topTerrain, mask: topMask });
		}
		if (botFlat && botTerrain) {
			edges.push({ pathFlat: botFlat, pathTerrain: botTerrain, mask: botMask });
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
	};
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
