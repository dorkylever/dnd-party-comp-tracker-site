const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'dnd_classes.db');
const OUT_PATH = path.join(__dirname, 'subclasses.json');
const TABLE_NAME = process.env.TABLE_NAME || null;const TABLE_NAME = process.env.TABLE_NAME || null;

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));=> (err ? reject(err) : resolve(rows)));
  });
}

async function detectTable(db) {sync function detectTable(db) {
  if (TABLE_NAME) return TABLE_NAME;  if (TABLE_NAME) return TABLE_NAME;

  const tables = await all(
    db,    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`e_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );

  for (const t of tables) {r (const t of tables) {
    const cols = await all(db, `PRAGMA table_info(${t.name})`);    const cols = await all(db, `PRAGMA table_info(${t.name})`);
    const names = new Set(cols.map(c => String(c.name).toLowerCase()));ols.map(c => String(c.name).toLowerCase()));
    if (names.has('subclass') && (names.has('class') || names.has('class_name'))) {as('class_name'))) {
      return t.name;
    }
  }

  throw new Error('No table found with subclass + class/class_name columns.');hrow new Error('No table found with subclass + class/class_name columns.');
}}

async function main() {sync function main() {
  const db = new sqlite3.Database(DB_PATH);  const db = new sqlite3.Database(DB_PATH);
  try {
    const table = await detectTable(db);
    const rows = await all(db, `SELECT * FROM ${table}`);    const rows = await all(db, `SELECT * FROM ${table}`);
    const normalized = rows.map(r => ({ ...r, class: r.class ?? r.class_name ?? null }));st normalized = rows.map(r => ({ ...r, class: r.class ?? r.class_name ?? null }));

    fs.writeFileSync(OUT_PATH, JSON.stringify(normalized, null, 2), 'utf8'); null, 2), 'utf8');
    console.log(`Wrote ${OUT_PATH} (${normalized.length} rows) from table "${table}"`);    console.log(`Wrote ${OUT_PATH} (${normalized.length} rows) from table "${table}"`);
  } finally {
    db.close();
  }
}

main().catch(err => {main().catch(err => {
  console.error(err);
  process.exit(1);
});