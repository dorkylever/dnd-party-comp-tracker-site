/* ==========================================================================
   monsters.js — Monster Matchup panel.

   Browser-only. Fetches creatures from the Open5e SRD 2024 API and cross-
   references the party's damage resistances/immunities and condition
   protections (computed by calculations.js) to surface favorable matchups,
   exploit opportunities, and Roll20 search links. Reads shared application
   state declared in app.js (subclasses, selectedSubclassLabels).
   ========================================================================== */

let monsterData = null;
let monsterLoadState = 'idle'; // 'idle' | 'loading' | 'done' | 'error'
let monsterLoadError = '';

async function loadMonsters() {
  if (monsterLoadState === 'loading' || monsterLoadState === 'done') return;
  monsterLoadState = 'loading';
  renderMonsterMatchupStatus();
  try {
    const all = [];
    let url = 'https://api.open5e.com/v2/creatures/?document__slug=srd-2024&is_legacy=false&limit=100';
    while (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Open5e API responded with ${res.status}`);
      const data = await res.json();
      all.push(...(data.results || []));
      url = data.next || null;
    }
    // Deduplicate by name — keep first non-legacy occurrence per name
    const seen = new Set();
    const deduped = all.filter(m => {
      const isLegacy = m.is_legacy === true || String(m.key || '').includes('legacy');
      if (isLegacy) return false;
      if (seen.has(m.name)) return false;
      seen.add(m.name);
      return true;
    });
    monsterData = deduped;
    monsterLoadState = 'done';
    console.log(`[Monsters] Loaded ${deduped.length} creatures (${all.length} raw, duplicates removed)`);
  } catch (err) {
    monsterLoadState = 'error';
    monsterLoadError = err.message;
    console.error('[Monsters] Load failed:', err);
  }
  renderMonsterMatchup();
}

function retryLoadMonsters() {
  monsterLoadState = 'idle';
  monsterLoadError = '';
  loadMonsters();
}
window.retryLoadMonsters = retryLoadMonsters;

function renderMonsterMatchupStatus() {
  const el = document.getElementById('monsterMatchupStatus');
  if (!el) return;
  if (monsterLoadState === 'loading') {
    el.innerHTML = '<p class="caption" style="color:#2563eb;">Loading monsters from Open5e API\u2026</p>';
  } else if (monsterLoadState === 'error') {
    el.innerHTML = `<p class="caption" style="color:#dc2626;">Failed to load monsters: ${escapeHtml(monsterLoadError)} &mdash; <button type="button" onclick="retryLoadMonsters()" style="background:none;color:#2563eb;border:none;cursor:pointer;padding:0;font-size:inherit;text-decoration:underline;">Retry</button></p>`;
  } else {
    el.innerHTML = '';
  }
}

function renderMonsterMatchup() {
  renderMonsterMatchupStatus();
  const container = document.getElementById('monsterMatchupContent');
  if (!container) return;

  if (!selectedSubclassLabels.length) {
    container.innerHTML = '<p class="caption">Add subclasses to see monster matchup analysis.</p>';
    return;
  }
  if (monsterLoadState === 'loading') {
    container.innerHTML = '';
    return;
  }
  if (monsterLoadState !== 'done' || !monsterData) {
    container.innerHTML = '<p class="caption">Monster data unavailable. See status above.</p>';
    return;
  }

  // Get party's damage traits and condition protections
  const traitTier = document.getElementById('monsterTraitTierSelect')?.value || 'T4';
  const partyRows = selectedSubclassLabels.flatMap(label => subclasses.filter(r => formatOption(r) === label));
  const traits = collectTraitsForRows(partyRows, traitTier);
  const partyResisted = new Set([...traits.dmgRes, ...traits.dmgImm]);
  const partyResistances = [...traits.dmgRes].sort((a, b) => a.localeCompare(b));
  const partyImmunities = [...traits.dmgImm].sort((a, b) => a.localeCompare(b));
  const partyCondProtected = new Set([...traits.condAdv, ...traits.condRes, ...traits.condImm]);

  // CR filter
  const crFilterRaw = (document.getElementById('monsterCrFilter')?.value || '').trim();
  let crMin = 0, crMax = 999;
  if (crFilterRaw) {
    const rangeMatch = crFilterRaw.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
    const singleMatch = crFilterRaw.match(/^(\d+(?:\.\d+)?)$/);
    if (rangeMatch) { crMin = parseFloat(rangeMatch[1]); crMax = parseFloat(rangeMatch[2]); }
    else if (singleMatch) { crMin = crMax = parseFloat(singleMatch[1]); }
  }

  const roll20CombinedUrl = buildRoll20MonsterListingUrl({
    crMin,
    crMax,
    resistances: partyResistances,
    immunities: partyImmunities
  });

  const roll20ResistanceLinks = partyResistances.map(type => ({
    type,
    url: buildRoll20MonsterListingUrl({ crMin, crMax, resistances: [type] })
  }));

  const roll20ImmunityLinks = partyImmunities.map(type => ({
    type,
    url: buildRoll20MonsterListingUrl({ crMin, crMax, immunities: [type] })
  }));

  const filtered = monsterData.filter(m => {
    const cr = parseCR(m.challenge_rating);
    return cr >= crMin && cr <= crMax;
  });

  // ─── Favorable Matchups ──────────────────────────────────────
  const allScoredMonsters = filtered
    .map(m => {
      const dealt = getMonsterDamageDealt(m);
      const inflicted = getMonsterConditionsInflicted(m);
      if (!dealt.size && !inflicted.size) return null;
      const covered = [...dealt].filter(dt => partyResisted.has(dt));
      const coveredConds = [...inflicted].filter(c => partyCondProtected.has(c));
      const uncoveredDmg = [...dealt].filter(dt => !partyResisted.has(dt));
      const uncoveredConds = [...inflicted].filter(c => !partyCondProtected.has(c));
      const totalThreat = dealt.size + inflicted.size;
      const score = totalThreat > 0 ? (covered.length + coveredConds.length) / totalThreat : 0;
      return { name: m.name, key: m.key, cr: m.challenge_rating, score, covered, coveredConds, uncoveredDmg, uncoveredConds, dealt: [...dealt], inflicted: [...inflicted] };
    })
    .filter(Boolean);

  const favorableMonsters = allScoredMonsters
    .filter(m => m.covered.length || m.coveredConds.length)
    .sort((a, b) => {
      const aMatches = a.covered.length + a.coveredConds.length;
      const bMatches = b.covered.length + b.coveredConds.length;
      return bMatches - aMatches || b.score - a.score || a.name.localeCompare(b.name);
    });

  // ─── Disfavorable Matchups ────────────────────────────────────
  const disfavorableMonsters = allScoredMonsters
    .filter(m => m.uncoveredDmg.length || m.uncoveredConds.length)
    .sort((a, b) => {
      const aUncov = a.uncoveredDmg.length + a.uncoveredConds.length;
      const bUncov = b.uncoveredDmg.length + b.uncoveredConds.length;
      return bUncov - aUncov || a.score - b.score || a.name.localeCompare(b.name);
    });

  // ─── Exploit Opportunities ───────────────────────────────────
  const exploitByType = Object.fromEntries(DAMAGE_TYPES.map(dt => [dt, []]));
  filtered.forEach(m => {
    const rawVulns = m.damage_vulnerabilities ?? m.vulnerabilities ?? [];
    const vulns = parseMonsterDamageList(rawVulns);
    DAMAGE_TYPES.forEach(dt => {
      if (vulns.some(v => v.includes(dt))) {
        exploitByType[dt].push({ name: m.name, key: m.key, cr: m.challenge_rating });
      }
    });
  });
  const exploitTypes = DAMAGE_TYPES.filter(dt => exploitByType[dt].length > 0);

  // Party defense chips
  const dmgChips = partyResisted.size
    ? [...partyResisted].sort().map(dt =>
        `<span class="metric-chip" style="background:#dbeafe;color:#1e3a8a;">${escapeHtml(dt)}</span>`
      ).join('')
    : '<span style="color:#94a3b8;font-size:.9rem;">none</span>';
  const condChips = partyCondProtected.size
    ? [...partyCondProtected].sort().map(c =>
        `<span class="metric-chip" style="background:#ede9fe;color:#4c1d95;">${escapeHtml(c)}</span>`
      ).join('')
    : '<span style="color:#94a3b8;font-size:.9rem;">none</span>';

  const coverageColor = (score) => {
    if (score >= 1) return '#166534';
    if (score >= 0.5) return '#1d4ed8';
    return '#374151';
  };

  container.innerHTML = `
    <div style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:16px;">
      <div>
        <div style="font-size:.78rem;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.02em;margin-bottom:4px;">
          Damage resistances &amp; immunities &mdash; ${escapeHtml(traitTier)}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${dmgChips}</div>
      </div>
      <div>
        <div style="font-size:.78rem;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.02em;margin-bottom:4px;">
          Condition protections (adv/res/imm) &mdash; ${escapeHtml(traitTier)}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${condChips}</div>
      </div>
    </div>
    <div class="suggestion-columns">
      <div class="suggestion-column">
        <div class="suggestion-column-title">Roll20 Search URL
          <span style="font-weight:400;color:#64748b;font-size:.82rem;"> &mdash; party resistances and immunities</span>
        </div>
        <div style="font-size:.88rem;color:#475569;line-height:1.6;word-break:break-all;">
          <a href="${escapeHtml(roll20CombinedUrl)}" target="_blank" rel="noopener" style="color:#1d4ed8;text-decoration:underline;text-underline-offset:2px;">${escapeHtml(roll20CombinedUrl)}</a>
        </div>
        <p class="caption" style="margin-top:8px;">Generated from CR ${escapeHtml(String(crMin))}-${escapeHtml(String(crMax))}, trait tier ${escapeHtml(traitTier)}, plus all party damage resistances and immunities.</p>
      </div>
      <div class="suggestion-column">
        <div class="suggestion-column-title">Per-Type Roll20 URLs
          <span style="font-weight:400;color:#64748b;font-size:.82rem;"> &mdash; quick links by damage type filter</span>
        </div>
        ${roll20ResistanceLinks.length || roll20ImmunityLinks.length ? `
          <div style="display:flex;flex-direction:column;gap:10px;font-size:.82rem;line-height:1.5;">
            ${roll20ResistanceLinks.length ? `
              <div>
                <div style="font-weight:700;color:#1e3a8a;margin-bottom:4px;">Resistance filters</div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  ${roll20ResistanceLinks.map(link => `
                    <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" style="color:#1d4ed8;word-break:break-all;text-decoration:underline;text-underline-offset:2px;">${escapeHtml(link.type)}: ${escapeHtml(link.url)}</a>
                  `).join('')}
                </div>
              </div>
            ` : ''}
            ${roll20ImmunityLinks.length ? `
              <div>
                <div style="font-weight:700;color:#4c1d95;margin-bottom:4px;">Immunity filters</div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                  ${roll20ImmunityLinks.map(link => `
                    <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" style="color:#7c3aed;word-break:break-all;text-decoration:underline;text-underline-offset:2px;">${escapeHtml(link.type)}: ${escapeHtml(link.url)}</a>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        ` : `<p class="caption">No party damage resistances or immunities found for this tier, so no Roll20 filters were generated.</p>`}
      </div>
    </div>
    <div style="margin-top:16px;">
      <div class="suggestion-column" style="max-width:100%;">
        <div class="suggestion-column-title">Exploit Opportunities
          <span style="font-weight:400;color:#64748b;font-size:.82rem;"> &mdash; monsters vulnerable to these damage types</span>
        </div>
        ${exploitTypes.length ? `<div style="display:flex;flex-wrap:wrap;gap:16px;">` + exploitTypes.map(dt => `
          <div style="min-width:180px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <span style="font-weight:600;font-size:.9rem;">${escapeHtml(dt)}</span>
              <span style="background:#fef3c7;color:#92400e;font-size:.78rem;padding:1px 8px;border-radius:999px;">${exploitByType[dt].length} monster${exploitByType[dt].length !== 1 ? 's' : ''}</span>
            </div>
            <div style="font-size:.82rem;color:#475569;line-height:1.7;">
              ${exploitByType[dt].map(m => `<a href="https://open5e.com/monsters/${escapeHtml(m.key)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;text-underline-offset:2px;">${escapeHtml(m.name)}</a> <span style="color:#94a3b8;">(CR&nbsp;${escapeHtml(String(m.cr))})</span>`).join(' &middot; ')}
            </div>
          </div>
        `).join('') + `</div>` : `<p class="caption">No monsters with damage vulnerabilities found for the selected CR range.</p>`}
      </div>
    </div>
  `;
  updateHelpPopoverPositions();
}
