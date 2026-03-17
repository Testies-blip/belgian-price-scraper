from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import quote_plus

from playwright.sync_api import sync_playwright

from .base import ProductResult, make_sync_stealth_context, new_stealth_page, random_delay

logger = logging.getLogger(__name__)

OUT_OF_STOCK_PHRASES = [
    "tijdelijk niet op voorraad",
    "niet op voorraad",
    "momenteel niet beschikbaar",
    "currently unavailable",
]

# JS extractor for Amazon.com.be search results.
# Key findings from probing:
#   - <h2> contains title only as a <span> or aria-label — there is NO <a> inside <h2>
#   - Product URL: first <a href*="/dp/"> in the card, or constructed from data-asin
#   - Price:  span.a-price > span.a-offscreen  (screen-reader price, still works)
#   - Sponsored badge: .puis-sponsored-label-text or [class*="sponsored-label"]
_EXTRACT_JS = """
() => {
    const cards = Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'));
    return cards.slice(0, 20).map(card => {
        const text = card.innerText || '';
        const lower = text.toLowerCase();

        // Out-of-stock check
        const outOfStock = lower.includes('tijdelijk niet op voorraad') ||
                           lower.includes('momenteel niet beschikbaar') ||
                           lower.includes('currently unavailable');

        // Sponsored check via dedicated badge element (not full-text scan)
        const sponsBadge = card.querySelector('.puis-sponsored-label-text, [class*="sponsored-label"]');
        const isSponsored = !!sponsBadge;

        // Title: h2 span text is clean (no "Gesponsorde advertentie" prefix).
        // aria-label fallback includes promo context for sponsored items, so prefer span.
        const h2 = card.querySelector('h2');
        const h2Span = h2 ? h2.querySelector('span') : null;
        const title = h2Span
            ? h2Span.innerText.trim()
            : (h2 ? (h2.getAttribute('aria-label') || '') : null);

        // Price
        const priceEl = card.querySelector('span.a-price > span.a-offscreen');
        const priceText = priceEl ? priceEl.innerText : null;

        // Link: build from ASIN (most reliable) or first /dp/ link
        const asin = card.getAttribute('data-asin');
        let href = asin ? ('https://www.amazon.com.be/dp/' + asin) : null;
        if (!href) {
            const linkEl = card.querySelector('a[href*="/dp/"]');
            href = linkEl ? linkEl.href : null;
        }

        // Image
        const imgEl = card.querySelector('img.s-image');
        const imageUrl = imgEl ? imgEl.src : null;

        return { title, priceText, href, imageUrl, outOfStock, isSponsored };
    }).filter(p => p.title && p.href && p.priceText && !p.outOfStock);
}
"""


def _parse_price(text: str) -> float | None:
    cleaned = re.sub(r"[^\d,\.]", "", text).replace(",", ".")
    parts = cleaned.split(".")
    if len(parts) > 2:
        cleaned = "".join(parts[:-1]) + "." + parts[-1]
    try:
        v = float(cleaned)
        return v if v > 0 else None
    except ValueError:
        return None


def _scrape_amazon_sync(query: str) -> list[ProductResult]:
    url = f"https://www.amazon.com.be/s?k={quote_plus(query)}&language=nl_BE"
    results: list[ProductResult] = []
    try:
        with sync_playwright() as p:
            browser, context = make_sync_stealth_context(p)
            page = new_stealth_page(context)

            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            random_delay()

            # Accept cookie consent if present
            try:
                page.locator("input[id='sp-cc-accept'], #acceptCookies").first.click(timeout=5_000)
                random_delay(0.3, 0.8)
            except Exception:
                pass

            # Check for captcha / bot block
            page_title = page.title()
            if "captcha" in page_title.lower() or "robot" in page_title.lower():
                logger.warning("amazon.com.be: blocked by captcha/bot detection")
                return []

            try:
                page.wait_for_selector("[data-component-type='s-search-result']", timeout=20_000)
            except Exception:
                logger.warning("amazon.com.be: no search result cards found")
                return []

            products = page.evaluate(_EXTRACT_JS)

            for item in products:
                if len(results) >= 8:
                    break
                price = _parse_price(item["priceText"])
                if price is None:
                    continue
                href = item["href"]
                if href and href.startswith("/"):
                    href = "https://www.amazon.com.be" + href
                results.append(ProductResult(
                    shop="Amazon",
                    title=item["title"],
                    price_eur=price,
                    url=href,
                    image_url=item.get("imageUrl"),
                ))

    except Exception as exc:
        logger.warning("amazon.com.be scraper error: %s", exc)

    return results


async def scrape_amazon(query: str) -> list[ProductResult]:
    return await asyncio.to_thread(_scrape_amazon_sync, query)
