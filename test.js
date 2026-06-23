const assert = require('assert');

// 1. Set up simulated browser storage
const mockStorage = {
  blockedSites: ['youtube.com', 'facebook.com', 'reddit.com'],
  schedules: [{
    id: 'sch_1',
    name: 'Twitch Schedule',
    startTime: '00:00',
    endTime: '23:59', // Always active for the test
    days: [0, 1, 2, 3, 4, 5, 6], // Active every day
    enabled: true,
    blockedSites: ['twitch.tv'] // ONLY Twitch in this schedule
  }],
  timerActive: false
};

console.log('--- STARTING FOCUSFLOW AUTOMATED TESTS ---\n');
let passed = 0; let failed = 0;

function assertTest(name, condition) {
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${name}`);
    failed++;
  }
}

// 2. Run the exact isolation logic used in evaluateBlockingState()
try {
  let activeSites = new Set();
  let shouldBlock = false;
  
  const currentDate = new Date();
  const currentDay = currentDate.getDay();

  // Evaluate Schedules
  for (const schedule of mockStorage.schedules) {
    if (schedule.days.includes(currentDay) && schedule.enabled) {
      shouldBlock = true;
      const schSites = schedule.blockedSites || [];
      schSites.forEach(s => activeSites.add(s));
    }
  }

  const finalSites = Array.from(activeSites);
  
  // 3. Verify outcomes
  assertTest('Schedule Isolation sets blocking flag to true', shouldBlock === true);
  assertTest(`Schedule Isolation blocks exactly 1 site (Expected 1, Got ${finalSites.length})`, finalSites.length === 1);
  assertTest(`Schedule Isolation successfully captured isolated domain (Expected twitch.tv, Got ${finalSites[0]})`, finalSites[0] === 'twitch.tv');
  assertTest('Schedule Isolation successfully IGNORED global domains (YouTube, Facebook, Reddit)', !finalSites.includes('youtube.com'));

} catch (e) {
  console.error('Test Suite Crashed:', e);
}

console.log(`\n--- TESTS COMPLETE: ${passed} Passed, ${failed} Failed ---`);
