import { spawn } from "node:child_process";
import fs from "node:fs/promises";
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
const publicDir = path.join(clientDir, "public");
const distDir = path.join(clientDir, "dist");
const distIndexPath = path.join(distDir, "index.html");
const outputArgIndex = process.argv.indexOf("--output");
const baseCwd = process.env.INIT_CWD || process.cwd();
const outputPath =
	outputArgIndex !== -1 && process.argv[outputArgIndex + 1]
		? path.resolve(baseCwd, process.argv[outputArgIndex + 1])
		: path.join(publicDir, "aero-thumbnail.png");

const PREVIEW_PORT = 4173;
const BASE_URL = `http://localhost:${PREVIEW_PORT}/open-aerocharts/`;
const TARGET_URL = `${BASE_URL}#11.5/37.4638/-122.0056`;
const REMOTE_PMTILES_ORIGIN = "https://chen-ye.github.io/open-aerocharts";
const LFS_POINTER_MAX_BYTES = 512;

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
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for preview server at ${url}`);
}

async function main() {
	try {
		await fs.access(distIndexPath);
	} catch {
		throw new Error(
			`Built client not found at ${distIndexPath}. Run "npm run build -w client" first.`,
		);
	}

	let server;
	let browser;

	try {
		server = spawn(
			"npx",
			["vite", "preview", "--port", String(PREVIEW_PORT), "--strictPort"],
			{
				cwd: clientDir,
				stdio: "inherit",
				detached: true,
			},
		);

		await waitForServer(BASE_URL, server);

		const gpuMode = resolveGpuMode();
		console.log(`Updating thumbnail with Chromium WebGL backend: ${gpuMode}`);
		browser = await chromium.launch({
			headless: true,
			args: getChromiumLaunchArgs(gpuMode),
		});

		const context = await browser.newContext({
			viewport: { width: 1280, height: 630 },
		});
		const page = await context.newPage();

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

		await page.route("**/*.pmtiles", async (route) => {
			try {
				const request = route.request();
				const url = new URL(request.url());
				const filename = path.basename(url.pathname);
				const distPath = path.join(distDir, filename);

				let hasLocalPmtiles = false;
				try {
					const stats = await fs.stat(distPath);
					hasLocalPmtiles = stats.size > LFS_POINTER_MAX_BYTES;
				} catch {
					hasLocalPmtiles = false;
				}

				if (hasLocalPmtiles) {
					await route.continue();
					return;
				}

				const remoteUrl = `${REMOTE_PMTILES_ORIGIN}/${filename}`;
				const forwardHeaders = {
					"accept-encoding": "identity",
				};
				const reqHeaders = request.headers();
				for (const headerName of ["range", "if-range", "accept"]) {
					if (reqHeaders[headerName]) {
						forwardHeaders[headerName] = reqHeaders[headerName];
					}
				}

				const res = await fetch(remoteUrl, {
					method: request.method(),
					headers: forwardHeaders,
				});
				const body = Buffer.from(await res.arrayBuffer());
				const respHeaders = {};
				for (const headerName of [
					"content-type",
					"content-range",
					"accept-ranges",
					"etag",
					"last-modified",
					"access-control-allow-origin",
				]) {
					const val = res.headers.get(headerName);
					if (val !== null) {
						respHeaders[headerName] = val;
					}
				}

				await route.fulfill({
					status: res.status,
					headers: respHeaders,
					body,
				});
			} catch {
				await route.abort().catch(() => {});
			}
		});

		await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

		await page.addStyleTag({
			content:
				".settings-panel-container, .map-feature-panel, .desktop-only, .mobile-only, .maplibregl-control-container { display: none !important; }",
		});

		await waitForMapCanvasPixels(page);

		await page
			.waitForLoadState("networkidle", { timeout: 30000 })
			.catch(() => {});
		await page.waitForTimeout(1500);

		await page.screenshot({
			path: outputPath,
			type: "png",
		});

		console.log(`Captured thumbnail to ${outputPath}`);
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
