const fs = require('fs');

async function main() {
  const res = await fetch('http://localhost:3000/api/subclasses');
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while fetching /api/subclasses`);
  }

  const data = await res.json();
  fs.writeFileSync('subclasses.json', JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote subclasses.json (${data.length} rows)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});