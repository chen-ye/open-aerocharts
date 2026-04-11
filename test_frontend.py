import time
from playwright.sync_api import sync_playwright
import os

def run_cuj(page):
    for _ in range(30):
        try:
            page.goto("http://localhost:5173", timeout=2000)
            break
        except Exception:
            time.sleep(1)

    page.wait_for_timeout(5000)

    # Just take a screenshot of the default map if settings aren't easily openable
    os.makedirs("/home/jules/verification/screenshots", exist_ok=True)
    page.screenshot(path="/home/jules/verification/screenshots/verification.png")
    page.wait_for_timeout(2000)

if __name__ == "__main__":
    os.makedirs("/home/jules/verification/videos", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos",
            viewport={"width": 1280, "height": 720}
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()
            browser.close()
