import React, { useState, useRef } from 'react';
import {
  Download,
  Upload,
  AlertCircle,
  CheckCircle2,
  FileJson,
  X,
  RefreshCw,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { BackupManager, UdaanBackupData, BackupValidationResult, RestoreResult } from '../storage/backupManager';
import { QueueState } from '../queue/queueTypes';
import { formatFullDate } from '../shared/utils';

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  queueState: QueueState;
  onRestoreComplete: () => void;
}

export const BackupRestoreModal: React.FC<BackupRestoreModalProps> = ({
  isOpen,
  onClose,
  queueState,
  onRestoreComplete,
}) => {
  const [activeTab, setActiveTab] = useState<'EXPORT' | 'IMPORT'>('EXPORT');
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [strategy, setStrategy] = useState<'REPLACE' | 'MERGE'>('MERGE');

  // Import file validation state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationResult, setValidationResult] = useState<BackupValidationResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const data = await BackupManager.exportBackup();
      const filename = BackupManager.getExportFilename();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setRestoreResult(null);

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const result = BackupManager.validateBackup(json);
      setValidationResult(result);
    } catch (err) {
      setValidationResult({
        valid: false,
        errors: [`Malformed JSON file: ${String(err)}`],
        warnings: [],
        totalJobs: 0,
      });
    }
  };

  const handleExecuteRestore = async () => {
    if (!validationResult || !validationResult.valid || !validationResult.parsed) return;

    setIsRestoring(true);
    try {
      const result = await BackupManager.restoreBackup(validationResult.parsed, strategy);
      setRestoreResult(result);
      if (result.success) {
        onRestoreComplete();
      }
    } catch (err) {
      setRestoreResult({
        success: false,
        strategy,
        jobsRestored: 0,
        jobsSkipped: 0,
        jobsOverwritten: 0,
        error: String(err),
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-800">Queue Backup & Restore</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-5 pt-3 border-b border-slate-200 flex gap-4">
          <button
            onClick={() => setActiveTab('EXPORT')}
            className={`pb-3 text-sm font-medium border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'EXPORT'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Download className="w-4 h-4" />
            Export Backup
          </button>
          <button
            onClick={() => setActiveTab('IMPORT')}
            className={`pb-3 text-sm font-medium border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'IMPORT'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Upload className="w-4 h-4" />
            Import / Restore
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'EXPORT' ? (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">Backup Scope & Safety</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Exporting creates a structured JSON file with your current bulk download queue, retry metadata, and local directory configurations.
                </p>
                <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium pt-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Strictly excludes passwords, OTPs, CAPTCHAs, secret tokens, and session cookies.</span>
                </div>
              </div>

              <div className="p-3 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                <span className="text-slate-500">Current Queue Size</span>
                <strong className="text-slate-800">{queueState.jobs.length} Download Jobs</strong>
              </div>

              <button
                onClick={handleExportBackup}
                disabled={isExporting}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm transition flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                {isExporting ? 'Generating JSON...' : 'Download Backup File (.json)'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File Selector */}
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".json,application/json"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full p-4 border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-lg text-center bg-slate-50 hover:bg-indigo-50/30 transition cursor-pointer flex flex-col items-center gap-2"
                >
                  <FileJson className="w-8 h-8 text-indigo-500" />
                  <div className="text-sm font-medium text-slate-700">
                    {selectedFile ? selectedFile.name : 'Select or drop backup JSON file'}
                  </div>
                  <div className="text-xs text-slate-400">udaan-gst-backup-YYYY-MM-DD.json</div>
                </button>
              </div>

              {/* Validation Feedback */}
              {validationResult && (
                <div
                  className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                    validationResult.valid
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    {validationResult.valid ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Valid Udaan Backup (v{validationResult.schemaVersion || 1})</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 text-rose-600" />
                        <span>Invalid Backup Structure</span>
                      </>
                    )}
                  </div>
                  <div>Contains: {validationResult.totalJobs} download jobs</div>

                  {validationResult.errors.length > 0 && (
                    <div className="text-rose-700 pl-5 list-disc space-y-0.5">
                      {validationResult.errors.map((err, i) => (
                        <div key={i}>• {err}</div>
                      ))}
                    </div>
                  )}

                  {validationResult.warnings.length > 0 && (
                    <div className="text-amber-700 pl-5 list-disc space-y-0.5">
                      {validationResult.warnings.map((w, i) => (
                        <div key={i}>• {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Restore Strategy Selection */}
              {validationResult?.valid && (
                <div className="space-y-2 pt-1">
                  <label className="text-xs font-semibold text-slate-700">Restore Strategy</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setStrategy('MERGE')}
                      className={`p-2.5 rounded-lg border text-left text-xs transition ${
                        strategy === 'MERGE'
                          ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600 font-medium text-slate-800'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <div className="font-semibold text-indigo-900 mb-0.5">Merge (Recommended)</div>
                      <div className="text-[11px] text-slate-500">
                        Adds new jobs & preserves existing completed files.
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setStrategy('REPLACE')}
                      className={`p-2.5 rounded-lg border text-left text-xs transition ${
                        strategy === 'REPLACE'
                          ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600 font-medium text-slate-800'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <div className="font-semibold text-indigo-900 mb-0.5">Replace Queue</div>
                      <div className="text-[11px] text-slate-500">
                        Overwrites current queue with the backup jobs entirely.
                      </div>
                    </button>
                  </div>

                  <button
                    onClick={handleExecuteRestore}
                    disabled={isRestoring}
                    className="w-full mt-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm transition flex items-center justify-center gap-2"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRestoring ? 'animate-spin' : ''}`} />
                    {isRestoring ? 'Restoring Queue...' : `Apply Restore (${strategy})`}
                  </button>
                </div>
              )}

              {/* Restore Results */}
              {restoreResult && (
                <div
                  className={`p-3 rounded-lg border text-xs space-y-1 ${
                    restoreResult.success
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <div className="font-semibold">
                    {restoreResult.success ? 'Restore Succeeded' : 'Restore Failed'}
                  </div>
                  <div>
                    Jobs Restored: {restoreResult.jobsRestored} | Overwritten: {restoreResult.jobsOverwritten} | Skipped: {restoreResult.jobsSkipped}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end text-xs">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
