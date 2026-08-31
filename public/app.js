import { SECTIONS, allSkills, findSkill } from './data.js';
import { api, isNoSession } from './api.js';
import { startLesson, speakKhmer, confettiBurst } from './lesson.js';

// We scroll to the learner's current position ourselves on every render — the
// browser's own scroll restoration would otherwise fight that with a stale position.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// Installable PWA: app shell + heard audio get cached so the installed app
// opens instantly and replays already-heard words offline.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js'));
}

const $app = () => document.getElementById('app');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Well-established Khmer aspirated/unaspirated consonant pairs, used by the
// Sound Gym "Minimal Pairs" trainer.
const MINIMAL_PAIRS = [
  ['ក', 'ខ'],
  ['ច', 'ឆ'],
  ['ត', 'ថ'],
  ['ប', 'ផ'],
  ['ដ', 'ឋ'],
  ['គ', 'ឃ'],
  ['ជ', 'ឈ'],
  ['ទ', 'ធ'],
  ['ព', 'ភ'],
];

const state = {
  userName: null,
  settings: { dailyGoal: 20, soundEffects: true },
  streak: 0,
  todayXp: 0,
  weekXp: [],
  weekTotal: 0,
  totalXp: 0,
  lessonsDone: 0,
  progress: {}, // lessonId -> {completions, bestScore}
  tab: 'learn', // 'learn' | 'soundgym' | 'practice'
};

const flatSkills = allSkills(); // fixed course order: script, then unit1..unit10

function applyState(s) {
  state.userName = s.userName;
  state.settings = s.settings;
  state.streak = s.streak;
  state.todayXp = s.todayXp;
  state.weekXp = s.weekXp;
  state.weekTotal = s.weekTotal;
  state.totalXp = s.totalXp;
  state.lessonsDone = s.lessonsDone;
  state.progress = s.progress;
}

async function refreshState() {
  applyState(await api.getState());
}

// Saves progress with a real retry loop instead of silently losing it, or
// (the old placement-test bug) showing a success screen even when the save
// to the server had actually failed. Returns whether the save landed.
async function saveProgressOrRetry(saveCall) {
  for (;;) {
    try {
      await saveCall();
      await refreshState();
      return true;
    } catch (e) {
      console.error(e);
      const retry = confirm(
        "Couldn't save your progress — check your connection.\n\nRetry? (Cancel leaves this session unsaved.)"
      );
      if (!retry) return false;
    }
  }
}

// ---------------- Chrome (topbar / tabs) ----------------

function topbar() {
  return `
    <div class="topbar">
      <div class="brand">🇰🇭 Khmer</div>
      <div class="stat streak ${state.streak > 0 ? 'lit' : ''}" title="Day streak"><span class="flame">🔥</span> ${state.streak}</div>
      <div class="stat xp" title="XP today">⚡ ${state.todayXp}/${state.settings.dailyGoal}</div>
      <button class="avatar-chip" id="open-settings" title="Settings">⚙️</button>
    </div>`;
}

function tabs() {
  const t = (id, icon, label) =>
    `<button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}">
       <span class="ticon">${icon}</span>${label}</button>`;
  return `<nav class="tabs">
    ${t('learn', '🏠', 'Learn')}
    ${t('soundgym', '🎧', 'Sound Gym')}
    ${t('practice', '💪', 'Practice')}
  </nav>`;
}

function wireChrome() {
  document.getElementById('open-settings').onclick = () => renderSettings();
  document.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => {
      state.tab = b.dataset.tab;
      renderMain();
    };
  });
}

// ---------------- Learn (the path) ----------------

function isUnlocked(globalIndex) {
  if (globalIndex === 0) return true;
  const prev = flatSkills[globalIndex - 1];
  return (state.progress[prev.id]?.completions || 0) > 0;
}

function learnView() {
  let gi = 0; // global index across the whole flattened course
  // The "current" skill is the first one that's unlocked but not yet done —
  // where the learner actually is in the course, so we can scroll there on render.
  let currentMarked = false;
  const sections = SECTIONS.map((sec) => {
    const skills = sec.skills
      .map((sk) => {
        const p = state.progress[sk.id];
        const done = (p?.completions || 0) > 0;
        const unlocked = isUnlocked(gi);
        gi++;
        const crowns = p?.completions ? '👑'.repeat(Math.min(5, p.completions)) : '';
        const isCurrent = unlocked && !done && !currentMarked;
        if (isCurrent) currentMarked = true;
        return `
        <div class="skill-row" ${isCurrent ? 'id="current-skill"' : ''}>
          <div class="skill ${done ? 'done' : ''} ${unlocked ? '' : 'locked'} ${sec.color === 'blue' ? 'section-blue' : ''}">
            <button class="skill-bubble ${sk.kind === 'letters' ? 'khmer' : ''}" data-skill="${sk.id}" ${unlocked ? '' : 'disabled'}>
              ${unlocked ? esc(sk.icon) : '🔒'}
            </button>
            <div class="skill-title">${esc(sk.title)}</div>
            <div class="crowns">${crowns}</div>
          </div>
        </div>`;
      })
      .join('');
    return `
      <div class="section-header ${sec.color}">
        <h2>${esc(sec.title)}</h2><p>${esc(sec.subtitle)}</p>
      </div>
      <div class="path">${skills}</div>`;
  }).join('');
  const takeTestBtn =
    state.lessonsDone === 0
      ? `<div class="duo-card" style="text-align:center">
           <p class="muted" style="margin-bottom:12px">Already know some Khmer? Skip ahead with a quick placement test.</p>
           <button class="btn blue wide" id="take-placement">🎯 Take the placement test</button>
         </div>`
      : '';
  return takeTestBtn + sections;
}

function wireLearn() {
  document.querySelectorAll('[data-skill]').forEach((b) => {
    b.onclick = () => launchLesson(b.dataset.skill);
  });
  const pt = document.getElementById('take-placement');
  if (pt) pt.onclick = () => startPlacementTest();
  const scrollToCurrent = () => document.getElementById('current-skill')?.scrollIntoView({ block: 'center' });
  scrollToCurrent();
  // Re-run once layout settles — right at page load the Khmer webfont can still
  // be swapping in and reflowing the page, which throws off the first scroll.
  setTimeout(scrollToCurrent, 100);
}

function launchLesson(skillId) {
  const skill = findSkill(skillId);
  if (!skill) return;
  startLesson(skill, {
    soundEffects: state.settings.soundEffects,
    onExit: () => renderMain(),
    onFinish: async ({ score, xp }) => {
      await saveProgressOrRetry(() => api.saveProgress(skillId, score, xp));
      renderMain();
    },
  });
}

// ---------------- Placement test ----------------

// The first skill the learner hasn't completed yet — skills unlock strictly in
// course order, so this is exactly where the course path currently sits.
// Retaking the test starts here instead of from the very beginning, so it's
// useful again after the first run (e.g. a friend who placed in, kept going
// with lessons for a while, and now wants to skip ahead further).
function firstIncompleteIndex() {
  for (let i = 0; i < flatSkills.length; i++) {
    if (!((state.progress[flatSkills[i].id]?.completions || 0) > 0)) return i;
  }
  return flatSkills.length;
}

// Two questions per skill, drawn from different items — but the second is
// only asked if the first is missed. One unlucky guess no longer wrongly
// stops the whole test; a skill is only marked failed (ending the test) if
// both tries on it are missed.
function buildPlacementQuestions(skills) {
  const answerText = (skill) => (o) => (skill.kind === 'letters' ? o.r : o.e);
  const makeTry = (skill, item) => {
    const pool = skill.items.filter((x) => x !== item);
    return { item, opts: shuffle([item, ...shuffle(pool).slice(0, 3)]) };
  };
  return skills.map((skill) => {
    const [first, second] = shuffle(skill.items).slice(0, 2);
    return { skill, answerText: answerText(skill), tries: [makeTry(skill, first), makeTry(skill, second || first)] };
  });
}

function startPlacementTest() {
  const startIndex = firstIncompleteIndex();
  const remaining = flatSkills.slice(startIndex);
  if (!remaining.length) {
    alert("You've already completed the whole course — no placement test needed!");
    return;
  }
  const questions = buildPlacementQuestions(remaining);
  let si = 0; // index into `questions` (one entry per skill)
  let attempt = 0; // 0 = first try, 1 = second chance on the same skill
  const passed = [];
  let ended = false; // guards against finishTest() running twice (quit + pending timer racing)
  let pendingTimer = null;

  function render() {
    if (si >= questions.length) return finishTest();
    const q = questions[si];
    const { item, opts } = q.tries[attempt];
    const pct = Math.round((si / questions.length) * 100);
    $app().innerHTML = `
      <div class="lesson-top">
        <button class="lesson-quit" id="quit" title="Stop test">✕</button>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="exercise">
        <h3>Placement test · ${esc(q.skill.title)}</h3>
        ${attempt === 1 ? '<div class="intro-note">🎲 One more try on this skill</div>' : ''}
        <div class="prompt-big khmer">${esc(item.k)}</div>
        <div class="choices single-col">
          ${opts
            .map(
              (o, oi) =>
                `<button class="choice" data-i="${oi}" data-ok="${o === item}">${esc(q.answerText(o))}</button>`
            )
            .join('')}
        </div>
      </div>`;
    document.getElementById('quit').onclick = () => {
      if (confirm("Stop the test? Skills you've already passed will still be saved.")) {
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        finishTest();
      }
    };
    document.querySelectorAll('.choice').forEach((c) => {
      c.onclick = () => {
        const ok = c.dataset.ok === 'true';
        document.querySelectorAll('.choice').forEach((x) => {
          x.disabled = true;
          if (x.dataset.ok === 'true') x.classList.add('correct');
        });
        if (!ok) c.classList.add('wrong');
        pendingTimer = setTimeout(
          () => {
            pendingTimer = null;
            if (ok) {
              passed.push(q.skill.id);
              si++;
              attempt = 0;
              render();
            } else if (attempt === 0) {
              attempt = 1;
              render();
            } else {
              finishTest();
            }
          },
          ok ? 250 : 900
        );
      };
    });
  }

  async function finishTest() {
    if (ended) return;
    ended = true;
    // Whether the placement result is actually saved server-side. Used to
    // decide which end screen to show — a prior bug here showed the success
    // screen unconditionally, even when the save had silently failed, so
    // people would ace the test and still find themselves back at lesson one.
    let saved = true;
    if (passed.length) {
      const xp = Math.min(200, passed.length * 5);
      saved = await saveProgressOrRetry(() => api.placement(passed, xp));
    } else {
      await refreshState().catch((e) => console.error(e));
    }
    if (saved && passed.length) confettiBurst();
    $app().innerHTML = saved
      ? `
      <div class="lesson-end">
        <div class="big-emoji">🎯</div>
        <h2>Placed you through ${passed.length} skill${passed.length === 1 ? '' : 's'}!</h2>
        <p class="muted" style="text-align:center;margin-bottom:24px">
          Everything up to there is marked complete — pick up right where you left off.</p>
        <button class="btn wide" id="end-continue">Go to Learn</button>
      </div>`
      : `
      <div class="lesson-end">
        <div class="big-emoji">⚠️</div>
        <h2>Couldn't save your placement</h2>
        <p class="muted" style="text-align:center;margin-bottom:24px">
          Your test results weren't saved to the server, so nothing was marked complete.
          Check your connection and retake the test.</p>
        <button class="btn wide" id="end-continue">Go to Learn</button>
      </div>`;
    document.getElementById('end-continue').onclick = () => {
      state.tab = 'learn';
      renderMain();
    };
  }

  render();
}

// ---------------- Sound Gym ----------------

function consonantPool() {
  return SECTIONS.find((s) => s.id === 'script')
    .skills.filter((sk) => sk.id.startsWith('cons'))
    .flatMap((sk) => sk.items);
}

function soundGymView() {
  return `
    <div class="duo-card">
      <h3>🎵 Series Trainer</h3>
      <p class="muted">Hear a consonant — is it 1st series or 2nd series? Changes how every vowel after it sounds.</p>
      <button class="btn blue wide" id="train-series" style="margin-top:12px">Train Series</button>
    </div>
    <div class="duo-card">
      <h3>👂 Minimal Pairs</h3>
      <p class="muted">Two letters that sound almost alike (aspirated vs. not) — pick the one you heard.</p>
      <button class="btn blue wide" id="train-pairs" style="margin-top:12px">Train Ears</button>
    </div>
    <div class="duo-card">
      <h3>📖 Sound guide</h3>
      <p class="muted">How to read the romanization used throughout this app.</p>
      <button class="btn ghost wide" id="open-guide" style="margin-top:12px">Open Guide</button>
    </div>`;
}

function wireSoundGym() {
  document.getElementById('train-series').onclick = () => startSeriesTrainer();
  document.getElementById('train-pairs').onclick = () => startMinimalPairs();
  document.getElementById('open-guide').onclick = () => renderSoundGuide();
}

function startSeriesTrainer() {
  const pool = consonantPool();
  const rounds = shuffle(pool).slice(0, 8);
  let i = 0;
  let correct = 0;

  function render() {
    if (i >= rounds.length) return finish();
    const item = rounds[i];
    const series = item.e.includes('1st series') ? '1st series' : '2nd series';
    $app().innerHTML = `
      <div class="lesson-top">
        <button class="lesson-quit" id="quit">✕</button>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.round((i / rounds.length) * 100)}%"></div></div>
      </div>
      <div class="exercise">
        <h3>🎵 Which series?</h3>
        <div class="prompt-big khmer">${esc(item.k)} <button class="speak-btn" data-speak="${esc(item.k)}">🔊</button></div>
        <div class="choices">
          <button class="choice" data-ok="${series === '1st series'}">1st series</button>
          <button class="choice" data-ok="${series === '2nd series'}">2nd series</button>
        </div>
      </div>`;
    document.getElementById('quit').onclick = () => renderMain();
    document.querySelectorAll('[data-speak]').forEach((b) => (b.onclick = () => speakKhmer(b.dataset.speak)));
    speakKhmer(item.k);
    document.querySelectorAll('.choice').forEach((c) => {
      c.onclick = () => {
        const ok = c.dataset.ok === 'true';
        if (ok) correct++;
        document.querySelectorAll('.choice').forEach((x) => (x.disabled = true));
        c.classList.add(ok ? 'correct' : 'wrong');
        if (!ok) setTimeout(() => speakKhmer(item.k, 0.7), 350);
        setTimeout(() => {
          i++;
          render();
        }, 500);
      };
    });
  }

  function finish() {
    if (correct === rounds.length) confettiBurst();
    $app().innerHTML = `
      <div class="lesson-end">
        <div class="big-emoji">🎵</div>
        <h2>${correct}/${rounds.length} correct</h2>
        <button class="btn wide" id="end-continue">Continue</button>
      </div>`;
    document.getElementById('end-continue').onclick = () => renderMain();
  }

  render();
}

function startMinimalPairs() {
  const rounds = shuffle(MINIMAL_PAIRS.slice()).slice(0, 8);
  let i = 0;
  let correct = 0;

  function render() {
    if (i >= rounds.length) return finish();
    const [a, b] = shuffle(rounds[i]);
    const played = Math.random() < 0.5 ? a : b;
    $app().innerHTML = `
      <div class="lesson-top">
        <button class="lesson-quit" id="quit">✕</button>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.round((i / rounds.length) * 100)}%"></div></div>
      </div>
      <div class="exercise">
        <h3>👂 Which one did you hear?</h3>
        <div class="listen-row">
          <button class="audio-big" id="replay" data-speak="${esc(played)}">🔊</button>
        </div>
        <div class="choices">
          <button class="choice" data-ok="${played === a}"><span class="kh khmer">${esc(a)}</span></button>
          <button class="choice" data-ok="${played === b}"><span class="kh khmer">${esc(b)}</span></button>
        </div>
      </div>`;
    document.getElementById('quit').onclick = () => renderMain();
    document.getElementById('replay').onclick = () => speakKhmer(played);
    speakKhmer(played);
    document.querySelectorAll('.choice').forEach((c) => {
      c.onclick = () => {
        const ok = c.dataset.ok === 'true';
        if (ok) correct++;
        document.querySelectorAll('.choice').forEach((x) => (x.disabled = true));
        c.classList.add(ok ? 'correct' : 'wrong');
        if (!ok) setTimeout(() => speakKhmer(played, 0.7), 350);
        setTimeout(() => {
          i++;
          render();
        }, 500);
      };
    });
  }

  function finish() {
    if (correct === rounds.length) confettiBurst();
    $app().innerHTML = `
      <div class="lesson-end">
        <div class="big-emoji">👂</div>
        <h2>${correct}/${rounds.length} correct</h2>
        <button class="btn wide" id="end-continue">Continue</button>
      </div>`;
    document.getElementById('end-continue').onclick = () => renderMain();
  }

  render();
}

function soundGuideHtml() {
  return `
    <div class="intro-note" style="margin-bottom:16px">
      Khmer consonants come in <strong>two series</strong> — the same vowel sounds
      different depending which series the preceding consonant belongs to. That's
      why every vowel skill lists two sounds ("1st / 2nd").
    </div>
    <div class="duo-card">
      <p><strong>â / ô</strong> — schwa-like vowels baked into consonants with no vowel sign (1st series â, 2nd series ô).</p>
      <p><strong>Doubled letters (aa, ei, ou…)</strong> — hold the vowel a little longer.</p>
      <p><strong>kh / th / ph / chh</strong> — aspirated: a little puff of air. Their unaspirated partners (k / t / p / ch) have none — practice the difference in Sound Gym's Minimal Pairs.</p>
      <p><strong>ng</strong> — like the "ng" in "sing", but in Khmer it can also start a word.</p>
      <p><strong>ŏ / œ</strong> — vowels with no close English equivalent; lean on the audio more than the spelling here.</p>
    </div>`;
}

function renderSoundGuide() {
  const prevTab = state.tab;
  $app().innerHTML = `
    <div class="lesson-top">
      <button class="lesson-quit" id="quit">✕</button>
      <h3 style="margin-left:8px">📖 Sound guide</h3>
    </div>
    <div class="exercise">${soundGuideHtml()}</div>`;
  document.getElementById('quit').onclick = () => {
    state.tab = prevTab;
    renderMain();
  };
}

// ---------------- Practice (smart practice / weakest skills) ----------------

function weakestSkills(limit = 3) {
  const completed = flatSkills.filter((sk) => (state.progress[sk.id]?.completions || 0) > 0);
  if (!completed.length) return [];
  return [...completed]
    .sort((a, b) => (state.progress[a.id].bestScore || 0) - (state.progress[b.id].bestScore || 0))
    .slice(0, limit);
}

function practiceView() {
  const weakest = weakestSkills();
  if (!weakest.length) {
    return `
      <div class="duo-card">
        <h3>💪 Smart practice</h3>
        <p class="muted">A mixed session from your weakest skills — the fastest way to keep everything fresh.</p>
        <div class="empty">Complete your first lesson on the Learn tab, then your skills appear here for review. 🌱</div>
      </div>`;
  }
  return `
    <div class="duo-card">
      <h3>💪 Smart practice</h3>
      <p class="muted">A mixed session from your weakest skills — the fastest way to keep everything fresh.</p>
      <p class="muted" style="margin-top:8px">Today's mix: ${weakest.map((s) => esc(s.title)).join(', ')}</p>
      <button class="btn wide" id="practice-weakest" style="margin-top:12px">Practice Weakest (+10 XP)</button>
    </div>`;
}

function wirePractice() {
  const btn = document.getElementById('practice-weakest');
  if (btn) btn.onclick = () => startSmartPractice();
}

function startSmartPractice() {
  const weakest = weakestSkills();
  // The synthetic skill is always 'vocab' kind (answer = item.e). Letter-skill
  // items normally answer with item.r instead, so fold that into e here —
  // otherwise pooled letters would display their raw "e" label (e.g. "th —
  // 1st series") instead of the actual romanized sound.
  const pooled = shuffle(
    weakest.flatMap((sk) => sk.items.map((it) => (sk.kind === 'letters' ? { ...it, e: it.r } : { ...it })))
  ).slice(0, 12);
  const synthetic = { id: 'practice', title: 'Smart Practice', kind: 'vocab', items: pooled };
  startLesson(synthetic, {
    skipTeach: true,
    maxXp: 10,
    soundEffects: state.settings.soundEffects,
    onExit: () => renderMain(),
    onFinish: async ({ score, xp }) => {
      await saveProgressOrRetry(() => api.saveProgress('practice', score, xp));
      renderMain();
    },
  });
}

// ---------------- Settings ----------------

function renderSettings() {
  $app().innerHTML = `
    <div class="lesson-top">
      <button class="lesson-quit" id="quit">✕</button>
      <h3 style="margin-left:8px">⚙️ Settings</h3>
    </div>
    <div class="exercise">
      <div class="duo-card">
        <h3>Sound effects</h3>
        <div class="choices">
          <button class="choice ${state.settings.soundEffects ? 'selected' : ''}" data-sfx="true">🔔 On</button>
          <button class="choice ${!state.settings.soundEffects ? 'selected' : ''}" data-sfx="false">🔕 Off</button>
        </div>
      </div>
      <div class="duo-card">
        <h3>Daily goal</h3>
        <div style="display:flex;gap:10px;align-items:center">
          <input id="goal-input" type="number" min="10" step="10" value="${state.settings.dailyGoal}"
            style="font:inherit;padding:10px;border:2px solid var(--line);border-radius:12px;width:110px" />
          <span class="muted">XP per day</span>
          <button class="btn blue" id="save-goal" style="margin-left:auto">Save</button>
        </div>
      </div>
      <div class="duo-card">
        <h3>Your stats</h3>
        <p>${state.userName ? `👤 ${esc(state.userName)} · ` : ''}⭐ ${state.totalXp} total XP · 🔥 ${state.streak} day streak · 📚 ${state.lessonsDone} lessons done</p>
      </div>
      <button class="btn blue wide" id="retake-placement" style="margin-bottom:12px">🎯 Retake placement test</button>
      <button class="btn ghost wide" id="open-guide" style="margin-bottom:12px">📖 How to read the sounds</button>
      <button class="btn ghost wide" id="switch-profile" style="margin-bottom:12px">🔀 Switch profile</button>
      <button class="btn red wide" id="reset-all">Reset all progress</button>
    </div>`;
  document.getElementById('quit').onclick = () => renderMain();
  document.getElementById('retake-placement').onclick = () => startPlacementTest();
  document.getElementById('open-guide').onclick = () => renderSoundGuide();
  document.getElementById('switch-profile').onclick = async () => {
    try {
      await api.logout();
    } catch (e) {
      console.error(e);
    }
    renderProfilePicker();
  };
  document.querySelectorAll('[data-sfx]').forEach((b) => {
    b.onclick = async () => {
      await api.updateSettings({ soundEffects: b.dataset.sfx === 'true' });
      await refreshState();
      renderSettings();
    };
  });
  document.getElementById('save-goal').onclick = async () => {
    const v = parseInt(document.getElementById('goal-input').value, 10);
    if (!v || v < 10) return;
    await api.updateSettings({ dailyGoal: v });
    await refreshState();
    renderSettings();
  };
  document.getElementById('reset-all').onclick = async () => {
    if (!confirm('Reset ALL progress and streaks? This cannot be undone.')) return;
    await api.resetAll();
    await refreshState();
    renderWelcome();
  };
}

// ---------------- Profile picker (no password — pick or type a name) ----------------

async function renderProfilePicker() {
  let users = [];
  try {
    users = await api.getUsers();
  } catch (e) {
    console.error(e);
  }
  $app().innerHTML = `
    <div class="setup">
      <h1>🇰🇭 Khmer Practice</h1>
      <p>Who's learning?</p>
      ${
        users.length
          ? `<div class="choices single-col" id="profile-list" style="margin-bottom:16px">
               ${users
                 .map((u) => `<button class="choice" data-user="${esc(u.name)}">${esc(u.name)}</button>`)
                 .join('')}
             </div>`
          : ''
      }
      <div style="display:flex;gap:10px;max-width:360px;margin:0 auto">
        <input id="profile-name" type="text" placeholder="Type your name" maxlength="40"
          style="flex:1;font:inherit;padding:10px;border:2px solid var(--line);border-radius:12px" />
        <button class="btn blue" id="profile-go">Go</button>
      </div>
      <p class="muted" style="text-align:center;margin-top:12px">No password — typing an existing name signs back into that profile.</p>
    </div>`;

  async function chooseName(name) {
    const clean = name.trim();
    if (!clean) return;
    try {
      await api.startSession(clean);
      await init();
    } catch (e) {
      console.error(e);
      alert("Couldn't start your session — check your connection and try again.");
    }
  }

  document.querySelectorAll('[data-user]').forEach((b) => {
    b.onclick = () => chooseName(b.dataset.user);
  });
  document.getElementById('profile-go').onclick = () =>
    chooseName(document.getElementById('profile-name').value);
  document.getElementById('profile-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') chooseName(document.getElementById('profile-name').value);
  });
}

// ---------------- Welcome (first run only) ----------------

function renderWelcome() {
  $app().innerHTML = `
    <div class="setup">
      <h1>🇰🇭 Khmer Practice</h1>
      <p>Start from the beginning, or take a quick placement test if you already know some Khmer.</p>
      <button class="btn wide" id="start-fresh" style="max-width:360px;margin:0 auto 12px">Start from the beginning</button>
      <button class="btn blue wide" id="take-placement" style="max-width:360px;margin:0 auto">🎯 Take the placement test</button>
    </div>`;
  document.getElementById('start-fresh').onclick = () => {
    state.tab = 'learn';
    renderMain();
  };
  document.getElementById('take-placement').onclick = () => startPlacementTest();
}

// ---------------- Main render ----------------

function renderMain() {
  let body = '';
  if (state.tab === 'learn') body = learnView();
  else if (state.tab === 'soundgym') body = soundGymView();
  else if (state.tab === 'practice') body = practiceView();
  $app().innerHTML = topbar() + body + tabs();
  wireChrome();
  if (state.tab === 'learn') wireLearn();
  else if (state.tab === 'soundgym') wireSoundGym();
  else if (state.tab === 'practice') wirePractice();
}

async function init() {
  try {
    await refreshState();
  } catch (e) {
    if (isNoSession(e)) return renderProfilePicker();
    console.error(e);
    alert("Couldn't reach the server — check your connection and reload.");
    return;
  }
  if (state.lessonsDone === 0 && Object.keys(state.progress).length === 0) {
    renderWelcome();
  } else {
    renderMain();
  }
}

init();
