(() => {
  'use strict';

  const PHOTO_DB = 'family-hub-ambient';
  const PHOTO_DB_VERSION = 1;
  const PHOTO_STORE = 'photos';
  const SETTINGS_KEY = 'family-hub-ambient-settings-v1';
  const DEFAULTS = {
    enabled: true,
    idleMinutes: 5,
    slideSeconds: 20,
    showClock: true,
    showNextEvent: true,
    showWeather: true,
    shuffle: true
  };

  let settings = loadSettings();
  let idleTimer = null;
  let slideTimer = null;
  let clockTimer = null;
  let active = false;
  let photos = [];
  let currentIndex = -1;
  let frontLayer = 0;
  let objectUrls = [];

  const overlay = document.getElementById('ambientMode');
  const layers = [document.getElementById('ambientPhotoA'), document.getElementById('ambientPhotoB')];
  const clockEl = document.getElementById('ambientClock');
  const dateEl = document.getElementById('ambientDate');
  const nextEl = document.getElementById('ambientNext');
  const weatherEl = document.getElementById('ambientWeather');
  const emptyEl = document.getElementById('ambientEmpty');

  initialise();

  async function initialise() {
    if (!overlay || layers.some(layer => !layer)) return;
    photos = await readPhotos();
    installSettingsCardWatcher();
    installActivityListeners();
    overlay.addEventListener('pointerdown', exitAmbient, { passive: true });
    overlay.addEventListener('keydown', exitAmbient);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopIdleTimer();
      } else {
        resetIdleTimer();
      }
    });
    resetIdleTimer();
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

  function installActivityListeners() {
    const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel'];
    events.forEach(name => document.addEventListener(name, handleActivity, { passive: true }));
  }

  function handleActivity(event) {
    if (active) {
      if (!event.target.closest('#ambientMode')) exitAmbient();
      return;
    }
    resetIdleTimer();
  }

  function stopIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function resetIdleTimer() {
    stopIdleTimer();
    if (!settings.enabled || document.hidden) return;
    const milliseconds = Math.max(1, Number(settings.idleMinutes) || 5) * 60 * 1000;
    idleTimer = setTimeout(enterAmbient, milliseconds);
  }

  async function enterAmbient() {
    if (active || !settings.enabled) return;
    photos = await readPhotos();
    active = true;
    document.body.classList.add('ambient-active');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    updateOverlay();
    showNextPhoto(true);
    const delay = Math.max(5, Number(settings.slideSeconds) || 20) * 1000;
    slideTimer = setInterval(() => showNextPhoto(false), delay);
    clockTimer = setInterval(updateOverlay, 30 * 1000);
  }

  function exitAmbient() {
    if (!active) return;
    active = false;
    clearInterval(slideTimer);
    clearInterval(clockTimer);
    slideTimer = null;
    clockTimer = null;
    overlay.classList.add('ambient-leaving');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('ambient-leaving');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('ambient-active');
      resetIdleTimer();
    }, 350);
  }

  function showNextPhoto(initial) {
    releaseObjectUrls();
    if (!photos.length) {
      layers.forEach(layer => { layer.style.backgroundImage = ''; layer.classList.remove('is-visible'); });
      emptyEl?.classList.remove('hidden');
      return;
    }
    emptyEl?.classList.add('hidden');
    if (settings.shuffle && photos.length > 1) {
      let next = currentIndex;
      while (next === currentIndex) next = Math.floor(Math.random() * photos.length);
      currentIndex = next;
    } else {
      currentIndex = (currentIndex + 1) % photos.length;
    }
    const photo = photos[currentIndex];
    const url = URL.createObjectURL(photo.blob);
    objectUrls.push(url);
    const nextLayer = initial ? 0 : 1 - frontLayer;
    layers[nextLayer].style.backgroundImage = `url("${url}")`;
    requestAnimationFrame(() => {
      layers[nextLayer].classList.add('is-visible');
      layers[frontLayer].classList.remove('is-visible');
      frontLayer = nextLayer;
    });
  }

  function releaseObjectUrls() {
    while (objectUrls.length > 2) URL.revokeObjectURL(objectUrls.shift());
  }

  function updateOverlay() {
    const now = new Date();
    if (clockEl) {
      clockEl.textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
      clockEl.classList.toggle('hidden', !settings.showClock);
    }
    if (dateEl) {
      dateEl.textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
      dateEl.classList.toggle('hidden', !settings.showClock);
    }
    updateNextEvent(now);
    updateWeather();
  }

  function getFamilyState() {
    return window.FamilyHubPublic?.getState?.() || null;
  }

  function updateNextEvent(now) {
    if (!nextEl) return;
    nextEl.classList.toggle('hidden', !settings.showNextEvent);
    if (!settings.showNextEvent) return;
    const state = getFamilyState();
    const events = Array.isArray(state?.events) ? state.events : [];
    const next = events
      .map(event => ({ event, when: eventStart(event) }))
      .filter(item => item.when && item.when >= now)
      .sort((a, b) => a.when - b.when)[0];
    if (!next) {
      nextEl.innerHTML = '<span class="ambient-label">Coming up</span><strong>No more events today</strong>';
      return;
    }
    const icon = window.FamilyHubPublic?.getEventIcon?.(next.event.title) || '📅';
    const sameDay = next.when.toDateString() === now.toDateString();
    const whenLabel = next.event.startTime
      ? new Intl.DateTimeFormat('en-GB', sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(next.when)
      : new Intl.DateTimeFormat('en-GB', sameDay ? { weekday: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' }).format(next.when);
    nextEl.innerHTML = `<span class="ambient-label">Next</span><strong>${icon} ${escapeHTML(next.event.title)}</strong><span>${escapeHTML(whenLabel)}</span>`;
  }

  function eventStart(event) {
    const date = event?.startDate || event?.date;
    if (!date) return null;
    const time = event.startTime || '00:00';
    const parsed = new Date(`${date}T${time}:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function updateWeather() {
    if (!weatherEl) return;
    weatherEl.classList.toggle('hidden', !settings.showWeather);
    if (!settings.showWeather) return;
    const weather = getFamilyState()?.weather;
    const current = weather?.forecast?.current;
    if (!current) {
      weatherEl.textContent = weather?.locationName ? weather.locationName : '';
      return;
    }
    const temperature = Math.round(current.temperature_2m ?? current.temperature ?? 0);
    weatherEl.innerHTML = `<span>${weatherIcon(current.weather_code)}</span><strong>${temperature}°</strong>`;
  }

  function weatherIcon(code) {
    if (code === 0) return '☀️';
    if ([1, 2].includes(code)) return '🌤️';
    if (code === 3) return '☁️';
    if ([45, 48].includes(code)) return '🌫️';
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return '❄️';
    if ([95, 96, 99].includes(code)) return '⛈️';
    return '🌤️';
  }

  function installSettingsCardWatcher() {
    const root = document.getElementById('viewRoot');
    if (!root) return;
    const observer = new MutationObserver(() => insertSettingsCard());
    observer.observe(root, { childList: true, subtree: false });
    insertSettingsCard();
  }

  function insertSettingsCard() {
    const layout = document.querySelector('.settings-layout');
    if (!layout || document.getElementById('ambientSettingsCard')) return;
    const card = document.createElement('section');
    card.id = 'ambientSettingsCard';
    card.className = 'card settings-card ambient-settings-card';
    card.innerHTML = settingsCardHTML();
    layout.prepend(card);
    bindSettingsCard(card);
  }

  function settingsCardHTML() {
    return `
      <div class="card-heading">
        <div>
          <div class="card-title">Ambient Mode</div>
          <div class="card-subtitle">Turn the tablet into a family photo frame when nobody is using it.</div>
        </div>
        <label class="ambient-switch"><input id="ambientEnabled" type="checkbox" ${settings.enabled ? 'checked' : ''}><span></span></label>
      </div>
      <div class="ambient-setting-grid">
        <label><span>Start after</span><select id="ambientIdleMinutes">${options([1, 2, 5, 10, 15, 30], settings.idleMinutes, value => `${value} minute${value === 1 ? '' : 's'}`)}</select></label>
        <label><span>Change photo every</span><select id="ambientSlideSeconds">${options([10, 20, 30, 60], settings.slideSeconds, value => `${value} seconds`)}</select></label>
      </div>
      <div class="ambient-checks">
        ${checkRow('ambientShowClock', 'Show clock and date', settings.showClock)}
        ${checkRow('ambientShowNext', 'Show next event', settings.showNextEvent)}
        ${checkRow('ambientShowWeather', 'Show weather', settings.showWeather)}
        ${checkRow('ambientShuffle', 'Shuffle photos', settings.shuffle)}
      </div>
      <div class="ambient-photo-tools">
        <label class="primary-button ambient-upload-button">＋ Add photos<input id="ambientPhotoInput" type="file" accept="image/*" multiple hidden></label>
        <button class="secondary-button" id="ambientPreviewButton" type="button">Preview</button>
        <button class="secondary-button" id="ambientClearButton" type="button">Remove all</button>
      </div>
      <div id="ambientPhotoSummary" class="ambient-photo-summary">${photoSummary()}</div>
      <div id="ambientPhotoGrid" class="ambient-photo-grid">${photoGridHTML()}</div>
      <p class="settings-note">Photos are resized and stored only on this tablet in IndexedDB. They are included separately from your calendar backup.</p>`;
  }

  function options(values, selected, label) {
    return values.map(value => `<option value="${value}" ${Number(selected) === value ? 'selected' : ''}>${label(value)}</option>`).join('');
  }

  function checkRow(id, label, checked) {
    return `<label class="checkbox-label"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
  }

  function photoSummary() {
    return photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'} stored on this tablet` : 'No photos added yet';
  }

  function photoGridHTML() {
    if (!photos.length) return '';
    return photos.slice(0, 12).map(photo => `<figure class="ambient-thumb" data-photo-id="${photo.id}"><img alt="${escapeHTML(photo.name || 'Family photo')}"><button type="button" data-remove-photo="${photo.id}" aria-label="Remove photo">×</button></figure>`).join('');
  }

  function bindSettingsCard(card) {
    card.querySelector('#ambientEnabled').addEventListener('change', event => updateSetting('enabled', event.target.checked));
    card.querySelector('#ambientIdleMinutes').addEventListener('change', event => updateSetting('idleMinutes', Number(event.target.value)));
    card.querySelector('#ambientSlideSeconds').addEventListener('change', event => updateSetting('slideSeconds', Number(event.target.value)));
    card.querySelector('#ambientShowClock').addEventListener('change', event => updateSetting('showClock', event.target.checked));
    card.querySelector('#ambientShowNext').addEventListener('change', event => updateSetting('showNextEvent', event.target.checked));
    card.querySelector('#ambientShowWeather').addEventListener('change', event => updateSetting('showWeather', event.target.checked));
    card.querySelector('#ambientShuffle').addEventListener('change', event => updateSetting('shuffle', event.target.checked));
    card.querySelector('#ambientPhotoInput').addEventListener('change', importPhotos);
    card.querySelector('#ambientPreviewButton').addEventListener('click', enterAmbient);
    card.querySelector('#ambientClearButton').addEventListener('click', clearPhotos);
    card.addEventListener('click', event => {
      const button = event.target.closest('[data-remove-photo]');
      if (button) removePhoto(button.dataset.removePhoto);
    });
    hydrateThumbnails(card);
  }

  function updateSetting(key, value) {
    settings[key] = value;
    saveSettings();
    resetIdleTimer();
  }

  async function importPhotos(event) {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    const button = document.querySelector('.ambient-upload-button');
    button?.classList.add('is-busy');
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const blob = await resizeImage(file, 1920, 1280, 0.86);
        await putPhoto({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name: file.name, type: blob.type, createdAt: new Date().toISOString(), blob });
      }
      photos = await readPhotos();
      refreshSettingsCard();
      window.FamilyHubPublic?.showToast?.(`${files.length} photo${files.length === 1 ? '' : 's'} added`);
    } catch (error) {
      console.error(error);
      alert('One or more photos could not be saved. Please try a smaller selection.');
    } finally {
      button?.classList.remove('is-busy');
      event.target.value = '';
    }
  }

  async function resizeImage(file, maxWidth, maxHeight, quality) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Photo conversion failed')), 'image/jpeg', quality));
  }

  async function removePhoto(id) {
    await deletePhoto(id);
    photos = await readPhotos();
    refreshSettingsCard();
  }

  async function clearPhotos() {
    if (!photos.length || !confirm('Remove every Ambient Mode photo from this tablet?')) return;
    await clearPhotoStore();
    photos = [];
    refreshSettingsCard();
  }

  function refreshSettingsCard() {
    document.getElementById('ambientSettingsCard')?.remove();
    insertSettingsCard();
  }

  async function hydrateThumbnails(card) {
    for (const figure of card.querySelectorAll('[data-photo-id]')) {
      const photo = photos.find(item => item.id === figure.dataset.photoId);
      if (!photo) continue;
      const url = URL.createObjectURL(photo.blob);
      const img = figure.querySelector('img');
      img.src = url;
      img.onload = () => URL.revokeObjectURL(url);
    }
  }

  function openPhotoDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PHOTO_DB, PHOTO_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open photo library'));
    });
  }

  async function withStore(mode, action) {
    const db = await openPhotoDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(PHOTO_STORE, mode);
      const store = transaction.objectStore(PHOTO_STORE);
      const request = action(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  function readPhotos() { return withStore('readonly', store => store.getAll()).then(items => items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))); }
  function putPhoto(photo) { return withStore('readwrite', store => store.put(photo)); }
  function deletePhoto(id) { return withStore('readwrite', store => store.delete(id)); }
  function clearPhotoStore() { return withStore('readwrite', store => store.clear()); }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }
})();
