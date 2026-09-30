export default async function run(page, ui) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('http://localhost:4321/?dev=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const initialState = await page.evaluate(() => ({
    shellReady: document.querySelector('#app-shell')?.className,
    profileName: document.querySelector('#profile-name')?.textContent.trim(),
    profileRank: document.querySelector('#profile-grade')?.textContent.trim(),
    profileCallsign: document.querySelector('#profile-callsign')?.textContent.trim(),
    profileTests: document.querySelectorAll('#profile-tests .tag').length,
    hasStatisticsNav: Boolean(document.querySelector('[data-view="statistics"]')),
    summaryCardsOnProfile: document.querySelectorAll('#overview-view #test-summary-grid').length
  }));

  await page.click('[data-view="statistics"]');
  const statisticsState = await page.evaluate(() => ({
    heading: document.querySelector('.statistics-view > .panel-head h2')?.textContent.trim(),
    cards: document.querySelectorAll('#test-summary-grid .test-summary-card').length,
    certifications: [...document.querySelectorAll('#test-summary-grid .test-summary-card h2')].map(h => h.textContent.trim())
  }));
  const memberToggle = page.locator('#test-summary-grid .test-summary-card').filter({ hasText: 'Test A.L.S.' }).locator('[data-summary-member]').first();
  const memberDetailExists = await memberToggle.count();
  if (memberDetailExists) await memberToggle.click();
  const memberDetail = await page.evaluate(() => ({
    expanded: document.querySelector('#test-summary-grid [data-summary-member][aria-expanded="true"]')?.getAttribute('data-summary-member') || '',
    roles: [...document.querySelectorAll('#test-summary-grid .summary-member-roles .tag')].map(tag => tag.textContent.trim()),
    tests: [...document.querySelectorAll('#test-summary-grid .summary-test-count > span')].map(label => label.textContent.trim()),
    counts: [...document.querySelectorAll('#test-summary-grid .summary-test-count > strong')].map(count => count.textContent.trim())
  }));

  await page.click('[data-view="testers"]');
  await page.click('#view-add');
  await page.locator('#callsign').fill('210');
  await page.waitForTimeout(400);
  const docsGrantSelected = await page.locator('#grant-checks input[value="Test ALS"]').isChecked();
  await page.click('#close-modal');

  await page.click('#view-remove');
  await page.waitForTimeout(300);
  const removeState = await page.evaluate(() => ({
    open: document.querySelector('#remove-modal')?.classList.contains('open'),
    title: document.querySelector('#remove-modal h2')?.textContent
  }));
  await page.click('#close-remove-modal');

  return { errs, initialState, statisticsState, docsGrantSelected, removeState, memberDetail };
}
