// FocusFlow Popup Controller
const api = typeof browser !== 'undefined' ? browser : chrome;

let countdownInterval = null;
let selectedTimerMinutes = 25;
let selectedBreakMinutes = 5;

document.addEventListener('DOMContentLoaded', async () => {
  await initTheme();
  await checkPermissions();
  await loadStatus();
  await renderSchedules();
  await renderSites();
  await initCurrentSiteBanners();
  await renderHistory();
  initTabs();
  initSettings();
  initTimerPanel();
  initScheduleForm();
  initSiteForms();
  initHistoryModal();

  api.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.blockedSites || changes.whitelist || changes.isCurrentlyBlocked || changes.schedules) {
      await loadStatus();
      await renderSites();
      await renderSchedules();
    }
    if (changes.timerActive || changes.timerEnd || changes.isPaused || changes.breakActive || changes.breakEnd || changes.remainingTimeMs) {
      await loadStatus();
    }
    if (changes.sessionHistory) {
      await renderHistory();
    }
    if (changes.theme) {
      await applyThemePref(changes.theme.newValue);
    }
  });
});

/* ==========================================
   THEME & PERMISSIONS
   ========================================== */
async function initTheme() {
  const data = await api.storage.local.get('theme');
  await applyThemePref(data.theme || 'system');
  
  // Listen for OS theme changes if in system mode
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    const d = await api.storage.local.get('theme');
    if (!d.theme || d.theme === 'system') applyThemePref('system');
  });
}

async function applyThemePref(themePref) {
  const select = document.getElementById('theme-select');
  if (select) select.value = themePref;
  
  let isDark = true;
  if (themePref === 'light') {
    isDark = false;
  } else if (themePref === 'dark') {
    isDark = true;
  } else {
    // System
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  
  if (isDark) {
    document.body.classList.replace('light-mode', 'dark-mode') || document.body.classList.add('dark-mode');
  } else {
    document.body.classList.replace('dark-mode', 'light-mode') || document.body.classList.add('light-mode');
  }
}

async function checkPermissions() {
  const hasPermission = await api.permissions.contains({ origins: ['<all_urls>'] });
  const banner = document.getElementById('permission-banner');
  if (hasPermission) {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
    document.getElementById('btn-grant-permission').onclick = async () => {
      const granted = await api.permissions.request({ origins: ['<all_urls>'] });
      if (granted) {
        banner.classList.add('hidden');
        const data = await api.storage.local.get('blockedSites');
        await api.storage.local.set({ blockedSites: data.blockedSites || [] });
      }
    };
  }
}

/* ==========================================
   NAVIGATION & SETTINGS
   ========================================== */
function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  
  function switchTab(tabId) {
    tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    tabPanes.forEach(pane => {
      pane.classList.toggle('active', pane.id === tabId);
    });
  }

  tabButtons.forEach(button => {
    button.addEventListener('click', () => switchTab(button.getAttribute('data-tab')));
  });

  document.getElementById('btn-settings-toggle').addEventListener('click', () => {
    switchTab('tab-settings');
  });
}

function initSettings() {
  const select = document.getElementById('theme-select');
  select.addEventListener('change', async (e) => {
    await api.storage.local.set({ theme: e.target.value });
  });

  document.getElementById('btn-settings-clear-history').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.remove('hidden');
  });
}

/* ==========================================
   STATUS & UNIFIED TIMER LOGIC
   ========================================== */
async function loadStatus() {
  const data = await api.storage.local.get([
    'isCurrentlyBlocked', 'blockReason', 'timerActive', 'timerEnd', 'isPaused', 'remainingTimeMs', 'breakActive', 'breakEnd'
  ]);

  const statusCard = document.getElementById('status-card');
  const statusTitle = document.getElementById('status-title');
  const statusText = document.getElementById('status-text');
  const iconPath = document.getElementById('status-icon-path');
  const countdownContainer = document.getElementById('live-countdown');
  
  const builderUI = document.getElementById('timer-builder-ui');
  const activeUI = document.getElementById('timer-active-ui');
  const btnPrimary = document.getElementById('btn-active-primary');
  const btnCancel = document.getElementById('btn-active-cancel');
  const pulseRing = document.getElementById('status-pulse');
  const ringContainer = document.getElementById('status-ring-container');

  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  
  // Reset custom ring styling
  ringContainer.style.background = '';
  pulseRing.style.borderColor = '';

  if (data.timerActive) {
    // FOCUS IS ACTIVE
    builderUI.classList.add('hidden');
    activeUI.classList.remove('hidden');
    countdownContainer.classList.remove('hidden');
    
    btnPrimary.style.display = 'block';
    
    if (data.isPaused) {
      statusCard.classList.remove('active');
      statusTitle.textContent = 'Focus Paused';
      statusText.textContent = 'Timer paused. Distractions accessible.';
      
      // Match the pause button's cyan gradient
      ringContainer.style.background = 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)';
      pulseRing.style.borderColor = '#06b6d4';
      
      btnPrimary.textContent = 'Resume Focus';
      btnPrimary.className = 'btn btn-primary'; // Uses normal Focus styling
      btnCancel.textContent = 'Cancel Focus';
      renderStaticTime(data.remainingTimeMs);
    } else {
      statusCard.classList.add('active');
      statusTitle.textContent = 'Focus Mode Active';
      statusText.textContent = data.blockReason || 'Timer running.';
      btnPrimary.textContent = 'Pause Focus';
      btnPrimary.className = 'btn btn-primary btn-warning-gradient'; // Specific gradient for Active Pause state
      btnCancel.textContent = 'Cancel Focus';
      startLiveCountdown(data.timerEnd);
    }
    iconPath.setAttribute('d', 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z');
    
  } else if (data.breakActive) {
    // BREAK IS ACTIVE
    builderUI.classList.add('hidden');
    activeUI.classList.remove('hidden');
    countdownContainer.classList.remove('hidden');
    
    statusCard.classList.add('active');
    statusTitle.textContent = 'Break Time!';
    statusText.textContent = 'Relax. Blocked sites are accessible.';
    
    // Style ring green for break
    ringContainer.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    pulseRing.style.borderColor = '#10b981';
    
    btnPrimary.style.display = 'none'; // No pause for breaks
    btnCancel.textContent = 'Stop Break';
    
    startLiveCountdown(data.breakEnd);
    iconPath.setAttribute('d', 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z');
    
  } else {
    // STANDBY OR SCHEDULED
    builderUI.classList.remove('hidden');
    activeUI.classList.add('hidden');
    
    if (data.isCurrentlyBlocked) {
      statusCard.classList.add('active');
      statusTitle.textContent = 'Focus Mode Active';
      statusText.textContent = data.blockReason;
      countdownContainer.classList.add('hidden');
      iconPath.setAttribute('d', 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z');
    } else {
      statusCard.classList.remove('active');
      statusTitle.textContent = 'Standby Mode';
      statusText.textContent = 'All distracting sites are accessible.';
      countdownContainer.classList.add('hidden');
      iconPath.setAttribute('d', 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z');
    }
  }
}

function startLiveCountdown(endTime) {
  const digitsEl = document.getElementById('timer-digits');
  function update() {
    const diff = endTime - Date.now();
    if (diff <= 0) { clearInterval(countdownInterval); loadStatus(); return; }
    renderStaticTime(diff, digitsEl);
  }
  update();
  countdownInterval = setInterval(update, 1000);
}

function renderStaticTime(ms, element = document.getElementById('timer-digits')) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const pad = (num) => String(num).padStart(2, '0');
  element.textContent = hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function initTimerPanel() {
  // Focus Presets
  const focusPresets = document.querySelectorAll('.focus-preset');
  focusPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      focusPresets.forEach(b => b.classList.remove('active'));
      document.getElementById('custom-focus-form').classList.add('hidden');
      if (btn.id === 'btn-custom-focus-trigger') {
        btn.classList.add('active');
        document.getElementById('custom-focus-form').classList.remove('hidden');
      } else {
        btn.classList.add('active');
        selectedTimerMinutes = parseInt(btn.getAttribute('data-duration'), 10);
        document.getElementById('btn-start-focus').textContent = `Start ${selectedTimerMinutes}m Focus`;
      }
    });
  });

  // Break Presets
  const breakPresets = document.querySelectorAll('.break-preset');
  breakPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      breakPresets.forEach(b => b.classList.remove('active'));
      document.getElementById('custom-break-form').classList.add('hidden');
      if (btn.id === 'btn-custom-break-trigger') {
        btn.classList.add('active');
        document.getElementById('custom-break-form').classList.remove('hidden');
      } else {
        btn.classList.add('active');
        selectedBreakMinutes = parseInt(btn.getAttribute('data-duration'), 10);
        document.getElementById('btn-start-break').textContent = `Start ${selectedBreakMinutes}m Break`;
      }
    });
  });

  // Start Buttons
  document.getElementById('btn-start-focus').addEventListener('click', async () => {
    let mins = selectedTimerMinutes;
    if (!document.getElementById('custom-focus-form').classList.contains('hidden')) {
      const val = parseInt(document.getElementById('custom-focus-minutes').value, 10);
      if (!val || val <= 0 || val > 1440) return alert('Enter a valid duration (1-1440 min).');
      mins = val;
    }
    await api.storage.local.set({
      timerActive: true, timerEnd: Date.now() + mins * 60000, timerStart: Date.now(),
      isPaused: false, breakActive: false, lastTimerDuration: mins
    });
  });

  document.getElementById('btn-start-break').addEventListener('click', async () => {
    let mins = selectedBreakMinutes;
    if (!document.getElementById('custom-break-form').classList.contains('hidden')) {
      const val = parseInt(document.getElementById('custom-break-minutes').value, 10);
      if (!val || val <= 0 || val > 1440) return alert('Enter a valid duration (1-1440 min).');
      mins = val;
    }
    await api.storage.local.set({
      breakActive: true, breakEnd: Date.now() + mins * 60000, breakStart: Date.now(),
      timerActive: false, isPaused: false, lastBreakDuration: mins
    });
  });

  // Active Actions
  document.getElementById('btn-active-primary').addEventListener('click', async () => {
    const data = await api.storage.local.get(['timerActive', 'isPaused', 'timerEnd', 'remainingTimeMs']);
    if (data.timerActive) {
      if (data.isPaused) {
        await api.storage.local.set({ isPaused: false, timerEnd: Date.now() + data.remainingTimeMs });
      } else {
        await api.storage.local.set({ isPaused: true, remainingTimeMs: data.timerEnd - Date.now() });
      }
    }
  });

  document.getElementById('btn-active-cancel').addEventListener('click', async () => {
    const data = await api.storage.local.get(['timerActive', 'breakActive', 'timerStart', 'breakStart', 'sessionHistory']);
    const history = data.sessionHistory || [];
    
    if (data.timerActive) {
      const elapsedMs = Date.now() - (data.timerStart || Date.now());
      history.push({ id: Date.now(), date: new Date().toISOString(), durationMs: elapsedMs, type: 'Aborted Focus' });
    } else if (data.breakActive) {
      const elapsedMs = Date.now() - (data.breakStart || Date.now());
      history.push({ id: Date.now(), date: new Date().toISOString(), durationMs: elapsedMs, type: 'Break Timer' });
    }
    
    await api.storage.local.set({ 
      timerActive: false, timerEnd: 0, timerStart: 0, isPaused: false, lastTimerDuration: 0, 
      breakActive: false, breakEnd: 0, breakStart: 0, lastBreakDuration: 0, sessionHistory: history 
    });
  });
}

/* ==========================================
   BLOCKLIST & SMART ADD SITE
   ========================================== */
async function initCurrentSiteBanners() {
  const btnSites = document.getElementById('banner-sites-btn');
  const btnSchedules = document.getElementById('banner-schedules-btn');
  
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0 || !tabs[0].url) return;
    const url = new URL(tabs[0].url);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    
    let domain = url.hostname.replace(/^www\./, '');
    
    [btnSites, btnSchedules].forEach(btn => {
      if (!btn) return;
      btn.textContent = '+ Block Current Site';
      btn.classList.remove('hidden');
      
      btn.onclick = async () => {
        const data = await api.storage.local.get('blockedSites');
        const sites = data.blockedSites || [];
        if (!sites.includes(domain)) {
          sites.push(domain);
          await api.storage.local.set({ blockedSites: sites });
          
          document.querySelectorAll('.btn-block-current').forEach(b => {
            b.textContent = 'Added!';
            b.disabled = true;
          });
        }
      };
    });
  } catch (e) {}
}

function initSiteForms() {
  document.getElementById('add-site-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('site-domain');
    let domain = input.value.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    if (!/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/.test(domain)) return alert('Invalid domain');
    
    const data = await api.storage.local.get('blockedSites');
    const sites = data.blockedSites || [];
    if (!sites.includes(domain)) {
      sites.push(domain);
      await api.storage.local.set({ blockedSites: sites });
    }
    input.value = '';
  });

  document.getElementById('add-whitelist-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('whitelist-domain');
    let domain = input.value.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    if (!/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/.test(domain)) return alert('Invalid domain');
    
    const data = await api.storage.local.get('whitelist');
    const list = data.whitelist || [];
    if (!list.includes(domain)) {
      list.push(domain);
      await api.storage.local.set({ whitelist: list });
    }
    input.value = '';
  });
}

async function renderSites() {
  const data = await api.storage.local.get(['blockedSites', 'whitelist', 'isCurrentlyBlocked']);
  const sites = data.blockedSites || [];
  const whitelist = data.whitelist || [];
  const container = document.getElementById('sites-chips');
  const wContainer = document.getElementById('whitelist-chips');
  
  document.querySelectorAll('.btn-block-current').forEach(btn => btn.disabled = false);
  document.querySelector('#add-site-form button').disabled = false;
  document.querySelector('#add-whitelist-form button').disabled = data.isCurrentlyBlocked;

  container.innerHTML = sites.length ? '' : '<p class="section-desc" style="width:100%;text-align:center;">No domains blocked.</p>';
  sites.forEach(site => {
    const chip = document.createElement('div');
    chip.className = `site-chip ${data.isCurrentlyBlocked ? 'disabled' : ''}`;
    chip.innerHTML = `<span>${escapeHtml(site)}</span><button class="btn-remove-site"><svg class="icon-close" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg></button>`;
    if (!data.isCurrentlyBlocked) {
      chip.querySelector('.btn-remove-site').onclick = async () => {
        const d = await api.storage.local.get('blockedSites');
        await api.storage.local.set({ blockedSites: (d.blockedSites || []).filter(s => s !== site) });
      };
    }
    container.appendChild(chip);
  });

  wContainer.innerHTML = whitelist.length ? '' : '<p class="section-desc" style="width:100%;text-align:center;">No exceptions.</p>';
  whitelist.forEach(site => {
    const chip = document.createElement('div');
    chip.className = `site-chip ${data.isCurrentlyBlocked ? 'disabled' : ''}`;
    chip.style.borderColor = 'var(--success)';
    chip.style.color = 'var(--success)';
    chip.innerHTML = `<span>${escapeHtml(site)}</span><button class="btn-remove-site"><svg class="icon-close" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg></button>`;
    if (!data.isCurrentlyBlocked) {
      chip.querySelector('.btn-remove-site').onclick = async () => {
        const d = await api.storage.local.get('whitelist');
        await api.storage.local.set({ whitelist: (d.whitelist || []).filter(s => s !== site) });
      };
    }
    wContainer.appendChild(chip);
  });
}

/* ==========================================
   SCHEDULES
   ========================================== */
let selectedDays = [];
let editScheduleId = null;
function initScheduleForm() {
  const formCard = document.getElementById('schedule-form-card');
  document.getElementById('btn-new-schedule').addEventListener('click', () => { 
    formCard.classList.remove('hidden'); 
    selectedDays = []; 
    editScheduleId = null;
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('selected')); 
    document.getElementById('schedule-name').value = '';
    document.getElementById('schedule-start').value = '';
    document.getElementById('schedule-end').value = '';
    document.getElementById('btn-save-schedule').textContent = 'Save Schedule';
  });
  document.getElementById('btn-cancel-schedule').addEventListener('click', () => {
    formCard.classList.add('hidden');
    editScheduleId = null;
  });
  
  document.querySelectorAll('.day-btn').forEach(btn => btn.addEventListener('click', () => {
    const day = parseInt(btn.getAttribute('data-day'), 10);
    if (selectedDays.includes(day)) { selectedDays = selectedDays.filter(d => d !== day); btn.classList.remove('selected'); } 
    else { selectedDays.push(day); btn.classList.add('selected'); }
  }));

  document.getElementById('btn-save-schedule').addEventListener('click', async () => {
    const name = document.getElementById('schedule-name').value.trim() || 'Study Time';
    const startTime = document.getElementById('schedule-start').value;
    const endTime = document.getElementById('schedule-end').value;
    if (!startTime || !endTime || selectedDays.length === 0) return alert('Select time and days.');
    
    const data = await api.storage.local.get('schedules');
    let schedules = data.schedules || [];
    
    if (editScheduleId) {
      const idx = schedules.findIndex(s => s.id === editScheduleId);
      if (idx !== -1) {
        schedules[idx].name = name;
        schedules[idx].startTime = startTime;
        schedules[idx].endTime = endTime;
        schedules[idx].days = [...selectedDays];
      }
    } else {
      schedules.push({ id: 'sch_' + Date.now(), name, startTime, endTime, days: [...selectedDays], enabled: true });
    }
    
    await api.storage.local.set({ schedules });
    formCard.classList.add('hidden');
    editScheduleId = null;
  });
}

async function renderSchedules() {
  const data = await api.storage.local.get(['schedules', 'isCurrentlyBlocked']);
  const container = document.getElementById('schedules-list');
  const schedules = data.schedules || [];
  
  document.getElementById('btn-new-schedule').disabled = false;
  
  if (schedules.length === 0) { container.innerHTML = '<div class="empty-state"><p>No schedules configured.</p></div>'; return; }
  container.innerHTML = '';
  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  schedules.forEach(schedule => {
    const item = document.createElement('div');
    item.className = 'schedule-card';
    let daysHtml = '';
    for (let i = 0; i < 7; i++) {
      const idx = (i + 1) % 7;
      daysHtml += `<span class="schedule-day-badge ${schedule.days.includes(idx) ? 'active' : ''}">${dayNames[idx]}</span>`;
    }
    item.innerHTML = `
      <div class="schedule-header">
        <div class="schedule-info">
          <span class="schedule-name">${escapeHtml(schedule.name)}</span>
          <span class="schedule-time">${formatTime(schedule.startTime)} - ${formatTime(schedule.endTime)}</span>
          <span class="schedule-days">${daysHtml}</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <label class="switch">
            <input type="checkbox" class="schedule-toggle" ${schedule.enabled ? 'checked' : ''} ${data.isCurrentlyBlocked ? 'disabled' : ''}/>
            <span class="slider"></span>
          </label>
          <button class="btn-edit-schedule" ${data.isCurrentlyBlocked ? 'disabled' : ''}><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></button>
          <button class="btn-delete-schedule" ${data.isCurrentlyBlocked ? 'disabled' : ''}><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
        </div>
      </div>
      <div class="schedule-sites">
        <div class="schedule-sites-title">Blocked Sites for this Schedule</div>
        <div class="schedule-chips" id="sch-chips-${schedule.id}"></div>
        <form class="sch-site-form" data-id="${schedule.id}">
          <input type="text" placeholder="e.g. twitch.tv" required ${data.isCurrentlyBlocked ? 'disabled' : ''}/>
          <button type="submit" class="btn btn-secondary-sm" ${data.isCurrentlyBlocked ? 'disabled' : ''}>Add</button>
        </form>
      </div>
    `;
    
    // Render the chips
    const chipsContainer = item.querySelector('.schedule-chips');
    const schSites = schedule.blockedSites || [];
    if (schSites.length === 0) {
      chipsContainer.innerHTML = '<span style="font-size:11px;color:var(--text-tertiary);">No sites added yet.</span>';
    } else {
      schSites.forEach(site => {
        const chip = document.createElement('div');
        chip.className = 'sch-site-chip';
        chip.innerHTML = `<span>${escapeHtml(site)}</span><button class="btn-remove-sch-site" data-site="${escapeHtml(site)}" ${data.isCurrentlyBlocked ? 'disabled' : ''}><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M6 18L18 6M6 6l12 12"/></svg></button>`;
        if (!data.isCurrentlyBlocked) {
          chip.querySelector('.btn-remove-sch-site').onclick = async (e) => {
            const sDomain = e.currentTarget.getAttribute('data-site');
            const d = await api.storage.local.get('schedules');
            const schedulesList = d.schedules || [];
            const target = schedulesList.find(s => s.id === schedule.id);
            if (target) {
              target.blockedSites = (target.blockedSites || []).filter(s => s !== sDomain);
              await api.storage.local.set({ schedules: schedulesList });
            }
          };
        }
        chipsContainer.appendChild(chip);
      });
    }
    
    // Form listener
    if (!data.isCurrentlyBlocked) {
      item.querySelector('.sch-site-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = e.target.querySelector('input');
        let domain = input.value.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
        if (!/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/.test(domain)) return alert('Invalid domain');
        
        const d = await api.storage.local.get('schedules');
        const schedulesList = d.schedules || [];
        const target = schedulesList.find(s => s.id === schedule.id);
        if (target) {
          if (!target.blockedSites) target.blockedSites = [];
          if (!target.blockedSites.includes(domain)) {
            target.blockedSites.push(domain);
            await api.storage.local.set({ schedules: schedulesList });
          }
        }
      });
    }
    
    if (!data.isCurrentlyBlocked) {
      item.querySelector('.schedule-toggle').addEventListener('change', async (e) => {
        const d = await api.storage.local.get('schedules');
        const list = d.schedules || [];
        const s = list.find(x => x.id === schedule.id);
        if (s) { s.enabled = e.target.checked; await api.storage.local.set({ schedules: list }); }
      });
      
      item.querySelector('.btn-edit-schedule').addEventListener('click', () => {
        editScheduleId = schedule.id;
        document.getElementById('schedule-name').value = schedule.name;
        document.getElementById('schedule-start').value = schedule.startTime;
        document.getElementById('schedule-end').value = schedule.endTime;
        
        selectedDays = [...schedule.days];
        document.querySelectorAll('.day-btn').forEach(b => {
          const day = parseInt(b.getAttribute('data-day'), 10);
          if (selectedDays.includes(day)) b.classList.add('selected');
          else b.classList.remove('selected');
        });
        
        document.getElementById('btn-save-schedule').textContent = 'Update Schedule';
        document.getElementById('schedule-form-card').classList.remove('hidden');
      });
      
      item.querySelector('.btn-delete-schedule').addEventListener('click', async () => {
        const d = await api.storage.local.get('schedules');
        await api.storage.local.set({ schedules: (d.schedules || []).filter(x => x.id !== schedule.id) });
      });
    }
    container.appendChild(item);
  });
}

/* ==========================================
   HISTORY
   ========================================== */
function initHistoryModal() {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('btn-modal-cancel').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('btn-modal-confirm').addEventListener('click', async () => {
    await api.storage.local.set({ sessionHistory: [] });
    modal.classList.add('hidden');
  });
}

let statsChartInstance = null;

async function renderHistory() {
  const data = await api.storage.local.get('sessionHistory');
  const history = data.sessionHistory || [];
  const container = document.getElementById('history-list');
  const totalEl = document.getElementById('total-focus-time');
  
  if (history.length === 0) {
    totalEl.textContent = '0h 0m';
    container.innerHTML = '<div class="empty-state"><p>No focus history yet. Start a timer!</p></div>';
    if (statsChartInstance) statsChartInstance.destroy();
    return;
  }
  
  let totalMs = 0;
  container.innerHTML = '';
  
  const dailyStats = {};
  
  history.slice().reverse().forEach(session => {
    if (session.type === 'Focus Timer') totalMs += session.durationMs || 0;
    
    const item = document.createElement('div');
    item.className = 'history-item';
    const d = new Date(session.date);
    let typeColor = 'var(--accent-light)';
    let dotColor = 'var(--accent)';
    
    if (session.type === 'Aborted Focus') {
      typeColor = 'var(--danger)';
      dotColor = 'var(--danger)';
    } else if (session.type === 'Break Timer') {
      typeColor = 'var(--success)';
      dotColor = 'var(--success)';
    }
    
    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
         <div style="display:flex; flex-direction:column;">
            <div style="font-weight: 600; font-size: 13px; display:flex; align-items:center; gap: 6px;">
               <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${dotColor};"></span>
               ${session.type || 'Focus'}
            </div>
            <div style="font-size: 11px; color: var(--text-muted);">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</div>
         </div>
         <div style="font-weight: 700; color: ${typeColor};">${Math.round(session.durationMs / 60000)}m</div>
      </div>
    `;
    container.appendChild(item);
    
    const dayStr = d.toLocaleDateString();
    if (!dailyStats[dayStr]) dailyStats[dayStr] = { focus: 0, break: 0, aborted: [] };
    const mins = session.durationMs / 60000;
    
    if (session.type === 'Focus Timer') dailyStats[dayStr].focus += mins;
    else if (session.type === 'Break Timer') dailyStats[dayStr].break += mins;
    else if (session.type === 'Aborted Focus') dailyStats[dayStr].aborted.push(mins);
  });
  
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  totalEl.textContent = `${hours}h ${minutes}m`;

  const labels = Object.keys(dailyStats);
  const focusData = labels.map(day => dailyStats[day].focus);
  const breakData = labels.map(day => dailyStats[day].break);
  const abortedData = [];
  labels.forEach(day => {
    dailyStats[day].aborted.forEach(mins => {
      abortedData.push({ x: day, y: mins });
    });
  });

  const ctx = document.getElementById('statsChart').getContext('2d');
  if (statsChartInstance) statsChartInstance.destroy();
  
  const isDark = document.body.classList.contains('dark-mode');
  Chart.defaults.color = isDark ? '#94a3b8' : '#64748b';
  
  statsChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          type: 'scatter', label: 'Aborted', data: abortedData,
          backgroundColor: '#f43f5e', pointRadius: 5, pointHoverRadius: 7
        },
        {
          type: 'line', label: 'Focus (m)', data: focusData,
          borderColor: '#818cf8', backgroundColor: 'rgba(99, 102, 241, 0.2)',
          borderWidth: 2, fill: true, tension: 0.3, pointRadius: 3
        },
        {
          type: 'line', label: 'Break (m)', data: breakData,
          borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.2)',
          borderWidth: 2, fill: true, tension: 0.3, pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } },
        x: { grid: { display: false } }
      },
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 10, usePointStyle: true } }
      }
    }
  });
}

function escapeHtml(str) { const d = document.createElement('div'); d.appendChild(document.createTextNode(str)); return d.innerHTML; }
function formatTime(str) { const [h, m] = str.split(':').map(Number); return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`; }
