/* Builds the deployable static bundle into ./site.
   Single source of truth for what GitHub Pages serves AND what the browser
   smoke test runs against, so the two can never drift (this is exactly the
   class of bug that previously shipped a site missing its css/ and js/). */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'site');

// Everything the deployed page needs to function.
const FILES = ['index.html', 'subclasses.json'];
const DIRS = ['css', 'js'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of FILES) {
  const src = path.join(root, file);
  if (!fs.existsSync(src)) throw new Error(`build-site: required file missing: ${file}`);
  fs.copyFileSync(src, path.join(out, file));
}

for (const dir of DIRS) {
  const src = path.join(root, dir);
  if (!fs.existsSync(src)) throw new Error(`build-site: required directory missing: ${dir}/`);
  fs.cpSync(src, path.join(out, dir), { recursive: true });
}

// Disable Jekyll processing on GitHub Pages.
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log('build-site: bundle created at site/ ->', fs.readdirSync(out).sort().join(', '));
