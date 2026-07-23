/* ==========================================================================
   charts.js — DOM rendering and Plotly visualisations.

   Browser-only. Loaded as a classic <script> so its functions live in the
   global scope alongside the constants (constants.js) and the scoring engine
   (calculations.js). It reads the shared application state declared in app.js
   (subclasses, selectedSubclassLabels, benchmarks, onlyIncludeCalculatedValues).
   ========================================================================== */

// ─── Help popovers ──────────────────────────────────────────────────────────

function buildHelpButton(text, label = 'Help') {
  return `
    <span class="help-wrap">
      <button type="button" class="help-button" aria-label="${escapeHtml(label)}">?</button>
      <span class="help-popover">${escapeHtml(text)}</span>
    </span>
  `;
}

function renderMetricHelpRow() {
  const row = document.getElementById('metricHelpRow');
  if (!row) return;

  row.innerHTML = METRICS.map(metric => `
    <span class="metric-chip">
      <span>${escapeHtml(METRIC_LABELS[METRICS.indexOf(metric)])}</span>
      ${buildHelpButton(METRIC_HELP_TEXT[metric], `${METRIC_LABELS[METRICS.indexOf(metric)]} help`)}
    </span>
  `).join('');

  updateHelpPopoverPositions();
}

function updateHelpPopoverPositions() {
  // Positioning now happens on hover/focus via viewport-clamped coordinates
  // (see positionHelpPopover). This just ensures the global listeners exist;
  // it stays callable from every render path without doing per-render work.
  initHelpPopovers();
}

// Places a popover in the viewport relative to its trigger, flipping and
// clamping so it can never render off-screen (horizontally or vertically).
function positionHelpPopover(wrap) {
  const popover = wrap.querySelector('.help-popover');
  if (!popover) return;

  const trigger = wrap.querySelector('.help-button') || wrap;
  const margin = 8;
  // Use the documentElement client size (the visible area EXCLUDING scrollbars)
  // rather than window.innerWidth/innerHeight (which include the scrollbar).
  // Otherwise a popover can be clamped into the scrollbar gutter and render
  // partly off the actually-visible screen.
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const btn = trigger.getBoundingClientRect();

  // Constrain popup size first so measurements reflect on-screen dimensions.
  popover.style.maxWidth = `${Math.max(160, vw - margin * 2)}px`;
  popover.style.maxHeight = `${Math.max(120, vh - margin * 2)}px`;

  const pop = popover.getBoundingClientRect();

  // Horizontal: right-align to the trigger, then clamp inside the viewport.
  let left = btn.right - pop.width;
  const maxLeft = Math.max(margin, vw - pop.width - margin);
  left = Math.min(Math.max(margin, left), maxLeft);

  // Vertical: prefer above the trigger; flip below when there isn't room.
  let top = btn.top - pop.height - margin;
  if (top < margin) top = btn.bottom + margin;
  const maxTop = Math.max(margin, vh - pop.height - margin);
  top = Math.min(Math.max(margin, top), maxTop);

  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function repositionOpenHelpPopovers() {
  document.querySelectorAll('.help-wrap').forEach((wrap) => {
    const popover = wrap.querySelector('.help-popover');
    if (popover && getComputedStyle(popover).visibility === 'visible') {
      positionHelpPopover(wrap);
    }
  });
}

// Wires the (idempotent) global listeners once. Uses event delegation so
// dynamically rendered help buttons (charts, monsters, suggestions) are covered.
function initHelpPopovers() {
  if (window.__helpPopoverInit) return;
  window.__helpPopoverInit = true;

  document.addEventListener('mouseover', (e) => {
    const wrap = e.target.closest?.('.help-wrap');
    if (wrap) positionHelpPopover(wrap);
  });
  document.addEventListener('focusin', (e) => {
    const wrap = e.target.closest?.('.help-wrap');
    if (wrap) positionHelpPopover(wrap);
  });

  window.addEventListener('scroll', repositionOpenHelpPopovers, true);
  window.addEventListener('resize', repositionOpenHelpPopovers);
}

// ─── Radar plot helpers ─────────────────────────────────────────────────────

function toPolarTrace(name, values, color) {
  return {
    type: 'scatterpolar',
    mode: 'lines+markers',
    name,
    r: [...values, values[0]],
    theta: [...METRIC_LABELS, METRIC_LABELS[0]],
    line: { color, width: 2 },
    marker: { size: 6, color },
    fill: 'toself',
    fillcolor: 'rgba(37,99,235,0.08)',
    hovertemplate: '<b>%{fullData.name}</b><br>%{theta}: %{r}<extra></extra>'
  };
}

function plotLayout(axisMax) {
  return {
    polar: {
      radialaxis: { visible: true, range: [0, Math.max(5, axisMax)], tick0: 0, dtick: 1 }
    },
    margin: { t: 16, r: 24, b: 24, l: 24 },
    showlegend: true,
    legend: { orientation: 'h' }
  };
}

function bindPlotEvents(plotId, hoverInfoId, clickInfoId) {
  const plot = document.getElementById(plotId);
  const hoverInfo = document.getElementById(hoverInfoId);
  const clickInfo = document.getElementById(clickInfoId);
  if (!plot || !hoverInfo || !clickInfo || typeof plot.on !== 'function') return;

  plot.on('plotly_hover', (data) => {
    const p = data?.points?.[0];
    if (!p) return;
    hoverInfo.textContent = `${p.fullData?.name || 'Trace'} | ${p.theta}: ${p.r}`;
  });

  plot.on('plotly_click', (data) => {
    const p = data?.points?.[0];
    if (!p) return;
    clickInfo.textContent = `${p.fullData?.name || 'Trace'} | ${p.theta}: ${p.r}`;
  });
}

function syncRadarVisibility() {
  const show = onlyIncludeCalculatedValues;
  const avgCard = document.getElementById('radarAvgCard');
  const sumCard = document.getElementById('radarSumCard');
  const suggestionsCard = document.getElementById('suggestionsCard');
  if (avgCard) avgCard.style.display = show ? '' : 'none';
  if (sumCard) sumCard.style.display = show ? '' : 'none';
  if (suggestionsCard) suggestionsCard.style.display = show ? '' : 'none';

  if (!show) {
    Plotly.purge('radarChartAvg');
    Plotly.purge('radarChartSum');
  }
}

// ─── Selected list ──────────────────────────────────────────────────────────

function updateSelectedList() {
  const selectedList = document.getElementById('selectedList');
  if (!selectedList) return;

  if (!selectedSubclassLabels.length) {
    selectedList.innerHTML = '';
    renderCharts();
    return;
  }

  selectedList.innerHTML = selectedSubclassLabels
    .map((label, index) => `
      <span class="tag">
        <span>${escapeHtml(label)}</span>
        <button type="button" onclick="removeSubclassAt(${index})" aria-label="Remove ${escapeHtml(label)}">×</button>
      </span>
    `)
    .join('');

  renderCharts();
}

function removeSubclassAt(index) {
  if (index < 0 || index >= selectedSubclassLabels.length) return;
  selectedSubclassLabels.splice(index, 1);
  updateSelectedList();
}

// ─── Suggestions panel ──────────────────────────────────────────────────────

function calculateSuggestions() {
  const list = document.getElementById('suggestionsList');
  if (!list) return;

  if (!selectedSubclassLabels.length) {
    list.innerHTML = `
      <div class="suggestion-item">
        <div class="suggestion-title">The Optimiser\'s Dream ${buildHelpButton(SUGGESTION_HELP_TEXT.optimiser, 'Optimiser\'s Dream help')}</div>
        <div class="suggestion-content">Add subclasses to get recommendations</div>
      </div>
      <div class="suggestion-item">
        <div class="suggestion-title">The Vibes Check ${buildHelpButton(SUGGESTION_HELP_TEXT.vibes, 'The Vibes Check help')}</div>
        <div class="suggestion-content">Add subclasses to get recommendations</div>
      </div>
    `;
    updateHelpPopoverPositions();
    return;
  }

  const rawSuggestionDataset = getSuggestionDataset(subclasses);
  const normalizedSuggestionDataset = getSuggestionDataset(normalizedSubclasses);
  const optimiserRaw = getOptimiserSuggestion(selectedSubclassLabels, rawSuggestionDataset);
  const optimiserNormalized = getOptimiserSuggestion(selectedSubclassLabels, normalizedSuggestionDataset);
  const vibesRaw = getVibesSuggestion(selectedSubclassLabels, rawSuggestionDataset);
  const vibesNormalized = getVibesSuggestion(selectedSubclassLabels, normalizedSuggestionDataset);

  list.innerHTML = `
    <div class="suggestion-item">
      <div class="suggestion-title">The Optimiser's Dream ${buildHelpButton(SUGGESTION_HELP_TEXT.optimiser, 'Optimiser\'s Dream help')}</div>
      <div class="suggestion-columns">
        <div class="suggestion-column">
          <div class="suggestion-column-title">Raw values</div>
          <div class="suggestion-content">
            ${optimiserRaw
              ? `${escapeHtml(optimiserRaw.label)}<br/>Combined Avg: ${optimiserRaw.combinedAvg.toFixed(2)}<br/>All metrics &gt; ${optimiserRaw.thresholdUsed.toFixed(2)}`
              : 'No valid subclass found, even after lowering threshold by 0.25 steps.'}
          </div>
        </div>
        <div class="suggestion-column">
          <div class="suggestion-column-title">Normalized 0-5</div>
          <div class="suggestion-content">
            ${optimiserNormalized
              ? `${escapeHtml(optimiserNormalized.label)}<br/>Combined Avg: ${optimiserNormalized.combinedAvg.toFixed(2)}<br/>All metrics &gt; ${optimiserNormalized.thresholdUsed.toFixed(2)}`
              : 'No valid subclass found, even after lowering threshold by 0.25 steps.'}
          </div>
        </div>
      </div>
    </div>
    <div class="suggestion-item">
      <div class="suggestion-title">The Vibes Check ${buildHelpButton(SUGGESTION_HELP_TEXT.vibes, 'The Vibes Check help')}</div>
      <div class="suggestion-columns">
        <div class="suggestion-column">
          <div class="suggestion-column-title">Raw values</div>
          <div class="suggestion-content">${vibesRaw ? `${escapeHtml(vibesRaw.label)}<br/>Variance: ${vibesRaw.variance.toFixed(2)}` : 'N/A'}</div>
        </div>
        <div class="suggestion-column">
          <div class="suggestion-column-title">Normalized 0-5</div>
          <div class="suggestion-content">${vibesNormalized ? `${escapeHtml(vibesNormalized.label)}<br/>Variance: ${vibesNormalized.variance.toFixed(2)}` : 'N/A'}</div>
        </div>
      </div>
    </div>
  `;

  updateHelpPopoverPositions();
}

// ─── Benchmarking panel ─────────────────────────────────────────────────────

function renderBenchmarkingPanel() {
  const container = document.getElementById('benchmarkingPanelContent');
  if (!container) return;

  if (!selectedSubclassLabels.length) {
    container.innerHTML = '<p class="caption">Add subclasses to compare their benchmark max scores, averages, and ranks.</p>';
    updateHelpPopoverPositions();
    return;
  }

  const rows = selectedSubclassLabels.map((label, index) => {
    const entry = benchmarks.get(label);
    return {
      rowLabel: `${index + 1}. ${label}`,
      maxScore: entry ? entry.maxScore.toFixed(2) : 'N/A',
      average: entry ? entry.average.toFixed(2) : 'N/A',
      maxScoreRank: entry ? formatOrdinal(entry.maxScoreRank, entry.maxScoreRankTied) : 'N/A',
      averageRank: entry ? formatOrdinal(entry.averageRank, entry.averageRankTied) : 'N/A'
    };
  });

  container.innerHTML = `
    <div class="combo-table-wrap">
      <table class="benchmark-table">
        <thead>
          <tr>
            <th>Selected subclasses (total of ${benchmarks.size} subclasses)</th>
            <th>Max score</th>
            <th>Max score rank</th>
            <th>Average</th>
            <th>Average rank</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td>${escapeHtml(row.rowLabel)}</td>
              <td>${row.maxScore}</td>
              <td>${row.maxScoreRank}</td>
              <td>${row.average}</td>
              <td>${row.averageRank}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p class="caption">Benchmarks are computed from non-UA subclasses using raw scores, then ranked from highest to lowest.</p>
  `;

  updateHelpPopoverPositions();
}

// ─── Trait matrices ─────────────────────────────────────────────────────────

function renderConditionMatrix() {
  const msg = document.getElementById('conditionMatrixMessage');
  const tier = document.getElementById('tierSelect')?.value || 'T4';

  if (!selectedSubclassLabels.length) {
    Plotly.purge('conditionMatrixConditions');
    Plotly.purge('conditionMatrixSaves');
    Plotly.purge('conditionMatrixDamage');
    msg.textContent = `Add subclasses to view condition, save, and damage traits (${tier} additive).`;
    return;
  }

  const y = [...selectedSubclassLabels];
  const traitRows = y.map(label => {
    const rows = subclasses.filter(r => formatOption(r) === label);
    return collectTraitsForRows(rows, tier);
  });

  const renderTraitHeatmap = (plotId, columns, valueFn) => {
    const x = columns.map(c => c.label);
    const z = traitRows.map(t => columns.map(c => valueFn(t, c)));

    Plotly.react(plotId, [{
      type: 'heatmap',
      x, y, z, zmin: 0, zmax: 3, showscale: false,
      colorscale: [
        [0.00, '#ffffff'],
        [0.33, '#dbeafe'],
        [0.66, '#60a5fa'],
        [1.00, '#1d4ed8']
      ],
      hovertemplate: '<b>%{y}</b><br>%{x}<br>Level: %{z}<extra></extra>'
    }], {
      margin: { l: 180, r: 20, t: 10, b: 140 },
      xaxis: { tickangle: -35 },
      yaxis: { automargin: true }
    }, { responsive: true, displayModeBar: true });
  };

  renderTraitHeatmap(
    'conditionMatrixConditions',
    CONDITIONS.map(c => ({ key: c, label: c })),
    (t, c) => {
      if (t.condImm.has(c.key)) return 3;
      if (t.condRes.has(c.key)) return 2;
      if (t.condAdv.has(c.key)) return 1;
      return 0;
    }
  );

  renderTraitHeatmap(
    'conditionMatrixSaves',
    SAVE_THROW_KEYS.map(k => ({ key: k, label: SAVE_THROW_LABELS[k] })),
    (t, c) => (t.saveAdv.has(c.key) ? 1 : 0)
  );

  renderTraitHeatmap(
    'conditionMatrixDamage',
    DAMAGE_TYPES.map(d => ({ key: d, label: d })),
    (t, c) => {
      if (t.dmgImm.has(c.key)) return 3;
      if (t.dmgRes.has(c.key)) return 2;
      return 0;
    }
  );

  msg.textContent = `${tier} selected (additive). 0=None, 1=Advantage, 2=Resistance, 3=Immunity`;
}

// ─── Top-level render orchestration ─────────────────────────────────────────

function renderCharts() {
  calculateSuggestions();
  renderBenchmarkingPanel();

  const avgMessage = document.getElementById('chartMessageAvg');
  const sumMessage = document.getElementById('chartMessageSum');
  const palette = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#0ea5e9', '#eab308', '#f97316', '#ec4899'];

  const selectedData = selectedSubclassLabels
    .map(label => ({ label, values: getMetrics(label, subclasses) }))
    .filter(x => x.values);

  if (!selectedData.length) {
    if (onlyIncludeCalculatedValues) {
      avgMessage.textContent = 'Add one or more subclasses to see radar plots.';
      sumMessage.textContent = 'Add one or more subclasses to see averaged values.';
    } else {
      avgMessage.textContent = '';
      sumMessage.textContent = '';
    }
    Plotly.purge('radarChartAvg');
    Plotly.purge('radarChartSum');
    renderConditionMatrix();
    updateHelpPopoverPositions();
    return;
  }

  if (onlyIncludeCalculatedValues) {
    avgMessage.textContent = '';
    sumMessage.textContent = '';
  }

  if (onlyIncludeCalculatedValues) {
    const axisMax = getGlobalMetricMax(subclasses);
    const avgTraces = selectedData.map((d, i) => toPolarTrace(d.label, d.values, palette[i % palette.length]));
    const partyAvg = getPartyAverage(selectedSubclassLabels, subclasses);
    const sumTrace = toPolarTrace('Average of selected subclasses', partyAvg, '#10b981');

    Plotly.react('radarChartAvg', avgTraces, plotLayout(axisMax), { responsive: true, displayModeBar: true });
    Plotly.react('radarChartSum', [sumTrace], plotLayout(axisMax), { responsive: true, displayModeBar: true });

    bindPlotEvents('radarChartAvg', 'hoverInfoAvg', 'clickInfoAvg');
    bindPlotEvents('radarChartSum', 'hoverInfoSum', 'clickInfoSum');
  }

  renderConditionMatrix();
  renderMonsterMatchup();
  updateHelpPopoverPositions();
}
