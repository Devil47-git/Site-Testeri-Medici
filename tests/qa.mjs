export default async function run(page, ui) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('http://localhost:4321/?dev=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const initialState = await page.evaluate(() => ({
    shellReady: document.querySelector('#app-shell')?.className,
    profileName: document.querySelector('#profile-name')?.textContent.trim(),
    profileCallsign: document.querySelector('#profile-callsign')?.textContent.trim(),
    departmentName: document.querySelector('#profile-member-name')?.textContent.trim(),
    departmentRank: document.querySelector('#profile-member-rank')?.textContent.trim(),
    profileTests: document.querySelectorAll('#profile-tests .tag').length,
    profileCountCards: document.querySelectorAll('#profile-test-history .statistics-test-count').length,
    profileTagsUppercase: [...document.querySelectorAll('#profile-tests .tag')].every(tag => getComputedStyle(tag).textTransform === 'uppercase' && Number(getComputedStyle(tag).fontWeight) >= 700),
    adminPanelVisible: !document.querySelector('#admin-panel')?.hidden,
    hasStatisticsNav: Boolean(document.querySelector('[data-view="statistics"]')),
    summaryCardsOnProfile: document.querySelectorAll('#overview-view #test-summary-grid').length
  }));

  await page.click('#admin-add-tester');
  const adminAddOpens = await page.locator('#modal').evaluate(el => el.classList.contains('open'));
  await page.click('#close-modal');
  await page.click('#admin-remove-tester');
  const adminRemoveOpens = await page.locator('#remove-modal').evaluate(el => el.classList.contains('open'));
  await page.click('#close-remove-modal');
  await page.click('#admin-settings');
  const adminSettingsOpens = await page.locator('#page-label').textContent() === 'Setări';
  await page.click('[data-view="overview"]');

  await page.click('[data-view="statistics"]');
  const statisticsState = await page.evaluate(() => ({
    heading: document.querySelector('.statistics-view > .panel-head h2')?.textContent.trim(),
    testers: document.querySelectorAll('.statistics-tester').length,
    firstFields: [...document.querySelectorAll('.statistics-tester-fields dt')].slice(0, 3).map(dt => dt.textContent.trim()),
    countCardsInList: document.querySelectorAll('.tester-statistics-list .statistics-test-count').length
  }));
  const memberToggle = page.locator('.statistics-tester').filter({ hasText: 'Radu Test' }).locator('[data-statistics-member]').first();
  const memberDetailExists = await memberToggle.count();
  if (memberDetailExists) await memberToggle.click();
  const memberProfileRoute = page.url().includes('#tester-profile-');
  const memberDetail = await page.evaluate(() => ({
    name: document.querySelector('.tester-profile-view > .panel-head h2')?.textContent.trim(),
    tests: [...document.querySelectorAll('.tester-profile-view .profile-test-history .statistics-test-count > span')].map(label => label.textContent.trim()),
    counts: [...document.querySelectorAll('.tester-profile-view .profile-test-history .statistics-test-count > strong')].map(count => count.textContent.trim())
  }));
  await page.click('#back-to-testers');
  const returnedToStatistics = await page.locator('.statistics-view').count() === 1;
  const resultCountState = await page.evaluate(async () => {
    const discordId = '5';
    const testName = 'Test SMULS';
    const previousCount = testRunCounts[discordId]?.[testName];
    const previousUser = currentUser;
    const previousFetch = window.fetch;
    const initialCount = Number(previousCount) || 0;
    try {
      window.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
      currentUser = { ...currentUser, discordId };
      await recordTestRun(testName, 'Respins');
      await recordTestRun(testName, 'Admis');
      return { attempts: ['Respins', 'Admis'], increase: (testRunCounts[discordId]?.[testName] || 0) - initialCount };
    } finally {
      window.fetch = previousFetch;
      currentUser = previousUser;
      if (testRunCounts[discordId]) {
        if (previousCount === undefined) delete testRunCounts[discordId][testName];
        else testRunCounts[discordId][testName] = previousCount;
        if (!Object.keys(testRunCounts[discordId]).length) delete testRunCounts[discordId];
      }
      renderDashboardData();
    }
  });

  await page.click('#available-tests-toggle');
  const availableTestsState = await page.evaluate(() => ({
    expanded: document.querySelector('#available-tests-toggle')?.getAttribute('aria-expanded') === 'true',
    visible: !document.querySelector('#available-tests-submenu')?.hidden,
    tests: [...document.querySelectorAll('#available-tests-submenu [data-available-test]')].map(button => button.textContent.trim())
  }));
  await page.click('[data-available-test="Test ALS"]');
  const selectedTestState = {
    guide: await page.locator('.view-panel h2').textContent(),
    accessButton: await page.locator('[data-test-access]').textContent()
  };
  await page.click('[data-test-access]');
  selectedTestState.accessListVisible = await page.locator('.test-access-list').isVisible();
  await page.click('#back-to-tests');
  await page.waitForTimeout(150);
  selectedTestState.returnedToProfile = await page.locator('#overview-view').isVisible();

  await page.click('[data-view="testers"]');
  const memberProfileMenuCount = await page.locator('[data-member-profile]').count();
  await page.locator('[data-member-profile]').first().click();
  const testerProfileRoute = page.url().includes('#tester-profile-');
  const testerProfileState = await page.evaluate(() => ({
    title: document.querySelector('.tester-profile-view > .panel-head h2')?.textContent.trim(),
    callsign: document.querySelector('.tester-profile-view .profile-details dd')?.textContent.trim(),
    departmentName: document.querySelectorAll('.tester-profile-view .profile-details dd')[1]?.textContent.trim(),
    rank: document.querySelectorAll('.tester-profile-view .profile-details dd')[2]?.textContent.trim(),
    badges: [...document.querySelectorAll('.tester-profile-view .profile-test-tags .tag')].map(tag => tag.textContent.trim())
  }));
  await page.click('#back-to-testers');
  const testerViewCopy = await page.locator('.view-panel').innerText();
  const subtitleRemoved = !testerViewCopy.includes('Aceiași testeri ca pe dashboard, grupați pe grade.');
  await page.click('[data-view="overview"]');
  const ownProfilePreserved = await page.locator('#profile-name').textContent() === initialState.profileName;
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

  return { errs, initialState, adminAddOpens, adminRemoveOpens, adminSettingsOpens, statisticsState, memberProfileRoute, memberDetail, returnedToStatistics, availableTestsState, selectedTestState, memberProfileMenuCount, testerProfileRoute, testerProfileState, subtitleRemoved, ownProfilePreserved, docsGrantSelected, removeState, resultCountState };
}
