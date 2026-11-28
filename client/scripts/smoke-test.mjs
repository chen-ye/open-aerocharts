import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
	getChromiumLaunchArgs,
	resolveGpuMode,
	waitForMapCanvasPixels,
} from "./playwright-gpu.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "..");
const distDir = path.join(clientDir, "dist");
const distIndexPath = path.join(distDir, "index.html");

const LFS_POINTER_MAX_BYTES = 512;
const REQUIRED_PMTILES = [
	"airspaces.pmtiles",
	"airspaces_3d.bin",
	"enroute.pmtiles",
	"boundary.pmtiles",
	"airports_navaids.pmtiles",
	"waypoints_obstacles.pmtiles",
	"airport_diagrams.pmtiles",
	"vfr.pmtiles",
];

const OFFLINE_STYLE = JSON.stringify({
	version: 8,
	sources: {},
	layers: [
		{
			id: "background",
			type: "background",
			paint: { "background-color": "#111827" },
		},
	],
});

async function getFreePort() {
	return await new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.unref();
		srv.on("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			if (!addr || typeof addr === "string") {
				srv.close(() => reject(new Error("Failed to allocate port")));
				return;
			}
			const { port } = addr;
			srv.close((err) => (err ? reject(err) : resolve(port)));
		});
	});
}

async function waitForServer(url, serverProcess, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (serverProcess.exitCode !== null) {
			throw new Error(
				`Preview server exited prematurely with code ${serverProcess.exitCode}`,
			);
		}
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// Server not listening yet
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`Timed out waiting for preview server at ${url}`);
}

async function cleanGoto(page, url) {
	await page.goto("about:blank", { waitUntil: "domcontentloaded" });
	await page.goto(url, { waitUntil: "domcontentloaded" });
}

async function waitForTwoFrames(page) {
	await page.evaluate(
		() =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	);
}

async function verifyBuiltAssets() {
	try {
		await fs.access(distIndexPath);
	} catch {
		throw new Error(
			`Built client not found at ${distIndexPath}. Run "npm run build -w client" first.`,
		);
	}

	for (const filename of REQUIRED_PMTILES) {
		const pmtilesPath = path.join(distDir, filename);
		let stats;
		try {
			stats = await fs.stat(pmtilesPath);
		} catch {
			throw new Error(
				`Missing ${pmtilesPath}. Run "git lfs pull" and "npm run build -w client".`,
			);
		}
		if (stats.size <= LFS_POINTER_MAX_BYTES) {
			throw new Error(
				`${pmtilesPath} looks like an unhydrated Git LFS pointer (${stats.size} bytes). Run "git lfs pull" and "npm run build -w client".`,
			);
		}
	}
}

async function main() {
	await verifyBuiltAssets();

	const port = await getFreePort();
	const localOrigin = `http://127.0.0.1:${port}`;
	const baseUrl = `${localOrigin}/open-aerocharts/`;

	let server;
	let browser;

	try {
		server = spawn(
			"npx",
			[
				"vite",
				"preview",
				"--host",
				"127.0.0.1",
				"--port",
				String(port),
				"--strictPort",
			],
			{
				cwd: clientDir,
				stdio: "pipe",
				detached: true,
			},
		);

		await waitForServer(baseUrl, server);

		const gpuMode = resolveGpuMode();
		console.log(`Running smoke test with Chromium WebGL backend: ${gpuMode}`);

		browser = await chromium.launch({
			headless: true,
			args: getChromiumLaunchArgs(gpuMode),
		});

		const context = await browser.newContext({
			viewport: { width: 1280, height: 720 },
		});
		const page = await context.newPage();

		const pageErrors = [];
		const consoleErrors = [];
		const failedLocalRequests = [];
		const searchIndexRequests = [];

		page.on("pageerror", (err) => pageErrors.push(String(err)));
		page.on("console", (msg) => {
			if (msg.type() === "error") consoleErrors.push(msg.text());
		});
		page.on("request", (req) => {
			if (new URL(req.url()).pathname.endsWith("/search_index.json")) {
				searchIndexRequests.push(req.url());
			}
		});
		page.on("response", (res) => {
			if (res.url().startsWith(localOrigin) && res.status() >= 400) {
				failedLocalRequests.push({ status: res.status(), url: res.url() });
			}
		});

		await page.addInitScript(() => {
			const getContext = HTMLCanvasElement.prototype.getContext;
			HTMLCanvasElement.prototype.getContext = function (type, options) {
				if (type === "webgl" || type === "webgl2") {
					return getContext.call(this, type, {
						...(options || {}),
						preserveDrawingBuffer: true,
					});
				}
				return getContext.call(this, type, options);
			};
		});

		// Keep smoke tests offline and deterministic by stubbing external style/DEM requests.
		await page.route("**/*", async (route) => {
			const url = new URL(route.request().url());

			if (url.origin !== localOrigin) {
				if (url.hostname === "api.protomaps.com") {
					await route.fulfill({
						status: 200,
						contentType: "application/json",
						body: OFFLINE_STYLE,
					});
					return;
				}
				if (url.hostname === "tiles.mapterhorn.com") {
					await route.fulfill({ status: 204 });
					return;
				}
				await route.abort();
				return;
			}

			await route.continue();
		});

		// 1. 2D Map + Core UI smoke checks
		await page.goto(`${baseUrl}#11.5/37.4638/-122.0056`, {
			waitUntil: "domcontentloaded",
		});
		await waitForMapCanvasPixels(page);
		const overlayCount2d = await page
			.locator(".maplibregl-ctrl-top-left div")
			.count();
		if (overlayCount2d !== 0) {
			throw new Error(
				`Expected AirspaceOverlay to stay deferred in 2D, found ${overlayCount2d} top-left controls`,
			);
		}

		const ghLinkAudit = await page.evaluate(() => {
			const link = document.querySelector('a[aria-label="View on GitHub"]');
			return {
				found: Boolean(link),
				nestedButtons: link ? link.querySelectorAll("button").length : -1,
				hasSvg: Boolean(link?.querySelector("svg")),
			};
		});
		if (
			!ghLinkAudit.found ||
			!ghLinkAudit.hasSvg ||
			ghLinkAudit.nestedButtons !== 0
		) {
			throw new Error(
				`GitHub link check failed: ${JSON.stringify(ghLinkAudit)}`,
			);
		}

		// Exercise FAA-aligned Chart Presets + URL round-trip + divergence clearing
		const vfrSectionalBtn = page.getByRole("button", { name: "VFR Sectional" });
		const vfrTerminalBtn = page.getByRole("button", { name: "VFR Terminal" });
		const helicopterBtn = page.getByRole("button", { name: "Helicopter" });
		const ifrLowBtn = page.getByRole("button", { name: "IFR Low" });
		const ifrHighBtn = page.getByRole("button", { name: "IFR High" });
		const cleanBtn = page.getByRole("button", { name: "Clean" });

		for (const btn of [
			vfrSectionalBtn,
			vfrTerminalBtn,
			helicopterBtn,
			ifrLowBtn,
			ifrHighBtn,
			cleanBtn,
		]) {
			if ((await btn.getAttribute("aria-pressed")) !== "false") {
				throw new Error("Expected no active preset on initial default load");
			}
		}

		await ifrLowBtn.click();
		await page.waitForFunction(() => {
			const p = new URLSearchParams(window.location.search);
			return (
				p.get("wptUsage") === "low" &&
				!p.has("terrain") &&
				!p.has("basemap") &&
				!p.has("density")
			);
		});
		if ((await ifrLowBtn.getAttribute("aria-pressed")) !== "true") {
			throw new Error("IFR Low preset should be active");
		}
		const lowRadio = page.getByRole("radio", { name: "Low" });
		if ((await lowRadio.getAttribute("aria-checked")) !== "true") {
			throw new Error("IFR Usage segmented control should select Low");
		}

		await ifrHighBtn.click();
		await page.waitForFunction(
			() =>
				new URLSearchParams(window.location.search).get("wptUsage") === "high",
		);
		if ((await ifrHighBtn.getAttribute("aria-pressed")) !== "true") {
			throw new Error("IFR High preset should be active");
		}

		// Reload the synced IFR High URL cleanly (cleanGoto avoids same-document #hash no-ops)
		const syncedIfrHighUrl = page.url();
		await cleanGoto(page, syncedIfrHighUrl);
		await waitForMapCanvasPixels(page);
		if (
			(await page
				.getByRole("button", { name: "IFR High" })
				.getAttribute("aria-pressed")) !== "true"
		) {
			throw new Error("IFR High preset should remain active after URL reload");
		}

		// Changing IFR Usage manually should clear the active preset highlight
		await page.getByRole("radio", { name: "All" }).click();
		await page.waitForFunction(
			() => !new URLSearchParams(window.location.search).has("wptUsage"),
		);
		if (
			(await page
				.getByRole("button", { name: "IFR High" })
				.getAttribute("aria-pressed")) !== "false"
		) {
			throw new Error("Manual IFR Usage edit should clear IFR High highlight");
		}

		// Test Light <-> Dark basemap swap clears preset highlight and preset click restores it
		await page.getByRole("button", { name: "IFR High" }).click();
		await page.waitForFunction(
			() =>
				new URLSearchParams(window.location.search).get("wptUsage") === "high",
		);
		await page.getByRole("combobox").click();
		await page.getByRole("option", { name: "Protomaps Light" }).click();
		await page.waitForFunction(() =>
			new URLSearchParams(window.location.search)
				.get("basemap")
				?.includes("/light/"),
		);
		if (
			(await page
				.getByRole("button", { name: "IFR High" })
				.getAttribute("aria-pressed")) !== "false"
		) {
			throw new Error(
				"Switching basemap to Protomaps Light should clear IFR High highlight",
			);
		}
		await page.getByRole("button", { name: "IFR High" }).click();
		await page.waitForFunction(
			() => !new URLSearchParams(window.location.search).has("basemap"),
		);

		await page.getByRole("button", { name: "Clean" }).click();
		if (
			(await page
				.getByRole("button", { name: "Clean" })
				.getAttribute("aria-pressed")) !== "true"
		) {
			throw new Error("Clean preset should be active");
		}

		// Toggle Settings panel
		await page.getByRole("button", { name: "Close Settings" }).click();
		await page.getByRole("button", { name: "Open Settings" }).waitFor();

		// Open Flight Plan panel, wait for lazy search index load, and plot a route
		if (searchIndexRequests.length !== 0) {
			throw new Error(
				`Expected search_index.json to stay deferred until Flight Plan opens, saw ${searchIndexRequests.length} request(s)`,
			);
		}
		await page.getByRole("button", { name: "Flight Plan" }).click();
		await page.getByText(/Database loaded \(\d+ points\)/).waitFor({
			timeout: 15000,
		});
		if (searchIndexRequests.length < 1) {
			throw new Error(
				"Expected opening Flight Plan to fetch search_index.json",
			);
		}
		await page
			.getByPlaceholder("KSJC TECKY4.VLREE EBAYE KLAX")
			.fill("KSJC KLAX");
		await page.getByRole("button", { name: "Plot Route" }).click();
		await page.getByText("Fixes (2)").waitFor({ timeout: 5000 });

		// 2. 3D tilted view (pitch > 10 mounts deck.gl MapLibreOverlay) + preset switching
		// Run terrain-enabled presets after the clean reload and 3D transition so SwiftShader
		// does not accumulate a multi-preset terrain mesh/FBO backlog before readback checks.
		await cleanGoto(page, `${baseUrl}#11/37.6213/-122.3790/0/55`);
		await page
			.locator(".maplibregl-ctrl-top-left div")
			.first()
			.waitFor({ state: "attached", timeout: 15000 });
		await waitForMapCanvasPixels(page);
		// Pan across 3D airspace viewport to exercise padded culling updates
		await page.mouse.move(640, 360);
		await page.mouse.down();
		await page.mouse.move(340, 260, { steps: 8 });
		await page.mouse.up();
		await waitForTwoFrames(page);
		await waitForMapCanvasPixels(page);
		// Toggle MapLibre GlobeControl on in 3D view and verify it persists across basemap swap
		await page.getByRole("button", { name: "Close Settings" }).click();
		await page.locator(".maplibregl-ctrl-globe").click();
		await page
			.locator(".maplibregl-ctrl-globe-enabled")
			.waitFor({ state: "attached", timeout: 5000 });
		await waitForTwoFrames(page);
		await waitForMapCanvasPixels(page);

		await page.getByRole("button", { name: "Open Settings" }).click();
		await page.getByRole("button", { name: "VFR Sectional" }).click();
		await page.waitForFunction(() => {
			const p = new URLSearchParams(window.location.search);
			return (
				p.get("terrain") === "true" && p.get("basemap")?.includes("/dark/")
			);
		});
		if (
			(await page
				.getByRole("button", { name: "VFR Sectional" })
				.getAttribute("aria-pressed")) !== "true"
		) {
			throw new Error("VFR Sectional preset should be active");
		}
		await waitForTwoFrames(page);
		await page
			.locator(".maplibregl-ctrl-globe-enabled")
			.waitFor({ state: "attached", timeout: 5000 });

		// Toggle back to Mercator
		await page.getByRole("button", { name: "Close Settings" }).click();
		await page.locator(".maplibregl-ctrl-globe-enabled").click();
		await page
			.locator(".maplibregl-ctrl-globe")
			.waitFor({ state: "attached", timeout: 5000 });
		await waitForTwoFrames(page);
		await page.getByRole("button", { name: "Open Settings" }).click();

		await page.getByRole("button", { name: "IFR High" }).click();
		await page.waitForFunction(
			() =>
				new URLSearchParams(window.location.search).get("wptUsage") ===
					"high" && !new URLSearchParams(window.location.search).has("terrain"),
		);
		await waitForTwoFrames(page);
		if ((await page.locator(".maplibregl-ctrl-top-left div").count()) === 0) {
			throw new Error(
				"Expected AirspaceOverlay to remain mounted in 3D IFR High (SUA/MOA enabled)",
			);
		}

		await page.getByRole("button", { name: "Clean" }).click();
		await waitForTwoFrames(page);
		if ((await page.locator(".maplibregl-ctrl-top-left div").count()) === 0) {
			throw new Error(
				"Expected AirspaceOverlay to remain latched after first 3D tilt on Clean",
			);
		}

		// 3. Remaining 2D terrain presets (VFR Terminal & Helicopter) + density=2->0 reset check
		await cleanGoto(page, `${baseUrl}#11.5/37.4638/-122.0056`);
		await waitForMapCanvasPixels(page);
		await page.getByRole("button", { name: "VFR Terminal" }).click();
		await page.waitForFunction(
			() => new URLSearchParams(window.location.search).get("density") === "2",
		);
		if (
			(await page
				.getByRole("button", { name: "VFR Terminal" })
				.getAttribute("aria-pressed")) !== "true"
		) {
			throw new Error("VFR Terminal preset should be active");
		}

		await page.getByRole("button", { name: "Helicopter" }).click();
		if (
			(await page
				.getByRole("button", { name: "Helicopter" })
				.getAttribute("aria-pressed")) !== "true"
		) {
			throw new Error("Helicopter preset should be active");
		}

		await page.getByRole("button", { name: "IFR Low" }).click();
		await page.waitForFunction(() => {
			const p = new URLSearchParams(window.location.search);
			return (
				p.get("wptUsage") === "low" &&
				!p.has("terrain") &&
				!p.has("basemap") &&
				!p.has("density")
			);
		});
		if (
			(await page
				.getByRole("button", { name: "IFR Low" })
				.getAttribute("aria-pressed")) !== "true"
		) {
			throw new Error("IFR Low preset should be active after Helicopter");
		}

		await page.getByRole("button", { name: "Clean" }).click();
		await waitForTwoFrames(page);

		if (
			pageErrors.length > 0 ||
			consoleErrors.length > 0 ||
			failedLocalRequests.length > 0
		) {
			throw new Error(
				JSON.stringify(
					{ pageErrors, consoleErrors, failedLocalRequests },
					null,
					2,
				),
			);
		}

		console.log(
			"Smoke test passed (2D + 3D MapLibreOverlay + FlightPlan + Settings)",
		);
	} finally {
		if (browser) {
			await browser.close().catch(() => {});
		}
		if (server?.pid) {
			try {
				process.kill(-server.pid, "SIGTERM");
			} catch {
				// Process group may already have exited
			}
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
