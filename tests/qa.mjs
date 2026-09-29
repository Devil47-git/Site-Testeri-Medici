export default async function run(page, ui) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('http://localhost:4321/?dev=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const initialState = await page.evaluate(() => ({
    shellReady: document.querySelector('#app-shell')?.className,
    emptySearchPrompt: document.querySelector('#tester-groups')?.textContent.trim(),
    hasThemeToggle: Boolean(document.querySelector('#theme-toggle')),
    darkMode: document.body.classList.contains('dark-mode'),
    tables: document.querySelectorAll('#tester-groups table').length,
    removeBtnVisible: !document.querySelector('#remove-btn')?.hidden,
    addBtnVisible: !document.querySelector('#add-btn')?.hidden
  }));

  const filterState = await page.evaluate(() => ({
    open: !document.querySelector('#test-filter-menu')?.hidden,
    options: [...document.querySelectorAll('[data-test-filter]')].map(o => o.textContent.trim())
  }));
  await page.click('[data-test-filter="Test ALS"]');
  await page.fill('#search', 'Elena Stan');
  await page.waitForTimeout(300);
  const searchState = await page.evaluate(() => ({
    results: [...document.querySelectorAll('#tester-groups .tester-search-result')].map(item => item.textContent.trim()),
    tables: document.querySelectorAll('#tester-groups table').length
  }));

  await page.click('#remove-btn');
  await page.waitForTimeout(300);
  const removeState = await page.evaluate(() => ({
    open: document.querySelector('#remove-modal')?.classList.contains('open'),
    title: document.querySelector('#remove-modal h2')?.textContent
  }));
  await page.click('#close-remove-modal');

  return { errs, initialState, filterState, searchState, removeState };
}
