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
  high_impact: "High-impact PRs",
  depth: "Depth of strongest PRs",
  quality: "Quality evidence",
  breadth: "Breadth",
  collaboration: "Collaboration",
};

const state = {
  mode: "top",
  selected: null,
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
  return state.mode === "top" ? data.top_engineers : data.engineers;
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
            <span class="score-pill">${row.score}</span>
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
  select.innerHTML = data.engineers
    .map((row, index) => `<option value="${escapeHtml(row.login)}">#${index + 1} ${escapeHtml(row.login)}</option>`)
    .join("");
  select.value = state.selected;
  select.addEventListener("change", () => selectEngineer(select.value));
}

function renderBreakdown(row) {
  $("scoreBreakdown").innerHTML = Object.entries(row.score_breakdown)
    .map(([key, value]) => {
      return `
        <div class="metric-row">
          <span>${labels[key]}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${value}%"></div></div>
          <span class="metric-value">${value}</span>
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

function renderDetail(row) {
  $("avatar").src = row.avatar_url;
  $("avatar").alt = `${row.login} avatar`;
  $("engineerName").textContent = row.login;
  $("profileLink").href = row.profile_url;
  $("engineerSummary").textContent =
    `${row.score} impact score from ${row.pr_count} merged PRs, median review cycle ${row.median_cycle_label}, ` +
    `${pct(row.tested_rate)} validated and ${pct(row.issue_linked_rate)} issue-linked.`;
  $("whyList").innerHTML = row.why.map((item) => `<div class="why-item">${escapeHtml(item)}</div>`).join("");
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

  state.selected = data.top_engineers[0]?.login;
  renderSelect();
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
