from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from scrapers.amazon import scrape_amazon
from scrapers.bol import scrape_bol
from scrapers.coolblue import scrape_coolblue
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


ALL_SHOPS = ["bol.com", "Amazon", "Coolblue", "MediaMarkt", "Fnac"]


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

    merged.sort(key=lambda r: r.price_eur)
    shops_without_results = [s for s in ALL_SHOPS if s not in shops_with_results]

    return {
        "query": query,
        "results": [asdict(r) for r in merged],
        "shops_searched": ALL_SHOPS,
        "shops_with_results": list(shops_with_results),
        "shops_without_results": shops_without_results,
    }
