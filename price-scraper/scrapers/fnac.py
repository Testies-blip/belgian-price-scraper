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
    "niet beschikbaar",
    "uitverkocht",
    "binnenkort beschikbaar",
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


def _scrape_fnac_sync(query: str) -> list[ProductResult]:
    url = f"https://www.fnac.be/SearchResult/ResultList?Search={quote_plus(query)}&sft=1"
    results: list[ProductResult] = []
    try:
        with sync_playwright() as p:
            browser, context = make_sync_stealth_context(p)
            page = new_stealth_page(context)

            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            random_delay()

            # Accept cookie consent
            try:
                consent_btn = page.locator("button:has-text('Akkoord'), button:has-text('Accepteer'), #didomi-notice-agree-button")
                consent_btn.first.click(timeout=5_000)
                random_delay(0.5, 1.0)
            except Exception:
                pass

            # Check for WAF block
            page_title = page.title()
            if (
                "captcha" in page_title.lower()
                or "access denied" in page_title.lower()
                or "403" in page_title
                or "just a moment" in page_title.lower()
            ):
                logger.warning("fnac.be: blocked by WAF/bot detection")
                return []

            try:
                page.wait_for_selector(
                    "article.Article, li.Article, [class*='Article-item'], .s-productList li",
                    timeout=20_000,
                )
            except Exception:
                logger.warning("fnac.be: product cards not found (possible block or no results)")
                return []

            cards = page.query_selector_all("article.Article, li.Article, [class*='Article-item']")

            for card in cards[:12]:
                if len(results) >= 8:
                    break

                card_text = card.inner_text().lower()
                if any(phrase in card_text for phrase in OUT_OF_STOCK_PHRASES):
                    continue

                title_el = card.query_selector(".Article-title, [class*='article-title'], h2 a, h3 a, a[class*='Title']")
                title = title_el.inner_text().strip() if title_el else None
                if not title:
                    continue

                price_el = card.query_selector(".Article-price, [class*='price'], [itemprop='price']")
                if not price_el:
                    continue
                price_text = price_el.get_attribute("content") or price_el.inner_text()
                price = _parse_price(price_text)
                if price is None or price <= 0:
                    continue

                link_el = card.query_selector("a[href]")
                href = link_el.get_attribute("href") if link_el else None
                if not href:
                    continue
                if href.startswith("/"):
                    href = "https://www.fnac.be" + href

                img_el = card.query_selector("img")
                img_url = img_el.get_attribute("src") if img_el else None

                results.append(ProductResult(
                    shop="Fnac", title=title, price_eur=price,
                    url=href, image_url=img_url,
                ))

    except Exception as exc:
        logger.warning("fnac.be scraper error: %s", exc)

    return results


async def scrape_fnac(query: str) -> list[ProductResult]:
    return await asyncio.to_thread(_scrape_fnac_sync, query)
