export default async function run(page, ui) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('http://localhost:4321/?dev=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => ({
    shellReady: document.querySelector('#app-shell')?.className,
    groups: [...document.querySelectorAll('#tester-groups .tester-group')].map(g => ({
      title: g.querySelector('h3')?.textContent,
      headers: [...g.querySelectorAll('th')].map(th => th.textContent),
      names: [...g.querySelectorAll('td:first-child')].map(td => td.textContent.trim()),
      avatars: g.querySelectorAll('img.avatar, .avatar img').length
    })),
    removeBtnVisible: !document.querySelector('#remove-btn')?.hidden,
    addBtnVisible: !document.querySelector('#add-btn')?.hidden
  }));

  await page.click('#filter-btn');
  await page.waitForTimeout(300);
  const filterState = await page.evaluate(() => ({
    open: !document.querySelector('#test-filter-menu')?.hidden,
    options: [...document.querySelectorAll('[data-test-filter]')].map(o => o.textContent.trim())
  }));
  await page.click('#filter-btn');

  await page.click('#remove-btn');
  await page.waitForTimeout(300);
  const removeState = await page.evaluate(() => ({
    open: document.querySelector('#remove-modal')?.classList.contains('open'),
    title: document.querySelector('#remove-modal h2')?.textContent
  }));
  await page.click('#close-remove-modal');

  return { errs, state, filterState, removeState };
}
