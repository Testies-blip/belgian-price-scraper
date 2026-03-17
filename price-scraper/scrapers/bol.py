from __future__ import annotations

import asyncio
import logging
from urllib.parse import quote_plus

from playwright.sync_api import sync_playwright

from .base import ProductResult, make_sync_stealth_context, new_stealth_page, random_delay

logger = logging.getLogger(__name__)

# JS that runs inside the page to extract all product data in one pass.
# Bol.com uses data-bltgh/data-bltgi tracking attributes instead of data-test.
_EXTRACT_JS = """
() => {
    const links = Array.from(document.querySelectorAll('a[data-bltgh*="ProductTitle"]'));
    return links.slice(0, 12).map(link => {
        // Walk up to find the card container (div with data-bltgi ending in ProductList_Middle.N)
        let card = link.parentElement;
        for (let i = 0; i < 12 && card; i++) {
            if (card.dataset && card.dataset.bltgi &&
                /ProductList_Middle\\.\\d+$/.test(card.dataset.bltgi)) break;
            card = card.parentElement;
        }
        const cardText = card ? card.innerText : '';

        // Price: find all decimal numbers (Belgian format), pick first with integer part >= 1
        // to skip per-unit micro-prices like €0,32/luier shown below the package price.
        const allPrices = [...cardText.matchAll(/(\\d+)[,\\.](\\d{2})(?!\\d)/g)];
        const priceEntry = allPrices.find(m => parseInt(m[1], 10) >= 1);
        const priceMatch = priceEntry || null;

        // Image
        const img = card ? card.querySelector('img[src*="media.s-bol"]') || card.querySelector('img') : null;

        // Stock: absence of negative phrases = in stock
        const lower = cardText.toLowerCase();
        const outOfStock = lower.includes('niet op voorraad') ||
                           lower.includes('binnenkort beschikbaar') ||
                           lower.includes('tijdelijk uitverkocht');

        return {
            title: link.innerText.trim(),
            href: link.href,
            price_str: priceMatch ? (priceMatch[1] + '.' + priceMatch[2]) : null,
            image_url: img ? img.src : null,
            out_of_stock: outOfStock
        };
    }).filter(p => p.title && p.href && p.price_str && !p.out_of_stock);
}
"""


def _scrape_bol_sync(query: str) -> list[ProductResult]:
    url = f"https://www.bol.com/be/nl/s/?searchtext={quote_plus(query)}&suggestMode=false"
    results: list[ProductResult] = []
    try:
        with sync_playwright() as p:
            browser, context = make_sync_stealth_context(p)
            page = new_stealth_page(context)

            # Use "load" (not domcontentloaded) — bol.com renders products via React after load
            page.goto(url, wait_until="load", timeout=35_000)
            random_delay()

            # Accept cookie banner if present
            try:
                page.locator("button:has-text('Akkoord')").first.click(timeout=4_000)
                random_delay(0.5, 1.0)
            except Exception:
                pass

            # Wait for product title links to appear
            try:
                page.wait_for_selector("a[data-bltgh*='ProductTitle']", timeout=20_000)
            except Exception:
                logger.warning("bol.com: no product titles found (possible block or no results)")
                return []

            # Extract everything in one JS evaluation — faster and more reliable than
            # many individual query_selector calls across the Python/browser boundary
            products = page.evaluate(_EXTRACT_JS)

            for item in products[:8]:
                try:
                    price = float(item["price_str"])
                    if price <= 0:
                        continue
                    href = item["href"]
                    # Ensure absolute URL
                    if href.startswith("/"):
                        href = "https://www.bol.com" + href
                    results.append(ProductResult(
                        shop="bol.com",
                        title=item["title"],
                        price_eur=price,
                        url=href,
                        image_url=item.get("image_url"),
                    ))
                except (ValueError, KeyError, TypeError):
                    continue

    except Exception as exc:
        logger.warning("bol.com scraper error: %s", exc)

    return results


async def scrape_bol(query: str) -> list[ProductResult]:
    return await asyncio.to_thread(_scrape_bol_sync, query)
