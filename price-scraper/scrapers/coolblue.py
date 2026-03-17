from __future__ import annotations

import asyncio
import logging
from urllib.parse import quote_plus

from playwright.sync_api import sync_playwright

from .base import ProductResult, make_sync_stealth_context, new_stealth_page, random_delay

logger = logging.getLogger(__name__)

OUT_OF_STOCK_PHRASES = [
    "niet op voorraad",
    "niet beschikbaar",
    "uitverkocht",
]

# Coolblue uses stable BEM class names — reliable selectors
_EXTRACT_JS = """
() => {
    const cards = Array.from(document.querySelectorAll(
        'div.product-card, [class*="product-card"], li[class*="product"], [data-product-id]'
    ));
    return cards.slice(0, 12).map(card => {
        const cardText = card.innerText || '';
        const lower = cardText.toLowerCase();
        const outOfStock = lower.includes('niet op voorraad') || lower.includes('uitverkocht');

        const titleEl = card.querySelector(
            'a.product-card__title, [class*="product-card__title"], h2 a, h3 a'
        );
        const priceEl = card.querySelector(
            '[class*="sales-price__current"], [class*="sales-price"], [class*="price"]'
        );
        const linkEl = card.querySelector('a[href]');
        const imgEl = card.querySelector('img');

        const priceText = priceEl ? priceEl.innerText : '';
        const priceMatch = priceText.match(/(\\d+)[,\\.](\\d{2})/);

        return {
            title: titleEl ? titleEl.innerText.trim() : null,
            href: linkEl ? linkEl.href : null,
            price_str: priceMatch ? (priceMatch[1] + '.' + priceMatch[2]) : null,
            image_url: imgEl ? (imgEl.src || imgEl.dataset.src) : null,
            out_of_stock: outOfStock
        };
    }).filter(p => p.title && p.href && p.price_str && !p.out_of_stock);
}
"""


def _scrape_coolblue_sync(query: str) -> list[ProductResult]:
    # Coolblue search URL uses %20 for spaces (not +)
    encoded = quote_plus(query).replace("+", "%20")
    url = f"https://www.coolblue.be/nl/zoekresultaten/{encoded}"
    results: list[ProductResult] = []
    try:
        with sync_playwright() as p:
            browser, context = make_sync_stealth_context(p)
            page = new_stealth_page(context)

            page.goto(url, wait_until="load", timeout=30_000)
            random_delay()

            # Accept cookie banner if present
            try:
                page.locator("button:has-text('Akkoord'), button:has-text('Accepteer')").first.click(timeout=4_000)
                random_delay(0.5, 1.0)
            except Exception:
                pass

            # Check for bot detection
            body_text = page.inner_text("body")
            if "robot" in body_text.lower() or "403" in body_text or "captcha" in body_text.lower():
                logger.warning("coolblue.be: bot detection triggered")
                return []

            # Wait for product cards
            try:
                page.wait_for_selector(
                    'div.product-card, [class*="product-card"], [data-product-id]',
                    timeout=15_000,
                )
            except Exception:
                logger.warning("coolblue.be: no product cards found")
                return []

            products = page.evaluate(_EXTRACT_JS)

            for item in products[:8]:
                try:
                    price = float(item["price_str"])
                    if price <= 0:
                        continue
                    href = item["href"]
                    if href.startswith("/"):
                        href = "https://www.coolblue.be" + href
                    results.append(ProductResult(
                        shop="Coolblue",
                        title=item["title"],
                        price_eur=price,
                        url=href,
                        image_url=item.get("image_url"),
                    ))
                except (ValueError, KeyError, TypeError):
                    continue

    except Exception as exc:
        logger.warning("coolblue.be scraper error: %s", exc)

    return results


async def scrape_coolblue(query: str) -> list[ProductResult]:
    return await asyncio.to_thread(_scrape_coolblue_sync, query)
