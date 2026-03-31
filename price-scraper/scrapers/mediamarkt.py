from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import quote_plus

from playwright.sync_api import sync_playwright

from .base import ProductResult, make_sync_stealth_context, new_stealth_page, random_delay

logger = logging.getLogger(__name__)

OUT_OF_STOCK_PHRASES = [
    "niet beschikbaar",
    "niet op voorraad",
    "uitverkocht",
    "niet te koop",
]

# JS extractor for MediaMarkt.be
# Cards are <article> elements.
# Title: first <p> with text length > 20 chars (avoids spec labels like "Smart-tv").
# Price: first <span class="mms-ui-sr_true"> whose text matches a price pattern.
# Link: <a href*="/product/"> inside the article.
_EXTRACT_JS = """
() => {
    const articles = Array.from(document.querySelectorAll('article'));
    return articles.slice(0, 15).map(art => {
        const cardText = art.innerText || '';
        const lower = cardText.toLowerCase();
        const outOfStock = lower.includes('niet beschikbaar') ||
                           lower.includes('niet op voorraad') ||
                           lower.includes('uitverkocht');

        // Title: first <p> with text > 20 characters
        let title = null;
        for (const p of art.querySelectorAll('p')) {
            const t = (p.innerText || '').trim();
            if (t.length > 20) { title = t; break; }
        }

        // Price: screen-reader span matching price pattern
        let priceText = null;
        for (const span of art.querySelectorAll('span.mms-ui-sr_true, span[class*="sr_true"]')) {
            const t = (span.innerText || '').trim();
            if (/\\d+[,\\.]\\d{2}/.test(t)) { priceText = t; break; }
        }

        // Link
        const linkEl = art.querySelector('a[href*="/product/"]');
        const href = linkEl ? linkEl.href : null;

        // Image
        const imgEl = art.querySelector('img[src]');
        const imageUrl = imgEl ? imgEl.src : null;

        return { title, priceText, href, imageUrl, outOfStock };
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


def _scrape_mediamarkt_sync(query: str) -> list[ProductResult]:
    url = f"https://www.mediamarkt.be/nl/search.html?query={quote_plus(query)}"
    results: list[ProductResult] = []
    try:
        with sync_playwright() as p:
            browser, context = make_sync_stealth_context(p)
            page = new_stealth_page(context)

            # MediaMarkt often redirects search queries to a category page — that's fine
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            random_delay()

            # Accept cookie consent
            try:
                page.locator("#onetrust-accept-btn-handler, button:has-text('Akkoord'), button:has-text('Accepteer')").first.click(timeout=5_000)
                random_delay(0.5, 1.0)
            except Exception:
                pass

            page_title = page.title()
            if "captcha" in page_title.lower() or "access denied" in page_title.lower():
                logger.warning("mediamarkt.be: blocked by bot detection")
                return []

            # Wait for article cards
            try:
                page.wait_for_selector("article", timeout=20_000)
            except Exception:
                logger.warning("mediamarkt.be: product cards not found")
                return []

            products = page.evaluate(_EXTRACT_JS)

            for item in products:
                if len(results) >= 8:
                    break
                price = _parse_price(item["priceText"])
                if price is None:
                    continue
                href = item["href"]
                if href.startswith("/"):
                    href = "https://www.mediamarkt.be" + href
                results.append(ProductResult(
                    shop="MediaMarkt",
                    title=item["title"],
                    price_eur=price,
                    url=href,
                    image_url=item.get("imageUrl"),
                ))

    except Exception as exc:
        logger.warning("mediamarkt.be scraper error: %s", exc)

    return results


async def scrape_mediamarkt(query: str) -> list[ProductResult]:
    return await asyncio.to_thread(_scrape_mediamarkt_sync, query)
