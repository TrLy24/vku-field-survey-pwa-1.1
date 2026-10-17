# VKU Field Survey PWA

An offline-first, installable field survey for recording VKU students' employment needs. The app works without a network after its first secure load, stores drafts, survey sessions, and compressed field photos in the device's IndexedDB, and sends one spreadsheet row per saved session when a Google Apps Script Web App is configured.

## Features

- Vietnamese, responsive interview form with interviewer/respondent, interview date and time, job preferences, skills, challenges, and support needs.
- Browser geolocation with an explicit permission action; location is optional and never requested in the background.
- Camera/photo picker; JPEG-compressed photos are kept in IndexedDB until the survey is synchronized.
- Multiple independent sessions, autosaved drafts, pending/synced status, retry controls, and an on-screen success/error notification.
- Service worker caches the application shell. Survey data and images are stored separately in IndexedDB, not in the service-worker cache.
- Apps Script writes one row per session and stores an optional image in the script owner's Google Drive. A repeated request ID is idempotent.

## Run locally

Service workers, camera access, and geolocation require a secure context. Use `localhost` for development rather than opening `index.html` directly.

```sh
npx serve .
```

Open the local HTTPS/localhost address in a supported browser. No build step, third-party runtime dependency, or external font request is required.

## Connect Google Sheets

1. Create a dedicated Google spreadsheet. The script creates a `Surveys` tab and its header row.
2. Open **Extensions → Apps Script**, replace the editor contents with [`google-apps-script/Code.gs`](./google-apps-script/Code.gs), and save.
3. In Apps Script, select `setupSpreadsheet` and click **Run** while the project is opened from the destination spreadsheet. Approve the requested Sheets and Drive permissions. This saves the destination spreadsheet ID in Script Properties so Web App requests do not depend on an active spreadsheet.
4. Deploy or update the deployment as a **Web app**. Set **Execute as** to your account and access to **Anyone** (or the narrowest access setting supported by your deployment). For an existing deployment, choose **Deploy → Manage deployments → Edit → New version → Deploy**; saving the editor code alone does not update a deployed version.
5. Copy the deployed HTTPS URL ending in `/exec`. Open it in a browser: it should display **VKU Survey Sync đang hoạt động**. If it reports that the endpoint is not configured, run `setupSpreadsheet` and deploy a new version. In the PWA, paste the URL under **Kết nối Google Sheets** and save.
6. Submit a sample survey and check the `Surveys` tab (not the default `Sheet1`). A successful acknowledgement changes the local status to **Đã đồng bộ**. Failed uploads stay in IndexedDB and can be retried.
7. To make the results sheet public as requested, share the spreadsheet with **Anyone with the link → Viewer**. Keep the survey anonymous and do not put sensitive personal information in a publicly readable sheet.

The app sends a normal HTML form POST to the Apps Script Web App, and the response acknowledges the matching request through `postMessage`; this avoids relying on cross-origin `fetch` access. Only a matching success response marks a session synced. The Apps Script checks survey IDs to avoid duplicate rows when a response is lost and the device retries. Opening the Web App URL provides a basic endpoint and spreadsheet-configuration check.

### Public sheet and photo privacy

The Web App endpoint must accept anonymous requests for public hosting without user sign-in. Anyone who discovers that URL can submit data, so use a dedicated spreadsheet, review submissions, and do not collect sensitive personal data. If you need confidential responses, restrict access and add an authenticated backend before deployment. Public spreadsheet viewer access also exposes every row; Apps Script stores photos in the spreadsheet owner's Drive with its normal access controls and does not make them public automatically.

## Deploy the PWA

This is a static site; publish the project root to Cloudflare Pages (direct upload or Git integration) or Vercel. No build command is required; set the output/root directory to the repository root. HTTPS is required for installation, camera, and geolocation outside localhost.

To publish a public GitHub repository, create an empty repository in your GitHub account, then add it as a remote and push this project. The current workspace may not have Git initialized or authenticated and cannot create your account's public repository or deploy account-bound hosting on your behalf.

## Offline and browser storage

The application shell is cached after its first online visit. IndexedDB is local to the browser profile and device: clearing site data, uninstalling the browser, or losing the device can erase unsynchronized surveys. Keep the browser's site storage enabled and synchronize pending sessions when a connection becomes available. Background sync is attempted on the browser's `online` event and at app startup; the user can also press **Đồng bộ ngay**. Browser support and permissions govern geolocation and camera access.
