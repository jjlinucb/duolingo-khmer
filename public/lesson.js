// Lesson player: generates an exercise queue from a skill and runs it.
import { api } from './api.js';

const $app = () => document.getElementById('app');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// --- Khmer audio: served by /api/tts (Google TTS, cached on the server) ---
const audioCache = new Map();
export function speakKhmer(text) {
  if (!text) return;
  let a = audioCache.get(text);
  if (!a) {
    a = new Audio('/api/tts?text=' + encodeURIComponent(text));
    a.onerror = () => audioCache.delete(text); // retry next tap (e.g. was offline)
    audioCache.set(text, a);
  }
  try {
    a.currentTime = 0;
  } catch {}
  a.play().catch(() => {});
}
function speakBtn(text) {
  return `<button class="speak-btn" data-speak="${esc(text)}" title="Listen">🔊</button>`;
}

// The prompt label depends on whether we're learning letters or vocab.
function answerLabel(skill) {
  return skill.kind === 'letters' ? 'sound' : 'meaning';
}
function itemAnswer(skill, item) {
  // For letters the "answer" is the romanized sound; for vocab it's the English meaning.
  return skill.kind === 'letters' ? item.r : item.e;
}

function buildQueue(skill) {
  const items = skill.items;
  const queue = [];
  for (const item of items) queue.push({ type: 'teach', item });
  // One multiple-choice per item, alternating direction; both directions for small skills.
  const mcs = [];
  items.forEach((item, i) => {
    if (items.length <= 6) {
      mcs.push({ type: 'mc-k2a', item });
      mcs.push({ type: 'mc-a2k', item });
    } else {
      mcs.push({ type: i % 2 === 0 ? 'mc-k2a' : 'mc-a2k', item });
    }
  });
  queue.push(...shuffle(mcs));
  // Matching rounds covering all items, up to 5 pairs each.
  const shuffled = shuffle(items);
  for (let i = 0; i < shuffled.length; i += 5) {
    const group = shuffled.slice(i, i + 5);
    if (group.length >= 2) queue.push({ type: 'match', items: group });
  }
  return queue;
}

function mcOptions(skill, item) {
  const pool = skill.items.filter((x) => x !== item);
  return shuffle([item, ...shuffle(pool).slice(0, 3)]);
}

export function startLesson(skill, { onExit, onFinish }) {
  const queue = buildQueue(skill);
  let idx = 0;
  let mistakes = 0;
  let totalAnswered = 0;
  const requeued = new Set();
  const totalSteps = () => queue.length;

  function render() {
    if (idx >= queue.length) return finish();
    const step = queue[idx];
    const pct = Math.round((idx / totalSteps()) * 100);
    const top = `
      <div class="lesson-top">
        <button class="lesson-quit" id="quit" title="Quit lesson">✕</button>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>`;
    let body = '';
    if (step.type === 'teach') body = renderTeach(step);
    else if (step.type === 'mc-k2a') body = renderMcK2A(step);
    else if (step.type === 'mc-a2k') body = renderMcA2K(step);
    else if (step.type === 'match') body = renderMatch(step);
    $app().innerHTML = top + `<div class="exercise">${body}</div><div id="feedback-slot"></div>`;
    wire(step);
  }

  function renderTeach(step) {
    const { item } = step;
    const intro =
      skill.intro && queue.indexOf(step) === 0
        ? `<div class="intro-note">💡 ${esc(skill.intro)}</div>`
        : '';
    return `
      ${intro}
      <h3>New ${skill.kind === 'letters' ? 'character' : 'word'}</h3>
      <div class="teach-card">
        <div class="big-khmer khmer">${esc(item.k)} ${speakBtn(item.k)}</div>
        <div class="roman">${esc(item.r)}</div>
        <div class="meaning">${esc(item.e)}</div>
        ${item.note ? `<div class="note">${esc(item.note)}</div>` : ''}
      </div>
      <div style="margin-top:20px"><button class="btn wide" id="continue">Continue</button></div>`;
  }

  function renderMcK2A(step) {
    const { item } = step;
    const opts = mcOptions(skill, item);
    return `
      <h3>What is the ${answerLabel(skill)} of…</h3>
      <div class="prompt-big khmer">${esc(item.k)} ${skill.kind === 'letters' ? '' : speakBtn(item.k)}</div>
      <div class="choices single-col">
        ${opts
          .map(
            (o, i) =>
              `<button class="choice" data-i="${i}" data-ok="${o === item}">${esc(itemAnswer(skill, o))}</button>`
          )
          .join('')}
      </div>`;
  }

  function renderMcA2K(step) {
    const { item } = step;
    const opts = mcOptions(skill, item);
    return `
      <h3>Which one is…</h3>
      <div class="prompt-word">“${esc(itemAnswer(skill, item))}”</div>
      <div class="choices">
        ${opts
          .map(
            (o, i) =>
              `<button class="choice" data-i="${i}" data-ok="${o === item}"><span class="kh khmer">${esc(o.k)}</span></button>`
          )
          .join('')}
      </div>`;
  }

  function renderMatch(step) {
    const left = shuffle(step.items);
    const right = shuffle(step.items);
    step._left = left;
    step._right = right;
    return `
      <h3>Match the pairs</h3>
      <div class="match-grid">
        <div style="display:flex;flex-direction:column;gap:10px">
          ${left
            .map((it, i) => `<button class="choice mleft" data-k="${esc(it.k)}"><span class="kh khmer">${esc(it.k)}</span></button>`)
            .join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${right
            .map((it) => `<button class="choice mright" data-k="${esc(it.k)}">${esc(itemAnswer(skill, it))}</button>`)
            .join('')}
        </div>
      </div>`;
  }

  function showFeedback(ok, correctText, onContinue) {
    const slot = document.getElementById('feedback-slot');
    slot.innerHTML = `
      <div class="feedback ${ok ? 'good' : 'bad'}">
        <div class="inner">
          <h4>${ok ? ['Nice!', 'Correct!', 'ល្អណាស់! (Great!)', 'You got it!'][Math.floor(Math.random() * 4)] : 'Not quite…'}</h4>
          <p>${ok ? '' : `Correct answer: ${esc(correctText)}`}</p>
          <button class="btn wide ${ok ? '' : 'red'}" id="fb-continue">Continue</button>
        </div>
      </div>`;
    document.getElementById('fb-continue').onclick = onContinue;
    document.getElementById('fb-continue').focus();
  }

  function answerMc(step, btn) {
    const ok = btn.dataset.ok === 'true';
    totalAnswered++;
    document.querySelectorAll('.choice').forEach((c) => {
      c.disabled = true;
      if (c.dataset.ok === 'true') c.classList.add('correct');
    });
    if (!ok) {
      btn.classList.add('wrong');
      mistakes++;
      // Re-queue this exercise once so it comes back at the end.
      const key = step.type + step.item.k;
      if (!requeued.has(key)) {
        requeued.add(key);
        queue.push({ ...step });
      }
    }
    showFeedback(ok, itemAnswer(skill, step.item), () => {
      idx++;
      render();
    });
  }

  function wire(step) {
    document.getElementById('quit').onclick = () => {
      if (confirm('Quit this lesson? Progress in it will be lost.')) onExit();
    };
    document.querySelectorAll('[data-speak]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        speakKhmer(b.dataset.speak);
      };
    });
    if (step.type === 'teach') {
      speakKhmer(step.item.k); // hear it as you learn it
      document.getElementById('continue').onclick = () => {
        idx++;
        render();
      };
    } else if (step.type === 'mc-k2a' || step.type === 'mc-a2k') {
      document.querySelectorAll('.choice').forEach((c) => (c.onclick = () => answerMc(step, c)));
    } else if (step.type === 'match') {
      let selLeft = null;
      let selRight = null;
      let remaining = step.items.length;
      const tryMatch = () => {
        if (!selLeft || !selRight) return;
        totalAnswered++;
        if (selLeft.dataset.k === selRight.dataset.k) {
          selLeft.classList.remove('selected');
          selRight.classList.remove('selected');
          selLeft.classList.add('matched');
          selRight.classList.add('matched');
          remaining--;
          if (remaining === 0) {
            setTimeout(() => {
              idx++;
              render();
            }, 400);
          }
        } else {
          mistakes++;
          selLeft.classList.add('wrong');
          selRight.classList.add('wrong');
          const l = selLeft, r = selRight;
          setTimeout(() => {
            l.classList.remove('wrong', 'selected');
            r.classList.remove('wrong', 'selected');
          }, 600);
        }
        selLeft = null;
        selRight = null;
      };
      document.querySelectorAll('.mleft').forEach((b) => {
        b.onclick = () => {
          if (b.classList.contains('matched')) return;
          document.querySelectorAll('.mleft').forEach((x) => x.classList.remove('selected'));
          b.classList.add('selected');
          selLeft = b;
          // For letter-matching the audio would give away the pair, so vocab only.
          if (skill.kind !== 'letters') speakKhmer(b.dataset.k);
          tryMatch();
        };
      });
      document.querySelectorAll('.mright').forEach((b) => {
        b.onclick = () => {
          if (b.classList.contains('matched')) return;
          document.querySelectorAll('.mright').forEach((x) => x.classList.remove('selected'));
          b.classList.add('selected');
          selRight = b;
          tryMatch();
        };
      });
    }
  }

  async function finish() {
    const accuracy = totalAnswered === 0 ? 100 : Math.round(((totalAnswered - mistakes) / totalAnswered) * 100);
    const score = Math.max(0, accuracy);
    const xp = 10 + (score === 100 ? 5 : score >= 90 ? 3 : 0);
    $app().innerHTML = `
      <div class="lesson-end">
        <div class="big-emoji">${score === 100 ? '🏆' : score >= 80 ? '🎉' : '💪'}</div>
        <h2>Lesson complete!</h2>
        <div class="end-stats">
          <div class="end-stat xp"><div class="val">+${xp}</div><div class="lbl">XP</div></div>
          <div class="end-stat acc"><div class="val">${score}%</div><div class="lbl">Accuracy</div></div>
        </div>
        <button class="btn wide" id="end-continue">Continue</button>
      </div>`;
    document.getElementById('end-continue').onclick = () => onFinish({ score, xp });
  }

  render();
}
