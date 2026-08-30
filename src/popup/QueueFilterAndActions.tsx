import React from 'react';
import {
  Search,
  Filter,
  CheckSquare,
  Square,
  RotateCcw,
  Trash2,
  HardDrive,
  X,
  AlertTriangle,
} from 'lucide-react';
import { ReturnType } from '../gst/returnTypes';
import { QueueJob, QueueStatus } from '../queue/queueTypes';
import { QueueFilterState } from '../queue/bulkPlanner';
import { SUPPORTED_RETURN_TYPES, DEFAULT_FINANCIAL_YEARS } from '../shared/constants';

interface QueueFilterAndActionsProps {
  filters: QueueFilterState;
  onFilterChange: (filters: QueueFilterState) => void;
  onResetFilters: () => void;
  availableGstins: string[];
  availableFinancialYears: string[];
  totalJobsCount: number;
  visibleJobsCount: number;
  selectedJobIds: string[];
  onToggleSelectAllVisible: () => void;
  onClearSelection: () => void;
  isAllVisibleSelected: boolean;
  onRetrySelected: () => void;
  onRemoveSelected: () => void;
  onSyncSelected: () => void;
  isRetrying?: boolean;
  isSyncing?: boolean;
  retryableCount: number;
  syncableCount: number;
}

export const QueueFilterAndActions: React.FC<QueueFilterAndActionsProps> = ({
  filters,
  onFilterChange,
  onResetFilters,
  availableGstins,
  availableFinancialYears,
  totalJobsCount,
  visibleJobsCount,
  selectedJobIds,
  onToggleSelectAllVisible,
  onClearSelection,
  isAllVisibleSelected,
  onRetrySelected,
  onRemoveSelected,
  onSyncSelected,
  isRetrying = false,
  isSyncing = false,
  retryableCount,
  syncableCount,
}) => {
  const isFiltered =
    filters.status !== 'ALL' ||
    filters.returnType !== 'ALL' ||
    filters.financialYear !== 'ALL' ||
    filters.gstin !== 'ALL' ||
    filters.searchQuery.trim().length > 0;

  // Merge default and dynamic FYs uniquely
  const allFys = Array.from(
    new Set([...DEFAULT_FINANCIAL_YEARS, ...availableFinancialYears])
  ).filter(Boolean);

  return (
    <section id="queue-filter-and-actions" className="space-y-2.5">
      {/* Search and Filter Inputs Bar */}
      <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-sm space-y-2 text-xs">
        <div className="flex items-center gap-2">
          {/* Search Box */}
          <div className="relative flex-1">
            <input
              id="input-queue-search"
              type="text"
              value={filters.searchQuery}
              onChange={(e) => onFilterChange({ ...filters, searchQuery: e.target.value })}
              placeholder="Search GSTIN, company, job ID, period..."
              className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-hidden transition-all"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
            {filters.searchQuery && (
              <button
                onClick={() => onFilterChange({ ...filters, searchQuery: '' })}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Reset Filters button if any active */}
          {isFiltered && (
            <button
              id="btn-reset-filters"
              onClick={onResetFilters}
              className="px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors shrink-0"
              title="Reset all filters"
            >
              Reset Filters
            </button>
          )}
        </div>

        {/* Filter Dropdowns Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {/* Status Filter */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">
              Status
            </label>
            <select
              id="select-filter-status"
              value={filters.status}
              onChange={(e) =>
                onFilterChange({ ...filters, status: e.target.value as QueueFilterState['status'] })
              }
              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-[11px] text-slate-800 focus:ring-2 focus:ring-blue-500 focus:bg-white outline-hidden"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">PENDING</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="DOWNLOADED">DOWNLOADED</option>
              <option value="SYNCED">SYNCED</option>
              <option value="FAILED">FAILED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>

          {/* Return Type Filter */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">
              Return Type
            </label>
            <select
              id="select-filter-return-type"
              value={filters.returnType}
              onChange={(e) =>
                onFilterChange({
                  ...filters,
                  returnType: e.target.value as QueueFilterState['returnType'],
                })
              }
              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-[11px] text-slate-800 focus:ring-2 focus:ring-blue-500 focus:bg-white outline-hidden"
            >
              <option value="ALL">All Types</option>
              {SUPPORTED_RETURN_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {rt}
                </option>
              ))}
            </select>
          </div>

          {/* Financial Year Filter */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">
              Financial Year
            </label>
            <select
              id="select-filter-fy"
              value={filters.financialYear}
              onChange={(e) => onFilterChange({ ...filters, financialYear: e.target.value })}
              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-[11px] text-slate-800 focus:ring-2 focus:ring-blue-500 focus:bg-white outline-hidden"
            >
              <option value="ALL">All FYs</option>
              {allFys.map((fy) => (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              ))}
            </select>
          </div>

          {/* GSTIN Filter */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-0.5">
              GSTIN
            </label>
            <select
              id="select-filter-gstin"
              value={filters.gstin}
              onChange={(e) => onFilterChange({ ...filters, gstin: e.target.value })}
              className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-md text-[11px] text-slate-800 focus:ring-2 focus:ring-blue-500 focus:bg-white outline-hidden font-mono"
            >
              <option value="ALL">All GSTINs</option>
              {availableGstins.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Filter Results Counter */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px] text-slate-500">
          <span>
            Showing <strong className="text-slate-800 font-semibold">{visibleJobsCount}</strong> of{' '}
            <strong className="text-slate-800 font-semibold">{totalJobsCount}</strong> jobs
          </span>
          {isFiltered && (
            <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200/60 font-medium">
              Filtered View
            </span>
          )}
        </div>
      </div>

      {/* Selection & Bulk Actions Bar */}
      {visibleJobsCount > 0 && (
        <div
          id="queue-selection-actions-bar"
          className="bg-slate-900 text-white rounded-xl p-2.5 shadow-sm flex items-center justify-between gap-2 flex-wrap text-xs"
        >
          {/* Select All Checkbox & Count */}
          <div className="flex items-center gap-2">
            <button
              id="btn-select-all-visible"
              onClick={onToggleSelectAllVisible}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition-colors"
              title="Select or deselect all visible jobs matching filters"
            >
              {isAllVisibleSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>{isAllVisibleSelected ? 'Deselect All' : 'Select All Visible'}</span>
            </button>

            {selectedJobIds.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10.5px] font-bold border border-blue-400/30">
                {selectedJobIds.length} Selected
              </span>
            )}
          </div>

          {/* Bulk Action Buttons (Visible when jobs are selected) */}
          {selectedJobIds.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Retry Selected (Only active if failed jobs are selected) */}
              <button
                id="btn-bulk-retry"
                onClick={onRetrySelected}
                disabled={retryableCount === 0 || isRetrying}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:hover:bg-amber-600 text-white rounded text-[11px] font-semibold transition-colors"
                title={
                  retryableCount > 0
                    ? `Retry ${retryableCount} failed jobs in selection`
                    : 'No failed jobs in selection'
                }
              >
                <RotateCcw className="w-3 h-3" />
                <span>Retry ({retryableCount})</span>
              </button>

              {/* Sync Selected (Only active if downloaded jobs are selected) */}
              <button
                id="btn-bulk-sync"
                onClick={onSyncSelected}
                disabled={syncableCount === 0 || isSyncing}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white rounded text-[11px] font-semibold transition-colors"
                title={
                  syncableCount > 0
                    ? `Sync ${syncableCount} downloaded jobs in selection`
                    : 'No downloaded jobs in selection'
                }
              >
                <HardDrive className="w-3 h-3" />
                <span>Sync ({syncableCount})</span>
              </button>

              {/* Remove Selected */}
              <button
                id="btn-bulk-remove"
                onClick={onRemoveSelected}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-semibold transition-colors"
                title="Remove selected jobs from queue"
              >
                <Trash2 className="w-3 h-3" />
                <span>Remove ({selectedJobIds.length})</span>
              </button>

              {/* Clear Selection */}
              <button
                id="btn-clear-selection"
                onClick={onClearSelection}
                className="px-2 py-1 text-slate-400 hover:text-white text-[11px] transition-colors"
                title="Clear current job selection"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
