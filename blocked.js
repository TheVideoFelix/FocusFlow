// FocusFlow Blocked Page Controller
const api = typeof browser !== 'undefined' ? browser : chrome;

// Motivational quotes database
const MOTIVATIONAL_QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Focus is a muscle, and you are building it right now.", author: "FocusFlow" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { text: "Don't wish it were easier. Wish you were better.", author: "Jim Rohn" },
  { text: "It always seems impossible until it is done.", author: "Nelson Mandela" },
  { text: "You don't need to see the whole staircase, just take the first step.", author: "Martin Luther King Jr." },
  { text: "Only put off until tomorrow what you are willing to die having left undone.", author: "Pablo Picasso" },
  { text: "There are no secrets to success. It is the result of preparation, hard work, and learning from failure.", author: "Colin Powell" },
  { text: "Your mind is for having ideas, not holding them.", author: "David Allen" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "Yesterday you said tomorrow. Just do it.", author: "Nike" },
  { text: "Deep work is the superpower of the 21st century.", author: "Cal Newport" }
];

let countdownInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initTheme();
  setupQuote();
  await loadBlockDetails();
  setupActionButtons();
  
  // Rotate quote every 15 seconds
  setInterval(setupQuote, 15000);

  // React to storage updates (e.g. if the user cancels the timer in the popup, or a schedule changes)
  api.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes.isCurrentlyBlocked || changes.timerActive || changes.timerEnd || changes.activeBlockedSites || changes.whitelist) {
      await loadBlockDetails();
    }
  });
});

/* ==========================================
   THEME SYNCHRONIZATION
   ========================================== */
async function initTheme() {
  const data = await api.storage.local.get('theme');
  const theme = data.theme || 'dark';
  applyTheme(theme);
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
  }
}

/* ==========================================
   MOTIVATIONAL QUOTES
   ========================================== */
function setupQuote() {
  const textEl = document.getElementById('quote-text');
  const authorEl = document.getElementById('quote-author');
  
  // Pick random quote
  const randomIndex = Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length);
  const quote = MOTIVATIONAL_QUOTES[randomIndex];
  
  // Add quick fade transition effect
  textEl.style.opacity = 0;
  authorEl.style.opacity = 0;
  
  setTimeout(() => {
    textEl.textContent = `"${quote.text}"`;
    authorEl.textContent = `— ${quote.author}`;
    textEl.style.opacity = 1;
    authorEl.style.opacity = 1;
  }, 200);
}

/* ==========================================
   BLOCK DETAILS & REAL-TIME TIMER
   ========================================== */
async function loadBlockDetails() {
  const data = await api.storage.local.get([
    'isCurrentlyBlocked',
    'blockReason',
    'timerActive',
    'timerEnd',
    'activeBlockedSites',
    'whitelist'
  ]);

  let isBlocked = data.isCurrentlyBlocked || false;
  const reason = data.blockReason || '';
  const timerActive = data.timerActive || false;
  const timerEnd = data.timerEnd || 0;
  
  const urlParams = new URLSearchParams(window.location.search);
  const targetUrl = urlParams.get('url');
  const targetDomain = urlParams.get('d');
  
  if (isBlocked && (targetUrl || targetDomain)) {
    let host = '';
    try {
      if (targetUrl) host = new URL(targetUrl).hostname.toLowerCase();
      else if (targetDomain) host = targetDomain.toLowerCase();
    } catch(e) {}
    
    if (host) {
      const whitelist = data.whitelist || [];
      const sites = data.activeBlockedSites || [];
      const isWhitelisted = whitelist.some(w => host === w || host.endsWith('.' + w));
      const isSiteBlocked = sites.some(s => host === s || host.endsWith('.' + s));
      
      if (isWhitelisted || !isSiteBlocked) {
        isBlocked = false;
      }
    }
  }

  const timerWrapper = document.getElementById('countdown-wrapper');
  const scheduleWrapper = document.getElementById('schedule-wrapper');
  const scheduleText = document.getElementById('schedule-text');
  const backBtn = document.getElementById('btn-back');

  // Reset any running countdowns
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  // If the block is lifted (e.g. timer expired or schedule ended, or site no longer blocked)
  if (!isBlocked) {
    if (targetUrl) {
      window.location.replace(targetUrl);
    } else if (targetDomain) {
      window.location.replace('https://' + targetDomain);
    } else {
      showFocusCompleteState();
    }
    return;
  }

  // Block is active
  if (timerActive && timerEnd > Date.now()) {
    timerWrapper.classList.remove('hidden');
    scheduleWrapper.classList.add('hidden');
    startCountdown(timerEnd);
  } else {
    timerWrapper.classList.add('hidden');
    scheduleWrapper.classList.remove('hidden');
    
    // Clean up reason text if it starts with "Schedule"
    scheduleText.textContent = reason || 'Blocked by FocusFlow Schedule';
    
    // Reset back button to normal
    backBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" class="btn-icon">
        <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      Go Back
    `;
  }
}

function startCountdown(endTime) {
  const digitsEl = document.getElementById('timer-digits');
  
  function update() {
    const now = Date.now();
    const diff = endTime - now;
    
    if (diff <= 0) {
      clearInterval(countdownInterval);
      showFocusCompleteState();
      return;
    }
    
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    
    const pad = (num) => String(num).padStart(2, '0');
    
    if (hours > 0) {
      digitsEl.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    } else {
      digitsEl.textContent = `${pad(minutes)}:${pad(seconds)}`;
    }
  }
  
  update();
  countdownInterval = setInterval(update, 1000);
}

function showFocusCompleteState() {
  const title = document.querySelector('.title');
  const subtitle = document.querySelector('.subtitle');
  const infoBox = document.getElementById('block-info-box');
  const backBtn = document.getElementById('btn-back');
  
  // Transform elements to success state
  title.innerHTML = 'Focus Session Complete! 🎉';
  title.style.background = 'linear-gradient(135deg, #10b981 0%, #34d399 100%)';
  title.style.webkitBackgroundClip = 'text';
  title.style.webkitTextFillColor = 'transparent';
  
  subtitle.textContent = 'Great work studying! You are now free to access this site.';
  
  infoBox.innerHTML = `
    <div style="color: var(--success); font-weight: 700; display: flex; align-items: center; gap: 8px;">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="width: 24px; height: 24px;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Block Lifted
    </div>
  `;
  
  // Modify back button to act as a reload/forward button
  backBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" class="btn-icon">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89H18v3" />
    </svg>
    Proceed to Website
  `;
}

/* ==========================================
   BUTTON ACTIONS
   ========================================== */
function setupActionButtons() {
  const backBtn = document.getElementById('btn-back');
  const newTabBtn = document.getElementById('btn-new-tab');
  
  backBtn.addEventListener('click', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const targetUrl = urlParams.get('url');

    const data = await api.storage.local.get('isCurrentlyBlocked');
    
    // If block is lifted and we know the target, go directly there!
    if (!data.isCurrentlyBlocked && targetUrl) {
      window.location.replace(targetUrl);
    } 
    // Otherwise normal fallback
    else if (history.length > 1) {
      history.back();
    } else {
      closeTabOrRedirect();
    }
  });
  
  newTabBtn.addEventListener('click', () => {
    createNewTabAndCloseCurrent();
  });
}

async function createNewTabAndCloseCurrent() {
  try {
    // Open a fresh tab page
    await api.tabs.create({ url: 'about:newtab' });
    
    // Close this blocked tab
    const tab = await api.tabs.getCurrent();
    if (tab) {
      await api.tabs.remove(tab.id);
    }
  } catch (err) {
    // Fallback if extension API not working in this context
    window.location.href = 'https://www.google.com';
  }
}

async function closeTabOrRedirect() {
  try {
    const tab = await api.tabs.getCurrent();
    if (tab) {
      await api.tabs.remove(tab.id);
    } else {
      window.close();
    }
  } catch (err) {
    window.location.href = 'https://www.google.com';
  }
}
