import React, { useState, useEffect } from 'react';
import {
  Download,
  ShieldCheck,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Layers,
  Terminal,
  FileText,
  Package,
  Globe,
  ArrowRight,
  Sparkles,
  Info,
  Check,
  FolderDown,
  RefreshCw,
} from 'lucide-react';
import { PopupView } from './popup/PopupView';
import { detectPortalStatus, PortalStatus } from './gst/portalDetector';
import { DownloadMonitor } from './downloads/downloadMonitor';
import { runAcceptanceTestSuite, TestCaseResult } from './testing/testSuite';
import { generateExtensionZip } from './utils/extensionPacker';
import { GST_PORTAL_URLS } from './shared/constants';

type TabMode = 'simulator' | 'tests' | 'downloads' | 'export' | 'architecture';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabMode>('simulator');

  // Simulated browser tab URL state
  const [simulatedUrl, setSimulatedUrl] = useState<string>(GST_PORTAL_URLS.RETURNS_DASHBOARD);
  const [simulatedTitle, setSimulatedTitle] = useState<string>('GST Returns Dashboard — File Returns');
  const [portalStatus, setPortalStatus] = useState<PortalStatus>(() =>
    detectPortalStatus(GST_PORTAL_URLS.RETURNS_DASHBOARD, {
      title: 'GST Returns Dashboard — File Returns',
      hasDashboardBreadcrumb: true,
    })
  );

  // Acceptance Tests state
  const [testResults, setTestResults] = useState<TestCaseResult[]>([]);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [testProgress, setTestProgress] = useState({ current: 0, total: 75 });

  // Downloads simulator state
  const [simulatedDownloads, setSimulatedDownloads] = useState<
    Array<{ id: number; filename: string; state: string; time: string }>
  >([]);
  const [downloadFilename, setDownloadFilename] = useState('27TESTGSTIN1Z5_GSTR2B_042025.json');

  // Export ZIP state
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Update detection when simulated URL changes
  useEffect(() => {
    const status = detectPortalStatus(simulatedUrl, {
      title: simulatedTitle,
      hasDashboardBreadcrumb: simulatedUrl.includes('/returns'),
      hasLoginButton: simulatedUrl.includes('/login'),
      hasUserGreeting: simulatedUrl.includes('/auth') || simulatedUrl.includes('/returns'),
    });
    setPortalStatus(status);
  }, [simulatedUrl, simulatedTitle]);

  const handleSelectPresetUrl = (url: string, title: string) => {
    setSimulatedUrl(url);
    setSimulatedTitle(title);
  };

  const handleRunTests = async () => {
    setIsRunningTests(true);
    setTestResults([]);
    setTestProgress({ current: 0, total: 75 });

    const results = await runAcceptanceTestSuite((res, cur, tot) => {
      setTestResults((prev) => [...prev, res]);
      setTestProgress({ current: cur, total: tot });
    });

    setTestResults(results);
    setIsRunningTests(false);
  };

  const handleSimulateDownloadTrigger = (outcome: 'complete' | 'interrupted') => {
    const monitor = DownloadMonitor.getInstance();
    const id = monitor.simulateDownload(downloadFilename, outcome);

    setSimulatedDownloads((prev) => [
      {
        id,
        filename: downloadFilename,
        state: 'in_progress',
        time: new Date().toLocaleTimeString(),
      },
      ...prev,
    ]);

    setTimeout(() => {
      setSimulatedDownloads((prev) =>
        prev.map((d) => (d.id === id ? { ...d, state: outcome } : d))
      );
    }, 1300);
  };

  const handleDownloadZip = async () => {
    try {
      setIsExporting(true);
      const blob = await generateExtensionZip();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'udaan-gst-bulk-download-extension-m4.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 4000);
    } catch (err) {
      console.error('Failed to export zip:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const passedTestsCount = testResults.filter((t) => t.passed).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Banner Bar with Clean Minimalism styling */}
      <header className="h-16 sm:h-20 bg-white border-b border-slate-200 px-6 sm:px-8 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight text-slate-900">
                Udaan GST Bulk Download Assistant
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
                Milestone 4 • Multi-Return (GSTR-1, 2A, 2B, 3B)
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Zero-Knowledge Security
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Manifest V3 Chrome Extension • Sequential Queue • Multi-Return Automation • Local Storage Auto-Sync
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="btn-nav-run-tests"
            onClick={() => {
              setActiveTab('tests');
              handleRunTests();
            }}
            className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <Play className="w-4 h-4 text-blue-600" />
            <span>Run Test Suite</span>
          </button>

          <button
            id="btn-nav-export-zip"
            onClick={handleDownloadZip}
            disabled={isExporting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
          >
            {isExporting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <FolderDown className="w-4 h-4" />
            )}
            <span>{exportSuccess ? 'Downloaded (.ZIP)!' : 'Export Extension (.ZIP)'}</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Container */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LEFT COLUMN: Pixel-Perfect Chrome Extension Popup Emulator */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full max-w-[390px] bg-slate-900 rounded-2xl p-2.5 shadow-xl border border-slate-800">
            {/* Chrome Browser Extension Framing Header */}
            <div className="flex items-center justify-between px-3 py-1.5 text-slate-400 text-xs border-b border-slate-800 pb-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                <span className="ml-2 font-mono text-xs text-slate-300">Chrome Popup View</span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">380 × 540 px</span>
            </div>

            {/* Embedded Live Popup View Component */}
            <div className="rounded-xl overflow-hidden shadow-sm border border-slate-200 bg-white">
              <PopupView
                initialPortalStatus={portalStatus}
                onOpenPortalUrl={(url) => {
                  setSimulatedUrl(url);
                  setSimulatedTitle('GST Portal Login Page');
                }}
                isStandalone={false}
              />
            </div>
          </div>

          <p className="text-xs text-slate-500 text-center mt-3 max-w-xs leading-relaxed">
            Interactive live preview of the popup interface as it appears when clicking the extension icon in Google Chrome.
          </p>
        </div>

        {/* RIGHT COLUMN: Development Workbench & Simulator Controls */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden min-h-[620px]">
          {/* Workbench Tabs Navigation with Clean Minimalism style */}
          <div className="flex items-center border-b border-slate-200 bg-white px-5 pt-3 gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab('simulator')}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'simulator'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>GST Portal Simulator</span>
            </button>

            <button
              onClick={() => setActiveTab('tests')}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'tests'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Acceptance Tests</span>
              {testResults.length > 0 && (
                <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-bold">
                  {passedTestsCount}/{testResults.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('downloads')}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'downloads'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Download className="w-4 h-4" />
              <span>Download Monitor</span>
            </button>

            <button
              onClick={() => setActiveTab('export')}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'export'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Install Guide</span>
            </button>

            <button
              onClick={() => setActiveTab('architecture')}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'architecture'
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Architecture</span>
            </button>
          </div>

          {/* Workbench Tab Contents */}
          <div className="flex-1 p-6 overflow-y-auto">
            {/* TAB 1: GST PORTAL SIMULATOR */}
            {activeTab === 'simulator' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Active Chrome Tab Simulator</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Switch simulated browser tabs below to observe how the content script detector and popup dynamically react.
                  </p>
                </div>

                {/* Simulated URL Presets */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Simulate Visiting Tab:
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      onClick={() =>
                        handleSelectPresetUrl(
                          GST_PORTAL_URLS.RETURNS_DASHBOARD,
                          'GST Returns Dashboard — File Returns'
                        )
                      }
                      className={`p-4 rounded-xl border text-left text-xs transition-all shadow-xs ${
                        simulatedUrl.includes('/returns')
                          ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-100 font-semibold'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">Returns Dashboard</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-semibold">
                          Logged In
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-1">
                        https://services.gst.gov.in/services/returns
                      </p>
                    </button>

                    <button
                      onClick={() =>
                        handleSelectPresetUrl(
                          GST_PORTAL_URLS.LOGIN,
                          'GST Portal — Login & Security Authentication'
                        )
                      }
                      className={`p-4 rounded-xl border text-left text-xs transition-all shadow-xs ${
                        simulatedUrl.includes('/login')
                          ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-100 font-semibold'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">GST Login Page</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] bg-amber-50 text-amber-700 border border-amber-200/60 font-semibold">
                          Manual Login Required
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-1">
                        https://services.gst.gov.in/services/login
                      </p>
                    </button>

                    <button
                      onClick={() =>
                        handleSelectPresetUrl(
                          GST_PORTAL_URLS.DASHBOARD,
                          'GST Portal — User Welcome Dashboard'
                        )
                      }
                      className={`p-4 rounded-xl border text-left text-xs transition-all shadow-xs ${
                        simulatedUrl.includes('/auth/dashboard')
                          ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-100 font-semibold'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">Main Dashboard</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] bg-blue-50 text-blue-700 border border-blue-200/60 font-semibold">
                          Returns not open
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-1">
                        https://services.gst.gov.in/services/auth/dashboard
                      </p>
                    </button>

                    <button
                      onClick={() =>
                        handleSelectPresetUrl(
                          'https://www.google.com/search?q=gst+tax+rates',
                          'Google Search — GST Tax Rates'
                        )
                      }
                      className={`p-4 rounded-xl border text-left text-xs transition-all shadow-xs ${
                        !simulatedUrl.includes('gst.gov.in')
                          ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-100 font-semibold'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">Non-GST Website</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] bg-slate-100 text-slate-600 border border-slate-200/60 font-semibold">
                          Outside GST
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-1">
                        https://www.google.com/search?q=gst
                      </p>
                    </button>
                  </div>
                </div>

                {/* Simulated Browser Address Bar */}
                <div className="bg-slate-100 p-3 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Address:</span>
                    <input
                      type="text"
                      value={simulatedUrl}
                      onChange={(e) => setSimulatedUrl(e.target.value)}
                      className="flex-1 px-3.5 py-2 rounded-lg border-none bg-white text-xs font-mono text-slate-900 focus:ring-2 focus:ring-blue-500 shadow-xs"
                      placeholder="https://services.gst.gov.in/..."
                    />
                  </div>
                </div>

                {/* Real-time Detection Diagnostics Box */}
                <div className="bg-slate-900 text-slate-100 rounded-xl p-5 space-y-3 font-mono text-xs shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <span className="font-semibold text-blue-400">Portal Detector Output (Live)</span>
                    <span className="text-[11px] text-slate-400">src/gst/portalDetector.ts</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[11px]">isGSTPortal:</span>
                      <span
                        className={`font-semibold ${
                          portalStatus.isGSTPortal ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {String(portalStatus.isGSTPortal)}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">isReturnsDashboard:</span>
                      <span
                        className={`font-semibold ${
                          portalStatus.isReturnsDashboard ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {String(portalStatus.isReturnsDashboard)}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">isLoggedIn (Inference):</span>
                      <span className="font-semibold text-slate-200">
                        {portalStatus.isLoggedIn === null
                          ? 'null (unknown)'
                          : String(portalStatus.isLoggedIn)}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[11px]">detectedPage:</span>
                      <span className="font-semibold text-blue-300 truncate block">
                        {portalStatus.detectedPage}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: ACCEPTANCE TEST SUITE */}
            {activeTab === 'tests' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Milestone 1, 2 & 3 Acceptance Test Suite</h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Executes 55 comprehensive tests across queue, retry accounting, GSTR-2B automation, and Milestone 3 Local Auto-Sync.
                    </p>
                  </div>

                  <button
                    id="btn-run-tests-tab"
                    onClick={handleRunTests}
                    disabled={isRunningTests}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium shadow-sm transition-colors"
                  >
                    {isRunningTests ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>{isRunningTests ? `Running (${testProgress.current}/${testProgress.total})...` : 'Run All 55 Tests'}</span>
                  </button>
                </div>

                {/* Tests summary bar */}
                {testResults.length > 0 && (
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-800">
                        Summary: {passedTestsCount} Passed, {testResults.length - passedTestsCount} Failed
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-full">
                      {passedTestsCount === testResults.length ? '100% Milestone 1, 2 & 3 Compliance (55/55)' : 'Tests in Progress'}
                    </span>
                  </div>
                )}

                {/* Test Results Table */}
                <div className="space-y-2.5">
                  {testResults.length === 0 && !isRunningTests ? (
                    <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
                      <CheckCircle2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-slate-700">No test runs executed yet</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Click "Run All 55 Tests" to perform live verification across all subsystems.
                      </p>
                    </div>
                  ) : (
                    testResults.map((t) => (
                      <div
                        key={t.id}
                        className={`p-4 rounded-xl border text-xs transition-all shadow-xs bg-white ${
                          t.passed
                            ? 'border-emerald-200/90'
                            : 'border-rose-200/90'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2.5">
                            {t.passed ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            )}
                            <span className="font-semibold text-slate-900">{t.title}</span>
                            <span className="font-mono text-[11px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200/60">
                              {t.id}
                            </span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200/60">
                              {t.category}
                            </span>
                          </div>
                          <span className="text-xs font-mono text-slate-400">
                            {t.durationMs} ms
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 ml-6.5 leading-relaxed">{t.description}</p>
                        {t.error && (
                          <p className="text-xs font-mono text-rose-700 bg-rose-50 border border-rose-200 p-2.5 rounded-lg mt-2 ml-6.5">
                            Error: {t.error}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: DOWNLOAD MONITOR & DISPATCHER */}
            {activeTab === 'downloads' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Chrome Downloads Monitor</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Test how download events (<code className="text-blue-600 font-mono">chrome.downloads.onCreated / onChanged</code>) link to active queue jobs.
                  </p>
                </div>

                {/* Dispatch Simulated Download */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider block">
                    Trigger Simulated Browser Download
                  </span>
                  <div className="flex gap-2.5">
                    <input
                      type="text"
                      value={downloadFilename}
                      onChange={(e) => setDownloadFilename(e.target.value)}
                      className="flex-1 px-3.5 py-2 rounded-lg border-none bg-white text-xs font-mono text-slate-900 focus:ring-2 focus:ring-blue-500 shadow-xs"
                      placeholder="filename.json"
                    />
                    <button
                      onClick={() => handleSimulateDownloadTrigger('complete')}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                    >
                      Trigger Complete
                    </button>
                    <button
                      onClick={() => handleSimulateDownloadTrigger('interrupted')}
                      className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm"
                    >
                      Trigger Interrupted
                    </button>
                  </div>
                </div>

                {/* Tracked Downloads List */}
                <div className="space-y-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Monitored Download Events ({simulatedDownloads.length})
                  </span>

                  {simulatedDownloads.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                      No downloads triggered yet. Click a trigger button above or start a queue test job.
                    </div>
                  ) : (
                    simulatedDownloads.map((d) => (
                      <div
                        key={d.id}
                        className="p-4 bg-white rounded-xl border border-slate-200 flex items-center justify-between text-xs shadow-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 font-mono">{d.filename}</span>
                            <span className="font-mono text-xs text-slate-400">#{d.id}</span>
                          </div>
                          <span className="text-xs text-slate-500 mt-0.5 block">{d.time}</span>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                            d.state === 'complete'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                              : d.state === 'interrupted'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
                              : 'bg-blue-50 text-blue-700 border border-blue-200/60 animate-pulse'
                          }`}
                        >
                          {d.state}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: INSTALL GUIDE & EXPORT */}
            {activeTab === 'export' && (
              <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Chrome Extension Installation Guide</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Follow these simple steps to install and test the extension directly in your Google Chrome browser.
                  </p>
                </div>

                <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-5 flex items-center justify-between shadow-xs">
                  <div>
                    <h3 className="font-semibold text-blue-950 text-sm">Download Unpacked Package</h3>
                    <p className="text-xs text-blue-800 mt-0.5">
                      Includes Manifest V3 configuration, popup, background service worker, and content detector.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadZip}
                    disabled={isExporting}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-xs transition-colors shrink-0 shadow-sm flex items-center gap-2"
                  >
                    <FolderDown className="w-4 h-4" />
                    <span>{exportSuccess ? 'ZIP Saved!' : 'Download .ZIP'}</span>
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start gap-3.5 p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <span className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center shrink-0 text-xs shadow-xs">
                      1
                    </span>
                    <div>
                      <h4 className="font-semibold text-slate-900">Extract the Extension Folder</h4>
                      <p className="text-slate-600 text-xs mt-0.5 leading-relaxed">
                        Extract the downloaded <code className="font-mono text-blue-600 bg-blue-50 px-1 py-0.5 rounded">udaan-gst-bulk-download-extension-m1.zip</code> to a folder on your computer.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5 p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <span className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center shrink-0 text-xs shadow-xs">
                      2
                    </span>
                    <div>
                      <h4 className="font-semibold text-slate-900">Open Chrome Extensions Page</h4>
                      <p className="text-slate-600 text-xs mt-0.5 leading-relaxed">
                        In Google Chrome, enter <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-800 border border-slate-200">chrome://extensions</code> in the address bar.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5 p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <span className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center shrink-0 text-xs shadow-xs">
                      3
                    </span>
                    <div>
                      <h4 className="font-semibold text-slate-900">Enable Developer Mode</h4>
                      <p className="text-slate-600 text-xs mt-0.5 leading-relaxed">
                        Toggle the <strong>Developer mode</strong> switch in the upper right corner of the Extensions page.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3.5 p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
                    <span className="w-7 h-7 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center shrink-0 text-xs shadow-xs">
                      4
                    </span>
                    <div>
                      <h4 className="font-semibold text-slate-900">Load Unpacked</h4>
                      <p className="text-slate-600 text-xs mt-0.5 leading-relaxed">
                        Click the <strong>Load unpacked</strong> button and select the extracted folder. The Udaan GST icon will appear in your Chrome toolbar!
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: ARCHITECTURE & SECURITY */}
            {activeTab === 'architecture' && (
              <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Architecture & Security Model</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Strict adherence to privacy, zero credential capture, and modular Manifest V3 design.
                  </p>
                </div>

                <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2 shadow-xs">
                  <div className="flex items-center gap-2 text-emerald-900 font-semibold">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Security & Anti-Bypass Compliance Checklist</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-emerald-950 text-xs">
                    <li><strong>No Credential Harvesting:</strong> Extension never prompts for, reads, or stores GST usernames or passwords.</li>
                    <li><strong>No CAPTCHA/OTP Automation:</strong> Users manually authenticate on the official GST portal.</li>
                    <li><strong>No External Cloud Backend:</strong> Operates 100% locally via <code className="font-mono">chrome.storage.local</code>.</li>
                    <li><strong>Restricted Host Permissions:</strong> Restricted to official GST portal (<code className="font-mono">services.gst.gov.in</code>).</li>
                  </ul>
                </div>

                <div className="bg-white p-4.5 rounded-xl border border-slate-200 space-y-3 shadow-xs">
                  <h3 className="font-semibold text-slate-900 text-xs">Milestone Roadmap</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2.5">
                      <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-semibold font-mono text-[11px]">M1 (Completed)</span>
                      <span className="text-slate-800">Extension foundation, portal detector, sequential queue engine, download monitor.</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-slate-500">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200/60 font-semibold font-mono text-[11px]">M2</span>
                      <span>GSTR-1 / GSTR-2A / GSTR-2B / GSTR-3B portal automation adapters.</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-slate-500">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200/60 font-semibold font-mono text-[11px]">M3</span>
                      <span>Udaan ↔ Extension local bridge communication.</span>
                    </div>
                    <div className="flex items-center gap-2.5 text-slate-500">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200/60 font-semibold font-mono text-[11px]">M4-M7</span>
                      <span>File classification, IndexedDB sync, local disk storage, auto-retry recovery.</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
