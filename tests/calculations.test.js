/* Unit tests for the pure scoring / parsing engine in js/calculations.js.
   These cover the main calculation modules and run in CI via GitHub Actions. */

const calc = require('../js/calculations.js');

// Small, deterministic fixture dataset (all metrics complete).
const ROWS = [
  { class: 'Wizard',    subclass: 'Evoker',           damage: 5, survivability: 3, support: 2, control: 4, utility: 4, ua: false },
  { class: 'Cleric',    subclass: 'Life',             damage: 2, survivability: 4, support: 5, control: 3, utility: 3, ua: false },
  { class: 'Rogue',     subclass: 'Arcane Trickster', damage: 4, survivability: 3, support: 2, control: 3, utility: 5, ua: 'true' },
  { class: 'Barbarian', subclass: 'Berserker',        damage: 4, survivability: 5, support: 1, control: 2, utility: 2, ua: false }
];

describe('generic helpers', () => {
  test('roundScore rounds to 3 decimal places', () => {
    expect(calc.roundScore(1.23456)).toBe(1.235);
    expect(calc.roundScore(2)).toBe(2);
  });

  test('escapeHtml escapes HTML-significant characters', () => {
    expect(calc.escapeHtml(`<a href="x">'&'</a>`))
      .toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  test('pickField / getClassName / getSubclassName / formatOption', () => {
    const row = { Class: 'Wizard', sub_class: 'Evoker' };
    expect(calc.getClassName(row)).toBe('Wizard');
    expect(calc.getSubclassName(row)).toBe('Evoker');
    expect(calc.formatOption(row)).toBe('Evoker (Wizard)');
    expect(calc.formatOption({})).toBe('Unknown Subclass (Unknown Class)');
  });
});

describe('metric helpers', () => {
  test('getNumericMetricValue handles blanks and non-numbers', () => {
    expect(calc.getNumericMetricValue({ damage: '3.5' }, 'damage')).toBe(3.5);
    expect(calc.getNumericMetricValue({ damage: '' }, 'damage')).toBeNull();
    expect(calc.getNumericMetricValue({ damage: null }, 'damage')).toBeNull();
    expect(calc.getNumericMetricValue({ damage: 'abc' }, 'damage')).toBeNull();
  });

  test('hasCompleteMetricValues detects missing metrics', () => {
    expect(calc.hasCompleteMetricValues(ROWS[0])).toBe(true);
    expect(calc.hasCompleteMetricValues({ damage: 1 })).toBe(false);
  });

  test('isUaRow interprets booleans, numbers, and strings', () => {
    expect(calc.isUaRow({ ua: true })).toBe(true);
    expect(calc.isUaRow({ ua: 1 })).toBe(true);
    expect(calc.isUaRow({ ua: 'true' })).toBe(true);
    expect(calc.isUaRow({ ua: false })).toBe(false);
    expect(calc.isUaRow({ ua: 'no' })).toBe(false);
    expect(calc.isUaRow({})).toBe(false);
  });

  test('getMetrics returns metrics in canonical order', () => {
    expect(calc.getMetrics('Evoker (Wizard)', ROWS)).toEqual([5, 3, 2, 4, 4]);
    expect(calc.getMetrics('Nonexistent (X)', ROWS)).toBeNull();
  });

  test('getAverageMetricsForRows averages duplicate labels', () => {
    const dup = [
      { class: 'Wizard', subclass: 'Evoker', damage: 4, survivability: 4, support: 4, control: 4, utility: 4 },
      { class: 'Wizard', subclass: 'Evoker', damage: 6, survivability: 6, support: 6, control: 6, utility: 6 }
    ];
    expect(calc.getAverageMetricsForRows(dup)).toEqual([5, 5, 5, 5, 5]);
  });
});

describe('ranking & benchmarking', () => {
  test('formatOrdinal produces correct ordinals and tie markers', () => {
    expect(calc.formatOrdinal(1)).toBe('1st');
    expect(calc.formatOrdinal(2)).toBe('2nd');
    expect(calc.formatOrdinal(3)).toBe('3rd');
    expect(calc.formatOrdinal(11)).toBe('11th');
    expect(calc.formatOrdinal(21)).toBe('21st');
    expect(calc.formatOrdinal(2, true)).toBe('=2nd');
  });

  test('assignRank assigns dense ranks with tie flags', () => {
    const entries = [
      { label: 'A', score: 5 },
      { label: 'B', score: 5 },
      { label: 'C', score: 3 }
    ];
    calc.assignRank(entries, 'score', 'rank');
    const byLabel = Object.fromEntries(entries.map(e => [e.label, e]));
    expect(byLabel.A.rank).toBe(1);
    expect(byLabel.A.rankTied).toBe(true);
    expect(byLabel.B.rank).toBe(1);
    expect(byLabel.C.rank).toBe(3);
    expect(byLabel.C.rankTied).toBe(false);
  });

  test('buildBenchmarkDataset excludes UA rows and ranks by average', () => {
    const benchmarks = calc.buildBenchmarkDataset(ROWS);
    expect(benchmarks.has('Arcane Trickster (Rogue)')).toBe(false); // UA excluded
    expect(benchmarks.size).toBe(3);

    const evoker = benchmarks.get('Evoker (Wizard)');
    expect(evoker.average).toBeCloseTo(3.6, 5);
    expect(evoker.maxScore).toBe(5);
    expect(evoker.averageRank).toBe(1);

    expect(benchmarks.get('Life (Cleric)').averageRank).toBe(2);
    expect(benchmarks.get('Berserker (Barbarian)').averageRank).toBe(3);
  });
});

describe('party suggestions', () => {
  test('getPartyAverage averages selected labels', () => {
    const avg = calc.getPartyAverage(['Evoker (Wizard)', 'Life (Cleric)'], ROWS);
    expect(avg).toEqual([3.5, 3.5, 3.5, 3.5, 3.5]);
  });

  test('getPartyAverage returns null when nothing matches', () => {
    expect(calc.getPartyAverage(['Nope (X)'], ROWS)).toBeNull();
  });

  test('getOptimiserSuggestion returns a valid candidate not already in party', () => {
    const labels = ['Berserker (Barbarian)'];
    const result = calc.getOptimiserSuggestion(labels, ROWS);
    expect(result).not.toBeNull();
    expect(labels).not.toContain(result.label);
    expect(typeof result.combinedAvg).toBe('number');
    expect(typeof result.thresholdUsed).toBe('number');
  });

  test('getVibesSuggestion minimises combined variance', () => {
    const labels = ['Evoker (Wizard)'];
    const result = calc.getVibesSuggestion(labels, ROWS);
    expect(result).not.toBeNull();
    expect(labels).not.toContain(result.label);
    expect(result.variance).toBeGreaterThanOrEqual(0);
  });

  test('getGlobalMetricMax finds the dataset-wide maximum', () => {
    expect(calc.getGlobalMetricMax(ROWS)).toBe(5);
    expect(calc.getGlobalMetricMax([])).toBe(5); // falls back to 5
  });
});

describe('score normalization', () => {
  const normRows = [
    { damage: 10, survivability: 2, support: 3, control: 1, utility: 4 },
    { damage: 5,  survivability: 2, support: 3, control: 1, utility: 4 }
  ];

  test('normalizeSuggestionRows rescales fields whose max exceeds 5', () => {
    const out = calc.normalizeSuggestionRows(normRows);
    expect(out[0].damage).toBe(5);   // former max pinned to 5
    expect(out[1].damage).toBe(2.5); // 5 * (5/10)
    expect(out[0].utility).toBe(4);  // <= 5, left untouched
  });

  test('normalizeSuggestionRows does not mutate the input', () => {
    calc.normalizeSuggestionRows(normRows);
    expect(normRows[0].damage).toBe(10);
  });

  test('assertSuggestionNormalization passes for correct normalization', () => {
    const out = calc.normalizeSuggestionRows(normRows);
    expect(() => calc.assertSuggestionNormalization(normRows, out)).not.toThrow();
  });

  test('assertSuggestionNormalization throws when normalization is wrong', () => {
    const bad = normRows.map(r => ({ ...r })); // unchanged -> max still 10
    expect(() => calc.assertSuggestionNormalization(normRows, bad)).toThrow();
  });
});

describe('text & trait parsing', () => {
  test('norm lowercases and collapses punctuation/whitespace', () => {
    expect(calc.norm('Fire,  COLD!!')).toBe('fire cold');
  });

  test('splitTierSegments splits tier-tagged text and defaults to T1', () => {
    const segs = calc.splitTierSegments('T1: frightened T3: charmed');
    expect(segs).toEqual([
      { tier: 1, body: 'frightened ' },
      { tier: 3, body: 'charmed' }
    ]);
    expect(calc.splitTierSegments('no tags here')).toEqual([{ tier: 1, body: 'no tags here' }]);
  });

  test('collectTraitsForRows respects the tier ceiling', () => {
    const row = { class: 'Fighter', subclass: 'X', condition_immunities: 'T1: frightened T3: charmed' };
    const t1 = calc.collectTraitsForRows([row], 'T1');
    expect([...t1.condImm]).toEqual(['frightened']);

    const t4 = calc.collectTraitsForRows([row], 'T4');
    expect([...t4.condImm].sort()).toEqual(['charmed', 'frightened']);
  });

  test('collectTraitsForRows parses damage resistances and the barbarian rule', () => {
    const row = { class: 'Barbarian', subclass: 'Berserker', damage_resistances: 'T1: fire' };
    const t = calc.collectTraitsForRows([row], 'T4');
    expect(t.dmgRes.has('fire')).toBe(true);
    expect(t.dmgRes.has('bludgeoning')).toBe(true);
    expect(t.dmgRes.has('piercing')).toBe(true);
    expect(t.dmgRes.has('slashing')).toBe(true);
  });

  test('collectTraitsForRows detects saving-throw advantages', () => {
    const row = { class: 'Monk', subclass: 'X', advantages: 'advantage on all saving throws' };
    const t = calc.collectTraitsForRows([row], 'T4');
    expect(t.saveAdv.has('all')).toBe(true);
    expect(t.saveAdv.has('dex')).toBe(true);
  });
});

describe('monster data helpers', () => {
  test('parseCR handles fractions, numbers, and blanks', () => {
    expect(calc.parseCR('1/4')).toBe(0.25);
    expect(calc.parseCR('5')).toBe(5);
    expect(calc.parseCR(7)).toBe(7);
    expect(calc.parseCR(null)).toBe(0);
    expect(calc.parseCR('unknown')).toBe(0);
  });

  test('parseMonsterDamageList normalizes arrays, objects, and strings', () => {
    expect(calc.parseMonsterDamageList(['Fire', ' Cold '])).toEqual(['fire', 'cold']);
    expect(calc.parseMonsterDamageList([{ type: 'Poison' }])).toEqual(['poison']);
    expect(calc.parseMonsterDamageList('fire, cold; poison')).toEqual(['fire', 'cold', 'poison']);
    expect(calc.parseMonsterDamageList(null)).toEqual([]);
  });

  test('toRoll20DamageLabel title-cases each word', () => {
    expect(calc.toRoll20DamageLabel('fire')).toBe('Fire');
    expect(calc.toRoll20DamageLabel('bludgeoning')).toBe('Bludgeoning');
  });

  test('buildRoll20MonsterListingUrl encodes CR range and trait filters', () => {
    const url = calc.buildRoll20MonsterListingUrl({
      crMin: 5, crMax: 10, resistances: ['fire'], immunities: ['poison']
    });
    expect(url).toContain('filters_CR=5');
    expect(url).toContain('filters_CR=10');
    expect(url).toContain('filters_Edition=2024+Only');
    expect(url).toContain('filters_resistances=Fire');
    expect(url).toContain('filters_immunities=Poison');
  });

  test('getMonsterDamageDealt reads prose and structured damage', () => {
    const monster = {
      actions: [{ desc: 'The dragon breathes, dealing 10 fire damage.' }],
      special_abilities: [{ description: 'x', damage: [{ damage_type: 'cold' }] }]
    };
    const dealt = calc.getMonsterDamageDealt(monster);
    expect(dealt.has('fire')).toBe(true);
    expect(dealt.has('cold')).toBe(true);
  });

  test('getMonsterConditionsInflicted reads conditions from actions', () => {
    const monster = { actions: [{ desc: 'The target is frightened until the end of its turn.' }] };
    const inflicted = calc.getMonsterConditionsInflicted(monster);
    expect(inflicted.has('frightened')).toBe(true);
    expect(inflicted.has('charmed')).toBe(false);
  });
});
