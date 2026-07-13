# 🇰🇭 Duolingo Khmer

A Duolingo-style Khmer practice app for two learners, running entirely on your own machine — no cloud, no accounts, data stays in a local SQLite file.

## Run it

```bash
npm install   # first time only
npm start
```

Then open the URL it prints:
- **You:** http://localhost:3000
- **Your wife (same wifi):** the `http://<your-LAN-IP>:3000` line it prints — open that on her phone/laptop.

Keep the terminal running while you practice. Data lives in `khmer.db` next to `server.js` — back that one file up and you've backed up everything.

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
- **Audio**: every word/letter has native-speaker-quality audio via Google's Khmer text-to-speech. Teach cards auto-play; 🔊 buttons appear on cards, word lists, and reviews. Audio MP3s are cached in `tts-cache/` — the whole course is pre-downloaded, so lessons work offline. New tutor words fetch their audio on first play (needs internet that one time). After adding course content to `data.js`, run `node scripts/prefetch-audio.js` to pre-download the new audio.
- No auth — anyone on your wifi can reach it. Fine for a home network; don't port-forward it to the internet as-is.
