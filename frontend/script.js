const API = "http://localhost:5000";

const DEFAULT_CATEGORIES = [
  { name: "Savings & Investments", budget: 60000 },
  { name: "Rent",                  budget: 21000 },
  { name: "Food & Groceries",      budget: 4000  },
  { name: "Fruits & Healthy Eating", budget: 4000 },
  { name: "Mobile & Subscriptions", budget: 500  },
  { name: "Eating Out / Fun",       budget: 4000  },
  { name: "Shopping / Personal Care", budget: 2500 },
  { name: "Emergency / Buffer",     budget: 2000  },
];

const state = {
  view: "plans",        // "plans" | "new-plan" | "periods" | "new-period" | "period"
  plans: [],
  activePlan: null,
  periods: [],
  activePeriod: null,
  expenses: [],
  activeTab: "transactions",
  editMode: false,
  editDraft: null,
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmt(n) {
  return "₹" + Math.abs(n).toLocaleString("en-IN");
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function toInputDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function autoEndDate(startStr, type) {
  if (!startStr) return "";
  const d = new Date(startStr);
  if (type === "monthly") return new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()).toISOString().slice(0, 10);
  if (type === "weekly")  { d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); }
  if (type === "yearly")  return new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()).toISOString().slice(0, 10);
  return "";
}

function autoLabel(startStr, type) {
  if (!startStr) return "";
  const d = new Date(startStr);
  if (type === "monthly") {
    const end = new Date(autoEndDate(startStr, "monthly"));
    return end.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }
  if (type === "weekly") return "Week of " + d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  if (type === "yearly")  return String(d.getFullYear());
  return "";
}

function nextPeriodStart(periods) {
  if (!periods.length) {
    const now = new Date();
    const d = now.getDate(), y = now.getFullYear(), m = now.getMonth();
    return d >= 25 ? new Date(y, m, 25) : new Date(y, m - 1, 25);
  }
  const latest = [...periods].sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0];
  return new Date(latest.endDate);
}

// ─── Render dispatcher ────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById("app");
  const views = {
    "plans":      renderPlans,
    "new-plan":   renderNewPlan,
    "periods":    renderPeriods,
    "new-period": renderNewPeriod,
    "period":     renderPeriod,
  };
  app.innerHTML = (views[state.view] || renderPlans)();
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function loadPlans() {
  const res = await fetch(`${API}/plans`);
  state.plans = await res.json();
}

async function loadPeriods() {
  const res = await fetch(`${API}/plans/${state.activePlan._id}/periods`);
  state.periods = await res.json();
}

async function loadExpenses() {
  const res = await fetch(`${API}/periods/${state.activePeriod._id}/expenses`);
  state.expenses = await res.json();
}

// ─── Navigation ───────────────────────────────────────────────────────────────

async function openPlan(id) {
  state.activePlan = state.plans.find(p => p._id === id);
  await loadPeriods();
  state.view = "periods";
  state.editMode = false;
  render();
}

async function openPeriod(id) {
  state.activePeriod = state.periods.find(p => p._id === id);
  await loadExpenses();
  state.view = "period";
  state.activeTab = "transactions";
  render();
}

function goPlans() {
  state.view = "plans";
  state.activePlan = null;
  state.periods = [];
  state.activePeriod = null;
  state.expenses = [];
  render();
}

function goPeriods() {
  state.view = "periods";
  state.activePeriod = null;
  state.expenses = [];
  state.editMode = false;
  render();
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.add("active");
  document.getElementById(`content-${tab}`).classList.add("active");
}

// ─── Plans CRUD ───────────────────────────────────────────────────────────────

async function createPlan() {
  const name   = document.getElementById("np-name").value.trim();
  const salary = Number(document.getElementById("np-salary").value);
  if (!name || !salary) { alert("Name and salary are required"); return; }

  const rows = document.querySelectorAll(".np-cat-row");
  const categories = [];
  rows.forEach(row => {
    const n = row.querySelector(".np-cat-name").value.trim();
    const b = Number(row.querySelector(".np-cat-budget").value);
    if (n) categories.push({ name: n, budget: b || 0 });
  });

  await fetch(`${API}/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, salary, categories }),
  });
  await loadPlans();
  state.view = "plans";
  render();
}

async function savePlan() {
  const draft = state.editDraft;
  draft.name   = document.getElementById("edit-name").value.trim();
  draft.salary = Number(document.getElementById("edit-salary").value);

  const rows = document.querySelectorAll(".edit-cat-row");
  const categories = [];
  rows.forEach(row => {
    const n = row.querySelector(".edit-cat-name").value.trim();
    const b = Number(row.querySelector(".edit-cat-budget").value);
    if (n) categories.push({ name: n, budget: b || 0 });
  });
  draft.categories = categories;

  const updated = await fetch(`${API}/plans/${draft._id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  }).then(r => r.json());

  state.activePlan = updated;
  state.editMode  = false;
  state.editDraft = null;
  await loadPlans();
  render();
}

async function deletePlan(id) {
  if (!confirm("Delete this plan and all its periods and transactions?")) return;
  await fetch(`${API}/plans/${id}`, { method: "DELETE" });
  await loadPlans();
  goPlans();
}

// ─── Periods CRUD ─────────────────────────────────────────────────────────────

async function createPeriod() {
  const label = document.getElementById("per-label").value.trim();
  const type  = document.getElementById("per-type").value;
  const start = document.getElementById("per-start").value;
  const end   = document.getElementById("per-end").value;
  if (!start || !end) { alert("Start and end dates are required"); return; }

  await fetch(`${API}/plans/${state.activePlan._id}/periods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: label || autoLabel(start, type), type, startDate: start, endDate: end }),
  });
  await loadPeriods();
  state.view = "periods";
  render();
}

async function deletePeriod(id) {
  if (!confirm("Delete this period and all its transactions?")) return;
  await fetch(`${API}/periods/${id}`, { method: "DELETE" });
  await loadPeriods();
  goPeriods();
}

// ─── Expenses CRUD ────────────────────────────────────────────────────────────

async function addExpense() {
  const category = document.getElementById("cat-select").value;
  const amount   = Number(document.getElementById("amt-input").value);
  const note     = document.getElementById("note-input").value.trim();
  if (!amount) { alert("Enter an amount"); return; }

  await fetch(`${API}/periods/${state.activePeriod._id}/expenses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, amount, note }),
  });
  document.getElementById("amt-input").value  = "";
  document.getElementById("note-input").value = "";
  await loadExpenses();
  render();
}

async function deleteExpense(id) {
  await fetch(`${API}/expenses/${id}`, { method: "DELETE" });
  await loadExpenses();
  render();
}

// ─── View: Plans list ─────────────────────────────────────────────────────────

function renderPlans() {
  const cards = state.plans.map(p => `
    <div class="plan-card" onclick="openPlan('${p._id}')">
      <div class="plan-card-header">
        <span class="plan-card-name">${p.name}</span>
        <span class="plan-card-salary">${fmt(p.salary)} / mo</span>
      </div>
      <div class="plan-card-sub">${p.periodCount} period${p.periodCount !== 1 ? "s" : ""} · ${p.categories.length} categories</div>
    </div>
  `).join("") || `<div class="empty">No plans yet. Create your first one.</div>`;

  return `
    <div class="container">
      <header class="list-header">
        <h1>Budget Tracker</h1>
        <button onclick="state.view='new-plan'; render()">+ New Plan</button>
      </header>
      <div class="plan-list">${cards}</div>
    </div>
  `;
}

// ─── View: New Plan ───────────────────────────────────────────────────────────

function renderNewPlan() {
  const seed = state.plans.length ? state.plans[0].categories : DEFAULT_CATEGORIES;
  const catRows = seed.map(c => `
    <div class="np-cat-row">
      <input class="np-cat-name"   type="text"   value="${c.name}"   placeholder="Category">
      <input class="np-cat-budget" type="number" value="${c.budget}" placeholder="Budget">
      <button class="icon-btn" onclick="this.closest('.np-cat-row').remove()">×</button>
    </div>
  `).join("");

  return `
    <div class="container">
      <header class="plan-header">
        <button class="back-btn" onclick="goPlans()">← Back</button>
        <h1>New Plan</h1><span></span>
      </header>
      <div class="form-card">
        <div class="np-meta-row">
          <div class="field"><label>Plan Name</label><input id="np-name" type="text" placeholder="e.g. Main Budget"></div>
          <div class="field"><label>Monthly Income</label><input id="np-salary" type="number" placeholder="98000"></div>
        </div>
      </div>
      <div class="section-label">Categories</div>
      <div class="form-card">
        <div id="np-cat-list">${catRows}</div>
        <button class="ghost-btn" onclick="addNpCatRow()">+ Add Category</button>
      </div>
      <div class="action-row">
        <button class="secondary-btn" onclick="goPlans()">Cancel</button>
        <button onclick="createPlan()">Create Plan</button>
      </div>
    </div>
  `;
}

function addNpCatRow() {
  const row = document.createElement("div");
  row.className = "np-cat-row";
  row.innerHTML = `
    <input class="np-cat-name" type="text" placeholder="Category">
    <input class="np-cat-budget" type="number" placeholder="Budget">
    <button class="icon-btn" onclick="this.closest('.np-cat-row').remove()">×</button>
  `;
  document.getElementById("np-cat-list").appendChild(row);
}

// ─── View: Periods list ───────────────────────────────────────────────────────

function renderPeriods() {
  const p = state.activePlan;
  if (state.editMode) return renderEditPlan(p);

  const cards = state.periods.map(period => {
    const spent = period.spent || 0;
    const pct   = Math.min(Math.round((spent / p.salary) * 100), 100);
    const typeLabel = { monthly: "Monthly", weekly: "Weekly", yearly: "Yearly", custom: "Custom" }[period.type] || "";
    return `
      <div class="plan-card" onclick="openPeriod('${period._id}')">
        <div class="plan-card-header">
          <span class="plan-card-name">${period.label || fmtDate(period.startDate)}</span>
          <span class="period-type-chip">${typeLabel}</span>
        </div>
        <div class="plan-card-sub">${fmtDate(period.startDate)} – ${fmtDate(period.endDate)}</div>
        <div class="plan-card-bar-track">
          <div class="plan-card-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="plan-card-footer">
          <span>${fmt(spent)} spent</span>
          <span>${fmt(p.salary - spent)} left</span>
        </div>
      </div>
    `;
  }).join("") || `<div class="empty">No periods yet. Add your first one.</div>`;

  return `
    <div class="container">
      <header class="plan-header">
        <button class="back-btn" onclick="goPlans()">← Plans</button>
        <div class="plan-header-center">
          <h1>${p.name}</h1>
          <p>${fmt(p.salary)} / month · ${p.categories.length} categories</p>
        </div>
        <button class="edit-btn" onclick="enterEditMode()">Edit</button>
      </header>
      <div class="plan-list">${cards}</div>
      <div class="action-row" style="margin-top:20px">
        <button class="danger-btn" onclick="deletePlan('${p._id}')">Delete Plan</button>
        <button onclick="state.view='new-period'; render()">+ New Period</button>
      </div>
    </div>
  `;
}

// ─── View: Edit Plan ──────────────────────────────────────────────────────────

function renderEditPlan(p) {
  const catRows = p.categories.map(c => `
    <div class="edit-cat-row">
      <input class="edit-cat-name"   type="text"   value="${c.name}">
      <input class="edit-cat-budget" type="number" value="${c.budget}">
      <button class="icon-btn" onclick="this.closest('.edit-cat-row').remove()">×</button>
    </div>
  `).join("");

  return `
    <div class="container">
      <header class="plan-header">
        <button class="back-btn" onclick="cancelEdit()">Cancel</button>
        <h1>Edit Plan</h1>
        <button onclick="savePlan()">Save</button>
      </header>
      <div class="form-card">
        <div class="np-meta-row">
          <div class="field"><label>Plan Name</label><input id="edit-name" type="text" value="${p.name}"></div>
          <div class="field"><label>Monthly Income</label><input id="edit-salary" type="number" value="${p.salary}"></div>
        </div>
      </div>
      <div class="section-label">Categories</div>
      <div class="form-card">
        <div id="edit-cat-list">${catRows}</div>
        <button class="ghost-btn" onclick="addEditCatRow()">+ Add Category</button>
      </div>
    </div>
  `;
}

function addEditCatRow() {
  const row = document.createElement("div");
  row.className = "edit-cat-row";
  row.innerHTML = `
    <input class="edit-cat-name"   type="text"   placeholder="Category">
    <input class="edit-cat-budget" type="number" placeholder="Budget">
    <button class="icon-btn" onclick="this.closest('.edit-cat-row').remove()">×</button>
  `;
  document.getElementById("edit-cat-list").appendChild(row);
}

function enterEditMode() {
  state.editMode  = true;
  state.editDraft = JSON.parse(JSON.stringify(state.activePlan));
  render();
}

function cancelEdit() {
  state.editMode  = false;
  state.editDraft = null;
  render();
}

// ─── View: New Period ─────────────────────────────────────────────────────────

function renderNewPeriod() {
  const start    = nextPeriodStart(state.periods);
  const startStr = toInputDate(start);
  const endStr   = autoEndDate(startStr, "monthly");
  const label    = autoLabel(startStr, "monthly");

  return `
    <div class="container">
      <header class="plan-header">
        <button class="back-btn" onclick="goPeriods()">← Back</button>
        <h1>New Period</h1><span></span>
      </header>
      <div class="form-card">
        <div class="np-meta-row">
          <div class="field"><label>Label</label><input id="per-label" type="text" value="${label}" placeholder="e.g. May 2026"></div>
          <div class="field">
            <label>Frequency</label>
            <select id="per-type" onchange="onTypeChange()">
              <option value="monthly" selected>Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>
        <div class="np-meta-row">
          <div class="field"><label>Start Date</label><input id="per-start" type="date" value="${startStr}" onchange="onStartChange()"></div>
          <div class="field"><label>End Date</label><input id="per-end" type="date" value="${endStr}"></div>
        </div>
      </div>
      <div class="action-row">
        <button class="secondary-btn" onclick="goPeriods()">Cancel</button>
        <button onclick="createPeriod()">Create Period</button>
      </div>
    </div>
  `;
}

function onTypeChange() {
  const type  = document.getElementById("per-type").value;
  const start = document.getElementById("per-start").value;
  if (type !== "custom" && start) {
    document.getElementById("per-end").value   = autoEndDate(start, type);
    document.getElementById("per-label").value = autoLabel(start, type);
  }
}

function onStartChange() {
  const type  = document.getElementById("per-type").value;
  const start = document.getElementById("per-start").value;
  if (type !== "custom") {
    document.getElementById("per-end").value   = autoEndDate(start, type);
    document.getElementById("per-label").value = autoLabel(start, type);
  }
}

// ─── View: Period (transactions + budget) ─────────────────────────────────────

function renderPeriod() {
  const plan   = state.activePlan;
  const period = state.activePeriod;
  const spent  = state.expenses.reduce((s, e) => s + e.amount, 0);
  const rem    = plan.salary - spent;

  const catOptions = plan.categories.map(c => `<option>${c.name}</option>`).join("");

  const transactionsHtml = state.expenses.length
    ? state.expenses.map(e => `
        <div class="expense-item">
          <div class="expense-meta">
            <div class="cat">${e.category}</div>
            ${e.note ? `<div class="note">${e.note}</div>` : ""}
            <div class="date">${new Date(e.createdAt).toLocaleString("en-IN", {
              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
            })}</div>
          </div>
          <div class="expense-right">
            <span class="expense-amount">${fmt(e.amount)}</span>
            <button class="del-btn" onclick="deleteExpense('${e._id}')">Delete</button>
          </div>
        </div>
      `).join("")
    : `<div class="empty">No transactions yet</div>`;

  const byCategory = {};
  state.expenses.forEach(e => {
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  });

  const budgetHtml = plan.categories.map(({ name, budget }) => {
    const sp  = byCategory[name] || 0;
    const pr  = budget - sp;
    const pct = Math.min((sp / budget) * 100, 100);
    const over = pr < 0;
    const clr  = pct < 70 ? "var(--success)" : pct < 90 ? "var(--warning)" : "var(--danger)";
    return `
      <div class="budget-item">
        <div class="budget-header">
          <span class="budget-cat">${name}</span>
          <span>
            <span class="budget-remaining" style="color:${over ? "var(--danger)" : "var(--text)"}">
              ${over ? fmt(-pr) + " excess" : fmt(pr) + " left"}
            </span>
            <span class="budget-of"> / ${fmt(budget)}</span>
          </span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${clr}"></div></div>
        <div class="budget-footer">
          <span>${over ? fmt(sp) + " spent · carries over" : fmt(sp) + " spent"}</span>
          <span>${Math.round(pct)}%</span>
        </div>
      </div>
    `;
  }).join("");

  const tA = state.activeTab === "transactions" ? "active" : "";
  const bA = state.activeTab === "budget" ? "active" : "";

  return `
    <div class="container">
      <header class="plan-header">
        <button class="back-btn" onclick="goPeriods()">← ${plan.name}</button>
        <div class="plan-header-center">
          <h1>${period.label || fmtDate(period.startDate)}</h1>
          <p>${fmtDate(period.startDate)} – ${fmtDate(period.endDate)}</p>
        </div>
        <button class="edit-btn danger-btn-sm" onclick="deletePeriod('${period._id}')">Delete</button>
      </header>

      <div class="summary">
        <div class="summary-item"><div class="label">Salary</div><div class="value">${fmt(plan.salary)}</div></div>
        <div class="summary-item"><div class="label">Spent</div><div class="value">${fmt(spent)}</div></div>
        <div class="summary-item"><div class="label">Remaining</div><div class="value" style="color:${rem < 0 ? "var(--danger)" : "inherit"}">${fmt(rem)}</div></div>
      </div>

      <div class="form-card">
        <div class="form-row">
          <select id="cat-select">${catOptions}</select>
          <input type="number" id="amt-input" placeholder="Amount (₹)">
          <input type="text"   id="note-input" placeholder="Note">
          <button onclick="addExpense()">Add</button>
        </div>
      </div>

      <div class="tabs">
        <button class="tab-btn ${tA}" id="tab-transactions" onclick="switchTab('transactions')">Transactions</button>
        <button class="tab-btn ${bA}" id="tab-budget"       onclick="switchTab('budget')">Budget</button>
      </div>
      <div class="tab-content ${tA}" id="content-transactions">${transactionsHtml}</div>
      <div class="tab-content ${bA}" id="content-budget">${budgetHtml}</div>
    </div>
  `;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await loadPlans();
  render();
})();
