import { detectPortalStatus, PortalStatus } from '../gst/portalDetector';
import { GSTR2BAdapter } from '../adapters/gstr2bAdapter';
import { Logger } from '../shared/logger';

/**
 * GST Portal Content Script Detector & Milestone 2 GSTR-2B Page Runner
 * Strictly read-only page classifier and user-authorized visible DOM action executor.
 * Never intercepts, captures, or interacts with passwords, OTPs, or CAPTCHA inputs.
 */

const gstr2bAdapter = new GSTR2BAdapter();

function scanPage(): PortalStatus {
  const currentUrl = window.location.href;
  const title = document.title;
  const pathname = window.location.pathname;

  // Lightweight non-invasive DOM cues
  const hasLoginButton = !!document.querySelector('button[type="submit"], input[value="Login"], a[href*="login"]');
  const hasUserGreeting = !!document.querySelector('.welcome-user, .user-name, [id*="userGreeting"]');
  const hasDashboardBreadcrumb = !!document.querySelector('.breadcrumb, [id*="returnsDashboard"]');

  return detectPortalStatus(currentUrl, {
    title,
    pathname,
    hasLoginButton,
    hasUserGreeting,
    hasDashboardBreadcrumb,
  });
}

function notifyBackground(): void {
  try {
    const status = scanPage();
    Logger.info(`[Content Script] Page detected: ${status.detectedPage} (${status.currentUrl})`);

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'PORTAL_STATUS',
        status,
      }).catch(() => {
        // Service worker may be asleep, safe to ignore
      });
    }
  } catch (err) {
    console.error('GST Portal Detector error:', err);
  }
}

// Listen for background worker GSTR-2B automation requests
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GSTR2B_NAVIGATE_PERIOD') {
      gstr2bAdapter
        .navigateToPeriod(message.gstin, message.financialYear, message.period, { doc: document })
        .then((success) => sendResponse({ success }))
        .catch((err) => sendResponse({ success: false, error: String(err.message || err) }));
      return true;
    }

    if (message.type === 'GSTR2B_TRIGGER_GENERATE') {
      gstr2bAdapter
        .triggerGenerateJson(document)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: String(err.message || err) }));
      return true;
    }

    if (message.type === 'GSTR2B_WAIT_AND_DOWNLOAD') {
      gstr2bAdapter
        .waitForGeneratedJsonAndDownload({ doc: document, timeoutMs: message.timeoutMs })
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: String(err.message || err) }));
      return true;
    }

    if (message.type === 'GSTR2B_VERIFY_GSTIN') {
      const result = gstr2bAdapter.verifyGstinContext(message.gstin, document);
      sendResponse(result);
      return false;
    }
  });
}

// Run on load and DOM mutations
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notifyBackground);
  } else {
    notifyBackground();
  }

  // Observe SPA page route changes on GST Portal
  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      notifyBackground();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

export { scanPage };

