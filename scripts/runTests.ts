import { runAcceptanceTestSuite } from '../src/testing/testSuite';

async function main() {
  console.log('Running Udaan GST Bulk Download Assistant Acceptance Test Suite (Milestone 1, 2 & 3)...');
  const results = await runAcceptanceTestSuite((res, cur, tot) => {
    console.log(`[${cur}/${tot}] ${res.id} - ${res.title}: ${res.passed ? 'PASS' : 'FAIL'}`);
    if (!res.passed) {
      console.error(`   Error: ${res.error}`);
    }
  });

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('\n========================================');
  console.log(`TOTAL: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);
  console.log('========================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
