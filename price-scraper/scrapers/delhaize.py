"""Scraper for Delhaize.be."""
from __future__ import annotations

import asyncio
import logging
import re

from .base import ProductResult, make_sync_stealth_context, new_stealth_page, random_delay

logger = logging.getLogger(__name__)

_SEARCH_URL = "https://www.delhaize.be/nl/shop/search?query={query}"

_EXTRACT_JS = """() => {
    const tiles = Array.from(document.querySelectorAll('li[class*="product-item"], li[class*="product-tile"]'));
    return tiles.slice(0, 12).map(tile => {
        // Title
        const titleEl = tile.querySelector('[class*="product-tile-title"], h3, h2, [class*="title"]');
        const title = titleEl ? titleEl.innerText.trim() : null;

        // URL
        const linkEl = tile.querySelector('a[href*="/nl/shop/"]');
        const href = linkEl ? linkEl.href : null;

        // Image
        const imgEl = tile.querySelector('img');
        const img = imgEl ? (imgEl.src || imgEl.dataset.src || null) : null;

        // Price is split across DOM nodes as: €  {integer}  {decimal}
        // We parse it from the tile's innerText
        const innerText = tile.innerText || '';

        return {title, href, img, innerText};
    }).filter(x => x.title && x.href);
}"""


def _parse_delhaize_price(inner_text: str) -> float | None:
    """
    Delhaize renders prices as split DOM nodes: '€\\n12\\n69' → €12.69.
    We match that pattern in the innerText string.
    """
    # Primary pattern: € on its own line, then integer, then decimal
    m = re.search(r"€\s*\n\s*(\d+)\s*\n\s*(\d+)", inner_text)
    if m:
        return float(f"{m.group(1)}.{m.group(2)}")
    # Fallback: any decimal number (comma or dot) near a €
    nums = re.findall(r"(\d+)[,.](\d{2})\b", inner_text)
    if nums:
        int_part, dec_part = nums[-1]
        return float(f"{int_part}.{dec_part}")
    return None


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
                    "button:has-text('Accept'), button:has-text('Alles accepteren'), "
                    "#onetrust-accept-btn-handler"
                ).first.click(timeout=5_000)
                random_delay(1, 2)
            except Exception:
                pass

            # Wait for product tiles
            try:
                page.wait_for_selector(
                    'li[class*="product-item"], li[class*="product-tile"]',
                    timeout=10_000,
                )
            except Exception:
                logger.warning("Delhaize: product tiles not found within timeout")

            # Delhaize is a heavy SPA — wait for content to fully populate
            try:
                page.wait_for_load_state("networkidle", timeout=10_000)
            except Exception:
                pass
            random_delay(3, 4)

            raw = page.evaluate(_EXTRACT_JS)

            results: list[ProductResult] = []
            for item in raw:
                price = _parse_delhaize_price(item.get("innerText", ""))
                if price is None or price <= 0:
                    continue
                # Sanity: skip items that don't look like they match the query
                # (Delhaize sometimes shows popular products as fallback — skip if price
                # is present but we at least check title isn't empty)
                title = item.get("title", "").strip()
                if not title:
                    continue
                results.append(
                    ProductResult(
                        shop="Delhaize",
                        title=title,
                        price_eur=price,
                        url=item["href"],
                        image_url=item.get("img") or None,
                    )
                )
            logger.info("Delhaize: %d results", len(results))
            return results

        except Exception as exc:
            logger.error("Delhaize scrape failed: %s", exc)
            return []
        finally:
            browser.close()


async def scrape_delhaize(query: str) -> list[ProductResult]:
    return await asyncio.to_thread(_scrape_sync, query)
