from __future__ import annotations

import random
import time
from dataclasses import dataclass, field


@dataclass
class ProductResult:
    shop: str
    title: str
    price_eur: float
    url: str
    image_url: str | None = field(default=None)


def random_delay(min_s: float = 0.5, max_s: float = 1.5) -> None:
    """Synchronous random delay — used inside sync scraper threads."""
    time.sleep(random.uniform(min_s, max_s))


def make_sync_stealth_context(playwright):
    """
    Launch a headless Chromium browser with stealth patches (sync API).
    Returns (browser, context). Caller must call browser.close() when done.
    """
    from playwright_stealth import stealth_sync

    browser = playwright.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
        ],
    )
    context = browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 900},
        locale="nl-BE",
    )
    context._stealth_fn = stealth_sync
    return browser, context


def new_stealth_page(context):
    """Open a new page and apply playwright-stealth patches."""
    page = context.new_page()
    if hasattr(context, "_stealth_fn"):
        context._stealth_fn(page)
    return page
