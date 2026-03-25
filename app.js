const HABITS = [
  { id: 'meditation', name: 'Meditation', icon: 'images/meditation.svg', accent: '#5C4B51' },
  { id: 'yoga',       name: 'Yoga',       icon: 'images/yoga.svg',       accent: '#8CBEB2' },
  { id: 'strength',   name: 'Strength',   icon: 'images/strength.svg',   accent: '#F3B562' },
  { id: 'cardio',     name: 'Cardio',     icon: 'images/cardio.svg',     accent: '#F06060' },
  { id: 'sauna',      name: 'Sauna',      icon: 'images/sauna.svg',      accent: '#DDCC62' },
];

const STORAGE_KEY = 'habit_tracker_data';
const NOTES_KEY = 'habit_tracker_notes';
const MIGRATION_KEY = 'habit_tz_migrated';

function migrateTimezone() {
  if (localStorage.getItem(MIGRATION_KEY)) return;
  localStorage.setItem(MIGRATION_KEY, '1');

  // Old code used toISOString() (UTC). For UTC- timezones, saves made at night
  // were stored under the next UTC day. Shift all keys back 1 day to fix.
  if (new Date().getTimezoneOffset() <= 0) return;

  const shiftBack = (obj) => {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      const d = new Date(key + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      result[toDateStr(d)] = val;
    }
    return result;
  };

  const data = loadData();
  const notes = loadNotes();
  if (Object.keys(data).length)  localStorage.setItem(STORAGE_KEY, JSON.stringify(shiftBack(data)));
  if (Object.keys(notes).length) localStorage.setItem(NOTES_KEY,   JSON.stringify(shiftBack(notes)));
}

function loadNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY)) || {};
  } catch {
    return {};
  }
}

function saveNote(dateStr, text) {
  const notes = loadNotes();
  if (text.trim()) {
    notes[dateStr] = text;
  } else {
    delete notes[dateStr];
  }
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function isHabitDoneOn(data, habitId, dateStr) {
  return !!(data[dateStr] && data[dateStr][habitId]);
}

function toggleHabit(data, habitId, dateStr) {
  if (!data[dateStr]) data[dateStr] = {};
  data[dateStr][habitId] = !data[dateStr][habitId];
  if (!data[dateStr][habitId]) delete data[dateStr][habitId];
  if (Object.keys(data[dateStr]).length === 0) delete data[dateStr];
  return data;
}

function getStreak(data, habitId, todayStr) {
  let streak = 0;
  const d = new Date(todayStr + 'T12:00:00');
  while (true) {
    const s = toDateStr(d);
    if (isHabitDoneOn(data, habitId, s)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function getLast30Days(todayStr) {
  const days = [];
  const d = new Date(todayStr + 'T12:00:00');
  for (let i = 29; i >= 0; i--) {
    const day = new Date(d);
    day.setDate(d.getDate() - i);
    days.push(toDateStr(day));
  }
  return days;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderApp() {
  const data = loadData();
  const today = new Date();
  const todayStr = toDateStr(today);

  // Header date
  document.getElementById('today-date').textContent = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Today's habit cards
  const grid = document.getElementById('habits-grid');
  grid.innerHTML = '';

  HABITS.forEach(habit => {
    const done = isHabitDoneOn(data, habit.id, todayStr);
    const streak = getStreak(data, habit.id, todayStr);

    const card = document.createElement('div');
    card.className = 'habit-card' + (done ? ' done' : '');
    card.style.setProperty('--accent', habit.accent);
    card.innerHTML = `
      <img class="habit-icon" src="${habit.icon}" alt="${habit.name}" />
      <div class="habit-name">${habit.name}</div>
      <div class="habit-streak">Streak: <span>${streak}</span></div>
    `;
    card.addEventListener('click', () => {
      const current = loadData();
      const updated = toggleHabit(current, habit.id, todayStr);
      saveData(updated);
      renderApp();
    });

    grid.appendChild(card);
  });

  // Today's notes
  const notesEl = document.getElementById('today-notes');
  const notes = loadNotes();
  notesEl.value = notes[todayStr] || '';
  notesEl.oninput = () => saveNote(todayStr, notesEl.value);

  // History rows
  const days = getLast30Days(todayStr);
  const container = document.getElementById('history-container');
  container.innerHTML = '';

  // Date header row
  const headerRow = document.createElement('div');
  headerRow.className = 'history-row history-header';
  const headerSpacer = document.createElement('div');
  headerSpacer.className = 'history-label';
  const headerDots = document.createElement('div');
  headerDots.className = 'history-dots';
  days.forEach((dateStr, i) => {
    if (i > 0 && i % 7 === 0) {
      const sep = document.createElement('div');
      sep.className = 'week-sep';
      headerDots.appendChild(sep);
    }
    const cell = document.createElement('div');
    cell.className = 'day-date-label';
    const d = new Date(dateStr + 'T12:00:00');
    cell.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (dateStr === todayStr) cell.classList.add('today');
    headerDots.appendChild(cell);
  });
  headerRow.appendChild(headerSpacer);
  headerRow.appendChild(headerDots);
  container.appendChild(headerRow);

  // Notes row
  const notesRow = document.createElement('div');
  notesRow.className = 'history-row notes-row';
  const notesLabel = document.createElement('div');
  notesLabel.className = 'history-label';
  notesLabel.innerHTML = `<div class="dot" style="background:#9e8f85"></div><span style="color:#9e8f85">Notes</span>`;
  const notesDots = document.createElement('div');
  notesDots.className = 'history-dots';
  days.forEach((dateStr, i) => {
    if (i > 0 && i % 7 === 0) {
      const sep = document.createElement('div');
      sep.className = 'week-sep';
      notesDots.appendChild(sep);
    }
    const dot = document.createElement('div');
    const allNotes = loadNotes();
    if (allNotes[dateStr]) {
      dot.className = 'day-dot note-dot filled';
      dot.title = allNotes[dateStr];
      dot.addEventListener('click', () => openNoteModal(dateStr, allNotes[dateStr]));
    } else {
      dot.className = 'day-dot note-dot';
    }
    if (dateStr === todayStr) dot.dataset.today = 'true';
    notesDots.appendChild(dot);
  });
  notesRow.appendChild(notesLabel);
  notesRow.appendChild(notesDots);
  container.appendChild(notesRow);

  HABITS.forEach(habit => {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.style.setProperty('--accent', habit.accent);

    const label = document.createElement('div');
    label.className = 'history-label';
    label.innerHTML = `<div class="dot"></div>${habit.name}`;

    const dotsWrapper = document.createElement('div');
    dotsWrapper.className = 'history-dots';

    days.forEach((dateStr, i) => {
      if (i > 0 && i % 7 === 0) {
        const sep = document.createElement('div');
        sep.className = 'week-sep';
        dotsWrapper.appendChild(sep);
      }
      const dot = document.createElement('div');
      dot.className = 'day-dot' + (isHabitDoneOn(data, habit.id, dateStr) ? ' filled' : '');
      dot.style.setProperty('--accent', habit.accent);
      dot.dataset.label = formatDateLabel(dateStr);
      if (dateStr === todayStr) dot.dataset.today = 'true';
      dotsWrapper.appendChild(dot);
    });

    row.appendChild(label);
    row.appendChild(dotsWrapper);
    container.appendChild(row);
  });
}

function openNoteModal(dateStr, text) {
  const d = new Date(dateStr + 'T12:00:00');
  document.getElementById('modal-date').textContent = d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  document.getElementById('modal-body').textContent = text;
  document.getElementById('modal-overlay').classList.add('open');
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.remove('open');
});

document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
});

migrateTimezone();
renderApp();
