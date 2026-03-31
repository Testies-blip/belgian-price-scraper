from __future__ import annotations

import asyncio
import logging
from urllib.parse import quote_plus

from playwright.sync_api import sync_playwright

from .base import ProductResult, make_sync_stealth_context, new_stealth_page, random_delay

logger = logging.getLogger(__name__)

# JS that runs inside the page to extract all product data in one pass.
# Bol.com uses data-bltgh/data-bltgi tracking attributes instead of data-test.
#
# Strategy: TOP-DOWN — find card containers first via data-bltgi, then query
# title/image/price WITHIN each card. This avoids the mismatch that occurs
# when walking UP from a title link lands on a shared parent container that
# spans multiple cards (causing image/price from card N to appear with card M's title).
_EXTRACT_JS = """
() => {
    // Find every element whose data-bltgi ends with "ProductList_Middle.<number>"
    const allEls = Array.from(document.querySelectorAll('[data-bltgi]'));
    const candidates = allEls.filter(el =>
        /\\.ProductList_Middle\\.\\d+$/.test(el.dataset.bltgi || '')
    );

    // Keep only the OUTERMOST matching elements (discard any that are
    // descendants of another match) so we get one element per product card.
    const cards = candidates.filter(card =>
        !candidates.some(other => other !== card && other.contains(card))
    );

    return cards.slice(0, 12).map(card => {
        const cardText = card.innerText || '';
        const lower = cardText.toLowerCase();

        // Stock check
        const outOfStock = lower.includes('niet op voorraad') ||
                           lower.includes('binnenkort beschikbaar') ||
                           lower.includes('tijdelijk uitverkocht');

        // Title + link — the ProductTitle anchor lives INSIDE this card
        const titleLink = card.querySelector('a[data-bltgh*="ProductTitle"]');
        const title = titleLink ? titleLink.innerText.trim() : null;
        const href  = titleLink ? titleLink.href : null;

        // Image — prefer the ProductImage anchor's img; fall back to any bol-media img
        const imgAnchor = card.querySelector('a[data-bltgh*="ProductImage"]');
        const img = imgAnchor
            ? (imgAnchor.querySelector('img[src*="media.s-bol"]') || imgAnchor.querySelector('img'))
            : (card.querySelector('img[src*="media.s-bol"]') || card.querySelector('img'));

        // Price: find all x,xx or x.xx numbers, skip sub-€1 per-unit prices
        const allPrices = [...cardText.matchAll(/(\\d+)[,\\.](\\d{2})(?!\\d)/g)];
        const priceEntry = allPrices.find(m => parseInt(m[1], 10) >= 1);

        return {
            title,
            href,
            price_str: priceEntry ? (priceEntry[1] + '.' + priceEntry[2]) : null,
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
