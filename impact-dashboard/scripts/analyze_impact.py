#!/usr/bin/env python3
"""Build an engineer impact model from cached PostHog PR search data."""

from __future__ import annotations

import datetime as dt
import html
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median


ROOT = Path(__file__).resolve().parents[1]
IN_FILE = ROOT / "data/posthog_prs_90d.json"
OUT_FILE = ROOT / "data/impact_analysis.json"
SITE_DATA_FILE = ROOT / "site/data.js"

BOT_LOGINS = {
    "app/dependabot",
    "dependabot",
    "dependabot[bot]",
    "github-actions[bot]",
    "posthog-bot",
    "posthog-git-sync",
    "renovate[bot]",
    "posthog-activity-feed[bot]",
}

CATEGORY_META = {
    "Product": {
        "base": 9.0,
        "color": "#2563eb",
        "description": "User-visible capability, workflow, integration, or UI behavior.",
    },
    "Reliability": {
        "base": 9.8,
        "color": "#dc2626",
        "description": "Bug fixes, performance, correctness, incidents, and hardening.",
    },
    "Platform": {
        "base": 8.6,
        "color": "#7c3aed",
        "description": "Data, infra, APIs, workers, migrations, and shared systems.",
    },
    "Engineering Quality": {
        "base": 7.2,
        "color": "#059669",
        "description": "Tests, refactors, CI, developer tooling, and maintainability.",
    },
    "Documentation": {
        "base": 4.8,
        "color": "#d97706",
        "description": "Docs, examples, copy, and handbook/content updates.",
    },
    "Maintenance": {
        "base": 3.8,
        "color": "#64748b",
        "description": "Routine chores, dependency bumps, generated updates, and cleanup.",
    },
}

RELIABILITY_RE = re.compile(
    r"\b(fix|bug|regression|crash|error|exception|timeout|race|leak|deadlock|"
    r"perf|performance|slow|latency|flaky|failure|failed|security|permission|"
    r"auth|incident|rollback|correctness|memory|safe|harden)\b",
    re.I,
)
PRODUCT_RE = re.compile(
    r"\b(feat|feature|add|introduce|support|enable|allow|implement|launch|"
    r"export|import|insight|dashboard|experiment|session replay|survey|webhook|"
    r"integration|billing|onboarding|ui|ux|hog|llm|ai)\b",
    re.I,
)
PLATFORM_RE = re.compile(
    r"\b(migration|migrate|schema|clickhouse|postgres|kafka|celery|worker|queue|"
    r"api|graphql|infra|deploy|helm|kubernetes|docker|async|pipeline|batch|"
    r"warehouse|query|hogql|database|plugin server|capture|ingestion)\b",
    re.I,
)
QUALITY_RE = re.compile(
    r"\b(test|pytest|jest|vitest|cypress|playwright|e2e|lint|typecheck|types|"
    r"refactor|cleanup|ci|build|tooling|coverage|snapshot|mypy|ruff|eslint)\b",
    re.I,
)
DOCS_RE = re.compile(r"\b(doc|docs|documentation|readme|handbook|changelog|copy)\b", re.I)
DEPENDENCY_RE = re.compile(r"\b(bump|upgrade|update dependency|deps?|version|pin)\b", re.I)
ISSUE_RE = re.compile(
    r"(?:(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+)?(?:PostHog/posthog)?#\d+|"
    r"https://github\.com/PostHog/posthog/issues/\d+",
    re.I,
)
TEST_NEGATIVE_RE = re.compile(
    r"\b(no tests?|not tested|didn'?t test|did not test|haven'?t tested|"
    r"not yet|n/a|todo|manual only|no automated)\b",
    re.I,
)
TEST_POSITIVE_RE = re.compile(
    r"\b(pytest|jest|vitest|cypress|playwright|e2e|unit|integration|snapshot|"
    r"locally|manual|verified|regression|coverage|test suite|passes?|passed)\b",
    re.I,
)


def strip_comments(markdown: str) -> str:
    markdown = re.sub(r"<!--.*?-->", " ", markdown or "", flags=re.S)
    markdown = re.sub(r"<[^>]+>", " ", markdown)
    markdown = html.unescape(markdown)
    return re.sub(r"\s+", " ", markdown).strip()


def parse_type_scope(title: str) -> tuple[str, str]:
    match = re.match(r"^\s*([a-z]+)(?:\(([^)]+)\))?:", title or "", flags=re.I)
    if not match:
        return "", "unspecified"
    return match.group(1).lower(), (match.group(2) or "unspecified").lower()


def extract_test_section(body: str) -> str:
    cleaned = strip_comments(body)
    match = re.search(
        r"how did you test(?: this code)?\??\s*(.*?)(?:publish to changelog|docs update|"
        r"automatic notifications|agent context|llm context|$)",
        cleaned,
        flags=re.I,
    )
    return match.group(1).strip() if match else ""


def classify(title: str, body: str, labels: list[str], pr_type: str) -> str:
    text = f"{title}\n{body}\n{' '.join(labels)}"
    title_text = title or ""

    if pr_type in {"docs"} or DOCS_RE.search(title_text):
        return "Documentation"
    if pr_type in {"fix", "perf", "revert"} or RELIABILITY_RE.search(title_text):
        return "Reliability"
    if pr_type in {"feat"} or PRODUCT_RE.search(title_text):
        return "Product"
    if PLATFORM_RE.search(text):
        return "Platform"
    if pr_type in {"test", "refactor", "ci"} or QUALITY_RE.search(title_text):
        return "Engineering Quality"
    if DEPENDENCY_RE.search(title_text) or pr_type in {"chore", "build"}:
        return "Maintenance"
    if RELIABILITY_RE.search(text):
        return "Reliability"
    if PRODUCT_RE.search(text):
        return "Product"
    if QUALITY_RE.search(text):
        return "Engineering Quality"
    return "Maintenance"


def parse_time(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def pr_score(item: dict) -> dict:
    title = item.get("title") or ""
    visible_body = strip_comments(item.get("body") or "")
    labels = [label.get("name", "") for label in item.get("labels", [])]
    pr_type, scope = parse_type_scope(title)
    category = classify(title, visible_body, labels, pr_type)
    base = CATEGORY_META[category]["base"]

    test_section = extract_test_section(item.get("body") or "")
    has_test_signal = bool(test_section and TEST_POSITIVE_RE.search(test_section))
    weak_or_missing_tests = (not test_section) or bool(TEST_NEGATIVE_RE.search(test_section))
    has_issue_ref = bool(ISSUE_RE.search(visible_body))
    has_problem = bool(re.search(r"\b(problem|why|rationale|context)\b", visible_body, re.I)) and len(visible_body) > 160
    has_changes = bool(re.search(r"\b(changes?|implements?|adds?|removes?|updates?)\b", visible_body, re.I))

    comments = int(item.get("comments") or 0)
    reactions = item.get("reactions") or {}
    positive_reactions = sum(int(reactions.get(key, 0) or 0) for key in ["+1", "heart", "hooray", "rocket", "eyes"])

    created = parse_time(item.get("created_at"))
    merged = parse_time((item.get("pull_request") or {}).get("merged_at") or item.get("closed_at"))
    cycle_hours = None
    if created and merged:
        cycle_hours = max(0.0, (merged - created).total_seconds() / 3600)

    multiplier = 1.0
    bonuses = []
    penalties = []

    if has_issue_ref:
        multiplier += 0.12
        bonuses.append("linked to an issue")
    if has_test_signal and not weak_or_missing_tests:
        multiplier += 0.14
        bonuses.append("explicit validation")
    elif has_test_signal:
        multiplier += 0.06
        bonuses.append("some validation")
    if has_problem and has_changes:
        multiplier += 0.08
        bonuses.append("clear problem/change narrative")
    if comments:
        multiplier += min(0.18, math.log1p(comments) / 16)
        bonuses.append("review discussion")
    if positive_reactions:
        multiplier += min(0.16, math.log1p(positive_reactions) / 12)
        bonuses.append("peer recognition")
    if cycle_hours is not None and 6 <= cycle_hours <= 168:
        multiplier += 0.04
        bonuses.append("non-trivial review cycle")

    low_signal_title = bool(
        re.search(r"\b(format|typo|lint|snapshot|translation|copy|bump|deps?|generated)\b", title, re.I)
    )
    skip_review = any(name in {"skip-agent-review", "stamphog"} for name in labels)
    if category == "Maintenance" and low_signal_title:
        multiplier -= 0.18
        penalties.append("routine maintenance")
    if skip_review and comments <= 1 and not has_issue_ref:
        multiplier -= 0.16
        penalties.append("low-review/agent-review label")
    if weak_or_missing_tests and category not in {"Documentation", "Maintenance"}:
        multiplier -= 0.08
        penalties.append("weak public testing evidence")
    if cycle_hours is not None and cycle_hours < 0.25 and comments == 0 and category == "Maintenance":
        multiplier -= 0.20
        penalties.append("very small fast merge")

    multiplier = max(0.45, min(multiplier, 1.65))
    points = round(base * multiplier, 2)

    return {
        "number": item.get("number"),
        "title": title,
        "url": item.get("html_url"),
        "author": (item.get("user") or {}).get("login", "unknown"),
        "author_association": item.get("author_association"),
        "merged_at": (item.get("pull_request") or {}).get("merged_at") or item.get("closed_at"),
        "created_at": item.get("created_at"),
        "cycle_hours": round(cycle_hours, 1) if cycle_hours is not None else None,
        "type": pr_type or "none",
        "scope": scope,
        "category": category,
        "labels": labels,
        "comments": comments,
        "positive_reactions": positive_reactions,
        "has_issue_ref": has_issue_ref,
        "has_test_signal": has_test_signal,
        "weak_or_missing_tests": weak_or_missing_tests,
        "has_problem_statement": has_problem,
        "is_low_signal": low_signal_title,
        "points": points,
        "bonuses": bonuses[:4],
        "penalties": penalties[:3],
    }


def normalize(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    low = min(values.values())
    high = max(values.values())
    if math.isclose(low, high):
        return {key: 1.0 for key in values}
    return {key: (value - low) / (high - low) for key, value in values.items()}


def quantile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def human_hours(hours: float | None) -> str:
    if hours is None:
        return "unknown"
    if hours < 24:
        return f"{hours:.1f}h"
    return f"{hours / 24:.1f}d"


def compact_pr(pr: dict) -> dict:
    return {
        "number": pr["number"],
        "title": pr["title"],
        "url": pr["url"],
        "category": pr["category"],
        "points": pr["points"],
        "comments": pr["comments"],
        "positive_reactions": pr["positive_reactions"],
        "has_issue_ref": pr["has_issue_ref"],
        "has_test_signal": pr["has_test_signal"],
        "weak_or_missing_tests": pr["weak_or_missing_tests"],
        "bonuses": pr["bonuses"],
    }


def main() -> None:
    payload = json.loads(IN_FILE.read_text())
    raw_items = payload["items"]
    scored_prs = [pr_score(item) for item in raw_items]
    high_impact_threshold = quantile([pr["points"] for pr in scored_prs], 0.75)

    by_author: dict[str, list[dict]] = defaultdict(list)
    for pr in scored_prs:
        author = pr["author"]
        if author.lower() in BOT_LOGINS or "[bot]" in author:
            continue
        by_author[author].append(pr)

    author_rows = {}
    for author, prs in by_author.items():
        if len(prs) < 3:
            continue
        category_points = Counter()
        category_counts = Counter()
        scopes = Counter()
        cycle_values = []
        for pr in prs:
            category_points[pr["category"]] += pr["points"]
            category_counts[pr["category"]] += 1
            if pr["scope"] != "unspecified":
                scopes[pr["scope"]] += 1
            if pr["cycle_hours"] is not None:
                cycle_values.append(pr["cycle_hours"])

        ordered_prs = sorted(prs, key=lambda pr: pr["points"], reverse=True)
        top_five = ordered_prs[:5]
        total_points = sum(pr["points"] for pr in prs)
        high_impact = sum(1 for pr in prs if pr["points"] >= high_impact_threshold)
        tested_rate = sum(1 for pr in prs if pr["has_test_signal"] and not pr["weak_or_missing_tests"]) / len(prs)
        issue_rate = sum(1 for pr in prs if pr["has_issue_ref"]) / len(prs)
        problem_rate = sum(1 for pr in prs if pr["has_problem_statement"]) / len(prs)
        avg_top_points = sum(pr["points"] for pr in top_five) / len(top_five)
        comments = sum(pr["comments"] for pr in prs)
        reactions = sum(pr["positive_reactions"] for pr in prs)
        breadth = len(scopes) + len(category_counts) * 2
        quality = 0.45 * tested_rate + 0.35 * issue_rate + 0.20 * problem_rate

        author_rows[author] = {
            "login": author,
            "profile_url": f"https://github.com/{author}",
            "avatar_url": f"https://github.com/{author}.png?size=96",
            "pr_count": len(prs),
            "total_points": round(total_points, 2),
            "high_impact_prs": high_impact,
            "avg_top_pr_points": round(avg_top_points, 2),
            "tested_rate": round(tested_rate, 3),
            "issue_linked_rate": round(issue_rate, 3),
            "problem_rate": round(problem_rate, 3),
            "quality_index_raw": round(quality, 3),
            "scope_breadth_raw": breadth,
            "comments_received": comments,
            "positive_reactions": reactions,
            "median_cycle_hours": round(median(cycle_values), 1) if cycle_values else None,
            "category_points": {key: round(category_points.get(key, 0), 2) for key in CATEGORY_META},
            "category_counts": {key: category_counts.get(key, 0) for key in CATEGORY_META},
            "top_scopes": scopes.most_common(8),
            "top_prs": [compact_pr(pr) for pr in top_five],
        }

    components = {
        "outcome_volume": normalize({a: math.log1p(v["total_points"]) for a, v in author_rows.items()}),
        "high_impact": normalize({a: math.log1p(v["high_impact_prs"]) for a, v in author_rows.items()}),
        "depth": normalize({a: v["avg_top_pr_points"] for a, v in author_rows.items()}),
        "quality": normalize({a: v["quality_index_raw"] for a, v in author_rows.items()}),
        "breadth": normalize({a: math.log1p(v["scope_breadth_raw"]) for a, v in author_rows.items()}),
        "collaboration": normalize(
            {a: math.log1p(v["comments_received"] + 2 * v["positive_reactions"]) for a, v in author_rows.items()}
        ),
    }

    weights = {
        "outcome_volume": 0.30,
        "high_impact": 0.22,
        "depth": 0.16,
        "quality": 0.14,
        "breadth": 0.10,
        "collaboration": 0.08,
    }

    for author, row in author_rows.items():
        breakdown = {key: round(components[key][author] * 100, 1) for key in weights}
        score = sum(weights[key] * components[key][author] for key in weights) * 100
        row["score"] = round(score, 1)
        row["score_breakdown"] = breakdown
        row["median_cycle_label"] = human_hours(row["median_cycle_hours"])
        dominant = max(row["category_points"], key=lambda key: row["category_points"][key])
        row["dominant_category"] = dominant
        row["why"] = [
            f"{row['high_impact_prs']} top-quartile PRs across {len([c for c, n in row['category_counts'].items() if n])} contribution types",
            f"{round(row['tested_rate'] * 100)}% of PRs show explicit validation and {round(row['issue_linked_rate'] * 100)}% link to tracked issues",
            f"Strongest signal: {dominant.lower()} ({round(row['category_points'][dominant], 1)} weighted points)",
        ]

    ranked = sorted(author_rows.values(), key=lambda row: row["score"], reverse=True)
    top = ranked[:5]

    category_totals = Counter()
    daily_counts = Counter()
    for pr in scored_prs:
        category_totals[pr["category"]] += 1
        merged_at = pr.get("merged_at") or ""
        if merged_at:
            daily_counts[merged_at[:10]] += 1

    result = {
        "repo": payload["repo"],
        "repo_url": "https://github.com/PostHog/posthog",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "data_generated_at": payload.get("generated_at"),
        "window_start": payload["window_start"],
        "window_end": payload["window_end"],
        "source": payload["source"],
        "total_prs": payload["total_prs"],
        "eligible_engineers": len(author_rows),
        "method": {
            "definition": (
                "Impact is evidence that an engineer moved important product, reliability, or platform outcomes "
                "through reviewable work with validation and enough context for others to trust it."
            ),
            "weights": weights,
            "components": {
                "outcome_volume": "Log-scaled sum of PR impact points so volume helps but cannot dominate alone.",
                "high_impact": "Count of PRs in the top quartile of weighted PR impact for this dataset.",
                "depth": "Average score of the engineer's five strongest PRs.",
                "quality": "Testing evidence, issue linkage, and clear problem/change narratives.",
                "breadth": "Distinct scopes and contribution categories touched.",
                "collaboration": "Review conversation and positive peer reactions on PRs.",
            },
            "high_impact_threshold": round(high_impact_threshold, 2),
            "category_meta": CATEGORY_META,
            "exclusions": "Obvious bot accounts and authors with fewer than 3 merged PRs in the window.",
            "caveats": [
                "This uses public GitHub metadata, not private incidents, planning context, customer impact, or reviewer-only nuance.",
                "PR body templates can be noisy, so scoring relies on visible non-comment text and caps any one signal.",
                "Review impact is approximated from PR discussion because full review-thread collection for every PR would exceed the time box.",
            ],
        },
        "category_totals": {key: category_totals.get(key, 0) for key in CATEGORY_META},
        "daily_counts": dict(sorted(daily_counts.items())),
        "top_engineers": top,
        "engineers": top,
    }

    OUT_FILE.write_text(json.dumps(result, indent=2, sort_keys=True))
    SITE_DATA_FILE.write_text("window.DASHBOARD_DATA = " + json.dumps(result, separators=(",", ":")) + ";\n")
    print(f"wrote {OUT_FILE}")
    print("Top 5:")
    for index, row in enumerate(top, 1):
        print(f"{index}. {row['login']} {row['score']} ({row['pr_count']} PRs)")


if __name__ == "__main__":
    main()
