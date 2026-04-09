// filepath: server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const dbPath = path.join(__dirname, 'dnd_classes.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) console.error('Database error:', err.message);
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/api/subclasses', (req, res) => {
  const sql = `
    SELECT
      subclass,
      class,
      AVG(damage) AS damage,
      AVG(survivability) AS survivability,
      AVG(support) AS support,
      AVG(control) AS control,
      AVG(utility) AS utility
    FROM subclasses
    WHERE damage IS NOT NULL
      AND utility IS NOT NULL
    GROUP BY subclass, class
    ORDER BY subclass COLLATE NOCASE
  `;

  console.log('SQL:', sql);
  console.log('Executing AVG query');
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('DB Error:', err);
      return res.status(500).json({ error: err.message });
    }
    console.log('Rows returned:', rows.length);
    res.json(rows);
  });
});

app.get('/api/subclasses/aggregated', (req, res) => {
  const sql = `
    SELECT
      subclass,
      class,
      AVG(damage) AS damage,
      AVG(survivability) AS survivability,
      AVG(support) AS support,
      AVG(control) AS control,
      AVG(utility) AS utility
    FROM subclasses
    WHERE damage IS NOT NULL
      AND utility IS NOT NULL
    GROUP BY subclass, class
    ORDER BY subclass COLLATE NOCASE
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});