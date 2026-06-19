/* ==========================================================================
   calculations.js — pure data-shaping and scoring logic.

   This module contains the "engine" of the tracker: parsing rows, computing
   metrics, ranking benchmarks, generating party suggestions, normalizing
   scores, and analysing monster data. None of these functions touch the DOM,
   which makes them straightforward to unit test under Node/Jest.

   UMD-style wrapper: in the browser the functions are attached to the global
   scope so the rendering scripts can call them as globals; under Node/Jest the
   functions are exported via module.exports and the constants are required.
   ========================================================================== */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./constants.js'));
  } else {
    Object.assign(root, factory(root));
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  const {
    METRICS,
    CONDITIONS,
    DAMAGE_TYPES,
    SAVE_THROW_KEYS,
    TIER_RANK,
    RAW_TRAIT_COLUMNS,
    OPTIMISER_MIN,
    SCORE_FIELDS
  } = C;

  // ─── Generic helpers ──────────────────────────────────────────────────────

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function roundScore(value) {
    return Math.round(value * 1000) / 1000;
  }

  function normalizeKey(k) {
    return String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function pickField(row, candidates) {
    if (!row || typeof row !== 'object') return '';
    const keys = Object.keys(row);

    for (const c of candidates) {
      if (row[c] != null && String(row[c]).trim() !== '') return String(row[c]).trim();
    }

    for (const c of candidates) {
      const target = normalizeKey(c);
      const match = keys.find(k => normalizeKey(k) === target);
      if (match && row[match] != null && String(row[match]).trim() !== '') {
        return String(row[match]).trim();
      }
    }

    return '';
  }

  function getClassName(row) {
    return pickField(row, [
      'class', 'class_name', 'classname', 'dnd_class', 'character_class',
      'Class', 'CLASS'
    ]);
  }

  function getSubclassName(row) {
    return pickField(row, [
      'subclass', 'sub_class', 'subclassname', 'sub_class_name',
      'Subclass', 'SUBCLASS'
    ]);
  }

  function formatOption(row) {
    const subclass = getSubclassName(row) || 'Unknown Subclass';
    const clazz = getClassName(row) || 'Unknown Class';
    return `${subclass} (${clazz})`;
  }

  function hasCalculatedSupportValue(row) {
    const value = row?.support;
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  // ─── Metric helpers ───────────────────────────────────────────────────────

  function getNumericMetricValue(row, metric) {
    const rawValue = row?.[metric];
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;

    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  function hasCompleteMetricValues(row) {
    return METRICS.every(metric => getNumericMetricValue(row, metric) !== null);
  }

  function getSuggestionDataset(dataset) {
    return dataset.filter(hasCompleteMetricValues);
  }

  function isUaRow(row) {
    const rawValue = row?.ua;
    if (typeof rawValue === 'boolean') return rawValue;
    if (typeof rawValue === 'number') return rawValue === 1;
    return String(rawValue || '').trim().toLowerCase() === 'true';
  }

  function getRowsForLabel(label, dataset) {
    return dataset.filter(row => formatOption(row) === label);
  }

  function getAverageMetricsForRows(rows, { requireAll = false } = {}) {
    if (!rows.length) return null;

    const metrics = [];
    for (const metric of METRICS) {
      const values = rows.map(row => getNumericMetricValue(row, metric)).filter(Number.isFinite);
      if (!values.length) {
        if (requireAll) return null;
        metrics.push(0);
        continue;
      }

      metrics.push(roundScore(values.reduce((sum, value) => sum + value, 0) / values.length));
    }

    return metrics;
  }

  function getMetrics(label, dataset, options = {}) {
    return getAverageMetricsForRows(getRowsForLabel(label, dataset), options);
  }

  function getCandidateLabels(dataset) {
    return [...new Set(dataset.map(formatOption))];
  }

  // ─── Text / trait parsing ─────────────────────────────────────────────────

  function norm(s) {
    return String(s ?? '').toLowerCase().replace(/[^a-z0-9\s:]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function splitTierSegments(text) {
    const raw = String(text ?? '');
    const matches = [...raw.matchAll(/T([1-4])\s*:\s*([\s\S]*?)(?=(?:T[1-4]\s*:)|$)/gi)];
    if (!matches.length) return [{ tier: 1, body: raw }]; // no tier tag => treat as T1 baseline
    return matches.map(m => ({ tier: Number(m[1]), body: m[2] || '' }));
  }

  function getColumnValues(row, candidates) {
    return candidates
      .map(c => row?.[c])
      .filter(v => v !== null && v !== undefined && String(v).trim() !== '');
  }

  function collectTraitsForRows(rows, selectedTier) {
    const maxTier = TIER_RANK[selectedTier] || 4;

    const out = {
      condAdv: new Set(),
      condRes: new Set(),
      condImm: new Set(),
      dmgRes: new Set(),
      dmgImm: new Set(),
      saveAdv: new Set()
    };

    function collectSaveThrowAdvantages(txt) {
      const hasSaveWord = txt.includes('save') || txt.includes('saving throw') || txt.includes('saving throws');
      if (!hasSaveWord) return;

      const allSavesPattern = /all\s+sav(e|ing\s+throw)s?|advantage\s+on\s+sav(e|ing\s+throw)s?|saving\s+throw\s+advantage/;
      if (allSavesPattern.test(txt)) {
        out.saveAdv.add('all');
        SAVE_THROW_KEYS.filter(k => k !== 'all').forEach(k => out.saveAdv.add(k));
      }

      const abilityRules = [
        { key: 'str', pattern: /(str(ength)?)(\s+ability)?\s+sav(e|ing\s+throw)s?|sav(e|ing\s+throw)s?\s+(for|vs|against|on)?\s*(strength|str)\b/ },
        { key: 'dex', pattern: /(dex(terity)?)(\s+ability)?\s+sav(e|ing\s+throw)s?|sav(e|ing\s+throw)s?\s+(for|vs|against|on)?\s*(dexterity|dex)\b/ },
        { key: 'con', pattern: /(con(stitution)?)(\s+ability)?\s+sav(e|ing\s+throw)s?|sav(e|ing\s+throw)s?\s+(for|vs|against|on)?\s*(constitution|con)\b/ },
        { key: 'int', pattern: /(int(elligence)?)(\s+ability)?\s+sav(e|ing\s+throw)s?|sav(e|ing\s+throw)s?\s+(for|vs|against|on)?\s*(intelligence|int)\b/ },
        { key: 'wis', pattern: /(wis(dom)?)(\s+ability)?\s+sav(e|ing\s+throw)s?|sav(e|ing\s+throw)s?\s+(for|vs|against|on)?\s*(wisdom|wis)\b/ },
        { key: 'cha', pattern: /(cha(risma)?)(\s+ability)?\s+sav(e|ing\s+throw)s?|sav(e|ing\s+throw)s?\s+(for|vs|against|on)?\s*(charisma|cha)\b/ }
      ];

      abilityRules.forEach(({ key, pattern }) => {
        if (pattern.test(txt)) out.saveAdv.add(key);
      });
    }

    for (const row of rows) {
      for (const v of getColumnValues(row, RAW_TRAIT_COLUMNS.advantage)) {
        for (const seg of splitTierSegments(v)) {
          if (seg.tier > maxTier) continue;
          const txt = norm(seg.body);
          CONDITIONS.forEach(c => { if (txt.includes(c)) out.condAdv.add(c); });
          collectSaveThrowAdvantages(txt);
        }
      }

      for (const v of getColumnValues(row, RAW_TRAIT_COLUMNS.resistance)) {
        for (const seg of splitTierSegments(v)) {
          if (seg.tier > maxTier) continue;
          const txt = norm(seg.body);
          CONDITIONS.forEach(c => { if (txt.includes(c)) out.condRes.add(c); });
          DAMAGE_TYPES.forEach(d => { if (txt.includes(d)) out.dmgRes.add(d); }); // catches B/P/S in mixed fields
          collectSaveThrowAdvantages(txt);
        }
      }

      for (const v of getColumnValues(row, RAW_TRAIT_COLUMNS.immunity)) {
        for (const seg of splitTierSegments(v)) {
          if (seg.tier > maxTier) continue;
          const txt = norm(seg.body);
          CONDITIONS.forEach(c => { if (txt.includes(c)) out.condImm.add(c); });
          DAMAGE_TYPES.forEach(d => { if (txt.includes(d)) out.dmgImm.add(d); });
          collectSaveThrowAdvantages(txt);
        }
      }

      for (const v of getColumnValues(row, RAW_TRAIT_COLUMNS.damageResistance)) {
        for (const seg of splitTierSegments(v)) {
          if (seg.tier > maxTier) continue;
          const txt = norm(seg.body);
          DAMAGE_TYPES.forEach(d => { if (txt.includes(d)) out.dmgRes.add(d); });
        }
      }

      for (const v of getColumnValues(row, RAW_TRAIT_COLUMNS.damageImmunity)) {
        for (const seg of splitTierSegments(v)) {
          if (seg.tier > maxTier) continue;
          const txt = norm(seg.body);
          DAMAGE_TYPES.forEach(d => { if (txt.includes(d)) out.dmgImm.add(d); });
        }
      }

      // Barbarian safety rule for B/P/S resistance
      const clazz = String(row?.class ?? row?.class_name ?? '').toLowerCase();
      if (clazz === 'barbarian') {
        out.dmgRes.add('bludgeoning');
        out.dmgRes.add('piercing');
        out.dmgRes.add('slashing');
      }
    }

    return out;
  }

  // ─── Ranking & benchmarking ───────────────────────────────────────────────

  function formatOrdinal(value, isTied = false) {
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${isTied ? '=' : ''}${value}th`;

    const mod10 = value % 10;
    if (mod10 === 1) return `${isTied ? '=' : ''}${value}st`;
    if (mod10 === 2) return `${isTied ? '=' : ''}${value}nd`;
    if (mod10 === 3) return `${isTied ? '=' : ''}${value}rd`;
    return `${isTied ? '=' : ''}${value}th`;
  }

  function assignRank(entries, key, rankKey) {
    const sortedEntries = [...entries]
      .sort((a, b) => (b[key] - a[key]) || a.label.localeCompare(b.label));

    let index = 0;
    while (index < sortedEntries.length) {
      const startIndex = index;
      const currentValue = sortedEntries[index][key];

      while (index < sortedEntries.length && sortedEntries[index][key] === currentValue) {
        index += 1;
      }

      const rank = startIndex + 1;
      const isTied = (index - startIndex) > 1;
      for (let groupIndex = startIndex; groupIndex < index; groupIndex += 1) {
        sortedEntries[groupIndex][rankKey] = rank;
        sortedEntries[groupIndex][`${rankKey}Tied`] = isTied;
      }
    }
  }

  function buildBenchmarkDataset(dataset) {
    const entries = getCandidateLabels(dataset.filter(row => !isUaRow(row)))
      .map(label => {
        const metrics = getMetrics(label, dataset, { requireAll: true });
        if (!metrics) return null;

        const maxScore = roundScore(Math.max(...metrics));
        const average = roundScore(metrics.reduce((sum, value) => sum + value, 0) / METRICS.length);
        return { label, maxScore, average };
      })
      .filter(Boolean);

    assignRank(entries, 'maxScore', 'maxScoreRank');
    assignRank(entries, 'average', 'averageRank');

    return new Map(entries.map(entry => [entry.label, entry]));
  }

  // ─── Party suggestions ────────────────────────────────────────────────────

  function getPartyAverage(labels, dataset) {
    const selectedMetrics = labels.map(label => getMetrics(label, dataset)).filter(Boolean);
    if (!selectedMetrics.length) return null;
    return selectedMetrics
      .reduce((totals, values) => totals ? totals.map((v, i) => v + values[i]) : [...values], null)
      .map(v => v / selectedMetrics.length);
  }

  function getOptimiserSuggestion(labels, dataset) {
    const currentAvg = getPartyAverage(labels, dataset);
    if (!currentAvg) return null;

    let threshold = OPTIMISER_MIN;

    while (threshold >= 0) {
      let best = null;

      getCandidateLabels(dataset).forEach(candidateLabel => {
        if (labels.includes(candidateLabel)) return;

        const candidateValues = getMetrics(candidateLabel, dataset);
        if (!candidateValues) return;
        const n = labels.length;
        const combined = currentAvg.map((v, i) => ((v * n) + candidateValues[i]) / (n + 1));

        // Must satisfy all metrics at current threshold.
        if (!combined.every(v => v > threshold)) return;

        const combinedAvg = combined.reduce((a, b) => a + b, 0) / combined.length;
        if (!best || combinedAvg > best.combinedAvg) {
          best = { label: candidateLabel, combinedAvg };
        }
      });

      if (best) {
        return { ...best, thresholdUsed: threshold };
      }

      threshold = Number((threshold - 0.25).toFixed(2));
    }

    return null;
  }

  function getVibesSuggestion(labels, dataset) {
    const partyAvg = getPartyAverage(labels, dataset);
    if (!partyAvg) return null;

    let best = null;
    let minCombinedVariance = Infinity;

    getCandidateLabels(dataset).forEach(candidateLabel => {
      if (labels.includes(candidateLabel)) return;

      const candidateValues = getMetrics(candidateLabel, dataset);
      if (!candidateValues) return;

      const combinedCount = labels.length + 1;
      const combinedValues = partyAvg.map((v, i) => (v * labels.length + candidateValues[i]) / combinedCount);
      const mean = combinedValues.reduce((sum, value) => sum + value, 0) / METRICS.length;
      const variance = combinedValues.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / METRICS.length;

      if (variance < minCombinedVariance) {
        minCombinedVariance = variance;
        best = { label: candidateLabel, variance, combinedValues };
      }
    });

    return best ? { ...best, variance: roundScore(best.variance) } : null;
  }

  function getGlobalMetricMax(dataset) {
    let maxValue = 0;

    dataset.forEach(row => {
      METRICS.forEach(metric => {
        const value = getNumericMetricValue(row, metric);
        if (Number.isFinite(value)) maxValue = Math.max(maxValue, value);
      });
    });

    return maxValue || 5;
  }

  // ─── Score normalization ──────────────────────────────────────────────────

  function normalizeSuggestionRows(rows) {
    const clonedRows = rows.map(row => ({ ...row }));

    for (const field of SCORE_FIELDS) {
      const numericRows = clonedRows.filter(row => Number.isFinite(getNumericMetricValue(row, field)));
      if (!numericRows.length) continue;

      const fieldMax = Math.max(...numericRows.map(row => getNumericMetricValue(row, field)));
      if (fieldMax <= 5) continue;

      const scaleFactor = 5 / fieldMax;
      numericRows.forEach(row => {
        const value = getNumericMetricValue(row, field);
        const scaled = roundScore(value * scaleFactor);
        row[field] = value === fieldMax ? 5 : scaled;
      });
    }

    return clonedRows;
  }

  function assertSuggestionNormalization(rawRows, normalizedRows) {
    SCORE_FIELDS.forEach(field => {
      const rawValues = rawRows.map(row => getNumericMetricValue(row, field)).filter(Number.isFinite);
      const normalizedValues = normalizedRows.map(row => getNumericMetricValue(row, field)).filter(Number.isFinite);
      if (!rawValues.length || !normalizedValues.length) return;

      const rawMax = Math.max(...rawValues);
      const normalizedMax = Math.max(...normalizedValues);

      if (rawMax > 5 && normalizedMax !== 5) {
        throw new Error(`Suggestion normalization failed for ${field}: max is ${normalizedMax}, expected 5.`);
      }

      if (rawMax <= 5 && normalizedMax !== rawMax) {
        throw new Error(`Suggestion normalization no-op failed for ${field}: max is ${normalizedMax}, expected ${rawMax}.`);
      }
    });
  }

  // ─── Monster data helpers ─────────────────────────────────────────────────

  function parseCR(cr) {
    if (cr === null || cr === undefined) return 0;
    const s = String(cr).trim();
    if (s.includes('/')) {
      const [num, den] = s.split('/');
      return Number(num) / Number(den);
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function parseMonsterDamageList(raw) {
    if (Array.isArray(raw)) {
      return raw.flatMap(item => {
        if (typeof item === 'string') return [item.toLowerCase().trim()];
        if (item && typeof item === 'object') {
          return [String(item.name || item.type || item.damage_type || '').toLowerCase().trim()];
        }
        return [];
      }).filter(Boolean);
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw.split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    }
    return [];
  }

  function toRoll20DamageLabel(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\b\w/g, ch => ch.toUpperCase());
  }

  function buildRoll20MonsterListingUrl({ crMin, crMax, resistances = [], immunities = [] }) {
    const baseUrl = 'https://roll20.net/compendium/dnd5e/v2/listings/Monsters';
    const params = new URLSearchParams();
    params.set('pageNumber', '1');
    params.append('filters_CR', String(crMin));
    params.append('filters_CR', String(crMax));
    params.append('filters_Edition', '2024 Only');

    resistances.forEach(type => {
      params.append('filters_resistances', toRoll20DamageLabel(type));
    });

    immunities.forEach(type => {
      params.append('filters_immunities', toRoll20DamageLabel(type));
    });

    return `${baseUrl}?${params.toString()}`;
  }

  function getMonsterDamageDealt(monster) {
    const dealt = new Set();
    const sources = [
      ...(monster.actions || []),
      ...(monster.special_abilities || []),
      ...(monster.legendary_actions || []),
      ...(monster.bonus_actions || []),
      ...(monster.reactions || [])
    ];
    for (const action of sources) {
      const text = String(action.desc || action.description || '').toLowerCase();
      DAMAGE_TYPES.forEach(dt => {
        if (text.includes(dt + ' damage')) dealt.add(dt);
      });
      const entries = action.damage || action.damages || [];
      if (Array.isArray(entries)) {
        entries.forEach(entry => {
          const t = String(entry.damage_type || entry.type || '').toLowerCase();
          DAMAGE_TYPES.forEach(dt => { if (t.includes(dt)) dealt.add(dt); });
        });
      }
    }
    return dealt;
  }

  function getMonsterConditionsInflicted(monster) {
    const inflicted = new Set();
    const sources = [
      ...(monster.actions || []),
      ...(monster.special_abilities || []),
      ...(monster.legendary_actions || []),
      ...(monster.bonus_actions || []),
      ...(monster.reactions || [])
    ];
    for (const action of sources) {
      const text = String(action.desc || action.description || '').toLowerCase();
      CONDITIONS.forEach(cond => {
        if (text.includes(cond)) inflicted.add(cond);
      });
    }
    return inflicted;
  }

  return {
    escapeHtml,
    roundScore,
    normalizeKey,
    pickField,
    getClassName,
    getSubclassName,
    formatOption,
    hasCalculatedSupportValue,
    getNumericMetricValue,
    hasCompleteMetricValues,
    getSuggestionDataset,
    isUaRow,
    getRowsForLabel,
    getAverageMetricsForRows,
    getMetrics,
    getCandidateLabels,
    norm,
    splitTierSegments,
    getColumnValues,
    collectTraitsForRows,
    formatOrdinal,
    assignRank,
    buildBenchmarkDataset,
    getPartyAverage,
    getOptimiserSuggestion,
    getVibesSuggestion,
    getGlobalMetricMax,
    normalizeSuggestionRows,
    assertSuggestionNormalization,
    parseCR,
    parseMonsterDamageList,
    toRoll20DamageLabel,
    buildRoll20MonsterListingUrl,
    getMonsterDamageDealt,
    getMonsterConditionsInflicted
  };
});
