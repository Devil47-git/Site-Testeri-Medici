# Site-Testeri-Medici

## Discord admission notifications

Configure these server-side environment variables in the deployment settings:

- `DISCORD_ADMISSION_WEBHOOK`: webhook for the admission result log.
- `DISCORD_TESTERS_WEBHOOK`: webhook for the testers channel; this receives the same result and the consented ID photo.

Never put webhook URLs in browser code or commit them to the repository. Rotate any webhook URL that has been shared in chat or other public places. The admission form requires candidate consent before sending the ID image. The image is resized in the browser and is not stored in the test-history sheet; CNP is not sent as separate message text.

The local `tests/dev-server.mjs` is a UI mock and intentionally does not send Discord messages. Real delivery requires the deployed API endpoint and both webhook environment variables to be configured.