# Reading practice — client-only app

This folder is a complete static website for GitHub Pages. Parsing, practice, and progress storage run entirely in the browser. No application server, database, build step, Node.js installation, or platform account is required to use it. Google Drive backup communicates directly with Google.

## Publish on GitHub Pages

1. Create a separate GitHub repository, for example `reading-practice`.
2. Upload the **contents** of this folder to its root, with `index.html` at the root. Include `assets/`, all root `.js` and `.css` files, and `.nojekyll`. Tests are optional and are not needed to run the app.
3. In **Settings → Pages**, select **Deploy from a branch**, choose your branch (usually `main`), and select **/ (root)**. Save.
4. Open the URL GitHub provides, typically `https://YOUR-USERNAME.github.io/reading-practice/`.

Assets use relative paths, so repository subpaths work. Publish only this standalone app in its own repository; the vocabulary platform and its configuration are not needed.

See [GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Practice and storage

Paste text → parse units → adjust, split, merge, or exclude units → confirm → passage view. Select a unit for clause analysis, role selection, Chinese translation, and completion. Parsing is local and requires no AI API key.

Progress is saved in browser local storage. Save clause dialogs with Save draft or Mark as resolved before leaving. Export backups regularly; clearing browser storage removes progress. Changing browsers or moving from localhost to GitHub Pages requires exporting and restoring a backup. Imports add copies and keep existing practices.

Opening `index.html` directly is possible for preview, but local-file browser storage behavior varies and Google OAuth requires a hosted origin. GitHub Pages over HTTPS is the supported deployment.

## Personal Google Drive

Your supplied public OAuth client ID is already configured in `config.js`. The app uses this ID automatically; users only sign in to Google. To deploy with a different OAuth app, edit config.js. No API key or client secret is needed.

1. Enable the Google Drive API in the client's Google Cloud project and configure OAuth consent. For an app in testing, add the intended accounts as test users.
2. In the OAuth Web application's **Authorized JavaScript origins**, add `https://YOUR-USERNAME.github.io` using your actual username. Do **not** include `/reading-practice/` or another path. For a custom domain, add its HTTPS origin instead.
3. Open the hosted app and choose Backup & restore → Back up to Google Drive. Sign in to your personal account.
4. Choose Find Drive backups to see each snapshot’s practice titles and completed-unit counts before restoring it as new copies. This also works for older backups with timestamp-only filenames.

Uses Google Identity Services and only the `drive.appdata` scope. Backups live in Drive's hidden app-data folder, accessible through this OAuth app. Use the same client ID on other devices. Backups are manual snapshots, not automatic sync. Downloaded JSON and Drive backup names include the first practice title, a count of additional practices, and a timestamp. All practices are still included in each snapshot; existing backups remain restorable. Access tokens remain in memory and expire. JSON export/import works without Google configuration or internet.

References: [Browser token flow](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [OAuth origin requirements](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow), [Drive app data](https://developers.google.com/workspace/drive/api/guides/appdata).

## Development checks

All runtime files are independent copies in this folder. There are no parent-folder imports, platform APIs, `.env`, or database connections. Database mode is **none** (browser storage only).

Only developers running tests need Node.js 20+ and Playwright with Chrome. Run `node tests/smoke.cjs`. Tests intercept static file requests at a simulated GitHub Pages repository URL without starting an application server. They cover parsing, passage navigation, sentence completion, reload/resume, JSON restore, and simulated Drive upload/list/restore. Real Google OAuth consent must be verified on the published domain.

Drive backups can be permanently deleted individually with Delete backup, or in batches using the checkboxes (including Select all backups) and Delete selected. Confirm the selection before deletion. Local practices are kept; failed deletions remain listed for retry.

Textbook cleanup is enabled when parsing new passages: attached vocabulary numbers (paralyzed12 → paralyzed), asterisks, and extra whitespace are removed from practice units. Common numbered terms such as COVID19, CO2, B12, MP3, and HTML5 are preserved, as are standalone numbers and mixed identifiers such as H2O and GPT-4. Review the editable preview for uncommon numbered terms, or turn off Clean textbook markers before parsing. The original passage and existing practices are unchanged.
