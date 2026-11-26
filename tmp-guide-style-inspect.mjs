export default async function run(page) {
  await page.route('**/api/guide', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'FUNCTION_INVOCATION_FAILED' }));
  try {
    await page.goto('http://localhost:3000');
    await page.waitForFunction(() => document.querySelector('#app-shell')?.classList.contains('ready'));
    const results = [];
    for (const theme of ['standard', 'eclipse', 'christmas']) {
      await page.locator('[data-view="overview"]').click();
      await page.locator('#profile-theme-toggle').click();
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.locator('#guide-nav').click();
      await page.waitForFunction(theme => Boolean(document.querySelector('.guide-panel')?.classList.contains(`guide-theme-${theme}`) && document.querySelector('.guide-official-content #introducere')), theme);
      results.push(await page.evaluate(theme => {
        const sels = ['.guide-panel', '.guide-load-warning', '.guide-official-content', '.guide-official-content h1', '.guide-official-content p', '.guide-official-content [style*="color"]', '.guide-official-content .jaf-btn'];
        return { theme, bodyClass: document.body.className, computed: Object.fromEntries(sels.map(s => { const e = document.querySelector(s); if (!e) return [s, null]; const c = getComputedStyle(e); return [s, { bg: c.backgroundColor, color: c.color, border: c.borderColor }] })) };
      }, theme));
    }
    return results;
  } finally {
    await page.unroute('**/api/guide');
  }
}
