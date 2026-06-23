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
  if (alarm.name === 'timerExpired' || alarm.name === 'checkSchedules') {
    await evaluateBlockingState();
  } else if (alarm.name === 'breakExpired') {
    const data = await api.storage.local.get(['sessionHistory', 'breakStart']);
    const history = data.sessionHistory || [];
    if (data.breakStart) {
      history.push({
        id: Date.now(),
        date: new Date().toISOString(),
        durationMs: Date.now() - data.breakStart,
        type: 'Break Timer'
      });
    }
    await api.storage.local.set({
      breakActive: false,
      breakEnd: 0,
      breakStart: 0,
      sessionHistory: history
    });
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
    const data = await api.storage.local.get(['blockedSites', 'whitelist', 'schedules', 'timerActive', 'timerEnd', 'isPaused']);
    const globalSites = data.blockedSites || [];
    const whitelist = data.whitelist || [];
    const schedules = data.schedules || [];
    const timerEnd = data.timerEnd || 0;
    const timerActive = data.timerActive || false;
    const isPaused = data.isPaused || false;
    
    const now = Date.now();
    let shouldBlock = false;
    let blockReason = '';
    let activeSites = new Set();
    
    if (timerActive) {
      if (isPaused) {
        // Paused timer doesn't block!
        await api.alarms.clear('timerExpired');
      } else if (timerEnd > now) {
        shouldBlock = true;
        const minutesLeft = Math.ceil((timerEnd - now) / 60000);
        blockReason = `Timer active (${minutesLeft} min remaining)`;
        globalSites.forEach(s => activeSites.add(s));
        
        const timerAlarm = await api.alarms.get('timerExpired');
        if (!timerAlarm) {
          api.alarms.create('timerExpired', { when: timerEnd });
        }
      } else {
        // Timer expired naturally
        const histData = await api.storage.local.get(['sessionHistory', 'timerStart']);
        const history = histData.sessionHistory || [];
        if (histData.timerStart) {
          history.push({
            id: Date.now(),
            date: new Date().toISOString(),
            durationMs: Date.now() - histData.timerStart,
            type: 'Focus Timer'
          });
        }
        await api.storage.local.set({ 
          timerActive: false, 
          timerEnd: 0, 
          timerStart: 0, 
          isPaused: false,
          sessionHistory: history 
        });
        await api.alarms.clear('timerExpired');
      }
    } else {
      await api.alarms.clear('timerExpired');
    }
    
    // Check Schedules
    const currentDate = new Date();
    const currentDay = currentDate.getDay();
    const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();
    
    let activeScheduleNames = [];
    let activeScheduleIds = [];
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
          activeScheduleNames.push(schedule.name);
          activeScheduleIds.push(schedule.id);
          const schSites = schedule.blockedSites || [];
          schSites.forEach(s => activeSites.add(s));
        }
      }
    }
    
    if (activeScheduleNames.length > 0 && !blockReason) {
      blockReason = `Schedule "${activeScheduleNames.join(', ')}" is active`;
    } else if (activeScheduleNames.length > 0) {
      blockReason += ` & Schedule "${activeScheduleNames.join(', ')}"`;
    }
    
    const finalSitesToBlock = Array.from(activeSites);
    
    await updateBlockingRules(finalSitesToBlock, whitelist, shouldBlock);
    
    await api.storage.local.set({
      isCurrentlyBlocked: shouldBlock,
      blockReason: blockReason,
      activeBlockedSites: finalSitesToBlock,
      activeScheduleIds: activeScheduleIds
    });
    
    // Immediately sweep open tabs to enforce new block rules without requiring a reload
    if (shouldBlock && finalSitesToBlock.length > 0) {
      await enforceBlockingOnOpenTabs(finalSitesToBlock, whitelist);
    }
  } catch (err) {
    console.error('Error evaluating blocking state:', err);
  }
}

async function updateBlockingRules(domains, whitelist, blockActive) {
  try {
    const existingRules = await api.declarativeNetRequest.getDynamicRules();
    const existingIds = existingRules.map(r => r.id);
    
    // Ensure new IDs never overlap with old IDs to bypass browser deletion bugs
    let maxId = 0;
    if (existingIds.length > 0) {
      maxId = Math.max(...existingIds);
    }
    let ruleIdCounter = maxId + 1;
    const rulesToAdd = [];
    
    if (blockActive) {
      const validDomains = domains.filter(d => typeof d === 'string' && d.trim().length > 0);
      validDomains.forEach((domain) => {
        rulesToAdd.push({
          id: ruleIdCounter++,
          priority: 1,
          action: { 
            type: 'redirect', 
            redirect: { url: api.runtime.getURL('/blocked.html') + `?d=${encodeURIComponent(domain.trim())}` } 
          },
          // action: { type: 'block' }, // Kept for testing if needed
          condition: { 
            urlFilter: `||${domain.trim()}`, 
            resourceTypes: ['main_frame'] 
          }
        });
      });
      
      const validWhitelist = whitelist.filter(w => typeof w === 'string' && w.trim().length > 0);
      validWhitelist.forEach((domain) => {
        rulesToAdd.push({
          id: ruleIdCounter++,
          priority: 2,
          action: { type: 'allow' },
          condition: { 
            urlFilter: `||${domain.trim()}`, 
            resourceTypes: ['main_frame'] 
          }
        });
      });
    }
    
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: rulesToAdd
    });
  } catch (err) {
    console.error("DNR Update Error:", err);
    // Pop a diagnostics tab so the user can report the exact error
    await api.tabs.create({ url: 'data:text/plain;charset=utf-8,' + encodeURIComponent('FocusFlow Firewall Error: ' + err.message + '\n\nPlease copy this exact message and send it to the AI assistant!') });
  }
}

async function enforceBlockingOnOpenTabs(sites, whitelist) {
  try {
    const tabs = await api.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:') || tab.url.startsWith('chrome-extension:')) continue;
      
      try {
        const urlObj = new URL(tab.url);
        const host = urlObj.hostname.toLowerCase();
        
        // 1. Check if whitelisted
        const isWhitelisted = whitelist.some(w => host === w || host.endsWith('.' + w));
        if (isWhitelisted) continue;
        
        // 2. Check if blocked
        const isBlocked = sites.some(s => host === s || host.endsWith('.' + s));
        if (isBlocked) {
          const redirectUrl = api.runtime.getURL('/blocked.html') + '?url=' + encodeURIComponent(tab.url);
          await api.tabs.update(tab.id, { url: redirectUrl });
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }
  } catch (err) {
    console.error('Error sweeping open tabs:', err);
  }
}

// Secondary Unbreachable Firewall: Catch any navigation that slips past DNR
api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const currentUrl = changeInfo.url || tab.url;
  if (!currentUrl) return;
  
  if (currentUrl.startsWith('about:') || currentUrl.startsWith('moz-extension:') || currentUrl.startsWith('chrome-extension:')) return;
  
  const data = await api.storage.local.get(['isCurrentlyBlocked', 'activeBlockedSites', 'whitelist']);
  if (data.isCurrentlyBlocked) {
    const sites = data.activeBlockedSites || [];
    const whitelist = data.whitelist || [];
    
    try {
      const urlObj = new URL(currentUrl);
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') return;
      
      const host = urlObj.hostname.toLowerCase();
      
      const isWhitelisted = whitelist.some(w => host === w || host.endsWith('.' + w));
      if (isWhitelisted) return;
      
      const isBlocked = sites.some(s => host === s || host.endsWith('.' + s));
      if (isBlocked) {
        const redirectUrl = api.runtime.getURL('/blocked.html') + '?url=' + encodeURIComponent(currentUrl);
        await api.tabs.update(tabId, { url: redirectUrl });
      }
    } catch (e) {
      // Invalid URL
    }
  }
});
