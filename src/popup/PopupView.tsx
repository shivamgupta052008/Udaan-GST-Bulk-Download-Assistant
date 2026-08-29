import React, { useState, useEffect } from 'react';
import {
  Download,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ShieldCheck,
  Plus,
  Terminal,
  RefreshCw,
  FileCheck,
  ChevronRight,
  Sparkles,
  FolderSync,
  Folder,
  HardDrive,
  Check,
} from 'lucide-react';
import { PortalStatus } from '../gst/portalDetector';
import { QueueJob, QueueState, QueueStatus, SyncStatus } from '../queue/queueTypes';
import { ReturnType, FinancialYear, ReturnPeriod } from '../gst/returnTypes';
import {
  DEFAULT_FINANCIAL_YEARS,
  RETURN_PERIODS,
  SUPPORTED_RETURN_TYPES,
  GST_PORTAL_URLS,
} from '../shared/constants';
import { Logger, LogEntry } from '../shared/logger';
import { formatTimestamp } from '../shared/utils';
import { DownloadQueueManager } from '../queue/downloadQueue';
import { QueueStore } from '../queue/queueStore';
import { SyncEngine } from '../sync/syncEngine';
import { LocalSyncSettings } from '../sync/syncTypes';

interface PopupViewProps {
  initialPortalStatus?: PortalStatus;
  onOpenPortalUrl?: (url: string) => void;
  isStandalone?: boolean;
}

export const PopupView: React.FC<PopupViewProps> = ({
  initialPortalStatus,
  onOpenPortalUrl,
  isStandalone = false,
}) => {
  const [portalStatus, setPortalStatus] = useState<PortalStatus>(
    initialPortalStatus || {
      isGSTPortal: false,
      isReturnsDashboard: false,
      isLoggedIn: null,
      currentUrl: '',
      detectedPage: 'Scanning tab...',
    }
  );

  const [queueState, setQueueState] = useState<QueueState>({
    jobs: [],
    isRunning: false,
    isPaused: false,
    activeJobId: null,
    lastUpdated: Date.now(),
  });

  const [syncSettings, setSyncSettings] = useState<LocalSyncSettings>({
    autoSyncEnabled: false,
    rootSelected: false,
    rootPathName: null,
    status: 'NOT_CONFIGURED',
    lastVerifiedAt: null,
  });
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // New Test Job Form State
  const [testGstin, setTestGstin] = useState('TESTGSTIN');
  const [testFy, setTestFy] = useState<FinancialYear>('2025-2026');
  const [testPeriod, setTestPeriod] = useState<ReturnPeriod>('April');
  const [testReturnType, setTestReturnType] = useState<ReturnType>('GSTR-2B');

  const queueManager = DownloadQueueManager.getInstance();
  const syncEngine = SyncEngine.getInstance();

  // Load initial state and subscribe
  useEffect(() => {
    let mounted = true;

    async function loadData() {
      const state = await QueueStore.getQueueState();
      const settings = await syncEngine.getSettings();
      if (mounted) {
        setQueueState(state);
        setSyncSettings(settings);
        setLogs(Logger.getLogs());
      }
    }

    loadData();

    // Subscribe to queue state updates
    const unsubQueue = queueManager.subscribe((state) => {
      if (mounted) setQueueState(state);
    });

    // Subscribe to log updates
    const unsubLogs = Logger.subscribe((entry) => {
      if (mounted) setLogs((prev) => [entry, ...prev].slice(0, 100));
    });

    // Check Chrome runtime for active tab if available
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.url) {
          import('../gst/portalDetector').then(({ detectPortalStatus }) => {
            const status = detectPortalStatus(tabs[0].url || '', {
              title: tabs[0].title,
            });
            if (mounted) setPortalStatus(status);
          });
        }
      });
    }

    return () => {
      mounted = false;
      unsubQueue();
      unsubLogs();
    };
  }, []);

  // Sync prop changes
  useEffect(() => {
    if (initialPortalStatus) {
      setPortalStatus(initialPortalStatus);
    }
  }, [initialPortalStatus]);

  // Handlers
  const handleOpenGSTPortal = () => {
    const url = GST_PORTAL_URLS.LOGIN;
    if (onOpenPortalUrl) {
      onOpenPortalUrl(url);
    } else if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank');
    }
  };

  const handleSelectRoot = async () => {
    try {
      const res = await syncEngine.configureRoot();
      const updated = await syncEngine.getSettings();
      setSyncSettings(updated);
      if (res.success) {
        setSyncMessage(`Root selected: ${res.pathName}`);
        setTimeout(() => setSyncMessage(null), 3000);
      } else if (res.error) {
        setSyncMessage(`Error: ${res.error}`);
        setTimeout(() => setSyncMessage(null), 4000);
      }
    } catch (err: any) {
      setSyncMessage(`Error: ${err?.message || String(err)}`);
      setTimeout(() => setSyncMessage(null), 4000);
    }
  };

  const handleToggleAutoSync = async () => {
    if (!syncSettings.rootSelected || syncSettings.status !== 'CONNECTED') {
      setSyncMessage('Please select a Local Storage Root first.');
      setTimeout(() => setSyncMessage(null), 3000);
      return;
    }
    const newTarget = !syncSettings.autoSyncEnabled;
    const ok = await syncEngine.setAutoSync(newTarget);
    if (ok) {
      const updated = await syncEngine.getSettings();
      setSyncSettings(updated);
    }
  };

  const handleSyncNow = async () => {
    if (!syncEngine.isRootReady()) {
      setSyncMessage('Select Local Storage Root first.');
      setTimeout(() => setSyncMessage(null), 3000);
      return;
    }
    setIsSyncingNow(true);
    try {
      const res = await syncEngine.syncNow();
      const updatedState = await QueueStore.getQueueState();
      setQueueState(updatedState);
      setSyncMessage(`Synced ${res.syncedCount} of ${res.totalEligible} jobs.`);
      setTimeout(() => setSyncMessage(null), 3500);
    } catch (err: any) {
      setSyncMessage(`Sync error: ${err?.message || String(err)}`);
      setTimeout(() => setSyncMessage(null), 4000);
    } finally {
      setIsSyncingNow(false);
    }
  };

  const handleSyncSingleJob = async (job: QueueJob) => {
    try {
      const res = await syncEngine.syncJob(job);
      const updatedState = await QueueStore.getQueueState();
      setQueueState(updatedState);
      if (!res.success) {
        setSyncMessage(`Sync failed: ${res.error}`);
        setTimeout(() => setSyncMessage(null), 3000);
      }
    } catch (err: any) {
      setSyncMessage(`Sync error: ${err?.message || String(err)}`);
      setTimeout(() => setSyncMessage(null), 3000);
    }
  };

  const handleAddDefaultTestJob = async () => {
    try {
      await QueueStore.addJob({
        gstin: 'TESTGSTIN',
        financialYear: '2025-2026',
        period: 'April',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });
      const state = await QueueStore.getQueueState();
      setQueueState(state);
    } catch (err: unknown) {
      Logger.warn(`[Popup] Could not add default job: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleAddCustomTestJob = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await QueueStore.addJob({
        gstin: testGstin.trim().toUpperCase() || 'TESTGSTIN',
        financialYear: testFy,
        period: testPeriod,
        returnType: testReturnType,
        isTestJob: true,
      });
      const state = await QueueStore.getQueueState();
      setQueueState(state);
      setShowAddModal(false);
    } catch (err: unknown) {
      Logger.warn(`[Popup] Could not add custom job: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleStartQueue = async () => {
    await queueManager.startQueue();
  };

  const handlePauseQueue = async () => {
    await queueManager.pauseQueue();
  };

  const handleResumeQueue = async () => {
    await queueManager.resumeQueue();
  };

  const handleRetryJob = async (jobId: string) => {
    await queueManager.retryJob(jobId);
  };

  const handleRemoveJob = async (jobId: string) => {
    await QueueStore.removeJob(jobId);
  };

  const handleClearCompleted = async () => {
    await QueueStore.clearCompleted();
  };

  const handleClearAll = async () => {
    await QueueStore.clearAll();
  };

  // Counts
  const totalJobs = queueState.jobs.length;
  const pendingJobs = queueState.jobs.filter((j) => j.status === 'PENDING').length;
  const inProgressJobs = queueState.jobs.filter(
    (j) =>
      j.status === 'NAVIGATING' ||
      j.status === 'PAGE_READY' ||
      j.status === 'GENERATING' ||
      j.status === 'WAITING_FOR_DOWNLOAD'
  ).length;
  const downloadedJobs = queueState.jobs.filter((j) => j.status === 'DOWNLOADED').length;
  const failedJobs = queueState.jobs.filter((j) => j.status === 'FAILED').length;
  const unsyncedDownloadedJobs = queueState.jobs.filter(
    (j) => j.status === 'DOWNLOADED' && j.syncStatus !== 'SYNCED'
  ).length;

  const getStatusBadge = (status: QueueStatus) => {
    switch (status) {
      case 'DOWNLOADED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            DOWNLOADED
          </span>
        );
      case 'NAVIGATING':
      case 'PAGE_READY':
      case 'GENERATING':
      case 'WAITING_FOR_DOWNLOAD':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/80 animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
            {status}
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/80">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            FAILED
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200/60">
            <Clock className="w-3 h-3 text-slate-400" />
            PENDING
          </span>
        );
    }
  };

  const getSyncBadge = (syncStatus?: SyncStatus) => {
    switch (syncStatus) {
      case 'SYNCED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Check className="w-3 h-3 text-emerald-600" />
            SYNCED
          </span>
        );
      case 'SYNCING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin text-blue-600" />
            SYNCING
          </span>
        );
      case 'SYNC_FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            SYNC FAILED
          </span>
        );
      case 'NOT_SYNCED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
            NOT SYNCED
          </span>
        );
    }
  };

  return (
    <div
      id="udaan-popup-container"
      className={`w-full ${
        isStandalone ? 'max-w-md mx-auto min-h-screen bg-slate-50 shadow-2xl' : 'h-full'
      } flex flex-col bg-slate-50 text-slate-900 font-sans select-none`}
    >
      {/* Clean Minimalist Header */}
      <header className="px-4 py-3.5 bg-white border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
            <Download className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-slate-900 leading-none">
                Udaan GST Bulk
              </h1>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-md border border-blue-200/60">
                M3
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Sequential Queue & Local Auto-Sync</p>
          </div>
        </div>

        <button
          id="btn-toggle-logs"
          onClick={() => setShowLogs(!showLogs)}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border ${
            showLogs
              ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
              : 'text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
          }`}
          title="Toggle Extension Event Logs"
        >
          <Terminal className="w-3.5 h-3.5" />
          <span className="text-[11px] font-medium">Logs</span>
        </button>
      </header>

      {/* Main Content Body */}
      <main className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {/* GST Portal Detection Card */}
        <section
          id="portal-status-card"
          className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              GST Portal Status
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  portalStatus.isReturnsDashboard
                    ? 'bg-emerald-500 ring-4 ring-emerald-50'
                    : portalStatus.isGSTPortal
                    ? 'bg-amber-500 ring-4 ring-amber-50'
                    : 'bg-slate-300'
                }`}
              />
              <span className="text-xs font-medium text-slate-700">
                {portalStatus.isReturnsDashboard
                  ? 'Returns Dashboard Active'
                  : portalStatus.isGSTPortal
                  ? 'GST Portal Detected'
                  : 'GST Portal Not Detected'}
              </span>
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100 flex items-start gap-2.5">
            <div className="mt-0.5 shrink-0">
              {portalStatus.isReturnsDashboard ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : portalStatus.isGSTPortal ? (
                <AlertCircle className="w-4 h-4 text-amber-600" />
              ) : (
                <ExternalLink className="w-4 h-4 text-slate-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-800 truncate">
                {portalStatus.detectedPage}
              </p>
              <p className="text-[11px] text-slate-500 truncate font-mono mt-0.5">
                {portalStatus.currentUrl || 'No active GST tab attached'}
              </p>
            </div>
          </div>

          {/* Contextual Warning / Guidance */}
          {!portalStatus.isGSTPortal && (
            <div className="text-xs text-slate-600 bg-amber-50/70 border border-amber-200/70 p-2.5 rounded-lg flex items-center justify-between gap-2">
              <span className="text-[11px] leading-tight">Open the official GST Portal to start operations.</span>
              <button
                id="btn-open-gst-portal"
                onClick={handleOpenGSTPortal}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-[11px] font-medium transition-colors shrink-0 shadow-xs"
              >
                <span>Open Portal</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          )}

          {portalStatus.isGSTPortal && !portalStatus.isLoggedIn && (
            <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 p-2.5 rounded-lg space-y-1">
              <p className="font-semibold text-amber-950 text-xs">
                GST Portal detected — Please log in manually.
              </p>
              <p className="text-[11px] text-amber-800 leading-snug">
                The extension does not handle your GST username, password, OTP, or CAPTCHA.
              </p>
            </div>
          )}

          {portalStatus.isGSTPortal && portalStatus.isLoggedIn && !portalStatus.isReturnsDashboard && (
            <div className="text-xs text-blue-900 bg-blue-50 border border-blue-200 p-2.5 rounded-lg">
              <span className="text-[11px]">Logged in. Please navigate to <strong>Returns Dashboard</strong> to initiate batch downloads.</span>
            </div>
          )}
        </section>

        {/* Queue Metrics Summary */}
        <section
          id="queue-metrics-bar"
          className="grid grid-cols-4 gap-2 bg-white p-2.5 rounded-xl border border-slate-200 text-center shadow-sm"
        >
          <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
            <span className="block text-sm font-semibold text-slate-900">{totalJobs}</span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Total</span>
          </div>
          <div className="p-2 rounded-lg bg-amber-50/80 border border-amber-100">
            <span className="block text-sm font-semibold text-amber-700">{pendingJobs}</span>
            <span className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold">Pending</span>
          </div>
          <div className="p-2 rounded-lg bg-blue-50/80 border border-blue-100">
            <span className="block text-sm font-semibold text-blue-700">{inProgressJobs}</span>
            <span className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">Active</span>
          </div>
          <div className="p-2 rounded-lg bg-emerald-50/80 border border-emerald-100">
            <span className="block text-sm font-semibold text-emerald-700">{downloadedJobs}</span>
            <span className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">Done</span>
          </div>
        </section>

        {/* Milestone 3: Local Storage & Auto-Sync Section */}
        <section
          id="local-storage-sync-card"
          className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <FolderSync className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Local Storage & Sync
              </span>
            </div>
            <div>
              {syncSettings.status === 'CONNECTED' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Check className="w-3 h-3 text-emerald-600" />
                  CONNECTED
                </span>
              ) : syncSettings.status === 'LOCAL_STORAGE_UNAVAILABLE' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                  <AlertCircle className="w-3 h-3 text-rose-600" />
                  PERMISSION REVOKED
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                  NOT CONFIGURED
                </span>
              )}
            </div>
          </div>

          {/* Root Directory Display & Picker */}
          <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Folder className="w-4 h-4 text-slate-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-slate-800 truncate">
                  {syncSettings.rootPathName || 'No local directory selected'}
                </p>
                <p className="text-[10px] text-slate-400">
                  {syncSettings.rootSelected
                    ? 'Root folder active for GST JSON storage'
                    : 'Mandatory for auto-sync organization'}
                </p>
              </div>
            </div>
            <button
              id="btn-select-root-folder"
              onClick={handleSelectRoot}
              className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-md text-[11px] font-medium transition-colors shrink-0 shadow-2xs"
            >
              {syncSettings.rootSelected ? 'Change' : 'Select Root'}
            </button>
          </div>

          {/* Auto-Sync Toggle & Sync Now Action */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <button
                id="btn-toggle-auto-sync"
                onClick={handleToggleAutoSync}
                disabled={!syncSettings.rootSelected || syncSettings.status !== 'CONNECTED'}
                className={`w-7 h-3.5 rounded-full relative transition-colors disabled:opacity-40 ${
                  syncSettings.autoSyncEnabled ? 'bg-blue-600' : 'bg-slate-200'
                }`}
                title={
                  syncSettings.rootSelected
                    ? 'Toggle automatic synchronization on download complete'
                    : 'Select root folder to enable auto-sync'
                }
              >
                <div
                  className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${
                    syncSettings.autoSyncEnabled ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </button>
              <span className="text-[11px] text-slate-700 font-medium">
                Auto-Sync on Download
              </span>
            </div>

            <button
              id="btn-sync-now"
              onClick={handleSyncNow}
              disabled={
                !syncSettings.rootSelected ||
                syncSettings.status !== 'CONNECTED' ||
                isSyncingNow ||
                unsyncedDownloadedJobs === 0
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-md text-[11px] font-medium transition-colors shadow-2xs"
              title="Synchronize all pending downloaded returns into local folders"
            >
              {isSyncingNow ? (
                <RefreshCw className="w-3 h-3 animate-spin text-white" />
              ) : (
                <HardDrive className="w-3 h-3" />
              )}
              <span>Sync Now{unsyncedDownloadedJobs > 0 ? ` (${unsyncedDownloadedJobs})` : ''}</span>
            </button>
          </div>

          {syncMessage && (
            <div className="text-[10.5px] p-2 bg-blue-50 text-blue-800 rounded border border-blue-200">
              {syncMessage}
            </div>
          )}
        </section>

        {/* Queue Control Buttons */}
        <section className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Queue Controls
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 font-medium">
                {queueState.isRunning
                  ? queueState.isPaused
                    ? 'Paused'
                    : 'Running'
                  : 'Idle'}
              </span>
              <div
                className={`w-7 h-3.5 rounded-full relative transition-colors ${
                  queueState.isRunning && !queueState.isPaused
                    ? 'bg-blue-600'
                    : queueState.isPaused
                    ? 'bg-amber-500'
                    : 'bg-slate-200'
                }`}
              >
                <div
                  className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${
                    queueState.isRunning ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {!queueState.isRunning ? (
              <button
                id="btn-start-queue"
                onClick={handleStartQueue}
                disabled={totalJobs === 0 || pendingJobs === 0}
                className="flex items-center justify-center gap-1.5 py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium shadow-sm transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Start Queue</span>
              </button>
            ) : queueState.isPaused ? (
              <button
                id="btn-resume-queue"
                onClick={handleResumeQueue}
                className="flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium shadow-sm transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Resume</span>
              </button>
            ) : (
              <button
                id="btn-pause-queue"
                onClick={handlePauseQueue}
                className="flex items-center justify-center gap-1.5 py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium shadow-sm transition-colors"
              >
                <Pause className="w-3.5 h-3.5 fill-current" />
                <span>Pause</span>
              </button>
            )}

            <div className="flex gap-1.5">
              <button
                id="btn-add-test-job-quick"
                onClick={handleAddDefaultTestJob}
                className="flex-1 flex items-center justify-center gap-1 py-2 px-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium shadow-sm transition-colors"
                title="Add Default Safe Test Job (TESTGSTIN / April / GSTR-2B)"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Job</span>
              </button>
              <button
                id="btn-customize-job"
                onClick={() => setShowAddModal(true)}
                className="px-2.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                title="Customize Test Job Parameters"
              >
                <Sparkles className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px]">
            <button
              id="btn-clear-completed"
              onClick={handleClearCompleted}
              disabled={downloadedJobs === 0 && failedJobs === 0}
              className="text-slate-600 hover:text-slate-900 disabled:opacity-40 font-medium transition-colors"
            >
              Clear Completed
            </button>
            <button
              id="btn-clear-all"
              onClick={handleClearAll}
              disabled={totalJobs === 0}
              className="text-slate-400 hover:text-rose-600 disabled:opacity-40 font-medium transition-colors"
            >
              Clear All
            </button>
          </div>
        </section>

        {/* Custom Test Job Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-5 w-full max-w-xs shadow-xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 className="text-sm font-semibold text-slate-900">Add Test Queue Job</h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-semibold"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleAddCustomTestJob} className="space-y-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                    GSTIN Identifier
                  </label>
                  <input
                    type="text"
                    value={testGstin}
                    onChange={(e) => setTestGstin(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-100 border-none rounded-lg text-xs font-mono text-slate-900 focus:ring-2 focus:ring-blue-500"
                    placeholder="TESTGSTIN"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                      Return Type
                    </label>
                    <select
                      value={testReturnType}
                      onChange={(e) => setTestReturnType(e.target.value as ReturnType)}
                      className="w-full px-2.5 py-2 bg-slate-100 border-none rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-blue-500"
                    >
                      {SUPPORTED_RETURN_TYPES.map((rt) => (
                        <option key={rt} value={rt}>
                          {rt}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                      Financial Year
                    </label>
                    <select
                      value={testFy}
                      onChange={(e) => setTestFy(e.target.value)}
                      className="w-full px-2.5 py-2 bg-slate-100 border-none rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-blue-500"
                    >
                      {DEFAULT_FINANCIAL_YEARS.map((fy) => (
                        <option key={fy} value={fy}>
                          {fy}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">
                    Return Period / Month
                  </label>
                  <select
                    value={testPeriod}
                    onChange={(e) => setTestPeriod(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-100 border-none rounded-lg text-xs text-slate-900 focus:ring-2 focus:ring-blue-500"
                  >
                    {RETURN_PERIODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-xs shadow-sm"
                  >
                    Add to Queue
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Logs Drawer View */}
        {showLogs && (
          <section
            id="logs-viewer"
            className="bg-slate-900 text-slate-100 rounded-xl p-3.5 shadow-sm space-y-2 text-xs font-mono"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Extension Logs ({logs.length})
              </span>
              <button
                onClick={() => {
                  Logger.clearLogs();
                  setLogs([]);
                }}
                className="text-[10px] text-slate-400 hover:text-white transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1.5 text-[11px] pr-1">
              {logs.length === 0 ? (
                <div className="text-slate-500 py-3 text-center">No logs recorded yet.</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="leading-tight">
                    <span className="text-slate-500">{formatTimestamp(log.timestamp)} </span>
                    <span
                      className={
                        log.level === 'ERROR'
                          ? 'text-rose-400 font-bold'
                          : log.level === 'WARN'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }
                    >
                      [{log.level}]
                    </span>{' '}
                    <span className="text-slate-200">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* Job Queue List */}
        <section id="job-queue-list" className="space-y-2.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Download Queue ({totalJobs})
            </span>
            {inProgressJobs > 0 && (
              <span className="text-[11px] text-blue-600 font-medium">
                1 active operation running
              </span>
            )}
          </div>

          {queueState.jobs.length === 0 ? (
            <div className="bg-white rounded-xl p-6 text-center border border-slate-200 shadow-sm">
              <FileCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-800">Queue is currently empty</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Add a test job to simulate sequential processing and download tracking.
              </p>
              <button
                onClick={handleAddDefaultTestJob}
                className="mt-3.5 inline-flex items-center gap-1.5 px-3.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Test Job</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {queueState.jobs.map((job) => (
                <div
                  key={job.id}
                  id={`job-card-${job.id}`}
                  className={`bg-white rounded-xl p-3.5 border transition-all ${
                    queueState.activeJobId === job.id
                      ? 'border-blue-500 shadow-sm ring-2 ring-blue-50'
                      : 'border-slate-200 shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-mono text-[10px] font-bold border border-slate-200/60">
                          {job.returnType}
                        </span>
                        <span className="text-xs font-semibold text-slate-900 font-mono">
                          {job.gstin}
                        </span>
                        {job.isTestJob && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200/60 rounded">
                            TEST JOB
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {job.period} • {job.financialYear}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      {getStatusBadge(job.status)}
                      <span className="text-[10px] text-slate-400">
                        {formatTimestamp(job.updatedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Active Job Step Indicator */}
                  {(job.status === 'NAVIGATING' ||
                    job.status === 'PAGE_READY' ||
                    job.status === 'WAITING_FOR_DOWNLOAD') && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[10px] text-slate-600 mb-1">
                        <span className="font-medium">Sequential Step Execution</span>
                        <span className="font-mono text-blue-600">{job.status}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
                          style={{
                            width:
                              job.status === 'NAVIGATING'
                                ? '33%'
                                : job.status === 'PAGE_READY'
                                ? '66%'
                                : '90%',
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Download Details & Milestone 3 Local Sync Status */}
                  {job.status === 'DOWNLOADED' && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-2">
                      <div className="text-[11px] text-emerald-800 bg-emerald-50/70 p-2.5 rounded-lg flex items-center justify-between">
                        <div className="truncate mr-2">
                          <span className="font-medium text-emerald-950">Portal File: </span>
                          <span className="font-mono text-[10.5px]">{job.filename || 'Downloaded JSON'}</span>
                        </div>
                        <FileCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      </div>

                      {/* Local Sync State Card */}
                      <div className="bg-slate-50 border border-slate-200/70 rounded-lg p-2.5 text-[11px] space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-700 flex items-center gap-1">
                            <FolderSync className="w-3 h-3 text-slate-500" />
                            Local Auto-Sync
                          </span>
                          {getSyncBadge(job.syncStatus)}
                        </div>

                        {job.syncStatus === 'SYNCED' && job.localRelativePath && (
                          <div className="text-[10px] text-slate-600 bg-white p-1.5 rounded border border-slate-200 font-mono truncate">
                            {job.localRelativePath}
                          </div>
                        )}

                        {job.syncStatus === 'SYNC_FAILED' && (
                          <div className="text-[10.5px] text-rose-700 bg-rose-50 p-1.5 rounded border border-rose-200">
                            {job.syncError || 'Sync failed'}
                          </div>
                        )}

                        {job.syncStatus !== 'SYNCED' && syncSettings.status === 'CONNECTED' && (
                          <div className="pt-1 flex justify-end">
                            <button
                              onClick={() => handleSyncSingleJob(job)}
                              className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded text-[10px] font-medium transition-colors"
                            >
                              Sync Now
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error & Retry Details */}
                  {job.status === 'FAILED' && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-100 text-[11px] text-rose-800 bg-rose-50/80 p-2.5 rounded-lg space-y-2">
                      <p className="font-medium">{job.error || 'Operation failed'}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-rose-600">
                          Attempts: {job.retryCount}/{job.maxRetries}
                        </span>
                        <button
                          onClick={() => handleRetryJob(job.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-medium transition-colors shadow-xs"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Actions for Idle / Pending */}
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 font-mono text-[10px]">ID: {job.id}</span>
                    <button
                      onClick={() => handleRemoveJob(job.id)}
                      className="text-xs font-semibold text-slate-400 hover:text-red-500 transition-colors"
                      title="Remove Job"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Security Statement Footer */}
      <footer className="px-4 py-2.5 bg-slate-100 border-t border-slate-200 flex items-center gap-2 text-[10px] text-slate-500">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="leading-tight">
          <strong>Zero-Knowledge Security:</strong> Passwords, OTPs, or session tokens are never intercepted or stored.
        </span>
      </footer>
    </div>
  );
};
