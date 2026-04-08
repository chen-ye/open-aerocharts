import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5174/open-aerocharts/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto timeout'));
  // Wait a bit for everything to load
  await new Promise(r => setTimeout(r, 5000));

  // Try to click attribution if it's hidden
  try {
    await page.click('.maplibregl-ctrl-attrib-button');
    await new Promise(r => setTimeout(r, 1000));
  } catch(e) {}

  // Make attribution text larger and high contrast so we can see it clearly
  await page.evaluate(() => {
    const attr = document.querySelector('.maplibregl-ctrl-attrib-inner');
    if (attr) {
      attr.style.backgroundColor = 'white';
      attr.style.color = 'black';
      attr.style.padding = '10px';
      attr.style.fontSize = '24px';
      attr.style.fontWeight = 'bold';
    }
  });

  try {
    await page.screenshot({ path: '/home/jules/verification/screenshots/verification3.png', timeout: 5000 });
  } catch(e) {
    console.log('screenshot failed', e);
  }
  await browser.close();
})();
