const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('dnd_classes.db');
function allAsync(sql) {
  return new Promise((resolve, reject) => db.all(sql, (err, rows) => err ? reject(err) : resolve(rows)));
}
(async () => {
  try {
    const tables = await allAsync("SELECT name,type,sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%';");
    console.log('TABLES', tables.map(t => ({name:t.name,type:t.type})));
    for (const t of tables) {
      console.log('\n---', t.name, '---');
      console.log(t.sql);
      const cols = await allAsync(`PRAGMA table_info(${t.name})`);
      console.log('COLUMNS', cols.map(c => ({cid:c.cid,name:c.name,type:c.type,pk:c.pk})));
      const count = await allAsync(`SELECT COUNT(*) AS cnt FROM ${t.name}`);
      console.log('COUNT', count[0].cnt);
      const rows = await allAsync(`SELECT * FROM ${t.name} LIMIT 20`);
      console.log('ROWS', rows);
    }
  } catch (e) {
    console.error(e);
  } finally {
    db.close();
  }
})();
