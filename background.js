// FocusFlow Background Script
const api = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULT_BLOCKED_SITES = [
  'youtube.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'reddit.com'
];

api.runtime.onInstalled.addListener(async () => {
  const storage = await api.storage.local.get([
    'blockedSites', 'schedules', 'timerActive', 'timerEnd', 
    'isCurrentlyBlocked', 'blockReason', 'theme', 
    'isPaused', 'remainingTimeMs', 'sessionHistory',
    'breakActive', 'breakEnd', 'lastTimerDuration'
  ]);
  
  const updates = {};
  if (!storage.blockedSites) updates.blockedSites = DEFAULT_BLOCKED_SITES;
  if (!storage.schedules) updates.schedules = [];
  if (storage.timerActive === undefined) updates.timerActive = false;
  if (storage.timerEnd === undefined) updates.timerEnd = 0;
  if (storage.isCurrentlyBlocked === undefined) updates.isCurrentlyBlocked = false;
  if (!storage.blockReason) updates.blockReason = '';
  if (!storage.theme) updates.theme = 'dark';
  
  // New state variables for QoL update
  if (storage.isPaused === undefined) updates.isPaused = false;
  if (storage.remainingTimeMs === undefined) updates.remainingTimeMs = 0;
  if (!storage.sessionHistory) updates.sessionHistory = [];
  if (storage.breakActive === undefined) updates.breakActive = false;
  if (storage.breakEnd === undefined) updates.breakEnd = 0;
  if (storage.lastTimerDuration === undefined) updates.lastTimerDuration = 0;
  
  if (Object.keys(updates).length > 0) {
    await api.storage.local.set(updates);
  }
  
  await api.alarms.clearAll();
  api.alarms.create('checkSchedules', { periodInMinutes: 1 });
  await evaluateBlockingState();
});

api.runtime.onStartup.addListener(async () => {
  await evaluateBlockingState();
  await api.alarms.clear('checkSchedules');
  api.alarms.create('checkSchedules', { periodInMinutes: 1 });
});

api.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'timerExpired') {
    // Record history
    const data = await api.storage.local.get(['sessionHistory', 'lastTimerDuration']);
    const history = data.sessionHistory || [];
    if (data.lastTimerDuration > 0) {
      history.push({
        id: Date.now(),
        date: new Date().toISOString(),
        durationMs: data.lastTimerDuration * 60000,
        type: 'Focus Timer'
      });
    }
    
    // Timer finished naturally!
    await api.storage.local.set({
      timerActive: false,
      timerEnd: 0,
      isPaused: false,
      sessionHistory: history
    });
  } else if (alarm.name === 'breakExpired') {
    await api.storage.local.set({
      breakActive: false,
      breakEnd: 0
    });
  } else if (alarm.name === 'checkSchedules') {
    await evaluateBlockingState();
  }
});

api.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace !== 'local') return;
  const keysToEvaluate = ['blockedSites', 'schedules', 'timerActive', 'timerEnd', 'isPaused'];
  const shouldEvaluate = keysToEvaluate.some(key => changes[key] !== undefined);
  if (shouldEvaluate) {
    await evaluateBlockingState();
  }
  
  // Handle Break Timer alarms
  if (changes.breakActive || changes.breakEnd) {
    const data = await api.storage.local.get(['breakActive', 'breakEnd']);
    if (data.breakActive && data.breakEnd > Date.now()) {
      await api.alarms.create('breakExpired', { when: data.breakEnd });
    } else {
      await api.alarms.clear('breakExpired');
    }
  }
});

async function evaluateBlockingState() {
  try {
    const data = await api.storage.local.get(['blockedSites', 'schedules', 'timerActive', 'timerEnd', 'isPaused']);
    const sites = data.blockedSites || [];
    const schedules = data.schedules || [];
    const timerEnd = data.timerEnd || 0;
    const timerActive = data.timerActive || false;
    const isPaused = data.isPaused || false;
    
    const now = Date.now();
    let shouldBlock = false;
    let blockReason = '';
    
    if (timerActive) {
      if (isPaused) {
        // Paused timer doesn't block!
        await api.alarms.clear('timerExpired');
      } else if (timerEnd > now) {
        shouldBlock = true;
        const minutesLeft = Math.ceil((timerEnd - now) / 60000);
        blockReason = `Timer active (${minutesLeft} min remaining)`;
        
        const timerAlarm = await api.alarms.get('timerExpired');
        if (!timerAlarm) {
          api.alarms.create('timerExpired', { when: timerEnd });
        }
      } else {
        // Timer expired
        await api.storage.local.set({ timerActive: false, timerEnd: 0 });
        await api.alarms.clear('timerExpired');
      }
    } else {
      await api.alarms.clear('timerExpired');
    }
    
    // Check Schedules if not blocked by timer
    if (!shouldBlock && schedules.length > 0) {
      const currentDate = new Date();
      const currentDay = currentDate.getDay();
      const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();
      
      for (const schedule of schedules) {
        if (!schedule.enabled) continue;
        if (schedule.days.includes(currentDay)) {
          const [startH, startM] = schedule.startTime.split(':').map(Number);
          const [endH, endM] = schedule.endTime.split(':').map(Number);
          const startMinutes = startH * 60 + startM;
          const endMinutes = endH * 60 + endM;
          
          let inTimeRange = false;
          if (startMinutes <= endMinutes) {
            inTimeRange = currentMinutes >= startMinutes && currentMinutes < endMinutes;
          } else {
            inTimeRange = currentMinutes >= startMinutes || currentMinutes < endMinutes;
          }
          
          if (inTimeRange) {
            shouldBlock = true;
            blockReason = `Schedule "${schedule.name}" is active (${schedule.startTime} - ${schedule.endTime})`;
            break;
          }
        }
      }
    }
    
    await updateBlockingRules(sites, shouldBlock);
    
    await api.storage.local.set({
      isCurrentlyBlocked: shouldBlock,
      blockReason: blockReason
    });
  } catch (err) {
    console.error('Error evaluating blocking state:', err);
  }
}

async function updateBlockingRules(domains, blockActive) {
  const existingRules = await api.declarativeNetRequest.getDynamicRules();
  const existingIds = existingRules.map(r => r.id);
  
  const rulesToAdd = [];
  if (blockActive && domains.length > 0) {
    domains.forEach((domain, index) => {
      rulesToAdd.push({
        id: index + 1,
        priority: 1,
        action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
        condition: { urlFilter: `||${domain.trim()}^`, resourceTypes: ['main_frame'] }
      });
    });
  }
  
  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingIds,
    addRules: rulesToAdd
  });
}
