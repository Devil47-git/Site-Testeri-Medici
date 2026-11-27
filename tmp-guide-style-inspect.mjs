function inspectThemeStyles(theme) {
  const selectors = [
    '.guide-panel',
    '.guide-load-warning',
    '.guide-official-content',
    '.guide-official-content h1',
    '.guide-official-content p',
    '.guide-official-content [style*="color"]',
    '.guide-official-content .jaf-btn'
  ];

  const computed = Object.fromEntries(selectors.map(selector => {
    const el = document.querySelector(selector);
    if (!el) return [selector, null];
    const style = getComputedStyle(el);
    return [selector, { bg: style.backgroundColor, color: style.color, border: style.borderColor }];
  }));

  return { theme, bodyClass: document.body.className, computed };
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{theme: string, bodyClass: string, computed: Record<string, {bg: string, color: string, border: string} | null>}>>}
 */
export default async function run(page) {
  try {
    await page.route('**/api/guide', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'FUNCTION_INVOCATION_FAILED' }));
    await page.goto('http://localhost:3000');
    await page.waitForFunction(() => document.querySelector('#app-shell')?.classList.contains('ready'));
    const results = [];
    for (const theme of ['standard', 'eclipse', 'christmas']) {
      await page.locator('[data-view="overview"]').click();
      await page.locator('#profile-theme-toggle').click();
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.locator('#guide-nav').click();
      await page.waitForFunction(theme => Boolean(document.querySelector('.guide-panel')?.classList.contains(`guide-theme-${theme}`) && document.querySelector('.guide-official-content #introducere')), theme);
      results.push(await page.evaluate(inspectThemeStyles, theme));
    }
    return results;
  } finally {
    await page.unroute('**/api/guide').catch(() => {});
  }
}
