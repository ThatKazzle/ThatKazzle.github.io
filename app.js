const SHEET_ID = "1hqIfYwQGvUdQ85aTVrGsFuyQSuaoch_Spx7E_ebvxf0";
const SHEET_NAME = "Sheet1";
const GID = 0;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD"
});

const stateKey = "payPeriodLens:v1";
const trackerPrefix = "payPeriodLens:tracker:";
const bucketPrefix = "payPeriodLens:bucket:";

const bucketLabels = {
  "cash-out": "Cash out",
  "spending": "Spending",
  "savings": "Savings",
  "keep": "Keep",
  "other": "Other",
};

const defaultBucketOrder = ["cash-out", "spending", "savings", "keep", "other"];

const demoFallback = null;

const els = {
  statusBadge: document.getElementById("statusBadge"),
  statusText: document.getElementById("statusText"),
  periodTitle: document.getElementById("periodTitle"),
  periodDates: document.getElementById("periodDates"),
  periodMeta: document.getElementById("periodMeta"),
  appLastUpdated: document.getElementById("appLastUpdated"),
  kpiPaycheck: document.getElementById("kpiPaycheck"),
  kpiCashOut: document.getElementById("kpiCashOut"),
  kpiSpending: document.getElementById("kpiSpending"),
  kpiSavings: document.getElementById("kpiSavings"),
  kpiKeep: document.getElementById("kpiKeep"),
  kpiLeft: document.getElementById("kpiLeft"),
  periodFill: document.getElementById("periodFill"),
  spendFill: document.getElementById("spendFill"),
  cashFill: document.getElementById("cashFill"),
  periodPct: document.getElementById("periodPct"),
  spendPct: document.getElementById("spendPct"),
  cashPct: document.getElementById("cashPct"),
  itemsBody: document.getElementById("itemsBody"),
  trackerForm: document.getElementById("trackerForm"),
  spendAmount: document.getElementById("spendAmount"),
  spendNote: document.getElementById("spendNote"),
  quickButtons: document.getElementById("quickButtons"),
  spendRemaining: document.getElementById("spendRemaining"),
  safeDaily: document.getElementById("safeDaily"),
  daysLeft: document.getElementById("daysLeft"),
  spendLog: document.getElementById("spendLog"),
  resetBtn: document.getElementById("resetBtn"),
};

let appState = {
  source: "loading",
  sheet: null,
  periods: [],
  rows: [],
  activePeriodIndex: 0,
  activePeriod: null,
  activeRows: [],
  totals: {},
  tracker: { spent: [] },
  bucketOverrides: {},
};

function money(n) {
  const num = Number(n || 0);
  return currency.format(Number.isFinite(num) ? num : 0);
}

function asNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,]/g, "").trim();
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cleanText(v) {
  return (v ?? "").toString().trim();
}

function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const utcDays = Math.floor(n - 25569);
  const utcValue = utcDays * 86400 * 1000;
  const dateInfo = new Date(utcValue);
  return isNaN(dateInfo.getTime()) ? null : dateInfo;
}

function parseMaybeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return excelSerialToDate(value);
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n) && value.trim() === String(n)) return excelSerialToDate(n);
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function fmtDate(d) {
  return d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d) : "—";
}

function fmtShortDate(d) {
  return d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d) : "—";
}

function fmtDateTime(d) {
  return d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d) : "—";
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function loadDemoSnapshot() {
  const res = await fetch("./demo-data.json", { cache: "no-store" });
  return await res.json();
}

async function fetchLiveSheet() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Sheet fetch failed (${response.status})`);
  }
  const text = await response.text();
  return { source: "live sheet", raw: text };
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function inferBucket(name, note, rowIndex) {
  const override = appState.bucketOverrides[rowIndex];
  if (override) return override;

  const text = `${name} ${note}`.toLowerCase();

  if (/dues to be paid|withdraw|cash out|cash-out|cash/i.test(text)) return "cash-out";
  if (/savings?|save/i.test(text)) return "savings";
  if (/want|spend|gas|fun|food|misc/i.test(text)) return "spending";
  if (/insurance|spotify|phone|debt|tags|windshield|car expense|car expenses|bill/i.test(text)) return "keep";
  return "other";
}

function isSummaryRow(name) {
  return /^(sum of bills|remaining|total:|remaining to be paid:|due date|name \/ note|paycheck|dues to be paid:|amount:)/i.test(name);
}

function pickActivePeriod(periods, today = new Date()) {
  if (!periods.length) return 0;
  let idx = 0;
  for (let i = 0; i < periods.length; i++) {
    if (periods[i].start <= today) idx = i;
    else break;
  }
  return idx;
}

function buildModel(sheetRows) {
  const rows = sheetRows || [];
  if (!rows.length) throw new Error("No rows found.");

  const header = rows[0];
  const periodCols = [];
  for (let c = 0; c < header.length; c++) {
    const d = parseMaybeDate(header[c]);
    if (d) periodCols.push({ col: c, start: d });
  }

  const periods = periodCols.map((p, i) => ({
    index: i,
    col: p.col,
    start: p.start,
    end: periodCols[i + 1] ? new Date(periodCols[i + 1].start.getTime() - 86400000) : new Date(p.start.getTime() + 13 * 86400000),
    label: `${fmtShortDate(p.start)} – ${fmtShortDate(periodCols[i + 1] ? new Date(periodCols[i + 1].start.getTime() - 86400000) : new Date(p.start.getTime() + 13 * 86400000))}`,
  }));

  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const note = cleanText(row[0]);
    const name = cleanText(row[1]);
    if (!name || isSummaryRow(name)) continue;

    const baseAmount = asNumber(row[2]);
    const periodValues = periodCols.map((p) => asNumber(row[p.col]));
    items.push({
      rowIndex: r,
      note,
      name,
      baseAmount,
      periodValues,
    });
  }

  return { periods, items };
}

function getActiveRows(model, periodIndex) {
  return model.items
    .map((item) => {
      const raw = item.periodValues[periodIndex];
      const amount = raw ?? item.baseAmount ?? 0;
      const bucket = inferBucket(item.name, item.note, item.rowIndex);
      return { ...item, amount, bucket };
    })
    .filter((item) => Number.isFinite(item.amount) && item.amount !== 0);
}

function sumBy(rows, bucket) {
  return rows.filter((r) => r.bucket === bucket).reduce((a, r) => a + (Number(r.amount) || 0), 0);
}

function calcTotals(activeRows, paycheck, trackerSpent) {
  const cashOut = sumBy(activeRows, "cash-out");
  const spending = sumBy(activeRows, "spending");
  const savings = sumBy(activeRows, "savings");
  const keep = sumBy(activeRows, "keep");
  const other = sumBy(activeRows, "other");
  const localSpent = trackerSpent.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const spendRemaining = spending - localSpent;
  const leftAfterFixed = paycheck - cashOut - savings - keep - other;
  return { cashOut, spending, savings, keep, other, localSpent, spendRemaining, leftAfterFixed };
}

function periodKey(period) {
  return period ? period.start.toISOString().slice(0, 10) : "none";
}

function loadTrackerForPeriod(period) {
  const key = trackerPrefix + periodKey(period);
  return loadJSON(key, { spent: [] });
}

function saveTrackerForPeriod(period, tracker) {
  const key = trackerPrefix + periodKey(period);
  saveJSON(key, tracker);
}

function loadBucketOverrides() {
  return loadJSON(bucketPrefix, {});
}

function saveBucketOverrides(overrides) {
  saveJSON(bucketPrefix, overrides);
}

function render() {
  const period = appState.activePeriod;
  const rows = appState.activeRows;
  const tracker = appState.tracker;
  const totals = appState.totals;
  const now = new Date();

  const daysLeft = period ? Math.max(0, Math.ceil((period.end - now) / 86400000)) : 0;
  const daysTotal = period ? Math.max(1, Math.round((period.end - period.start) / 86400000) + 1) : 1;
  const daysUsed = period ? Math.max(0, daysTotal - daysLeft) : 0;
  const periodProgress = period ? Math.min(100, Math.max(0, (daysUsed / daysTotal) * 100)) : 0;
  const spendProgress = totals.spending > 0 ? Math.min(100, Math.max(0, ((totals.spending - totals.spendRemaining) / totals.spending) * 100)) : 0;
  const cashProgress = totals.cashOut > 0 ? Math.min(100, Math.max(0, (totals.cashOut / Math.max(1, totals.cashOut)) * 100)) : 0;
  const safeDaily = daysLeft > 0 ? totals.spendRemaining / daysLeft : totals.spendRemaining;
  const paycheck = Number(appState.totals.paycheck) || 0;

  els.statusBadge.textContent = appState.source === "live sheet" ? "Live sheet connected" : "Demo fallback";
  els.statusBadge.className = "badge " + (appState.source === "live sheet" ? "ok" : "warn");
  els.statusText.textContent = appState.source === "live sheet"
    ? `Reading ${SHEET_NAME} from Google Sheets.`
    : `Using local demo snapshot because the live sheet request failed.`;
  els.appLastUpdated.textContent = `Updated ${fmtDateTime(now)}`;
  els.periodTitle.textContent = period ? `Pay period ${period.index + 1}` : "No pay period found";
  els.periodDates.textContent = period ? `${fmtDate(period.start)} to ${fmtDate(period.end)}` : "—";
  els.periodMeta.textContent = period ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left · auto-switches on the next period date` : "—";

  els.kpiPaycheck.textContent = money(paycheck);
  els.kpiCashOut.textContent = money(totals.cashOut);
  els.kpiSpending.textContent = money(totals.spending);
  els.kpiSavings.textContent = money(totals.savings);
  els.kpiKeep.textContent = money(totals.keep);
  els.kpiLeft.textContent = money(totals.spendRemaining);

  els.periodFill.style.width = `${periodProgress}%`;
  els.spendFill.style.width = `${spendProgress}%`;
  els.cashFill.style.width = `${cashProgress}%`;
  els.periodPct.textContent = `${periodProgress.toFixed(0)}% of the pay period`;
  els.spendPct.textContent = `${spendProgress.toFixed(0)}% of spending money used`;
  els.cashPct.textContent = `${totals.cashOut > 0 ? "Ready to withdraw" : "No cash-out items"}`;

  els.spendRemaining.textContent = money(totals.spendRemaining);
  els.safeDaily.textContent = money(safeDaily);
  els.daysLeft.textContent = `${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  els.spendLog.innerHTML = tracker.spent.length
    ? tracker.spent
        .slice()
        .reverse()
        .map((entry, idx) => `
          <div class="log-item">
            <div>
              <strong>${money(entry.amount)}</strong>
              <small> · ${entry.note || "Spending entry"} · ${fmtShortDate(new Date(entry.at))}</small>
            </div>
            <button class="secondary" data-remove-spend="${idx}">Remove</button>
          </div>
        `)
        .join("")
    : `<div class="small-muted">No spending logged yet for this period.</div>`;

  els.itemsBody.innerHTML = rows.map((row) => {
    const rowKey = `${row.rowIndex}`;
    const amount = row.amount ?? 0;
    const override = appState.bucketOverrides[row.rowIndex] || "";
    return `
      <tr>
        <td>
          <div><strong>${row.name}</strong></div>
          <div class="small-muted">${row.note || "—"}</div>
        </td>
        <td>${money(amount)}</td>
        <td>
          <select data-row-bucket="${rowKey}">
            ${defaultBucketOrder.map((b) => `<option value="${b}" ${ (override || row.bucket) === b ? "selected" : "" }>${bucketLabels[b]}</option>`).join("")}
          </select>
        </td>
      </tr>
    `;
  }).join("");

  saveTrackerForPeriod(period, tracker);
  saveBucketOverrides(appState.bucketOverrides);
}

function recompute() {
  const model = appState.model;
  const now = new Date();
  const activeIndex = pickActivePeriod(model.periods, now);
  const activePeriod = model.periods[activeIndex] || null;
  const activeRows = getActiveRows(model, activeIndex);
  const tracker = loadTrackerForPeriod(activePeriod);
  const paycheck = (() => {
    const rows = appState.rawRows || [];
    const row = rows[1] || [];
    const val = row[activePeriod ? activePeriod.col : 3];
    return asNumber(val) ?? 0;
  })();

  const totals = calcTotals(activeRows, paycheck, tracker.spent || []);
  totals.paycheck = paycheck;

  appState.activePeriodIndex = activeIndex;
  appState.activePeriod = activePeriod;
  appState.activeRows = activeRows;
  appState.tracker = tracker;
  appState.totals = totals;
}

async function init() {
  appState.bucketOverrides = loadBucketOverrides();

  try {
    const live = await fetchLiveSheet();
    const csvRows = parseCSV(live.raw);
    appState.rawRows = csvRows;
    appState.model = buildModel(csvRows);
    appState.source = live.source;
  } catch (liveErr) {
    console.warn("Live sheet failed; falling back to demo data.", liveErr);
    const demo = await loadDemoSnapshot();
    appState.rawRows = demo.rows;
    appState.model = buildModel(demo.rows);
    appState.source = "demo fallback";
  }

  recompute();
  render();

  appState.timer = setInterval(() => {
    const before = appState.activePeriod ? periodKey(appState.activePeriod) : "none";
    recompute();
    const after = appState.activePeriod ? periodKey(appState.activePeriod) : "none";
    if (before !== after) {
      render();
    } else {
      render();
    }
  }, 30000);
}

document.addEventListener("click", (event) => {
  const removeIdx = event.target?.dataset?.removeSpend;
  if (removeIdx !== undefined) {
    const idx = Number(removeIdx);
    const tracker = appState.tracker;
    const reversed = tracker.spent.slice().reverse();
    reversed.splice(idx, 1);
    tracker.spent = reversed.reverse();
    saveTrackerForPeriod(appState.activePeriod, tracker);
    recompute();
    render();
  }
});

els.trackerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const amount = Number(els.spendAmount.value);
  const note = els.spendNote.value.trim();
  if (!Number.isFinite(amount) || amount <= 0) return;

  appState.tracker.spent.push({
    amount,
    note,
    at: new Date().toISOString(),
  });
  els.spendAmount.value = "";
  els.spendNote.value = "";
  saveTrackerForPeriod(appState.activePeriod, appState.tracker);
  recompute();
  render();
});

els.quickButtons.addEventListener("click", (event) => {
  const amt = event.target?.dataset?.quickAmt;
  if (!amt) return;
  els.spendAmount.value = amt;
  els.spendNote.focus();
});

els.resetBtn.addEventListener("click", () => {
  if (!appState.activePeriod) return;
  const key = trackerPrefix + periodKey(appState.activePeriod);
  localStorage.removeItem(key);
  recompute();
  render();
});

document.addEventListener("change", (event) => {
  const rowIndex = event.target?.dataset?.rowBucket;
  if (rowIndex !== undefined) {
    const idx = Number(rowIndex);
    const bucket = event.target.value;
    appState.bucketOverrides[idx] = bucket;
    saveBucketOverrides(appState.bucketOverrides);
    recompute();
    render();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}

init();
