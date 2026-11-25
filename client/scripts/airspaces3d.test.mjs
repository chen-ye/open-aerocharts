import assert from "node:assert/strict";
import test from "node:test";
import {
	AIRSPACE_3D_BIT,
	AIRSPACE_3D_COORD_SCALE,
	AIRSPACE_3D_MAGIC,
	AIRSPACE_3D_VERSION,
	computePaddedCullBounds,
	EMPTY_AIRSPACES_3D,
	isViewInsideCullBounds,
	normalizeLonIntervals,
	parseAirspaces3dBinary,
	selectVisibleAirspaces3d,
} from "../src/utils/airspaces3d.ts";

/**
 * Build a minimal valid A3D1 v2 binary payload for unit testing.
 *
 * @param {Array<{ z: number; mask: number; isAgl: boolean; rings: Array<Array<[number, number, number]>> }>} caps
 * @param {Array<{ z0: number; z1: number; wallMask: number; topMask: number; botMask: number; aglFlags: number; pts: Array<[number, number, number]> }>} chains
 */
function buildA3d1Buffer(caps, chains) {
	let byteLength = 16;
	for (const cap of caps) {
		byteLength += 8;
		for (const ring of cap.rings) {
			byteLength += 4 + ring.length * 10;
		}
	}
	for (const chain of chains) {
		byteLength += 16 + chain.pts.length * 10;
	}

	const buf = new ArrayBuffer(byteLength);
	const view = new DataView(buf);
	for (let i = 0; i < 4; i++) {
		view.setUint8(i, AIRSPACE_3D_MAGIC.charCodeAt(i));
	}
	view.setUint32(4, AIRSPACE_3D_VERSION, true);
	view.setUint32(8, caps.length, true);
	view.setUint32(12, chains.length, true);

	let offset = 16;
	for (const cap of caps) {
		view.setFloat32(offset, cap.z, true);
		view.setUint8(offset + 4, cap.mask);
		view.setUint8(offset + 5, cap.isAgl ? 1 : 0);
		view.setUint16(offset + 6, cap.rings.length, true);
		offset += 8;
		for (const ring of cap.rings) {
			view.setUint32(offset, ring.length, true);
			offset += 4;
			for (const [lon, lat, terrainM] of ring) {
				view.setInt32(offset, Math.round(lon * AIRSPACE_3D_COORD_SCALE), true);
				view.setInt32(
					offset + 4,
					Math.round(lat * AIRSPACE_3D_COORD_SCALE),
					true,
				);
				view.setInt16(offset + 8, terrainM, true);
				offset += 10;
			}
		}
	}

	for (const chain of chains) {
		view.setFloat32(offset, chain.z0, true);
		view.setFloat32(offset + 4, chain.z1, true);
		view.setUint8(offset + 8, chain.wallMask);
		view.setUint8(offset + 9, chain.topMask);
		view.setUint8(offset + 10, chain.botMask);
		view.setUint8(offset + 11, chain.aglFlags);
		view.setUint32(offset + 12, chain.pts.length, true);
		offset += 16;
		for (const [lon, lat, terrainM] of chain.pts) {
			view.setInt32(offset, Math.round(lon * AIRSPACE_3D_COORD_SCALE), true);
			view.setInt32(
				offset + 4,
				Math.round(lat * AIRSPACE_3D_COORD_SCALE),
				true,
			);
			view.setInt16(offset + 8, terrainM, true);
			offset += 10;
		}
	}

	return buf;
}

test("normalizeLonIntervals handles standard, wrapped, antimeridian, and global spans", () => {
	assert.deepEqual(normalizeLonIntervals(-123, -121), [[-123, -121]]);
	assert.deepEqual(normalizeLonIntervals(170, 190), [
		[170, 180],
		[-180, -170],
	]);
	assert.deepEqual(normalizeLonIntervals(-190, -170), [
		[170, 180],
		[-180, -170],
	]);
	assert.deepEqual(normalizeLonIntervals(175, -175), [
		[175, 180],
		[-180, -175],
	]);
	assert.deepEqual(normalizeLonIntervals(-200, 200), [[-180, 180]]);
});

test("computePaddedCullBounds and isViewInsideCullBounds enforce pad and zoom hysteresis", () => {
	assert.equal(
		computePaddedCullBounds({ west: -120, south: 10, east: 80, north: 60 }),
		null,
	);
	assert.equal(
		isViewInsideCullBounds(
			{ west: -100, south: 20, east: 50, north: 50 },
			null,
		),
		true,
	);
	// Re-tightens once user zooms below 90 deg span from unculled view
	assert.equal(
		isViewInsideCullBounds(
			{ west: -123, south: 37, east: -122, north: 38 },
			null,
		),
		false,
	);

	const sfoView = { west: -123.0, south: 37.1, east: -121.8, north: 38.1 };
	const pad = computePaddedCullBounds(sfoView);
	assert.ok(pad !== null);
	assert.ok(pad.west < sfoView.west && pad.east > sfoView.east);
	assert.ok(pad.south < sfoView.south && pad.north > sfoView.north);

	// Small pan stays inside hysteresis box
	assert.equal(
		isViewInsideCullBounds(
			{ west: -122.9, south: 37.2, east: -121.9, north: 38.0 },
			pad,
		),
		true,
	);
	// Panning past pad margin invalidates
	assert.equal(
		isViewInsideCullBounds(
			{ west: -119.0, south: 33.5, east: -117.8, north: 34.5 },
			pad,
		),
		false,
	);

	// Zooming deeply inside a wide padded box re-tightens (>4x span ratio)
	const regionalPad = computePaddedCullBounds({
		west: -130,
		south: 30,
		east: -110,
		north: 45,
	});
	assert.equal(
		isViewInsideCullBounds(
			{ west: -122.45, south: 37.55, east: -122.35, north: 37.65 },
			regionalPad,
		),
		false,
	);
});

test("parseAirspaces3dBinary and selectVisibleAirspaces3d slice caps, edges, and all 7 wall attributes", () => {
	const buf = buildA3d1Buffer(
		[
			// SFO Class B cap (AGL = false)
			{
				z: 3048,
				mask: AIRSPACE_3D_BIT.B,
				isAgl: false,
				rings: [
					[
						[-122.5, 37.5, 100],
						[-122.2, 37.5, 120],
						[-122.2, 37.8, 150],
					],
				],
			},
			// Guam SUA cap (AGL = true)
			{
				z: 1500,
				mask: AIRSPACE_3D_BIT.SUA,
				isAgl: true,
				rings: [
					[
						[144.7, 13.4, 50],
						[144.9, 13.4, 75],
						[144.9, 13.6, 80],
					],
				],
			},
		],
		[
			// Chain 0: SFO Class B (2 segments)
			{
				z0: 1000,
				z1: 3048,
				wallMask: AIRSPACE_3D_BIT.B,
				topMask: AIRSPACE_3D_BIT.B,
				botMask: 0,
				aglFlags: 0,
				pts: [
					[-122.5, 37.5, 10],
					[-122.3, 37.6, 20],
					[-122.2, 37.8, 30],
				],
			},
			// Chain 1: LAX Class C (1 segment)
			{
				z0: 0,
				z1: 1219,
				wallMask: AIRSPACE_3D_BIT.C,
				topMask: AIRSPACE_3D_BIT.C,
				botMask: AIRSPACE_3D_BIT.C,
				aglFlags: 1 | 4 | 8,
				pts: [
					[-118.5, 33.8, 40],
					[-118.3, 34.0, 55],
				],
			},
			// Chain 2: Guam SUA across antimeridian side (1 segment)
			{
				z0: 0,
				z1: 1500,
				wallMask: AIRSPACE_3D_BIT.SUA,
				topMask: AIRSPACE_3D_BIT.SUA,
				botMask: 0,
				aglFlags: 2 | 4,
				pts: [
					[144.7, 13.4, 60],
					[144.9, 13.6, 85],
				],
			},
		],
	);

	const parsed = parseAirspaces3dBinary(buf);
	assert.equal(parsed.caps.length, 2);
	assert.equal(parsed.edges.length, 4);
	assert.equal(parsed.walls.length, 4);
	assert.equal(parsed.wallChains.count, 3);
	assert.deepEqual(Array.from(parsed.wallChains.startSeg), [0, 2, 3]);
	assert.deepEqual(Array.from(parsed.wallChains.segCount), [2, 1, 1]);

	// Mask = 0 returns shared empty selection
	assert.equal(selectVisibleAirspaces3d(parsed, 0, null), EMPTY_AIRSPACES_3D);

	// Unculled + all masks reuses source walls zero-copy
	const full = selectVisibleAirspaces3d(parsed, 31, null);
	assert.equal(full.walls, parsed.walls);
	assert.equal(full.caps.length, 2);
	assert.equal(full.edges.length, 4);

	// Open ocean returns empty cleanly
	const ocean = selectVisibleAirspaces3d(parsed, 31, {
		west: -155,
		south: 25,
		east: -145,
		north: 30,
	});
	assert.equal(ocean.caps.length, 0);
	assert.equal(ocean.edges.length, 0);
	assert.equal(ocean.walls.length, 0);

	// LAX viewport slices only Chain 1 and verifies all 7 parallel attributes
	const lax = selectVisibleAirspaces3d(parsed, 31, {
		west: -119,
		south: 33,
		east: -118,
		north: 34.5,
	});
	assert.equal(lax.caps.length, 0);
	assert.equal(lax.edges.length, 2);
	assert.equal(lax.walls.length, 1);
	const a = lax.walls.attributes;
	assert.ok(Math.abs(a.instanceSourcePositions.value[0] - -118.5) < 1e-6);
	assert.ok(Math.abs(a.instanceTargetPositions.value[0] - -118.3) < 1e-6);
	assert.equal(a.instanceElevations.value[0], 1219);
	assert.equal(a.instanceMasks.value[0], AIRSPACE_3D_BIT.C);
	assert.equal(a.instanceSourceTerrain.value[0], 40);
	assert.equal(a.instanceTargetTerrain.value[0], 55);
	assert.equal(a.instanceAglFlags.value[0], 1 | 4 | 8);

	// Filtering visibleMask excludes matching regions cleanly
	assert.equal(
		selectVisibleAirspaces3d(parsed, AIRSPACE_3D_BIT.B, {
			west: -119,
			south: 33,
			east: -118,
			north: 34.5,
		}).walls.length,
		0,
	);

	// Antimeridian wrapped query around [-216, -214] (144..146 E) selects Guam
	const guamWrapped = selectVisibleAirspaces3d(parsed, AIRSPACE_3D_BIT.SUA, {
		west: -216,
		south: 13,
		east: -214,
		north: 14,
	});
	assert.equal(guamWrapped.caps.length, 1);
	assert.equal(guamWrapped.edges.length, 1);
	assert.equal(guamWrapped.walls.length, 1);
	// AGL cap adds terrainM to flat z
	assert.equal(guamWrapped.caps[0].polygonTerrain[0][0][2], 1550);
});

test("parseAirspaces3dBinary rejects invalid header payloads", () => {
	assert.throws(() => parseAirspaces3dBinary(new ArrayBuffer(8)), /Invalid/);
	const badMagic = new ArrayBuffer(16);
	assert.throws(() => parseAirspaces3dBinary(badMagic), /Unexpected/);
});
