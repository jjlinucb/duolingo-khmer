import { SECTIONS, findSkill } from './data.js';
import { api } from './api.js';
import { startLesson, speakKhmer } from './lesson.js';

const $app = () => document.getElementById('app');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

const state = {
  users: [],
  me: null, // full user summary object
  progress: {}, // lessonId -> {completions, bestScore}
  tab: 'learn',
  dueCount: 0,
};

function partner() {
  return state.users.find((u) => u.id !== state.me.id) || null;
}

async function refreshUsers() {
  state.users = await api.getUsers();
  if (state.me) state.me = state.users.find((u) => u.id === state.me.id) || null;
}

async function loadMe(userId) {
  state.me = state.users.find((u) => u.id === userId);
  localStorage.setItem('khmerMeId', userId);
  state.progress = await api.getProgress(userId);
  const due = await api.getDue(userId);
  state.dueCount = due.due.length;
}

// ---------------- Views ----------------

function topbar() {
  const m = state.me;
  return `
    <div class="topbar">
      <div class="brand">🇰🇭 Khmer</div>
      <div class="stat streak" title="Day streak">🔥 ${m.streak}</div>
      <div class="stat xp" title="XP today">⚡ ${m.todayXp}</div>
      <button class="avatar-chip" id="switch-user" title="Switch profile">${esc(m.avatar)} ${esc(m.name)}</button>
    </div>`;
}

function tabs() {
  const t = (id, icon, label) =>
    `<button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}">
       <span class="ticon">${icon}</span>${label}</button>`;
  return `<nav class="tabs">
    ${t('learn', '📖', 'Learn')}
    ${t('words', '📒', 'Our Words')}
    ${t('together', '👫', 'Together')}
  </nav>`;
}

function wireChrome() {
  document.getElementById('switch-user').onclick = () => renderUserPick();
  document.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => {
      state.tab = b.dataset.tab;
      renderMain();
    };
  });
}

// ---- Learn (the path) ----
function isUnlocked(sectionIdx, skillIdx) {
  if (skillIdx === 0) return true; // each section's first skill is open
  const prev = SECTIONS[sectionIdx].skills[skillIdx - 1];
  return (state.progress[prev.id]?.completions || 0) > 0;
}

function learnView() {
  const reviewBanner =
    state.dueCount > 0
      ? `<div class="review-banner">
           <div class="cnt">${state.dueCount}</div>
           <div><strong>words from your tutor are due for review</strong>
             <div class="muted">Spaced repetition keeps them in memory</div></div>
           <button class="btn blue" id="start-review" style="margin-left:auto">Review</button>
         </div>`
      : '';
  const sections = SECTIONS.map((sec, si) => {
    const skills = sec.skills
      .map((sk, ki) => {
        const p = state.progress[sk.id];
        const done = (p?.completions || 0) > 0;
        const unlocked = isUnlocked(si, ki);
        const crowns = p?.completions ? '👑'.repeat(Math.min(3, p.completions)) : '';
        return `
        <div class="skill-row">
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
  return reviewBanner + sections;
}

function wireLearn() {
  document.querySelectorAll('[data-skill]').forEach((b) => {
    b.onclick = () => launchLesson(b.dataset.skill);
  });
  const rev = document.getElementById('start-review');
  if (rev) rev.onclick = startReviewSession;
}

function launchLesson(skillId) {
  const skill = findSkill(skillId);
  if (!skill) return;
  startLesson(skill, {
    onExit: () => renderMain(),
    onFinish: async ({ score, xp }) => {
      const res = await api.saveProgress(state.me.id, skillId, score, xp);
      state.me = res.user;
      state.progress = await api.getProgress(state.me.id);
      await refreshUsers();
      state.me = state.users.find((u) => u.id === state.me.id);
      renderMain();
    },
  });
}

// ---- Together (couple dashboard) ----
function togetherView() {
  const me = state.me;
  const p = partner();
  const userBlock = (u, isMe) => {
    if (!u) return '';
    const pct = Math.min(100, Math.round((u.weekTotal / u.weeklyGoal) * 100));
    return `
      <div class="user-row">
        <div class="uavatar">${esc(u.avatar)}</div>
        <div style="flex:1">
          <div class="uname">${esc(u.name)} ${isMe ? '<span class="muted">(you)</span>' : ''}</div>
          <div class="usub">🔥 ${u.streak}-day streak · ${u.totalXp} XP total · ${u.lessonsDone} lessons</div>
          <div class="goal-track"><div class="goal-fill ${isMe ? 'me' : ''}" style="width:${pct}%"></div></div>
          <div class="usub">${u.weekTotal} / ${u.weeklyGoal} XP weekly goal ${pct >= 100 ? '— done! 🎉' : ''}</div>
        </div>
      </div>`;
  };

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const maxXp = Math.max(10, ...me.weekXp.map((d) => d.xp), ...(p ? p.weekXp.map((d) => d.xp) : [0]));
  const bars = me.weekXp
    .map((d, i) => {
      const pxp = p ? p.weekXp[i].xp : 0;
      return `
      <div class="week-bar me" title="${d.day}: you ${d.xp} XP${p ? `, ${esc(p.name)} ${pxp} XP` : ''}">
        <div style="display:flex;gap:2px;align-items:flex-end;width:100%;height:100%">
          <div class="bar" style="height:${Math.round((d.xp / maxXp) * 100)}%;background:var(--green)"></div>
          ${p ? `<div class="bar" style="height:${Math.round((pxp / maxXp) * 100)}%;background:var(--blue)"></div>` : ''}
        </div>
        <div class="dlbl">${dayLabels[i]}</div>
      </div>`;
    })
    .join('');

  return `
    <div class="duo-card">
      <h3>This week, together 💪</h3>
      ${userBlock(me, true)}
      ${p ? userBlock(p, false) : '<p class="muted">Add a second profile from the profile switcher so you can cheer each other on.</p>'}
    </div>
    <div class="duo-card">
      <h3>Daily XP</h3>
      <div class="week-chart">${bars}</div>
      <div class="legend">
        <span><span class="dot" style="background:var(--green)"></span>${esc(me.name)}</span>
        ${p ? `<span><span class="dot" style="background:var(--blue)"></span>${esc(p.name)}</span>` : ''}
      </div>
    </div>
    <div class="duo-card">
      <h3>My weekly goal</h3>
      <div style="display:flex;gap:10px;align-items:center">
        <input id="goal-input" type="number" min="10" step="10" value="${me.weeklyGoal}"
          style="font:inherit;padding:10px;border:2px solid var(--line);border-radius:12px;width:110px" />
        <span class="muted">XP per week</span>
        <button class="btn blue" id="save-goal" style="margin-left:auto">Save</button>
      </div>
    </div>`;
}

function wireTogether() {
  document.getElementById('save-goal').onclick = async () => {
    const v = parseInt(document.getElementById('goal-input').value, 10);
    if (!v || v < 10) return;
    await api.updateUser(state.me.id, { weeklyGoal: v });
    await refreshUsers();
    renderMain();
  };
}

// ---- Our Words (shared tutor deck) ----
let cardsCache = [];

async function wordsView() {
  cardsCache = await api.getCards();
  const due = await api.getDue(state.me.id);
  state.dueCount = due.due.length;
  const rows = cardsCache
    .map(
      (c) => `
    <div class="word-item">
      <div class="wkh khmer">${esc(c.khmer)}</div>
      <div>
        <div class="we">${esc(c.english)}</div>
        <div class="wr">${esc(c.roman)}</div>
        ${c.notes ? `<div class="wnote">${esc(c.notes)}</div>` : ''}
        <div class="wby">added by ${esc(c.created_by_name || '—')}</div>
      </div>
      <div class="wactions">
        <button class="icon-btn" data-speak="${esc(c.khmer)}" title="Listen">🔊</button>
        <button class="icon-btn" data-edit="${c.id}" title="Edit">✏️</button>
        <button class="icon-btn" data-del="${c.id}" title="Delete">🗑️</button>
      </div>
    </div>`
    )
    .join('');
  return `
    <div class="words-header">
      <div>
        <h2>Our Words</h2>
        <div class="muted">Words you two learned from your tutor — shared between both profiles</div>
      </div>
    </div>
    ${
      state.dueCount > 0
        ? `<div class="review-banner">
            <div class="cnt">${state.dueCount}</div>
            <div><strong>due for review</strong></div>
            <button class="btn blue" id="start-review" style="margin-left:auto">Review</button>
          </div>`
        : cardsCache.length
        ? `<div class="review-banner"><div>✅ All caught up — nothing due right now.</div></div>`
        : ''
    }
    <div class="duo-card">
      <h3>Add a word from your tutor</h3>
      <form class="word-form" id="add-word">
        <input name="khmer" class="khmer" placeholder="Khmer — ខ្មែរ" required />
        <input name="roman" placeholder="Pronunciation (e.g. suostei)" />
        <input name="english" placeholder="English meaning" required />
        <input name="notes" placeholder="Notes — e.g. 'tutor session Jul 12', usage tips" />
        <button class="btn wide" type="submit">Add to our deck</button>
      </form>
    </div>
    ${rows || '<div class="empty">No words yet. Add the first one from today\'s tutor session! ✍️</div>'}`;
}

function wireWords() {
  document.getElementById('add-word').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    await api.createCard({
      khmer: f.khmer.value,
      roman: f.roman.value,
      english: f.english.value,
      notes: f.notes.value,
      createdBy: state.me.id,
    });
    renderMain();
  };
  document.querySelectorAll('[data-speak]').forEach((b) => (b.onclick = () => speakKhmer(b.dataset.speak)));
  document.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const card = cardsCache.find((c) => c.id == b.dataset.del);
      if (confirm(`Delete "${card.khmer}" (${card.english}) for both of you?`)) {
        await api.deleteCard(card.id);
        renderMain();
      }
    };
  });
  document.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = async () => {
      const card = cardsCache.find((c) => c.id == b.dataset.edit);
      const khmer = prompt('Khmer:', card.khmer);
      if (khmer === null) return;
      const roman = prompt('Pronunciation:', card.roman);
      if (roman === null) return;
      const english = prompt('English:', card.english);
      if (english === null) return;
      const notes = prompt('Notes:', card.notes);
      if (notes === null) return;
      await api.updateCard(card.id, { khmer, roman, english, notes });
      renderMain();
    };
  });
  const rev = document.getElementById('start-review');
  if (rev) rev.onclick = startReviewSession;
}

// ---- Review session (spaced repetition over shared deck) ----
async function startReviewSession() {
  const { due } = await api.getDue(state.me.id);
  if (!due.length) return;
  let i = 0;
  let reviewed = 0;

  function render() {
    if (i >= due.length) return finish();
    const c = due[i];
    const pct = Math.round((i / due.length) * 100);
    // Alternate direction: even cards show Khmer first, odd show English first.
    const kmFirst = i % 2 === 0;
    $app().innerHTML = `
      <div class="lesson-top">
        <button class="lesson-quit" id="quit">✕</button>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="flashcard" id="card">
        ${
          kmFirst
            ? `<div class="fkh khmer">${esc(c.khmer)} <button class="speak-btn" data-speak="${esc(c.khmer)}" title="Listen">🔊</button></div>`
            : `<div class="fe" style="font-size:1.6rem">${esc(c.english)}</div>`
        }
        <div id="answer" style="display:none">
          ${kmFirst ? `<div class="fe">${esc(c.english)}</div>` : `<div class="fkh khmer">${esc(c.khmer)}</div>`}
          <div class="fr">${esc(c.roman)}</div>
          ${c.notes ? `<div class="fnote">${esc(c.notes)}</div>` : ''}
        </div>
      </div>
      <div id="controls" style="margin-top:16px">
        <button class="btn wide blue" id="reveal">Show answer</button>
      </div>`;
    document.getElementById('quit').onclick = () => renderMain();
    document.querySelectorAll('[data-speak]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        speakKhmer(b.dataset.speak);
      };
    });
    if (kmFirst) speakKhmer(c.khmer);
    document.getElementById('reveal').onclick = () => {
      document.getElementById('answer').style.display = '';
      if (!kmFirst) speakKhmer(c.khmer); // hear the Khmer once it's revealed
      document.getElementById('controls').innerHTML = `
        <div class="grade-row">
          <button class="btn red" id="g-again">Again</button>
          <button class="btn" id="g-good">Good</button>
          <button class="btn blue" id="g-easy">Easy</button>
        </div>
        <p class="muted" style="text-align:center;margin-top:10px">
          Again → repeats today · Good → next box · Easy → skips a box</p>`;
      const grade = async (g) => {
        await api.gradeReview(state.me.id, c.id, g);
        reviewed++;
        if (g === 'again') due.push(c); // come back at the end of this session too
        i++;
        render();
      };
      document.getElementById('g-again').onclick = () => grade('again');
      document.getElementById('g-good').onclick = () => grade('good');
      document.getElementById('g-easy').onclick = () => grade('easy');
    };
  }

  async function finish() {
    const xp = Math.min(20, reviewed * 2);
    await api.saveProgress(state.me.id, 'review', 100, xp);
    await refreshUsers();
    state.progress = await api.getProgress(state.me.id);
    const dueNow = await api.getDue(state.me.id);
    state.dueCount = dueNow.due.length;
    $app().innerHTML = `
      <div class="lesson-end">
        <div class="big-emoji">🧠</div>
        <h2>Review done!</h2>
        <div class="end-stats">
          <div class="end-stat xp"><div class="val">+${xp}</div><div class="lbl">XP</div></div>
          <div class="end-stat acc"><div class="val">${reviewed}</div><div class="lbl">Cards</div></div>
        </div>
        <button class="btn wide" id="end-continue">Continue</button>
      </div>`;
    document.getElementById('end-continue').onclick = () => renderMain();
  }

  render();
}

// ---- Profile setup & switching ----
function renderSetup() {
  $app().innerHTML = `
    <div class="setup">
      <h1>🇰🇭 Khmer Practice</h1>
      <p>Set up your two profiles — you can add the second one later too.</p>
      <form class="word-form" id="setup-form">
        <label><strong>Learner 1</strong></label>
        <input name="name1" placeholder="Name (e.g. John)" required />
        <label><strong>Learner 2</strong> <span class="muted">(optional)</span></label>
        <input name="name2" placeholder="Name" />
        <button class="btn wide" type="submit">Start learning</button>
      </form>
    </div>`;
  document.getElementById('setup-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const avatars = ['🧑‍💻', '🌸'];
    const u1 = await api.createUser(f.name1.value, avatars[0]);
    if (f.name2.value.trim()) await api.createUser(f.name2.value, avatars[1]);
    await refreshUsers();
    await loadMe(u1.id);
    renderMain();
  };
}

function renderUserPick() {
  const picks = state.users
    .map(
      (u) => `
    <button class="pick" data-id="${u.id}">
      <span class="pav">${esc(u.avatar)}</span>${esc(u.name)}
      <span class="muted">🔥 ${u.streak} · ⚡ ${u.todayXp} today</span>
    </button>`
    )
    .join('');
  $app().innerHTML = `
    <div class="setup">
      <h1>Who's practicing?</h1>
      <div class="user-pick">${picks}</div>
      ${state.users.length < 2 ? '<button class="btn ghost" id="add-user">+ Add second profile</button>' : ''}
    </div>`;
  document.querySelectorAll('.pick').forEach((b) => {
    b.onclick = async () => {
      await loadMe(parseInt(b.dataset.id, 10));
      renderMain();
    };
  });
  const add = document.getElementById('add-user');
  if (add)
    add.onclick = async () => {
      const name = prompt("Second learner's name:");
      if (!name || !name.trim()) return;
      await api.createUser(name, '🌸');
      await refreshUsers();
      renderUserPick();
    };
}

// ---------------- Main render ----------------
async function renderMain() {
  await refreshUsers();
  if (!state.me) return renderUserPick();
  let body = '';
  if (state.tab === 'learn') body = learnView();
  else if (state.tab === 'together') body = togetherView();
  else if (state.tab === 'words') body = await wordsView();
  $app().innerHTML = topbar() + body + tabs();
  wireChrome();
  if (state.tab === 'learn') wireLearn();
  else if (state.tab === 'together') wireTogether();
  else if (state.tab === 'words') wireWords();
}

async function init() {
  state.users = await api.getUsers();
  if (state.users.length === 0) return renderSetup();
  const saved = parseInt(localStorage.getItem('khmerMeId'), 10);
  const savedUser = state.users.find((u) => u.id === saved);
  if (!savedUser) return renderUserPick();
  await loadMe(savedUser.id);
  renderMain();
}

init();
