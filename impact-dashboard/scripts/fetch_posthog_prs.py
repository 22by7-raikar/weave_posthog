#!/usr/bin/env python3
"""Fetch merged PostHog PRs from GitHub Search API, chunked by day.

The GitHub issue search API caps each query at 1,000 results. PostHog has
enough activity that a 90-day query can exceed the cap, so this script queries
one merge day at a time and caches each page.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


REPO = "PostHog/posthog"
START_DATE = dt.date(2026, 3, 29)
END_DATE = dt.date(2026, 6, 27)
RAW_DIR = Path("data/raw")
OUT_FILE = Path("data/posthog_prs_90d.json")
PER_PAGE = 100


def date_range(start: dt.date, end: dt.date):
    current = start
    while current <= end:
        yield current
        current += dt.timedelta(days=1)


def request_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "weave-posthog-impact-dashboard",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    while True:
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
                remaining = response.headers.get("x-ratelimit-remaining")
                reset = response.headers.get("x-ratelimit-reset")
                if remaining == "0" and reset:
                    wait = max(0, int(reset) - int(time.time()) + 2)
                    print(f"rate limit reached; sleeping {wait}s")
                    time.sleep(wait)
                return payload
        except urllib.error.HTTPError as error:
            if error.code in (403, 429):
                reset = error.headers.get("x-ratelimit-reset")
                wait = 65
                if reset:
                    wait = max(wait, int(reset) - int(time.time()) + 2)
                print(f"search throttled ({error.code}); sleeping {wait}s")
                time.sleep(wait)
                continue
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"GitHub request failed {error.code}: {body}") from error
        except (TimeoutError, socket.timeout, urllib.error.URLError) as error:
            print(f"network timeout; sleeping 10s then retrying ({error})")
            time.sleep(10)
            continue


def load_or_fetch(day: dt.date, page: int) -> dict:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = RAW_DIR / f"search_{day.isoformat()}_page_{page}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text())

    query = f"repo:{REPO} is:pr is:merged merged:{day.isoformat()}"
    params = urllib.parse.urlencode(
        {
            "q": query,
            "sort": "updated",
            "order": "desc",
            "per_page": str(PER_PAGE),
            "page": str(page),
        }
    )
    url = f"https://api.github.com/search/issues?{params}"
    print(f"fetch {day.isoformat()} page {page}")
    payload = request_json(url)
    cache_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    return payload


def main() -> None:
    started = dt.datetime.now(dt.timezone.utc)
    seen = {}
    totals_by_day = {}

    for day in date_range(START_DATE, END_DATE):
        page = 1
        while True:
            payload = load_or_fetch(day, page)
            total = int(payload.get("total_count", 0))
            totals_by_day[day.isoformat()] = total
            for item in payload.get("items", []):
                seen[item["number"]] = item
            if page * PER_PAGE >= total or not payload.get("items"):
                break
            page += 1

    prs = sorted(
        seen.values(),
        key=lambda item: (
            item.get("pull_request", {}).get("merged_at") or item.get("closed_at") or "",
            item.get("number", 0),
        ),
    )
    result = {
        "repo": REPO,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "fetch_started_at": started.isoformat(),
        "window_start": START_DATE.isoformat(),
        "window_end": END_DATE.isoformat(),
        "source": "GitHub Search API /search/issues, one query per merged date",
        "total_prs": len(prs),
        "totals_by_day": totals_by_day,
        "items": prs,
    }
    OUT_FILE.write_text(json.dumps(result, indent=2, sort_keys=True))
    print(f"wrote {OUT_FILE} with {len(prs)} merged PRs")


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parents[1])
    main()
