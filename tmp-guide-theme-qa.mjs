export default async function run(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/guide', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'FUNCTION_INVOCATION_FAILED' }));
  await page.goto('http://localhost:3000');
  await page.waitForFunction(() => document.querySelector('#app-shell')?.classList.contains('ready'));
  const snapshots = [];
  for (const theme of ['standard', 'eclipse', 'christmas']) {
    if (theme !== 'standard') { await page.locator('[data-view="overview"]').click(); await page.locator('#profile-theme-toggle').click(); await page.locator(`[data-theme-choice="${theme}"]`).click(); }
    await page.locator('#guide-nav').click();
    await page.waitForFunction(theme => document.querySelector('.guide-panel')?.classList.contains(`guide-theme-${theme}`) && document.querySelector('.guide-load-warning') && document.querySelector('.guide-official-content')?.innerText.includes('Spitalul Județean Eclipse Medical Tower'), theme);
    snapshots.push(await page.evaluate(theme => { const panel = document.querySelector('.guide-panel'), content = document.querySelector('.guide-official-content'), warning = document.querySelector('.guide-load-warning'), colors = element => { const c = getComputedStyle(element); return { background: c.backgroundImage || c.backgroundColor, color: c.color, border: c.borderColor } }; return { theme, themeClass: [...panel.classList].find(name => name.startsWith('guide-theme-')), warning: warning.innerText, heading: content.innerText.split('\n').slice(0, 3), panel: colors(panel), content: colors(content), headingColor: getComputedStyle(content.querySelector('h1,h2,h3') || content).color, imageCount: content.querySelectorAll('img').length, brokenImages: [...content.querySelectorAll('img')].filter(i => !i.naturalWidth).length, snowfall: getComputedStyle(document.querySelector('#christmas-snowfall')).visibility }; }, theme));
    if (theme === 'christmas') await page.screenshot({ path: 'tmp-guide-theme-christmas.png', fullPage: true });
  }
  return { snapshots, errors };
}
