# Site-Testeri-Medici

## Discord admission notifications

Configure these server-side environment variables in the deployment settings:

- `DISCORD_ADMISSION_WEBHOOK`: webhook for admission and transfer results; it mentions only the tester.
- `DISCORD_TESTERS_WEBHOOK`: webhook for the testers channel; it receives the result, verdict-dependent role mentions, and the ID, medical-sheet, and drug-test images in order.
- `DISCORD_MEDICAL_CERTIFICATES_WEBHOOK`: webhook for medical certificates; it receives the formatted certificate and ID/medical-sheet thumbnails.
- `DISCORD_ALS_WEBHOOK`: webhook for ALS results with tester, candidate, callsign, and verdict.
- `DISCORD_PILOT_WEBHOOK`, `DISCORD_SMULS_WEBHOOK`, `DISCORD_MOTO_WEBHOOK`, and `DISCORD_PARASUTIST_WEBHOOK`: webhooks for the matching test results, each with tester, candidate, callsign, and verdict.

For local use, add newly generated webhook URLs to the ignored `.env` file (see `.env.example`). `npm start` loads that file. The checked-in example intentionally contains no credentials.

Never put webhook URLs in browser code or commit them to the repository. Rotate any webhook URL that has been shared in chat or other public places. The admission page accepts all three images by file selection or clipboard paste. Images are resized in the browser and are not stored in the test-history sheet; CNP is not sent as separate message text. Role mentions are posted separately below the admission-result embed.

The admission flow allows three mistakes; the fourth is a failure. Admission and transfer results use the same candidate form and three images. Both the local auth cache and server session last 24 hours. The tester webhook receives small clickable thumbnails for the ID, medical sheet, and drug-test, in that order. The configured Discord users are mentioned only in the testers webhook; the admission webhook mentions only the tester.

Medical certificates use a separate `MEDICAL_CERTIFICATES` sheet and `DISCORD_MEDICAL_CERTIFICATES_WEBHOOK`. The sequence starts at 7015 (7014 is the last existing number) and stops at 30000.

The local `tests/dev-server.mjs` is a UI mock and intentionally does not send Discord messages. Real delivery requires the deployed API endpoint and both webhook environment variables to be configured.