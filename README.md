# Site-Testeri-Medici

## Discord admission notifications

Configure the server using one server-side deployment variable: `APP_CONFIG_JSON`. Its value is a JSON object containing the settings below; `.env.example` has a copyable template. Keep it in Vercel or the ignored local `.env` file, never in browser code or Git.

- `DISCORD_ADMISSION_WEBHOOK`: webhook for admission and transfer results; it mentions only the tester.
- `DISCORD_TESTERS_WEBHOOK`: webhook for the testers channel; it receives the result, verdict-dependent role mentions, and the ID, medical-sheet, and drug-test images in order.
- `DISCORD_MEDICAL_CERTIFICATES_WEBHOOK`: webhook for medical certificates; it receives the full-width certificate text followed by the ID and medical-sheet images in one message.
- `DISCORD_ALS_WEBHOOK`: webhook for ALS results with tester, candidate, callsign, and verdict.
- `DISCORD_PILOT_WEBHOOK`, `DISCORD_SMULS_WEBHOOK`, `DISCORD_MOTO_WEBHOOK`, and `DISCORD_PARASUTIST_WEBHOOK`: webhooks for the matching test results, each with tester, candidate, callsign, and verdict.
- The same JSON object also accepts `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `APP_ORIGIN`, `GOOGLE_API_KEY`, `GOOGLE_SHEETS_ID`, `GOOGLE_SHEETS_RANGE`, `GOOGLE_GRANTS_RANGE`, `GOOGLE_AVATAR_RANGE`, `GOOGLE_TEST_RESULTS_RANGE`, `GOOGLE_TEST_LIFETIME_RANGE`, `GOOGLE_MEDICAL_CERTIFICATES_RANGE`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_RANGE`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `PORT`.

During migration, a non-empty value in `APP_CONFIG_JSON` takes precedence over the matching individual environment variable. Missing or empty JSON values fall back to existing individual variables. Move the current values into `APP_CONFIG_JSON`, deploy and verify, then remove the individual Vercel variables. `GOOGLE_SERVICE_ACCOUNT_JSON` may be entered as a nested JSON object; the server serializes it for Google authentication.

Revoking a tester function from the site saves an explicit grant override to the configured `GOOGLE_GRANTS_RANGE` sheet. This keeps the function revoked even while the member's original functions remain listed in the department sheet.

For local use, add newly generated webhook URLs to the ignored `.env` file (see `.env.example`). `npm start` loads that file. The checked-in example intentionally contains no credentials.

Never put webhook URLs in browser code or commit them to the repository. Rotate any webhook URL that has been shared in chat or other public places. The admission page accepts all three images by file selection or clipboard paste. Images are resized in the browser and are not stored in the test-history sheet; CNP is not sent as separate message text. Role mentions are posted separately below the admission-result embed.

The admission flow allows three mistakes; the fourth is a failure. Admission and transfer results use the same candidate form and three images. Both the local auth cache and server session last 24 hours. The testers webhook sends one message with the ID, medical sheet, and drug-test thumbnails aligned beside their related text. The configured Discord users are mentioned only in the testers webhook; the admission webhook mentions only the tester.

Medical certificates use a separate `MEDICAL_CERTIFICATES` sheet and `DISCORD_MEDICAL_CERTIFICATES_WEBHOOK`. The sequence starts at 7015 (7014 is the last existing number) and stops at 30000.

## Cooldowns and bonuses

Admission and transfer retain their prerequisite checklist. Medical certificates use the Apt/Inapt selector; their hours start blank and their questions do not have a mistake counter.

The `Cooldownuri preluate` page generates a copyable Discord message for a payer with any department callsign. Enter only the numeric callsign; the `M-` prefix is supplied automatically. The page looks up the member's name, rank, and Discord ID from the department directory, then calculates the amount from the selected test and number of days: Radio 25,000/day (up to 3 days), BLS/ALS 30,000/day (up to 3 days), SMULS/Pilot/Parasutist 30,000/day, Moto 25,000/day, and Rezidentiat 35,000/day; all other cooldowns allow up to 5 days. The selected test and days survive refreshes; the payer callsign is intentionally cleared, and the reset button clears the form. It only creates the message; the tester who accepts the cooldown must post it and record the cooldown manually.

Test pages save entered fields and answers per tester/test. Staged tests also reopen at the current practical stage after a refresh. Uploaded files are not stored in the browser and must be selected again after refreshing.

Specialty-test candidates are checked against column S in `LISTA DEPARTAMENT`. Supported entries include SMULS (including T/P), Parasutist, Moto, Pilot, ALS, BLS, Radio, and Rezidentiat aliases. A candidate can take the test starting at 00:00 on the written expiry date in `Europe/Bucharest`.

The `Bonusuri` page is leadership-only. It shows the active 14-day period, anchored on 21 September 2026, plus a tester-callsign-sorted table of Pilot, Moto, combined admission/transfer, medical-certificate, ALS, and SMULS totals. Each row copies only those six tab-separated totals for pasting into the matching sheet columns.

The tester statistics list also includes lifetime `Teste Procesate` badges for each assigned test function. The API creates a separate `TEST_LIFETIME` sheet, imports existing `TEST_HISTORY` entries once, and appends each new result there. Resetting current test counts clears only `TEST_HISTORY`; lifetime totals remain intact.

Bonus entries are stored in Upstash Redis when both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured. New test results continue to be written to `TEST_HISTORY`; bonus queries import existing rows into Redis on demand, once per Bucharest calendar day. Without both Upstash variables, the bonus page continues reading from Google Sheets. The reusable Redis client is in `api/storage/upstash-redis.js`; application keys use the `site-testeri-medici:` namespace.

The `Bonusuri` table is sorted by numeric callsign and shows only testers with tests during the selected period. Consecutive callsign blocks get their own copy button (for example, 101–103 and then 105+ if 104 has no tests); alternatively, select any rows and use `Copiază selectați`. Copies contain the six tab-separated bonus totals in numeric order, without testers who have no tests.

Create a free Redis database in Upstash, then add its REST URL and REST token as server-side environment variables in the deployment settings. For local development, add them to the ignored `.env` file. The blank names are included in `.env.example`; never commit actual credentials.

The local `tests/dev-server.mjs` is a UI mock and intentionally does not send Discord messages. Real delivery requires the deployed API endpoint and both webhook environment variables to be configured.