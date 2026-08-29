/**
 * Deterministic GST Portal DOM Simulator
 * Provides a standard GST Returns Dashboard & GSTR-2B Offline Download DOM container
 * for both in-browser interactive UI workbench and automated acceptance testing.
 */

export interface SimulatorOptions {
  gstin?: string;
  financialYears?: string[];
  periods?: string[];
  initialFy?: string;
  initialPeriod?: string;
  generationDelayMs?: number;
  simulateErrorOnGenerate?: string | null;
}

const DEFAULT_FYS = ['2023-24', '2024-25', '2025-26', '2026-27', '2027-28'];
const DEFAULT_PERIODS = [
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'January',
  'February',
  'March',
];

export class GSTPortalSimulator {
  private static instance: GSTPortalSimulator | null = null;
  private containerId = 'gst_portal_simulator_container';
  private generationTimer: ReturnType<typeof setTimeout> | null = null;
  private generationDelayMs = 150;
  private errorOnGenerate: string | null = null;

  public static getInstance(): GSTPortalSimulator {
    if (!this.instance) {
      this.instance = new GSTPortalSimulator();
    }
    return this.instance;
  }

  /**
   * Mounts the standard GST Returns Dashboard DOM into the active document
   */
  public mount(targetDoc?: Document, options?: SimulatorOptions): HTMLElement {
    const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
    if (!doc) {
      throw new Error('Cannot mount GST Portal Simulator: Document is undefined');
    }

    let container = doc.getElementById(this.containerId);
    if (!container) {
      container = doc.createElement('div');
      container.id = this.containerId;
      container.setAttribute('data-testid', 'gst-portal-simulator');
      // Style to render cleanly in DOM or container
      container.className = 'gst-portal-simulated-dashboard p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4';
      if (doc.body) {
        doc.body.appendChild(container);
      }
    }

    const gstin = options?.gstin || '27AABCU9603R1ZM';
    const fys = options?.financialYears || DEFAULT_FYS;
    const periods = options?.periods || DEFAULT_PERIODS;
    const initialFy = options?.initialFy || '2025-26';
    const initialPeriod = options?.initialPeriod || 'April';

    this.generationDelayMs = options?.generationDelayMs ?? 150;
    this.errorOnGenerate = options?.simulateErrorOnGenerate ?? null;

    container.innerHTML = `
      <!-- Taxpayer Header Context -->
      <div class="taxpayer-header bg-blue-900 text-white p-3 rounded-lg flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="font-bold tracking-wide">GST PORTAL</span>
          <span id="header_gstin" class="taxpayer-gstin font-mono text-blue-200 text-sm font-semibold">
            GSTIN - ${gstin}
          </span>
        </div>
        <span class="user-name text-xs text-blue-100">Welcome, M/S ACME ENTERPRISES</span>
      </div>

      <!-- Returns Dashboard Section -->
      <div id="returnsDashboard" class="returns-dashboard-container bg-white p-4 rounded-lg border border-slate-200 space-y-3">
        <h3 class="font-semibold text-slate-800 text-sm">Returns Dashboard — File Returns</h3>
        
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <!-- Financial Year Dropdown -->
          <div>
            <label for="fin_yr" class="block text-xs font-medium text-slate-700 mb-1">Financial Year</label>
            <select id="fin_yr" name="fin_yr" class="w-full text-xs p-2 border border-slate-300 rounded bg-white font-medium text-slate-800">
              <option value="">-- Select FY --</option>
              ${fys
                .map(
                  (fy) =>
                    `<option value="${fy}" ${fy === initialFy || fy.includes('2025') ? 'selected' : ''}>${fy}</option>`
                )
                .join('')}
            </select>
          </div>

          <!-- Return Period Dropdown -->
          <div>
            <label for="ret_period" class="block text-xs font-medium text-slate-700 mb-1">Return Filing Period</label>
            <select id="ret_period" name="ret_period" class="w-full text-xs p-2 border border-slate-300 rounded bg-white font-medium text-slate-800">
              <option value="">-- Select Period --</option>
              ${periods
                .map(
                  (p) =>
                    `<option value="${p}" ${p === initialPeriod ? 'selected' : ''}>${p}</option>`
                )
                .join('')}
            </select>
          </div>

          <!-- Search Button -->
          <div class="flex items-end">
            <button id="search_btn" type="button" class="btn-search w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs py-2 px-4 rounded transition-colors">
              SEARCH
            </button>
          </div>
        </div>

        <!-- Returns Cards & GSTR-2B Tile -->
        <div id="returns_cards_container" class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <!-- GSTR-2B Auto-drafted ITC Statement Card -->
          <div id="gstr2b_tile" class="card tile-gstr2b border border-blue-200 bg-blue-50/40 p-3.5 rounded-lg space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-bold text-xs text-blue-900">GSTR-2B</span>
              <span class="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-semibold">View / Download</span>
            </div>
            <p class="text-xs text-slate-600">Auto-drafted ITC Statement</p>
            <div class="flex gap-2 pt-1">
              <a id="gstr2b_download_btn" href="#/gstr2b/download" class="btn-download px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded text-center block w-full">
                DOWNLOAD
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- GSTR-2B Offline Download Section -->
      <div id="gstr2b_download_section" class="gstr2b-download-page bg-white p-4 rounded-lg border border-slate-200 space-y-3">
        <div class="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 class="font-semibold text-slate-800 text-sm">GSTR-2B — Offline Download JSON</h3>
          <span class="text-xs text-slate-500 font-mono">Form GSTR-2B</span>
        </div>

        <!-- Error Notice Banner (hidden by default) -->
        <div id="error_msg" class="alert-danger p-2.5 bg-rose-50 text-rose-800 border border-rose-200 rounded text-xs hidden">
          <!-- Error content -->
        </div>

        <!-- Action / Generate Section -->
        <div class="space-y-3">
          <p class="text-xs text-slate-600">
            Click the button below to generate the offline JSON file containing auto-drafted ITC details.
          </p>

          <button id="gen_json_btn" type="button" class="btn-generate bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold py-2 px-4 rounded shadow-sm transition-colors">
            GENERATE JSON FILE TO DOWNLOAD
          </button>

          <!-- Generation In-Progress Indicator -->
          <div id="gen_in_progress" class="alert-info p-2.5 bg-blue-50 text-blue-800 border border-blue-200 rounded text-xs hidden flex items-center gap-2">
            <span class="inline-block w-2 h-2 rounded-full bg-blue-600 animate-ping"></span>
            <span>File generation request has been received. Please wait while the portal prepares your JSON file.</span>
          </div>

          <!-- Completed Download File Link -->
          <div id="download_link_container" class="pt-2 hidden">
            <a id="download_json_link" href="blob:https://services.gst.gov.in/gstr2b-${gstin}.json" download="${gstin}_GSTR2B_${initialPeriod}_${initialFy.replace('-', '')}.json" class="btn-download-file inline-flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded shadow-sm">
              <span>Click here to download - File 1</span>
            </a>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners(container);
    return container;
  }

  /**
   * Attaches simulator event listeners for deterministic state transitions
   */
  private attachEventListeners(container: HTMLElement): void {
    const genBtn = container.querySelector<HTMLButtonElement>('#gen_json_btn');
    const inProgress = container.querySelector<HTMLElement>('#gen_in_progress');
    const dlContainer = container.querySelector<HTMLElement>('#download_link_container');
    const errorBanner = container.querySelector<HTMLElement>('#error_msg');

    if (genBtn) {
      genBtn.onclick = () => {
        if (this.errorOnGenerate) {
          if (errorBanner) {
            errorBanner.textContent = this.errorOnGenerate;
            errorBanner.classList.remove('hidden');
          }
          return;
        }

        // Transition to In Progress
        if (inProgress) inProgress.classList.remove('hidden');
        if (dlContainer) dlContainer.classList.add('hidden');
        if (errorBanner) errorBanner.classList.add('hidden');

        if (this.generationTimer) clearTimeout(this.generationTimer);

        // Deterministic transition to Ready after delay
        this.generationTimer = setTimeout(() => {
          if (inProgress) inProgress.classList.add('hidden');
          if (dlContainer) dlContainer.classList.remove('hidden');
        }, this.generationDelayMs);
      };
    }
  }

  /**
   * Sets deterministic generation delay for testing polling
   */
  public setGenerationDelay(delayMs: number): void {
    this.generationDelayMs = delayMs;
  }

  /**
   * Triggers JSON generation in the simulator
   */
  public triggerGenerate(): void {
    const doc = typeof document !== 'undefined' ? document : null;
    const btn = doc?.getElementById('gen_json_btn') as HTMLButtonElement | null;
    if (btn) {
      btn.click();
    }
  }

  /**
   * Manually sets simulator state to READY
   */
  public setReady(): void {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;
    const inProgress = doc.getElementById('gen_in_progress');
    const dlContainer = doc.getElementById('download_link_container');
    if (inProgress) inProgress.classList.add('hidden');
    if (dlContainer) dlContainer.classList.remove('hidden');
  }

  /**
   * Manually sets simulator error
   */
  public setError(msg: string): void {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;
    const errorBanner = doc.getElementById('error_msg');
    if (errorBanner) {
      errorBanner.textContent = msg;
      errorBanner.classList.remove('hidden');
    }
  }

  /**
   * Resets simulator state
   */
  public reset(): void {
    if (this.generationTimer) {
      clearTimeout(this.generationTimer);
      this.generationTimer = null;
    }
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return;
    const inProgress = doc.getElementById('gen_in_progress');
    const dlContainer = doc.getElementById('download_link_container');
    const errorBanner = doc.getElementById('error_msg');
    if (inProgress) inProgress.classList.add('hidden');
    if (dlContainer) dlContainer.classList.add('hidden');
    if (errorBanner) {
      errorBanner.textContent = '';
      errorBanner.classList.add('hidden');
    }
  }

  /**
   * Ensures the simulator DOM exists in the current environment
   */
  public static ensureMounted(doc?: Document, options?: SimulatorOptions): HTMLElement {
    return GSTPortalSimulator.getInstance().mount(doc, options);
  }
}
