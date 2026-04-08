import { spawn } from "child_process";
import path from "path";
import { chromium } from "playwright";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
	console.log("Starting preview server...");
	const server = spawn("npm", ["run", "preview"], {
		cwd: path.resolve(__dirname, ".."),
		stdio: "ignore",
	});

	// Wait a bit for the server to start
	await new Promise((resolve) => setTimeout(resolve, 5000));

	console.log("Launching browser...");
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({
		viewport: { width: 1200, height: 630 },
		deviceScaleFactor: 2,
	});

	try {
		const url = "http://localhost:4173/open-aerocharts/#11.5/37.4638/-122.0056";
		console.log(`Navigating to ${url}...`);

		// Sometimes 'domcontentloaded' avoids hanging if resources fail to load fully
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

		console.log("Hiding UI elements...");
		// A style tag is safer than querying elements since React can re-render
		await page.addStyleTag({
			content: `
        .app-container > :not(:has(.maplibregl-map)) {
          display: none !important;
        }
        .maplibregl-control-container {
          display: none !important;
        }
      `,
		});

		console.log("Waiting for map tiles to render completely...");
		await page.waitForTimeout(15000);

		const outputPath = path.resolve(__dirname, "../public/aero-thumbnail.png");
		console.log(`Taking screenshot: ${outputPath}`);

		// Instead of elements or the full page (which may time out), screenshot the window viewport
		await page.screenshot({ path: outputPath });

		console.log("Screenshot completed successfully!");
		process.exit(0);
	} catch (error) {
		console.error("Error taking screenshot:", error);
		process.exit(1);
	} finally {
		console.log("Cleaning up...");
		await browser.close();
		server.kill();
	}
}

run();
