from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from scrapers.amazon import scrape_amazon
from scrapers.base import extract_quantity
from scrapers.bol import scrape_bol
from scrapers.carrefour import scrape_carrefour
from scrapers.coolblue import scrape_coolblue
from scrapers.delhaize import scrape_delhaize
from scrapers.fnac import scrape_fnac
from scrapers.mediamarkt import scrape_mediamarkt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Belgian Price Scraper")

FRONTEND_DIR = Path(__file__).parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


ALL_SHOPS = ["bol.com", "Amazon", "Coolblue", "MediaMarkt", "Fnac", "Carrefour", "Delhaize"]


@app.get("/search")
async def search(q: str = Query(..., min_length=1, max_length=200)):
    query = q.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    logger.info("Searching for: %s", query)

    # Each Playwright scraper runs sync Playwright inside asyncio.to_thread,
    # bypassing the Windows asyncio subprocess limitation entirely.
    tasks = await asyncio.gather(
        scrape_bol(query),
        scrape_amazon(query),
        scrape_coolblue(query),
        scrape_mediamarkt(query),
        scrape_fnac(query),
        scrape_carrefour(query),
        scrape_delhaize(query),
        return_exceptions=True,
    )

    merged = []
    shops_with_results: set[str] = set()

    for task_result in tasks:
        if isinstance(task_result, list):
            merged.extend(task_result)
            for r in task_result:
                shops_with_results.add(r.shop)
        elif isinstance(task_result, Exception):
            logger.error("Scraper raised exception: %s", task_result)

    # Relevance filter: some shops (e.g. supermarkets) return featured/popular
    # products when their search doesn't match anything.  Keep only results where
    # at least one meaningful query word (length ≥ 4) appears in the product title.
    # If the query has no words ≥ 4 chars we skip the filter entirely.
    significant_words = [w.lower() for w in re.split(r"\W+", query) if len(w) >= 4]
    if significant_words:
        before = len(merged)
        merged = [
            r for r in merged
            if any(w in r.title.lower() for w in significant_words)
        ]
        dropped = before - len(merged)
        if dropped:
            logger.info("Relevance filter dropped %d off-topic results", dropped)
        # Re-derive shops_with_results after filtering
        shops_with_results = {r.shop for r in merged}

    # Enrich each result with quantity and per-unit price
    has_per_unit = False
    for r in merged:
        qty = extract_quantity(r.title)
        if qty and qty > 1:
            r.quantity = qty
            r.price_per_unit = round(r.price_eur / qty, 4)
            has_per_unit = True

    # Sort by per-unit price (cheapest per unit first).
    # Products without a detectable quantity fall back to total price and are
    # placed after per-unit products so comparable items group together.
    merged.sort(key=lambda r: (
        r.price_per_unit is None,           # False (0) sorts before True (1)
        r.price_per_unit if r.price_per_unit is not None else r.price_eur,
    ))

    shops_without_results = [s for s in ALL_SHOPS if s not in shops_with_results]

    return {
        "query": query,
        "results": [asdict(r) for r in merged],
        "sorted_by_unit_price": has_per_unit,
        "shops_searched": ALL_SHOPS,
        "shops_with_results": list(shops_with_results),
        "shops_without_results": shops_without_results,
    }
