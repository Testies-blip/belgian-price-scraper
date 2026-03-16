from __future__ import annotations

import logging
import re
from urllib.parse import quote_plus

import httpx
from bs4 import BeautifulSoup

from .base import ProductResult

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "nl-BE,nl;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

OUT_OF_STOCK_PHRASES = [
    "niet op voorraad",
    "niet beschikbaar",
    "uitverkocht",
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


async def scrape_coolblue(query: str) -> list[ProductResult]:
    url = f"https://www.coolblue.be/nl/zoekresultaten/{quote_plus(query)}"
    results: list[ProductResult] = []
    try:
        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=20.0) as client:
            response = await client.get(url)
            response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        # Product cards — Coolblue uses <div class="product-card"> or <article>
        cards = soup.select("div.product-card, article.product-card, [data-product-id]")

        for card in cards[:12]:
            if len(results) >= 8:
                break

            card_text = card.get_text(" ", strip=True).lower()

            # Skip out-of-stock
            if any(phrase in card_text for phrase in OUT_OF_STOCK_PHRASES):
                continue

            # Title
            title_el = (
                card.select_one("a.product-card__title")
                or card.select_one("[class*='product-card__title']")
                or card.select_one("h2 a, h3 a")
            )
            title = title_el.get_text(strip=True) if title_el else None
            if not title:
                continue

            # Price
            price_el = (
                card.select_one("[class*='sales-price__current']")
                or card.select_one("[class*='price']")
            )
            if not price_el:
                continue
            price = _parse_price(price_el.get_text(strip=True))
            if price is None or price <= 0:
                continue

            # URL
            link_el = card.select_one("a[href*='/p/'], a.product-card__title, a[href]")
            href = link_el["href"] if link_el and link_el.get("href") else None
            if not href:
                continue
            if href.startswith("/"):
                href = "https://www.coolblue.be" + href

            # Image
            img_el = card.select_one("img")
            img_url = img_el.get("src") or img_el.get("data-src") if img_el else None

            results.append(
                ProductResult(
                    shop="Coolblue",
                    title=title,
                    price_eur=price,
                    url=href,
                    image_url=img_url,
                )
            )

    except Exception as exc:
        logger.warning("coolblue.be scraper error: %s", exc)

    return results
