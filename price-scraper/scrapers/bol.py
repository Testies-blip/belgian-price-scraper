from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import quote_plus

from playwright.sync_api import sync_playwright

from .base import ProductResult, make_sync_stealth_context, new_stealth_page, random_delay

logger = logging.getLogger(__name__)

OUT_OF_STOCK_PHRASES = [
    "niet op voorraad",
    "binnenkort beschikbaar",
    "tijdelijk uitverkocht",
    "niet beschikbaar",
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


def _scrape_bol_sync(query: str) -> list[ProductResult]:
    url = f"https://www.bol.com/be/nl/s/?searchtext={quote_plus(query)}&suggestMode=false"
    results: list[ProductResult] = []
    browser = None
    try:
        with sync_playwright() as p:
            browser, context = make_sync_stealth_context(p)
            page = new_stealth_page(context)

            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            random_delay()

            # Accept cookie banner if present
            try:
                consent_btn = page.locator("[data-test='consent-modal-confirm-btn'], button:has-text('Akkoord')")
                consent_btn.first.click(timeout=5_000)
                random_delay(0.3, 0.8)
            except Exception:
                pass

            # Wait for search results
            page.wait_for_selector(
                "[data-test='product-item-root'], [data-test='search-result-item']",
                timeout=20_000,
            )

            cards = page.query_selector_all(
                "[data-test='product-item-root'], [data-test='search-result-item']"
            )

            for card in cards[:12]:
                if len(results) >= 8:
                    break

                card_text = card.inner_text().lower()
                if any(phrase in card_text for phrase in OUT_OF_STOCK_PHRASES):
                    continue

                title_el = card.query_selector("[data-test='product-title']") or \
                           card.query_selector("a[data-test='product-title-link']")
                title = title_el.inner_text().strip() if title_el else None
                if not title:
                    continue

                price_el = card.query_selector("[data-test='price-value']")
                if not price_el:
                    continue
                price = _parse_price(price_el.inner_text())
                if price is None or price <= 0:
                    continue

                link_el = card.query_selector("a[data-test='product-title-link'], a[href*='/p/']")
                href = link_el.get_attribute("href") if link_el else None
                if not href:
                    continue
                if href.startswith("/"):
                    href = "https://www.bol.com" + href

                img_el = card.query_selector("img")
                img_url = img_el.get_attribute("src") if img_el else None

                results.append(ProductResult(
                    shop="bol.com", title=title, price_eur=price,
                    url=href, image_url=img_url,
                ))

    except Exception as exc:
        logger.warning("bol.com scraper error: %s", exc)

    return results


async def scrape_bol(query: str) -> list[ProductResult]:
    return await asyncio.to_thread(_scrape_bol_sync, query)
