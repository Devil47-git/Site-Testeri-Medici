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
    summaryCards: [...document.querySelectorAll('#test-summary-grid .test-summary-card h2')].map(h => h.textContent),
    removeBtnVisible: !document.querySelector('#remove-btn')?.hidden,
    addBtnVisible: !document.querySelector('#add-btn')?.hidden
  }));

  await page.click('#filter-btn');
  await page.waitForTimeout(100);
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
  await page.fill('#search', 'M-004');
  const vacantState = await page.locator('#tester-groups .tester-search-result').count();

  await page.click('#add-btn');
  await page.locator('#callsign').fill('210');
  await page.waitForTimeout(400);
  const docsGrantSelected = await page.locator('#grant-checks input[value="Test ALS"]').isChecked();
  await page.click('#close-modal');

  await page.click('#remove-btn');
  await page.waitForTimeout(300);
  const removeState = await page.evaluate(() => ({
    open: document.querySelector('#remove-modal')?.classList.contains('open'),
    title: document.querySelector('#remove-modal h2')?.textContent
  }));
  await page.click('#close-remove-modal');

  await page.fill('#search', '');
  const memberToggle = page.locator('#test-summary-grid .test-summary-card').filter({ hasText: 'Test A.L.S.' }).locator('[data-summary-member]').first();
  const memberDetailExists = await memberToggle.count();
  if (memberDetailExists) await memberToggle.click();
  const memberDetail = await page.evaluate(() => ({
    expanded: document.querySelector('#test-summary-grid [data-summary-member][aria-expanded="true"]')?.getAttribute('data-summary-member') || '',
    roles: [...document.querySelectorAll('#test-summary-grid .summary-member-roles .tag')].map(tag => tag.textContent.trim()),
    tests: [...document.querySelectorAll('#test-summary-grid .summary-test-count > span')].map(label => label.textContent.trim()),
    counts: [...document.querySelectorAll('#test-summary-grid .summary-test-count > strong')].map(count => count.textContent.trim())
  }));

  return { errs, initialState, filterState, searchState, vacantState, docsGrantSelected, removeState, memberDetail };
}
