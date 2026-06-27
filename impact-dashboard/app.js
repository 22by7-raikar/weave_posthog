const data = window.DASHBOARD_DATA;

const colors = {
  Product: "#2563eb",
  Reliability: "#dc2626",
  Platform: "#7c3aed",
  "Engineering Quality": "#059669",
  Documentation: "#d97706",
  Maintenance: "#64748b",
};

const labels = {
  outcome_volume: "Outcome volume",
  high_impact: "Top-quartile PRs",
  depth: "Depth of strongest PRs",
  quality: "Quality evidence",
  breadth: "Breadth",
  collaboration: "Collaboration",
};

const fallbackPresets = {
  balanced: {
    name: "Balanced",
    description: "Default lens: balances outcome volume, high-signal PRs, depth, quality, breadth, and collaboration.",
    weights: {
      outcome_volume: 0.3,
      high_impact: 0.22,
      depth: 0.16,
      quality: 0.14,
      breadth: 0.1,
      collaboration: 0.08,
    },
  },
  outcomes: {
    name: "Outcomes",
    description: "Rewards sustained delivery and top-quartile PR volume while still keeping quality in view.",
    weights: {
      outcome_volume: 0.38,
      high_impact: 0.27,
      depth: 0.15,
      quality: 0.1,
      breadth: 0.06,
      collaboration: 0.04,
    },
  },
  quality: {
    name: "Quality",
    description: "Emphasizes validation, issue linkage, clear PR context, and strong individual PR depth.",
    weights: {
      outcome_volume: 0.1,
      high_impact: 0.14,
      depth: 0.24,
      quality: 0.34,
      breadth: 0.08,
      collaboration: 0.1,
    },
  },
  leverage: {
    name: "Leverage",
    description: "Highlights engineers whose work spans systems and attracts review discussion or peer recognition.",
    weights: {
      outcome_volume: 0.12,
      high_impact: 0.1,
      depth: 0.14,
      quality: 0.18,
      breadth: 0.24,
      collaboration: 0.22,
    },
  },
};

const state = {
  mode: "top",
  selected: null,
  preset: null,
};

function $(id) {
  return document.getElementById(id);
}

function fmtDate(value) {
  const parts = String(value).slice(0, 10).split("-").map(Number);
  const date =
    parts.length === 3 && parts.every(Boolean) ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(value);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtShortDate(value) {
  const parts = String(value).slice(0, 10).split("-").map(Number);
  const date =
    parts.length === 3 && parts.every(Boolean) ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(value);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function visibleEngineers() {
  return rankedEngineers().slice(0, 5);
}

function presets() {
  return data.method?.presets || fallbackPresets;
}

function presetIds() {
  return Object.keys(presets());
}

function activePreset() {
  return presets()[state.preset] || presets().balanced || Object.values(presets())[0];
}

function balancedPreset() {
  return presets().balanced || activePreset();
}

function scoreFor(row, presetId = state.preset) {
  const preset = presets()[presetId] || activePreset();
  if (row.preset_scores?.[presetId] != null) {
    return row.preset_scores[presetId];
  }
  return Object.entries(preset.weights).reduce((sum, [key, weight]) => sum + weight * (row.score_breakdown?.[key] || 0), 0);
}

function rankedEngineers(presetId = state.preset) {
  return [...data.engineers].sort((a, b) => {
    const scoreDiff = scoreFor(b, presetId) - scoreFor(a, presetId);
    return scoreDiff || b.score - a.score || a.login.localeCompare(b.login);
  });
}

function rankFor(login, presetId = state.preset) {
  return rankedEngineers(presetId).findIndex((row) => row.login === login) + 1;
}

function stackedBar(row) {
  const total = Object.values(row.category_points).reduce((sum, value) => sum + value, 0) || 1;
  return Object.entries(row.category_points)
    .filter(([, value]) => value > 0)
    .map(([category, value]) => {
      const width = Math.max(3, (value / total) * 100);
      return `<span title="${escapeHtml(category)}" style="width:${width}%;background:${colors[category]}"></span>`;
    })
    .join("");
}

function renderRanking() {
  const list = $("rankingList");
  const engineers = visibleEngineers();
  list.innerHTML = engineers
    .map(
      (row, index) => `
        <button class="rank-card ${row.login === state.selected ? "active" : ""}" type="button" data-login="${escapeHtml(row.login)}">
          <div class="rank-main">
            <span class="rank-number">#${index + 1}</span>
            <img src="${row.avatar_url}" alt="" loading="lazy" />
            <div>
              <div class="rank-name">${escapeHtml(row.login)}</div>
              <div class="rank-meta">${row.pr_count} PRs - ${row.high_impact_prs} top-quartile - ${escapeHtml(row.dominant_category)}</div>
            </div>
            <span class="score-pill">${scoreFor(row).toFixed(1)}</span>
          </div>
          <div class="stacked" aria-hidden="true">${stackedBar(row)}</div>
        </button>
      `,
    )
    .join("");

  list.querySelectorAll(".rank-card").forEach((button) => {
    button.addEventListener("click", () => selectEngineer(button.dataset.login));
  });
}

function renderSelect() {
  const select = $("engineerSelect");
  select.innerHTML = rankedEngineers()
    .map((row, index) => `<option value="${escapeHtml(row.login)}">#${index + 1} ${escapeHtml(row.login)}</option>`)
    .join("");
  select.value = state.selected;
  select.addEventListener("change", () => selectEngineer(select.value));
}

function renderBreakdown(row) {
  const preset = activePreset();
  $("scoreBreakdown").innerHTML = Object.entries(row.score_breakdown)
    .map(([key, value]) => {
      const contribution = value * (preset.weights[key] || 0);
      return `
        <div class="metric-row">
          <span>${labels[key]}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${value}%"></div></div>
          <span class="metric-value">${contribution.toFixed(1)}</span>
        </div>
      `;
    })
    .join("");
}

function renderCategoryMix(row) {
  const max = Math.max(...Object.values(row.category_points), 1);
  $("categoryMix").innerHTML = Object.entries(row.category_points)
    .filter(([, value]) => value > 0)
    .map(([category, value]) => {
      return `
        <div class="category-row">
          <span>${escapeHtml(category)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%;background:${colors[category]}"></div></div>
          <span class="category-value">${value.toFixed(1)}</span>
        </div>
      `;
    })
    .join("");
}

function signalText(pr) {
  const signals = [];
  if (pr.has_issue_ref) signals.push("issue-linked");
  if (pr.has_test_signal && !pr.weak_or_missing_tests) signals.push("validated");
  if (pr.comments) signals.push(`${pr.comments} comments`);
  if (pr.positive_reactions) signals.push(`${pr.positive_reactions} reactions`);
  if (pr.bonuses?.length) signals.push(...pr.bonuses.slice(0, 2));
  return signals.length ? signals.join(", ") : "metadata-only signal";
}

function renderEvidence(row) {
  $("prEvidence").innerHTML = row.top_prs
    .map(
      (pr) => `
        <article class="pr-row">
          <a class="pr-title" href="${pr.url}" target="_blank" rel="noreferrer" title="${escapeHtml(pr.title)}">
            #${pr.number} ${escapeHtml(pr.title)}
          </a>
          <span class="tag" style="border:1px solid ${colors[pr.category]}33;color:${colors[pr.category]}">${escapeHtml(pr.category)}</span>
          <span class="metric-value">${pr.points.toFixed(1)} pts</span>
          <span class="signal-list">${escapeHtml(signalText(pr))}</span>
        </article>
      `,
    )
    .join("");
}

function buildWhy(row) {
  const bullets = [];

  // Bullet 1: Real scopes from PR data, not an abstract count
  const topScopes = (row.top_scopes || []).slice(0, 4).map(([s]) => s.replace(/-/g, " "));
  const scopeStr = topScopes.length
    ? `focused on ${topScopes.slice(0, 3).join(", ")}${topScopes.length > 3 ? ", and more" : ""}`
    : `across ${(row.dominant_category || "mixed").toLowerCase()} work`;
  bullets.push(`${row.dominant_category} contributor with ${row.pr_count} PRs ${scopeStr}`);

  // Bullet 2: Quality signal + a real PR title as inline evidence
  const topPr = (row.top_prs || [])[0];
  const qualityStr = `${pct(row.tested_rate)} of PRs validated, ${pct(row.issue_linked_rate)} issue-linked`;
  const exampleStr = topPr
    ? ` \u2014 e.g. \u201c${topPr.title.length > 70 ? topPr.title.slice(0, 70) + "\u2026" : topPr.title}\u201d`
    : "";
  bullets.push(qualityStr + exampleStr);

  // Bullet 3: High-impact hit rate + avg depth together
  const hitRate = row.pr_count > 0 ? Math.round((row.high_impact_prs / row.pr_count) * 100) : 0;
  bullets.push(
    `${row.high_impact_prs} of ${row.pr_count} PRs hit the top-quartile bar (${hitRate}% hit rate); avg top-5 PR score: ${(row.avg_top_pr_points || 0).toFixed(1)}`
  );

  return bullets;
}

function renderDetail(row) {
  const preset = activePreset();
  const selectedRank = rankFor(row.login);
  const balancedRank = rankFor(row.login, "balanced");
  const rankDelta = balancedRank && selectedRank ? balancedRank - selectedRank : 0;
  const rankDeltaLabel = rankDelta === 0 ? "same rank" : `${rankDelta > 0 ? "+" : ""}${rankDelta} vs balanced`;
  $("avatar").src = row.avatar_url;
  $("avatar").alt = `${row.login} avatar`;
  $("engineerName").textContent = row.login;
  $("profileLink").href = row.profile_url;
  $("engineerSummary").textContent =
    `#${selectedRank} by ${preset.name.toLowerCase()} model (${scoreFor(row).toFixed(1)} score, ${rankDeltaLabel}), ` +
    `${row.pr_count} merged PRs, median review cycle ${row.median_cycle_label}, ` +
    `${pct(row.tested_rate)} validated and ${pct(row.issue_linked_rate)} issue-linked.`;
  $("whyList").innerHTML = buildWhy(row).map((item) => `<div class="why-item">${escapeHtml(item)}</div>`).join("");
  renderPresetPanel(row);
  renderBreakdown(row);
  renderCategoryMix(row);
  renderEvidence(row);
  $("engineerSelect").value = row.login;
  renderRanking();
}

function selectEngineer(login) {
  state.selected = login;
  const row = data.engineers.find((engineer) => engineer.login === login) || data.top_engineers[0];
  renderDetail(row);
}

function renderPresetControls() {
  const toggle = $("presetToggle");
  if (!toggle) return;
  toggle.innerHTML = presetIds()
    .map((id) => {
      const preset = presets()[id];
      return `<button class="preset-button ${id === state.preset ? "active" : ""}" type="button" data-preset="${id}">${escapeHtml(preset.name)}</button>`;
    })
    .join("");
  toggle.querySelectorAll(".preset-button").forEach((button) => {
    button.addEventListener("click", () => selectPreset(button.dataset.preset));
  });
}

function selectPreset(presetId) {
  state.preset = presetId;
  const top = visibleEngineers()[0] || data.engineers[0];
  state.selected = top?.login || state.selected;
  renderSelect();
  renderPresetControls();
  selectEngineer(state.selected);
}

function renderPresetPanel(row) {
  const preset = activePreset();
  const base = balancedPreset();
  $("presetName").textContent = preset.name;
  $("presetDescription").textContent = preset.description;
  $("weightComparison").innerHTML = Object.keys(labels)
    .map((key) => {
      const activeWeight = preset.weights[key] || 0;
      const baseWeight = base.weights[key] || 0;
      const delta = Math.round((activeWeight - baseWeight) * 100);
      const deltaLabel = delta === 0 ? "0" : `${delta > 0 ? "+" : ""}${delta}`;
      const activeContribution = (row.score_breakdown?.[key] || 0) * activeWeight;
      return `
        <div class="weight-row">
          <span>${labels[key]}</span>
          <div class="weight-bars">
            <div class="weight-track base"><span style="width:${baseWeight * 100}%"></span></div>
            <div class="weight-track active"><span style="width:${activeWeight * 100}%"></span></div>
          </div>
          <span class="weight-value">${Math.round(activeWeight * 100)}% (${deltaLabel})</span>
          <span class="weight-score">${activeContribution.toFixed(1)} pts</span>
        </div>
      `;
    })
    .join("");
}

function renderMethod() {
  const method = data.method;
  const weightItems = Object.entries(method.weights)
    .map(([key, value]) => `<li><strong>${labels[key]}:</strong> ${Math.round(value * 100)}% - ${escapeHtml(method.components[key])}</li>`)
    .join("");
  const caveats = method.caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const categories = Object.entries(method.category_meta)
    .map(([name, meta]) => `<li><strong style="color:${meta.color}">${escapeHtml(name)}:</strong> ${escapeHtml(meta.description)}</li>`)
    .join("");

  $("methodContent").innerHTML = `
    <div>
      <p><strong>Definition:</strong> ${escapeHtml(method.definition)}</p>
      <p><strong>Exclusions:</strong> ${escapeHtml(method.exclusions)}</p>
    </div>
    <div><ul>${weightItems}</ul></div>
    <div><ul>${categories}${caveats}</ul></div>
  `;
}

function init() {
  if (!data) {
    document.body.innerHTML = "<main class='shell'><p>Dashboard data was not generated yet.</p></main>";
    return;
  }

  $("totalPrs").textContent = data.total_prs.toLocaleString();
  $("engineerCount").textContent = data.eligible_engineers.toLocaleString();
  $("windowLabel").textContent = `${fmtShortDate(data.window_start)} - ${fmtDate(data.window_end)}`;
  $("updatedLabel").textContent = `Generated ${fmtDate(data.generated_at)}`;
  $("repoLink").href = data.repo_url;

  state.preset = data.method?.default_preset || "balanced";
  state.selected = rankedEngineers()[0]?.login || data.top_engineers[0]?.login;
  renderSelect();
  renderPresetControls();
  renderMethod();
  renderRanking();
  selectEngineer(state.selected);

  $("topMode")?.addEventListener("click", () => {
    state.mode = "top";
    $("topMode").classList.add("active");
    $("allMode")?.classList.remove("active");
    renderRanking();
  });

  $("allMode")?.addEventListener("click", () => {
    state.mode = "all";
    $("allMode")?.classList.add("active");
    $("topMode").classList.remove("active");
    renderRanking();
  });
}

init();
