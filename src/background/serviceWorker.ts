import { DownloadQueueManager } from '../queue/downloadQueue';
import { QueueStore } from '../queue/queueStore';
import { DownloadMonitor } from '../downloads/downloadMonitor';
import { detectPortalStatus, PortalStatus } from '../gst/portalDetector';
import { Logger } from '../shared/logger';
import { ExtensionMessage, QueueUpdatedMessage } from '../messaging/messages';
import { ALARM_NAMES } from '../shared/constants';

Logger.info('[Service Worker] Udaan GST Bulk Download Assistant Background Worker Initialized.');

const queueManager = DownloadQueueManager.getInstance();
const downloadMonitor = DownloadMonitor.getInstance();

// Auto-run startup recovery on worker boot
queueManager.recoverQueueOnStartup().catch((err) => {
  Logger.error(`[Service Worker] Startup recovery error: ${err}`);
});

// Maintain latest known portal status
let latestPortalStatus: PortalStatus = {
  isGSTPortal: false,
  isReturnsDashboard: false,
  isLoggedIn: null,
  currentUrl: '',
  detectedPage: 'Initializing...',
};

// Check active tab portal status
async function updateActiveTabStatus(): Promise<PortalStatus> {
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        latestPortalStatus = detectPortalStatus(tab.url, {
          title: tab.title,
        });
      } else {
        latestPortalStatus = {
          isGSTPortal: false,
          isReturnsDashboard: false,
          isLoggedIn: null,
          currentUrl: '',
          detectedPage: 'No active tab',
        };
      }
    } catch (err) {
      Logger.error(`[Portal Detector] Error querying active tab: ${err}`);
    }
  }
  return latestPortalStatus;
}

// Extension installation and lifecycle listeners
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener((details) => {
    Logger.info(`[Service Worker] Extension installed/updated. Reason: ${details.reason}`);
    queueManager.recoverQueueOnStartup();

    // Create 1-minute watchdog alarm to prevent service worker starvation
    if (chrome.alarms) {
      chrome.alarms.create(ALARM_NAMES.WATCHDOG, { periodInMinutes: 1 });
    }
  });

  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      Logger.info('[Service Worker] Browser startup event received. Reconciling queue...');
      queueManager.recoverQueueOnStartup();
    });
  }

  // Handle watchdog alarm ticks
  if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === ALARM_NAMES.WATCHDOG) {
        const state = await QueueStore.getQueueState();
        if (state.isRunning && !state.isPaused) {
          Logger.info('[Watchdog Alarm] Verifying queue processing loop...');
          queueManager.processNext();
        }
      }
    });
  }

  // Tab updates listener
  if (chrome.tabs) {
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        latestPortalStatus = detectPortalStatus(tab.url, { title: tab.title });
        Logger.info(`[Tab Navigation] ${tab.url} -> ${latestPortalStatus.detectedPage}`);
      }
    });

    chrome.tabs.onActivated.addListener(async () => {
      await updateActiveTabStatus();
    });
  }

  // Handle Extension Messages
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    (async () => {
      try {
        switch (message.type) {
          case 'GET_PORTAL_STATUS': {
            const status = await updateActiveTabStatus();
            sendResponse({ status });
            break;
          }
          case 'GET_QUEUE': {
            const state = await QueueStore.getQueueState();
            sendResponse({ state });
            break;
          }
          case 'ADD_TEST_JOB': {
            const job = await QueueStore.addJob({
              gstin: message.jobData?.gstin || 'TESTGSTIN',
              financialYear: message.jobData?.financialYear || '2025-2026',
              period: message.jobData?.period || 'April',
              returnType: message.jobData?.returnType || 'GSTR-2B',
              isTestJob: true,
            });
            const state = await QueueStore.getQueueState();
            sendResponse({ success: true, job, state });
            break;
          }
          case 'START_QUEUE': {
            await queueManager.startQueue();
            const state = await QueueStore.getQueueState();
            sendResponse({ success: true, state });
            break;
          }
          case 'PAUSE_QUEUE': {
            await queueManager.pauseQueue();
            const state = await QueueStore.getQueueState();
            sendResponse({ success: true, state });
            break;
          }
          case 'RESUME_QUEUE': {
            await queueManager.resumeQueue();
            const state = await QueueStore.getQueueState();
            sendResponse({ success: true, state });
            break;
          }
          case 'RETRY_JOB': {
            await queueManager.retryJob(message.jobId);
            const state = await QueueStore.getQueueState();
            sendResponse({ success: true, state });
            break;
          }
          case 'REMOVE_JOB': {
            await QueueStore.removeJob(message.jobId);
            const state = await QueueStore.getQueueState();
            sendResponse({ success: true, state });
            break;
          }
          case 'CLEAR_COMPLETED': {
            await QueueStore.clearCompleted();
            const state = await QueueStore.getQueueState();
            sendResponse({ success: true, state });
            break;
          }
          case 'CLEAR_ALL': {
            await QueueStore.clearAll();
            const state = await QueueStore.getQueueState();
            sendResponse({ success: true, state });
            break;
          }
          case 'TRIGGER_TEST_DOWNLOAD': {
            const downloadId = downloadMonitor.simulateDownload(
              message.filename || 'TEST_GSTR2B_DOWNLOAD.json',
              'complete',
              message.associatedJobId
            );
            sendResponse({ success: true, downloadId });
            break;
          }
          default:
            sendResponse({ error: 'Unknown message type' });
        }
      } catch (err) {
        Logger.error(`[Service Worker] Message handler error: ${err}`);
        sendResponse({ error: String(err) });
      }
    })();

    return true; // Keep channel open for async response
  });
}

// Queue state subscriber to broadcast updates
queueManager.subscribe((state) => {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    const updateMsg: QueueUpdatedMessage = {
      type: 'QUEUE_UPDATED',
      state,
    };
    chrome.runtime.sendMessage(updateMsg).catch(() => {
      // Popup may be closed, ignore harmless broadcast error
    });
  }
});

export { queueManager, downloadMonitor, updateActiveTabStatus };
