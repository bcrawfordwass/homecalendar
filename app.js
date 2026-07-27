(() => {
  'use strict';

  const STORAGE_KEY = 'family-hub-lenovo-v1';
  const PEOPLE = [
    { id: 'ben', name: 'Ben', colour: '#ff8a65', chip: '#ffe6dc' },
    { id: 'millie', name: 'Millie', colour: '#7e9cff', chip: '#e5eaff' },
    { id: 'family', name: 'Family', colour: '#5fbe8f', chip: '#dcf3e7' }
  ];

  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayISO = toISODate(new Date());
  const seed = {
    events: [
      { id: uid(), title: 'Swimming', date: addDaysISO(todayISO, 1), time: '16:30', person: 'millie', repeats: false },
      { id: uid(), title: 'Dinner at Mum’s', date: addDaysISO(todayISO, 3), time: '19:00', person: 'family', repeats: false }
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
    ]
  };

  let state = loadState();
  let currentView = 'today';
  let weekOffset = 0;
  let deferredInstallPrompt = null;

  const viewRoot = document.getElementById('viewRoot');
  const viewTitle = document.getElementById('viewTitle');
  const fullDate = document.getElementById('fullDate');
  const clock = document.getElementById('clock');
  const mainNav = document.getElementById('mainNav');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const eventForm = document.getElementById('eventForm');
  const eventTitle = document.getElementById('eventTitle');
  const eventDate = document.getElementById('eventDate');
  const eventTime = document.getElementById('eventTime');
  const eventPerson = document.getElementById('eventPerson');
  const eventRepeats = document.getElementById('eventRepeats');
  const installButton = document.getElementById('installButton');

  initialise();

  function initialise() {
    eventPerson.innerHTML = PEOPLE.map(person => `<option value="${person.id}">${escapeHTML(person.name)}</option>`).join('');
    mainNav.addEventListener('click', onNavigation);
    viewRoot.addEventListener('click', onViewClick);
    viewRoot.addEventListener('change', onViewChange);
    viewRoot.addEventListener('keydown', onViewKeydown);
    eventForm.addEventListener('submit', addEvent);
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

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }

    updateDateAndClock();
    window.setInterval(updateDateAndClock, 30_000);
    render();
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
  }

  function updateViewTitle() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const titles = { today: greeting, calendar: 'Calendar', chores: 'Chores', meals: 'Meals', shopping: 'Shopping' };
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
    const date = toISODate(new Date());
    const events = eventsForDate(date);
    const openChores = state.chores.filter(item => !item.done);
    const remaining = state.shopping.filter(item => !item.done).length;
    const meal = state.meals[date] || 'Not decided';

    viewRoot.innerHTML = `
      <div class="dashboard-grid">
        <section class="card hero-card">
          <div class="card-heading">
            <div>
              <div class="card-title">Today</div>
              <div class="card-subtitle">${escapeHTML(formatFriendlyDate(date))}</div>
            </div>
            <button class="card-link" data-action="open-calendar" type="button">Open calendar →</button>
          </div>
          ${events.length ? events.map(eventCardHTML).join('') : '<div class="empty-message">Nothing scheduled today.</div>'}
        </section>
        <section class="card">
          <div class="card-heading">
            <div class="card-title">Chores</div>
            <button class="card-link" data-action="open-chores" type="button">View all →</button>
          </div>
          <div class="mini-list">
            ${openChores.length ? openChores.slice(0, 5).map(item => `<div class="mini-row"><span class="mini-check"></span><span>${escapeHTML(item.title)}</span></div>`).join('') : '<div class="empty-message">All done for now.</div>'}
          </div>
        </section>
        <section class="card meal-highlight">
          <div class="card-title">Tonight’s dinner</div>
          <div class="meal-name">${escapeHTML(meal)}</div>
        </section>
        <section class="card">
          <div class="card-title">Shopping list</div>
          <div class="big-number">${remaining}</div>
          <div class="muted">${remaining === 1 ? 'item left' : 'items left'}</div>
        </section>
      </div>`;
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
            <div class="legend">${PEOPLE.map(person => `<span><i class="legend-dot" style="background:${person.colour}"></i>${escapeHTML(person.name)}</span>`).join('')}</div>
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
        ${events.length ? events.map(calendarEventHTML).join('') : '<div class="muted" style="font-size:12px">No events</div>'}
      </div>`;
  }

  function calendarEventHTML(event) {
    const person = personFor(event.person);
    return `
      <article class="event-card" style="--event-colour:${person.colour}">
        <span class="event-time">${escapeHTML(event.time)}</span>
        <span class="event-title" title="${escapeHTML(event.title)}">${escapeHTML(event.title)}</span>
        <span class="person-chip" style="--chip-colour:${person.chip}">${escapeHTML(person.name)}</span>
        <div class="event-actions"><button class="tiny-button" data-action="delete-event" data-id="${event.id}" type="button">Delete</button></div>
      </article>`;
  }

  function eventCardHTML(event) {
    const person = personFor(event.person);
    return `
      <article class="event-card" style="--event-colour:${person.colour}">
        <span class="event-time">${escapeHTML(event.time)}</span>
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
          ${PEOPLE.map(person => `<option value="${person.id}" ${person.id === item.person ? 'selected' : ''}>${escapeHTML(person.name)}</option>`).join('')}
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
    if (action === 'add-event') openEventModal();
    if (action === 'previous-week') { weekOffset -= 1; render(); }
    if (action === 'next-week') { weekOffset += 1; render(); }
    if (action === 'this-week') { weekOffset = 0; render(); }
    if (action === 'delete-event') deleteItem('events', id);
    if (action === 'toggle-chore') toggleItem('chores', id);
    if (action === 'delete-chore') deleteItem('chores', id);
    if (action === 'toggle-shopping') toggleItem('shopping', id);
    if (action === 'delete-shopping') deleteItem('shopping', id);
    if (action === 'clear-shopping') {
      state.shopping = state.shopping.filter(item => !item.done);
      saveAndRender('Completed items cleared');
    }
    if (action === 'add-chore') addQuickItem('chores', 'add-chore-input');
    if (action === 'add-shopping') addQuickItem('shopping', 'add-shopping-input');
  }

  function onViewChange(event) {
    const target = event.target;
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

  function openEventModal() {
    const week = weekDates(weekOffset);
    eventForm.reset();
    eventDate.value = currentView === 'calendar' ? week[0] : toISODate(new Date());
    eventTime.value = '09:00';
    eventPerson.value = 'family';
    eventRepeats.checked = false;
    modalBackdrop.classList.remove('hidden');
    window.setTimeout(() => eventTitle.focus(), 30);
  }

  function closeEventModal() {
    modalBackdrop.classList.add('hidden');
  }

  function addEvent(event) {
    event.preventDefault();
    const title = eventTitle.value.trim();
    if (!title || !eventDate.value) return;
    state.events.push({
      id: uid(),
      title,
      date: eventDate.value,
      time: eventTime.value || '09:00',
      person: eventPerson.value,
      repeats: eventRepeats.checked
    });
    closeEventModal();
    saveAndRender('Event added');
  }

  function eventsForDate(date) {
    const target = parseISODate(date);
    return state.events
      .filter(event => {
        if (!event.repeats) return event.date === date;
        const original = parseISODate(event.date);
        return original <= target && original.getDay() === target.getDay();
      })
      .slice()
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  function personFor(id) {
    return PEOPLE.find(person => person.id === id) || PEOPLE[PEOPLE.length - 1];
  }

  function saveAndRender(message) {
    saveState();
    render();
    if (message) showToast(message);
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const status = document.getElementById('saveStatus');
    if (status) {
      status.textContent = 'Saved just now';
      window.setTimeout(() => { status.textContent = 'Saved on this tablet'; }, 1400);
    }
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!stored || !Array.isArray(stored.events) || !Array.isArray(stored.chores) || !stored.meals || !Array.isArray(stored.shopping)) {
        return structuredCloneSafe(seed);
      }
      return stored;
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

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }
})();
