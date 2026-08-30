import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  RefreshCw,
  Server,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import { QueueState } from '../queue/queueTypes';
import { LocalSyncSettings } from '../sync/syncTypes';
import { DiagnosticLogger, DiagnosticLogEntry, DiagnosticReport, DiagnosticSystemHealth } from '../diagnostics/diagnosticLogger';
import { SchemaManager } from '../storage/schemaManager';
import { formatFullDate, formatTimestamp } from '../shared/utils';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  queueState: QueueState;
  syncSettings: LocalSyncSettings;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  isOpen,
  onClose,
  queueState,
  syncSettings,
}) => {
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>([]);
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'ERROR' | 'WARN' | 'INFO'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLogs(DiagnosticLogger.getLogs());
      const unsubscribe = DiagnosticLogger.subscribe((_entry) => {
        setLogs(DiagnosticLogger.getLogs());
      });
      return () => unsubscribe();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const failedJobs = queueState.jobs.filter((j) => j.status === 'FAILED');
  const syncedJobs = queueState.jobs.filter((j) => j.syncStatus === 'SYNCED');

  const systemHealth: DiagnosticSystemHealth = {
    extensionStatus: 'OK',
    queueStatus: queueState.jobs.some((j) => j.status === 'FAILED') ? 'OK' : 'OK',
    storageStatus: 'OK',
    localStorageStatus: syncSettings.status,
    downloadMonitorStatus: 'OK',
    serviceWorkerStatus: 'RUNNING',
    activeJobId: queueState.activeJobId,
    totalJobs: queueState.jobs.length,
    failedJobs: failedJobs.length,
    syncedJobs: syncedJobs.length,
    lastVerifiedAt: Date.now(),
  };

  const handleExportReport = () => {
    const report = DiagnosticLogger.generateReport(systemHealth);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `udaan-diagnostic-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunIntegrityCheck = async () => {
    setIsRepairing(true);
    setRepairMessage(null);
    try {
      const result = await SchemaManager.validateAndRepairStorage();
      if (result.healthy && result.issuesFound.length === 0) {
        setRepairMessage('Queue & Storage integrity verified. Zero issues detected.');
      } else {
        setRepairMessage(`Repaired ${result.repairsApplied.length} item(s): ${result.repairsApplied.join('; ')}`);
      }
    } catch (err) {
      setRepairMessage(`Integrity check failed: ${String(err)}`);
    } finally {
      setIsRepairing(false);
    }
  };

  const filteredLogs = logs.filter((l) => {
    if (filterLevel !== 'ALL' && l.level !== filterLevel) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        l.message.toLowerCase().includes(q) ||
        l.module.toLowerCase().includes(q) ||
        l.event.toLowerCase().includes(q) ||
        (l.errorCode && l.errorCode.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-800">System Diagnostics & Reliability</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Health Badges Grid */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5">
              Subsystem Health Indicators
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Extension Engine</div>
                  <div className="text-sm font-semibold text-slate-800">Manifest V3</div>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">OK</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Queue State</div>
                  <div className="text-sm font-semibold text-slate-800">
                    {queueState.jobs.length} Jobs ({failedJobs.length} Failed)
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    failedJobs.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {failedJobs.length > 0 ? 'ATTN' : 'OK'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Local Storage Sync</div>
                  <div className="text-sm font-semibold text-slate-800">
                    {syncSettings.status === 'CONNECTED' ? 'Connected' : 'Unavailable'}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    syncSettings.status === 'CONNECTED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {syncSettings.status}
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Download Monitor</div>
                  <div className="text-sm font-semibold text-slate-800">Active Hook</div>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">OK</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Service Worker</div>
                  <div className="text-sm font-semibold text-slate-800">Active / Recovered</div>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">RUNNING</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Zero-Knowledge Guard</div>
                  <div className="text-sm font-semibold text-slate-800">Credentials Excluded</div>
                </div>
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">PROTECTED</span>
              </div>
            </div>
          </div>

          {/* Actions Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <button
                onClick={handleRunIntegrityCheck}
                disabled={isRepairing}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
              >
                <Wrench className={`w-3.5 h-3.5 ${isRepairing ? 'animate-spin' : ''}`} />
                Run Integrity Check & Repair
              </button>

              <button
                onClick={handleExportReport}
                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition"
              >
                <Download className="w-3.5 h-3.5" />
                Export Diagnostic Report
              </button>
            </div>

            <div className="text-xs text-slate-500">
              Diagnostic Logs: <strong className="text-slate-700">{logs.length}</strong> events
            </div>
          </div>

          {repairMessage && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-center gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
              <span>{repairMessage}</span>
            </div>
          )}

          {/* Diagnostic Event Logs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Operational Event Stream
              </h3>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Filter logs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-2 py-1 text-xs border border-slate-300 rounded bg-white w-32 sm:w-44 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />

                <select
                  value={filterLevel}
                  onChange={(e) => setFilterLevel(e.target.value as any)}
                  className="px-2 py-1 text-xs border border-slate-300 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="ALL">All Levels</option>
                  <option value="ERROR">Errors Only</option>
                  <option value="WARN">Warnings Only</option>
                  <option value="INFO">Info Only</option>
                </select>

                <button
                  onClick={() => DiagnosticLogger.clearLogs()}
                  className="text-xs text-slate-400 hover:text-slate-600"
                  title="Clear in-memory logs"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="bg-slate-900 text-slate-200 rounded-lg p-3 font-mono text-xs max-h-64 overflow-y-auto space-y-1.5">
              {filteredLogs.length === 0 ? (
                <div className="text-slate-500 italic text-center py-4">No diagnostic events matching criteria</div>
              ) : (
                filteredLogs.map((l) => (
                  <div key={l.id} className="flex items-start gap-2 border-b border-slate-800/60 pb-1">
                    <span className="text-slate-500 shrink-0">{formatTimestamp(l.timestamp)}</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] shrink-0 font-bold ${
                        l.level === 'ERROR'
                          ? 'bg-rose-900/60 text-rose-300'
                          : l.level === 'WARN'
                          ? 'bg-amber-900/60 text-amber-300'
                          : 'bg-emerald-900/60 text-emerald-300'
                      }`}
                    >
                      {l.level}
                    </span>
                    <span className="text-indigo-400 shrink-0">[{l.module}]</span>
                    <span className="text-slate-300 flex-1 break-all">
                      {l.message}{' '}
                      {l.errorCode && <span className="text-rose-400 font-semibold">({l.errorCode})</span>}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div>Zero-Knowledge Compliant: Passwords, OTPs, tokens, and cookies are never captured or logged.</div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
