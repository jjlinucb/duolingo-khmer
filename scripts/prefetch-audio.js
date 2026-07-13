// Downloads Khmer audio for every course item into tts-cache/ so lessons
// work fully offline. Run once (and again after adding content to data.js):
//   node scripts/prefetch-audio.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TTS_DIR = path.join(__dirname, '..', 'tts-cache');
fs.mkdirSync(TTS_DIR, { recursive: true });

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'data.js'), 'utf8');
const texts = [...new Set([...src.matchAll(/k:\s*'([^']+)'/g)].map((m) => m[1]))];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOne(text) {
  const file = path.join(TTS_DIR, crypto.createHash('sha1').update(text).digest('hex') + '.mp3');
  if (fs.existsSync(file)) return 'cached';
  const url =
    'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=km&q=' +
    encodeURIComponent(text);
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200) throw new Error('empty audio');
  fs.writeFileSync(file, buf);
  return 'downloaded';
}

(async () => {
  console.log(`Fetching audio for ${texts.length} items…`);
  let ok = 0, cached = 0, failed = [];
  for (const [i, text] of texts.entries()) {
    try {
      let result;
      try {
        result = await fetchOne(text);
      } catch (e) {
        await sleep(1500); // one retry after a pause
        result = await fetchOne(text);
      }
      result === 'cached' ? cached++ : ok++;
      process.stdout.write(`\r  ${i + 1}/${texts.length}  ${text}                    `);
      if (result === 'downloaded') await sleep(300); // be polite to the endpoint
    } catch (e) {
      failed.push(`${text} (${e.message})`);
    }
  }
  console.log(`\nDone: ${ok} downloaded, ${cached} already cached, ${failed.length} failed.`);
  if (failed.length) console.log('Failed:\n  ' + failed.join('\n  '));
})();
