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
    },
    googleCalendar: {
      clientId: '',
      calendarId: 'primary',
      lastSyncAt: null,
      syncedCount: 0
    },
    household: {
      name: 'Allpress-Crawfords'
    },
    calendarBridge: {
      url: 'https://script.google.com/macros/s/AKfycbyO_nrXPu6fQkKNz25YxRxIkYDOLFbNlpqHq91rKObY9-S8mSTvfvzFFm8Z0cEV-CMXMA/exec',
      secret: '',
      intervalMinutes: 5,
      lastTestAt: null,
      connected: false
    }
  };

  let state = null;
  let lastBackupAt = null;
  let storageMode = 'IndexedDB';
  let currentView = 'today';
  let weekOffset = 0;
  let familyRange = 'today';
  let deferredInstallPrompt = null;
  let editingEventId = null;
  let googleTokenClient = null;
  let googleAccessToken = null;
  let googleSyncInProgress = false;
  let googleAccessTokenExpiresAt = 0;
  let googleAutoSyncTimer = null;
  let calendarBridgeSyncTimer = null;
  let calendarBridgeSyncInProgress = false;
  let calendarBridgeLastError = '';
  let calendarBridgeLastAttemptAt = null;
  const GOOGLE_AUTO_SYNC_MS = 15 * 60 * 1000;

  const viewRoot = document.getElementById('viewRoot');
  const viewTitle = document.getElementById('viewTitle');
  const fullDate = document.getElementById('fullDate');
  const clock = document.getElementById('clock');
  const mainNav = document.getElementById('mainNav');
  const navToggle = document.getElementById('navToggle');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const eventForm = document.getElementById('eventForm');
  const eventTitle = document.getElementById('eventTitle');
  const eventStartDate = document.getElementById('eventStartDate');
  const eventEndDate = document.getElementById('eventEndDate');
  const eventStartTime = document.getElementById('eventStartTime');
  const eventEndTime = document.getElementById('eventEndTime');
  const eventPerson = document.getElementById('eventPerson');
  const eventRepeats = document.getElementById('eventRepeats');
  const eventSyncGoogle = document.getElementById('eventSyncGoogle');
  const installButton = document.getElementById('installButton');
  const modalTitle = document.getElementById('modalTitle');
  const saveEventButton = document.getElementById('saveEventButton');
  const updateBanner = document.getElementById('updateBanner');
  const updateNowButton = document.getElementById('updateNowButton');
  const appVersion = document.getElementById('appVersion');
  const homeHeaderActions = document.getElementById('homeHeaderActions');

  initialise();

  async function initialise() {
    const storageResult = await window.FamilyHubStorage.initialise(structuredCloneSafe(seed));
    state = normaliseLoadedState(storageResult.state);
    lastBackupAt = storageResult.lastBackup || null;
    storageMode = storageResult.mode || 'IndexedDB';
    window.FamilyHubPublic = Object.freeze({
      getState: () => structuredCloneSafe(state),
      getEventIcon: title => getEventIcon(title),
      showToast: message => showToast(message),
      setView: view => setView(view),
      getCurrentView: () => currentView
    });
    document.title = `${APP.name} v${APP.version}`;
    if (appVersion) appVersion.textContent = `v${APP.version}`;
    refreshPersonOptions();
    mainNav.addEventListener('click', onNavigation);
    navToggle?.addEventListener('click', toggleNavigation);
    document.addEventListener('click', event => {
      if (!document.body.classList.contains('nav-expanded')) return;
      if (event.target.closest('.sidebar')) return;
      setNavigationExpanded(false);
    });
    viewRoot.addEventListener('click', onViewClick);
    homeHeaderActions?.addEventListener('click', onViewClick);
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
    if (state.calendarBridge?.connected) {
      startCalendarBridgeAutoSync();
      syncCalendarBridge({ silent: true });
    } else {
      startGoogleAutoSync();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (state.calendarBridge?.connected) syncCalendarBridge({ silent: true });
      else maybeAutoSyncGoogleCalendar();
    });
    window.addEventListener('focus', () => {
      if (state.calendarBridge?.connected) syncCalendarBridge({ silent: true, onlyIfDue: true });
    });
    window.addEventListener('pageshow', () => {
      if (state.calendarBridge?.connected) syncCalendarBridge({ silent: true, onlyIfDue: true });
    });
    window.addEventListener('online', () => {
      calendarBridgeLastError = '';
      if (state.calendarBridge?.connected) syncCalendarBridge({ silent: true });
      render();
    });
    window.addEventListener('offline', () => render());
  }

  function onNavigation(event) {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    setView(button.dataset.view);
    if (window.matchMedia('(max-width: 1500px)').matches) setNavigationExpanded(false);
  }

  function toggleNavigation(event) {
    event.stopPropagation();
    setNavigationExpanded(!document.body.classList.contains('nav-expanded'));
  }

  function setNavigationExpanded(expanded) {
    document.body.classList.toggle('nav-expanded', expanded);
    if (navToggle) {
      navToggle.setAttribute('aria-expanded', String(expanded));
      navToggle.setAttribute('aria-label', expanded ? 'Collapse navigation' : 'Expand navigation');
      navToggle.textContent = expanded ? '‹' : '›';
    }
  }

  function setView(view) {
    currentView = view;
    document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    render();
  }

  function render() {
    const isHome = currentView === 'today';
    const isSettings = currentView === 'settings';
    const isFamily = currentView === 'people';
    document.body.classList.toggle('home-dashboard-active', isHome);
    document.body.classList.toggle('settings-page-active', isSettings);
    document.body.classList.toggle('family-page-active', isFamily);
    if (!isHome && homeHeaderActions) {
      homeHeaderActions.innerHTML = '';
      homeHeaderActions.classList.add('hidden');
    }
    updateViewTitle();
    if (isHome) renderToday();
    if (currentView === 'calendar') renderCalendar();
    if (currentView === 'chores') renderChores();
    if (currentView === 'meals') renderMeals();
    if (currentView === 'shopping') renderShopping();
    if (currentView === 'people') renderPeople();
    if (currentView === 'settings') renderSettings();
  }

  function updateViewTitle() {
    const period = getDayPeriod();
    document.body.dataset.dayPeriod = period.id;
    const familyName = String(state?.household?.name || 'Family').trim() || 'Family';
    const titles = { today: `${period.greeting}, ${familyName} ${period.icon}`, calendar: 'Calendar', chores: 'Chores', meals: 'Meals', shopping: 'Shopping', people: 'Family', settings: 'Settings' };
    viewTitle.textContent = titles[currentView] || 'Family Hub';
  }

  function getDayPeriod() {
    const hour = new Date().getHours();
    if (hour < 11) return { id: 'morning', greeting: 'Good morning', icon: '☀️', focus: 'Here’s what’s ahead today' };
    if (hour < 17) return { id: 'daytime', greeting: 'Good afternoon', icon: '🌤️', focus: 'Here’s what’s happening today' };
    return { id: 'evening', greeting: 'Good evening', icon: '🌙', focus: 'Tonight and tomorrow at a glance' };
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
    const dayPeriod = getDayPeriod();

    renderHomeHeaderActions();

    viewRoot.innerHTML = `
      <div class="home-dashboard-v2 home-${dayPeriod.id}" data-day-period="${dayPeriod.id}">
        <div class="home-day-focus">${escapeHTML(dayPeriod.focus)}</div>
        <section class="home-card home-today-card">
          <div class="home-card-heading">
            <div>
              <div class="home-section-label home-blue">Today</div>
              <div class="home-card-subtitle">${escapeHTML(formatFriendlyDate(today))}</div>
            </div>
            <span class="home-count-pill">${todayEvents.length}</span>
          </div>
          <div class="home-today-events">
            ${todayEvents.length
              ? todayEvents.slice(0, 3).map(event => homeTodayEventHTML(event, today)).join('')
              : '<div class="home-empty-state"><strong>Nothing scheduled today</strong><span>A lovely clear day ahead.</span></div>'}
          </div>
          ${homeTimelineHTML(todayEvents, meal)}
        </section>

        <section class="home-card home-week-card">
          <div class="home-card-heading">
            <div>
              <div class="home-section-label home-purple">This week</div>
              <div class="home-card-subtitle">${weekEventCount} ${weekEventCount === 1 ? 'event' : 'events'} planned</div>
            </div>
            <button class="home-text-link" data-action="open-calendar" type="button">View calendar →</button>
          </div>
          <div class="home-week-list">
            ${homeWeekDates(week, today).map(date => homeWeekRowHTML(date)).join('')}
          </div>
        </section>

        ${homeWeatherCardHTML()}

        <section class="home-card home-dinner-card" data-action="open-meals" role="button" tabindex="0">
          <div class="home-dinner-copy">
            <div class="home-section-label home-orange">Tonight’s dinner</div>
            <div class="home-dinner-name">${escapeHTML(meal)}</div>
            <div class="home-card-subtitle">Tap to update the meal plan</div>
          </div>
          <div class="home-dinner-icon" aria-hidden="true">🍽️</div>
        </section>

        <section class="home-card home-people-card">
          <div class="home-card-heading home-compact-heading">
            <div>
              <div class="home-section-label home-blue">People</div>
              <div class="home-card-subtitle">Today at a glance</div>
            </div>
            <button class="home-text-link" data-action="open-calendar" type="button">Calendar →</button>
          </div>
          <div class="home-people-grid">
            ${homeDisplayPeople().map(person => homePersonTileHTML(person, today)).join('')}
          </div>
        </section>

        <section class="home-card home-chores-card">
          <div class="home-card-heading home-compact-heading">
            <div class="home-section-label home-green">Chores</div>
            <span class="home-count-pill home-green-pill">${openChores.length}</span>
          </div>
          <div class="home-mini-list">
            ${openChores.length
              ? openChores.slice(0, 3).map(homeChoreRowHTML).join('')
              : '<div class="home-empty-mini">Everything is done ✓</div>'}
          </div>
          <button class="home-text-link home-card-footer-link" data-action="open-chores" type="button">View all chores →</button>
        </section>

        <section class="home-card home-shopping-card">
          <div class="home-card-heading home-compact-heading">
            <div class="home-section-label home-blue">Shopping</div>
            <span class="home-count-pill">${remainingShopping.length}</span>
          </div>
          <div class="home-mini-list home-shopping-list">
            ${remainingShopping.length
              ? remainingShopping.slice(0, 4).map(homeShoppingRowHTML).join('')
              : '<div class="home-empty-mini">Nothing on the list</div>'}
          </div>
          <button class="home-text-link home-card-footer-link" data-action="open-shopping" type="button">View full list →</button>
        </section>
      </div>`;
  }

  function renderHomeHeaderActions() {
    if (!homeHeaderActions) return;
    const bridgeConnected = Boolean(state.calendarBridge?.connected);
    const googleConnected = Boolean(state.googleCalendar?.lastSyncAt);
    homeHeaderActions.classList.remove('hidden');
    homeHeaderActions.innerHTML = `
      ${bridgeConnected
        ? `<div class="home-sync-control"><button class="home-header-button home-header-button-secondary" data-action="sync-google-calendar" type="button">${calendarBridgeSyncInProgress ? 'Syncing…' : '↻ Sync'}</button><span class="sync-status-text ${escapeHTML(calendarBridgeStatusClass())}">${escapeHTML(formatCalendarBridgeStatus())}</span></div>`
        : (googleConnected ? `<div class="home-sync-control"><button class="home-header-button home-header-button-secondary" data-action="sync-google-calendar" type="button">${googleTokenUsable() ? '↻ Sync' : '↻ Reconnect'}</button><span>${escapeHTML(formatRelativeGoogleSyncDate())}</span></div>` : '')}
      <button class="home-header-button home-header-button-primary" data-action="add-event" type="button">＋ Add event</button>`;
  }

  function homeTodayEventHTML(event, date) {
    const person = primaryPersonForEvent(event);
    return `
      <article class="home-today-event" style="--person-colour:${person.colour};--person-chip:${person.chip}">
        <div class="home-event-symbol" aria-hidden="true">${escapeHTML(homeEventSymbol(event.title))}</div>
        <div class="home-event-copy">
          <div class="home-event-time">${escapeHTML(eventTimeLabel(event, date))}</div>
          <div class="home-event-title">${escapeHTML(event.title)}</div>
          <div class="home-event-person">${escapeHTML(eventPeopleLabel(event))}${event.source === 'google' ? ' · Google' : ''}</div>
        </div>
      </article>`;
  }

  const EVENT_ICON_RULES = [
    // Travel, holidays and days out
    { icon: '🏖️', keywords: ['beach holiday', 'seaside holiday', 'beach', 'seaside', 'coast', 'coastal'] },
    { icon: '🧳', keywords: ['holiday', 'vacation', 'weekend away', 'city break', 'staycation', 'getaway', 'trip away'] },
    { icon: '✈️', keywords: ['flight', 'airport', 'flying', 'departure', 'arrivals', 'boarding', 'terminal'] },
    { icon: '🚆', keywords: ['train', 'railway', 'rail trip', 'station'] },
    { icon: '🚗', keywords: ['road trip', 'drive to', 'driving', 'car journey', 'mot', 'car service'] },
    { icon: '🚌', keywords: ['school bus', 'coach trip', 'bus'] },
    { icon: '⛴️', keywords: ['ferry', 'boat trip', 'cruise', 'sailing trip'] },
    { icon: '🏕️', keywords: ['camping', 'campsite', 'camp'] },
    { icon: '🏨', keywords: ['hotel', 'check in', 'check-in', 'accommodation', 'airbnb'] },
    { icon: '🗺️', keywords: ['travel', 'tour', 'sightseeing', 'day trip', 'excursion'] },

    // Health, medical and wellbeing
    { icon: '🦷', keywords: ['dentist', 'dental', 'orthodontist', 'tooth', 'teeth'] },
    { icon: '👓', keywords: ['optician', 'eye test', 'ophthalmologist', 'glasses'] },
    { icon: '🩺', keywords: ['doctor', 'doctors', 'gp appointment', 'gp ', 'hospital', 'clinic', 'consultant', 'medical', 'check-up', 'checkup', 'health visitor'] },
    { icon: '💉', keywords: ['vaccination', 'vaccine', 'immunisation', 'immunization', 'jab', 'injection'] },
    { icon: '💊', keywords: ['pharmacy', 'prescription', 'medicine', 'medication'] },
    { icon: '🧠', keywords: ['therapy', 'therapist', 'counselling', 'counseling', 'mental health', 'psychologist'] },
    { icon: '🦴', keywords: ['physio', 'physiotherapy', 'chiropractor', 'osteopath', 'sports massage'] },
    { icon: '🧘', keywords: ['yoga', 'meditation', 'mindfulness', 'pilates', 'wellbeing', 'wellness'] },
    { icon: '💇', keywords: ['haircut', 'hairdresser', 'barber', 'hair appointment', 'salon'] },
    { icon: '💅', keywords: ['nails', 'manicure', 'pedicure', 'beauty appointment', 'spa'] },

    // Babies, children, school and learning
    { icon: '👶', keywords: ['baby group', 'health visitor', 'weigh in', 'weigh-in', 'baby class', 'baby sensory'] },
    { icon: '🍼', keywords: ['feeding', 'bottle', 'milk feed', 'weaning'] },
    { icon: '😴', keywords: ['nap', 'bedtime', 'sleep'] },
    { icon: '🎒', keywords: ['school', 'nursery', 'preschool', 'pre-school', 'kindergarten', 'school run', 'drop off', 'drop-off', 'pick up', 'pick-up'] },
    { icon: '📚', keywords: ['homework', 'study', 'revision', 'reading', 'library', 'book club', 'lesson'] },
    { icon: '🧑‍🏫', keywords: ['parents evening', 'parent evening', 'teacher meeting', 'school meeting', 'pta'] },
    { icon: '📝', keywords: ['exam', 'test', 'assessment', 'interview', 'application'] },
    { icon: '🎓', keywords: ['graduation', 'degree', 'university', 'college'] },
    { icon: '🧸', keywords: ['playgroup', 'soft play', 'play date', 'playdate', 'toddler group'] },

    // Work and professional life
    { icon: '🏢', keywords: ['office', 'work from office', 'in the office'] },
    { icon: '🏠', keywords: ['work from home', 'working from home', 'wfh', 'remote work'] },
    { icon: '💼', keywords: ['work', 'client meeting', 'business meeting', 'conference call', 'project meeting'] },
    { icon: '🖥️', keywords: ['zoom', 'teams call', 'video call', 'webinar', 'online meeting'] },
    { icon: '🤝', keywords: ['meeting', 'catch up', 'catch-up', 'one to one', '1:1', 'appointment'] },
    { icon: '🎤', keywords: ['presentation', 'talk', 'keynote', 'speech', 'panel'] },
    { icon: '🏛️', keywords: ['conference', 'convention', 'summit', 'workshop'] },
    { icon: '📊', keywords: ['review', 'planning session', 'strategy', 'reporting'] },
    { icon: '💷', keywords: ['payday', 'bank', 'mortgage', 'financial adviser', 'accountant', 'tax'] },

    // Sports and exercise
    { icon: '🏊', keywords: ['swimming', 'swim', 'pool', 'aqua class'] },
    { icon: '⚽', keywords: ['football', 'soccer', 'five-a-side', '5-a-side', 'futsal'] },
    { icon: '🏉', keywords: ['rugby'] },
    { icon: '🏏', keywords: ['cricket'] },
    { icon: '🎾', keywords: ['tennis'] },
    { icon: '🏸', keywords: ['badminton'] },
    { icon: '🏀', keywords: ['basketball'] },
    { icon: '🏐', keywords: ['volleyball'] },
    { icon: '🏑', keywords: ['hockey'] },
    { icon: '⛳', keywords: ['golf'] },
    { icon: '🏓', keywords: ['table tennis', 'ping pong', 'ping-pong'] },
    { icon: '🥊', keywords: ['boxing', 'boxercise'] },
    { icon: '🥋', keywords: ['karate', 'judo', 'taekwondo', 'martial arts', 'jiu jitsu', 'ju-jitsu'] },
    { icon: '🏃', keywords: ['running', 'run club', 'jog', 'marathon', 'parkrun', 'race'] },
    { icon: '🚴', keywords: ['cycling', 'bike ride', 'bicycle', 'spin class', 'spinning'] },
    { icon: '🏋️', keywords: ['gym', 'weights', 'weight training', 'personal trainer', 'pt session', 'fitness'] },
    { icon: '🤸', keywords: ['gymnastics', 'trampoline', 'acrobatics'] },
    { icon: '⛸️', keywords: ['ice skating', 'skating'] },
    { icon: '🎿', keywords: ['skiing', 'snowboarding', 'ski trip'] },
    { icon: '🏇', keywords: ['horse riding', 'riding lesson', 'equestrian'] },
    { icon: '🧗', keywords: ['climbing', 'bouldering'] },
    { icon: '🏎️', keywords: ['formula 1', 'f1', 'grand prix', 'motorsport', 'go kart', 'go-kart', 'karting'] },
    { icon: '🎯', keywords: ['darts', 'archery'] },
    { icon: '🎳', keywords: ['bowling'] },
    { icon: '🎱', keywords: ['snooker', 'pool match', 'billiards'] },
    { icon: '🚶', keywords: ['walk', 'walking', 'hike', 'hiking', 'ramble'] },

    // Music, arts and hobbies
    { icon: '🎵', keywords: ['music lesson', 'music class', 'choir', 'singing'] },
    { icon: '🎸', keywords: ['guitar'] },
    { icon: '🎹', keywords: ['piano', 'keyboard lesson'] },
    { icon: '🥁', keywords: ['drums', 'drumming'] },
    { icon: '🎻', keywords: ['violin', 'orchestra'] },
    { icon: '💃', keywords: ['dance', 'dancing', 'ballet', 'tap class', 'salsa'] },
    { icon: '🎭', keywords: ['theatre', 'theater', 'drama', 'play rehearsal', 'pantomime'] },
    { icon: '🎨', keywords: ['art', 'painting', 'drawing', 'craft', 'pottery', 'ceramics'] },
    { icon: '📷', keywords: ['photography', 'photo shoot', 'photoshoot', 'family photos'] },
    { icon: '🎮', keywords: ['gaming', 'video games', 'games night'] },
    { icon: '🧩', keywords: ['puzzle', 'lego', 'board game'] },
    { icon: '🌱', keywords: ['gardening', 'allotment', 'garden centre', 'planting'] },

    // Celebrations and social events
    { icon: '🎂', keywords: ['birthday', 'bday'] },
    { icon: '💒', keywords: ['wedding', 'marriage', 'civil ceremony'] },
    { icon: '💍', keywords: ['engagement', 'anniversary'] },
    { icon: '🎉', keywords: ['party', 'celebration', 'hen do', 'stag do', 'baby shower'] },
    { icon: '🎄', keywords: ['christmas', 'xmas', 'santa', 'nativity'] },
    { icon: '🐣', keywords: ['easter', 'egg hunt'] },
    { icon: '🎃', keywords: ['halloween', 'trick or treat'] },
    { icon: '🎆', keywords: ['fireworks', 'bonfire night', 'new year', 'nye'] },
    { icon: '💐', keywords: ['mothers day', "mother's day", 'fathers day', "father's day"] },
    { icon: '☕', keywords: ['coffee', 'café', 'cafe', 'coffee morning'] },
    { icon: '🍻', keywords: ['drinks', 'pub', 'bar'] },
    { icon: '🍽️', keywords: ['dinner', 'lunch', 'breakfast', 'brunch', 'restaurant', 'meal out', 'supper'] },
    { icon: '🧺', keywords: ['picnic'] },
    { icon: '👨‍👩‍👧‍👦', keywords: ['family day', 'family time', 'family visit', 'visit family'] },
    { icon: '🏡', keywords: ['friends over', 'visitors', 'guests', 'at home'] },

    // Entertainment and outings
    { icon: '🎬', keywords: ['cinema', 'movie', 'film'] },
    { icon: '🎟️', keywords: ['tickets', 'show', 'concert', 'gig', 'festival'] },
    { icon: '🏟️', keywords: ['stadium', 'match day', 'matchday'] },
    { icon: '🏛️', keywords: ['museum', 'gallery', 'exhibition'] },
    { icon: '🦁', keywords: ['zoo', 'safari park'] },
    { icon: '🐠', keywords: ['aquarium', 'sea life'] },
    { icon: '🎢', keywords: ['theme park', 'amusement park', 'funfair'] },
    { icon: '🌳', keywords: ['park', 'national trust', 'country park'] },
    { icon: '🏰', keywords: ['castle', 'historic house'] },
    { icon: '📖', keywords: ['story time', 'storytime', 'book signing'] },

    // Home, errands and practical appointments
    { icon: '🛒', keywords: ['shopping', 'supermarket', 'groceries', 'food shop'] },
    { icon: '📦', keywords: ['delivery', 'parcel', 'package', 'collection'] },
    { icon: '🔧', keywords: ['plumber', 'electrician', 'builder', 'repair', 'maintenance', 'handyman'] },
    { icon: '🏠', keywords: ['estate agent', 'house viewing', 'viewing', 'survey', 'home appointment'] },
    { icon: '🧹', keywords: ['cleaning', 'cleaner', 'tidy up', 'housework'] },
    { icon: '🧺', keywords: ['laundry', 'washing', 'dry cleaning'] },
    { icon: '🗑️', keywords: ['bins', 'bin day', 'recycling', 'rubbish'] },
    { icon: '🐕', keywords: ['dog walk', 'dog groomer', 'dog grooming', 'vet', 'veterinary'] },
    { icon: '🐈', keywords: ['cat sitter', 'cat appointment'] },
    { icon: '📮', keywords: ['post office', 'post parcel'] },
    { icon: '🏦', keywords: ['bank appointment', 'building society'] },
    { icon: '⚖️', keywords: ['solicitor', 'lawyer', 'legal appointment', 'court'] },
    { icon: '🗳️', keywords: ['vote', 'voting', 'election'] },
    { icon: '⛪', keywords: ['church', 'christening', 'baptism', 'mass', 'service'] },
    { icon: '🕯️', keywords: ['funeral', 'memorial', 'remembrance'] },

    // General status and reminders
    { icon: '📞', keywords: ['phone call', 'call with', 'ring '] },
    { icon: '📧', keywords: ['email', 'send email'] },
    { icon: '⏰', keywords: ['reminder', 'deadline', 'due date'] },
    { icon: '📅', keywords: ['appointment', 'event'] }
  ];

  function normaliseEventIconText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, "'")
      .replace(/[^a-z0-9£&+:' -]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function homeEventSymbol(title) {
    const text = ` ${normaliseEventIconText(title)} `;
    const match = EVENT_ICON_RULES.find(rule => rule.keywords.some(keyword => {
      const normalisedKeyword = normaliseEventIconText(keyword);
      return normalisedKeyword.length <= 2
        ? text.includes(` ${normalisedKeyword} `)
        : text.includes(normalisedKeyword);
    }));
    return match?.icon || '📅';
  }

  function homeTimelineHTML(events) {
    const markers = events
      .filter(event => event.startTime)
      .slice(0, 4)
      .map(event => ({
        label: event.title,
        time: event.startTime,
        colour: primaryPersonForEvent(event).colour,
        position: homeTimelinePosition(event.startTime)
      }))
      .sort((a, b) => a.position - b.position);

    if (!markers.length) return '<div class="home-timeline home-timeline-empty"><span>No timed events today</span></div>';

    let previousPosition = -100;
    let previousLane = 1;
    markers.forEach(marker => {
      const isClose = marker.position - previousPosition < 21;
      marker.lane = isClose ? (previousLane === 0 ? 1 : 0) : 0;
      previousPosition = marker.position;
      previousLane = marker.lane;
    });

    return `
      <div class="home-timeline" aria-label="Today timeline">
        <div class="home-timeline-track"></div>
        ${markers.map(item => `
          <div class="home-timeline-marker home-timeline-lane-${item.lane}" style="--marker-position:${item.position}%;--marker-colour:${item.colour}">
            <i></i>
            <span class="home-timeline-caption">
              <span class="home-timeline-time">${escapeHTML(item.time)}</span>
              <span class="home-timeline-label">${escapeHTML(item.label)}</span>
            </span>
          </div>`).join('')}
      </div>`;
  }

  function homeTimelinePosition(time) {
    const [hour, minute] = String(time || '12:00').split(':').map(Number);
    const minutes = (hour * 60) + (minute || 0);
    const start = 8 * 60;
    const end = 21 * 60;
    return Math.max(4, Math.min(96, ((minutes - start) / (end - start)) * 100));
  }

  function homeWeekDates(week, today) {
    const upcoming = week.filter(date => date !== today && date >= today);
    const earlier = week.filter(date => date !== today && date < today);
    return [...upcoming, ...earlier].slice(0, 6);
  }

  function homeWeekRowHTML(date) {
    const events = eventsForDate(date);
    const parsed = parseISODate(date);
    const dayName = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(parsed);
    const dateLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(parsed);
    const meal = state.meals[date];
    return `
      <article class="home-week-row">
        <div class="home-week-date"><strong>${escapeHTML(dayName)}</strong><span>${escapeHTML(dateLabel)}</span></div>
        <div class="home-week-events">
          ${events.length
            ? events.slice(0, 2).map(event => {
              const person = primaryPersonForEvent(event);
              return `<div class="home-week-event"><i style="background:${person.colour}"></i><span><strong>${escapeHTML(eventTimeLabel(event, date))}</strong> ${escapeHTML(event.title)}</span></div>`;
            }).join('')
            : '<div class="home-week-empty">Nothing planned</div>'}
          ${events.length > 2 ? `<div class="home-week-more">＋${events.length - 2} more</div>` : ''}
          ${!events.length && meal ? `<div class="home-week-meal">Dinner · ${escapeHTML(meal)}</div>` : ''}
        </div>
      </article>`;
  }

  function homeWeatherCardHTML() {
    const weather = normaliseWeatherState(state.weather);
    if (!hasWeatherLocation()) {
      return `
        <section class="home-card home-weather-card home-weather-empty" data-action="open-weather-settings" role="button" tabindex="0">
          <div class="home-section-label home-orange">Weather</div>
          <div class="home-weather-empty-copy"><span aria-hidden="true">☀</span><strong>Add your location</strong><small>Set it once in Settings.</small></div>
        </section>`;
    }

    const forecast = weather.forecast;
    if (!forecast?.current) {
      return `
        <section class="home-card home-weather-card">
          <div class="home-card-heading home-compact-heading"><div class="home-section-label home-orange">Weather</div><button class="home-icon-button" data-action="refresh-weather" type="button" aria-label="Refresh weather">↻</button></div>
          <div class="home-weather-empty-copy"><strong>Loading the latest forecast…</strong><small>${escapeHTML(weather.locationName || 'Current location')}</small></div>
        </section>`;
    }

    const current = forecast.current;
    const daily = Array.isArray(forecast.daily) ? forecast.daily.slice(0, 4) : [];
    const condition = weatherCondition(current.code, current.isDay);
    return `
      <section class="home-card home-weather-card">
        <div class="home-card-heading home-compact-heading">
          <div class="home-section-label home-orange">Weather</div>
          <button class="home-icon-button" data-action="refresh-weather" type="button" aria-label="Refresh weather">↻</button>
        </div>
        <div class="home-weather-current">
          <div class="home-weather-icon" aria-hidden="true">${condition.icon}</div>
          <div class="home-weather-temp">${Math.round(current.temperature)}°</div>
          <div class="home-weather-copy"><strong>${escapeHTML(weather.locationName || 'Current location')}</strong><span>${escapeHTML(condition.label)}</span><small>Feels like ${Math.round(current.apparentTemperature)}°</small></div>
        </div>
        <div class="home-weather-days">
          ${daily.map(day => {
            const dayCondition = weatherCondition(day.code, true);
            return `<div class="home-weather-day"><strong>${escapeHTML(day.label)}</strong><span aria-hidden="true">${dayCondition.icon}</span><small>${Math.round(day.max)}° / ${Math.round(day.min)}°</small></div>`;
          }).join('')}
        </div>
      </section>`;
  }

  function homeDisplayPeople() {
    const individuals = state.people.filter(person => String(person.id).toLowerCase() !== 'family');
    const selected = individuals.slice(0, 4);
    if (selected.length < 4) {
      const family = state.people.find(person => String(person.id).toLowerCase() === 'family');
      if (family) selected.push(family);
    }
    return selected.slice(0, 4);
  }

  function homePersonTileHTML(person, date) {
    const event = eventsForDate(date).find(item => eventIncludesPerson(item, person.id));
    const initials = String(person.name || '?').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    return `
      <article class="home-person-tile" style="--person-colour:${person.colour};--person-chip:${person.chip}">
        <div class="home-person-avatar">${escapeHTML(initials)}</div>
        <div class="home-person-name">${escapeHTML(person.name)}</div>
        <div class="home-person-divider"></div>
        ${event
          ? `<div class="home-person-event"><strong>${escapeHTML(event.title)}</strong><span>${escapeHTML(eventTimeLabel(event, date))}</span></div>`
          : '<div class="home-person-event home-person-free"><strong>No events</strong><span>Enjoy your day!</span></div>'}
      </article>`;
  }

  function homeChoreRowHTML(item) {
    const person = personFor(item.person);
    return `
      <div class="home-mini-row">
        <button class="home-mini-check" data-action="toggle-chore" data-id="${item.id}" type="button" aria-label="Complete ${escapeHTML(item.title)}">✓</button>
        <div><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(person.name)}</span></div>
      </div>`;
  }

  function homeShoppingRowHTML(item) {
    return `<div class="home-mini-row home-shopping-row"><i></i><strong>${escapeHTML(item.title)}</strong></div>`;
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
    const person = primaryPersonForEvent(event);
    return `
      <article class="event-card" style="--event-colour:${person.colour}">
        <span class="event-time">${escapeHTML(eventTimeLabel(event, date))}</span>
        <span class="event-title" title="${escapeHTML(event.title)}">${escapeHTML(event.title)}</span>
        <span class="event-people-chips">${eventPeopleChipsHTML(event)}</span>
        <div class="event-actions">${event.source === 'google' ? '<span class="google-event-badge">Google</span>' : '<span class="local-event-badge">Local</span>'}<button class="tiny-button" data-action="edit-event" data-id="${event.id}" type="button">Edit</button><button class="tiny-button" data-action="delete-event" data-id="${event.id}" type="button">Delete</button></div>
      </article>`;
  }

  function eventCardHTML(event, date = toISODate(new Date())) {
    const person = primaryPersonForEvent(event);
    return `
      <article class="event-card" style="--event-colour:${person.colour}">
        <span class="event-time">${escapeHTML(eventTimeLabel(event, date))}</span>
        <span class="event-title">${escapeHTML(event.title)}</span>
        <span class="event-people-chips">${eventPeopleChipsHTML(event)}</span>
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
    const dates = familyRangeDates();
    const rangeLabel = familyRange === 'today' ? 'Today' : familyRange === 'tomorrow' ? 'Tomorrow' : 'This week';
    const displayPeople = state.people.filter(person => person.id !== 'family');
    viewRoot.innerHTML = `
      <div class="family-page">
        <section class="card family-schedule-card">
          <div class="family-page-heading">
            <div>
              <div class="card-title">Family schedule</div>
              <div class="card-subtitle">See what everyone has planned, organised by person rather than by day.</div>
            </div>
            <button class="primary-button" data-action="add-event" type="button">＋ Add event</button>
          </div>
          <div class="family-range-tabs" role="tablist" aria-label="Family schedule range">
            ${['today', 'tomorrow', 'week'].map(range => `<button class="family-range-tab ${familyRange === range ? 'active' : ''}" data-action="family-range" data-range="${range}" type="button">${range === 'today' ? 'Today' : range === 'tomorrow' ? 'Tomorrow' : 'This week'}</button>`).join('')}
          </div>
          <div class="family-person-columns">
            ${displayPeople.map(person => familyPersonScheduleHTML(person, dates, rangeLabel)).join('')}
          </div>
          ${state.people.some(person => person.id === 'family') ? familySharedScheduleHTML(dates, rangeLabel) : ''}
        </section>

        <section class="card family-members-card">
          <div class="card-heading">
            <div>
              <div class="card-title">Manage family members</div>
              <div class="card-subtitle">People can now be assigned to the same event together.</div>
            </div>
          </div>
          <div class="people-grid">
            ${state.people.map(person => `
              <article class="person-card">
                <div class="person-avatar" style="background:${person.colour}">${escapeHTML(person.name.slice(0, 1).toUpperCase())}</div>
                <div class="person-card-copy">
                  <strong>${escapeHTML(person.name)}</strong>
                  <span>${person.id === 'family' ? 'Shared household events' : 'Personal calendar colour'}</span>
                </div>
                ${person.id === 'family' ? '' : `<button class="delete-button" data-action="delete-person" data-id="${person.id}" type="button" aria-label="Delete ${escapeHTML(person.name)}">×</button>`}
              </article>`).join('')}
          </div>
          <form id="addPersonForm" class="add-person-form">
            <label><span>Name</span><input id="newPersonName" autocomplete="off" placeholder="Add a family member" required></label>
            <label><span>Colour</span><input id="newPersonColour" type="color" value="#8f7cf2" aria-label="Choose calendar colour"></label>
            <button class="primary-button" type="submit">＋ Add person</button>
          </form>
        </section>
      </div>`;
    document.getElementById('addPersonForm')?.addEventListener('submit', addPerson);
  }

  function familyRangeDates() {
    const today = toISODate(new Date());
    if (familyRange === 'tomorrow') return [addDaysISO(today, 1)];
    if (familyRange === 'week') return Array.from({ length: 7 }, (_, index) => addDaysISO(today, index));
    return [today];
  }

  function familyPersonScheduleHTML(person, dates, rangeLabel) {
    const entries = dates.flatMap(date => eventsForDate(date)
      .filter(event => eventIncludesPerson(event, person.id))
      .map(event => ({ event, date })));
    return `
      <article class="family-person-column" style="--person-colour:${person.colour};--person-chip:${person.chip}">
        <div class="family-person-heading">
          <div class="person-avatar">${escapeHTML(person.name.slice(0, 1).toUpperCase())}</div>
          <div><strong>${escapeHTML(person.name)}</strong><span>${escapeHTML(rangeLabel)} · ${entries.length} ${entries.length === 1 ? 'event' : 'events'}</span></div>
        </div>
        <div class="family-person-events">
          ${entries.length ? entries.map(({ event, date }) => familyScheduleEventHTML(event, date)).join('') : '<div class="family-no-events">Nothing planned</div>'}
        </div>
      </article>`;
  }

  function familySharedScheduleHTML(dates, rangeLabel) {
    const entries = dates.flatMap(date => eventsForDate(date)
      .filter(event => eventIncludesPerson(event, 'family'))
      .map(event => ({ event, date })));
    if (!entries.length) return '';
    const family = personFor('family');
    return `
      <section class="family-shared-events" style="--person-colour:${family.colour};--person-chip:${family.chip}">
        <div class="family-person-heading"><div class="person-avatar">F</div><div><strong>Everyone</strong><span>${escapeHTML(rangeLabel)} · shared household events</span></div></div>
        <div class="family-shared-grid">${entries.map(({ event, date }) => familyScheduleEventHTML(event, date)).join('')}</div>
      </section>`;
  }

  function familyScheduleEventHTML(event, date) {
    const showDate = familyRange === 'week';
    const dateLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseISODate(date));
    return `
      <button class="family-schedule-event" data-action="edit-event" data-id="${event.id}" type="button">
        <span class="family-event-when">${showDate ? `${escapeHTML(dateLabel)} · ` : ''}${escapeHTML(eventTimeLabel(event, date))}</span>
        <strong>${escapeHTML(event.title)}</strong>
        <span class="event-people-chips">${eventPeopleChipsHTML(event, true)}</span>
      </button>`;
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
    state.events.forEach(event => {
      const remaining = personIdsForEvent(event).filter(personId => personId !== id);
      event.personIds = remaining.length ? remaining : ['family'];
      event.person = event.personIds[0];
    });
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
        <section class="card settings-card household-settings-card">
          <div class="card-heading">
            <div>
              <div class="card-title">Household name</div>
              <div class="card-subtitle">Used in the dashboard greeting.</div>
            </div>
          </div>
          <div class="household-name-controls">
            <input id="householdNameInput" autocomplete="off" maxlength="40" placeholder="e.g. Allpress-Crawfords" value="${escapeHTML(state.household?.name || 'Family')}">
            <button class="primary-button" data-action="save-household-name" type="button">Save name</button>
          </div>
          <p class="settings-note">Examples: “Family”, “The Allpress-Crawfords” or simply your surname.</p>
        </section>

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

        <section class="card settings-card google-calendar-settings-card">
          <div class="card-heading">
            <div>
              <div class="card-title">Google Calendar</div>
              <div class="card-subtitle">Create, edit, delete and import events using the family Google account.</div>
            </div>
            <span class="connection-pill ${state.googleCalendar?.lastSyncAt ? 'connected' : ''}">${state.googleCalendar?.lastSyncAt ? 'Read & write' : 'Not connected'}</span>
          </div>
          <label class="google-client-field">
            <span>Google OAuth Client ID</span>
            <input id="googleClientIdInput" autocomplete="off" placeholder="1234567890-abc.apps.googleusercontent.com" value="${escapeHTML(state.googleCalendar?.clientId || '')}">
          </label>
          <div class="settings-actions">
            <button class="primary-button" data-action="sync-google-calendar" type="button">${state.googleCalendar?.lastSyncAt ? (googleTokenUsable() ? 'Sync now' : 'Reconnect Google Calendar') : 'Connect Google Calendar'}</button>
            ${state.googleCalendar?.lastSyncAt ? '<button class="secondary-button" data-action="remove-google-events" type="button">Remove synced events</button>' : ''}
          </div>
          <dl class="settings-list compact-settings-list">
            <div><dt>Calendar</dt><dd>Primary calendar</dd></div>
            <div><dt>Last sync</dt><dd>${escapeHTML(formatGoogleSyncDate())}</dd></div>
            <div><dt>Synced events</dt><dd>${Number(state.googleCalendar?.syncedCount || 0)}</dd></div>
          </dl>
          <p class="settings-note">The Apps Script bridge is now the preferred connection and does not expire. The browser OAuth connection remains available only as a fallback.</p>
        </section>

        <section class="card settings-card calendar-bridge-settings-card">
          <div class="card-heading">
            <div>
              <div class="card-title">Automatic Calendar Bridge</div>
              <div class="card-subtitle">Connect Family Hub to the Google Apps Script you created.</div>
            </div>
            <span class="connection-pill ${state.calendarBridge?.connected ? 'connected' : ''}">${state.calendarBridge?.connected ? 'Connected' : 'Not tested'}</span>
          </div>
          <label class="google-client-field">
            <span>Apps Script web app URL</span>
            <input id="calendarBridgeUrlInput" autocomplete="off" spellcheck="false" value="${escapeHTML(state.calendarBridge?.url || '')}">
          </label>
          <label class="google-client-field">
            <span>Private secret</span>
            <input id="calendarBridgeSecretInput" type="password" autocomplete="new-password" placeholder="Enter the secret saved in Apps Script" value="${escapeHTML(state.calendarBridge?.secret || '')}">
          </label>
          <label class="google-client-field">
            <span>Automatic sync interval</span>
            <select id="calendarBridgeIntervalInput">
              ${[1, 5, 15, 30].map(minutes => `<option value="${minutes}" ${Number(state.calendarBridge?.intervalMinutes || 5) === minutes ? 'selected' : ''}>Every ${minutes} minute${minutes === 1 ? '' : 's'}</option>`).join('')}
            </select>
          </label>
          <div class="settings-actions">
            <button class="primary-button" data-action="test-calendar-bridge" type="button">Test connection</button>
            <button class="secondary-button" data-action="save-calendar-bridge" type="button">Save settings</button>
          </div>
          <dl class="settings-list compact-settings-list">
            <div><dt>Status</dt><dd>${escapeHTML(formatCalendarBridgeStatus())}</dd></div>
            <div><dt>Last calendar sync</dt><dd>${escapeHTML(formatCalendarBridgeSyncDate())}</dd></div>
            <div><dt>Last connection test</dt><dd>${escapeHTML(formatCalendarBridgeTestDate())}</dd></div>
          </dl>
          <p class="settings-note">The private secret stays in IndexedDB on this tablet. Family Hub now reads and writes through Apps Script automatically, including when the app opens, returns to the foreground or reaches the selected interval.</p>
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

  function saveHouseholdName() {
    const input = document.getElementById('householdNameInput');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
      showToast('Please enter a household name');
      input.focus();
      return;
    }
    state.household = { ...(state.household || {}), name };
    saveAndRender('Household name updated');
    updateViewTitle();
  }

  function readCalendarBridgeForm() {
    const url = document.getElementById('calendarBridgeUrlInput')?.value.trim() || '';
    const secret = document.getElementById('calendarBridgeSecretInput')?.value || '';
    const intervalMinutes = Number(document.getElementById('calendarBridgeIntervalInput')?.value || 5);
    return { url, secret, intervalMinutes };
  }

  function saveCalendarBridgeSettings(showMessage = true) {
    const values = readCalendarBridgeForm();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(values.url)) {
      showToast('Please enter the Apps Script web app URL ending in /exec');
      return false;
    }
    if (!values.secret) {
      showToast('Please enter the private secret');
      return false;
    }
    state.calendarBridge = {
      ...normaliseCalendarBridgeState(state.calendarBridge),
      ...values,
      connected: state.calendarBridge?.url === values.url && state.calendarBridge?.secret === values.secret
        ? Boolean(state.calendarBridge?.connected)
        : false
    };
    saveState();
    if (state.calendarBridge.connected) startCalendarBridgeAutoSync();
    if (showMessage) showToast('Calendar Bridge settings saved');
    return true;
  }

  async function testCalendarBridgeConnection() {
    if (!saveCalendarBridgeSettings(false)) return;
    const button = document.querySelector('[data-action="test-calendar-bridge"]');
    const originalText = button?.textContent || 'Test connection';
    if (button) {
      button.disabled = true;
      button.textContent = 'Testing…';
    }
    try {
      const bridge = normaliseCalendarBridgeState(state.calendarBridge);
      const testUrl = new URL(bridge.url);
      testUrl.searchParams.set('action', 'ping');
      testUrl.searchParams.set('key', bridge.secret);
      testUrl.searchParams.set('_', String(Date.now()));
      const response = await fetch(testUrl.toString(), {
        method: 'GET',
        cache: 'no-store',
        redirect: 'follow'
      });
      if (!response.ok) throw new Error(`Bridge returned HTTP ${response.status}`);
      const data = await response.json();
      if (!data?.ok) throw new Error(data?.error || 'Bridge did not confirm the connection');
      state.calendarBridge = {
        ...bridge,
        connected: true,
        lastTestAt: new Date().toISOString()
      };
      saveState();
      startCalendarBridgeAutoSync();
      render();
      showToast('Calendar Bridge connected');
    } catch (error) {
      console.error('Calendar Bridge test failed', error);
      state.calendarBridge = {
        ...normaliseCalendarBridgeState(state.calendarBridge),
        connected: false
      };
      saveState();
      render();
      window.alert(`Family Hub could not read the Apps Script response.

${error.message}

Check the URL, private secret and Apps Script deployment access.`);
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  function formatCalendarBridgeTestDate() {
    const value = state.calendarBridge?.lastTestAt;
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
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
    if (action === 'save-household-name') saveHouseholdName();
    if (action === 'export-backup') exportBackup();
    if (action === 'choose-restore') document.getElementById('restoreBackupInput')?.click();
    if (action === 'set-weather-location') setWeatherLocationFromInput();
    if (action === 'use-device-location') useDeviceLocation();
    if (action === 'refresh-weather') refreshWeather(true);
    if (action === 'connect-google-calendar') connectGoogleCalendar();
    if (action === 'sync-google-calendar') syncOrReconnectGoogleCalendar();
    if (action === 'remove-google-events') removeGoogleEvents();
    if (action === 'save-calendar-bridge') saveCalendarBridgeSettings();
    if (action === 'test-calendar-bridge') testCalendarBridgeConnection();
    if (action === 'add-event') openEventModal();
    if (action === 'family-range') { familyRange = button.dataset.range || 'today'; render(); }
    if (action === 'edit-event') openEventModal(id);
    if (action === 'previous-week') { weekOffset -= 1; render(); }
    if (action === 'next-week') { weekOffset += 1; render(); }
    if (action === 'this-week') { weekOffset = 0; render(); }
    if (action === 'delete-event') {
      const selectedEvent = state.events.find(entry => String(entry.id) === String(id));
      deleteCalendarEvent(id);
    }
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
    const selectedEvent = id ? state.events.find(entry => String(entry.id) === String(id)) : null;
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
      setEventPeopleSelection(personIdsForEvent(event));
      eventRepeats.checked = Boolean(event.repeats);
      if (eventSyncGoogle) {
        eventSyncGoogle.checked = event.source === 'google' || Boolean(event.syncToGoogle);
        eventSyncGoogle.disabled = event.source === 'google';
      }
    } else {
      modalTitle.textContent = 'Add an event';
      saveEventButton.textContent = 'Add event';
      eventStartDate.value = currentView === 'calendar' ? week[0] : toISODate(new Date());
      eventEndDate.value = '';
      eventStartTime.value = '';
      eventEndTime.value = '';
      setEventPeopleSelection(['family']);
      eventRepeats.checked = false;
      if (eventSyncGoogle) {
        eventSyncGoogle.checked = Boolean(state.calendarBridge?.connected || state.googleCalendar?.lastSyncAt);
        eventSyncGoogle.disabled = false;
      }
    }

    eventEndDate.min = eventStartDate.value;
    modalBackdrop.classList.remove('hidden');
    window.setTimeout(() => eventTitle.focus(), 30);
  }

  function closeEventModal() {
    modalBackdrop.classList.add('hidden');
    editingEventId = null;
    if (eventSyncGoogle) eventSyncGoogle.disabled = false;
  }

  async function addEvent(event) {
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

    const existing = editingEventId ? state.events.find(entry => String(entry.id) === String(editingEventId)) : null;
    const eventData = {
      title,
      startDate: eventStartDate.value,
      endDate,
      startTime: eventStartTime.value,
      endTime: eventEndTime.value,
      personIds: selectedEventPersonIds(),
      person: selectedEventPersonIds()[0] || 'family',
      repeats: eventRepeats.checked,
      syncToGoogle: Boolean(eventSyncGoogle?.checked)
    };

    try {
      saveEventButton.disabled = true;
      saveEventButton.textContent = existing ? 'Saving…' : 'Adding…';

      if (existing?.source === 'google') {
        const updatedGoogle = state.calendarBridge?.connected
          ? await updateCalendarBridgeEvent(existing.googleEventId, eventData)
          : (await ensureGoogleWriteAccess(), await updateGoogleCalendarEvent(existing.googleEventId, eventData));
        const converted = convertGoogleEvent(updatedGoogle);
        if (!converted) throw new Error('Google returned an invalid event');
        state.events[state.events.findIndex(entry => String(entry.id) === String(existing.id))] = { ...converted, personIds: eventData.personIds, person: eventData.person };
        closeEventModal();
        saveAndRender('Google event updated');
        return;
      }

      if (existing) {
        if (eventData.syncToGoogle && !existing.googleEventId) {
          const createdGoogle = state.calendarBridge?.connected
            ? await createCalendarBridgeEvent(eventData)
            : (await ensureGoogleWriteAccess(), await createGoogleCalendarEvent(eventData, existing.id));
          const converted = convertGoogleEvent(createdGoogle);
          state.events[state.events.findIndex(entry => String(entry.id) === String(existing.id))] = { ...converted, personIds: eventData.personIds, person: eventData.person };
          closeEventModal();
          saveAndRender('Event added to Google Calendar');
          return;
        }
        const index = state.events.findIndex(entry => String(entry.id) === String(editingEventId));
        if (index !== -1) state.events[index] = { ...state.events[index], ...eventData, source: 'local', readOnly: false };
        closeEventModal();
        saveAndRender('Event updated');
        return;
      }

      const localId = uid();
      if (eventData.syncToGoogle) {
        const createdGoogle = state.calendarBridge?.connected
          ? await createCalendarBridgeEvent(eventData)
          : (await ensureGoogleWriteAccess(), await createGoogleCalendarEvent(eventData, localId));
        const converted = convertGoogleEvent(createdGoogle);
        state.events.push({ ...converted, personIds: eventData.personIds, person: eventData.person });
        closeEventModal();
        saveAndRender('Event added to Google Calendar');
        return;
      }

      state.events.push({ id: localId, source: 'local', readOnly: false, ...eventData });
      closeEventModal();
      saveAndRender('Event added');
    } catch (error) {
      console.error('Could not save event', error);
      showToast(googleErrorMessage(error, 'Event could not be saved'));
    } finally {
      saveEventButton.disabled = false;
      saveEventButton.textContent = editingEventId ? 'Save changes' : 'Add event';
    }
  }

  async function deleteCalendarEvent(id) {
    const selectedEvent = state.events.find(entry => String(entry.id) === String(id));
    if (!selectedEvent) return;
    const confirmed = window.confirm(`Delete “${selectedEvent.title}”?${selectedEvent.source === 'google' ? ' This will also delete it from Google Calendar.' : ''}`);
    if (!confirmed) return;

    try {
      if (selectedEvent.source === 'google' && selectedEvent.googleEventId) {
        if (state.calendarBridge?.connected) await deleteCalendarBridgeEvent(selectedEvent.googleEventId);
        else {
          await ensureGoogleWriteAccess();
          await deleteGoogleCalendarEvent(selectedEvent.googleEventId);
        }
      }
      state.events = state.events.filter(entry => String(entry.id) !== String(id));
      saveAndRender(selectedEvent.source === 'google' ? 'Google event deleted' : 'Event deleted');
    } catch (error) {
      console.error('Could not delete event', error);
      showToast(googleErrorMessage(error, 'Event could not be deleted'));
    }
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
      endTime: event.endTime ?? '',
      personIds: Array.isArray(event.personIds) && event.personIds.length ? [...new Set(event.personIds.filter(Boolean))] : [event.person || 'family'],
      person: (Array.isArray(event.personIds) && event.personIds.length ? event.personIds[0] : event.person) || 'family'
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

  function personIdsForEvent(rawEvent) {
    const ids = Array.isArray(rawEvent?.personIds) && rawEvent.personIds.length ? rawEvent.personIds : [rawEvent?.person || 'family'];
    const valid = [...new Set(ids.filter(id => state.people.some(person => person.id === id)))];
    return valid.length ? valid : ['family'];
  }

  function peopleForEvent(event) {
    return personIdsForEvent(event).map(personFor);
  }

  function primaryPersonForEvent(event) {
    return peopleForEvent(event)[0] || personFor('family');
  }

  function eventIncludesPerson(event, personId) {
    return personIdsForEvent(event).includes(personId);
  }

  function eventPeopleLabel(event) {
    const names = peopleForEvent(event).map(person => person.name);
    if (names.length <= 2) return names.join(' & ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }

  function eventPeopleChipsHTML(event, compact = false) {
    const people = peopleForEvent(event);
    const visible = compact ? people.slice(0, 3) : people;
    const chips = visible.map(person => `<span class="person-chip ${compact ? 'compact' : ''}" style="--chip-colour:${person.chip};--person-colour:${person.colour}">${escapeHTML(compact ? person.name.slice(0, 1).toUpperCase() : person.name)}</span>`).join('');
    return chips + (compact && people.length > 3 ? `<span class="person-chip compact">+${people.length - 3}</span>` : '');
  }

  function refreshPersonOptions() {
    if (!eventPerson) return;
    const selected = selectedEventPersonIds();
    eventPerson.innerHTML = state.people.map(person => `
      <label class="event-person-option" style="--person-colour:${person.colour};--person-chip:${person.chip}">
        <input type="checkbox" name="eventPeople" value="${person.id}">
        <span class="event-person-check">✓</span>
        <span class="event-person-avatar">${escapeHTML(person.name.slice(0, 1).toUpperCase())}</span>
        <span>${escapeHTML(person.id === 'family' ? 'Everyone' : person.name)}</span>
      </label>`).join('');
    setEventPeopleSelection(selected.length ? selected : ['family']);
  }

  function selectedEventPersonIds() {
    if (!eventPerson) return ['family'];
    return Array.from(eventPerson.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
  }

  function setEventPeopleSelection(ids) {
    if (!eventPerson) return;
    const selected = new Set(Array.isArray(ids) && ids.length ? ids : ['family']);
    eventPerson.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = selected.has(input.value); });
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
    restored.googleCalendar = normaliseGoogleCalendarState(restored.googleCalendar);
    restored.calendarBridge = normaliseCalendarBridgeState(restored.calendarBridge);
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
      result.googleCalendar = normaliseGoogleCalendarState(result.googleCalendar);
      result.household = { name: typeof result.household?.name === 'string' && result.household.name.trim() ? result.household.name.trim() : 'Allpress-Crawfords' };
      result.calendarBridge = normaliseCalendarBridgeState(result.calendarBridge);
      return result;
    } catch {
      return structuredCloneSafe(seed);
    }
  }

  function normaliseGoogleCalendarState(value) {
    return {
      clientId: typeof value?.clientId === 'string' ? value.clientId.trim() : '',
      calendarId: typeof value?.calendarId === 'string' && value.calendarId ? value.calendarId : 'primary',
      lastSyncAt: value?.lastSyncAt || null,
      syncedCount: Number.isFinite(Number(value?.syncedCount)) ? Number(value.syncedCount) : 0
    };
  }

  function normaliseCalendarBridgeState(value) {
    const defaultUrl = 'https://script.google.com/macros/s/AKfycbyO_nrXPu6fQkKNz25YxRxIkYDOLFbNlpqHq91rKObY9-S8mSTvfvzFFm8Z0cEV-CMXMA/exec';
    const minutes = Number(value?.intervalMinutes);
    return {
      url: typeof value?.url === 'string' && value.url.trim() ? value.url.trim() : defaultUrl,
      secret: typeof value?.secret === 'string' ? value.secret : '',
      intervalMinutes: [1, 5, 15, 30].includes(minutes) ? minutes : 5,
      lastTestAt: value?.lastTestAt || null,
      lastSyncAt: value?.lastSyncAt || null,
      connected: Boolean(value?.connected)
    };
  }

  function calendarBridgeReady() {
    const bridge = normaliseCalendarBridgeState(state.calendarBridge);
    return Boolean(bridge.connected && bridge.url && bridge.secret);
  }

  function startCalendarBridgeAutoSync() {
    if (calendarBridgeSyncTimer) window.clearInterval(calendarBridgeSyncTimer);
    if (!calendarBridgeReady()) return;
    // A short heartbeat is more reliable on Android than a single long timer.
    // It only makes a network request when the chosen sync interval is actually due.
    calendarBridgeSyncTimer = window.setInterval(() => {
      if (!document.hidden && navigator.onLine) syncCalendarBridge({ silent: true, onlyIfDue: true });
    }, 15 * 1000);
  }

  async function calendarBridgeRequest(action, payload = null) {
    if (!calendarBridgeReady()) throw new Error('Connect the Automatic Calendar Bridge in Settings');
    const bridge = normaliseCalendarBridgeState(state.calendarBridge);
    const url = new URL(bridge.url);
    url.searchParams.set('action', action);
    url.searchParams.set('key', bridge.secret);
    if (payload !== null) url.searchParams.set('payload', JSON.stringify(payload));
    url.searchParams.set('_', String(Date.now()));

    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`Calendar Bridge returned HTTP ${response.status}`);
    const data = await response.json();
    if (!data?.ok) throw new Error(data?.error || 'Calendar Bridge request failed');
    return data;
  }

  async function syncCalendarBridge(options = {}) {
    if (!calendarBridgeReady() || calendarBridgeSyncInProgress || document.hidden) return;
    if (!navigator.onLine) { calendarBridgeLastError = 'Offline'; render(); return; }
    const intervalMs = Math.max(1, Number(state.calendarBridge.intervalMinutes || 5)) * 60 * 1000;
    const lastSync = new Date(state.calendarBridge.lastSyncAt || 0).getTime();
    if (options.onlyIfDue && lastSync && Date.now() - lastSync < intervalMs) return;
    calendarBridgeSyncInProgress = true;
    calendarBridgeLastAttemptAt = new Date().toISOString();
    calendarBridgeLastError = '';
    if (!options.silent) showToast('Syncing Google Calendar…');
    render();
    try {
      const data = await calendarBridgeRequest('events');
      const importedEvents = (Array.isArray(data.events) ? data.events : [])
        .filter(item => item.status !== 'cancelled')
        .map(convertGoogleEvent)
        .filter(Boolean);
      const existingGooglePeople = new Map(state.events
        .filter(event => event.source === 'google' && event.googleEventId)
        .map(event => [event.googleEventId, personIdsForEvent(event)]));
      state.events = state.events.filter(event => event.source !== 'google');
      state.events.push(...importedEvents.map(event => ({
        ...event,
        personIds: event.person !== 'family' ? [event.person] : (existingGooglePeople.get(event.googleEventId) || ['family']),
        person: (event.person !== 'family' ? event.person : (existingGooglePeople.get(event.googleEventId)?.[0] || 'family'))
      })));
      const now = new Date().toISOString();
      state.calendarBridge = { ...normaliseCalendarBridgeState(state.calendarBridge), connected: true, lastSyncAt: now };
      calendarBridgeLastError = '';
      state.googleCalendar = { ...normaliseGoogleCalendarState(state.googleCalendar), lastSyncAt: now, syncedCount: importedEvents.length };
      saveState();
      render();
      if (!options.silent) showToast(`Synced ${importedEvents.length} calendar ${importedEvents.length === 1 ? 'event' : 'events'}`);
    } catch (error) {
      console.error('Automatic Calendar Bridge sync failed', error);
      calendarBridgeLastError = error.message || 'Sync failed';
      if (!options.silent) showToast(calendarBridgeLastError);
    } finally {
      calendarBridgeSyncInProgress = false;
      render();
    }
  }

  function bridgeEventPayload(eventData) {
    return {
      title: eventData.title,
      startDate: eventData.startDate,
      endDate: eventData.endDate || eventData.startDate,
      startTime: eventData.startTime || '',
      endTime: eventData.endTime || '',
      allDay: !eventData.startTime,
      repeats: Boolean(eventData.repeats)
    };
  }

  async function createCalendarBridgeEvent(eventData) {
    const data = await calendarBridgeRequest('create', { event: bridgeEventPayload(eventData) });
    state.calendarBridge.lastSyncAt = new Date().toISOString();
    return data.event;
  }

  async function updateCalendarBridgeEvent(googleEventId, eventData) {
    const data = await calendarBridgeRequest('update', { event: { ...bridgeEventPayload(eventData), googleEventId } });
    state.calendarBridge.lastSyncAt = new Date().toISOString();
    return data.event;
  }

  async function deleteCalendarBridgeEvent(googleEventId) {
    await calendarBridgeRequest('delete', { eventId: googleEventId });
    state.calendarBridge.lastSyncAt = new Date().toISOString();
  }

  function calendarBridgeStatusClass() {
    if (!navigator.onLine) return 'offline';
    if (calendarBridgeSyncInProgress) return 'syncing';
    if (calendarBridgeLastError) return 'error';
    return 'synced';
  }

  function formatCalendarBridgeStatus() {
    if (!state.calendarBridge?.connected) return 'Not connected';
    if (!navigator.onLine) return 'Offline';
    if (calendarBridgeSyncInProgress) return 'Syncing…';
    if (calendarBridgeLastError) return `Sync issue · ${calendarBridgeLastError}`;
    return `✓ ${formatRelativeBridgeSyncDate()}`;
  }

  function formatCalendarBridgeSyncDate() {
    const value = state.calendarBridge?.lastSyncAt;
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function formatRelativeBridgeSyncDate() {
    const value = state.calendarBridge?.lastSyncAt;
    if (!value) return 'Waiting for first sync';
    const elapsed = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(elapsed) || elapsed < 60000) return 'Synced just now';
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 60) return `Synced ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `Synced ${hours}h ago` : `Synced ${Math.floor(hours / 24)}d ago`;
  }

  function formatGoogleSyncDate() {
    const value = state.googleCalendar?.lastSyncAt;
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function formatRelativeGoogleSyncDate() {
    const value = state.googleCalendar?.lastSyncAt;
    if (!value) return 'Not synced yet';
    const elapsed = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(elapsed) || elapsed < 0) return 'Last synced recently';
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return 'Synced just now';
    if (minutes < 60) return `Synced ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Synced ${hours}h ago`;
    return `Synced ${Math.floor(hours / 24)}d ago`;
  }

  function googleTokenUsable() {
    return Boolean(googleAccessToken && Date.now() < googleAccessTokenExpiresAt);
  }

  function syncOrReconnectGoogleCalendar() {
    if (state.calendarBridge?.connected) {
      syncCalendarBridge();
      return;
    }
    if (googleSyncInProgress) return;
    if (googleTokenUsable()) syncGoogleCalendar();
    else connectGoogleCalendar();
  }

  function startGoogleAutoSync() {
    if (googleAutoSyncTimer) window.clearInterval(googleAutoSyncTimer);
    googleAutoSyncTimer = window.setInterval(maybeAutoSyncGoogleCalendar, GOOGLE_AUTO_SYNC_MS);
  }

  function maybeAutoSyncGoogleCalendar() {
    if (!googleTokenUsable() || googleSyncInProgress || document.hidden) return;
    const lastSync = new Date(state.googleCalendar?.lastSyncAt || 0).getTime();
    if (!lastSync || Date.now() - lastSync >= GOOGLE_AUTO_SYNC_MS) syncGoogleCalendar({ silent: true });
  }

  async function connectGoogleCalendar() {
    if (googleSyncInProgress) return;
    const input = document.getElementById('googleClientIdInput');
    const clientId = input?.value.trim() || state.googleCalendar?.clientId || '';
    if (!clientId || !clientId.endsWith('.apps.googleusercontent.com')) {
      showToast('Enter the Google OAuth Client ID first');
      input?.focus();
      return;
    }

    state.googleCalendar = {
      ...normaliseGoogleCalendarState(state.googleCalendar),
      clientId
    };
    saveState();

    try {
      await waitForGoogleIdentityServices();
      googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        callback: async response => {
          if (response?.error) {
            console.error('Google authorization failed', response);
            showToast('Google connection was not completed');
            return;
          }
          googleAccessToken = response.access_token;
          const lifetimeSeconds = Number(response.expires_in || 3600);
          googleAccessTokenExpiresAt = Date.now() + Math.max(60, lifetimeSeconds - 60) * 1000;
          await syncGoogleCalendar();
        }
      });
      googleTokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (error) {
      console.error('Could not start Google Calendar connection', error);
      showToast('Google Calendar could not be opened');
    }
  }

  function waitForGoogleIdentityServices() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          window.clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 10000) {
          window.clearInterval(timer);
          reject(new Error('Google Identity Services did not load'));
        }
      }, 100);
    });
  }

  async function syncGoogleCalendar(options = {}) {
    if (!googleTokenUsable() || googleSyncInProgress) {
      if (!options.silent && !googleTokenUsable()) showToast('Reconnect Google Calendar to sync');
      return;
    }
    googleSyncInProgress = true;
    if (!options.silent) showToast('Syncing Google Calendar…');
    render();
    try {
      const googleEvents = await fetchGoogleCalendarEvents(googleAccessToken, state.googleCalendar?.calendarId || 'primary');
      const importedEvents = googleEvents
        .filter(item => item.status !== 'cancelled')
        .map(convertGoogleEvent)
        .filter(Boolean);

      const existingGooglePeople = new Map(state.events
        .filter(event => event.source === 'google' && event.googleEventId)
        .map(event => [event.googleEventId, personIdsForEvent(event)]));
      state.events = state.events.filter(event => event.source !== 'google');
      state.events.push(...importedEvents.map(event => ({
        ...event,
        personIds: event.person !== 'family' ? [event.person] : (existingGooglePeople.get(event.googleEventId) || ['family']),
        person: (event.person !== 'family' ? event.person : (existingGooglePeople.get(event.googleEventId)?.[0] || 'family'))
      })));
      state.googleCalendar = {
        ...normaliseGoogleCalendarState(state.googleCalendar),
        lastSyncAt: new Date().toISOString(),
        syncedCount: importedEvents.length
      };
      saveState();
      render();
      if (!options.silent) showToast(`${importedEvents.length} Google ${importedEvents.length === 1 ? 'event' : 'events'} imported`);
    } catch (error) {
      console.error('Could not sync Google Calendar', error);
      if (error?.message === 'Google authorization expired') {
        googleAccessToken = null;
        googleAccessTokenExpiresAt = 0;
      }
      if (!options.silent || error?.message === 'Google authorization expired') showToast(error?.message === 'Google authorization expired' ? 'Reconnect Google Calendar to sync' : 'Google Calendar sync failed');
    } finally {
      googleSyncInProgress = false;
    }
  }

  async function ensureGoogleWriteAccess() {
    if (googleTokenUsable()) return;
    await requestGoogleAccessToken();
  }

  function requestGoogleAccessToken() {
    const clientId = state.googleCalendar?.clientId || '';
    if (!clientId) throw new Error('Connect Google Calendar in Settings first');
    return waitForGoogleIdentityServices().then(() => new Promise((resolve, reject) => {
      googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        callback: response => {
          if (response?.error || !response?.access_token) {
            reject(new Error('Google connection was not completed'));
            return;
          }
          googleAccessToken = response.access_token;
          const lifetimeSeconds = Number(response.expires_in || 3600);
          googleAccessTokenExpiresAt = Date.now() + Math.max(60, lifetimeSeconds - 60) * 1000;
          resolve();
        }
      });
      googleTokenClient.requestAccessToken({ prompt: 'consent' });
    }));
  }

  function googleEventPayload(eventData, familyHubId = '') {
    const payload = {
      summary: eventData.title,
      extendedProperties: {
        private: {
          familyHub: 'true',
          familyHubId: String(familyHubId || ''),
          familyHubPerson: String(eventData.person || 'family')
        }
      }
    };

    if (!eventData.startTime) {
      payload.start = { date: eventData.startDate };
      payload.end = { date: addDaysISO(eventData.endDate || eventData.startDate, 1) };
    } else {
      const start = localDateTime(eventData.startDate, eventData.startTime);
      let end;
      if (eventData.endTime) end = localDateTime(eventData.endDate || eventData.startDate, eventData.endTime);
      else {
        end = new Date(start.getTime() + 60 * 60 * 1000);
        if ((eventData.endDate || eventData.startDate) !== eventData.startDate) {
          end = localDateTime(eventData.endDate, eventData.startTime);
        }
      }
      payload.start = { dateTime: start.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      payload.end = { dateTime: end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    }

    if (eventData.repeats) payload.recurrence = ['RRULE:FREQ=WEEKLY'];
    return payload;
  }

  function localDateTime(date, time) {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }

  async function googleCalendarRequest(path, options = {}) {
    if (!googleTokenUsable()) throw new Error('Reconnect Google Calendar');
    const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${googleAccessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (response.status === 401) {
      googleAccessToken = null;
      googleAccessTokenExpiresAt = 0;
      throw new Error('Reconnect Google Calendar');
    }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.error?.message || ''; } catch {}
      throw new Error(detail || `Google Calendar returned ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function createGoogleCalendarEvent(eventData, familyHubId) {
    const calendarId = encodeURIComponent(state.googleCalendar?.calendarId || 'primary');
    return googleCalendarRequest(`/calendars/${calendarId}/events`, {
      method: 'POST',
      body: JSON.stringify(googleEventPayload(eventData, familyHubId))
    });
  }

  function updateGoogleCalendarEvent(googleEventId, eventData) {
    const calendarId = encodeURIComponent(state.googleCalendar?.calendarId || 'primary');
    return googleCalendarRequest(`/calendars/${calendarId}/events/${encodeURIComponent(googleEventId)}`, {
      method: 'PATCH',
      body: JSON.stringify(googleEventPayload(eventData, googleEventId))
    });
  }

  function deleteGoogleCalendarEvent(googleEventId) {
    const calendarId = encodeURIComponent(state.googleCalendar?.calendarId || 'primary');
    return googleCalendarRequest(`/calendars/${calendarId}/events/${encodeURIComponent(googleEventId)}`, { method: 'DELETE' });
  }

  function googleErrorMessage(error, fallback) {
    const message = String(error?.message || '');
    if (/reconnect|connect google/i.test(message)) return message;
    if (/forbidden|permission|insufficient/i.test(message)) return 'Google Calendar permission was denied';
    return message || fallback;
  }

  async function fetchGoogleCalendarEvents(accessToken, calendarId) {
    const items = [];
    let pageToken = '';
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - 30);
    const timeMax = new Date();
    timeMax.setFullYear(timeMax.getFullYear() + 1);

    do {
      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',
        showDeleted: 'false',
        orderBy: 'startTime',
        maxResults: '2500'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (response.status === 401) throw new Error('Google authorization expired');
      if (!response.ok) throw new Error(`Google Calendar returned ${response.status}`);
      const payload = await response.json();
      items.push(...(Array.isArray(payload.items) ? payload.items : []));
      pageToken = payload.nextPageToken || '';
    } while (pageToken);

    return items;
  }

  function convertGoogleEvent(item) {
    if (!item?.id || !item.start) return null;
    const title = item.summary?.trim() || 'Busy';
    const allDay = Boolean(item.start.date);
    let startDate;
    let endDate;
    let startTime = '';
    let endTime = '';

    if (allDay) {
      startDate = item.start.date;
      const exclusiveEnd = item.end?.date || item.start.date;
      endDate = addDaysISO(exclusiveEnd, -1);
      if (endDate < startDate) endDate = startDate;
    } else {
      const start = new Date(item.start.dateTime);
      const end = new Date(item.end?.dateTime || item.start.dateTime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
      startDate = toISODate(start);
      endDate = toISODate(end);
      startTime = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
      endTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
    }

    return {
      id: `google-${item.id}`,
      googleEventId: item.id,
      source: 'google',
      readOnly: false,
      title,
      startDate,
      endDate,
      startTime,
      endTime,
      person: item.extendedProperties?.private?.familyHubPerson || 'family',
      repeats: false,
      htmlLink: item.htmlLink || '',
      syncToGoogle: true
    };
  }

  function removeGoogleEvents() {
    const importedCount = state.events.filter(event => event.source === 'google').length;
    if (!importedCount) return;
    const confirmed = window.confirm(`Remove ${importedCount} synced Google Calendar ${importedCount === 1 ? 'event' : 'events'} from Family Hub? This will not delete anything from Google Calendar.`);
    if (!confirmed) return;
    state.events = state.events.filter(event => event.source !== 'google');
    state.googleCalendar = {
      ...normaliseGoogleCalendarState(state.googleCalendar),
      lastSyncAt: null,
      syncedCount: 0
    };
    googleAccessToken = null;
    saveAndRender('Synced Google events removed');
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
