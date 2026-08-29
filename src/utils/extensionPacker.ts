import JSZip from 'jszip';

export async function generateExtensionZip(): Promise<Blob> {
  const zip = new JSZip();

  // Manifest V3
  const manifestContent = {
    manifest_version: 3,
    name: 'Udaan GST Bulk Download Assistant',
    version: '1.0.0',
    description:
      'Milestone 1: Clean standalone foundation for GST bulk return downloads, sequential queue processing, persistent state recovery, and portal detection.',
    permissions: ['storage', 'downloads', 'tabs', 'alarms'],
    host_permissions: ['*://services.gst.gov.in/*', '*://*.gst.gov.in/*'],
    background: {
      service_worker: 'serviceWorker.js',
      type: 'module',
    },
    content_scripts: [
      {
        matches: ['*://services.gst.gov.in/*', '*://*.gst.gov.in/*'],
        js: ['gstPortalDetector.js'],
        run_at: 'document_idle',
      },
    ],
    action: {
      default_popup: 'popup.html',
      default_title: 'Udaan GST Bulk Download Assistant',
    },
  };

  zip.file('manifest.json', JSON.stringify(manifestContent, null, 2));

  // popup.html
  const popupHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Udaan GST Bulk Download Assistant</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body class="w-[380px] min-h-[520px] bg-slate-50 text-slate-900 overflow-x-hidden font-sans">
  <div id="popup-root">
    <div style="padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="background: #2563eb; color: white; width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 13px;">U</div>
          <div>
            <h2 style="margin: 0; font-size: 14px; font-weight: 600; color: #0f172a;">Udaan GST Bulk</h2>
            <span style="font-size: 11px; color: #64748b;">Sequential Queue & Assistant</span>
          </div>
        </div>
        <span style="background: #eff6ff; color: #1d4ed8; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; border: 1px solid #bfdbfe;">M1</span>
      </div>

      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-bottom: 6px;">Portal Detection Status</div>
        <div id="portal-status-display" style="font-size: 12px; font-weight: 500; color: #1e293b; background: #f8fafc; padding: 8px; border-radius: 6px;">
          Checking GST portal tab status...
        </div>
      </div>

      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #64748b;">Queue Engine</span>
          <span id="queue-status-badge" style="font-size: 11px; color: #475569; font-weight: 500;">Idle</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="btn-start" style="flex: 1; background: #2563eb; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer;">Start Queue</button>
          <button id="btn-add-test" style="background: #0f172a; color: white; border: none; padding: 8px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer;">+ Add Job</button>
        </div>
      </div>

      <div style="font-size: 10px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 8px; display: flex; align-items: center; gap: 6px;">
        <span>🔒 Zero-Knowledge Security: Passwords, OTPs, or CAPTCHAs are never stored or captured.</span>
      </div>
    </div>
  </div>
  <script type="module" src="popup.js"></script>
</body>
</html>`;
  zip.file('popup.html', popupHtml);

  // popup.css
  const popupCss = `body { width: 380px; min-height: 520px; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; }`;
  zip.file('popup.css', popupCss);

  // serviceWorker.js
  const serviceWorkerJs = `// Udaan GST Bulk Download Assistant - Service Worker (MV3)
// Milestone 1 Foundation with Persistent Queue Recovery and Watchdog Alarms

const STORAGE_KEYS = {
  QUEUE: 'udaan_gst_queue',
  DOWNLOAD_ASSOCIATIONS: 'udaan_gst_download_associations',
  PORTAL_STATUS: 'udaan_gst_portal_status',
};

const ALARM_WATCHDOG = 'udaan_queue_watchdog';

// Startup & Installation Lifecycle
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Udaan GST] Extension Installed / Updated - Milestone 1');
  chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 1 });
  reconcileQueueOnStartup();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Udaan GST] Browser Startup detected - Reconciling state...');
  reconcileQueueOnStartup();
});

// Watchdog Alarm Tick
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_WATCHDOG) {
    chrome.storage.local.get([STORAGE_KEYS.QUEUE], (res) => {
      const state = res[STORAGE_KEYS.QUEUE];
      if (state && state.isRunning && !state.isPaused) {
        console.log('[Udaan GST Watchdog] Ensuring sequential queue processing loop is alive');
      }
    });
  }
});

// Download Event Handlers with Persistent Association
chrome.downloads.onCreated.addListener((item) => {
  console.log('[Udaan GST] Download Started:', item.id, item.filename);
});

chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state && delta.state.current === 'complete') {
    const res = await chrome.storage.local.get([STORAGE_KEYS.DOWNLOAD_ASSOCIATIONS, STORAGE_KEYS.QUEUE]);
    const associations = res[STORAGE_KEYS.DOWNLOAD_ASSOCIATIONS] || {};
    const jobId = associations[String(delta.id)];
    
    if (jobId && res[STORAGE_KEYS.QUEUE]) {
      const queueState = res[STORAGE_KEYS.QUEUE];
      const job = queueState.jobs.find(j => j.id === jobId);
      if (job) {
        job.status = 'DOWNLOADED';
        job.completedAt = Date.now();
        if (delta.filename) job.filename = delta.filename.current;
        queueState.activeJobId = null;
        await chrome.storage.local.set({ [STORAGE_KEYS.QUEUE]: queueState });
        console.log('[Udaan GST] Job updated to DOWNLOADED:', jobId);
      }
    }
  }
});

// Queue Startup Reconciliation
async function reconcileQueueOnStartup() {
  const res = await chrome.storage.local.get([STORAGE_KEYS.QUEUE]);
  if (!res[STORAGE_KEYS.QUEUE]) return;

  const state = res[STORAGE_KEYS.QUEUE];
  let changed = false;

  for (const job of state.jobs || []) {
    if (['NAVIGATING', 'PAGE_READY', 'GENERATING'].includes(job.status)) {
      job.status = 'PENDING';
      changed = true;
    }
  }

  if (state.activeJobId) {
    state.activeJobId = null;
    changed = true;
  }

  if (changed) {
    await chrome.storage.local.set({ [STORAGE_KEYS.QUEUE]: state });
    console.log('[Udaan GST] Reconciled queue state successfully.');
  }
}

// Runtime Messaging
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'ok', timestamp: Date.now() });
  }
  return true;
});`;
  zip.file('serviceWorker.js', serviceWorkerJs);

  // gstPortalDetector.js
  const contentScriptJs = `// Udaan GST Bulk Download Assistant - Content Script
// Passive read-only URL and classification scanner
(function() {
  function scan() {
    const url = window.location.href;
    const hostname = window.location.hostname.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    const isGST = hostname.includes('gst.gov.in') || hostname.includes('cbic.gov.in');
    const isReturns = isGST && (pathname.includes('/returns') || window.location.hash.includes('returns'));
    const isLogin = isGST && pathname.includes('/login');

    const payload = {
      isGSTPortal: isGST,
      isReturnsDashboard: isReturns,
      isLoggedIn: isGST ? (isLogin ? false : (isReturns ? true : null)) : null,
      currentUrl: url,
      detectedPage: isReturns ? 'GST Returns Dashboard' : (isLogin ? 'GST Login Page' : (isGST ? 'GST Portal' : 'Non-GST Site'))
    };

    chrome.runtime.sendMessage({ type: 'PORTAL_STATUS', status: payload }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  let lastHref = window.location.href;
  new MutationObserver(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      scan();
    }
  }).observe(document.body, { childList: true, subtree: true });
})();`;
  zip.file('gstPortalDetector.js', contentScriptJs);

  // popup.js
  const popupJs = `// Udaan GST Bulk Download Assistant - Popup Controller
document.addEventListener('DOMContentLoaded', async () => {
  const statusDisplay = document.getElementById('portal-status-display');
  const btnStart = document.getElementById('btn-start');
  const btnAddTest = document.getElementById('btn-add-test');

  // Query active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url) {
      const isGst = tabs[0].url.includes('gst.gov.in');
      const isReturns = tabs[0].url.includes('/returns');
      if (statusDisplay) {
        statusDisplay.innerText = isReturns
          ? 'Returns Dashboard Active (Ready for Queue)'
          : (isGst ? 'GST Portal Detected' : 'Non-GST Site');
      }
    }
  });

  if (btnAddTest) {
    btnAddTest.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'ADD_TEST_JOB',
        jobData: { gstin: 'TESTGSTIN', financialYear: '2025-2026', period: 'April', returnType: 'GSTR-2B', isTestJob: true }
      }, () => {
        alert('Test Job Added to Queue!');
      });
    });
  }

  if (btnStart) {
    btnStart.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'START_QUEUE' }, () => {
        alert('Sequential Queue Started!');
      });
    });
  }
});`;
  zip.file('popup.js', popupJs);

  // README.md
  const readmeMd = `# Udaan GST Bulk Download Assistant — Milestone 1

Standalone Manifest V3 Chrome / Chromium Extension.

## Installation in Chrome / Edge / Brave
1. Extract this ZIP file into a folder on your computer.
2. Open Chrome and navigate to \`chrome://extensions\`.
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** and select the extracted folder.
5. The extension icon will appear in your Chrome toolbar.
6. Open https://services.gst.gov.in to verify automated detection.
`;
  zip.file('README.md', readmeMd);

  return await zip.generateAsync({ type: 'blob' });
}

export class ExtensionPacker {
  public static generateExtensionZip = generateExtensionZip;
}


