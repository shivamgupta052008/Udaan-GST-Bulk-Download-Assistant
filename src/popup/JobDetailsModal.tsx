import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  RotateCcw,
  Trash2,
  X,
  History,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { QueueJob } from '../queue/queueTypes';
import { formatFullDate, formatTimestamp } from '../shared/utils';

interface JobDetailsModalProps {
  job: QueueJob | null;
  isOpen: boolean;
  onClose: () => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

export const JobDetailsModal: React.FC<JobDetailsModalProps> = ({
  job,
  isOpen,
  onClose,
  onRetry,
  onRemove,
}) => {
  if (!isOpen || !job) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-mono">Job ID: {job.id}</div>
            <h2 className="text-base font-semibold text-slate-800">
              {job.returnType} — {job.gstin}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div>
              <span className="text-slate-400 block mb-0.5">Return Period</span>
              <strong className="text-slate-800 text-sm">
                {job.period} {job.financialYear}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 block mb-0.5">Status</span>
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                  job.status === 'FAILED'
                    ? 'bg-rose-100 text-rose-800'
                    : job.status === 'DOWNLOADED' || job.status === 'SYNCED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-indigo-100 text-indigo-800'
                }`}
              >
                {job.status}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block mb-0.5">Retries</span>
              <span className="text-slate-800 font-medium">
                {job.retryCount} / {job.maxRetries}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block mb-0.5">Sync Status</span>
              <span className="text-slate-800 font-medium">{job.syncStatus || 'NOT_SYNCED'}</span>
            </div>
          </div>

          {/* Error Details if any */}
          {(job.error || job.lastErrorCode) && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-rose-800">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>Error Information</span>
                {job.lastErrorCode && (
                  <span className="ml-auto px-1.5 py-0.5 bg-rose-200 text-rose-900 rounded font-mono text-[10px]">
                    {job.lastErrorCode}
                  </span>
                )}
              </div>
              <div className="text-slate-700 leading-relaxed font-sans">{job.lastErrorMessage || job.error}</div>
              {job.lastErrorAt && (
                <div className="text-[11px] text-slate-500">Occurred at: {formatFullDate(job.lastErrorAt)}</div>
              )}
            </div>
          )}

          {/* Bounded Event History Timeline */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700">
              <History className="w-4 h-4 text-indigo-600" />
              <span>Event Timeline ({job.history?.length || 0} events)</span>
            </div>

            <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100 bg-slate-50/50 font-mono">
              {!job.history || job.history.length === 0 ? (
                <div className="p-3 text-slate-400 italic text-center">No history events recorded</div>
              ) : (
                job.history.map((ev, i) => (
                  <div key={i} className="p-2.5 flex items-start gap-2 text-[11px]">
                    <span className="text-slate-400 shrink-0">{formatTimestamp(ev.timestamp)}</span>
                    <span className="px-1 py-0.2 bg-slate-200 text-slate-700 rounded text-[10px] font-semibold shrink-0">
                      {ev.status}
                    </span>
                    <span className="text-slate-600 font-sans flex-1">
                      {ev.message || 'Status transition'}
                      {ev.errorCode && (
                        <span className="ml-1 text-rose-600 font-mono">({ev.errorCode})</span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            onClick={() => {
              onRemove(job.id);
              onClose();
            }}
            className="px-3 py-1.5 text-rose-600 hover:bg-rose-50 rounded-lg font-medium transition flex items-center gap-1.5 text-xs"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove Job
          </button>

          <div className="flex items-center gap-2">
            {job.status === 'FAILED' && (
              <button
                onClick={() => {
                  onRetry(job.id);
                  onClose();
                }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition flex items-center gap-1.5 text-xs"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry Job
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-medium transition text-xs"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
