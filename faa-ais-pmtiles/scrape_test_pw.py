import asyncio
from playwright.async_api import async_playwright

url = "https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        print(f"Loading {url}")
        await page.goto(url)
        # Wait for the table to load
        await page.wait_for_selector('a[href*="CSV.zip"]')
        links = await page.eval_on_selector_all('a[href*="CSV.zip"]', 'elements => elements.map(e => e.href)')
        for link in links:
            print(f"Found match: {link}")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
