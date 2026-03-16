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


def _parse_price(text: str) -> float | None:
    cleaned = re.sub(r"[^\d,\.]", "", text).replace(",", ".")
    parts = cleaned.split(".")
    if len(parts) > 2:
        cleaned = "".join(parts[:-1]) + "." + parts[-1]
    try:
        return float(cleaned)
    except ValueError:
        return None


def _scrape_mediamarkt_sync(query: str) -> list[ProductResult]:
    url = f"https://www.mediamarkt.be/nl/search.html?query={quote_plus(query)}"
    results: list[ProductResult] = []
    try:
        with sync_playwright() as p:
            browser, context = make_sync_stealth_context(p)
            page = new_stealth_page(context)

            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            random_delay()

            # Accept cookie consent
            try:
                consent_btn = page.locator("button:has-text('Akkoord'), button:has-text('Accepteer'), #onetrust-accept-btn-handler")
                consent_btn.first.click(timeout=5_000)
                random_delay(0.5, 1.0)
            except Exception:
                pass

            page_title = page.title()
            if "captcha" in page_title.lower() or "access denied" in page_title.lower():
                logger.warning("mediamarkt.be: blocked by bot detection")
                return []

            try:
                page.wait_for_selector(
                    "[data-test='product-card'], .product-wrapper, [class*='ProductCard'], li[class*='product']",
                    timeout=20_000,
                )
            except Exception:
                logger.warning("mediamarkt.be: product cards not found")
                return []

            cards = page.query_selector_all(
                "[data-test='product-card'], .product-wrapper, [class*='ProductCard']"
            )

            for card in cards[:12]:
                if len(results) >= 8:
                    break

                card_text = card.inner_text().lower()
                if any(phrase in card_text for phrase in OUT_OF_STOCK_PHRASES):
                    continue

                title_el = card.query_selector("[class*='ProductName'], [data-test='product-title'], h2, h3")
                title = title_el.inner_text().strip() if title_el else None
                if not title:
                    continue

                price_el = card.query_selector("[class*='price__value'], [data-test='product-price'], [class*='Price']")
                if not price_el:
                    continue
                price = _parse_price(price_el.inner_text())
                if price is None or price <= 0:
                    continue

                link_el = card.query_selector("a[href]")
                href = link_el.get_attribute("href") if link_el else None
                if not href:
                    continue
                if href.startswith("/"):
                    href = "https://www.mediamarkt.be" + href

                img_el = card.query_selector("img")
                img_url = img_el.get_attribute("src") if img_el else None

                results.append(ProductResult(
                    shop="MediaMarkt", title=title, price_eur=price,
                    url=href, image_url=img_url,
                ))

    except Exception as exc:
        logger.warning("mediamarkt.be scraper error: %s", exc)

    return results


async def scrape_mediamarkt(query: str) -> list[ProductResult]:
    return await asyncio.to_thread(_scrape_mediamarkt_sync, query)
