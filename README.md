# 🇰🇭 Duolingo Khmer

A Duolingo-style Khmer course, personal (single learner). Runs as a real hosted web app (free) so it works from any device, anywhere — no home network required.

## Deploy it (one-time setup)

The app needs two free accounts — you have to create these yourself (that's a deliberate rule for whoever's setting this up, not a Render/Neon requirement); everything after that I can help drive.

**1. Database — [Neon](https://neon.tech)** (free Postgres, no credit card, doesn't expire)
   - Sign up, create a project (any name, e.g. `khmer`).
   - On the project dashboard, copy the **connection string** (starts with `postgres://...`).

**2. Hosting — [Render](https://render.com)** (free web service, no credit card)
   - Sign up, then **New + → Blueprint**, connect your GitHub, pick the `duolingo-khmer` repo.
   - Render reads [render.yaml](render.yaml) and asks for one thing: paste your Neon connection string into the `DATABASE_URL` field.
   - Click deploy. First deploy takes a few minutes. Render gives you a URL like `https://duolingo-khmer.onrender.com` — that's the live app.

**Heads up — there's no login.** Anyone who has the URL can open it and use/edit it. Fine for your own private link; don't post the URL somewhere public.

**Also:** Render's free tier sleeps after 15 minutes of no traffic and takes ~30–60 seconds to wake back up on the next visit — normal, not broken. Neon's free database does the same (data itself never disappears, just the connection needs a moment to reconnect).

## Local development

Useful if you want to tinker with lesson content before it goes live.

```bash
cp .env.example .env   # paste your Neon connection string in here
npm install
npm start
```

Local runs point at the same Neon database as production — there's only one shared set of data, whether you reach it from `localhost` or the live Render URL.

There's also a double-click **Khmer Practice.app** on the Desktop that runs `scripts/start.sh` for you (installs deps on first run, opens your browser). It needs the same `.env` file to exist first.

## What's inside

The unit/skill order follows the same shape as a friend's Thai course
([suusuuthai.netlify.app](https://suusuuthai.netlify.app)), adapted to Khmer content:

- **Learn** — the path:
  - *Khmer Script* (prerequisite): all 33 consonants (1st/2nd series), dependent vowels, Khmer numerals
  - *Units 1–10*: Greetings & Politeness → About Me → Food I → Money & Shopping → Getting Around →
    Small Talk → Family & Friends → Eating Together → Faith & Community → Plans & Time
    (3 skills each, ~270 words/phrases total)
  - Skills unlock strictly in order across the whole course (not just within a unit)
  - Exercise types: teach cards, multiple choice (both directions), audio-only "what do you hear?",
    tap-the-tiles phrase translation, and match-the-pairs. Wrong answers come back at the end of the lesson.
- **Placement test** — offered on first run (and again anytime from Settings) if you already know some
  Khmer: one question per skill, in course order, stops at your first miss. Everything before that point
  gets marked complete so you don't redo material you already know.
- **Sound Gym** — Series Trainer (hear a consonant, name its 1st/2nd series), Minimal Pairs (aspirated vs.
  unaspirated consonants — ក/ខ, ច/ឆ, etc.), and a Sound Guide explaining the romanization.
- **Practice** — "Smart practice": a mixed quiz pulled from your weakest completed skills.
- **My Words** — your personal deck for vocab from tutor sessions. Spaced repetition (Leitner boxes
  1–5 → review after 0/1/3/7/21 days).
- **Settings** (⚙️ in the top bar) — romanization visibility (hidden/peek, always, never — only new
  words and revealed answers are exempt), sound effects, daily XP goal, your stats, and a full reset.

## Adding/editing course content

All lesson content is plain data in [public/data.js](public/data.js). Each skill is:

```js
{ id: 'hello', title: 'Hello', icon: '👋', kind: 'vocab',
  items: [
    { k: 'សួស្តី', r: 'suostei', e: 'hello' },
    // tokens (optional) enables a tap-the-tiles phrase-translate exercise;
    // tokens.join('') must equal k exactly (Khmer has no spaces between words)
    { k: 'សុខសប្បាយទេ?', r: 'sok sabay te?', e: 'how are you?', tokens: ['សុខសប្បាយ', 'ទេ?'] },
  ] }
```

Add a skill object to a section's `skills` array and it appears on the path (skills unlock in strict
course order). `kind: 'letters'` phrases prompts as "what sound", `kind: 'vocab'` as "what meaning".

**A note on accuracy:** this vocabulary was hand-authored, not pulled from a vetted curriculum — the
original 80-word course was spot-checked, but this expansion to ~270 words/phrases has not been reviewed
by a native speaker or your tutor. Worth a pass with your tutor before trusting it fully, especially the
less common words (feelings, faith vocabulary, relationships).

## Notes

- Khmer text renders with the system Khmer fonts that macOS, iOS, and Android all ship — no webfonts needed.
- **Audio**: every word/letter has native-speaker-quality audio via Google's Khmer text-to-speech. Teach
  cards auto-play; 🔊 buttons appear throughout. All ~270 course audio files are pre-downloaded and
  committed in `tts-cache/`, so the course itself has audio even if Google's endpoint is ever unreachable.
  New My Words entries fetch their audio on first play (needs internet); on Render's free tier that cached
  file can be lost on redeploy/restart and just re-fetches next time it's played. After adding course
  content to `data.js`, run `node scripts/prefetch-audio.js` to pre-download the new audio.
- **Data**: lives in Postgres (Neon), not on any one device. Deleting the app or your Mac doesn't touch
  it; deleting the Neon project does.
