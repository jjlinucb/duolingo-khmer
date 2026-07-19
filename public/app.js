import { SECTIONS, allSkills, findSkill } from './data.js';
import { api } from './api.js';
import { startLesson, speakKhmer } from './lesson.js';

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
  settings: { dailyGoal: 20, romanizationMode: 'peek', soundEffects: true },
  streak: 0,
  todayXp: 0,
  weekXp: [],
  weekTotal: 0,
  totalXp: 0,
  lessonsDone: 0,
  progress: {}, // lessonId -> {completions, bestScore}
  tab: 'learn', // 'learn' | 'soundgym' | 'practice' | 'words'
  dueCount: 0,
};

const flatSkills = allSkills(); // fixed course order: script, then unit1..unit10

function applyState(s) {
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

// ---------------- Chrome (topbar / tabs) ----------------

function topbar() {
  return `
    <div class="topbar">
      <div class="brand">🇰🇭 Khmer</div>
      <div class="stat streak" title="Day streak">🔥 ${state.streak}</div>
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
    ${t('words', '📒', 'My Words')}
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
  const sections = SECTIONS.map((sec) => {
    const skills = sec.skills
      .map((sk) => {
        const p = state.progress[sk.id];
        const done = (p?.completions || 0) > 0;
        const unlocked = isUnlocked(gi);
        gi++;
        const crowns = p?.completions ? '👑'.repeat(Math.min(5, p.completions)) : '';
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
}

function launchLesson(skillId) {
  const skill = findSkill(skillId);
  if (!skill) return;
  startLesson(skill, {
    soundEffects: state.settings.soundEffects,
    onExit: () => renderMain(),
    onFinish: async ({ score, xp }) => {
      await api.saveProgress(skillId, score, xp);
      await refreshState();
      renderMain();
    },
  });
}

// ---------------- Placement test ----------------

function buildPlacementQuestions() {
  return flatSkills.map((skill) => {
    const item = skill.items[Math.floor(Math.random() * skill.items.length)];
    const pool = skill.items.filter((x) => x !== item);
    const opts = shuffle([item, ...shuffle(pool).slice(0, 3)]);
    const answerText = (o) => (skill.kind === 'letters' ? o.r : o.e);
    return { skill, item, opts, answerText };
  });
}

function startPlacementTest() {
  const questions = buildPlacementQuestions();
  let i = 0;
  const passed = [];

  function render() {
    if (i >= questions.length) return finishTest();
    const q = questions[i];
    const pct = Math.round((i / questions.length) * 100);
    $app().innerHTML = `
      <div class="lesson-top">
        <button class="lesson-quit" id="quit" title="Stop test">✕</button>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="exercise">
        <h3>Placement test · ${esc(q.skill.title)}</h3>
        <div class="prompt-big khmer">${esc(q.item.k)}</div>
        <div class="choices single-col">
          ${q.opts
            .map(
              (o, oi) =>
                `<button class="choice" data-i="${oi}" data-ok="${o === q.item}">${esc(q.answerText(o))}</button>`
            )
            .join('')}
        </div>
      </div>`;
    document.getElementById('quit').onclick = () => {
      if (confirm("Stop the test? Skills you've already passed will still be saved.")) finishTest();
    };
    document.querySelectorAll('.choice').forEach((c) => {
      c.onclick = () => {
        const ok = c.dataset.ok === 'true';
        document.querySelectorAll('.choice').forEach((x) => {
          x.disabled = true;
          if (x.dataset.ok === 'true') x.classList.add('correct');
        });
        if (!ok) c.classList.add('wrong');
        setTimeout(
          () => {
            if (ok) {
              passed.push(q.skill.id);
              i++;
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
    const xp = Math.min(200, passed.length * 5);
    if (passed.length) await api.placement(passed, xp);
    await refreshState();
    $app().innerHTML = `
      <div class="lesson-end">
        <div class="big-emoji">🎯</div>
        <h2>Placed you through ${passed.length} skill${passed.length === 1 ? '' : 's'}!</h2>
        <p class="muted" style="text-align:center;margin-bottom:24px">
          Everything up to there is marked complete — pick up right where you left off.</p>
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
        setTimeout(() => {
          i++;
          render();
        }, 500);
      };
    });
  }

  function finish() {
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
          <button class="audio-big" id="replay">🔊</button>
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
        setTimeout(() => {
          i++;
          render();
        }, 500);
      };
    });
  }

  function finish() {
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
    soundEffects: state.settings.soundEffects,
    onExit: () => renderMain(),
    onFinish: async ({ score, xp }) => {
      await api.saveProgress('practice', score, Math.min(10, xp));
      await refreshState();
      renderMain();
    },
  });
}

// ---------------- My Words (personal tutor-vocab deck) ----------------

let cardsCache = [];

async function wordsView() {
  cardsCache = await api.getCards();
  const due = await api.getDue();
  state.dueCount = due.due.length;
  const mode = state.settings.romanizationMode;
  const rows = cardsCache
    .map((c) => {
      const roman =
        mode === 'never'
          ? ''
          : mode === 'always'
          ? `<div class="wr">${esc(c.roman)}</div>`
          : `<div class="wr peek-wrap"><span class="peek-hidden">${esc(c.roman)}</span><button class="peek-btn" data-peek>👁</button></div>`;
      return `
      <div class="word-item">
        <div class="wkh khmer">${esc(c.khmer)}</div>
        <div>
          <div class="we">${esc(c.english)}</div>
          ${roman}
          ${c.notes ? `<div class="wnote">${esc(c.notes)}</div>` : ''}
        </div>
        <div class="wactions">
          <button class="icon-btn" data-speak="${esc(c.khmer)}">🔊</button>
          <button class="icon-btn" data-edit="${c.id}" title="Edit">✏️</button>
          <button class="icon-btn" data-del="${c.id}" title="Delete">🗑️</button>
        </div>
      </div>`;
    })
    .join('');
  return `
    <div class="words-header">
      <div>
        <h2>My Words</h2>
        <div class="muted">Words you've learned from your tutor, with spaced-repetition review</div>
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
        <button class="btn wide" type="submit">Add to My Words</button>
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
    });
    renderMain();
  };
  document.querySelectorAll('[data-speak]').forEach((b) => (b.onclick = () => speakKhmer(b.dataset.speak)));
  document.querySelectorAll('[data-peek]').forEach((b) => {
    b.onclick = () => b.closest('.peek-wrap').classList.add('revealed');
  });
  document.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const card = cardsCache.find((c) => c.id == b.dataset.del);
      if (confirm(`Delete "${card.khmer}" (${card.english})?`)) {
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

function startReviewSession() {
  api.getDue().then(({ due }) => {
    if (!due.length) return;
    let i = 0;
    let reviewed = 0;

    function render() {
      if (i >= due.length) return finish();
      const c = due[i];
      const pct = Math.round((i / due.length) * 100);
      const kmFirst = i % 2 === 0;
      $app().innerHTML = `
        <div class="lesson-top">
          <button class="lesson-quit" id="quit">✕</button>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="flashcard" id="card">
          ${
            kmFirst
              ? `<div class="fkh khmer">${esc(c.khmer)} <button class="speak-btn" data-speak="${esc(c.khmer)}">🔊</button></div>`
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
        if (!kmFirst) speakKhmer(c.khmer);
        document.getElementById('controls').innerHTML = `
          <div class="grade-row">
            <button class="btn red" id="g-again">Again</button>
            <button class="btn" id="g-good">Good</button>
            <button class="btn blue" id="g-easy">Easy</button>
          </div>
          <p class="muted" style="text-align:center;margin-top:10px">
            Again → repeats today · Good → next box · Easy → skips a box</p>`;
        const grade = async (g) => {
          await api.gradeReview(c.id, g);
          reviewed++;
          if (g === 'again') due.push(c);
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
      await api.saveProgress('review', 100, xp);
      await refreshState();
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
  });
}

// ---------------- Settings ----------------

function renderSettings() {
  const m = state.settings.romanizationMode;
  $app().innerHTML = `
    <div class="lesson-top">
      <button class="lesson-quit" id="quit">✕</button>
      <h3 style="margin-left:8px">⚙️ Settings</h3>
    </div>
    <div class="exercise">
      <div class="duo-card">
        <h3>Romanization (in My Words)</h3>
        <p class="muted">New words and correct answers always show the sound — this only affects your saved word list.</p>
        <div class="choices single-col" style="margin-top:12px">
          <button class="choice ${m === 'peek' ? 'selected' : ''}" data-mode="peek">🙈 Hidden — tap 👁 to peek (recommended)</button>
          <button class="choice ${m === 'always' ? 'selected' : ''}" data-mode="always">👁 Always show</button>
          <button class="choice ${m === 'never' ? 'selected' : ''}" data-mode="never">🚫 Never show — script only</button>
        </div>
      </div>
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
        <p>⭐ ${state.totalXp} total XP · 🔥 ${state.streak} day streak · 📚 ${state.lessonsDone} lessons done</p>
      </div>
      <button class="btn ghost wide" id="open-guide" style="margin-bottom:12px">📖 How to read the sounds</button>
      <button class="btn red wide" id="reset-all">Reset all progress</button>
    </div>`;
  document.getElementById('quit').onclick = () => renderMain();
  document.getElementById('open-guide').onclick = () => renderSoundGuide();
  document.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = async () => {
      await api.updateSettings({ romanizationMode: b.dataset.mode });
      await refreshState();
      renderSettings();
    };
  });
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
    if (!confirm('Reset ALL progress, streaks, and My Words? This cannot be undone.')) return;
    await api.resetAll();
    await refreshState();
    renderWelcome();
  };
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

async function renderMain() {
  let body = '';
  if (state.tab === 'learn') body = learnView();
  else if (state.tab === 'soundgym') body = soundGymView();
  else if (state.tab === 'practice') body = practiceView();
  else if (state.tab === 'words') body = await wordsView();
  $app().innerHTML = topbar() + body + tabs();
  wireChrome();
  if (state.tab === 'learn') wireLearn();
  else if (state.tab === 'soundgym') wireSoundGym();
  else if (state.tab === 'practice') wirePractice();
  else if (state.tab === 'words') wireWords();
}

async function init() {
  await refreshState();
  if (state.lessonsDone === 0 && Object.keys(state.progress).length === 0) {
    renderWelcome();
  } else {
    renderMain();
  }
}

init();
