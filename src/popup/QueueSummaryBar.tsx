import React from 'react';
import { QueueJob } from '../queue/queueTypes';

interface QueueSummaryBarProps {
  jobs: QueueJob[];
  activeJobId?: string | null;
}

export const QueueSummaryBar: React.FC<QueueSummaryBarProps> = ({ jobs, activeJobId }) => {
  const total = jobs.length;
  const pending = jobs.filter((j) => j.status === 'PENDING').length;
  const active = jobs.filter(
    (j) =>
      j.status === 'NAVIGATING' ||
      j.status === 'PAGE_READY' ||
      j.status === 'GENERATING' ||
      j.status === 'WAITING_FOR_DOWNLOAD' ||
      j.status === 'VALIDATING' ||
      j.id === activeJobId
  ).length;
  const downloaded = jobs.filter((j) => j.status === 'DOWNLOADED').length;
  const synced = jobs.filter((j) => j.syncStatus === 'SYNCED' || j.status === 'SYNCED').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;

  return (
    <section
      id="queue-summary-bar"
      className="grid grid-cols-3 sm:grid-cols-6 gap-2 bg-white p-2.5 rounded-xl border border-slate-200 text-center shadow-sm"
    >
      {/* Total */}
      <div id="metric-total" className="p-2 rounded-lg bg-slate-50 border border-slate-100">
        <span className="block text-sm font-bold text-slate-900 font-mono">{total}</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          Total
        </span>
      </div>

      {/* Pending */}
      <div id="metric-pending" className="p-2 rounded-lg bg-slate-50 border border-slate-100">
        <span className="block text-sm font-bold text-slate-700 font-mono">{pending}</span>
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          Pending
        </span>
      </div>

      {/* Active */}
      <div id="metric-active" className="p-2 rounded-lg bg-blue-50/80 border border-blue-100">
        <span className="block text-sm font-bold text-blue-700 font-mono">{active}</span>
        <span className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">
          Active
        </span>
      </div>

      {/* Downloaded */}
      <div id="metric-downloaded" className="p-2 rounded-lg bg-indigo-50/80 border border-indigo-100">
        <span className="block text-sm font-bold text-indigo-700 font-mono">{downloaded}</span>
        <span className="text-[10px] uppercase tracking-wider text-indigo-600 font-semibold">
          Downloaded
        </span>
      </div>

      {/* Synced */}
      <div id="metric-synced" className="p-2 rounded-lg bg-emerald-50/80 border border-emerald-100">
        <span className="block text-sm font-bold text-emerald-700 font-mono">{synced}</span>
        <span className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">
          Synced
        </span>
      </div>

      {/* Failed */}
      <div id="metric-failed" className="p-2 rounded-lg bg-rose-50/80 border border-rose-100">
        <span className="block text-sm font-bold text-rose-700 font-mono">{failed}</span>
        <span className="text-[10px] uppercase tracking-wider text-rose-600 font-semibold">
          Failed
        </span>
      </div>
    </section>
  );
};
