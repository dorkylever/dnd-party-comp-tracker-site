const fs = require('fs');
const path = require('path');
const content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DND Subclass Radar</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background: #f4f4f4; color: #1f2937; }
    h1 { margin-bottom: 16px; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08); padding: 20px; max-width: 960px; margin-bottom: 24px; }
    .search-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    #subclassSearch { flex: 1; min-width: 240px; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; }
    button { padding: 10px 14px; border: none; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    #selectedList { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 10px; }
    .tag { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #e2e8f0; border-radius: 999px; }
    .tag button { background: transparent; color: #1f2937; padding: 0 4px; border: none; cursor: pointer; font-size: 16px; }
    .chart-card { max-width: 720px; margin: auto; min-height: 500px; position: relative; }
    .chart-card canvas { width: 100% !important; height: 440px !important; }
    .caption { margin-top: 12px; color: #475569; }
  </style>
</head>
<body>
  <h1>DND Subclass Radar</h1>
  <div class="card">
    <p>Choose one or more subclasses from the searchable dropdown. Only subclasses with both <strong>damage</strong> and <strong>utility</strong> values are included.</p>
    <div class="search-row">
      <input id="subclassSearch" list="subclassOptions" placeholder="Search subclass or class..." autocomplete="off" />
      <button id="addSubclassButton" type="button">Add subclass</button>
    </div>
    <datalist id="subclassOptions"></datalist>
    <div id="selectedList"></div>
    <p class="caption">Tip: type "Base Barbarian" and add it to the selected list.</p>
  </div>
  <div class="card chart-card">
    <canvas id="radarChart"></canvas>
    <p id="chartMessage" class="caption"></p>
  </div>
  <script>
    const API_BASE = '/api';
    let subclasses = [];
    let selectedSubclassNames = [];
    let radarChart;

    function formatOption(row) {
      return row.subclass + " (" + row.class + ")";
    }

    async function fetchSubclasses() {
      const response = await fetch(\`\${API_BASE}/subclasses\`);
      if (!response.ok) throw new Error('Failed to load subclass data');
      subclasses = await response.json();
      document.getElementById('subclassOptions').innerHTML = subclasses
        .map(row => \`<option value="\${formatOption(row)}">\`).join('');
    }

    function findSubclass(value) {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return null;
      let exact = subclasses.find(row => {
        const full = formatOption(row).toLowerCase();
        return full === normalized || row.subclass.toLowerCase() === normalized || row.class.toLowerCase() === normalized;
      });
      if (exact) return exact;
      return subclasses.find(row => {
        const full = formatOption(row).toLowerCase();
        return full.includes(normalized) || row.subclass.toLowerCase().includes(normalized) || row.class.toLowerCase().includes(normalized);
      });
    }

    function updateSelectedList() {
      document.getElementById('selectedList').innerHTML = selectedSubclassNames
        .map(name => {
          const row = subclasses.find(r => r.subclass === name);
          if (!row) return '';
          const escapedName = name.replace(/'/g, "\\'");
          return \`\n            <div class="tag">\n              \${formatOption(row)}\n              <button type="button" aria-label="Remove \${name}" onclick="removeSubclass('\${escapedName}')">&times;</button>\n            </div>\n          \`;
        })
        .join('');
      renderChart();
    }

    function removeSubclass(name) {
      selectedSubclassNames = selectedSubclassNames.filter(item => item !== name);
      updateSelectedList();
    }

    function getAverageMetrics(subclassName) {
      const rows = subclasses.filter(row => row.subclass === subclassName);
      if (!rows.length) return null;
      const metrics = ['damage', 'survivability', 'support', 'control', 'utility'];
      const averages = metrics.map(metric => rows.reduce((sum, row) => sum + Number(row[metric] || 0), 0) / rows.length);
      return {
        label: \`\${rows[0].subclass} (\${rows[0].class})\`,
        values: averages.map(value => Math.round(value * 100) / 100)
      };
    }

    function renderChart() {
      const message = document.getElementById('chartMessage');
      const labels = ['Damage', 'Survivability', 'Support', 'Control', 'Utility'];
      const datasets = selectedSubclassNames
        .map(getAverageMetrics)
        .filter(Boolean)
        .map((entry, index) => {
          const palette = [
            'rgba(37, 99, 235, 0.35)',
            'rgba(16, 185, 129, 0.35)',
            'rgba(245, 158, 11, 0.35)',
            'rgba(239, 68, 68, 0.35)',
            'rgba(168, 85, 247, 0.35)'
          ];
          const border = [
            'rgba(37, 99, 235, 1)',
            'rgba(16, 185, 129, 1)',
            'rgba(245, 158, 11, 1)',
            'rgba(239, 68, 68, 1)',
            'rgba(168, 85, 247, 1)'
          ];
          return {
            label: entry.label,
            data: entry.values,
            fill: true,
            backgroundColor: palette[index % palette.length],
            borderColor: border[index % border.length],
            borderWidth: 2,
            pointRadius: 4
          };
        });
      if (radarChart) radarChart.destroy();
      if (!datasets.length) {
        message.textContent = 'Add one or more subclasses to see averaged scores across youtubers.';
        return;
      }
      message.textContent = '';
      radarChart = new Chart(document.getElementById('radarChart'), {
        type: 'radar',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              beginAtZero: true,
              suggestedMin: 0,
              suggestedMax: 6,
              ticks: { stepSize: 1 }
            }
          },
          plugins: { legend: { position: 'top' } }
        }
      });
    }

    document.getElementById('addSubclassButton').addEventListener('click', () => {
      const input = document.getElementById('subclassSearch');
      const row = findSubclass(input.value);
      if (!row) {
        alert('No matching subclass found. Try typing the subclass or class name exactly.');
        return;
      }
      if (!selectedSubclassNames.includes(row.subclass)) {
        selectedSubclassNames.push(row.subclass);
        updateSelectedList();
      }
      input.value = '';
      input.focus();
    });

    window.removeSubclass = removeSubclass;

    window.addEventListener('DOMContentLoaded', async () => {
      try {
        await fetchSubclasses();
        renderChart();
      } catch (error) {
        document.getElementById('chartMessage').textContent = 'Could not load subclass data.';
        console.error(error);
      }
    });
  </script>
</body>
</html>`;
fs.writeFileSync(path.join(__dirname, 'index.html'), content, 'utf8');
