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


def _parse_price(text: str) -> float | None:
    cleaned = re.sub(r"[^\d,\.]", "", text).replace(",", ".")
    parts = cleaned.split(".")
    if len(parts) > 2:
        cleaned = "".join(parts[:-1]) + "." + parts[-1]
    try:
        return float(cleaned)
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
                consent_btn = page.locator("input[id='sp-cc-accept'], button:has-text('Accepteer'), #acceptCookies")
                consent_btn.first.click(timeout=5_000)
                random_delay(0.3, 0.8)
            except Exception:
                pass

            # Check for captcha / bot block
            page_title = page.title()
            if "captcha" in page_title.lower() or "robot" in page_title.lower():
                logger.warning("amazon.com.be: blocked by captcha/bot detection")
                return []

            page.wait_for_selector("[data-component-type='s-search-result']", timeout=20_000)
            cards = page.query_selector_all("[data-component-type='s-search-result']")

            for card in cards[:12]:
                if len(results) >= 8:
                    break

                card_text = card.inner_text().lower()
                if "gesponsord" in card_text or "sponsored" in card_text:
                    continue
                if any(phrase in card_text for phrase in OUT_OF_STOCK_PHRASES):
                    continue

                title_el = card.query_selector("h2 span, h2 a span")
                title = title_el.inner_text().strip() if title_el else None
                if not title:
                    continue

                price_el = card.query_selector("span.a-price > span.a-offscreen")
                if not price_el:
                    continue
                price = _parse_price(price_el.inner_text())
                if price is None or price <= 0:
                    continue

                link_el = card.query_selector("h2 a[href]")
                href = link_el.get_attribute("href") if link_el else None
                if not href:
                    continue
                if href.startswith("/"):
                    href = "https://www.amazon.com.be" + href

                img_el = card.query_selector("img.s-image")
                img_url = img_el.get_attribute("src") if img_el else None

                results.append(ProductResult(
                    shop="Amazon", title=title, price_eur=price,
                    url=href, image_url=img_url,
                ))

    except Exception as exc:
        logger.warning("amazon.com.be scraper error: %s", exc)

    return results


async def scrape_amazon(query: str) -> list[ProductResult]:
    return await asyncio.to_thread(_scrape_amazon_sync, query)
