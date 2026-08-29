/**
 * CLI Test Runner for Udaan GST Acceptance Test Suite using real JSDOM
 */
import { JSDOM } from 'jsdom';
import { runAcceptanceTestSuite } from './testSuite';

// Setup full JSDOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://services.gst.gov.in/services/returns',
  pretendToBeVisual: true,
});

(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Element = dom.window.Element;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLButtonElement = dom.window.HTMLButtonElement;
(globalThis as any).HTMLAnchorElement = dom.window.HTMLAnchorElement;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).CustomEvent = dom.window.CustomEvent;
(globalThis as any).MouseEvent = dom.window.MouseEvent;
(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent;

// In-memory localStorage
const storageMap = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => storageMap.get(k) ?? null,
  setItem: (k: string, v: string) => storageMap.set(k, String(v)),
  removeItem: (k: string) => storageMap.delete(k),
  clear: () => storageMap.clear(),
};

async function run() {
  console.log('=== RUNNING UDAAN GST EXTENSION ACCEPTANCE TEST SUITE ===\n');
  const results = await runAcceptanceTestSuite((res, cur, tot) => {
    const symbol = res.passed ? '✓' : '✗';
    const status = res.passed ? 'PASS' : 'FAIL';
    console.log(`[${cur}/${tot}] ${symbol} [${status}] ${res.id}: ${res.title} (${res.durationMs}ms)`);
    if (!res.passed) {
      console.error(`       ERROR: ${res.error}`);
    }
  });

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  const totalCount = results.length;

  console.log('\n======================================================');
  console.log(`SUMMARY: ${passedCount}/${totalCount} PASSED (${failedCount} FAILED)`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test run failed with fatal exception:', err);
  process.exit(1);
});
