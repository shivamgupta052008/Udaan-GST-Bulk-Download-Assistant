import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Layers,
  Sparkles,
  CheckSquare,
  Square,
  AlertTriangle,
  CheckCircle2,
  X,
  ArrowRight,
  RefreshCw,
  Building2,
  FileCheck,
} from 'lucide-react';
import { ReturnType, FinancialYear, ReturnPeriod } from '../gst/returnTypes';
import {
  DEFAULT_FINANCIAL_YEARS,
  RETURN_PERIODS,
  SUPPORTED_RETURN_TYPES,
} from '../shared/constants';
import { QueueJob } from '../queue/queueTypes';
import { BulkPlanner, BulkPlanPreview, BulkCreationResult } from '../queue/bulkPlanner';

interface BulkJobPlannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingJobs: QueueJob[];
  onBulkCreated: (result: BulkCreationResult) => void;
}

export const BulkJobPlannerModal: React.FC<BulkJobPlannerModalProps> = ({
  isOpen,
  onClose,
  existingJobs,
  onBulkCreated,
}) => {
  const [step, setStep] = useState<'PLAN' | 'PREVIEW'>('PLAN');
  const [gstin, setGstin] = useState('27AABCU9603R1ZM');
  const [companyName, setCompanyName] = useState('My Company');
  const [financialYear, setFinancialYear] = useState<FinancialYear>('2025-2026');
  const [selectedPeriods, setSelectedPeriods] = useState<ReturnPeriod[]>([
    'April',
    'May',
    'June',
    'July',
  ]);
  const [selectedReturnTypes, setSelectedReturnTypes] = useState<ReturnType[]>([
    'GSTR-1',
    'GSTR-2A',
    'GSTR-2B',
    'GSTR-3B',
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Calculate live plan preview
  const preview: BulkPlanPreview = useMemo(() => {
    return BulkPlanner.calculatePlan(
      {
        gstin: gstin.trim().toUpperCase() || '27AABCU9603R1ZM',
        companyName: companyName.trim() || undefined,
        financialYear,
        periods: selectedPeriods,
        returnTypes: selectedReturnTypes,
      },
      existingJobs
    );
  }, [gstin, companyName, financialYear, selectedPeriods, selectedReturnTypes, existingJobs]);

  if (!isOpen) return null;

  const togglePeriod = (period: ReturnPeriod) => {
    setSelectedPeriods((prev) =>
      prev.includes(period) ? prev.filter((p) => p !== period) : [...prev, period]
    );
  };

  const selectAllPeriods = () => {
    setSelectedPeriods([...RETURN_PERIODS]);
  };

  const clearAllPeriods = () => {
    setSelectedPeriods([]);
  };

  const selectQuarter = (months: ReturnPeriod[]) => {
    setSelectedPeriods((prev) => {
      const set = new Set([...prev, ...months]);
      return Array.from(set);
    });
  };

  const toggleReturnType = (type: ReturnType) => {
    setSelectedReturnTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const selectAllReturnTypes = () => {
    setSelectedReturnTypes([...SUPPORTED_RETURN_TYPES]);
  };

  const clearAllReturnTypes = () => {
    setSelectedReturnTypes([]);
  };

  const handleProceedToPreview = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPeriods.length === 0 || selectedReturnTypes.length === 0) {
      return;
    }
    setStep('PREVIEW');
  };

  const handleConfirmCreate = async () => {
    setIsSubmitting(true);
    try {
      const result = await BulkPlanner.executeBulkCreation(
        {
          gstin: gstin.trim().toUpperCase() || '27AABCU9603R1ZM',
          companyName: companyName.trim() || undefined,
          financialYear,
          periods: selectedPeriods,
          returnTypes: selectedReturnTypes,
        },
        { isTestJob: true }
      );
      onBulkCreated(result);
      onClose();
      setStep('PLAN');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="bulk-job-planner-backdrop"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      <div
        id="bulk-job-planner-dialog"
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] text-slate-900 animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white font-bold text-sm shadow-sm">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                {step === 'PLAN' ? 'Bulk Job Planner' : 'Bulk Job Preview & Confirmation'}
              </h2>
              <p className="text-[11px] text-slate-400">
                {step === 'PLAN'
                  ? 'Plan multi-period, multi-return batch downloads'
                  : 'Verify duplicate protection and job creation batch'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Close Planner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {step === 'PLAN' ? (
            <form onSubmit={handleProceedToPreview} className="space-y-4">
              {/* GSTIN & Company Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                    GSTIN Identifier <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    placeholder="27AABCU9603R1ZM"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-hidden transition-all"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                    Company / Trade Name
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="My Company (Optional)"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-hidden transition-all"
                    />
                    <Building2 className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Financial Year Selection */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1 uppercase tracking-wider">
                  Financial Year <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {DEFAULT_FINANCIAL_YEARS.map((fy) => (
                    <button
                      key={fy}
                      type="button"
                      onClick={() => setFinancialYear(fy)}
                      className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition-all ${
                        financialYear === fy
                          ? 'bg-blue-50 border-blue-500 text-blue-700 font-semibold shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {fy}
                    </button>
                  ))}
                </div>
              </div>

              {/* Return Types Multi-Selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                    Return Types ({selectedReturnTypes.length} of {SUPPORTED_RETURN_TYPES.length})
                  </label>
                  <div className="flex items-center gap-2 text-[10.5px]">
                    <button
                      type="button"
                      onClick={selectAllReturnTypes}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Select All
                    </button>
                    <span className="text-slate-300">•</span>
                    <button
                      type="button"
                      onClick={clearAllReturnTypes}
                      className="text-slate-500 hover:text-slate-700 font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {SUPPORTED_RETURN_TYPES.map((rt) => {
                    const isChecked = selectedReturnTypes.includes(rt);
                    return (
                      <button
                        key={rt}
                        type="button"
                        onClick={() => toggleReturnType(rt)}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                          isChecked
                            ? 'bg-blue-50/80 border-blue-500 text-blue-900 font-bold shadow-xs'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <span className="font-mono text-xs">{rt}</span>
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Return Periods / Months Multi-Selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                  <label className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                    Return Periods / Months ({selectedPeriods.length} of {RETURN_PERIODS.length})
                  </label>
                  <div className="flex items-center gap-2 text-[10.5px]">
                    <button
                      type="button"
                      onClick={selectAllPeriods}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      All 12 Mo
                    </button>
                    <span className="text-slate-300">•</span>
                    <button
                      type="button"
                      onClick={() => selectQuarter(['April', 'May', 'June'])}
                      className="text-slate-600 hover:text-slate-900 font-medium"
                    >
                      Q1
                    </button>
                    <button
                      type="button"
                      onClick={() => selectQuarter(['July', 'August', 'September'])}
                      className="text-slate-600 hover:text-slate-900 font-medium"
                    >
                      Q2
                    </button>
                    <button
                      type="button"
                      onClick={() => selectQuarter(['October', 'November', 'December'])}
                      className="text-slate-600 hover:text-slate-900 font-medium"
                    >
                      Q3
                    </button>
                    <button
                      type="button"
                      onClick={() => selectQuarter(['January', 'February', 'March'])}
                      className="text-slate-600 hover:text-slate-900 font-medium"
                    >
                      Q4
                    </button>
                    <span className="text-slate-300">•</span>
                    <button
                      type="button"
                      onClick={clearAllPeriods}
                      className="text-slate-500 hover:text-slate-700 font-medium"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  {RETURN_PERIODS.map((period) => {
                    const isChecked = selectedPeriods.includes(period);
                    return (
                      <button
                        key={period}
                        type="button"
                        onClick={() => togglePeriod(period)}
                        className={`flex items-center justify-between p-2 rounded-lg border text-left transition-all ${
                          isChecked
                            ? 'bg-blue-50 border-blue-400 text-blue-900 font-semibold shadow-2xs'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <span className="text-[11px] truncate">{period}</span>
                        {isChecked ? (
                          <CheckSquare className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Job Plan Live Calculation Box */}
              <div className="p-3 bg-slate-900 text-white rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                    Planned Job Formula
                  </span>
                  <p className="text-xs text-slate-200 mt-0.5">
                    <strong className="text-white font-mono">{selectedPeriods.length} periods</strong> ×{' '}
                    <strong className="text-white font-mono">{selectedReturnTypes.length} returns</strong>
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                    Total Planned
                  </span>
                  <span className="text-base font-bold text-blue-400 font-mono">
                    {preview.totalRequested} jobs
                  </span>
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg text-xs transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={selectedPeriods.length === 0 || selectedReturnTypes.length === 0}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg text-xs shadow-sm flex items-center gap-1.5 transition-all"
                >
                  <span>Review Bulk Plan ({preview.totalRequested} Jobs)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          ) : (
            /* PREVIEW SCREEN (Phase 3) */
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Target GSTIN:</span>
                  <span className="font-mono font-bold text-slate-900">{preview.gstin}</span>
                </div>
                {preview.companyName && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">Company Name:</span>
                    <span className="font-semibold text-slate-800">{preview.companyName}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Financial Year:</span>
                  <span className="font-mono font-semibold text-slate-800">{preview.financialYear}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Selected Periods ({preview.selectedPeriods.length}):</span>
                  <span className="text-slate-700 text-right truncate max-w-[220px]">
                    {preview.selectedPeriods.join(', ')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Selected Returns ({preview.selectedReturnTypes.length}):</span>
                  <span className="font-mono font-bold text-blue-600">
                    {preview.selectedReturnTypes.join(', ')}
                  </span>
                </div>
              </div>

              {/* Duplicate & Creation Metrics */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-3 bg-slate-100 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold block">
                    Total Requested
                  </span>
                  <span className="text-base font-bold text-slate-900 font-mono">
                    {preview.totalRequested}
                  </span>
                </div>
                <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200">
                  <span className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold block">
                    Already in Queue
                  </span>
                  <span className="text-base font-bold text-amber-700 font-mono">
                    {preview.duplicateCount}
                  </span>
                </div>
                <div className="p-3 bg-emerald-50/80 rounded-xl border border-emerald-200">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold block">
                    New Jobs to Create
                  </span>
                  <span className="text-base font-bold text-emerald-700 font-mono">
                    {preview.newJobsCount}
                  </span>
                </div>
              </div>

              {/* Duplicates Warning if any */}
              {preview.duplicateCount > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-950">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{preview.duplicateCount} duplicate jobs will be skipped safely</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-snug">
                    Jobs for these returns are already queued or downloaded. Udaan prevents duplicate downloads automatically.
                  </p>
                  <div className="max-h-24 overflow-y-auto space-y-1 pt-1">
                    {preview.duplicates.map((dup, idx) => (
                      <div
                        key={idx}
                        className="text-[10.5px] bg-white/80 px-2 py-1 rounded border border-amber-200/60 font-mono flex items-center justify-between text-slate-800"
                      >
                        <span>
                          {dup.returnType} • {dup.period} {dup.financialYear}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">
                          {dup.existingStatus}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bottom Actions */}
              <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStep('PLAN')}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg text-xs transition-colors"
                >
                  Back to Edit
                </button>

                <button
                  type="button"
                  onClick={handleConfirmCreate}
                  disabled={isSubmitting || preview.newJobsCount === 0}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold rounded-lg text-xs shadow-sm flex items-center gap-1.5 transition-all"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating Jobs...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Create {preview.newJobsCount} New Jobs</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
