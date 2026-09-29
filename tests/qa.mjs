export default async function run(page, ui) {
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => errs.push(m.type() + ': ' + m.text()));
  page.on('requestfailed', r => errs.push('reqfail: ' + r.url() + ' ' + r.failure()?.errorText));
  page.on('response', r => { if (r.status() >= 400) errs.push('http' + r.status() + ': ' + r.url()); });
  await page.goto('http://localhost:4123/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const before = await ui.snapshot();
  const ref = before.match(/@(e\d+) button "Continuă cu Discord[^"]*"/)?.[1];
  let clicked = null;
  if (ref) {
    await Promise.all([
      page.waitForNavigation({ timeout: 8000 }).catch(() => {}),
      ui.click(ref)
    ]);
    clicked = page.url();
  }
  const state = await page.evaluate(() => ({
    authErr: document.querySelector('#auth-error')?.textContent,
    shell: document.querySelector('#app-shell')?.className,
    authVisible: getComputedStyle(document.querySelector('.auth-card, #auth-screen, .auth') || document.body).display
  }));
  return { errs, ref, clicked, state };
}
