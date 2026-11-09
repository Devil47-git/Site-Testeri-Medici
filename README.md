# Site-Testeri-Medici

## Attendance records

Weekly attendance on member profiles and the activity page is read directly from the `TOTAL/ZI` columns in the `EVIDENTA ACTIVITATE` sheet. The site matches rows by callsign, detects weekly columns from the sheet headers, preserves each cell as text, and fetches fresh values whenever the profile or activity page is opened; the sheet remains the source of truth for these weekly values. Every signed-in member can view their own weekly values and live attendance history; members with callsigns 001–650 can view department-wide activity and live attendance records. Every member can start and stop their own regular attendance timer, and members with an H.R. function can also use the H.R. timer. Validation, cancellation, editing, and document synchronization remain restricted to leadership and members assigned an H.R. function in column K; validating, canceling, or editing an entry updates its Redis record only, while Google Sheets is updated only when an authorized user selects the document sync action. The sync action writes the recorded daily totals to columns F–L (Monday–Sunday) in `EVIDENTA ACTIVITATE`; blank cells are populated, cells ending in `+` add the daily total, cells ending in `*` multiply it, and other existing values are left unchanged. Successful document synchronization posts the attendance update and daily champion to the hospital Discord chat using `DISCORD_HOSPITAL_CHAT_WEBHOOK`. Cancellation requires a reason, and Discord notifications include only the reviewer/member mentions, the duration of the affected entry, and the cancellation reason when applicable. Names must match between column D in `TEST PONTAJE` and column D in `EVIDENTA ACTIVITATE`. Sheet writes require the configured Google Sheets service account to have edit access to the spreadsheet. Weekly `TOTAL/ZI` values are still read-only on the site. `GOOGLE_ATTENDANCE_RANGE` can override the default `'EVIDENTA ACTIVITATE'!A1:U400` range; `GOOGLE_TEST_PONTAJE_RANGE` can override the default `'TEST PONTAJE'!D1:D400` name lookup range.

The profile's day-by-day chart, the live start/stop timer on `Pontaje`, and the Monday–Sunday daily table on `Evidență activitate` use Supabase storage. The activity table shows each member's daily total and minimum: 120 minutes for Brancardier, Asistent-Medical, and Medic-Stagiar; 100 for Medic-Rezident; 80 for Medic-Specialist and Medic-Primar; and 60 for leadership callsigns 004–020. Members with callsigns 001–650 can view active timers; only leadership and H.R. can review, edit, or cancel them. New timers cannot be opened at or after 23:35 (Europe/Bucharest); running timers close at Bucharest midnight. Configure `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` for online persistence and shared updates across devices.

## Guide editing and member-function overrides

The hospital guide can be edited in place by leadership callsigns 001–020. Edits are saved by section in Supabase and sanitized before being shown to members; the original bundled guide remains the fallback for sections without saved changes. If Supabase is temporarily unavailable, the bundled guide still loads and shows a warning; saved edits cannot be read or changed until Supabase is available again. The guide disables ordinary text selection, copy shortcuts, and the context menu as a deterrent, but browser inspection, screenshots, and other extraction methods cannot be fully prevented. The Uniforme and Ghid Jaf tabs remain interactive in the embedded guide. The sanitizer requires Node.js 22.12 or newer.

Member functions from Docs are the default. When leadership saves a member's function assignments in the Members page, that assignment is stored separately in Supabase and takes precedence over later Docs changes; the tester roster and access list refresh immediately. Members with callsigns 100–299 automatically receive the Tester bundle (admission, transfer, and medical certificate), except leadership. Use **Revino la funcțiile din Docs** in the editor to remove the override for that member. Saving guide edits and member-function overrides requires configured Supabase server credentials.

## Supabase storage and migration

The application stores its Redis-compatible records in the private `public.app_kv` table. Before deploying the Supabase-backed code, run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor. The table has RLS enabled, no client policies, and server RPC access restricted to `service_role`.

Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as Vercel server environment variables (and in the ignored local `.env` for local work). Use the Supabase project's URL and its server secret key; never put the secret key in browser code or commit it.

To migrate the current application keys, first pause writes to the site, then create a private local backup and import it:

1. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` locally, then run `node scripts/migrate-upstash-to-supabase.js export upstash-backup.json`.
2. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` locally, review the backup file, then run `node scripts/migrate-upstash-to-supabase.js import upstash-backup.json --apply`.
3. Check that the import count matches the backup's key count. Existing Supabase keys are intentionally left untouched so a repeated import cannot overwrite newer application writes.
4. Configure the Supabase variables in Vercel, deploy, and verify attendance, guide edits, member-function overrides, avatars, and bonus history before resuming writes.
5. Keep Upstash and the private export until production verification and rollback are complete. Then remove Upstash variables from Vercel and securely delete the local export.

The migration exports only the application's known Redis key patterns. It preserves Redis strings, hashes, sets, and unexpired key TTLs. Google Sheets data and browser `localStorage` are not part of this migration.

Vercel schedules the midnight closure at 21:00 and 22:00 UTC to cover Romania's daylight-saving and standard-time offsets. Set a `CRON_SECRET` deployment variable so the scheduled closure endpoint accepts authenticated Vercel Cron requests. Reads and timer actions also close any stale timer if the scheduled request was delayed.

## Discord admission notifications

Configure the server using one server-side deployment variable: `APP_CONFIG_JSON`. Its value is a JSON object containing the settings below; `.env.example` has a copyable template. Keep it in Vercel or the ignored local `.env` file, never in browser code or Git.

- `DISCORD_ADMISSION_WEBHOOK`: webhook for admission and transfer results; it mentions only the tester.
- `DISCORD_TESTERS_WEBHOOK`: webhook for the testers channel; it receives the result, verdict-dependent role mentions, and the ID, medical-sheet, and drug-test images in order.
- `DISCORD_MEDICAL_CERTIFICATES_WEBHOOK`: webhook for medical certificates; it receives the full-width certificate text followed by the ID and medical-sheet images in one message.
- `DISCORD_ALS_WEBHOOK`: webhook for ALS results with tester, candidate, callsign, and verdict.
- `DISCORD_PILOT_WEBHOOK`, `DISCORD_SMULS_WEBHOOK`, `DISCORD_MOTO_WEBHOOK`, and `DISCORD_PARASUTIST_WEBHOOK`: webhooks for the matching test results, each with tester, candidate, callsign, and verdict.
- `DISCORD_ATTENDANCE_REVIEW_WEBHOOK`: webhook for attendance review, cancellation, and edit events.
- `DISCORD_HOSPITAL_CHAT_WEBHOOK`: webhook for the hospital chat message sent after attendance totals are synchronized to `EVIDENTA ACTIVITATE`.
- The same JSON object also accepts `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `APP_ORIGIN`, `GOOGLE_API_KEY`, `GOOGLE_SHEETS_ID`, `GOOGLE_SHEETS_RANGE`, `GOOGLE_ATTENDANCE_RANGE`, `GOOGLE_TEST_PONTAJE_RANGE`, `GOOGLE_GRANTS_RANGE`, `GOOGLE_AVATAR_RANGE`, `GOOGLE_TEST_RESULTS_RANGE`, `GOOGLE_TEST_LIFETIME_RANGE`, `GOOGLE_MEDICAL_CERTIFICATES_RANGE`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_RANGE`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, and `PORT`.

During migration, a non-empty value in `APP_CONFIG_JSON` takes precedence over the matching individual environment variable. Missing or empty JSON values fall back to existing individual variables. Move the current values into `APP_CONFIG_JSON`, deploy and verify, then remove the individual Vercel variables. `GOOGLE_SERVICE_ACCOUNT_JSON` may be entered as a nested JSON object; the server serializes it for Google authentication.

Revoking a tester function from the site saves an explicit grant override to the configured `GOOGLE_GRANTS_RANGE` sheet. This keeps the function revoked even while the member's original functions remain listed in the department sheet.

For local use, add newly generated webhook URLs to the ignored `.env` file (see `.env.example`). `npm start` loads that file. The checked-in example intentionally contains no credentials.

Never put webhook URLs in browser code or commit them to the repository. Rotate any webhook URL that has been shared in chat or other public places. The admission page accepts all three images by file selection or clipboard paste. Form fields and resized photos are saved locally per tester and test, so switching tests does not discard an unfinished admission. Images are not stored in the test-history sheet; CNP is not sent as separate message text. In the testers-channel message, each image is aligned beside its related details, and role mentions appear outside the bordered result container.

The admission flow allows three mistakes; the fourth is a failure. Admission and transfer results use the same candidate form and three images. Both the local auth cache and server session last 24 hours. The testers webhook sends one message with the ID, medical sheet, and drug-test thumbnails aligned beside their related text. The configured Discord users are mentioned only in the testers webhook; the admission webhook mentions only the tester.

Medical certificates use a separate `MEDICAL_CERTIFICATES` sheet and `DISCORD_MEDICAL_CERTIFICATES_WEBHOOK`. The sequence starts at 7024 and stops at 30000. Change `MEDICAL_CERTIFICATE_START_NUMBER` in `api/access/test-results.js` to set a different starting number.

The leadership reset clears both current test counts and processed-test totals for all testers.

The `Membri` room lists every named member from `LISTA DEPARTAMENT`, including the entry date from column A and the Discord avatar. Its function options are built from the distinct values in column K and refresh whenever the room is opened. Callsigns 001–020 can assign or remove those functions, and can add a new function for a member; each save writes that member's function list directly to column K. A function removed from every member's column K entry disappears from the site's options. The configured service account needs edit access to the spreadsheet, and the sheet must be publicly readable through the configured Google API key, like the department list. HR and PR attendance permissions are also read from column K.

## Cooldowns and bonuses

Admission and transfer retain their prerequisite checklist. Medical certificates use the Apt/Inapt selector; their hours start blank and their questions do not have a mistake counter.

The `Cooldownuri preluate` page generates a copyable Discord message for a payer with any department callsign. Enter only the numeric callsign; the `M-` prefix is supplied automatically. The page looks up the member's name, rank, and Discord ID from the department directory, then calculates the amount from the selected test and number of days: Radio 25,000/day (up to 3 days), BLS/ALS 30,000/day (up to 3 days), SMULS/Pilot/Parasutist 30,000/day, Moto 25,000/day, and Rezidentiat 35,000/day; all other cooldowns allow up to 5 days. The selected test and days survive refreshes; the payer callsign is intentionally cleared, and the reset button clears the form. It only creates the message; the tester who accepts the cooldown must post it and record the cooldown manually.

Test pages save entered fields and answers per tester/test. Staged tests also reopen at the current practical stage after a refresh. Uploaded files are not stored in the browser and must be selected again after refreshing.

Specialty-test candidates are checked against column S in `LISTA DEPARTAMENT`. Supported entries include SMULS (including T/P), Parasutist, Moto, Pilot, ALS, BLS, Radio, and Rezidentiat aliases. A candidate can take the test starting at 00:00 on the written expiry date in `Europe/Bucharest`.

When a candidate is marked `Respins` on a specialty test, the result flow automatically appends that test's cooldown expiry to column S and includes the date in its Discord result notification. ALS uses 3 calendar days; SMULS, Moto, Pilot, and Parasutism use 5 calendar days. Passing a test does not add a cooldown.

The `Bonusuri` page is leadership-only. It shows the active 14-day period, anchored on 21 September 2026, plus a tester-callsign-sorted table of Pilot, Moto, combined admission/transfer, medical-certificate, ALS, and SMULS totals. Each row copies only those six tab-separated totals for pasting into the matching sheet columns.

The tester statistics list also includes lifetime `Teste Procesate` badges for each assigned test function. The API creates a separate `TEST_LIFETIME` sheet, imports existing `TEST_HISTORY` entries once, and appends each new result there. Resetting current test counts clears only `TEST_HISTORY`; lifetime totals remain intact.

Bonus entries are stored in Supabase. New test results continue to be written to `TEST_HISTORY`; bonus queries import existing rows into Supabase on demand, once per Bucharest calendar day. Without Supabase credentials, the bonus page continues reading from Google Sheets. The migration script reads the existing Redis keys from Upstash and imports them into Supabase.

The `Bonusuri` table is sorted by numeric callsign and shows only testers with tests during the selected period. Consecutive callsign blocks get their own copy button (for example, 101–103 and then 105+ if 104 has no tests); alternatively, select any rows and use `Copiază selectați`. Copies contain the six tab-separated bonus totals in numeric order, without testers who have no tests.

Create a free Redis database in Upstash, then add its REST URL and REST token as server-side environment variables in the deployment settings. For local development, add them to the ignored `.env` file. The blank names are included in `.env.example`; never commit actual credentials.

The local `tests/dev-server.mjs` is a UI mock and intentionally does not send Discord messages. Real delivery requires the deployed API endpoint and both webhook environment variables to be configured.