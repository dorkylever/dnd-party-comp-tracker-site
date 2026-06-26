const { test, expect } = require('@playwright/test');

/* Browser smoke test for the built ./site bundle.

   Purpose: catch the failure modes that the Node unit tests structurally
   cannot — e.g. the deploy bundle missing css/ or js/ (404s), or scripts
   failing to load/run in a real browser. The unit tests import the pure
   logic via require(); they never load index.html, the CSS, or the
   browser-only modules (charts.js, monsters.js, app.js).

   External requests (the Open5e monster API) are intentionally ignored so
   CI never flakes on third-party network conditions. We only assert on
   same-origin assets and uncaught script errors. */

test('app loads from the built bundle with all assets and renders', async ({ page, baseURL }) => {
  const sameOriginFailures = [];
  const pageErrors = [];

  page.on('response', (resp) => {
    const url = resp.url();
    if (url.startsWith(baseURL) && resp.status() >= 400) {
      sameOriginFailures.push(`${resp.status()} ${url}`);
    }
  });

  // Uncaught exceptions (e.g. a missing js file leaving functions undefined).
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');

  // Header survives — the app replaces <body> with a "Data loading failed"
  // panel if subclasses.json can't load, so this also guards data delivery.
  await expect(page).toHaveTitle(/DND Party Composition Tracker/);
  await expect(page.locator('h1')).toHaveText(/DND Party Composition Tracker/);

  // The class dropdown is populated from subclasses.json by app.js once the
  // scripts have loaded and run — proves css/js/json were all served and the
  // browser-only code executed end to end.
  await expect
    .poll(async () => page.locator('#classSelect option').count(), { timeout: 10_000 })
    .toBeGreaterThan(1);

  expect(sameOriginFailures, `Same-origin failed requests:\n${sameOriginFailures.join('\n')}`).toEqual([]);
  expect(pageErrors, `Uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
