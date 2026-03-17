"""Scraper for Carrefour.be."""
from __future__ import annotations

import asyncio
import logging
import re

from .base import ProductResult, make_sync_stealth_context, new_stealth_page, random_delay

logger = logging.getLogger(__name__)

_SEARCH_URL = "https://www.carrefour.be/nl/search?query={query}"

# JS extractor — runs inside the browser after the page loads
_EXTRACT_JS = """() => {
    const tiles = Array.from(document.querySelectorAll('div.product-tile.js-product-tile'));
    const results = [];
    for (const tile of tiles.slice(0, 12)) {
        // Skip out-of-stock items
        const text = tile.innerText || '';
        if (text.includes('Niet beschikbaar')) continue;

        // Title
        const nameEl = tile.querySelector('.pdp-link a.link, span.d-lg-none, span.mobile-name');
        const title = nameEl ? nameEl.innerText.trim() : null;
        if (!title || title.length < 3) continue;

        // URL
        const linkEl = tile.querySelector('.pdp-link a.link, a[href*="/nl/"]');
        const href = linkEl ? linkEl.getAttribute('href') : null;
        if (!href) continue;
        const url = href.startsWith('http') ? href : 'https://www.carrefour.be' + href;

        // Image
        const imgEl = tile.querySelector('img.tile-image, img');
        const img = imgEl ? (imgEl.src || imgEl.dataset.src || null) : null;

        // Price element (class="price" or nested inside price-wrapper)
        const priceEl = tile.querySelector('.price, .price-wrapper .price');
        const priceText = priceEl ? priceEl.innerText.trim() : null;

        results.push({title, url, img, priceText});
    }
    return results;
}"""


def _parse_price(price_text: str | None) -> float | None:
    """Extract a price in EUR from a text like '0,99 €' or 'Max.\\n1,87 €'."""
    if not price_text:
        return None
    # Find all decimal numbers (Belgian format uses comma as decimal separator)
    nums = re.findall(r"\d+[,.]\d+", price_text)
    if not nums:
        return None
    # Take the last match (handles "Max.\n1,87 €" → 1.87)
    return float(nums[-1].replace(",", "."))


def _scrape_sync(query: str) -> list[ProductResult]:
    from urllib.parse import quote_plus
    from playwright.sync_api import sync_playwright

    url = _SEARCH_URL.format(query=quote_plus(query))
    with sync_playwright() as p:
        browser, context = make_sync_stealth_context(p)
        page = new_stealth_page(context)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            random_delay(2, 3)

            # Accept cookie banner
            try:
                page.locator(
                    "button:has-text('Akkoord'), button:has-text('Accepteer'), "
                    "button:has-text('Tout accepter'), button:has-text('Alles accepteren'), "
                    "#onetrust-accept-btn-handler"
                ).first.click(timeout=5_000)
                random_delay(1, 2)
            except Exception:
                pass

            # Wait for product tiles to appear
            try:
                page.wait_for_selector("div.product-tile", timeout=10_000)
            except Exception:
                logger.warning("Carrefour: product tiles not found within timeout")

            random_delay(1, 2)

            raw = page.evaluate(_EXTRACT_JS)
            results: list[ProductResult] = []
            for item in raw:
                price = _parse_price(item.get("priceText"))
                if price is None or price <= 0:
                    continue
                results.append(
                    ProductResult(
                        shop="Carrefour",
                        title=item["title"],
                        price_eur=price,
                        url=item["url"],
                        image_url=item.get("img") or None,
                    )
                )
            logger.info("Carrefour: %d results", len(results))
            return results

        except Exception as exc:
            logger.error("Carrefour scrape failed: %s", exc)
            return []
        finally:
            browser.close()


async def scrape_carrefour(query: str) -> list[ProductResult]:
    return await asyncio.to_thread(_scrape_sync, query)
