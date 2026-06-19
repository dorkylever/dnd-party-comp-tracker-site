/* ==========================================================================
   app.js — application state, DOM wiring, and bootstrap.

   Browser-only and loaded last. Owns the mutable application state (the loaded
   dataset and the current party selection), wires up the dropdowns and event
   listeners, loads subclasses.json, and orchestrates the initial render. It
   relies on the globals provided by constants.js, calculations.js, charts.js,
   and monsters.js.
   ========================================================================== */

// ─── Shared application state ───────────────────────────────────────────────

let subclasses = [];
let normalizedSubclasses = [];
let benchmarks = new Map();
let benchmarkEligibleLabels = new Set();
let selectedSubclassLabels = [];
let onlyIncludeCalculatedValues = true;

// ─── Dropdown population ─────────────────────────────────────────────────────

function getDropdownRows() {
  const eligibleRows = subclasses.filter(row => benchmarkEligibleLabels.has(formatOption(row)));
  if (!onlyIncludeCalculatedValues) return eligibleRows;
  return eligibleRows.filter(hasCalculatedSupportValue);
}

function populateClassDropdown() {
  const classSelect = document.getElementById('classSelect');
  if (!classSelect) return;

  const rows = getDropdownRows();
  const classes = [...new Set(rows.map(getClassName))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  classSelect.innerHTML = `
    <option value="">All classes</option>
    ${classes.map(c => `<option value="${c}">${c}</option>`).join('')}
  `;

  populateSubclassDropdown('');
}

function populateSubclassDropdown(selectedClass) {
  const subclassSelect = document.getElementById('subclassSelect');
  if (!subclassSelect) return;

  const rows = getDropdownRows();
  const labels = [...new Set(
    rows
      .filter(r => !selectedClass || getClassName(r) === selectedClass)
      .map(formatOption)
  )].sort((a, b) => a.localeCompare(b));

  subclassSelect.innerHTML = `
    <option value="">Select subclass...</option>
    ${labels.map(l => `<option value="${l}">${l}</option>`).join('')}
  `;

  subclassSelect.disabled = labels.length === 0;
}

function applyDropdownFilterMode() {
  const classSelect = document.getElementById('classSelect');
  const subclassSelect = document.getElementById('subclassSelect');
  const prevClass = classSelect?.value || '';
  const prevSubclass = subclassSelect?.value || '';

  populateClassDropdown();

  if (classSelect && prevClass && [...classSelect.options].some(o => o.value === prevClass)) {
    classSelect.value = prevClass;
    populateSubclassDropdown(prevClass);
  }

  if (subclassSelect && prevSubclass && [...subclassSelect.options].some(o => o.value === prevSubclass)) {
    subclassSelect.value = prevSubclass;
  }

  syncRadarVisibility();
  renderCharts();
}

function syncSelectedSubclassEligibility() {
  selectedSubclassLabels = selectedSubclassLabels.filter(label => benchmarkEligibleLabels.has(label));
}

// ─── Data loading ───────────────────────────────────────────────────────────

async function fetchSubclasses() {
  const response = await fetch('./subclasses.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load subclasses.json (${response.status})`);

  const raw = await response.json();
  const rows =
    Array.isArray(raw) ? raw :
    Array.isArray(raw?.rows) ? raw.rows :
    Array.isArray(raw?.data) ? raw.data : [];

  if (!rows.length) throw new Error('subclasses.json loaded but contains zero rows.');

  subclasses = rows.map(r => ({
    ...r,
    class: getClassName(r),
    subclass: getSubclassName(r)
  }));

  const usable = subclasses.filter(r => r.class && r.subclass);
  console.log('[Data] rows:', rows.length, 'usable:', usable.length, 'first keys:', Object.keys(rows[0] || {}));

  if (!usable.length) throw new Error('No usable class/subclass fields found. Check JSON key names.');

  subclasses = usable;
  normalizedSubclasses = normalizeSuggestionRows(subclasses);
  benchmarks = buildBenchmarkDataset(subclasses);
  benchmarkEligibleLabels = new Set(benchmarks.keys());
  syncSelectedSubclassEligibility();
  assertSuggestionNormalization(subclasses, normalizedSubclasses);
  renderMetricHelpRow();
  populateClassDropdown();
  syncRadarVisibility();
  runDataSanityChecks(subclasses);
  updateHelpPopoverPositions();
}

function runDataSanityChecks(rows) {
  const warlocks = rows.filter(
    r => getSubclassName(r).toLowerCase() === 'base warlock'
  );

  if (!warlocks.length) {
    console.warn('[Sanity] Base Warlock rows not found.');
    return;
  }

  const vals = warlocks.map(r => Number(r.damage)).filter(Number.isFinite);
  if (!vals.length) {
    console.error('[Sanity] Base Warlock found but damage missing/non-numeric.');
    return;
  }

  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (Math.abs(avg - 4.25) > 0.001) {
    console.error(`[Sanity] Base Warlock avg mismatch: ${avg.toFixed(3)} vs 4.25`);
    alert(`Data sanity warning: Base Warlock avg damage = ${avg.toFixed(3)} (expected 4.25).`);
  } else {
    console.log('[Sanity] Base Warlock avg damage OK (4.25).');
  }
}

// ─── Event wiring ───────────────────────────────────────────────────────────

document.getElementById('classSelect').addEventListener('change', (e) => {
  populateSubclassDropdown(e.target.value);
});

document.getElementById('tierSelect').addEventListener('change', () => {
  renderConditionMatrix();
});

document.getElementById('monsterTraitTierSelect').addEventListener('change', () => {
  renderMonsterMatchup();
});

document.getElementById('monsterCrFilter').addEventListener('input', () => {
  renderMonsterMatchup();
});

document.querySelectorAll('input[name="calculatedFilterMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    onlyIncludeCalculatedValues = document.getElementById('calculatedFilterOn').checked;
    applyDropdownFilterMode();
  });
});

document.getElementById('addSubclassButton').addEventListener('click', () => {
  const label = document.getElementById('subclassSelect').value;
  if (!label) {
    alert('Select a class and subclass first.');
    return;
  }
  selectedSubclassLabels.push(label); // duplicates allowed

  try {
    if (typeof updateSelectedList === 'function') {
      updateSelectedList();
    } else {
      // Fallback keeps the app usable when optional render helpers are missing.
      renderCharts();
    }
  } catch (error) {
    console.error('[Add] failed to update selection UI:', error);
  }
});

if (typeof removeSubclassAt === 'function') {
  window.removeSubclassAt = removeSubclassAt;
} else {
  console.warn('[Init] removeSubclassAt is not defined; tag remove actions are disabled.');
}

window.addEventListener('error', (event) => {
  const msg = event?.error?.message || event?.message || 'Unknown script error';
  console.error('[GlobalError]', msg, event?.error || '');
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason?.message || String(event?.reason || 'Unknown promise rejection');
  console.error('[UnhandledRejection]', reason);
});

window.addEventListener('resize', () => {
  updateHelpPopoverPositions();
});

// ─── Bootstrap ──────────────────────────────────────────────────────────────

// safer boot: don't destroy page if chart render fails
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await fetchSubclasses();
  } catch (error) {
    document.body.innerHTML = `
      <div style="padding:24px;max-width:720px;margin:40px auto;font-family:Arial,sans-serif;color:#1f2937;">
        <h1 style="font-size:1.8rem;margin-bottom:16px;">Data loading failed</h1>
        <p style="font-size:1rem;line-height:1.6;">${error.message}</p>
      </div>
    `;
    console.error(error);
    return;
  }

  try {
    renderCharts();
  } catch (error) {
    console.error('[Render] chart render failed:', error);
  }

  loadMonsters(); // non-blocking — renders panel when ready
});
