#!/usr/bin/env node
/*
 * verify.cjs — the visual-verification harness (mechanical lane, no model).
 *
 *   node verify.cjs shot   <url> <outfile.png> [width] [height]   # screenshot at ?jump position
 *   node verify.cjs jank   <url>                                  # scroll-through jank test
 *   node verify.cjs logo   <logo.svg> <logo.png> [height=80]      # PNG rendition for email
 *
 * Uses puppeteer-core + your system Chrome (host preview panes throttle hidden tabs, freezing
 * rAF and returning stale screenshots — this path is immune). The page under test must
 * implement the dev contract described in references/engine.md: ?jump=<scrollY> lands
 * pre-scrolled+settled, and window.__ready === true fires once the page is truly ready.
 * If __ready never fires, this harness FAILS — a screenshot of an unready page is not proof.
 *
 * Setup once: install puppeteer-core in the site project you are building (never inside
 * this skill folder — it ships as plain files) and run this script from that project:
 *   cd <site-project> && npm i -D puppeteer-core && node <skill>/scripts/verify.cjs ...
 * (A global install works too: NODE_PATH="$(npm root -g)" node verify.cjs ...)
 * Needs Google Chrome; the path is auto-detected for macOS/Linux/Windows — override with
 * CHROME_PATH=/path.
 */
const fs = require('node:fs');

// Resolve from the directory you run in first, then from here (and NODE_PATH).
function loadPuppeteer() {
  try {
    return require(require.resolve('puppeteer-core', { paths: [process.cwd(), __dirname] }));
  } catch {
    console.error('puppeteer-core not found — run `npm i -D puppeteer-core` in your site project ' +
      '(not in this skill folder) and run this script from there.');
    process.exit(1);
  }
}
const puppeteer = loadPuppeteer();

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const p = process.platform;
  if (p === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (p === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  return '/usr/bin/google-chrome';
}

async function withBrowser(fn) {
  const b = await puppeteer.launch({
    executablePath: chromePath(),
    headless: 'new',
    args: ['--hide-scrollbars', '--no-sandbox'],
  });
  try { return await fn(b); }
  finally { await b.close().catch(() => {}); }
}

async function ready(page) {
  await page.waitForFunction('window.__ready === true', { timeout: 45000 })
    .catch(() => { throw new Error('window.__ready never fired — page not ready, refusing to capture (implement the dev contract)'); });
}

async function shot(url, out, w = 1440, h = 900) {
  await withBrowser(async b => {
    const page = await b.newPage();
    await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await ready(page);
    await new Promise(r => setTimeout(r, 1200)); // let lerps/entrances settle
    await page.screenshot({ path: out });
    console.log('captured', out);
  });
}

async function jank(url) {
  await withBrowser(async b => {
    const page = await b.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    await ready(page);
    const stats = await page.evaluate(() => new Promise(res => {
      const end = Math.max(0, (document.scrollingElement || document.documentElement).scrollHeight - innerHeight);
      const deltas = []; let last = performance.now(), y = 0;
      const tick = () => {
        const now = performance.now(); deltas.push(now - last); last = now;
        y += 13; window.scrollTo(0, Math.min(y, end));
        if (y < end) requestAnimationFrame(tick);
        else {
          deltas.sort((a, b) => a - b);
          const p = q => deltas[Math.floor(deltas.length * q)];
          res({
            frames: deltas.length, scrolled: end,
            avg: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1),
            p95: +p(0.95).toFixed(1), max: +deltas[deltas.length - 1].toFixed(1),
            over50: deltas.filter(d => d > 50).length,
          });
        }
      };
      requestAnimationFrame(tick);
    }));
    console.log(JSON.stringify(stats));
    console.log(stats.max < 50 ? 'PASS (max < 50ms)' : 'JANK — investigate the bitmap window / DPR / frame weight');
    if (stats.max >= 50) process.exitCode = 2;
  });
}

// Email can't use the SVG logo (Gmail and Outlook desktop don't render SVG in <img>), so
// render a transparent PNG of it at 2x the email header's 40px logo height.
async function logo(svgPath, out, h = 80) {
  const svg = fs.readFileSync(svgPath);
  await withBrowser(async b => {
    const page = await b.newPage();
    await page.setViewport({ width: 2400, height: +h, deviceScaleFactor: 1 });
    await page.setContent(
      '<html><body style="margin:0;background:transparent">' +
      `<img id="logo" style="display:block;height:${+h}px;width:auto" ` +
      `src="data:image/svg+xml;base64,${svg.toString('base64')}"></body></html>`,
      { waitUntil: 'load' },
    );
    const el = await page.$('#logo');
    await el.screenshot({ path: out, omitBackground: true });
    console.log('rendered', out);
  });
}

const [mode, url, out, w, h] = process.argv.slice(2);
(async () => {
  if (mode === 'shot') await shot(url, out, w, h);
  else if (mode === 'jank') await jank(url);
  else if (mode === 'logo') await logo(url, out, w);
  else { console.error('usage: node verify.cjs shot <url> <out.png> [w] [h]  |  node verify.cjs jank <url>  |  node verify.cjs logo <logo.svg> <logo.png> [height]'); process.exit(1); }
})().catch(e => { console.error(e.message); process.exit(1); });
