import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('Starting preview server...');
  const server = spawn('npm', ['run', 'preview'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore'
  });

  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2
  });

  // PMTiles relies on HTTP Range requests.
  // Playwright's `page.route` + `page.request.get` might not handle Range headers fully natively/efficiently
  // for binary files like pmtiles. Since MapLibre uses fetch for Range, let's just use the prod URL in the
  // browser directly so Range requests are native.

  // Wait, actually `fetch` will hit CORS issues if we rewrite URLs in Mapbox.
  // But wait, aerocharts.mikoding.com should have CORS enabled. Let's rewrite the initial MapLibre styles or just keep the proxy.
  // The previous screenshot was 996572 bytes. Wait, let's check what a successful run file size looks like.

  await page.route('**/*.pmtiles', async route => {
      const url = route.request().url();
      const filename = url.split('/').pop();
      const prodUrl = `https://aerocharts.mikoding.com/${filename}`;

      try {
          // fetch it via node fetch or page.request to bypass things if we need.
          // page.request.get supports headers like 'range' properly.
          const response = await page.request.get(prodUrl, {
              headers: route.request().headers()
          });
          route.fulfill({
              response,
              status: response.status(),
              headers: response.headers(),
              body: await response.body()
          });
      } catch (err) {
          console.error(`Failed to proxy ${prodUrl}`, err);
          route.abort();
      }
  });

  try {
    const url = 'http://localhost:4173/open-aerocharts/#11.5/37.4638/-122.0056';
    console.log(`Navigating to ${url}...`);

    await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, options) {
            if (type === 'webgl' || type === 'webgl2') {
                if (options) {
                    options.preserveDrawingBuffer = true;
                } else {
                    options = { preserveDrawingBuffer: true };
                }
            }
            return getContext.call(this, type, options);
        };
    });

    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    console.log('Hiding UI elements...');
    await page.addStyleTag({
      content: `
        [class*="SettingsPanel"],
        [class*="FlightPlanPanel"],
        [class*="MobileBottomSheet"] {
          display: none !important;
        }
        .maplibregl-control-container {
          display: none !important;
        }
      `
    });

    console.log('Waiting for map tiles to render completely...');
    await page.waitForTimeout(10000);

    const outputPath = path.resolve(__dirname, '../public/aero-thumbnail.png');
    console.log(`Taking screenshot to canvas: ${outputPath}`);

    const dataURL = await page.evaluate(() => {
        const canvas = document.querySelector('.maplibregl-canvas');
        if (!canvas) return null;
        return canvas.toDataURL('image/png');
    });

    if (dataURL && dataURL.length > 100) {
      const base64Data = dataURL.replace(/^data:image\/png;base64,/, "");
      fs.writeFileSync(outputPath, base64Data, 'base64');
      console.log('Screenshot completed via canvas.toDataURL!');
    } else {
      console.log('Canvas empty or not found, falling back to page.screenshot...');
      await page.screenshot({ path: outputPath, animations: "disabled", timeout: 30000 });
      console.log('Screenshot completed via page.screenshot!');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error taking screenshot:', error);
    process.exit(1);
  } finally {
    console.log('Cleaning up...');
    await browser.close();
    server.kill();
  }
}

run();
