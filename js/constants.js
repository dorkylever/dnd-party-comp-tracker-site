/* ==========================================================================
   constants.js — shared, immutable configuration for the tracker.

   UMD-style wrapper: in the browser the constants are attached to the global
   scope (so plain <script> files can use them as globals); under Node/Jest they
   are exported via module.exports so unit tests can import them.
   ========================================================================== */
(function (root, factory) {
  const constants = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = constants;
  } else {
    Object.assign(root, constants);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const METRICS = ['damage', 'survivability', 'support', 'control', 'utility'];
  const METRIC_LABELS = ['Damage', 'Survivability', 'Support', 'Control', 'Utility'];
  const OPTIMISER_MIN = 3.5;

  const METRIC_HELP_TEXT = {
    damage: 'Overall offensive output, including burst and sustained damage.',
    survivability: 'How well the build avoids dropping, mitigates risk, or recovers from pressure.',
    support: 'How much the build improves allies through buffs, healing, or enabling actions.',
    control: 'How strongly the build shapes enemy turns, positions, or available actions.',
    utility: 'Out-of-combat flexibility, problem solving, exploration, and general toolkit breadth.'
  };

  const SUGGESTION_HELP_TEXT = {
    optimiser: 'The Optimiser\'s Dream tests each candidate by averaging it into the current party and keeping only candidates that keep every metric above the active threshold. The best valid candidate is the one with the highest combined average.',
    vibes: 'The Vibes Check finds the candidate that produces the most even party profile by minimizing variance across the combined party metrics.'
  };

  const CONDITIONS = [
    'blinded','charmed','deafened','exhaustion','frightened','grappled','incapacitated',
    'invisible','paralyzed','petrified','poisoned','prone','restrained','stunned','unconscious'
  ];

  const DAMAGE_TYPES = [
    'acid','bludgeoning','cold','fire','force','lightning','necrotic',
    'piercing','poison','psychic','radiant','slashing','thunder'
  ];

  const SAVE_THROW_KEYS = ['all', 'str', 'dex', 'con', 'int', 'wis', 'cha'];
  const SAVE_THROW_LABELS = {
    all: 'All saves',
    str: 'STR',
    dex: 'DEX',
    con: 'CON',
    int: 'INT',
    wis: 'WIS',
    cha: 'CHA'
  };

  const TIER_RANK = { T1: 1, T2: 2, T3: 3, T4: 4 };

  // Flexible raw text columns from DB
  const RAW_TRAIT_COLUMNS = {
    advantage: ['condition_advantages', 'advantages_to_conditions', 'defensive_advantages', 'advantages'],
    resistance: ['condition_resistances', 'resistances_to_conditions', 'defensive_resistances', 'resistances'],
    immunity: ['condition_immunities', 'immunities_to_conditions', 'defensive_immunities', 'immunities'],
    damageResistance: ['damage_resistances', 'resistance_damage_types', 'damage_resistance'],
    damageImmunity: ['damage_immunities', 'immunity_damage_types', 'damage_immunity']
  };

  const SCORE_FIELDS = ['damage', 'survivability', 'support', 'control', 'utility'];

  const CR_TIER_RANGES = {
    T1: [0, 4],
    T2: [5, 10],
    T3: [11, 16],
    T4: [17, 999]
  };

  return {
    METRICS,
    METRIC_LABELS,
    OPTIMISER_MIN,
    METRIC_HELP_TEXT,
    SUGGESTION_HELP_TEXT,
    CONDITIONS,
    DAMAGE_TYPES,
    SAVE_THROW_KEYS,
    SAVE_THROW_LABELS,
    TIER_RANK,
    RAW_TRAIT_COLUMNS,
    SCORE_FIELDS,
    CR_TIER_RANGES
  };
});
