# Engineering Impact Dashboard Assignment

## Dashboard

URL: https://htmlpreview.github.io/?https://github.com/22by7-raikar/weave_posthog/blob/master/impact-dashboard/index.html

## Approach

I defined engineering impact as reviewable work that likely moved an important
product, reliability, or platform outcome, with enough validation and context
for teammates to trust it.

The data source is the public GitHub Search API for `PostHog/posthog`. The
fetcher queries every merge date from 2026-03-29 through 2026-06-27 so the
dataset is not truncated by GitHub's 1,000-result search cap. The model uses
merged PR metadata: title, body, labels, author, author association, merge
time, comments, reactions, issue references, testing evidence, and PR links.

The score intentionally avoids raw lines of code. It combines:

- Outcome volume, log-scaled so raw PR count cannot dominate alone.
- Top-quartile PR count after outcome and quality weighting.
- Depth of the engineer's strongest PRs.
- Quality evidence from tests, issue linkage, and clear problem/change context.
- Breadth across scopes and contribution categories.
- Collaboration signals from PR discussion and peer reactions.

The dashboard shows the top five engineers, score breakdowns, contribution mix,
and linked PR evidence so the ranking can be inspected quickly.

## Time

Started: 2026-06-27 12:52:58 CDT
Finished: 2026-06-27 13:48:33 CDT
Elapsed: 55 minutes 35 seconds

## Reproduce

```bash
python3 scripts/fetch_posthog_prs.py
python3 scripts/analyze_impact.py
python3 -m http.server 8000 --directory site
```
