# 🇰🇭 Duolingo Khmer

A Duolingo-style Khmer practice app for two learners. Runs as a real hosted web app (free) so it works from any device, anywhere — no home network required.

## Deploy it (one-time setup)

The app needs two free accounts — you have to create these yourself (that's a deliberate rule for whoever's setting this up, not a Render/Neon requirement); everything after that I can help drive.

**1. Database — [Neon](https://neon.tech)** (free Postgres, no credit card, doesn't expire)
   - Sign up, create a project (any name, e.g. `khmer`).
   - On the project dashboard, copy the **connection string** (starts with `postgres://...`).

**2. Hosting — [Render](https://render.com)** (free web service, no credit card)
   - Sign up, then **New + → Blueprint**, connect your GitHub, pick the `duolingo-khmer` repo.
   - Render reads [render.yaml](render.yaml) and asks for one thing: paste your Neon connection string into the `DATABASE_URL` field.
   - Click deploy. First deploy takes a few minutes. Render gives you a URL like `https://duolingo-khmer.onrender.com` — that's the live app.

Send that URL to your wife. That's it — same URL works for both of you, from any phone, laptop, anywhere with internet.

**Heads up — there's no login.** Anyone who has the URL can open it, create a profile, and read/add to the shared word deck. Fine for sharing a link privately with your wife; don't post the URL somewhere public.

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

- **Learn** — Duolingo-style path:
  - *Khmer Script*: all 33 consonants (with 1st/2nd series), dependent vowels, and Khmer numerals
  - *Everyday Words*: 8 units × 10 words (greetings, family, numbers, food, verbs, places, time, questions)
  - Exercise types: teach cards, multiple choice both directions, match-the-pairs. Wrong answers come back at the end of the lesson.
- **Our Words** — shared deck for vocab from your tutor. Either of you adds a word; it enters both of your review queues. Reviews use Leitner spaced repetition (boxes 1–5 → review after 0/1/3/7/21 days).
- **Together** — both streaks, weekly XP goals, and a daily XP chart side by side.

## Adding/editing course content

All lesson content is plain data in [public/data.js](public/data.js). Each skill is:

```js
{ id: 'greetings', title: 'Greetings', icon: '👋', kind: 'vocab',
  items: [ { k: 'សួស្តី', r: 'suostei', e: 'hello' }, ... ] }
```

Add a skill object to a section's `skills` array and it appears on the path (skills unlock in order). `kind: 'letters'` phrases prompts as "what sound", `kind: 'vocab'` as "what meaning".

## Notes

- Khmer text renders with the system Khmer fonts that macOS, iOS, and Android all ship — no webfonts needed.
- **Audio**: every word/letter has native-speaker-quality audio via Google's Khmer text-to-speech. Teach cards auto-play; 🔊 buttons appear on cards, word lists, and reviews. The 146 course audio files are pre-downloaded and committed in `tts-cache/`, so the course itself has audio even if Google's endpoint is ever unreachable. New tutor words fetch their audio on first play (needs internet); on Render's free tier that cached file can be lost on redeploy/restart and re-fetches next time it's played — the word and your progress are unaffected either way. After adding course content to `data.js`, run `node scripts/prefetch-audio.js` to pre-download the new audio.
- **Data**: lives in Postgres (Neon), not on any one device. Deleting the app or your Mac doesn't touch it; deleting the Neon project does.
