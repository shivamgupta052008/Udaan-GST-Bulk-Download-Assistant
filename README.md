# Udaan GST Bulk Download Assistant — Milestone 1

> **Milestone 1 Foundation**: A clean, standalone Manifest V3 Chrome/Chromium extension foundation for GST portal detection, sequential download queue management, and Chrome downloads monitoring.

---

## 1. Overview & Objective

The **Udaan GST Bulk Download Assistant** is a purpose-built browser extension designed to assist Indian business owners, tax practitioners, and chartered accountants in managing bulk GST return downloads from the official Government of India Goods & Services Tax (GST) Portal.

**Milestone 1 Scope**:
- Establishes a rock-solid, production-grade Manifest V3 Chrome Extension architecture.
- Real-time GST Portal & Returns Dashboard detection without sensitive credential capture.
- Sequential, single-active-job queue execution engine with state machine (`PENDING` → `NAVIGATING` → `PAGE_READY` → `WAITING_FOR_DOWNLOAD` → `DOWNLOADED`).
- Real-time download monitoring via `chrome.downloads` events with safe job-association.
- Pause, Resume, Retry (max 3 attempts), and Persistent Storage (`chrome.storage.local`).
- Zero backend dependencies, zero paid APIs, zero credential harvesting.

---

## 2. Security & Compliance Model

1. **Zero Credential Capture & Storage**:
   The extension strictly **NEVER** asks for, reads, transmits, or stores GST usernames, passwords, or OTPs.
2. **No CAPTCHA / MFA Automation**:
   The extension never attempts to bypass government security controls. If authentication is needed, it instructs the user to complete it manually.
3. **Restricted Host Permissions**:
   Scoped strictly to official GST Portal domains (`*://services.gst.gov.in/*`, `*://*.gst.gov.in/*`).
4. **100% Local Execution**:
   All state is persisted purely locally via `chrome.storage.local`. No external servers, analytics, or cloud APIs are contacted.

---

## 3. Architecture & Project Structure

```
gst-bulk-download-extension/
├── manifest.json                  # Manifest V3 configuration
├── package.json                   # Build & dependencies manifest
├── tsconfig.json                  # TypeScript strict compiler config
├── README.md                      # Comprehensive documentation
├── public/                        # Static extension assets & manifest
│   ├── manifest.json
│   └── icons/
├── src/
│   ├── background/
│   │   └── serviceWorker.ts       # Manifest V3 background service worker
│   ├── content/
│   │   └── gstPortalDetector.ts   # Content script for page classification
│   ├── popup/
│   │   ├── popup.html             # Extension popup HTML entry
│   │   ├── popup.ts               # Extension popup TypeScript entry
│   │   ├── popup.css              # Popup styling
│   │   └── PopupView.tsx          # Clean React Popup UI
│   ├── queue/
│   │   ├── downloadQueue.ts       # Sequential queue execution manager
│   │   ├── queueStore.ts          # Queue persistence and CRUD store
│   │   └── queueTypes.ts          # State machine and job interfaces
│   ├── downloads/
│   │   └── downloadMonitor.ts     # chrome.downloads listener & job association
│   ├── gst/
│   │   ├── portalDetector.ts      # Pure URL & DOM page classifier
│   │   └── returnTypes.ts         # Return types & adapter interface
│   ├── adapters/                  # Future return adapters (Milestone 2)
│   │   ├── gstr1Adapter.ts
│   │   ├── gstr2aAdapter.ts
│   │   ├── gstr2bAdapter.ts
│   │   └── gstr3bAdapter.ts
│   ├── bridge/
│   │   └── udaanBridge.ts         # Future Udaan Recon Pro bridge contract
│   ├── storage/
│   │   └── extensionStorage.ts    # Universal storage wrapper (Chrome / Local)
│   ├── messaging/
│   │   └── messages.ts            # Typed inter-component messaging protocol
│   ├── shared/
│   │   ├── constants.ts           # Domains, URLs, configuration
│   │   ├── logger.ts              # Redacted structured logger
│   │   └── utils.ts               # Utilities & helpers
│   ├── testing/
│   │   └── testSuite.ts           # 15-scenario automated verification suite
│   ├── App.tsx                    # Interactive Workbench & Simulator UI
│   └── main.tsx                   # Main React entry point
```

---

## 4. Permissions Breakdown

| Permission | Purpose & Justification |
| :--- | :--- |
| `storage` | Required for persisting the sequential download queue, retry counters, and application settings across popup close/reopen and service worker restarts. |
| `downloads` | Required for detecting when a GST return download is initiated, monitoring completion or interruption, and associating the download ID with the active queue job. |
| `tabs` | Required for querying the active tab URL to classify whether the user is on the GST Portal or Returns Dashboard. |
| `host_permissions` | Restricted strictly to `*://services.gst.gov.in/*` and `*://*.gst.gov.in/*` to run the content detector script only on the official GST portal. |

---

## 5. Build & Installation

### Build Commands
```bash
# Install dependencies
npm install

# Compile application & extension assets
npm run build
```

### Installation in Google Chrome (Developer Mode)
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable the **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the project `dist/` directory (or the extracted folder from the 1-Click ZIP export).
5. The **Udaan GST Bulk Download Assistant** icon will now appear in your browser toolbar!

---

## 6. Testing & Acceptance Criteria Verification

The workspace includes a built-in automated test suite executing **15 comprehensive tests**:
- **Zero Credential Security Verification**: Validates no sensitive fields exist in storage or data models.
- **Portal Status Classification**: Tests non-GST, login page, returns dashboard, and general services.
- **Queue Execution & State Machine**: Validates transitions (`PENDING` → `NAVIGATING` → `PAGE_READY` → `WAITING_FOR_DOWNLOAD` → `DOWNLOADED`).
- **Sequential Constraint**: Enforces strictly 1 active job at a time.
- **Download Association & Interruption**: Validates association with `chrome.downloads` and max 3 retry policy before setting `FAILED — Manual action required`.
- **Milestone 2 Return Adapters**: Validates placeholder safety returning `"Not implemented — Milestone 2"`.

---

## 7. Known Limitations (Milestone 1)

- **Milestone 1 does NOT automatically download live GSTR-1, GSTR-2A, GSTR-2B, or GSTR-3B returns.**
- It establishes the verified extension infrastructure, portal detection, queue management, and download monitoring.
- Actual return-specific automation (DOM navigation & download triggering) is part of Milestone 2.

---

## 8. Milestone Roadmap

- **Milestone 1 (Completed)**: Extension foundation, portal detector, sequential queue engine, download monitor.
- **Milestone 2**: GSTR-1, GSTR-2A, GSTR-2B, and GSTR-3B portal automation adapters.
- **Milestone 3**: Udaan ↔ Extension local communication bridge.
- **Milestone 4**: Downloaded file classification and parsing.
- **Milestone 5**: Udaan import and IndexedDB synchronization.
- **Milestone 6**: Local Disk Auto-Sync (`GSTIN_CompanyName/FY/Return`).
- **Milestone 7**: Resume/retry/recovery engine and duplicate detection.
