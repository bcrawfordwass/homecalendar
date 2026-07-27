(() => {
  'use strict';

  const BACKUP_FORMAT_VERSION = 1;
  const APP = window.APP_CONFIG || { name: 'Family Hub', version: '0.1.0', buildDate: '2026-07-27', storage: 'Local storage' };
  let serviceWorkerRegistration = null;
  let refreshingForUpdate = false;
  const DEFAULT_PEOPLE = [
    { id: 'ben', name: 'Ben', colour: '#ff8a65', chip: '#ffe6dc' },
    { id: 'millie', name: 'Millie', colour: '#7e9cff', chip: '#e5eaff' },
    { id: 'ophelia', name: 'Ophelia', colour: '#e98bc4', chip: '#fbe3f2' },
    { id: 'family', name: 'Family', colour: '#5fbe8f', chip: '#dcf3e7' }
  ];

  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayISO = toISODate(new Date());
  const seed = {
    people: structuredCloneSafe(DEFAULT_PEOPLE),
    events: [
      { id: uid(), title: 'Swimming', startDate: addDaysISO(todayISO, 1), endDate: addDaysISO(todayISO, 1), startTime: '16:30', endTime: '17:30', person: 'millie', repeats: false },
      { id: uid(), title: 'Family weekend away', startDate: addDaysISO(todayISO, 3), endDate: addDaysISO(todayISO, 5), startTime: '', endTime: '', person: 'family', repeats: false }
    ],
    chores: [
      { id: uid(), title: 'Empty dishwasher', person: 'ben', done: false },
      { id: uid(), title: 'Put bins out', person: 'family', done: false },
      { id: uid(), title: 'Tidy bedroom', person: 'millie', done: true }
    ],
    meals: {
      [todayISO]: 'Chicken curry',
      [addDaysISO(todayISO, 1)]: 'Tacos',
      [addDaysISO(todayISO, 2)]: 'Pesto gnocchi',
      [addDaysISO(todayISO, 3)]: 'Fish pie',
      [addDaysISO(todayISO, 4)]: 'Homemade burgers',
      [addDaysISO(todayISO, 5)]: 'Roast chicken',
      [addDaysISO(todayISO, 6)]: 'Leftovers'
    },
    shopping: [
      { id: uid(), title: 'Milk', done: false },
      { id: uid(), title: 'Bread', done: false },
      { id: uid(), title: 'Apples', done: true }
    ],
    weather: {
      locationName: '',
      latitude: null,
      longitude: null,
      updatedAt: null,
      forecast: null
    }
  };

  let state = null;
  let lastBackupAt = null;
  let storageMode = 'IndexedDB';
  let currentView = 'today';
  let weekOffset = 0;
  let deferredInstallPrompt = null;
  let editingEventId = null;

  const viewRoot = document.getElementById('viewRoot');
  const viewTitle = document.getElementById('viewTitle');
  const fullDate = document.getElementById('fullDate');
  const clock = document.getElementById('clock');
  const mainNav = document.getElementById('mainNav');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const eventForm = document.getElementById('eventForm');
  const eventTitle = document.getElementById('eventTitle');
  const eventStartDate = document.getElementById('eventStartDate');
  const eventEndDate = document.getElementById('eventEndDate');
  const eventStartTime = document.getElementById('eventStartTime');
  const eventEndTime = document.getElementById('eventEndTime');
  const eventPerson = document.getElementById('eventPerson');
  const eventRepeats = document.getElementById('eventRepeats');
  const installButton = document.getElementById('installButton');
  const modalTitle = document.getElementById('modalTitle');
  const saveEventButton = document.getElementById('saveEventButton');
  const updateBanner = document.getElementById('updateBanner');
  const updateNowButton = document.getElementById('updateNowButton');
  const appVersion = document.getElementById('appVersion');

  initialise();

  async function initialise() {
    const storageResult = await window.FamilyHubStorage.initialise(structuredCloneSafe(seed));
    state = normaliseLoadedState(storageResult.state);
    lastBackupAt = storageResult.lastBackup || null;
    storageMode = storageResult.mode || 'IndexedDB';
    document.title = `${APP.name} v${APP.version}`;
    if (appVersion) appVersion.textContent = `v${APP.version}`;
    refreshPersonOptions();
    mainNav.addEventListener('click', onNavigation);
    viewRoot.addEventListener('click', onViewClick);
    viewRoot.addEventListener('change', onViewChange);
    viewRoot.addEventListener('keydown', onViewKeydown);
    eventForm.addEventListener('submit', addEvent);
    eventStartDate.addEventListener('change', () => {
      eventEndDate.min = eventStartDate.value;
      if (eventEndDate.value && eventEndDate.value < eventStartDate.value) eventEndDate.value = eventStartDate.value;
    });
    document.getElementById('closeModalButton').addEventListener('click', closeEventModal);
    document.getElementById('cancelModalButton').addEventListener('click', closeEventModal);
    modalBackdrop.addEventListener('click', event => {
      if (event.target === modalBackdrop) closeEventModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modalBackdrop.classList.contains('hidden')) closeEventModal();
    });

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      installButton.classList.remove('hidden');
    });
    installButton.addEventListener('click', installApp);
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      installButton.classList.add('hidden');
      showToast('Family Hub installed');
    });

    updateNowButton?.addEventListener('click', applyAvailableUpdate);
    setupServiceWorkerUpdates();

    updateDateAndClock();
    window.setInterval(updateDateAndClock, 30_000);
    render();
    if (hasWeatherLocation()) refreshWeather(false);
  }

  function onNavigation(event) {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    setView(button.dataset.view);
  }

  function setView(view) {
    currentView = view;
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    render();
  }

  function render() {
    updateViewTitle();
    if (currentView === 'today') renderToday();
    if (currentView === 'calendar') renderCalendar();
    if (currentView === 'chores') renderChores();
    if (currentView === 'meals') renderMeals();
    if (currentView === 'shopping') renderShopping();
    if (currentView === 'people') renderPeople();
    if (currentView === 'settings') renderSettings();
  }

  function updateViewTitle() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const titles = { today: greeting, calendar: 'Calendar', chores: 'Chores', meals: 'Meals', shopping: 'Shopping', people: 'People', settings: 'Settings' };
    viewTitle.textContent = titles[currentView] || 'Family Hub';
  }

  function updateDateAndClock() {
    const now = new Date();
    fullDate.textContent = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(now);
    clock.textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(now);
    updateViewTitle();
  }

  function renderToday() {
    const today = toISODate(new Date());
    const week = weekDates(0);
    const todayEvents = eventsForDate(today);
    const openChores = state.chores.filter(item => !item.done);
    const remainingShopping = state.shopping.filter(item => !item.done);
    const meal = state.meals[today] || 'Not decided';
    const weekEventCount = week.reduce((total, date) => total + eventsForDate(date).length, 0);

    viewRoot.innerHTML = `
      <div class="week-at-glance">
        <section class="card glance-hero">
          <div class="glance-hero-copy">
            <div class="eyebrow">Your week at a glance</div>
            <div class="glance-date-range">${escapeHTML(formatWeekRange(week[0], week[6]))}</div>
            <p>${weekEventCount ? `${weekEventCount} ${weekEventCount === 1 ? 'event' : 'events'} planned this week.` : 'A quiet week so far.'}</p>
          </div>
          <button class="primary-button" data-action="add-event" type="button">＋ Add event</button>
        </section>

        <section class="card glance-week-card">
          <div class="card-heading">
            <div>
              <div class="card-title">This week</div>
              <div class="card-subtitle">Everything coming up, day by day.</div>
            </div>
            <button class="card-link" data-action="open-calendar" type="button">Full calendar →</button>
          </div>
          <div class="glance-days">
            ${week.map(date => weekDaySummaryHTML(date, today)).join('')}
          </div>
        </section>

        <div class="glance-side-grid">
          <section class="card today-focus-card">
            <div class="card-heading">
              <div>
                <div class="card-title">Today</div>
                <div class="card-subtitle">${escapeHTML(formatFriendlyDate(today))}</div>
              </div>
            </div>
            <div class="today-event-list">
              ${todayEvents.length ? todayEvents.slice(0, 4).map(event => eventCardHTML(event, today)).join('') : '<div class="empty-message compact-empty">Nothing scheduled today.</div>'}
            </div>
          </section>

          ${weatherCardHTML()}

          <section class="card meal-highlight glance-stat-card" data-action="open-meals" role="button" tabindex="0">
            <div class="stat-icon" aria-hidden="true">◉</div>
            <div>
              <div class="card-title">Tonight’s dinner</div>
              <div class="meal-name compact-meal">${escapeHTML(meal)}</div>
            </div>
          </section>

          <section class="card glance-stat-card" data-action="open-chores" role="button" tabindex="0">
            <div class="stat-icon" aria-hidden="true">✓</div>
            <div>
              <div class="card-title">Chores</div>
              <div class="stat-number">${openChores.length}</div>
              <div class="muted">${openChores.length === 1 ? 'job still to do' : 'jobs still to do'}</div>
            </div>
          </section>

          <section class="card glance-stat-card" data-action="open-shopping" role="button" tabindex="0">
            <div class="stat-icon" aria-hidden="true">⌑</div>
            <div>
              <div class="card-title">Shopping</div>
              <div class="stat-number">${remainingShopping.length}</div>
              <div class="muted">${remainingShopping.length === 1 ? 'item left' : 'items left'}</div>
            </div>
          </section>
        </div>
      </div>`;
  }

  function weekDaySummaryHTML(date, today) {
    const events = eventsForDate(date);
    const parsed = parseISODate(date);
    const dayName = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(parsed);
    const dateLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(parsed);
    const meal = state.meals[date];
    return `
      <article class="glance-day ${date === today ? 'is-today' : ''}">
        <div class="glance-day-heading">
          <span class="glance-day-name">${date === today ? 'Today' : escapeHTML(dayName)}</span>
          <span>${escapeHTML(dateLabel)}</span>
        </div>
        <div class="glance-day-events">
          ${events.length ? events.slice(0, 3).map(event => {
            const person = personFor(event.person);
            return `<div class="glance-event"><i style="background:${person.colour}"></i><span><strong>${escapeHTML(eventTimeLabel(event, date))}</strong> ${escapeHTML(event.title)}</span></div>`;
          }).join('') : '<div class="glance-free">Nothing planned</div>'}
          ${events.length > 3 ? `<div class="glance-more">＋${events.length - 3} more</div>` : ''}
        </div>
        <div class="glance-meal">${meal ? `<span aria-hidden="true">◉</span> ${escapeHTML(meal)}` : '<span class="muted">Dinner not planned</span>'}</div>
      </article>`;
  }

  function normaliseWeatherState(value) {
    return {
      locationName: typeof value?.locationName === 'string' ? value.locationName : '',
      latitude: value?.latitude !== null && value?.latitude !== undefined && Number.isFinite(Number(value.latitude)) ? Number(value.latitude) : null,
      longitude: value?.longitude !== null && value?.longitude !== undefined && Number.isFinite(Number(value.longitude)) ? Number(value.longitude) : null,
      updatedAt: value?.updatedAt || null,
      forecast: value?.forecast && typeof value.forecast === 'object' ? value.forecast : null
    };
  }

  function hasWeatherLocation() {
    return state.weather?.latitude !== null && state.weather?.latitude !== undefined && state.weather?.longitude !== null && state.weather?.longitude !== undefined && Number.isFinite(Number(state.weather.latitude)) && Number.isFinite(Number(state.weather.longitude));
  }

  function weatherCardHTML() {
    const weather = normaliseWeatherState(state.weather);
    if (!hasWeatherLocation()) {
      return `
        <section class="card weather-card weather-card-empty" data-action="open-weather-settings" role="button" tabindex="0">
          <div class="weather-icon-large" aria-hidden="true">☀</div>
          <div>
            <div class="card-title">Weather</div>
            <div class="muted">Choose your location in Settings.</div>
          </div>
        </section>`;
    }

    const forecast = weather.forecast;
    if (!forecast?.current) {
      return `
        <section class="card weather-card">
          <div>
            <div class="card-title">Weather in ${escapeHTML(weather.locationName || 'your area')}</div>
            <div class="muted">Loading the latest forecast…</div>
          </div>
          <button class="secondary-button" data-action="refresh-weather" type="button">Refresh</button>
        </section>`;
    }

    const current = forecast.current;
    const daily = Array.isArray(forecast.daily) ? forecast.daily.slice(0, 4) : [];
    const condition = weatherCondition(current.code, current.isDay);
    return `
      <section class="card weather-card">
        <div class="weather-current">
          <div class="weather-icon-large" aria-hidden="true">${condition.icon}</div>
          <div class="weather-current-copy">
            <div class="weather-location">${escapeHTML(weather.locationName || 'Current location')}</div>
            <div class="weather-temperature">${Math.round(current.temperature)}°</div>
            <div class="weather-condition">${escapeHTML(condition.label)}</div>
            <div class="weather-feels">Feels like ${Math.round(current.apparentTemperature)}°</div>
          </div>
        </div>
        <div class="weather-days">
          ${daily.map(day => {
            const dayCondition = weatherCondition(day.code, true);
            return `<div class="weather-day"><strong>${escapeHTML(day.label)}</strong><span class="weather-day-icon" aria-hidden="true">${dayCondition.icon}</span><span>${Math.round(day.max)}° / ${Math.round(day.min)}°</span>${Number.isFinite(day.rainChance) ? `<small>${Math.round(day.rainChance)}% rain</small>` : ''}</div>`;
          }).join('')}
        </div>
        <button class="weather-refresh-button" data-action="refresh-weather" type="button" aria-label="Refresh weather">↻</button>
      </section>`;
  }

  async function setWeatherLocationFromInput() {
    const input = document.getElementById('weatherLocationInput');
    const query = input?.value.trim();
    if (!query) {
      input?.focus();
      showToast('Enter a town or city');
      return;
    }
    showToast('Finding location…');
    try {
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Location search failed');
      const payload = await response.json();
      const place = payload.results?.[0];
      if (!place) {
        showToast('Location not found');
        return;
      }
      const locationParts = [place.name, place.admin1, place.country].filter(Boolean);
      state.weather = {
        ...normaliseWeatherState(state.weather),
        locationName: [...new Set(locationParts)].join(', '),
        latitude: Number(place.latitude),
        longitude: Number(place.longitude)
      };
      saveState();
      await refreshWeather(true);
      render();
    } catch (error) {
      console.error('Could not find weather location', error);
      showToast('Could not find that location');
    }
  }

  function useDeviceLocation() {
    if (!navigator.geolocation) {
      showToast('Location is not available on this tablet');
      return;
    }
    showToast('Requesting tablet location…');
    navigator.geolocation.getCurrentPosition(async position => {
      state.weather = {
        ...normaliseWeatherState(state.weather),
        locationName: 'Current location',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      saveState();
      await refreshWeather(true);
      render();
    }, error => {
      console.error('Could not use device location', error);
      showToast(error.code === 1 ? 'Location permission was not allowed' : 'Could not get tablet location');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60 * 60 * 1000 });
  }

  async function refreshWeather(showMessage = false) {
    if (!hasWeatherLocation()) {
      if (showMessage) showToast('Choose a weather location first');
      return;
    }
    if (showMessage) showToast('Refreshing weather…');
    const { latitude, longitude } = state.weather;
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'temperature_2m,apparent_temperature,weather_code,is_day,precipitation',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '5'
    });
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Weather request failed');
      const payload = await response.json();
      state.weather.forecast = normaliseForecast(payload);
      state.weather.updatedAt = new Date().toISOString();
      saveState();
      if (currentView === 'today' || currentView === 'settings') render();
      if (showMessage) showToast('Weather updated');
    } catch (error) {
      console.error('Could not refresh weather', error);
      if (showMessage) showToast(state.weather.forecast ? 'Using the last saved forecast' : 'Weather is unavailable right now');
    }
  }

  function normaliseForecast(payload) {
    const daily = payload.daily || {};
    return {
      timezone: payload.timezone || '',
      current: {
        temperature: Number(payload.current?.temperature_2m ?? 0),
        apparentTemperature: Number(payload.current?.apparent_temperature ?? payload.current?.temperature_2m ?? 0),
        code: Number(payload.current?.weather_code ?? 0),
        isDay: Number(payload.current?.is_day ?? 1) === 1,
        precipitation: Number(payload.current?.precipitation ?? 0)
      },
      daily: (daily.time || []).map((date, index) => ({
        date,
        label: index === 0 ? 'Today' : new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(parseISODate(date)),
        code: Number(daily.weather_code?.[index] ?? 0),
        max: Number(daily.temperature_2m_max?.[index] ?? 0),
        min: Number(daily.temperature_2m_min?.[index] ?? 0),
        rainChance: Number(daily.precipitation_probability_max?.[index])
      }))
    };
  }

  function weatherCondition(code, isDay = true) {
    const night = !isDay;
    if (code === 0) return { icon: night ? '☾' : '☀', label: night ? 'Clear night' : 'Clear sky' };
    if ([1, 2].includes(code)) return { icon: night ? '☾' : '⛅', label: code === 1 ? 'Mainly clear' : 'Partly cloudy' };
    if (code === 3) return { icon: '☁', label: 'Cloudy' };
    if ([45, 48].includes(code)) return { icon: '≋', label: 'Foggy' };
    if ([51, 53, 55, 56, 57].includes(code)) return { icon: '🌦', label: 'Drizzle' };
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { icon: '🌧', label: 'Rain' };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: '❄', label: 'Snow' };
    if ([95, 96, 99].includes(code)) return { icon: '⛈', label: 'Thunderstorms' };
    return { icon: '☁', label: 'Changeable' };
  }

  function renderCalendar() {
    const week = weekDates(weekOffset);
    const weekStart = week[0];
    const weekEnd = week[6];
    viewRoot.innerHTML = `
      <section class="card calendar-card">
        <div class="calendar-toolbar">
          <div>
            <div class="card-title">${escapeHTML(formatWeekRange(weekStart, weekEnd))}</div>
            <div class="legend">${state.people.map(person => `<span><i class="legend-dot" style="background:${person.colour}"></i>${escapeHTML(person.name)}</span>`).join('')}</div>
          </div>
          <div class="toolbar-actions">
            <div class="week-nav">
              <button class="secondary-button" data-action="previous-week" type="button" aria-label="Previous week">‹</button>
              <button class="secondary-button" data-action="this-week" type="button">Today</button>
              <button class="secondary-button" data-action="next-week" type="button" aria-label="Next week">›</button>
            </div>
            <button class="primary-button" data-action="add-event" type="button">＋ Add event</button>
          </div>
        </div>
        <div class="week-grid">
          ${week.map(date => dayColumnHTML(date)).join('')}
        </div>
      </section>`;
  }

  function dayColumnHTML(date) {
    const events = eventsForDate(date);
    const isToday = date === toISODate(new Date());
    const parsed = parseISODate(date);
    const dayName = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(parsed);
    const dateLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(parsed);
    return `
      <div class="day-column ${isToday ? 'today-column' : ''}">
        <div class="day-heading"><strong>${escapeHTML(dayName)}</strong><span>${escapeHTML(dateLabel)}</span></div>
        ${events.length ? events.map(event => calendarEventHTML(event, date)).join('') : '<div class="muted" style="font-size:12px">No events</div>'}
      </div>`;
  }

  function calendarEventHTML(event, date) {
    const person = personFor(event.person);
    return `
      <article class="event-card" style="--event-colour:${person.colour}">
        <span class="event-time">${escapeHTML(eventTimeLabel(event, date))}</span>
        <span class="event-title" title="${escapeHTML(event.title)}">${escapeHTML(event.title)}</span>
        <span class="person-chip" style="--chip-colour:${person.chip}">${escapeHTML(person.name)}</span>
        <div class="event-actions"><button class="tiny-button" data-action="edit-event" data-id="${event.id}" type="button">Edit</button><button class="tiny-button" data-action="delete-event" data-id="${event.id}" type="button">Delete</button></div>
      </article>`;
  }

  function eventCardHTML(event, date = toISODate(new Date())) {
    const person = personFor(event.person);
    return `
      <article class="event-card" style="--event-colour:${person.colour}">
        <span class="event-time">${escapeHTML(eventTimeLabel(event, date))}</span>
        <span class="event-title">${escapeHTML(event.title)}</span>
        <span class="person-chip" style="--chip-colour:${person.chip}">${escapeHTML(person.name)}</span>
      </article>`;
  }

  function renderChores() {
    viewRoot.innerHTML = `
      <section class="card list-card">
        <div class="card-heading">
          <div>
            <div class="card-title">Household chores</div>
            <div class="card-subtitle">Tap the box when a chore is complete.</div>
          </div>
        </div>
        ${quickAddHTML('Add a chore', 'add-chore-input', 'add-chore')}
        <div>
          ${state.chores.length ? state.chores.map(choreRowHTML).join('') : '<div class="empty-message">No chores yet.</div>'}
        </div>
      </section>`;
  }

  function choreRowHTML(item) {
    return `
      <div class="list-row">
        <button class="check-button ${item.done ? 'done' : ''}" data-action="toggle-chore" data-id="${item.id}" type="button" aria-label="${item.done ? 'Mark incomplete' : 'Mark complete'}">✓</button>
        <span class="row-title ${item.done ? 'done' : ''}">${escapeHTML(item.title)}</span>
        <span class="spacer"></span>
        <select class="person-select" data-action="assign-chore" data-id="${item.id}" aria-label="Assign chore">
          ${state.people.map(person => `<option value="${person.id}" ${person.id === item.person ? 'selected' : ''}>${escapeHTML(person.name)}</option>`).join('')}
        </select>
        <button class="delete-button" data-action="delete-chore" data-id="${item.id}" type="button" aria-label="Delete chore">×</button>
      </div>`;
  }

  function renderMeals() {
    const week = weekDates(weekOffset);
    viewRoot.innerHTML = `
      <section class="card list-card">
        <div class="calendar-toolbar">
          <div>
            <div class="card-title">Dinner plan</div>
            <div class="card-subtitle">Changes save automatically on this tablet.</div>
          </div>
          <div class="week-nav">
            <button class="secondary-button" data-action="previous-week" type="button" aria-label="Previous week">‹</button>
            <button class="secondary-button" data-action="this-week" type="button">This week</button>
            <button class="secondary-button" data-action="next-week" type="button" aria-label="Next week">›</button>
          </div>
        </div>
        <div class="meal-grid" style="margin-top:22px">
          ${week.map(date => mealRowHTML(date)).join('')}
        </div>
      </section>`;
  }

  function mealRowHTML(date) {
    const parsed = parseISODate(date);
    const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(parsed);
    const label = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(parsed);
    return `
      <label class="meal-row">
        <span class="meal-day"><strong>${escapeHTML(day)}</strong><span>${escapeHTML(label)}</span></span>
        <input class="meal-input" data-action="edit-meal" data-date="${date}" value="${escapeHTML(state.meals[date] || '')}" placeholder="What’s for dinner?">
      </label>`;
  }

  function renderPeople() {
    viewRoot.innerHTML = `
      <section class="card list-card">
        <div class="card-heading">
          <div>
            <div class="card-title">Family members</div>
            <div class="card-subtitle">Add everyone who should have their own calendar colour.</div>
          </div>
        </div>
        <div class="people-grid">
          ${state.people.map(person => `
            <article class="person-card">
              <div class="person-avatar" style="background:${person.colour}">${escapeHTML(person.name.slice(0, 1).toUpperCase())}</div>
              <div class="person-card-copy">
                <strong>${escapeHTML(person.name)}</strong>
                <span>${person.id === 'family' ? 'Shared family events' : 'Personal calendar colour'}</span>
              </div>
              ${person.id === 'family' ? '' : `<button class="delete-button" data-action="delete-person" data-id="${person.id}" type="button" aria-label="Delete ${escapeHTML(person.name)}">×</button>`}
            </article>`).join('')}
        </div>
        <form id="addPersonForm" class="add-person-form">
          <label>
            <span>Name</span>
            <input id="newPersonName" autocomplete="off" placeholder="Add a family member" required>
          </label>
          <label>
            <span>Colour</span>
            <input id="newPersonColour" type="color" value="#8f7cf2" aria-label="Choose calendar colour">
          </label>
          <button class="primary-button" type="submit">＋ Add person</button>
        </form>
      </section>`;
    document.getElementById('addPersonForm')?.addEventListener('submit', addPerson);
  }

  function addPerson(event) {
    event.preventDefault();
    const nameInput = document.getElementById('newPersonName');
    const colourInput = document.getElementById('newPersonColour');
    const name = nameInput.value.trim();
    if (!name) return;
    if (state.people.some(person => person.name.toLowerCase() === name.toLowerCase())) {
      showToast('That person is already listed');
      return;
    }
    const colour = colourInput.value || '#8f7cf2';
    state.people.splice(Math.max(0, state.people.length - 1), 0, {
      id: slugify(name) + '-' + Math.random().toString(16).slice(2, 6),
      name,
      colour,
      chip: hexToSoftColour(colour)
    });
    refreshPersonOptions();
    saveAndRender(`${name} added`);
  }

  function deletePerson(id) {
    const person = state.people.find(entry => entry.id === id);
    if (!person || id === 'family') return;
    state.events.forEach(event => { if (event.person === id) event.person = 'family'; });
    state.chores.forEach(chore => { if (chore.person === id) chore.person = 'family'; });
    state.people = state.people.filter(entry => entry.id !== id);
    refreshPersonOptions();
    saveAndRender(`${person.name} removed`);
  }

  function renderSettings() {
    const counts = {
      people: state.people.length,
      events: state.events.length,
      chores: state.chores.length,
      shopping: state.shopping.length
    };
    viewRoot.innerHTML = `
      <div class="settings-layout">
        <section class="card settings-card">
          <div class="card-heading">
            <div>
              <div class="card-title">About Family Hub</div>
              <div class="card-subtitle">App details and update controls.</div>
            </div>
          </div>
          <dl class="settings-list">
            <div><dt>Version</dt><dd>v${escapeHTML(APP.version)}</dd></div>
            <div><dt>Built</dt><dd>${escapeHTML(formatBuildDate(APP.buildDate))}</dd></div>
            <div><dt>Data storage</dt><dd>${escapeHTML(storageMode)}</dd></div>
            <div><dt>Last backup</dt><dd>${escapeHTML(formatLastBackup())}</dd></div>
            <div><dt>Update status</dt><dd id="settingsUpdateStatus">Checking…</dd></div>
          </dl>
          <div class="settings-actions">
            <button class="primary-button" data-action="check-update" type="button">Check for updates</button>
            <button class="secondary-button" data-action="reload-app" type="button">Reload app</button>
          </div>
          <p class="settings-note">Reloading or updating the app does not remove your family information. Do not clear Chrome’s site data unless you have made a backup.</p>
        </section>

        <section class="card settings-card weather-settings-card">
          <div class="card-heading">
            <div>
              <div class="card-title">Dashboard weather</div>
              <div class="card-subtitle">Choose a town or use the tablet's current location.</div>
            </div>
          </div>
          <div class="weather-location-controls">
            <input id="weatherLocationInput" autocomplete="off" placeholder="e.g. London or Brighton" value="${escapeHTML(state.weather?.locationName || '')}">
            <button class="primary-button" data-action="set-weather-location" type="button">Find location</button>
            <button class="secondary-button" data-action="use-device-location" type="button">Use tablet location</button>
            ${hasWeatherLocation() ? '<button class="secondary-button" data-action="refresh-weather" type="button">Refresh weather</button>' : ''}
          </div>
          <p class="settings-note">Weather is supplied by Open-Meteo. The most recent successful forecast is kept on the tablet, so the dashboard still has something to show if the internet is temporarily unavailable.</p>
        </section>

        <section class="card settings-card backup-card">
          <div class="card-heading">
            <div>
              <div class="card-title">Backup and restore</div>
              <div class="card-subtitle">Keep a copy of your family information somewhere safe.</div>
            </div>
          </div>
          <div class="backup-actions">
            <button class="primary-button" data-action="export-backup" type="button">Download backup</button>
            <button class="secondary-button" data-action="choose-restore" type="button">Restore from backup</button>
            <input id="restoreBackupInput" class="visually-hidden" data-action="restore-backup" type="file" accept="application/json,.json">
          </div>
          <p class="settings-note">A backup contains your people, events, chores, meals and shopping list. Restoring replaces the information currently stored on this tablet.</p>
        </section>

        <section class="card settings-card">
          <div class="card-title">On this tablet</div>
          <div class="storage-stats">
            <div><strong>${counts.people}</strong><span>People</span></div>
            <div><strong>${counts.events}</strong><span>Events</span></div>
            <div><strong>${counts.chores}</strong><span>Chores</span></div>
            <div><strong>${counts.shopping}</strong><span>Shopping items</span></div>
          </div>
        </section>
      </div>`;
    checkForPublishedVersion(false);
  }

  function renderShopping() {
    const completed = state.shopping.filter(item => item.done).length;
    viewRoot.innerHTML = `
      <section class="card list-card">
        <div class="card-heading">
          <div>
            <div class="card-title">Shopping list</div>
            <div class="card-subtitle">A simple shared list for the household.</div>
          </div>
        </div>
        ${quickAddHTML('Add an item', 'add-shopping-input', 'add-shopping')}
        <div>
          ${state.shopping.length ? state.shopping.map(shoppingRowHTML).join('') : '<div class="empty-message">Your list is empty.</div>'}
        </div>
        ${completed ? '<div class="list-actions"><button class="secondary-button" data-action="clear-shopping" type="button">Clear completed</button></div>' : ''}
      </section>`;
  }

  function shoppingRowHTML(item) {
    return `
      <div class="list-row">
        <button class="check-button ${item.done ? 'done' : ''}" data-action="toggle-shopping" data-id="${item.id}" type="button" aria-label="${item.done ? 'Mark needed' : 'Mark bought'}">✓</button>
        <span class="row-title ${item.done ? 'done' : ''}">${escapeHTML(item.title)}</span>
        <span class="spacer"></span>
        <button class="delete-button" data-action="delete-shopping" data-id="${item.id}" type="button" aria-label="Delete item">×</button>
      </div>`;
  }

  function quickAddHTML(placeholder, inputId, action) {
    return `
      <div class="quick-add">
        <input id="${inputId}" data-quick-action="${action}" autocomplete="off" placeholder="${escapeHTML(placeholder)}">
        <button class="primary-button" data-action="${action}" type="button">＋ Add</button>
      </div>`;
  }

  function onViewClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === 'open-calendar') setView('calendar');
    if (action === 'open-chores') setView('chores');
    if (action === 'open-meals') setView('meals');
    if (action === 'open-shopping') setView('shopping');
    if (action === 'open-weather-settings') setView('settings');
    if (action === 'check-update') checkForPublishedVersion(true);
    if (action === 'reload-app') window.location.reload();
    if (action === 'export-backup') exportBackup();
    if (action === 'choose-restore') document.getElementById('restoreBackupInput')?.click();
    if (action === 'set-weather-location') setWeatherLocationFromInput();
    if (action === 'use-device-location') useDeviceLocation();
    if (action === 'refresh-weather') refreshWeather(true);
    if (action === 'add-event') openEventModal();
    if (action === 'edit-event') openEventModal(id);
    if (action === 'previous-week') { weekOffset -= 1; render(); }
    if (action === 'next-week') { weekOffset += 1; render(); }
    if (action === 'this-week') { weekOffset = 0; render(); }
    if (action === 'delete-event') deleteItem('events', id);
    if (action === 'toggle-chore') toggleItem('chores', id);
    if (action === 'delete-chore') deleteItem('chores', id);
    if (action === 'toggle-shopping') toggleItem('shopping', id);
    if (action === 'delete-shopping') deleteItem('shopping', id);
    if (action === 'delete-person') deletePerson(id);
    if (action === 'clear-shopping') {
      state.shopping = state.shopping.filter(item => !item.done);
      saveAndRender('Completed items cleared');
    }
    if (action === 'add-chore') addQuickItem('chores', 'add-chore-input');
    if (action === 'add-shopping') addQuickItem('shopping', 'add-shopping-input');
  }

  function onViewChange(event) {
    const target = event.target;
    if (target.dataset.action === 'restore-backup') {
      restoreBackupFromFile(target.files?.[0]);
      target.value = '';
      return;
    }
    if (target.dataset.action === 'assign-chore') {
      const item = state.chores.find(entry => String(entry.id) === String(target.dataset.id));
      if (item) {
        item.person = target.value;
        saveState();
      }
    }
    if (target.dataset.action === 'edit-meal') {
      state.meals[target.dataset.date] = target.value.trim();
      saveState();
    }
  }

  function onViewKeydown(event) {
    if (event.target.id === 'weatherLocationInput' && event.key === 'Enter') {
      event.preventDefault();
      setWeatherLocationFromInput();
      return;
    }
    const input = event.target.closest('[data-quick-action]');
    if (!input || event.key !== 'Enter') return;
    event.preventDefault();
    const list = input.dataset.quickAction === 'add-chore' ? 'chores' : 'shopping';
    addQuickItem(list, input.id);
  }

  function addQuickItem(listName, inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const title = input.value.trim();
    if (!title) {
      input.focus();
      return;
    }
    const item = { id: uid(), title, done: false };
    if (listName === 'chores') item.person = 'family';
    state[listName].push(item);
    saveAndRender(listName === 'chores' ? 'Chore added' : 'Item added');
  }

  function toggleItem(listName, id) {
    const item = state[listName].find(entry => String(entry.id) === String(id));
    if (!item) return;
    item.done = !item.done;
    saveAndRender();
  }

  function deleteItem(listName, id) {
    state[listName] = state[listName].filter(entry => String(entry.id) !== String(id));
    saveAndRender('Deleted');
  }

  function openEventModal(id = null) {
    const week = weekDates(weekOffset);
    eventForm.reset();
    editingEventId = id;
    const existing = id ? state.events.find(entry => String(entry.id) === String(id)) : null;

    if (existing) {
      const event = normaliseEvent(existing);
      modalTitle.textContent = 'Edit event';
      saveEventButton.textContent = 'Save changes';
      eventTitle.value = event.title;
      eventStartDate.value = event.startDate;
      eventEndDate.value = event.endDate === event.startDate ? '' : event.endDate;
      eventStartTime.value = event.startTime;
      eventEndTime.value = event.endTime;
      eventPerson.value = event.person;
      eventRepeats.checked = Boolean(event.repeats);
    } else {
      modalTitle.textContent = 'Add an event';
      saveEventButton.textContent = 'Add event';
      eventStartDate.value = currentView === 'calendar' ? week[0] : toISODate(new Date());
      eventEndDate.value = '';
      eventStartTime.value = '';
      eventEndTime.value = '';
      eventPerson.value = 'family';
      eventRepeats.checked = false;
    }

    eventEndDate.min = eventStartDate.value;
    modalBackdrop.classList.remove('hidden');
    window.setTimeout(() => eventTitle.focus(), 30);
  }

  function closeEventModal() {
    modalBackdrop.classList.add('hidden');
    editingEventId = null;
  }

  function addEvent(event) {
    event.preventDefault();
    const title = eventTitle.value.trim();
    if (!title || !eventStartDate.value) return;
    const endDate = eventEndDate.value || eventStartDate.value;
    if (endDate < eventStartDate.value) {
      showToast('End date must be after the start date');
      eventEndDate.focus();
      return;
    }
    if (eventStartTime.value && eventEndTime.value && endDate === eventStartDate.value && eventEndTime.value < eventStartTime.value) {
      showToast('End time must be after the start time');
      eventEndTime.focus();
      return;
    }
    const eventData = {
      title,
      startDate: eventStartDate.value,
      endDate,
      startTime: eventStartTime.value,
      endTime: eventEndTime.value,
      person: eventPerson.value,
      repeats: eventRepeats.checked
    };

    if (editingEventId) {
      const index = state.events.findIndex(entry => String(entry.id) === String(editingEventId));
      if (index !== -1) state.events[index] = { ...state.events[index], ...eventData };
      closeEventModal();
      saveAndRender('Event updated');
      return;
    }

    state.events.push({ id: uid(), ...eventData });
    closeEventModal();
    saveAndRender('Event added');
  }

  function eventsForDate(date) {
    const target = parseISODate(date);
    return state.events
      .filter(rawEvent => {
        const event = normaliseEvent(rawEvent);
        const start = parseISODate(event.startDate);
        const end = parseISODate(event.endDate);
        if (!event.repeats) return target >= start && target <= end;
        if (target < start) return false;
        const durationDays = Math.round((end - start) / DAY_MS);
        const daysSinceStart = Math.round((target - start) / DAY_MS);
        return daysSinceStart % 7 <= durationDays;
      })
      .map(normaliseEvent)
      .slice()
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  }

  function normaliseEvent(event) {
    const startDate = event.startDate || event.date;
    return {
      ...event,
      startDate,
      endDate: event.endDate || startDate,
      startTime: event.startTime ?? event.time ?? '',
      endTime: event.endTime ?? ''
    };
  }

  function eventTimeLabel(rawEvent, date) {
    const event = normaliseEvent(rawEvent);
    const isFirst = date === event.startDate;
    const isLast = date === event.endDate;
    const multiDay = event.startDate !== event.endDate;
    if (!event.startTime && !event.endTime) return multiDay ? (isFirst ? 'Starts today' : isLast ? 'Ends today' : 'All day') : 'All day';
    if (!multiDay) return event.endTime ? `${event.startTime || 'All day'}–${event.endTime}` : event.startTime;
    if (isFirst) return event.startTime ? `From ${event.startTime}` : 'Starts today';
    if (isLast) return event.endTime ? `Until ${event.endTime}` : 'Ends today';
    return 'All day';
  }

  function personFor(id) {
    return state.people.find(person => person.id === id) || state.people.find(person => person.id === 'family') || state.people[0];
  }

  function refreshPersonOptions() {
    if (!eventPerson) return;
    const current = eventPerson.value;
    eventPerson.innerHTML = state.people.map(person => `<option value="${person.id}">${escapeHTML(person.name)}</option>`).join('');
    if (state.people.some(person => person.id === current)) eventPerson.value = current;
  }

  function saveAndRender(message) {
    saveState();
    render();
    if (message) showToast(message);
  }

  async function setupServiceWorkerUpdates() {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    try {
      serviceWorkerRegistration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });

      if (serviceWorkerRegistration.waiting) showUpdateBanner();

      serviceWorkerRegistration.addEventListener('updatefound', () => {
        const worker = serviceWorkerRegistration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshingForUpdate) return;
        refreshingForUpdate = true;
        window.location.reload();
      });

      await serviceWorkerRegistration.update();
      await checkForPublishedVersion(false);
      window.setInterval(() => {
        serviceWorkerRegistration?.update().catch(() => {});
        checkForPublishedVersion(false);
      }, 15 * 60 * 1000);
    } catch (error) {
      console.warn('Update checks are unavailable', error);
    }
  }

  function showUpdateBanner() {
    updateBanner?.classList.remove('hidden');
    const status = document.getElementById('settingsUpdateStatus');
    if (status) status.textContent = 'Update ready';
  }

  function applyAvailableUpdate() {
    const waiting = serviceWorkerRegistration?.waiting;
    if (waiting) {
      updateNowButton.disabled = true;
      updateNowButton.textContent = 'Updating…';
      waiting.postMessage({ type: 'SKIP_WAITING' });
      return;
    }
    window.location.reload();
  }

  async function checkForPublishedVersion(showFeedback = false) {
    const status = document.getElementById('settingsUpdateStatus');
    if (status) status.textContent = 'Checking…';
    try {
      const response = await fetch(`./version.json?check=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Version file unavailable');
      const published = await response.json();
      const hasNewerVersion = compareVersions(published.version, APP.version) > 0;
      if (status) status.textContent = hasNewerVersion ? `v${published.version} available` : `Up to date (v${APP.version})`;
      if (hasNewerVersion) {
        await serviceWorkerRegistration?.update();
        showUpdateBanner();
      } else if (showFeedback) {
        showToast('Family Hub is up to date');
      }
    } catch (error) {
      if (status) status.textContent = 'Could not check while offline';
      if (showFeedback) showToast('Could not check for updates');
    }
  }

  function compareVersions(left = '0', right = '0') {
    const a = String(left).split('.').map(Number);
    const b = String(right).split('.').map(Number);
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (a[index] || 0) - (b[index] || 0);
      if (difference) return difference;
    }
    return 0;
  }

  function formatBuildDate(value) {
    const date = value ? new Date(`${value}T12:00:00`) : null;
    if (!date || Number.isNaN(date.getTime())) return value || 'Unknown';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  }

  function exportBackup() {
    const createdAt = new Date().toISOString();
    const backup = {
      app: APP.name,
      appVersion: APP.version,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt,
      data: structuredCloneSafe(state)
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const dateStamp = createdAt.slice(0, 10);
    link.href = URL.createObjectURL(blob);
    link.download = `family-hub-backup-${dateStamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    lastBackupAt = createdAt;
    window.FamilyHubStorage.setLastBackup(createdAt);
    render();
    showToast('Backup downloaded');
  }

  async function restoreBackupFromFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const restored = parsed?.data || parsed;
      const validation = validateBackupState(restored);
      if (!validation.valid) throw new Error(validation.message);
      const confirmed = window.confirm('Restore this backup? This will replace the family information currently stored on this tablet.');
      if (!confirmed) return;
      state = normaliseRestoredState(restored);
      refreshPersonOptions();
      saveState();
      render();
      showToast('Backup restored');
    } catch (error) {
      console.error('Could not restore backup', error);
      window.alert('That file could not be restored. Please choose a Family Hub backup file.');
    }
  }

  function validateBackupState(value) {
    if (!value || typeof value !== 'object') return { valid: false, message: 'Missing data' };
    if (!Array.isArray(value.people)) return { valid: false, message: 'Missing people' };
    if (!Array.isArray(value.events)) return { valid: false, message: 'Missing events' };
    if (!Array.isArray(value.chores)) return { valid: false, message: 'Missing chores' };
    if (!value.meals || typeof value.meals !== 'object' || Array.isArray(value.meals)) return { valid: false, message: 'Missing meals' };
    if (!Array.isArray(value.shopping)) return { valid: false, message: 'Missing shopping list' };
    return { valid: true };
  }

  function normaliseRestoredState(value) {
    const restored = structuredCloneSafe(value);
    restored.events = restored.events.map(normaliseEvent);
    restored.people = restored.people.length ? restored.people : structuredCloneSafe(DEFAULT_PEOPLE);
    if (!restored.people.some(person => person.id === 'family')) {
      restored.people.push(structuredCloneSafe(DEFAULT_PEOPLE.find(person => person.id === 'family')));
    }
    restored.weather = normaliseWeatherState(restored.weather);
    return restored;
  }

  function formatLastBackup() {
    const value = lastBackupAt;
    if (!value) return 'Not backed up yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function saveState() {
    window.FamilyHubStorage.setState(structuredCloneSafe(state)).catch(error => {
      console.error('Could not save Family Hub data', error);
      showToast('Could not save changes');
    });
    const status = document.getElementById('saveStatus');
    if (status) {
      status.textContent = 'Saved just now';
      window.setTimeout(() => { status.textContent = 'Saved on this tablet'; }, 1400);
    }
  }

  function normaliseLoadedState(stored) {
    try {
      if (!stored || !Array.isArray(stored.events) || !Array.isArray(stored.chores) || !stored.meals || !Array.isArray(stored.shopping)) {
        return structuredCloneSafe(seed);
      }
      const result = structuredCloneSafe(stored);
      result.events = result.events.map(normaliseEvent);
      result.people = Array.isArray(result.people) && result.people.length ? result.people : structuredCloneSafe(DEFAULT_PEOPLE);
      if (!result.people.some(person => person.id === 'ophelia')) {
        const familyIndex = result.people.findIndex(person => person.id === 'family');
        result.people.splice(familyIndex >= 0 ? familyIndex : result.people.length, 0, structuredCloneSafe(DEFAULT_PEOPLE.find(person => person.id === 'ophelia')));
      }
      result.weather = normaliseWeatherState(result.weather);
      return result;
    } catch {
      return structuredCloneSafe(seed);
    }
  }

  function showToast(message) {
    document.querySelector('.toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 1800);
  }

  async function installApp() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.classList.add('hidden');
  }

  function weekDates(offset) {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const weekday = (now.getDay() + 6) % 7;
    const monday = new Date(now.getTime() - weekday * DAY_MS + offset * 7 * DAY_MS);
    return Array.from({ length: 7 }, (_, index) => toISODate(new Date(monday.getTime() + index * DAY_MS)));
  }

  function formatWeekRange(start, end) {
    const first = parseISODate(start);
    const last = parseISODate(end);
    const sameMonth = first.getMonth() === last.getMonth();
    const firstText = new Intl.DateTimeFormat('en-GB', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' }).format(first);
    const lastText = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(last);
    return `${firstText}–${lastText}`;
  }

  function formatFriendlyDate(date) {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseISODate(date));
  }

  function toISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseISODate(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function addDaysISO(date, days) {
    const parsed = parseISODate(date);
    return toISODate(new Date(parsed.getTime() + days * DAY_MS));
  }

  function uid() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }


  function slugify(value) {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
  }

  function hexToSoftColour(hex) {
    const clean = String(hex).replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(clean)) return '#eeeafd';
    const rgb = [0, 2, 4].map(index => parseInt(clean.slice(index, index + 2), 16));
    const soft = rgb.map(value => Math.round(value + (255 - value) * 0.78));
    return `#${soft.map(value => value.toString(16).padStart(2, '0')).join('')}`;
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }
})();
