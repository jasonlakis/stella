// ─── Supabase setup ───────────────────────────────────────────────────────────
// Replace these two values with your project's URL and anon key from:
// Supabase dashboard → Project Settings → API
const SUPABASE_URL      = 'https://joqustywpthbuqgrquhh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvcXVzdHl3cHRoYnVxZ3JxdWhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODg4MjAsImV4cCI6MjA5MDA2NDgyMH0.-eaUIe4ZGdW2nEW-HrWeokuBYdQqVvsCWzfeNEW6ovA';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// ─── Habits config ────────────────────────────────────────────────────────────
const HABITS = [
  { id: 'meditation', name: 'Meditation', icon: 'images/meditation.svg', accent: '#993C66' },
  { id: 'yoga',       name: 'Yoga',       icon: 'images/yoga.svg',       accent: '#8CBEB2' },
  { id: 'strength',   name: 'Strength',   icon: 'images/strength.svg',   accent: '#F3B562' },
  { id: 'cardio',     name: 'Cardio',     icon: 'images/cardio.svg',     accent: '#F06060' },
  { id: 'sauna',      name: 'Sauna',      icon: 'images/sauna.svg',      accent: '#DDCC62' },
];

// ─── Current user ─────────────────────────────────────────────────────────────
let currentUserId = null;

// ─── Local cache ──────────────────────────────────────────────────────────────
// localStorage is used as a local mirror of Supabase so the UI renders instantly.
// Supabase is always the source of truth.
const STORAGE_KEY = 'habit_tracker_data';
const NOTES_KEY   = 'habit_tracker_notes';

function loadData()  { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } }
function loadNotes() { try { return JSON.parse(localStorage.getItem(NOTES_KEY))   || {}; } catch { return {}; } }
function saveDataLocal(data)   { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function saveNotesLocal(notes) { localStorage.setItem(NOTES_KEY,   JSON.stringify(notes)); }

// ─── Supabase sync ────────────────────────────────────────────────────────────

// Fetch all data for the current user and update the local cache.
// Returns { habitRows, noteRows } on success, or false on error.
async function syncFromSupabase(userId) {
  console.log('[sync] starting, userId:', userId);
  console.log('[sync] userId:', userId);

  console.log('[sync] fetching habit_data...');
  const { data: habitRows, error: hErr } = await sb.from('habit_data').select('date, habit_id');
  console.log('[sync] habit_data done:', habitRows?.length, hErr);

  console.log('[sync] fetching notes...');
  const { data: noteRows, error: nErr } = await sb.from('notes').select('date, note');
  console.log('[sync] notes done:', noteRows?.length, nErr);

  console.log('[sync] habitRows:', habitRows?.length, 'hErr:', hErr);
  console.log('[sync] noteRows:', noteRows?.length, 'nErr:', nErr);

  if (hErr || nErr) {
    const err = hErr || nErr;
    console.error('Sync error:', err);
    if (err.status === 401) {
      await sb.auth.signOut();
      showAuth();
    }
    return false;
  }

  if (habitRows.length === 0 && noteRows.length === 0) {
    console.log('[sync] Supabase returned 0 rows — skipping overwrite');
    return { habitRows, noteRows };
  }

  // Build cloud data map
  const cloudData = {};
  for (const { date, habit_id } of habitRows) {
    if (!cloudData[date]) cloudData[date] = {};
    cloudData[date][habit_id] = true;
  }

  // Merge: keep local dates not in cloud (they may have been saved without user_id).
  // Cloud data wins for any date present in both.
  const localData = loadData();
  const merged = { ...localData };
  for (const [date, habits] of Object.entries(cloudData)) {
    merged[date] = habits;
  }

  // Push any local-only dates up to Supabase with the correct user_id.
  if (userId) {
    const repairRows = [];
    for (const [date, habits] of Object.entries(localData)) {
      if (!cloudData[date]) {
        for (const [habit_id, done] of Object.entries(habits)) {
          if (done) repairRows.push({ user_id: userId, date, habit_id });
        }
      }
    }
    console.log('[sync] cloudDates:', Object.keys(cloudData));
    console.log('[sync] localDates:', Object.keys(localData));
    console.log('[sync] repairRows:', repairRows);
    if (repairRows.length) {
      const { error } = await sb.from('habit_data').upsert(repairRows, { onConflict: 'user_id,date,habit_id' });
      if (error) console.error('Repair upsert error:', error);
      else console.log('[sync] repair upsert succeeded');
    }
  }

  saveDataLocal(merged);

  const cloudNotes = {};
  for (const { date, note } of noteRows) cloudNotes[date] = note;
  const localNotes = loadNotes();
  saveNotesLocal({ ...localNotes, ...cloudNotes });

  return { habitRows, noteRows };
}

// Push existing localStorage data up to Supabase.
// Called once on first login if the user has local history but no cloud data.
async function pushLocalToSupabase() {
  const userId = currentUserId;
  const data  = loadData();
  const notes = loadNotes();

  const habitRows = [];
  for (const [date, habits] of Object.entries(data)) {
    for (const [habit_id, done] of Object.entries(habits)) {
      if (done) habitRows.push({ user_id: userId, date, habit_id });
    }
  }
  const noteRows = Object.entries(notes).map(([date, note]) => ({ user_id: userId, date, note }));

  const ops = [];
  if (habitRows.length) ops.push(sb.from('habit_data').upsert(habitRows, { onConflict: 'user_id,date,habit_id' }));
  if (noteRows.length)  ops.push(sb.from('notes').upsert(noteRows,  { onConflict: 'user_id,date' }));
  await Promise.all(ops);
}

async function upsertHabit(dateStr, habitId, done) {
  const userId = currentUserId;
  if (done) {
    const { error } = await sb.from('habit_data').upsert(
      { user_id: userId, date: dateStr, habit_id: habitId },
      { onConflict: 'user_id,date,habit_id' }
    );
    if (error) console.error('upsertHabit error:', error);
  } else {
    const { error } = await sb.from('habit_data').delete().eq('date', dateStr).eq('habit_id', habitId);
    if (error) console.error('deleteHabit error:', error);
  }
}

let noteDebounceTimer = null;
function scheduleNoteSync(dateStr, text) {
  clearTimeout(noteDebounceTimer);
  noteDebounceTimer = setTimeout(async () => {
    const userId = currentUserId;
    if (text.trim()) {
      await sb.from('notes').upsert({ user_id: userId, date: dateStr, note: text }, { onConflict: 'user_id,date' });
    } else {
      await sb.from('notes').delete().eq('date', dateStr);
    }
  }, 1000);
}

// ─── Tennis tips ──────────────────────────────────────────────────────────────
const TENNIS_TIPS = [
  "Keep your eye on the ball all the way through contact — watch it hit your strings.",
  "On your serve, toss the ball slightly in front of you to naturally drive weight forward.",
  "Between points, take a slow breath and reset your focus before the next rally.",
  "Follow through fully on groundstrokes — a short swing usually means a short shot.",
  "Stay on the balls of your feet so you can split-step and react in any direction.",
  "Aim for a target area, not just 'in' — pick a cone-sized zone on every shot.",
  "On the return of serve, start your backswing early as the ball is still rising.",
  "Use your non-dominant arm for balance; let it guide your backswing on the forehand.",
  "When pulled wide, recover toward the center mark, not toward your previous position.",
  "A relaxed grip through the swing generates more racket-head speed than squeezing tight.",
  "Approach shots should be deep and down the line — don't give your opponent angles.",
  "At the net, keep the racket face slightly open and use a short, punchy volley motion.",
  "Watch your opponent's body and racket angle to anticipate direction before they hit.",
  "On topspin groundstrokes, brush up the back of the ball — low to high, hip to shoulder.",
  "A consistent, reliable second serve is more valuable than a flashy, risky one.",
  "Use the whole court strategically: open it up wide, then close it with a winner down the line.",
  "After a big point, reset mentally — treat each game as its own fresh start.",
  "Position your feet sideways to the net when hitting, not squared up.",
  "Practice your weakest shot in warm-up, not just your favorite one.",
  "When serving into the sun, adjust your toss to a lower height or shift your position.",
  "Slice backhands are excellent neutralizers — use them to stay in a tough rally.",
  "On overheads, point your non-hitting hand at the ball to track it and align your body.",
  "Don't go for too much on the first ball after a weak return — build the point first.",
  "Play high-percentage tennis in big moments: more net clearance, less line-hugging.",
  "Footwork is the foundation — good shots start with getting in position early.",
  "Use the kick serve to force a high bouncing ball into the opponent's backhand.",
  "When your opponent is at the net, a sharp, low passing shot beats a lob most of the time.",
  "Take big swings on practice balls; take big swings on match balls — trust your technique.",
  "A calm mind between points is a competitive advantage as real as any stroke.",
  "Record yourself playing occasionally — video reveals habits you can't feel in the moment.",
];

function renderTennisTip() {
  const today = new Date();
  const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
  const tip = TENNIS_TIPS[dayOfYear % TENNIS_TIPS.length];
  document.getElementById('tennis-tip-text').textContent = tip;
}

// ─── App logic ────────────────────────────────────────────────────────────────
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isHabitDoneOn(data, habitId, dateStr) {
  return !!(data[dateStr] && data[dateStr][habitId]);
}

function getStreak(data, habitId, todayStr) {
  let streak = 0;
  const d = new Date(todayStr + 'T12:00:00');
  while (true) {
    if (isHabitDoneOn(data, habitId, toDateStr(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
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
  const data     = loadData();
  const today    = new Date();
  const todayStr = toDateStr(today);

  document.getElementById('today-date').textContent = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  renderTennisTip();

  // Habit cards
  const grid = document.getElementById('habits-grid');
  grid.innerHTML = '';

  HABITS.forEach(habit => {
    const done   = isHabitDoneOn(data, habit.id, todayStr);
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
      if (!current[todayStr]) current[todayStr] = {};
      const nowDone = !current[todayStr][habit.id];
      if (nowDone) {
        current[todayStr][habit.id] = true;
      } else {
        delete current[todayStr][habit.id];
        if (Object.keys(current[todayStr]).length === 0) delete current[todayStr];
      }
      saveDataLocal(current);
      upsertHabit(todayStr, habit.id, nowDone);
      renderApp();
    });
    grid.appendChild(card);
  });

  // Notes
  const notesEl = document.getElementById('today-notes');
  const notes   = loadNotes();
  notesEl.value = notes[todayStr] || '';
  notesEl.oninput = () => {
    const text      = notesEl.value;
    const allNotes  = loadNotes();
    if (text.trim()) {
      allNotes[todayStr] = text;
    } else {
      delete allNotes[todayStr];
    }
    saveNotesLocal(allNotes);
    scheduleNoteSync(todayStr, text);
  };

  // History — date header row
  const days      = getLast30Days(todayStr);
  const container = document.getElementById('history-container');
  container.innerHTML = '';

  const headerRow = document.createElement('div');
  headerRow.className = 'history-row history-header';
  const headerSpacer = document.createElement('div');
  headerSpacer.className = 'history-label';
  const headerDots = document.createElement('div');
  headerDots.className = 'history-dots';
  days.forEach((dateStr, i) => {
    if (i > 0 && new Date(dateStr + 'T12:00:00').getDay() === 1) {
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

  // History — notes row
  const notesRow = document.createElement('div');
  notesRow.className = 'history-row notes-row';
  const notesLabel = document.createElement('div');
  notesLabel.className = 'history-label';
  notesLabel.innerHTML = `<div class="dot" style="background:#9e8f85"></div><span style="color:#9e8f85">Notes</span>`;
  const notesDots = document.createElement('div');
  notesDots.className = 'history-dots';
  const allNotes = loadNotes();
  days.forEach((dateStr, i) => {
    if (i > 0 && new Date(dateStr + 'T12:00:00').getDay() === 1) {
      const sep = document.createElement('div');
      sep.className = 'week-sep';
      notesDots.appendChild(sep);
    }
    const dot = document.createElement('div');
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

  // History — habit rows
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
      if (i > 0 && new Date(dateStr + 'T12:00:00').getDay() === 1) {
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
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
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

// ─── Auth UI ──────────────────────────────────────────────────────────────────
function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

let isSignUp = false;

document.getElementById('auth-toggle').addEventListener('click', () => {
  isSignUp = !isSignUp;
  document.getElementById('auth-submit').textContent = isSignUp ? 'Sign Up' : 'Sign In';
  document.getElementById('auth-toggle').textContent = isSignUp
    ? 'Already have an account? Sign in'
    : 'Need an account? Sign up';
  document.getElementById('auth-message').textContent = '';
  document.getElementById('auth-message').className = 'auth-message';
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = document.getElementById('auth-email').value;
  const password = document.getElementById('auth-password').value;
  const msgEl    = document.getElementById('auth-message');
  const submitEl = document.getElementById('auth-submit');

  submitEl.disabled = true;
  submitEl.textContent = isSignUp ? 'Signing up...' : 'Signing in...';
  msgEl.textContent = '';
  msgEl.className = 'auth-message';

  if (isSignUp) {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) {
      msgEl.textContent = error.message;
      msgEl.classList.add('error');
      submitEl.disabled = false;
      submitEl.textContent = 'Sign Up';
    } else if (data.user && !data.session) {
      // Email confirmation required
      msgEl.textContent = 'Check your email to confirm your account, then sign in.';
      msgEl.classList.add('success');
      submitEl.disabled = false;
      submitEl.textContent = 'Sign Up';
    }
    // If data.session exists, onAuthStateChange fires and takes over
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      msgEl.textContent = error.message;
      msgEl.classList.add('error');
      submitEl.disabled = false;
      submitEl.textContent = 'Sign In';
    }
    // On success, onAuthStateChange fires and takes over
  }
});

document.getElementById('signout-btn').addEventListener('click', () => {
  currentUserId = null;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(NOTES_KEY);
  showAuth();
  sb.auth.signOut(); // fire-and-forget; onAuthStateChange will also fire when it completes
});

// ─── Init ─────────────────────────────────────────────────────────────────────
sb.auth.onAuthStateChange(async (event, session) => {
  console.log('[auth] event:', event, 'session:', !!session);
  if (event === 'TOKEN_REFRESH_FAILED') {
    currentUserId = null;
    await sb.auth.signOut(); // clears the stale token from localStorage
    showAuth();
    return;
  }

  if (!session) {
    currentUserId = null;
    showAuth();
    return;
  }

  currentUserId = session.user.id;
  showApp();
  renderApp(); // Render immediately from local cache while we fetch

  const result = await syncFromSupabase(currentUserId);

  // First-time login: if the cloud is empty but localStorage has data, migrate it up.
  if (result && result.habitRows.length === 0 && result.noteRows.length === 0) {
    const hasLocal =
      Object.keys(loadData()).length > 0 || Object.keys(loadNotes()).length > 0;
    if (hasLocal) await pushLocalToSupabase();
  }

  renderApp(); // Re-render with fresh data from Supabase
});
