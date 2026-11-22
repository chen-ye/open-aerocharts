import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "..");
const distDir = path.join(clientDir, "dist");
const distIndexPath = path.join(distDir, "index.html");

const LFS_POINTER_MAX_BYTES = 512;
const REQUIRED_PMTILES = [
	"airspaces.pmtiles",
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

async function waitForMapCanvasPixels(page) {
	await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30000 });
	await page.waitForFunction(
		() => {
			const canvas = document.querySelector("canvas.maplibregl-canvas");
			if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
			const probe = document.createElement("canvas");
			probe.width = 16;
			probe.height = 16;
			const ctx = probe.getContext("2d");
			if (!ctx) return false;
			ctx.drawImage(canvas, 0, 0, 16, 16);
			const { data } = ctx.getImageData(0, 0, 16, 16);
			for (let i = 3; i < data.length; i += 4) {
				if (data[i] > 0) return true;
			}
			return false;
		},
		null,
		{ timeout: 30000 },
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

		browser = await chromium.launch({
			headless: true,
			args: [
				"--use-gl=angle",
				"--use-angle=swiftshader",
				"--enable-webgl",
				"--enable-webgl2",
				"--ignore-gpu-blocklist",
			],
		});

		const context = await browser.newContext({
			viewport: { width: 1280, height: 720 },
		});
		const page = await context.newPage();

		const pageErrors = [];
		const consoleErrors = [];
		const failedLocalRequests = [];

		page.on("pageerror", (err) => pageErrors.push(String(err)));
		page.on("console", (msg) => {
			if (msg.type() === "error") consoleErrors.push(msg.text());
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

		// Keep smoke tests offline and deterministic by stubbing external style requests.
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

		// Toggle Settings panel
		await page.getByRole("button", { name: "Close Settings" }).click();
		await page.getByRole("button", { name: "Open Settings" }).waitFor();

		// Open Flight Plan panel, wait for search index, and plot a route
		await page.getByRole("button", { name: "Flight Plan" }).click();
		await page.getByText(/Database loaded \(\d+ points\)/).waitFor({
			timeout: 15000,
		});
		await page
			.getByPlaceholder("KSJC TECKY4.VLREE EBAYE KLAX")
			.fill("KSJC KLAX");
		await page.getByRole("button", { name: "Plot Route" }).click();
		await page.getByText("Fixes (2)").waitFor({ timeout: 5000 });

		// 2. 3D tilted view (pitch > 10 mounts deck.gl MapLibreOverlay)
		await page.goto(`${baseUrl}#11/37.6213/-122.3790/0/55`, {
			waitUntil: "domcontentloaded",
		});
		await waitForMapCanvasPixels(page);
		await page.waitForTimeout(500);

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
