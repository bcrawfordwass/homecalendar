(() => {
  'use strict';

  const SETTINGS_KEY = 'family-hub-wall-display-settings-v1';
  const DEFAULTS = {
    enabled: false,
    hideSettings: true,
    keepAwake: true,
    returnHomeOnWake: true,
    nightEnabled: true,
    nightStart: '22:30',
    nightEnd: '06:30',
    nightDim: 35
  };

  let settings = loadSettings();
  let wakeLock = null;
  let adminUnlocked = false;
  let brandHoldTimer = null;
  let cornerTaps = [];
  let nightTimer = null;

  initialise();

  function initialise() {
    installSettingsWatcher();
    installAdminGestures();
    installFullscreenRecovery();
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('familyhub:ambient-exit', handleAmbientExit);
    window.addEventListener('storage', event => {
      if (event.key !== SETTINGS_KEY) return;
      settings = loadSettings();
      applyMode();
    });
    applyMode();
  }

  function loadSettings() {
    try {
      return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function applyMode() {
    document.body.classList.toggle('wall-display-enabled', settings.enabled);
    document.body.classList.toggle('wall-settings-hidden', settings.enabled && settings.hideSettings && !adminUnlocked);
    applyNightMode();
    scheduleNightCheck();
    if (settings.enabled && settings.keepAwake) requestWakeLock();
    else releaseWakeLock();
    updateStatusCard();
  }

  function installSettingsWatcher() {
    const root = document.getElementById('viewRoot');
    if (!root) return;
    const observer = new MutationObserver(insertSettingsCard);
    observer.observe(root, { childList: true, subtree: false });
    insertSettingsCard();
  }

  function insertSettingsCard() {
    const layout = document.querySelector('.settings-layout');
    if (!layout || document.getElementById('wallDisplaySettingsCard')) return;
    const card = document.createElement('section');
    card.id = 'wallDisplaySettingsCard';
    card.className = 'card settings-card wall-display-settings-card';
    card.innerHTML = settingsHTML();
    layout.prepend(card);
    bindSettings(card);
  }

  function settingsHTML() {
    return `
      <div class="card-heading">
        <div>
          <div class="card-title">Wall Display Mode</div>
          <div class="card-subtitle">Run Family Hub like a dedicated home appliance.</div>
        </div>
        <label class="ambient-switch"><input id="wallDisplayEnabled" type="checkbox" ${settings.enabled ? 'checked' : ''}><span></span></label>
      </div>
      <div class="wall-display-status" id="wallDisplayStatus"></div>
      <div class="ambient-checks wall-display-checks">
        ${checkRow('wallHideSettings', 'Hide Settings during everyday use', settings.hideSettings)}
        ${checkRow('wallKeepAwake', 'Keep the screen awake while Family Hub is open', settings.keepAwake)}
        ${checkRow('wallReturnHome', 'Return to Today after leaving Ambient Mode', settings.returnHomeOnWake)}
        ${checkRow('wallNightEnabled', 'Use automatic night dimming', settings.nightEnabled)}
      </div>
      <div class="wall-display-grid">
        <label><span>Night starts</span><input id="wallNightStart" type="time" value="${escapeHTML(settings.nightStart)}"></label>
        <label><span>Night ends</span><input id="wallNightEnd" type="time" value="${escapeHTML(settings.nightEnd)}"></label>
        <label class="wall-dim-control"><span>Night brightness <strong id="wallNightDimValue">${Number(settings.nightDim)}%</strong></span><input id="wallNightDim" type="range" min="15" max="70" step="5" value="${Number(settings.nightDim)}"></label>
      </div>
      <div class="settings-actions wall-display-actions">
        <button class="primary-button" id="wallFullscreenButton" type="button">Enter fullscreen now</button>
        <button class="secondary-button" id="wallPreviewNightButton" type="button">Preview night mode</button>
        <button class="secondary-button" id="wallRevealSettingsButton" type="button">Unlock Settings</button>
      </div>
      <p class="settings-note"><strong>Hidden access:</strong> press and hold the FH badge for 3 seconds, or tap the bottom-left corner five times. Browser fullscreen can hide Chrome controls; completely hiding Android's status bar may still require Fully Kiosk Browser.</p>`;
  }

  function checkRow(id, label, checked) {
    return `<label class="checkbox-label"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
  }

  function bindSettings(card) {
    const bindCheck = (id, key) => card.querySelector(`#${id}`).addEventListener('change', event => updateSetting(key, event.target.checked));
    bindCheck('wallDisplayEnabled', 'enabled');
    bindCheck('wallHideSettings', 'hideSettings');
    bindCheck('wallKeepAwake', 'keepAwake');
    bindCheck('wallReturnHome', 'returnHomeOnWake');
    bindCheck('wallNightEnabled', 'nightEnabled');
    card.querySelector('#wallNightStart').addEventListener('change', event => updateSetting('nightStart', event.target.value));
    card.querySelector('#wallNightEnd').addEventListener('change', event => updateSetting('nightEnd', event.target.value));
    card.querySelector('#wallNightDim').addEventListener('input', event => {
      settings.nightDim = Number(event.target.value);
      card.querySelector('#wallNightDimValue').textContent = `${settings.nightDim}%`;
      saveSettings();
      applyNightMode();
    });
    card.querySelector('#wallFullscreenButton').addEventListener('click', enterFullscreen);
    card.querySelector('#wallPreviewNightButton').addEventListener('click', previewNightMode);
    card.querySelector('#wallRevealSettingsButton').addEventListener('click', unlockAdmin);
    updateStatusCard();
  }

  function updateSetting(key, value) {
    settings[key] = value;
    saveSettings();
    applyMode();
  }

  function updateStatusCard() {
    const el = document.getElementById('wallDisplayStatus');
    if (!el) return;
    const fullscreen = Boolean(document.fullscreenElement);
    const wake = Boolean(wakeLock);
    el.innerHTML = `
      <span class="connection-pill ${settings.enabled ? 'connected' : ''}">${settings.enabled ? 'Wall mode on' : 'Wall mode off'}</span>
      <span>Fullscreen: <strong>${fullscreen ? 'Active' : 'Not active'}</strong></span>
      <span>Screen lock: <strong>${wake ? 'Prevented' : (settings.keepAwake ? 'Waiting for permission' : 'Normal')}</strong></span>`;
  }

  async function enterFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await requestWakeLock();
      updateStatusCard();
      toast('Fullscreen enabled');
    } catch (error) {
      console.warn('Fullscreen unavailable', error);
      toast('Fullscreen was blocked by Android or the browser');
    }
  }

  function installFullscreenRecovery() {
    document.addEventListener('fullscreenchange', () => {
      document.body.classList.toggle('browser-fullscreen', Boolean(document.fullscreenElement));
      updateStatusCard();
    });
  }

  async function requestWakeLock() {
    if (!settings.enabled || !settings.keepAwake || document.hidden || !('wakeLock' in navigator)) return;
    try {
      if (wakeLock) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        updateStatusCard();
      });
      updateStatusCard();
    } catch (error) {
      console.warn('Wake lock unavailable', error);
    }
  }

  async function releaseWakeLock() {
    try { await wakeLock?.release(); } catch {}
    wakeLock = null;
    updateStatusCard();
  }

  function handleVisibility() {
    if (!document.hidden) {
      requestWakeLock();
      applyNightMode();
    }
  }

  function handleAmbientExit() {
    if (!settings.enabled || !settings.returnHomeOnWake) return;
    window.FamilyHubPublic?.setView?.('today');
  }

  function installAdminGestures() {
    const brand = document.querySelector('.brand-mark');
    if (brand) {
      brand.addEventListener('pointerdown', () => {
        brandHoldTimer = setTimeout(unlockAdmin, 3000);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(name => brand.addEventListener(name, cancelBrandHold));
    }

    const hotspot = document.createElement('button');
    hotspot.className = 'wall-admin-hotspot';
    hotspot.type = 'button';
    hotspot.setAttribute('aria-label', 'Wall display administrator access');
    hotspot.addEventListener('click', () => {
      const now = Date.now();
      cornerTaps = cornerTaps.filter(time => now - time < 2500);
      cornerTaps.push(now);
      if (cornerTaps.length >= 5) {
        cornerTaps = [];
        unlockAdmin();
      }
    });
    document.body.appendChild(hotspot);
  }

  function cancelBrandHold() {
    clearTimeout(brandHoldTimer);
    brandHoldTimer = null;
  }

  function unlockAdmin() {
    adminUnlocked = true;
    document.body.classList.remove('wall-settings-hidden');
    window.FamilyHubPublic?.setView?.('settings');
    toast('Wall Display settings unlocked');
    setTimeout(() => {
      adminUnlocked = false;
      applyMode();
    }, 10 * 60 * 1000);
  }

  function applyNightMode(forcePreview = false) {
    const active = settings.enabled && settings.nightEnabled && (forcePreview || isNightTime());
    document.body.classList.toggle('wall-night-mode', active);
    document.documentElement.style.setProperty('--wall-night-opacity', String(Math.max(0.15, Math.min(0.85, 1 - Number(settings.nightDim) / 100))));
  }

  function previewNightMode() {
    document.body.classList.add('wall-night-mode');
    toast('Night mode preview — tap anywhere to finish');
    const finish = () => {
      document.removeEventListener('pointerdown', finish, true);
      applyNightMode();
    };
    setTimeout(() => document.addEventListener('pointerdown', finish, { capture: true, once: true }), 100);
  }

  function isNightTime() {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const start = timeToMinutes(settings.nightStart);
    const end = timeToMinutes(settings.nightEnd);
    if (start === end) return true;
    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  }

  function timeToMinutes(value) {
    const [hour, minute] = String(value || '00:00').split(':').map(Number);
    return (hour || 0) * 60 + (minute || 0);
  }

  function scheduleNightCheck() {
    clearInterval(nightTimer);
    nightTimer = setInterval(applyNightMode, 60 * 1000);
  }

  function toast(message) {
    window.FamilyHubPublic?.showToast?.(message);
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }
})();
