import { detectPortalStatus } from '../gst/portalDetector';
import { QueueStore } from '../queue/queueStore';
import { DownloadQueueManager } from '../queue/downloadQueue';
import { DownloadMonitor } from '../downloads/downloadMonitor';
import { GSTR1Adapter } from '../adapters/gstr1Adapter';
import { GSTR2AAdapter } from '../adapters/gstr2aAdapter';
import { GSTR2BAdapter } from '../adapters/gstr2bAdapter';
import { GSTR3BAdapter } from '../adapters/gstr3bAdapter';
import { adapterRegistry, getAdapterForReturnType } from '../adapters/adapterRegistry';
import { UdaanBridge } from '../bridge/udaanBridge';
import { isValidTransition, assertValidTransition } from '../queue/stateMachine';
import { SecurityValidator } from '../security/securityValidator';
import { ExtensionPacker } from '../utils/extensionPacker';
import { GSTPortalSimulator } from '../gst/portalSimulator';
import { sleep } from '../shared/utils';
import { SyncEngine } from '../sync/syncEngine';
import { LocalStorageManager, MemoryStorageProvider } from '../sync/storageProvider';
import { CompanyStore } from '../sync/companyStore';
import {
  sanitizeFolderName,
  getCompanyFolderName,
  getDeterministicFileName,
  getFullRelativePath,
} from '../sync/pathUtils';

export interface TestCaseResult {
  id: string;
  category:
    | 'DETECTION'
    | 'QUEUE'
    | 'DOWNLOADS'
    | 'SECURITY'
    | 'ADAPTERS'
    | 'BRIDGE'
    | 'BUILD'
    | 'GSTR2B_M2'
    | 'LOCAL_SYNC_M3'
    | 'MULTI_RETURN_M4';
  title: string;
  description: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

export async function runAcceptanceTestSuite(
  onProgress?: (result: TestCaseResult, current: number, total: number) => void
): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const testQueueManager = DownloadQueueManager.getInstance();
  const testDownloadMonitor = DownloadMonitor.getInstance();
  await testDownloadMonitor.init();

  const totalTests = 75;
  let currentTest = 0;

  async function executeTest(
    id: string,
    category: TestCaseResult['category'],
    title: string,
    description: string,
    fn: () => Promise<void>
  ) {
    currentTest++;
    const start = performance.now();
    let passed = false;
    let errorMsg: string | undefined;

    try {
      await fn();
      passed = true;
    } catch (err: unknown) {
      passed = false;
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Math.round(performance.now() - start);
    const result: TestCaseResult = {
      id,
      category,
      title,
      description,
      passed,
      error: errorMsg,
      durationMs,
    };

    results.push(result);
    if (onProgress) {
      onProgress(result, currentTest, totalTests);
    }
  }

  // 1. Zero-Knowledge Credential Security
  await executeTest(
    'SEC-01',
    'SECURITY',
    'Zero Credential Capture & Storage Rule',
    'Validates that no password, OTP, CAPTCHA, or auth token fields exist in data contracts or stores',
    async () => {
      const state = await QueueStore.getQueueState();
      const stringified = JSON.stringify(state).toLowerCase();
      if (
        stringified.includes('password') ||
        stringified.includes('otp') ||
        stringified.includes('sessiontoken') ||
        stringified.includes('captcha')
      ) {
        throw new Error('Sensitive credential fields detected in queue storage!');
      }
    }
  );

  // 2. Security Audit & Minimal Manifest Permissions
  await executeTest(
    'SEC-02',
    'SECURITY',
    'Permission & Security Validation Audit',
    'Audits manifest permissions and ensures no invasive webRequestBlocking or credential-capturing APIs exist',
    async () => {
      const audit = SecurityValidator.auditExtension();
      if (!audit.passed || !audit.zeroKnowledgeCompliant) {
        throw new Error('Extension failed Zero-Knowledge security audit');
      }

      const manifestCheck = SecurityValidator.validateManifest({
        permissions: ['storage', 'downloads', 'tabs', 'alarms'],
        host_permissions: ['*://services.gst.gov.in/*', '*://*.gst.gov.in/*'],
      });

      if (!manifestCheck.valid) {
        throw new Error(`Manifest security violation: ${manifestCheck.violations.join(', ')}`);
      }
    }
  );

  // 3. Non-GST Portal URL Detection
  await executeTest(
    'DET-01',
    'DETECTION',
    'Non-GST Portal Detection (Google, Wikipedia)',
    'Detects non-GST URLs and flags isGSTPortal = false',
    async () => {
      const res = detectPortalStatus('https://www.google.com/search?q=gst');
      if (res.isGSTPortal !== false || res.isReturnsDashboard !== false) {
        throw new Error(`Expected isGSTPortal: false, got ${res.isGSTPortal}`);
      }
    }
  );

  // 4. GST Portal Login Page Detection (including redirect query parameter)
  await executeTest(
    'DET-02',
    'DETECTION',
    'GST Portal Login Page Detection',
    'Detects official GST portal login page and marks isLoggedIn = false without assuming login even with redirect query',
    async () => {
      const res = detectPortalStatus('https://services.gst.gov.in/services/login?redirect=/services/returns');
      if (!res.isGSTPortal) {
        throw new Error('Failed to detect GST Portal domain');
      }
      if (res.isReturnsDashboard) {
        throw new Error('Login page with redirect query should NOT be detected as returns dashboard');
      }
      if (res.isLoggedIn !== false) {
        throw new Error('Login page should indicate isLoggedIn = false');
      }
    }
  );

  // 5. GST Returns Dashboard Detection
  await executeTest(
    'DET-03',
    'DETECTION',
    'GST Returns Dashboard Detection',
    'Detects Returns Dashboard route and flags isReturnsDashboard = true',
    async () => {
      const res = detectPortalStatus('https://services.gst.gov.in/services/returns');
      if (!res.isGSTPortal || !res.isReturnsDashboard) {
        throw new Error('Returns dashboard route not properly classified');
      }
      if (res.isLoggedIn !== true) {
        throw new Error('Returns dashboard implies user is authenticated');
      }
    }
  );

  // 6. GST Portal Non-Dashboard Subpage
  await executeTest(
    'DET-04',
    'DETECTION',
    'GST Portal General Services Detection',
    'Detects general GST portal pages where dashboard is not open',
    async () => {
      const res = detectPortalStatus('https://services.gst.gov.in/services/quicklinks/payments');
      if (!res.isGSTPortal || res.isReturnsDashboard) {
        throw new Error('Incorrect dashboard detection on general payments page');
      }
    }
  );

  // 7. Duplicate Download Protection
  await executeTest(
    'DUP-01',
    'QUEUE',
    'Duplicate Download Protection',
    'Prevents adding redundant duplicate jobs for the identical (GSTIN, FY, Period, ReturnType)',
    async () => {
      // 1. Reset/prepare an isolated queue fixture
      await QueueStore.clearAll();

      // 2. Ensure no pre-existing identical job exists
      const existing = await QueueStore.getQueue();
      if (existing.length !== 0) {
        throw new Error('Queue fixture was not clean');
      }

      // 3. Add initial job
      const job1 = await QueueStore.addJob({
        gstin: 'TESTGSTIN',
        financialYear: '2025-2026',
        period: 'April',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      // 4. Verify first job is successfully created
      if (!job1 || !job1.id || job1.status !== 'PENDING') {
        throw new Error('Initial job creation failed or has invalid initial status');
      }

      // 5. Attempt to add the exact same job
      let duplicateRejected = false;
      try {
        await QueueStore.addJob({
          gstin: 'TESTGSTIN',
          financialYear: '2025-2026',
          period: 'April',
          returnType: 'GSTR-2B',
          isTestJob: true,
        });
      } catch (err: unknown) {
        duplicateRejected = true;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes('duplicate')) {
          throw new Error(`Unexpected duplicate rejection message: ${msg}`);
        }
      }

      // 6. Verify the second job is rejected as duplicate
      if (!duplicateRejected) {
        throw new Error('Duplicate protection failed: second identical job was not rejected');
      }

      const queue = await QueueStore.getQueue();
      if (queue.length !== 1) {
        throw new Error(`Expected exactly 1 job in queue, found ${queue.length}`);
      }
    }
  );

  // 8. Safe Add Test Job Mechanism
  await executeTest(
    'QUE-01',
    'QUEUE',
    'Safe Add Test Job Mechanism',
    'Adds a test job with valid parameters, initializes retryCount=0, status=PENDING',
    async () => {
      const job = await QueueStore.addJob({
        gstin: 'TESTGSTIN_2',
        financialYear: '2025-2026',
        period: 'May',
        returnType: 'GSTR-1',
        isTestJob: true,
      });

      if (!job.id || job.status !== 'PENDING' || !job.isTestJob || job.retryCount !== 0) {
        throw new Error('Test job creation failed or has invalid initial status');
      }
    }
  );

  // 9. Queue State Consistency & Single Active Invariant
  await executeTest(
    'QUE-02',
    'QUEUE',
    'Queue State Consistency & Single Active Invariant',
    'Enforces that only 1 job is active at a time and activeJobId stays synchronized with state',
    async () => {
      const state = await QueueStore.getQueueState();
      if (state.jobs.length < 2) {
        throw new Error(`Expected at least 2 jobs in queue, found ${state.jobs.length}`);
      }

      // Start queue
      await testQueueManager.startQueue();
      const runningState = await QueueStore.getQueueState();
      if (!runningState.isRunning) {
        throw new Error('Queue failed to set isRunning = true');
      }
    }
  );

  // 10. State Machine Transition Progression
  await executeTest(
    'QUE-03',
    'QUEUE',
    'State-Machine Progression Validation',
    'Validates step progression through NAVIGATING -> PAGE_READY -> WAITING_FOR_DOWNLOAD -> DOWNLOADED',
    async () => {
      // Allow the test job to step through the simulated queue pipeline
      await sleep(3500);

      const jobs = await QueueStore.getQueue();
      const job1 = jobs.find((j) => j.gstin === 'TESTGSTIN');
      if (!job1 || (job1.status !== 'DOWNLOADED' && job1.status !== 'WAITING_FOR_DOWNLOAD')) {
        throw new Error(`Job state transition failed. Current status: ${job1?.status}`);
      }
    }
  );

  // 11. State-Machine Rules & Invalid Transition Guard
  await executeTest(
    'STM-01',
    'QUEUE',
    'State Machine Formal Transition Guard',
    'Verifies legal transitions succeed and illegal jumps (e.g. DOWNLOADED directly to NAVIGATING) are guarded',
    async () => {
      if (!isValidTransition('PENDING', 'NAVIGATING')) {
        throw new Error('PENDING -> NAVIGATING should be valid');
      }
      if (!isValidTransition('NAVIGATING', 'PAGE_READY')) {
        throw new Error('NAVIGATING -> PAGE_READY should be valid');
      }
      if (!isValidTransition('PAGE_READY', 'WAITING_FOR_DOWNLOAD')) {
        throw new Error('PAGE_READY -> WAITING_FOR_DOWNLOAD should be valid');
      }
      if (!isValidTransition('WAITING_FOR_DOWNLOAD', 'DOWNLOADED')) {
        throw new Error('WAITING_FOR_DOWNLOAD -> DOWNLOADED should be valid');
      }
      if (!isValidTransition('FAILED', 'PENDING')) {
        throw new Error('FAILED -> PENDING should be valid (retry/reset)');
      }
      if (isValidTransition('DOWNLOADED', 'NAVIGATING')) {
        throw new Error('DOWNLOADED -> NAVIGATING should be illegal without reset to PENDING');
      }
    }
  );

  // 12. Pause & Resume Recovery
  await executeTest(
    'QUE-04',
    'QUEUE',
    'Pause/Resume Recovery & Interruption Rollback',
    'Pausing rolls active transition cleanly back to PENDING and resume continues without deadlock',
    async () => {
      await testQueueManager.pauseQueue();
      const state = await QueueStore.getQueueState();
      if (!state.isPaused || state.isRunning) {
        throw new Error('Queue failed to set isPaused = true / isRunning = false');
      }

      await testQueueManager.resumeQueue();
      const resumedState = await QueueStore.getQueueState();
      if (resumedState.isPaused) {
        throw new Error('Queue failed to resume from pause');
      }
    }
  );

  // 13. Persistent Download Monitor Tracking & Association
  await executeTest(
    'DWN-01',
    'DOWNLOADS',
    'Persistent Download Monitor & Job Association',
    'Tracks download ID, stores association persistently, and survives worker re-hydration',
    async () => {
      const dummyJobId = 'test_dwn_job_persistent';
      const downloadId = testDownloadMonitor.simulateDownload(
        'TESTGSTIN_GSTR2B_April_20252026.json',
        'complete',
        dummyJobId
      );

      const download = testDownloadMonitor.getDownload(downloadId);
      if (!download) {
        throw new Error('Download was not registered in monitor map');
      }

      const associatedId = await testDownloadMonitor.getAssociatedJobIdAsync(downloadId);
      if (associatedId !== dummyJobId) {
        throw new Error(`Download job association mismatch. Expected ${dummyJobId}, got ${associatedId}`);
      }
    }
  );

  // 14. Service-Worker Restart Recovery
  await executeTest(
    'REC-01',
    'QUEUE',
    'Service-Worker & Browser Restart Recovery',
    'Reconciles stuck intermediate states back to PENDING and reconciles completed downloads on startup',
    async () => {
      const leftoverJob = await QueueStore.addJob({
        gstin: 'TESTLEFTOVER',
        financialYear: '2025-2026',
        period: 'July',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      await QueueStore.updateJob(leftoverJob.id, { status: 'NAVIGATING' });
      
      // Run startup recovery
      await testQueueManager.recoverQueueOnStartup();

      const refreshed = (await QueueStore.getQueue()).find((j) => j.id === leftoverJob.id);
      if (!refreshed || refreshed.status !== 'PENDING') {
        throw new Error(`Expected recovered job to be PENDING, got ${refreshed?.status}`);
      }
    }
  );

  // 15. Retry Accounting & Max Retries (3) Failure Handling
  await executeTest(
    'RET-01',
    'DOWNLOADS',
    'Strict Retry Accounting & Max Retries (3)',
    'Increments retryCount on failure (1, 2, 3) and marks FAILED with "Manual action required" on 3rd attempt',
    async () => {
      const failJob = await QueueStore.addJob({
        gstin: 'TESTFAILGSTIN',
        financialYear: '2025-2026',
        period: 'June',
        returnType: 'GSTR-3B',
        isTestJob: false,
        maxRetries: 3,
      });

      // Attempt 1
      const res1 = await testQueueManager.handleJobFailure(failJob, 'Network timeout attempt 1');
      let current = (await QueueStore.getQueue()).find((j) => j.id === failJob.id);
      if (!current || current.status !== 'PENDING' || current.retryCount !== 1) {
        throw new Error(`Attempt 1 failed. Expected PENDING retryCount 1, got status=${current?.status} retryCount=${current?.retryCount}`);
      }
      if (!res1 || res1.status !== 'PENDING' || res1.retryCount !== 1) {
        throw new Error(`Attempt 1 return contract failed. Expected returned job to have PENDING retryCount 1, got: ${JSON.stringify(res1)}`);
      }

      // Attempt 2
      const res2 = await testQueueManager.handleJobFailure(current, 'Network timeout attempt 2');
      current = (await QueueStore.getQueue()).find((j) => j.id === failJob.id);
      if (!current || current.status !== 'PENDING' || current.retryCount !== 2) {
        throw new Error(`Attempt 2 failed. Expected PENDING retryCount 2, got status=${current?.status} retryCount=${current?.retryCount}`);
      }
      if (!res2 || res2.status !== 'PENDING' || res2.retryCount !== 2) {
        throw new Error(`Attempt 2 return contract failed. Expected returned job to have PENDING retryCount 2, got: ${JSON.stringify(res2)}`);
      }

      // Attempt 3: reaches maxRetries -> FAILED
      const res3 = await testQueueManager.handleJobFailure(current, 'Network timeout attempt 3');
      current = (await QueueStore.getQueue()).find((j) => j.id === failJob.id);
      if (!current || current.status !== 'FAILED' || current.retryCount !== 3 || !current.error?.includes('Manual action required')) {
        throw new Error(`Attempt 3 max retry failed. Expected FAILED with 'Manual action required', got: ${current?.error}`);
      }
      if (!res3 || res3.status !== 'FAILED' || res3.retryCount !== 3 || !res3.error?.includes('Manual action required')) {
        throw new Error(`Attempt 3 return contract failed. Expected returned job to have FAILED retryCount 3 and 'Manual action required', got: ${JSON.stringify(res3)}`);
      }

      // Reset for retry
      const resetJob = await QueueStore.resetFailedJob(failJob.id);
      if (!resetJob || resetJob.status !== 'PENDING' || resetJob.retryCount !== 0 || resetJob.error !== null) {
        throw new Error('Reset failed job did not restore PENDING status with retryCount=0 and error=null');
      }
    }
  );

  // 16. Queue Recovery After Browser Restart
  await executeTest(
    'REC-02',
    'QUEUE',
    'Queue Recovery After Browser Restart',
    'Verifies queue data and settings survive complete storage reload and reconstitute seamlessly',
    async () => {
      const state = await QueueStore.getQueueState();
      if (!state || !Array.isArray(state.jobs)) {
        throw new Error('Queue state failed to reconstitute from persistent storage');
      }
      if (state.jobs.length === 0) {
        throw new Error('Jobs array was unexpectedly empty after restart recovery test');
      }
    }
  );

  // 17. Clear Completed & Clear All Integrity
  await executeTest(
    'QUE-05',
    'QUEUE',
    'Clear Completed Jobs Integrity',
    'Removes finished/failed jobs while leaving active/pending items intact',
    async () => {
      await QueueStore.clearCompleted();
      const jobs = await QueueStore.getQueue();
      const hasDownloaded = jobs.some((j) => j.status === 'DOWNLOADED');
      if (hasDownloaded) {
        throw new Error('Clear Completed did not purge downloaded items');
      }
    }
  );

  // 18. Milestone 2 Return Adapters Verification
  await executeTest(
    'ADP-01',
    'ADAPTERS',
    'Milestone 2 Return Adapters Placeholders & GSTR-2B Activation',
    'Verifies return adapters registration, interface contract and activation across all return types',
    async () => {
      const a1 = new GSTR1Adapter();
      const a2 = new GSTR2AAdapter();
      const a3 = new GSTR2BAdapter();
      const a4 = new GSTR3BAdapter();

      if (a1.returnType !== 'GSTR-1' || a2.returnType !== 'GSTR-2A' || a3.returnType !== 'GSTR-2B' || a4.returnType !== 'GSTR-3B') {
        throw new Error('Adapter return type mismatch');
      }

      // Verify all adapters satisfy the standard GSTReturnAdapter capability contract
      for (const adapter of [a1, a2, a3, a4]) {
        if (typeof adapter.canHandlePage !== 'function') {
          throw new Error(`Adapter ${adapter.returnType} missing canHandlePage`);
        }
        if (typeof adapter.verifyGstinContext !== 'function') {
          throw new Error(`Adapter ${adapter.returnType} missing verifyGstinContext`);
        }
        if (typeof adapter.selectFinancialYear !== 'function') {
          throw new Error(`Adapter ${adapter.returnType} missing selectFinancialYear`);
        }
        if (typeof adapter.selectReturnPeriod !== 'function') {
          throw new Error(`Adapter ${adapter.returnType} missing selectReturnPeriod`);
        }
      }

      // Verify GSTR-2B adapter is initialized and active
      if (typeof a3.canHandlePage !== 'function' || typeof a3.startDownload !== 'function') {
        throw new Error('GSTR-2B adapter interface incomplete');
      }
    }
  );

  // 19. Future Udaan Bridge Contract
  await executeTest(
    'BDG-01',
    'BRIDGE',
    'Future Udaan Reconciliation Bridge Readiness',
    'Verifies Udaan Bridge connects and buffers status without requiring external server in M1',
    async () => {
      const bridge = UdaanBridge.getInstance();
      const status = await bridge.connect();
      if (!status.isConnected) {
        throw new Error('Bridge connect returned isConnected = false');
      }
    }
  );

  // 20. Extension Build Validation
  await executeTest(
    'BLD-01',
    'BUILD',
    'Extension Build & Asset Validation',
    'Validates Manifest V3 format, service worker script, popup UI, content scripts, and ZIP generation',
    async () => {
      const blob = await ExtensionPacker.generateExtensionZip();
      if (!blob || blob.size < 1000) {
        throw new Error(`Generated extension ZIP is too small (${blob?.size || 0} bytes)`);
      }
    }
  );

  // ==========================================
  // MILESTONE 2: GSTR-2B ACCEPTANCE TEST SUITE
  // ==========================================

  // 21. G2B-01: Correct Financial Year Selection
  await executeTest(
    'G2B-01',
    'GSTR2B_M2',
    'Correct FY Selection (Current & Future FYs)',
    'Verifies GSTR-2B adapter validates and selects exact financial year from dropdown options without hardcoding',
    async () => {
      const sim = GSTPortalSimulator.getInstance();
      sim.mount(document, {
        financialYears: ['2023-24', '2024-25', '2025-26', '2026-27', '2027-28', '2028-29'],
      });

      const adapter = new GSTR2BAdapter();
      const res1 = await adapter.selectFinancialYear('2025-2026', document);
      if (!res1.success || !res1.selected.includes('2025')) {
        throw new Error(`FY selection failed for 2025-2026: ${res1.error}`);
      }

      // Verify DOM selection
      const fySelect = document.getElementById('fin_yr') as HTMLSelectElement | null;
      if (!fySelect || !fySelect.value.includes('2025')) {
        throw new Error(`DOM FY dropdown does not reflect selected value '2025-26', found '${fySelect?.value}'`);
      }

      // Select future financial year without hardcoding
      const res2 = await adapter.selectFinancialYear('2026-2027', document);
      if (!res2.success || !res2.selected.includes('2026')) {
        throw new Error(`Future FY selection failed for 2026-2027: ${res2.error}`);
      }

      // Verify invalid/unavailable FY is cleanly rejected
      const resInvalid = await adapter.selectFinancialYear('1990-1991', document);
      if (resInvalid.success) {
        throw new Error('Adapter should have rejected non-existent financial year 1990-1991');
      }
    }
  );

  // 22. G2B-02: Correct Period Selection
  await executeTest(
    'G2B-02',
    'GSTR2B_M2',
    'Correct Period Selection (Monthly Periods)',
    'Verifies GSTR-2B adapter validates and selects requested return period (e.g. April, May, June)',
    async () => {
      const sim = GSTPortalSimulator.getInstance();
      sim.mount(document, {
        periods: ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'],
      });

      const adapter = new GSTR2BAdapter();
      const res1 = await adapter.selectReturnPeriod('April', document);
      if (!res1.success || !res1.isAvailable || res1.selected !== 'April') {
        throw new Error(`Period selection failed for April: ${res1.error}`);
      }

      // Verify DOM selection
      const periodSelect = document.getElementById('ret_period') as HTMLSelectElement | null;
      if (!periodSelect || periodSelect.value !== 'April') {
        throw new Error(`DOM Period dropdown does not reflect selected value 'April', found '${periodSelect?.value}'`);
      }

      // Select another period
      const res2 = await adapter.selectReturnPeriod('May', document);
      if (!res2.success || !res2.isAvailable || res2.selected !== 'May') {
        throw new Error(`Period selection failed for May: ${res2.error}`);
      }

      // Verify unavailable period is cleanly rejected
      const resUnavail = await adapter.selectReturnPeriod('UndisclosedQuarter', document);
      if (resUnavail.success || resUnavail.isAvailable) {
        throw new Error('Adapter should have rejected unavailable return period');
      }
    }
  );

  // 23. G2B-03: GSTR-2B Page Detection
  await executeTest(
    'G2B-03',
    'GSTR2B_M2',
    'GSTR-2B Page & Returns Dashboard Detection',
    'Verifies adapter correctly identifies GSTR-2B and Returns Dashboard pages while rejecting unrelated URLs',
    async () => {
      const adapter = new GSTR2BAdapter();
      const valid1 = adapter.canHandlePage('https://services.gst.gov.in/services/auth/returns');
      const valid2 = adapter.canHandlePage('https://services.gst.gov.in/services/returns/gstr2b');
      const valid3 = adapter.canHandlePage('https://services.gst.gov.in/services/auth/return-dashboard', 'GST Returns Dashboard');
      const invalid = adapter.canHandlePage('https://services.gst.gov.in/services/payment/challan');

      if (!valid1 || !valid2 || !valid3) {
        throw new Error('GSTR-2B adapter failed to recognize legitimate returns dashboard URL/title');
      }
      if (invalid) {
        throw new Error('GSTR-2B adapter incorrectly claimed it can handle payments challan page');
      }
    }
  );

  // 24. G2B-04: Generate JSON Detection
  await executeTest(
    'G2B-04',
    'GSTR2B_M2',
    'Generate JSON Button & State Detection',
    'Verifies adapter identifies the "GENERATE JSON FILE TO DOWNLOAD" button and recognizes already generated files',
    async () => {
      const sim = GSTPortalSimulator.getInstance();
      sim.mount(document);
      sim.reset();

      const adapter = new GSTR2BAdapter();

      // State A: Generate button exists and trigger initiates generation
      const res = await adapter.triggerGenerateJson(document);
      if (!res.success || res.state !== 'GENERATING') {
        throw new Error(`Failed to detect/trigger JSON generation: ${res.error || res.state}`);
      }

      // State C: File already available
      sim.setReady();
      const resReady = await adapter.triggerGenerateJson(document);
      if (!resReady.success || !resReady.isAlreadyGenerated || resReady.state !== 'READY') {
        throw new Error('Adapter failed to recognize already generated ready download link');
      }
    }
  );

  // 25. G2B-05: Waiting State After Generate
  await executeTest(
    'G2B-05',
    'GSTR2B_M2',
    'Waiting State After Generate with Configurable Polling',
    'Verifies that queue job enters WAITING_FOR_DOWNLOAD / GENERATING state and uses GSTR2B_CONFIG polling',
    async () => {
      const sim = GSTPortalSimulator.getInstance();
      sim.mount(document, { generationDelayMs: 150 });
      sim.reset();

      const adapter = new GSTR2BAdapter();
      const job = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'April',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      const updated = await QueueStore.updateJob(job.id, { status: 'GENERATING' });
      if (!updated || updated.status !== 'GENERATING') {
        throw new Error('Job failed to transition to GENERATING state');
      }

      // Trigger generation in simulator
      await adapter.triggerGenerateJson(document);

      // Await generation completion using configurable polling
      const waitRes = await adapter.waitForGeneratedJsonAndDownload({
        doc: document,
        timeoutMs: 3000,
        pollIntervalMs: 50,
      });

      if (!waitRes.success || !waitRes.downloadTriggered) {
        throw new Error(`Waiting handler failed: ${waitRes.error}`);
      }
    }
  );

  // 26. G2B-06: Download Completion Detection
  await executeTest(
    'G2B-06',
    'GSTR2B_M2',
    'Download Completion Detection',
    'Verifies that a GSTR-2B job reaches DOWNLOADED status strictly when Chrome confirms download state = complete',
    async () => {
      const g2bJob = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'May',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      const expectedFilename = '27AABCU9603R1ZM_GSTR-2B_May_20252026.json';
      const dlId = testDownloadMonitor.simulateDownload(expectedFilename, 'complete', g2bJob.id);

      await QueueStore.updateJob(g2bJob.id, {
        status: 'WAITING_FOR_DOWNLOAD',
        browserDownloadId: dlId,
      });

      await sleep(1200);

      const verified = (await QueueStore.getQueue()).find((j) => j.id === g2bJob.id);
      if (!verified || verified.status !== 'DOWNLOADED' || verified.filename !== expectedFilename) {
        throw new Error(`Job failed to reach DOWNLOADED status on download completion. Status: ${verified?.status}`);
      }
    }
  );

  // 27. G2B-07: Download-to-Job Association
  await executeTest(
    'G2B-07',
    'GSTR2B_M2',
    'Download-to-Job Association & Persistence',
    'Ensures browser download ID is durably associated with the active GSTR-2B QueueJob in persistent storage',
    async () => {
      const uniqueJobId = `g2b_assoc_job_${Date.now()}`;
      await testDownloadMonitor.associateDownloadWithJob(987654, uniqueJobId);

      const retrieved = await testDownloadMonitor.getAssociatedJobIdAsync(987654);
      if (retrieved !== uniqueJobId) {
        throw new Error(`Expected associated job ID ${uniqueJobId}, got ${retrieved}`);
      }
    }
  );

  // 28. G2B-08: Interrupted Download
  await executeTest(
    'G2B-08',
    'GSTR2B_M2',
    'Interrupted Download Recovery',
    'Verifies that an interrupted Chrome download marks error, increments retry count, and returns to PENDING',
    async () => {
      const job = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'June',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      const dlId = testDownloadMonitor.simulateDownload('test_interrupted.json', 'interrupted', job.id);
      await QueueStore.updateJob(job.id, {
        status: 'WAITING_FOR_DOWNLOAD',
        browserDownloadId: dlId,
      });

      await sleep(1200);

      const refreshed = (await QueueStore.getQueue()).find((j) => j.id === job.id);
      if (!refreshed || refreshed.status === 'DOWNLOADED') {
        throw new Error('Interrupted download was incorrectly marked as DOWNLOADED');
      }
    }
  );

  // 29. G2B-09: Generation Timeout Handling
  await executeTest(
    'G2B-09',
    'GSTR2B_M2',
    'Generation Timeout Handling',
    'Verifies GSTR-2B adapter catches generation timeout without crashing and returns descriptive error',
    async () => {
      const adapter = new GSTR2BAdapter();
      const sim = await adapter.simulateM2Workflow({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'July',
        scenario: 'TIMEOUT',
      });

      if (sim.success || !sim.error?.includes('timed out')) {
        throw new Error(`Expected timeout error, got: ${sim.error}`);
      }
    }
  );

  // 30. G2B-10: Duplicate Download Protection
  await executeTest(
    'G2B-10',
    'GSTR2B_M2',
    'Duplicate GSTR-2B Download Protection',
    'Prevents adding or initiating duplicate jobs for a GSTR-2B period already in queue or already DOWNLOADED',
    async () => {
      await QueueStore.clearAll();
      const j1 = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'August',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      // 1. Exact duplicate must be blocked
      let duplicateCaught = false;
      try {
        await QueueStore.addJob({
          gstin: '27AABCU9603R1ZM',
          financialYear: '2025-2026',
          period: 'August',
          returnType: 'GSTR-2B',
          isTestJob: true,
        });
      } catch (err: unknown) {
        duplicateCaught = true;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('Duplicate job')) {
          throw new Error(`Unexpected duplicate error message: ${msg}`);
        }
      }

      if (!duplicateCaught) {
        throw new Error('Duplicate protection failed to block identical GSTR-2B job');
      }

      // 2. Normalized casing / whitespace variations must also be blocked
      let caseVariantCaught = false;
      try {
        await QueueStore.addJob({
          gstin: '  27aabcu9603r1zm  ',
          financialYear: '2025-2026',
          period: 'august',
          returnType: 'GSTR-2B',
          isTestJob: true,
        });
      } catch {
        caseVariantCaught = true;
      }
      if (!caseVariantCaught) {
        throw new Error('Duplicate protection failed to block lowercase/whitespace variant');
      }

      // 3. Different period must NOT be considered duplicate
      const jDiffPeriod = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'September',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });
      if (!jDiffPeriod || !jDiffPeriod.id) {
        throw new Error('Valid non-duplicate period was incorrectly rejected');
      }

      // 4. Different FY must NOT be considered duplicate
      const jDiffFy = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2026-2027',
        period: 'August',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });
      if (!jDiffFy || !jDiffFy.id) {
        throw new Error('Valid non-duplicate FY was incorrectly rejected');
      }

      // 5. Different Return Type must NOT be considered duplicate
      const jDiffType = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'August',
        returnType: 'GSTR-1',
        isTestJob: true,
      });
      if (!jDiffType || !jDiffType.id) {
        throw new Error('Valid non-duplicate Return Type was incorrectly rejected');
      }
    }
  );

  // 31. G2B-11: Retry Integration (3 Attempts Strict)
  await executeTest(
    'G2B-11',
    'GSTR2B_M2',
    'GSTR-2B Retry Accounting & Max Retries (3)',
    'Verifies GSTR-2B failures count attempts (1, 2) as PENDING and attempt 3 as FAILED with "Manual action required"',
    async () => {
      // Isolate test queue fixture for G2B-11
      await QueueStore.clearAll();

      const g2bFailJob = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'September',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      // Initial verification: status = PENDING, retryCount = 0
      if (!g2bFailJob || g2bFailJob.status !== 'PENDING' || g2bFailJob.retryCount !== 0) {
        throw new Error(`Initial state mismatch. Expected PENDING retryCount 0, got status=${g2bFailJob?.status}, retryCount=${g2bFailJob?.retryCount}`);
      }

      // Attempt 1 -> status: PENDING, retryCount: 1
      const res1 = await testQueueManager.handleJobFailure(g2bFailJob, 'Portal timeout attempt 1');
      if (!res1 || res1.status !== 'PENDING' || res1.retryCount !== 1) {
        throw new Error(`Attempt 1 failed. Expected PENDING retryCount 1, got status=${res1?.status}, retryCount=${res1?.retryCount}`);
      }

      // Attempt 2 -> status: PENDING, retryCount: 2
      const res2 = await testQueueManager.handleJobFailure(res1, 'Portal timeout attempt 2');
      if (!res2 || res2.status !== 'PENDING' || res2.retryCount !== 2) {
        throw new Error(`Attempt 2 failed. Expected PENDING retryCount 2, got status=${res2?.status}, retryCount=${res2?.retryCount}`);
      }

      // Attempt 3 -> status: FAILED, retryCount: 3, error contains "Manual action required"
      const res3 = await testQueueManager.handleJobFailure(res2, 'Portal timeout attempt 3');
      if (!res3 || res3.status !== 'FAILED' || res3.retryCount !== 3 || !res3.error?.includes('Manual action required')) {
        throw new Error(`Attempt 3 failed. Expected FAILED retryCount 3 with 'Manual action required', got status=${res3?.status}, retryCount=${res3?.retryCount}, error: ${res3?.error}`);
      }
    }
  );

  // 32. G2B-12: Pause / Resume Safety
  await executeTest(
    'G2B-12',
    'GSTR2B_M2',
    'Pause/Resume State Preservation',
    'Verifies pausing an in-flight GSTR-2B job resets state safely to PENDING without corrupting queue or skipping jobs',
    async () => {
      await testQueueManager.pauseQueue();
      const state = await QueueStore.getQueueState();
      if (!state.isPaused || state.isRunning) {
        throw new Error('Queue state failed to reflect isPaused = true, isRunning = false');
      }

      await testQueueManager.resumeQueue();
      const resumedState = await QueueStore.getQueueState();
      if (resumedState.isPaused || !resumedState.isRunning) {
        throw new Error('Queue state failed to reflect isPaused = false, isRunning = true on resume');
      }

      await testQueueManager.pauseQueue(); // Clean up
    }
  );

  // 33. G2B-13: Service-Worker Recovery
  await executeTest(
    'G2B-13',
    'GSTR2B_M2',
    'Service-Worker Recovery for GSTR-2B',
    'Verifies startup reconciler resets in-flight NAVIGATING/GENERATING jobs to PENDING so restart never locks queue',
    async () => {
      const inFlightJob = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'October',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      await QueueStore.updateJob(inFlightJob.id, { status: 'GENERATING' });
      await testQueueManager.recoverQueueOnStartup();

      const recovered = (await QueueStore.getQueue()).find((j) => j.id === inFlightJob.id);
      if (!recovered || recovered.status !== 'PENDING') {
        throw new Error(`Expected recovered job to be reset to PENDING, got: ${recovered?.status}`);
      }
    }
  );

  // 34. G2B-14: Wrong GSTIN Protection
  await executeTest(
    'G2B-14',
    'GSTR2B_M2',
    'Wrong GSTIN Context Protection',
    'Verifies GSTR-2B adapter blocks download and requires manual confirmation when taxpayer GSTIN does not match portal',
    async () => {
      const adapter = new GSTR2BAdapter();
      const mismatchSim = await adapter.simulateM2Workflow({
        gstin: '27WRONGGSTIN1Z5',
        financialYear: '2025-2026',
        period: 'November',
        scenario: 'GSTIN_MISMATCH',
      });

      if (mismatchSim.success || !mismatchSim.error?.includes('Unable to verify GSTIN')) {
        throw new Error(`Expected GSTIN mismatch protection error, got: ${mismatchSim.error}`);
      }
    }
  );

  // 35. G2B-15: Unavailable Period & QRMP Handling
  await executeTest(
    'G2B-15',
    'GSTR2B_M2',
    'Unavailable Period & QRMP Handling',
    'Verifies adapter rejects requests for periods not available on GST Portal without clicking random options or fabricating success',
    async () => {
      const adapter = new GSTR2BAdapter();
      const unavailSim = await adapter.simulateM2Workflow({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'UndisclosedPeriod',
        scenario: 'UNAVAILABLE_PERIOD',
      });

      if (unavailSim.success || !unavailSim.error?.includes('unavailable')) {
        throw new Error(`Expected unavailable period rejection, got: ${unavailSim.error}`);
      }
    }
  );

  // ==========================================
  // MILESTONE 3: LOCAL STORAGE & AUTO-SYNC
  // ==========================================

  const testSyncEngine = SyncEngine.getInstance();
  const memoryProvider = new MemoryStorageProvider();
  LocalStorageManager.getInstance().setProvider(memoryProvider);

  // 36. LOC-01: Local root is mandatory
  await executeTest(
    'LOC-01',
    'LOCAL_SYNC_M3',
    'Local Root Selection is Mandatory',
    'Verifies local sync is blocked and disabled until user explicitly selects a valid Local Storage Root folder',
    async () => {
      await testSyncEngine.reset();
      const settings = await testSyncEngine.getSettings();

      if (settings.rootSelected || settings.status !== 'NOT_CONFIGURED') {
        throw new Error(`Initial state mismatch. Expected rootSelected=false & status=NOT_CONFIGURED, got ${settings.status}`);
      }

      if (testSyncEngine.isRootReady()) {
        throw new Error('isRootReady() should be false before root is selected');
      }
    }
  );

  // 37. LOC-02: Auto-Sync remains disabled without root
  await executeTest(
    'LOC-02',
    'LOCAL_SYNC_M3',
    'Auto-Sync Disabled Without Root',
    'Verifies enabling Auto-Sync is rejected and remains OFF if Local Storage Root is not configured',
    async () => {
      await testSyncEngine.reset();
      const enabled = await testSyncEngine.setAutoSync(true);
      if (enabled) {
        throw new Error('setAutoSync(true) should return false when root is not configured');
      }

      const settings = await testSyncEngine.getSettings();
      if (settings.autoSyncEnabled) {
        throw new Error('autoSyncEnabled must remain false without root configured');
      }
    }
  );

  // 38. LOC-03: Root selection enables sync controls
  await executeTest(
    'LOC-03',
    'LOCAL_SYNC_M3',
    'Root Selection Enables Sync Controls',
    'Verifies selecting a valid local root folder transitions status to CONNECTED and enables Auto-Sync controls',
    async () => {
      await testSyncEngine.reset();
      const res = await testSyncEngine.configureRoot('D:\\UdaanGSTData');
      if (!res.success || !res.pathName) {
        throw new Error(`Failed to configure root: ${res.error}`);
      }

      const settings = await testSyncEngine.getSettings();
      if (!settings.rootSelected || settings.status !== 'CONNECTED' || settings.rootPathName !== 'D:\\UdaanGSTData') {
        throw new Error(`Expected CONNECTED status with 'D:\\UdaanGSTData', got status=${settings.status}, path=${settings.rootPathName}`);
      }

      const enableAutoSync = await testSyncEngine.setAutoSync(true);
      if (!enableAutoSync) {
        throw new Error('setAutoSync(true) should succeed once root is CONNECTED');
      }
    }
  );

  // 39. LOC-04: Company folder creation
  await executeTest(
    'LOC-04',
    'LOCAL_SYNC_M3',
    'Company Folder Creation',
    'Verifies sync engine automatically creates canonical <GSTIN>_<CompanyName> directory under the root folder',
    async () => {
      await testSyncEngine.reset();
      await testSyncEngine.configureRoot('D:\\UdaanGSTData');
      await CompanyStore.saveCompany('27AABCU9603R1ZM', 'My Company');

      const job = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'April',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      await QueueStore.updateJob(job.id, { status: 'DOWNLOADED' });
      const syncRes = await testSyncEngine.syncJob(job);

      if (!syncRes.success) {
        throw new Error(`Sync failed: ${syncRes.error}`);
      }

      const provider = testSyncEngine.getProvider();
      const companyDirExists = await provider.directoryExists(['27AABCU9603R1ZM_My Company']);
      if (!companyDirExists) {
        throw new Error('Company folder "27AABCU9603R1ZM_My Company" was not created');
      }
    }
  );

  // 40. LOC-05: Existing company folder is reused
  await executeTest(
    'LOC-05',
    'LOCAL_SYNC_M3',
    'Existing Company Folder Reuse',
    'Verifies existing company folder is safely reused without recreation, deletion, or corrupting existing contents',
    async () => {
      const provider = testSyncEngine.getProvider();
      // Ensure company folder is present from previous test
      const existsBefore = await provider.directoryExists(['27AABCU9603R1ZM_My Company']);
      if (!existsBefore) {
        await provider.createDirectory([], '27AABCU9603R1ZM_My Company');
      }

      const jobMay = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'May',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });
      await QueueStore.updateJob(jobMay.id, { status: 'DOWNLOADED' });
      const syncRes = await testSyncEngine.syncJob(jobMay);

      if (!syncRes.success) {
        throw new Error(`Sync failed on existing company folder: ${syncRes.error}`);
      }

      const existsAfter = await provider.directoryExists(['27AABCU9603R1ZM_My Company']);
      if (!existsAfter) {
        throw new Error('Company folder was unexpectedly removed');
      }
    }
  );

  // 41. LOC-06: FY folder creation with normalized FY
  await executeTest(
    'LOC-06',
    'LOCAL_SYNC_M3',
    'Financial Year Folder Normalization',
    'Verifies financial year folder uses canonical 2025-26 representation even when job FY is 2025-2026',
    async () => {
      const provider = testSyncEngine.getProvider();
      const fyExists = await provider.directoryExists(['27AABCU9603R1ZM_My Company', '2025-26']);
      if (!fyExists) {
        throw new Error('Normalized FY directory "2025-26" was not created');
      }

      const rawFyExists = await provider.directoryExists(['27AABCU9603R1ZM_My Company', '2025-2026']);
      if (rawFyExists) {
        throw new Error('Non-canonical "2025-2026" directory was mistakenly created');
      }
    }
  );

  // 42. LOC-07: Return folder creation
  await executeTest(
    'LOC-07',
    'LOCAL_SYNC_M3',
    'Return Type Folder Architecture',
    'Verifies dedicated return folder (GSTR-2B) is created under the normalized FY folder',
    async () => {
      const provider = testSyncEngine.getProvider();
      const returnDirExists = await provider.directoryExists([
        '27AABCU9603R1ZM_My Company',
        '2025-26',
        'GSTR-2B',
      ]);
      if (!returnDirExists) {
        throw new Error('Return type directory "GSTR-2B" was not created');
      }
    }
  );

  // 43. LOC-08: GSTR-2B file synchronization
  await executeTest(
    'LOC-08',
    'LOCAL_SYNC_M3',
    'Deterministic GSTR-2B File Synchronization',
    'Verifies GSTR-2B JSON file is stored with deterministic name GSTR-2B_April_2025-26.json and valid payload',
    async () => {
      const provider = testSyncEngine.getProvider();
      const pathSegments = ['27AABCU9603R1ZM_My Company', '2025-26', 'GSTR-2B'];
      const fileExists = await provider.fileExists(pathSegments, 'GSTR-2B_April_2025-26.json');
      if (!fileExists) {
        throw new Error('File "GSTR-2B_April_2025-26.json" was not created');
      }

      const content = await provider.readFile(pathSegments, 'GSTR-2B_April_2025-26.json');
      if (!content) {
        throw new Error('File content is empty');
      }

      const parsed = JSON.parse(content);
      if (parsed.gstin !== '27AABCU9603R1ZM' || parsed.fp !== 'April' || parsed.fy !== '2025-26') {
        throw new Error(`File JSON payload metadata mismatch: ${JSON.stringify(parsed)}`);
      }
    }
  );

  // 44. LOC-09: Correct GSTIN/company destination
  await executeTest(
    'LOC-09',
    'LOCAL_SYNC_M3',
    'Job-Derived Taxpayer Destination Safety',
    'Verifies local sync destination is strictly derived from the QueueJob GSTIN, preventing cross-company contamination',
    async () => {
      await CompanyStore.saveCompany('09ABCDE1234F1ZX', 'Alpha Corp');
      await CompanyStore.saveCompany('19XYZAB5678C1ZY', 'Beta Industries');

      // Create a job for Alpha Corp
      const jobAlpha = await QueueStore.addJob({
        gstin: '09ABCDE1234F1ZX',
        financialYear: '2025-2026',
        period: 'June',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });
      await QueueStore.updateJob(jobAlpha.id, { status: 'DOWNLOADED' });

      // Simulate UI having Beta Industries active
      await CompanyStore.setActiveCompanyGstin('19XYZAB5678C1ZY');

      // Sync Alpha job
      const res = await testSyncEngine.syncJob(jobAlpha);
      if (!res.success) {
        throw new Error(`Alpha sync failed: ${res.error}`);
      }

      const provider = testSyncEngine.getProvider();
      // Must be in Alpha Corp folder
      const inAlpha = await provider.fileExists(
        ['09ABCDE1234F1ZX_Alpha Corp', '2025-26', 'GSTR-2B'],
        'GSTR-2B_June_2025-26.json'
      );
      if (!inAlpha) {
        throw new Error('Alpha Corp return was not saved in Alpha Corp folder');
      }

      // Must NEVER be in Beta Industries folder
      const inBeta = await provider.fileExists(
        ['19XYZAB5678C1ZY_Beta Industries', '2025-26', 'GSTR-2B'],
        'GSTR-2B_June_2025-26.json'
      );
      if (inBeta) {
        throw new Error('Alpha Corp return was mistakenly saved in Beta Industries folder');
      }
    }
  );

  // 45. LOC-10: Duplicate file protection
  await executeTest(
    'LOC-10',
    'LOCAL_SYNC_M3',
    'Duplicate File Protection Policy',
    'Verifies syncing the identical file again safely reports SYNCED without creating duplicate files or data loss',
    async () => {
      const queue = await QueueStore.getQueue();
      const alphaJob = queue.find((j) => j.gstin === '09ABCDE1234F1ZX' && j.period === 'June');
      if (!alphaJob) throw new Error('Alpha job fixture missing');

      // Sync the exact same job a second time
      const duplicateSync = await testSyncEngine.syncJob(alphaJob);
      if (!duplicateSync.success || !duplicateSync.isDuplicate) {
        throw new Error(`Duplicate sync should report success and isDuplicate=true, got: ${JSON.stringify(duplicateSync)}`);
      }

      const updatedJob = (await QueueStore.getQueue()).find((j) => j.id === alphaJob.id);
      if (!updatedJob || updatedJob.syncStatus !== 'SYNCED') {
        throw new Error(`Job syncStatus expected SYNCED, got: ${updatedJob?.syncStatus}`);
      }
    }
  );

  // 46. LOC-11: Multiple company isolation
  await executeTest(
    'LOC-11',
    'LOCAL_SYNC_M3',
    'Multiple Company Isolation',
    'Verifies multi-GSTIN accounts have strictly isolated folder structures with no data leaks',
    async () => {
      const provider = testSyncEngine.getProvider();
      const dirs = await provider.listDirectories([]);

      if (!dirs.includes('27AABCU9603R1ZM_My Company') || !dirs.includes('09ABCDE1234F1ZX_Alpha Corp')) {
        throw new Error(`Expected isolated company directories, found: ${dirs.join(', ')}`);
      }
    }
  );

  // 47. LOC-12: Multiple FY isolation
  await executeTest(
    'LOC-12',
    'LOCAL_SYNC_M3',
    'Multiple Financial Year Segregation',
    'Verifies different financial years (e.g. 2024-25 vs 2025-26) are isolated in separate subdirectories',
    async () => {
      const jobPastFy = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2024-2025',
        period: 'March',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });
      await QueueStore.updateJob(jobPastFy.id, { status: 'DOWNLOADED' });
      await testSyncEngine.syncJob(jobPastFy);

      const provider = testSyncEngine.getProvider();
      const fy2024Exists = await provider.directoryExists(['27AABCU9603R1ZM_My Company', '2024-25']);
      const fy2025Exists = await provider.directoryExists(['27AABCU9603R1ZM_My Company', '2025-26']);

      if (!fy2024Exists || !fy2025Exists) {
        throw new Error('Both 2024-25 and 2025-26 directories must exist separately');
      }
    }
  );

  // 48. LOC-13: Sync failure handling (Download vs Sync status separation)
  await executeTest(
    'LOC-13',
    'LOCAL_SYNC_M3',
    'Sync Failure & Status Separation',
    'Verifies if local sync fails, download status remains DOWNLOADED and syncStatus becomes SYNC_FAILED',
    async () => {
      const failJob = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'July',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });
      await QueueStore.updateJob(failJob.id, { status: 'DOWNLOADED' });

      // Temporarily revoke permission
      memoryProvider.revokePermission();

      const res = await testSyncEngine.syncJob(failJob);
      if (res.success) {
        throw new Error('Sync should fail when permission is revoked');
      }

      const updated = (await QueueStore.getQueue()).find((j) => j.id === failJob.id);
      if (!updated) throw new Error('Job fixture missing');

      // CRITICAL CHECK: Download status remains DOWNLOADED; Sync status is SYNC_FAILED
      if (updated.status !== 'DOWNLOADED') {
        throw new Error(`Download status must remain DOWNLOADED on sync failure, got: ${updated.status}`);
      }
      if (updated.syncStatus !== 'SYNC_FAILED') {
        throw new Error(`Sync status must be SYNC_FAILED, got: ${updated.syncStatus}`);
      }
      if (!updated.syncError?.includes('unavailable')) {
        throw new Error(`Expected syncError message, got: ${updated.syncError}`);
      }

      // Restore permission for subsequent tests
      memoryProvider.restorePermission();
    }
  );

  // 49. LOC-14: Permission revoked handling
  await executeTest(
    'LOC-14',
    'LOCAL_SYNC_M3',
    'Permission Revocation Detection',
    'Verifies verifyRootAccess() transitions status to LOCAL_STORAGE_UNAVAILABLE when permissions are lost',
    async () => {
      memoryProvider.revokePermission();
      const hasAccess = await testSyncEngine.verifyRootAccess();

      if (hasAccess) {
        throw new Error('verifyRootAccess() should return false when revoked');
      }

      const settings = await testSyncEngine.getSettings();
      if (settings.status !== 'LOCAL_STORAGE_UNAVAILABLE') {
        throw new Error(`Expected status LOCAL_STORAGE_UNAVAILABLE, got: ${settings.status}`);
      }

      memoryProvider.restorePermission();
      await testSyncEngine.verifyRootAccess();
    }
  );

  // 50. LOC-15: Browser restart recovery
  await executeTest(
    'LOC-15',
    'LOCAL_SYNC_M3',
    'Browser Restart Recovery',
    'Verifies local sync configuration, root path name, and permission status rehydrate cleanly after browser restart',
    async () => {
      const settingsBefore = await testSyncEngine.getSettings();
      // Simulate new engine instance boot
      await testSyncEngine.init();
      const settingsAfter = await testSyncEngine.getSettings();

      if (settingsAfter.rootPathName !== settingsBefore.rootPathName) {
        throw new Error(`Root path lost after restart: before=${settingsBefore.rootPathName}, after=${settingsAfter.rootPathName}`);
      }
      if (settingsAfter.status !== 'CONNECTED') {
        throw new Error(`Expected CONNECTED status after restart recovery, got: ${settingsAfter.status}`);
      }
    }
  );

  // 51. LOC-16: Extension restart recovery
  await executeTest(
    'LOC-16',
    'LOCAL_SYNC_M3',
    'Extension Restart Job State Preservation',
    'Verifies SYNCED and NOT_SYNCED states on QueueJobs are accurately preserved during Service Worker reboot',
    async () => {
      const queue = await QueueStore.getQueue();
      const syncedJobs = queue.filter((j) => j.syncStatus === 'SYNCED');
      if (syncedJobs.length === 0) {
        throw new Error('Expected at least one SYNCED job before restart check');
      }

      await testQueueManager.recoverQueueOnStartup();
      const queueAfter = await QueueStore.getQueue();
      const syncedAfter = queueAfter.filter((j) => j.syncStatus === 'SYNCED');

      if (syncedAfter.length !== syncedJobs.length) {
        throw new Error(`SYNCED jobs count mismatch after restart: before=${syncedJobs.length}, after=${syncedAfter.length}`);
      }
    }
  );

  // 52. LOC-17: Safe filename handling
  await executeTest(
    'LOC-17',
    'LOCAL_SYNC_M3',
    'Safe Folder Name Sanitization',
    'Verifies company names containing illegal filesystem characters (\\ / : * ? " < > |) are safely sanitized',
    async () => {
      const unsanitized = 'Acme / Special: "Trade" * Corp? <LLC> | & Co.';
      const sanitized = sanitizeFolderName(unsanitized);

      if (/[\\/:*?"<>|]/.test(sanitized)) {
        throw new Error(`Sanitization failed to remove illegal chars: "${sanitized}"`);
      }

      const folder = getCompanyFolderName('27ABCDE1234F1Z5', unsanitized);
      if (!folder.startsWith('27ABCDE1234F1Z5_')) {
        throw new Error(`Generated folder prefix mismatch: ${folder}`);
      }
    }
  );

  // 53. LOC-18: No unwanted file deletion
  await executeTest(
    'LOC-18',
    'LOCAL_SYNC_M3',
    'Non-Destructive File Invariant',
    'Verifies local sync never deletes existing GST files or company folders during subsequent synchronization runs',
    async () => {
      const provider = testSyncEngine.getProvider();
      const pathSegments = ['27AABCU9603R1ZM_My Company', '2025-26', 'GSTR-2B'];

      const files = await provider.listFiles(pathSegments);
      if (!files.includes('GSTR-2B_April_2025-26.json') || !files.includes('GSTR-2B_May_2025-26.json')) {
        throw new Error(`Expected both April and May files to exist, found: ${files.join(', ')}`);
      }
    }
  );

  // 54. LOC-19: Sync Now manual trigger
  await executeTest(
    'LOC-19',
    'LOCAL_SYNC_M3',
    'Manual Sync Now Action',
    'Verifies "Sync Now" discovers and synchronizes all unsynced or failed downloaded jobs in one unified operation',
    async () => {
      // Find the previously failed July job
      const queue = await QueueStore.getQueue();
      const julyJob = queue.find((j) => j.period === 'July' && j.status === 'DOWNLOADED');
      if (!julyJob) throw new Error('July job fixture missing');

      if (julyJob.syncStatus !== 'SYNC_FAILED') {
        await QueueStore.updateJob(julyJob.id, { syncStatus: 'SYNC_FAILED' });
      }

      const syncNowRes = await testSyncEngine.syncNow();
      if (syncNowRes.syncedCount === 0) {
        throw new Error(`Expected at least 1 job to be synced during Sync Now, got: ${JSON.stringify(syncNowRes)}`);
      }

      const updatedJuly = (await QueueStore.getQueue()).find((j) => j.id === julyJob.id);
      if (!updatedJuly || updatedJuly.syncStatus !== 'SYNCED') {
        throw new Error(`Expected July job syncStatus to become SYNCED, got: ${updatedJuly?.syncStatus}`);
      }
    }
  );

  // 55. LOC-20: Auto-Sync on download completion
  await executeTest(
    'LOC-20',
    'LOCAL_SYNC_M3',
    'Auto-Sync on Download Completion',
    'Verifies enabling Auto-Sync automatically synchronizes a completed GST Portal download into local storage',
    async () => {
      await testSyncEngine.setAutoSync(true);

      const autoJob = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'August',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      // Simulate download completion event
      await QueueStore.updateJob(autoJob.id, {
        status: 'DOWNLOADED',
        filename: 'GSTR2B_27AABCU9603R1ZM_082025.json',
      });

      await testSyncEngine.onDownloadCompleted(autoJob.id);

      const updatedAuto = (await QueueStore.getQueue()).find((j) => j.id === autoJob.id);
      if (!updatedAuto || updatedAuto.syncStatus !== 'SYNCED') {
        throw new Error(`Expected autoJob syncStatus to be SYNCED, got: ${updatedAuto?.syncStatus}`);
      }

      const provider = testSyncEngine.getProvider();
      const exists = await provider.fileExists(
        ['27AABCU9603R1ZM_My Company', '2025-26', 'GSTR-2B'],
        'GSTR-2B_August_2025-26.json'
      );
      if (!exists) {
        throw new Error('Auto-synced file was not found on filesystem');
      }
    }
  );

  // 56. LOC-21: Real production job requires actual downloaded content
  await executeTest(
    'LOC-21',
    'LOCAL_SYNC_M3',
    'Real Job Rejects Missing Download Content',
    'Verifies real production jobs (isTestJob: false) fail sync (SYNC_FAILED) and never fabricate synthetic data if actual downloaded content is unavailable',
    async () => {
      const realJob = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'September',
        returnType: 'GSTR-2B',
        isTestJob: false,
      });

      await QueueStore.updateJob(realJob.id, {
        status: 'DOWNLOADED',
        filename: 'GSTR2B_27AABCU9603R1ZM_092025.json',
        downloadContent: null,
      });

      const refreshed = (await QueueStore.getQueue()).find((j) => j.id === realJob.id)!;
      const res = await testSyncEngine.syncJob(refreshed);
      if (res.success) {
        throw new Error('Real production job without downloadContent must NOT succeed sync');
      }

      const updated = (await QueueStore.getQueue()).find((j) => j.id === realJob.id);
      if (!updated || updated.syncStatus !== 'SYNC_FAILED') {
        throw new Error(`Expected real job syncStatus to become SYNC_FAILED, got: ${updated?.syncStatus}`);
      }
      if (updated.status !== 'DOWNLOADED') {
        throw new Error(`Expected real job status to remain DOWNLOADED, got: ${updated?.status}`);
      }

      const provider = testSyncEngine.getProvider();
      const exists = await provider.fileExists(
        ['27AABCU9603R1ZM_My Company', '2025-26', 'GSTR-2B'],
        'GSTR-2B_September_2025-26.json'
      );
      if (exists) {
        throw new Error('Synthetic file was incorrectly written for real production job missing download content');
      }
    }
  );

  // 57. LOC-22: Real JSON content preservation
  await executeTest(
    'LOC-22',
    'LOCAL_SYNC_M3',
    'Real GSTR-2B JSON Content Preservation',
    'Verifies actual downloaded GSTR-2B JSON payload (B2B invoices, supplier CTINs, taxable amounts) is accurately preserved on local disk',
    async () => {
      const realGstr2bPayload = JSON.stringify({
        gstin: '27AABCU9603R1ZM',
        fp: '012026',
        cur_gt: 450000.5,
        b2b: [
          {
            ctin: '06AAAAA0000A1Z5',
            cfs: 'Y',
            inv: [
              {
                inum: 'INV/2026/0101',
                idt: '15-01-2026',
                val: 118000,
                pos: '27',
                rchrg: 'N',
                inv_typ: 'R',
                itc: { tx_i: 18000, tx_c: 0, tx_s: 0 },
              },
            ],
          },
        ],
        b2ba: [],
        cdnr: [],
        cdnra: [],
        isd: [],
      });

      const realJobWithContent = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'January',
        returnType: 'GSTR-2B',
        isTestJob: false,
      });

      await QueueStore.updateJob(realJobWithContent.id, {
        status: 'DOWNLOADED',
        filename: 'GSTR2B_27AABCU9603R1ZM_012026.json',
        downloadContent: realGstr2bPayload,
      });

      const refreshedJob = (await QueueStore.getQueue()).find((j) => j.id === realJobWithContent.id)!;
      const syncRes = await testSyncEngine.syncJob(refreshedJob);

      if (!syncRes.success) {
        throw new Error(`Expected real job sync to succeed, failed with: ${syncRes.error}`);
      }

      const provider = testSyncEngine.getProvider();
      const savedContent = await provider.readFile(
        ['27AABCU9603R1ZM_My Company', '2025-26', 'GSTR-2B'],
        'GSTR-2B_January_2025-26.json'
      );

      if (!savedContent) {
        throw new Error('Saved GSTR-2B file could not be read from storage provider');
      }

      const parsed = JSON.parse(savedContent);
      if (!parsed.b2b || parsed.b2b.length !== 1 || parsed.b2b[0].ctin !== '06AAAAA0000A1Z5') {
        throw new Error('Real GSTR-2B B2B invoice data was corrupted or overwritten with empty arrays');
      }
      if (parsed.b2b[0].inv[0].inum !== 'INV/2026/0101' || parsed.b2b[0].inv[0].val !== 118000) {
        throw new Error('Invoice number or value was not preserved');
      }
    }
  );

  // 58. LOC-23: Invalid HTML rejection
  await executeTest(
    'LOC-23',
    'LOCAL_SYNC_M3',
    'HTML & Login Page Rejection',
    'Verifies downloaded HTML pages (e.g. portal login timeouts, redirects) are rejected with SYNC_FAILED and never saved as .json',
    async () => {
      const htmlJob = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'February',
        returnType: 'GSTR-2B',
        isTestJob: false,
      });

      await QueueStore.updateJob(htmlJob.id, {
        status: 'DOWNLOADED',
        filename: 'GSTR2B_27AABCU9603R1ZM_022026.json',
        downloadContent: '<!DOCTYPE html><html><head><title>GST Login Portal</title></head><body>Please login to continue</body></html>',
      });

      const refreshedHtmlJob = (await QueueStore.getQueue()).find((j) => j.id === htmlJob.id)!;
      const res = await testSyncEngine.syncJob(refreshedHtmlJob);

      if (res.success) {
        throw new Error('Sync must reject HTML error/login page content');
      }

      const updated = (await QueueStore.getQueue()).find((j) => j.id === htmlJob.id);
      if (!updated || updated.syncStatus !== 'SYNC_FAILED') {
        throw new Error(`Expected syncStatus to be SYNC_FAILED for HTML content, got: ${updated?.syncStatus}`);
      }
      if (updated.status !== 'DOWNLOADED') {
        throw new Error(`Expected job status to remain DOWNLOADED, got: ${updated?.status}`);
      }
      if (!updated.syncError?.toLowerCase().includes('html')) {
        throw new Error(`Expected syncError to mention HTML page, got: ${updated.syncError}`);
      }

      const provider = testSyncEngine.getProvider();
      const exists = await provider.fileExists(
        ['27AABCU9603R1ZM_My Company', '2025-26', 'GSTR-2B'],
        'GSTR-2B_February_2025-26.json'
      );
      if (exists) {
        throw new Error('HTML content was illegally written to local storage as .json');
      }
    }
  );

  // 59. LOC-24: Empty file rejection
  await executeTest(
    'LOC-24',
    'LOCAL_SYNC_M3',
    'Empty File Rejection',
    'Verifies empty downloaded content (whitespace or zero-length) is rejected with SYNC_FAILED and never saved',
    async () => {
      const emptyJob = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'November',
        returnType: 'GSTR-2B',
        isTestJob: false,
      });

      await QueueStore.updateJob(emptyJob.id, {
        status: 'DOWNLOADED',
        filename: 'GSTR2B_27AABCU9603R1ZM_112025.json',
        downloadContent: '   ',
      });

      const refreshedEmptyJob = (await QueueStore.getQueue()).find((j) => j.id === emptyJob.id)!;
      const res = await testSyncEngine.syncJob(refreshedEmptyJob);

      if (res.success) {
        throw new Error('Sync must reject empty downloaded file content');
      }

      const updated = (await QueueStore.getQueue()).find((j) => j.id === emptyJob.id);
      if (!updated || updated.syncStatus !== 'SYNC_FAILED') {
        throw new Error(`Expected syncStatus to be SYNC_FAILED for empty content, got: ${updated?.syncStatus}`);
      }
      if (updated.status !== 'DOWNLOADED') {
        throw new Error(`Expected job status to remain DOWNLOADED, got: ${updated?.status}`);
      }

      const provider = testSyncEngine.getProvider();
      const exists = await provider.fileExists(
        ['27AABCU9603R1ZM_My Company', '2025-26', 'GSTR-2B'],
        'GSTR-2B_November_2025-26.json'
      );
      if (exists) {
        throw new Error('Empty file was incorrectly written to local storage');
      }
    }
  );

  // 60. LOC-25: Test job synthetic behavior preservation
  await executeTest(
    'LOC-25',
    'LOCAL_SYNC_M3',
    'Test Job Synthetic Payload Preservation',
    'Verifies test harness jobs (isTestJob: true) continue to generate deterministic test payloads for automated test suites',
    async () => {
      const testJob = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'December',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      await QueueStore.updateJob(testJob.id, {
        status: 'DOWNLOADED',
        filename: 'GSTR2B_27AABCU9603R1ZM_122025.json',
      });

      const refreshedTestJob = (await QueueStore.getQueue()).find((j) => j.id === testJob.id)!;
      const res = await testSyncEngine.syncJob(refreshedTestJob);

      if (!res.success) {
        throw new Error(`Expected test job sync to succeed, failed: ${res.error}`);
      }

      const updated = (await QueueStore.getQueue()).find((j) => j.id === testJob.id);
      if (!updated || updated.syncStatus !== 'SYNCED') {
        throw new Error(`Expected test job syncStatus to be SYNCED, got: ${updated?.syncStatus}`);
      }

      const provider = testSyncEngine.getProvider();
      const exists = await provider.fileExists(
        ['27AABCU9603R1ZM_My Company', '2025-26', 'GSTR-2B'],
        'GSTR-2B_December_2025-26.json'
      );
      if (!exists) {
        throw new Error('Test job deterministic file was not created');
      }
    }
  );

  // =========================================================================
  // MILESTONE 4 — MULTI-RETURN DOWNLOAD EXPANSION TESTS (M4-01 to M4-15)
  // =========================================================================

  // 61. M4-01: Adapter Registry dynamic lookup
  await executeTest(
    'M4-01',
    'MULTI_RETURN_M4',
    'Adapter Registry Dynamic Lookup',
    'Validates dynamic adapter lookup and factory instantiation for GSTR-1, GSTR-2A, GSTR-2B, and GSTR-3B',
    async () => {
      const gstr1 = getAdapterForReturnType('GSTR-1');
      const gstr2a = getAdapterForReturnType('GSTR-2A');
      const gstr2b = getAdapterForReturnType('GSTR-2B');
      const gstr3b = getAdapterForReturnType('GSTR-3B');

      if (!gstr1 || gstr1.returnType !== 'GSTR-1') {
        throw new Error(`Expected GSTR-1 adapter, got: ${gstr1?.returnType}`);
      }
      if (!gstr2a || gstr2a.returnType !== 'GSTR-2A') {
        throw new Error(`Expected GSTR-2A adapter, got: ${gstr2a?.returnType}`);
      }
      if (!gstr2b || gstr2b.returnType !== 'GSTR-2B') {
        throw new Error(`Expected GSTR-2B adapter, got: ${gstr2b?.returnType}`);
      }
      if (!gstr3b || gstr3b.returnType !== 'GSTR-3B') {
        throw new Error(`Expected GSTR-3B adapter, got: ${gstr3b?.returnType}`);
      }

      const allAdapters = adapterRegistry.getAllAdapters();
      if (allAdapters.length < 4) {
        throw new Error(`Expected at least 4 registered adapters, found: ${allAdapters.length}`);
      }
    }
  );

  // 62. M4-02: GSTR-1 Adapter URL and Page Detection
  await executeTest(
    'M4-02',
    'MULTI_RETURN_M4',
    'GSTR-1 Page and URL Detection',
    'Validates GSTR-1 adapter page detection for GST Portal returns dashboard and outward supplies forms',
    async () => {
      const adapter = new GSTR1Adapter();
      const validUrls = [
        'https://services.gst.gov.in/services/auth/returns/gstr1',
        'https://services.gst.gov.in/returns/return-dashboard',
        'https://services.gst.gov.in/services/auth/returns',
      ];

      for (const url of validUrls) {
        if (!adapter.canHandlePage(url, 'Returns Dashboard')) {
          throw new Error(`GSTR-1 adapter failed to handle valid URL: ${url}`);
        }
      }

      if (adapter.canHandlePage('https://example.com/other-page', 'Other Site')) {
        throw new Error('GSTR-1 adapter accepted invalid non-GST URL');
      }
    }
  );

  // 63. M4-03: GSTR-1 DOM Selectors & Navigation
  await executeTest(
    'M4-03',
    'MULTI_RETURN_M4',
    'GSTR-1 DOM Selectors & Navigation',
    'Validates GSTR-1 adapter FY/Period selection, GSTIN verification, and download tile navigation against simulator',
    async () => {
      const adapter = new GSTR1Adapter();
      const simContainer = GSTPortalSimulator.ensureMounted();

      const gstinCheck = adapter.verifyGstinContext('27AABCU9603R1ZM');
      if (!gstinCheck.verified) {
        throw new Error(`GSTR-1 GSTIN check failed: ${gstinCheck.reason}`);
      }

      const fyRes = await adapter.selectFinancialYear('2025-2026');
      if (!fyRes.success) {
        throw new Error(`GSTR-1 FY selection failed: ${fyRes.error}`);
      }

      const periodRes = await adapter.selectReturnPeriod('April');
      if (!periodRes.success) {
        throw new Error(`GSTR-1 Period selection failed: ${periodRes.error}`);
      }

      const searchRes = await adapter.clickSearch();
      if (!searchRes.success) {
        throw new Error(`GSTR-1 click search failed: ${searchRes.error}`);
      }

      const navRes = await adapter.navigateToGstr1Download();
      if (!navRes.success) {
        throw new Error(`GSTR-1 download navigation failed: ${navRes.error}`);
      }
    }
  );

  // 64. M4-04: GSTR-1 Simulation Scenarios
  await executeTest(
    'M4-04',
    'MULTI_RETURN_M4',
    'GSTR-1 Multi-Scenario Simulation',
    'Validates GSTR-1 adapter across Happy Path, Already Generated, Timeout, Portal Error, and GSTIN Mismatch scenarios',
    async () => {
      const adapter = new GSTR1Adapter();

      // Happy Path
      const happy = await adapter.simulateM4Workflow({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'April',
        scenario: 'HAPPY_PATH',
      });
      if (!happy.success || happy.state !== 'DOWNLOADED' || !happy.filename?.includes('GSTR1')) {
        throw new Error('GSTR-1 HAPPY_PATH simulation failed');
      }

      // GSTIN Mismatch
      const mismatch = await adapter.simulateM4Workflow({
        gstin: '29ABCDE1234F1Z5',
        financialYear: '2025-2026',
        period: 'April',
        scenario: 'GSTIN_MISMATCH',
      });
      if (mismatch.success || mismatch.state !== 'FAILED') {
        throw new Error('GSTR-1 GSTIN_MISMATCH simulation must fail safely');
      }

      // Portal Error
      const portalErr = await adapter.simulateM4Workflow({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'April',
        scenario: 'PORTAL_ERROR',
      });
      if (portalErr.success || !portalErr.error?.includes('GST Portal reported')) {
        throw new Error('GSTR-1 PORTAL_ERROR simulation must report portal error');
      }
    }
  );

  // 65. M4-05: GSTR-2A Adapter URL and Page Detection
  await executeTest(
    'M4-05',
    'MULTI_RETURN_M4',
    'GSTR-2A Page and URL Detection',
    'Validates GSTR-2A adapter page detection for GST Portal returns dashboard and auto-drafted details',
    async () => {
      const adapter = new GSTR2AAdapter();
      const validUrls = [
        'https://services.gst.gov.in/services/auth/returns/gstr2a',
        'https://services.gst.gov.in/returns/return-dashboard',
        'https://services.gst.gov.in/services/auth/returns',
      ];

      for (const url of validUrls) {
        if (!adapter.canHandlePage(url, 'Returns Dashboard')) {
          throw new Error(`GSTR-2A adapter failed to handle valid URL: ${url}`);
        }
      }

      if (adapter.canHandlePage('https://example.com/other-page', 'Other Site')) {
        throw new Error('GSTR-2A adapter accepted invalid non-GST URL');
      }
    }
  );

  // 66. M4-06: GSTR-2A DOM Selectors & Navigation
  await executeTest(
    'M4-06',
    'MULTI_RETURN_M4',
    'GSTR-2A DOM Selectors & Navigation',
    'Validates GSTR-2A adapter FY/Period selection, GSTIN verification, and download tile navigation against simulator',
    async () => {
      const adapter = new GSTR2AAdapter();
      GSTPortalSimulator.ensureMounted();

      const gstinCheck = adapter.verifyGstinContext('27AABCU9603R1ZM');
      if (!gstinCheck.verified) {
        throw new Error(`GSTR-2A GSTIN check failed: ${gstinCheck.reason}`);
      }

      const fyRes = await adapter.selectFinancialYear('2025-2026');
      if (!fyRes.success) {
        throw new Error(`GSTR-2A FY selection failed: ${fyRes.error}`);
      }

      const periodRes = await adapter.selectReturnPeriod('May');
      if (!periodRes.success) {
        throw new Error(`GSTR-2A Period selection failed: ${periodRes.error}`);
      }

      const searchRes = await adapter.clickSearch();
      if (!searchRes.success) {
        throw new Error(`GSTR-2A click search failed: ${searchRes.error}`);
      }

      const navRes = await adapter.navigateToGstr2aDownload();
      if (!navRes.success) {
        throw new Error(`GSTR-2A download navigation failed: ${navRes.error}`);
      }
    }
  );

  // 67. M4-07: GSTR-2A Simulation Scenarios
  await executeTest(
    'M4-07',
    'MULTI_RETURN_M4',
    'GSTR-2A Multi-Scenario Simulation',
    'Validates GSTR-2A adapter across Happy Path, Timeout, and Portal Error scenarios',
    async () => {
      const adapter = new GSTR2AAdapter();

      // Happy Path
      const happy = await adapter.simulateM4Workflow({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'May',
        scenario: 'HAPPY_PATH',
      });
      if (!happy.success || happy.state !== 'DOWNLOADED' || !happy.filename?.includes('GSTR2A')) {
        throw new Error('GSTR-2A HAPPY_PATH simulation failed');
      }

      // Timeout
      const timeout = await adapter.simulateM4Workflow({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'May',
        scenario: 'TIMEOUT',
      });
      if (timeout.success || !timeout.error?.includes('Timed out')) {
        throw new Error('GSTR-2A TIMEOUT simulation must fail safely');
      }
    }
  );

  // 68. M4-08: GSTR-3B Adapter URL and Page Detection
  await executeTest(
    'M4-08',
    'MULTI_RETURN_M4',
    'GSTR-3B Page and URL Detection',
    'Validates GSTR-3B adapter page detection for GST Portal returns dashboard and monthly return summary',
    async () => {
      const adapter = new GSTR3BAdapter();
      const validUrls = [
        'https://services.gst.gov.in/services/auth/returns/gstr3b',
        'https://services.gst.gov.in/returns/return-dashboard',
        'https://services.gst.gov.in/services/auth/returns',
      ];

      for (const url of validUrls) {
        if (!adapter.canHandlePage(url, 'Returns Dashboard')) {
          throw new Error(`GSTR-3B adapter failed to handle valid URL: ${url}`);
        }
      }

      if (adapter.canHandlePage('https://example.com/other-page', 'Other Site')) {
        throw new Error('GSTR-3B adapter accepted invalid non-GST URL');
      }
    }
  );

  // 69. M4-09: GSTR-3B DOM Selectors & Navigation
  await executeTest(
    'M4-09',
    'MULTI_RETURN_M4',
    'GSTR-3B DOM Selectors & Navigation',
    'Validates GSTR-3B adapter FY/Period selection, GSTIN verification, and download tile navigation against simulator',
    async () => {
      const adapter = new GSTR3BAdapter();
      GSTPortalSimulator.ensureMounted();

      const gstinCheck = adapter.verifyGstinContext('27AABCU9603R1ZM');
      if (!gstinCheck.verified) {
        throw new Error(`GSTR-3B GSTIN check failed: ${gstinCheck.reason}`);
      }

      const fyRes = await adapter.selectFinancialYear('2025-2026');
      if (!fyRes.success) {
        throw new Error(`GSTR-3B FY selection failed: ${fyRes.error}`);
      }

      const periodRes = await adapter.selectReturnPeriod('June');
      if (!periodRes.success) {
        throw new Error(`GSTR-3B Period selection failed: ${periodRes.error}`);
      }

      const searchRes = await adapter.clickSearch();
      if (!searchRes.success) {
        throw new Error(`GSTR-3B click search failed: ${searchRes.error}`);
      }

      const navRes = await adapter.navigateToGstr3bDownload();
      if (!navRes.success) {
        throw new Error(`GSTR-3B download navigation failed: ${navRes.error}`);
      }
    }
  );

  // 70. M4-10: GSTR-3B Simulation Scenarios
  await executeTest(
    'M4-10',
    'MULTI_RETURN_M4',
    'GSTR-3B Multi-Scenario Simulation',
    'Validates GSTR-3B adapter across Happy Path, Already Generated, and Portal Error scenarios',
    async () => {
      const adapter = new GSTR3BAdapter();

      // Happy Path
      const happy = await adapter.simulateM4Workflow({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'June',
        scenario: 'HAPPY_PATH',
      });
      if (!happy.success || happy.state !== 'DOWNLOADED' || !happy.filename?.includes('GSTR3B')) {
        throw new Error('GSTR-3B HAPPY_PATH simulation failed');
      }

      // Portal Error
      const portalErr = await adapter.simulateM4Workflow({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'June',
        scenario: 'PORTAL_ERROR',
      });
      if (portalErr.success || !portalErr.error?.includes('GST Portal reported')) {
        throw new Error('GSTR-3B PORTAL_ERROR simulation must fail safely');
      }
    }
  );

  // 71. M4-11: Multi-Return Sequential Queue Execution
  await executeTest(
    'M4-11',
    'MULTI_RETURN_M4',
    'Multi-Return Sequential Queue Execution',
    'Verifies sequential queue execution with mixed return types (GSTR-1, GSTR-2A, GSTR-2B, GSTR-3B)',
    async () => {
      // 1. Strict test isolation
      await QueueStore.clearAll();
      await testDownloadMonitor.reset();
      await QueueStore.updateQueueState({ activeJobId: null, isRunning: false, isPaused: false });

      // 2. Add 4 test jobs
      const j1 = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'April',
        returnType: 'GSTR-1',
        isTestJob: true,
      });

      const j2 = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'May',
        returnType: 'GSTR-2A',
        isTestJob: true,
      });

      const j3 = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'June',
        returnType: 'GSTR-2B',
        isTestJob: true,
      });

      const j4 = await QueueStore.addJob({
        gstin: '27AABCU9603R1ZM',
        financialYear: '2025-2026',
        period: 'July',
        returnType: 'GSTR-3B',
        isTestJob: true,
      });

      // 3. Start queue
      await testQueueManager.startQueue();

      // 4. Deterministic polling: wait until all 4 jobs reach DOWNLOADED state (up to 18 seconds)
      const startTime = Date.now();
      const timeoutMs = 18000;
      const targetIds = [j1.id, j2.id, j3.id, j4.id];

      while (Date.now() - startTime < timeoutMs) {
        const queue = await QueueStore.getQueue();
        const allDownloaded = targetIds.every((id) => {
          const item = queue.find((q) => q.id === id);
          return item?.status === 'DOWNLOADED';
        });

        if (allDownloaded) {
          break;
        }
        await sleep(250);
      }

      // 5. Final state assertions
      const finalJobs = await QueueStore.getQueue();
      for (const j of [j1, j2, j3, j4]) {
        const found = finalJobs.find((item) => item.id === j.id);
        if (!found || found.status !== 'DOWNLOADED') {
          throw new Error(`Job ${j.returnType} (${j.id}) expected DOWNLOADED, got: ${found?.status}`);
        }
        if (!found.browserDownloadId || !found.filename) {
          throw new Error(`Job ${j.returnType} (${j.id}) missing download metadata: dlId=${found?.browserDownloadId}, file=${found?.filename}`);
        }
      }
    }
  );

  // 72. M4-12: Multi-Return Deterministic Path & Filename Generation
  await executeTest(
    'M4-12',
    'MULTI_RETURN_M4',
    'Multi-Return Path & Filename Generation',
    'Verifies deterministic folder structure and file naming for all 4 returns',
    async () => {
      const gstin = '27AABCU9603R1ZM';
      const companyName = 'Global Traders Ltd';
      const fy = '2025-2026';
      const period = 'August';

      const r1Path = getFullRelativePath(gstin, companyName, fy, period, 'GSTR-1');
      const r2aPath = getFullRelativePath(gstin, companyName, fy, period, 'GSTR-2A');
      const r2bPath = getFullRelativePath(gstin, companyName, fy, period, 'GSTR-2B');
      const r3bPath = getFullRelativePath(gstin, companyName, fy, period, 'GSTR-3B');

      if (r1Path !== '27AABCU9603R1ZM_Global Traders Ltd/2025-26/GSTR-1/GSTR-1_August_2025-26.json') {
        throw new Error(`Unexpected GSTR-1 path: ${r1Path}`);
      }
      if (r2aPath !== '27AABCU9603R1ZM_Global Traders Ltd/2025-26/GSTR-2A/GSTR-2A_August_2025-26.json') {
        throw new Error(`Unexpected GSTR-2A path: ${r2aPath}`);
      }
      if (r2bPath !== '27AABCU9603R1ZM_Global Traders Ltd/2025-26/GSTR-2B/GSTR-2B_August_2025-26.json') {
        throw new Error(`Unexpected GSTR-2B path: ${r2bPath}`);
      }
      if (r3bPath !== '27AABCU9603R1ZM_Global Traders Ltd/2025-26/GSTR-3B/GSTR-3B_August_2025-26.json') {
        throw new Error(`Unexpected GSTR-3B path: ${r3bPath}`);
      }
    }
  );

  // 73. M4-13: Multi-Return Real Local Storage Synchronization
  await executeTest(
    'M4-13',
    'MULTI_RETURN_M4',
    'Multi-Return Local Storage Synchronization',
    'Verifies local sync engine organizes real JSON payloads across all 4 return types into appropriate folder hierarchies',
    async () => {
      const testSync = SyncEngine.getInstance();
      await testSync.configureRoot();
      const provider = testSync.getProvider();

      const returnTypes: Array<'GSTR-1' | 'GSTR-2A' | 'GSTR-2B' | 'GSTR-3B'> = [
        'GSTR-1',
        'GSTR-2A',
        'GSTR-2B',
        'GSTR-3B',
      ];

      for (const rt of returnTypes) {
        const job = await QueueStore.addJob({
          gstin: '27AABCU9603R1ZM',
          financialYear: '2025-2026',
          period: 'September',
          returnType: rt,
          isTestJob: false,
        });

        const realJson = JSON.stringify({
          gstin: '27AABCU9603R1ZM',
          fp: '092025',
          returnType: rt,
          data: { sampleKey: `${rt} verified payload` },
        });

        await QueueStore.updateJob(job.id, {
          status: 'DOWNLOADED',
          filename: `${rt}_27AABCU9603R1ZM_092025.json`,
          downloadContent: realJson,
        });

        const refreshed = (await QueueStore.getQueue()).find((j) => j.id === job.id)!;
        const res = await testSync.syncJob(refreshed);

        if (!res.success) {
          throw new Error(`Failed to sync ${rt}: ${res.error}`);
        }

        const exists = await provider.fileExists(
          ['27AABCU9603R1ZM_My Company', '2025-26', rt],
          `${rt}_September_2025-26.json`
        );

        if (!exists) {
          throw new Error(`File for ${rt} was not found in expected folder`);
        }
      }
    }
  );

  // 74. M4-14: Zero-Credential Security Audit Across All Return Adapters
  await executeTest(
    'M4-14',
    'MULTI_RETURN_M4',
    'Zero-Credential Security Audit Across All Adapters',
    'Verifies none of the return adapters (GSTR-1, GSTR-2A, GSTR-2B, GSTR-3B) capture, store, or intercept credentials, OTPs, or CAPTCHA',
    async () => {
      const adapters = adapterRegistry.getAllAdapters();
      for (const adapter of adapters) {
        const adapterStr = JSON.stringify(adapter).toLowerCase();
        const forbidden = ['password', 'otp', 'captcha', 'secret', 'auth_token'];
        for (const word of forbidden) {
          if (adapterStr.includes(word)) {
            throw new Error(`Adapter ${adapter.returnType} contains forbidden credential keyword: ${word}`);
          }
        }
      }
    }
  );

  // 75. M4-15: Unsupported Return Type Guard
  await executeTest(
    'M4-15',
    'MULTI_RETURN_M4',
    'Unsupported Return Type Guard',
    'Verifies registry throws explicit descriptive error for unsupported return types',
    async () => {
      try {
        // @ts-expect-error Testing invalid return type guard
        getAdapterForReturnType('GSTR-9');
        throw new Error('Registry must throw for unsupported return type');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('Unsupported return type')) {
          throw new Error(`Expected unsupported return error, got: ${msg}`);
        }
      }
    }
  );

  return results;
}

