#!/usr/bin/env node
/*
 * Submit Chabad of St. Petersburg events to the Jewish Federation of Florida's
 * Gulf Coast community calendar.
 *
 *   Form: https://www.jewishgulfcoast.org/calendar/submit  (reCAPTCHA v2 checkbox)
 *
 * Designed to run on a NORMAL machine with a VISIBLE (headed) Chromium window,
 * on a residential connection, so reCAPTCHA usually passes on a single checkbox
 * click. When it does throw an image/audio challenge, the run PAUSES and waits
 * for YOU to solve it in the visible window, then continues. Progress is saved
 * to submit_log.csv after every event so a re-run resumes instead of duplicating.
 *
 * Setup (once):
 *   npm install playwright@1.56.1
 *   npx playwright install chromium
 *
 * Run:
 *   SUBMITTER_FIRST="Mendel" SUBMITTER_LAST="…" SUBMITTER_EMAIL="mendel@chabadsp.com" \
 *   node submit_events.js
 *
 * Env vars:
 *   SUBMITTER_FIRST / SUBMITTER_LAST / SUBMITTER_EMAIL  (required — the form
 *        requires "Your Details"; used for submitter AND event contact)
 *   HEADLESS=1        run without a window (NOT recommended — reCAPTCHA will block)
 *   CAPTCHA_WAIT_MS   how long to wait for you to solve a challenge (default 300000 = 5 min)
 *   START_AT / STOP_AT   optional num bounds, e.g. START_AT=1 STOP_AT=1 to do only event #1
 *   USE_PROXY=1       route through $HTTPS_PROXY with TLS1.2 (only needed inside the
 *                     Claude sandbox; leave unset on your own machine)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
// Use the remaining-only list if present (events not yet on the calendar),
// otherwise fall back to the full list. Override with CSV_FILE=... if needed.
const CSV_IN = process.env.CSV_FILE
  ? path.join(DIR, process.env.CSV_FILE)
  : (fs.existsSync(path.join(DIR, 'federation_events_remaining.csv'))
      ? path.join(DIR, 'federation_events_remaining.csv')
      : path.join(DIR, 'federation_events.csv'));
const LOG = path.join(DIR, 'submit_log.csv');
const SHOTS = path.join(DIR, 'screenshots');
const FORM_URL = 'https://www.jewishgulfcoast.org/calendar/submit';

const SUBMITTER = {
  first: process.env.SUBMITTER_FIRST || 'Chabad',
  last:  process.env.SUBMITTER_LAST  || 'Team',
  email: process.env.SUBMITTER_EMAIL || 'Info@chabadsp.com',
};
const HEADLESS = process.env.HEADLESS === '1';
const CAPTCHA_WAIT_MS = parseInt(process.env.CAPTCHA_WAIT_MS || '300000', 10);
const START_AT = process.env.START_AT ? parseInt(process.env.START_AT, 10) : 1;
const STOP_AT  = process.env.STOP_AT  ? parseInt(process.env.STOP_AT, 10)  : Infinity;
const USE_PROXY = process.env.USE_PROXY === '1';

// ---------- tiny RFC4180 CSV parser ----------
function parseCSV(text) {
  const rows = []; let row = [], field = '', i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function readEvents() {
  const rows = parseCSV(fs.readFileSync(CSV_IN, 'utf8')).filter(r => r.length > 1 && r.some(c => c.trim() !== ''));
  const header = rows.shift().map(h => h.trim());
  return rows.map(r => { const o = {}; header.forEach((h, idx) => o[h] = (r[idx] || '').trim()); return o; });
}

// ---------- log ----------
function ensureLog() {
  if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, 'num,title,status,timestamp,note\n');
}
function submittedNums() {
  ensureLog();
  const rows = parseCSV(fs.readFileSync(LOG, 'utf8'));
  rows.shift();
  const done = new Set();
  for (const r of rows) { if (r[0] && (r[2] || '').startsWith('submitted')) done.add(r[0].trim()); }
  return done;
}
function csvCell(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function appendLog(num, title, status, note) {
  const line = [num, title, status, new Date().toISOString(), note || ''].map(csvCell).join(',') + '\n';
  fs.appendFileSync(LOG, line);
}

// ---------- recurrence parsing ----------
const DAY_WORDS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function parseRepeats(s) {
  // e.g. "Weekly on Tuesdays through July 27, 2027"
  if (!s) return null;
  const day = DAY_WORDS.find(d => new RegExp(d, 'i').test(s));
  const m = s.match(/through\s+(.+)$/i);
  const until = m ? m[1].trim() : '';
  return { day, until };
}

// ---------- form helpers ----------
async function setChosen(page, name, value) {
  // Sets a native <select> value (backing a "chosen" widget) and fires change.
  await page.evaluate(({ name, value }) => {
    const sel = document.querySelector(`select[name="${name}"]`);
    if (!sel) return;
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) { try { window.jQuery(sel).trigger('liszt:updated').trigger('chosen:updated'); } catch (e) {} }
  }, { name, value });
}
async function fillText(page, name, value) {
  const loc = page.locator(`[name="${name}"]`).first();
  await loc.fill(value == null ? '' : String(value));
}
async function setDate(page, name, value) {
  // fill and also set value directly, then blur/escape to dismiss any datepicker
  const loc = page.locator(`[name="${name}"]`).first();
  await loc.click();
  await loc.fill('');
  await loc.type(String(value), { delay: 15 });
  await page.evaluate(({ name, value }) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (el) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, { name, value });
  await page.keyboard.press('Escape').catch(() => {});
}
async function clickCustomCheckbox(page, byLabelText) {
  // The Repeat / "I am the event contact" boxes are custom switchers; a label
  // click runs their reveal logic, so use that.
  const lab = page.locator(`label:has-text("${byLabelText}")`).first();
  await lab.click();
}
async function forceCheckbox(page, name, checked) {
  // For readonly/custom checkboxes (e.g. All Day): remove readonly and force state.
  await page.evaluate(({ name, checked }) => {
    const e = document.querySelector(`input[name="${name}"]`);
    if (!e) return;
    e.readOnly = false; e.removeAttribute('readonly');
    if (e.checked !== checked) { e.checked = checked; e.dispatchEvent(new Event('change', { bubbles: true })); e.dispatchEvent(new Event('click', { bubbles: true })); }
    const box = e.closest('.custom-checkbox'); if (box) box.classList.toggle('checked', checked);
  }, { name, checked });
}

// safe page.evaluate: returns fallback if the context was destroyed by a navigation
async function safeEval(page, fn, fallback) {
  try { return await page.evaluate(fn); } catch (e) { return fallback; }
}

// Handle the reCAPTCHA and submit the form. Tolerant of the page navigating at
// any moment (e.g. the human clicks Submit themselves). Returns a status object.
async function solveCaptchaAndSubmit(page) {
  await safeEval(page, () => {
    const el = document.querySelector('.recaptcha-element, .g-recaptcha, [data-sitekey]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(400);
  const anchor = page.frames().find(f => f.url().includes('/recaptcha/api2/anchor'));
  if (anchor) { await anchor.locator('#recaptcha-anchor').click({ delay: 100 }).catch(() => {}); }

  const deadline = Date.now() + CAPTCHA_WAIT_MS;
  let warned = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    // If the form is gone (navigated / submitted), confirm the outcome.
    const state = await safeEval(page, () => ({
      onForm: !!document.querySelector('input[name="title"]'),
      token: (document.querySelector('textarea[name="g-recaptcha-response"]') || {}).value || '',
    }), null);
    if (state === null) return await confirmOutcome(page);      // context destroyed by navigation
    if (!state.onForm) return await confirmOutcome(page);       // already left the form
    if (state.token && state.token.length > 20) {
      // reCAPTCHA satisfied — submit for the user, tolerate the navigation
      await Promise.all([
        page.waitForNavigation({ timeout: 25000 }).catch(() => {}),
        safeEval(page, () => {
          const b = [...document.querySelectorAll('input[type=submit], button[type=submit]')]
            .find(x => /submit/i.test(x.value || x.innerText || '') && !/search/i.test(x.value || x.innerText || ''));
          if (b) b.click();
        }),
      ]);
      return await confirmOutcome(page);
    }
    const challenge = await safeEval(page, () => [...document.querySelectorAll('iframe')]
      .filter(f => f.src.includes('/recaptcha/api2/bframe'))
      .some(f => { const r = f.getBoundingClientRect(); return r.width > 50 && r.height > 50 && r.top > -800; }), false);
    if (challenge && !warned) {
      warned = true;
      console.log('   ⚠️  reCAPTCHA puzzle shown — solve it in the window. The script submits for you; do NOT click Submit yourself.');
      if (HEADLESS) return { status: 'paused', detail: 'captcha-challenge-headless' };
    }
  }
  return { status: 'paused', detail: 'captcha-timeout' };
}

// After a submit/navigation, decide whether it went through.
async function confirmOutcome(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const info = await safeEval(page, () => ({
    url: location.href,
    text: document.body.innerText.slice(0, 5000),
    stillForm: !!document.querySelector('input[name="title"]'),
    errs: [...document.querySelectorAll('.error, .errors, .alert-danger, [class*="error"]')]
      .map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 6),
  }), { url: '', text: '', stillForm: false, errs: [] });
  const hit = /(thank you|thank\-you|submitted for review|has been submitted|will be reviewed|received your|your (event|submission)|success|pending approval)/i.test(info.text);
  const leftFormUrl = info.url && !/\/calendar\/submit\/?$/.test(info.url);
  if (hit) return { status: 'submitted', detail: 'confirmation message', url: info.url };
  if (leftFormUrl && !info.stillForm) return { status: 'submitted', detail: 'navigated to ' + info.url, url: info.url };
  return { status: 'unknown', detail: 'no clear confirmation', url: info.url, errs: info.errs };
}

async function fillEvent(page, ev) {
  await fillText(page, 'title', ev.title);
  await setDate(page, 'date_start', ev.start_date);
  await setDate(page, 'date_end', ev.end_date);

  if ((ev.all_day || '').toLowerCase() === 'yes') {
    // All-Day input is readonly by default; drop readonly then real-click its box.
    await page.evaluate(() => {
      const e = document.querySelector('input[name="all_day"]');
      if (!e) return; e.readOnly = false; e.removeAttribute('readonly');
      e.closest('.custom-checkbox')?.classList.remove('readonly');
    });
    const already = await page.$eval('input[name="all_day"]', e => e.checked).catch(() => false);
    if (!already) await page.locator('label.all-day .custom-checkbox').first().click();
    await page.waitForTimeout(300);
    // toggling All-Day clears the dates and disables the end date (single-day
    // all-day); re-apply the start, and the end only if it stays enabled.
    await setDate(page, 'date_start', ev.start_date);
    const endUsable = await page.evaluate(() => { const e = document.querySelector('[name="date_end"]'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled; });
    if (endUsable) await setDate(page, 'date_end', ev.end_date);
  }

  const rep = parseRepeats(ev.repeats);
  if (rep && rep.day) {
    const before = await page.$eval('input[name="use_recurrence"]', e => e.checked).catch(() => false);
    if (!before) await clickCustomCheckbox(page, 'This Event will Repeat');
    await page.waitForTimeout(500);
    await setChosen(page, 'recurrence_frequency', 'WEEKLY'); // repeat every 1 week
    await fillText(page, 'recurrence_interval', '1');
    await page.waitForTimeout(400);
    const DAY_ABBR = { Sunday: 'SU', Monday: 'MO', Tuesday: 'TU', Wednesday: 'WE', Thursday: 'TH', Friday: 'FR', Saturday: 'SA' };
    const want = DAY_ABBR[rep.day];
    // real-click "On Certain Days" then the weekday box (targeted by value to
    // avoid the identical "On Additional Days" weekday labels below it)
    for (let attempt = 0; attempt < 3; attempt++) {
      const noDaysChecked = await page.$eval('input[name="on_anniversary"][value="no_days"]', e => e.checked).catch(() => false);
      if (!noDaysChecked) await page.locator('label.on-days .custom-radio').first().click().catch(() => {});
      await page.waitForTimeout(200);
      const dayChecked = await page.$eval(`input[name="recurrence_days[]"][value="${want}"]`, e => e.checked).catch(() => false);
      if (!dayChecked) {
        await page.locator(`input[name="recurrence_days[]"][value="${want}"]`)
          .locator('xpath=ancestor::div[contains(@class,"custom-checkbox")]').first().click().catch(() => {});
      }
      await page.waitForTimeout(200);
      const ok = await page.$eval(`input[name="recurrence_days[]"][value="${want}"]`, e => e.checked).catch(() => false);
      if (ok) break;
    }
    if (rep.until) await setDate(page, 'recurrence_repeat_until', rep.until);
  }

  await fillText(page, 'body', ev.description);

  // Location
  await fillText(page, 'location_description', ev.location_name);
  await fillText(page, 'location_address1', ev.address);
  await fillText(page, 'location_city', ev.city);
  await fillText(page, 'location_zip', ev.zip);
  await setChosen(page, 'location_state', 'FL');
  await setChosen(page, 'location_country', 'US');

  // Your Details (required) + reuse as event contact
  await fillText(page, 'submitter_first_name', SUBMITTER.first);
  await fillText(page, 'submitter_last_name', SUBMITTER.last);
  await fillText(page, 'submitter_email', SUBMITTER.email);
  const contactChecked = await page.$eval('input[name="submitter_is_contact"]', e => e.checked).catch(() => false);
  if (!contactChecked) { await clickCustomCheckbox(page, 'I am the event contact'); }
  await page.waitForTimeout(300);
  // If contact fields are still present/required, fill them too.
  const contactVisible = await page.evaluate(() => {
    const e = document.querySelector('[name="contact_first_name"]');
    if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  });
  if (contactVisible) {
    await fillText(page, 'contact_first_name', SUBMITTER.first);
    await fillText(page, 'contact_last_name', SUBMITTER.last);
    await fillText(page, 'contact_email', SUBMITTER.email);
  }
}

async function main() {
  if (!SUBMITTER.first || !SUBMITTER.last || !SUBMITTER.email) {
    console.error('ERROR: set SUBMITTER_FIRST, SUBMITTER_LAST, SUBMITTER_EMAIL (the form requires "Your Details").');
    process.exit(2);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const events = readEvents();
  const done = submittedNums();
  console.log(`Loaded ${events.length} events. Already submitted: ${done.size}. Headless=${HEADLESS}`);

  const launchArgs = ['--no-sandbox', '--start-maximized'];
  const launchOpts = { headless: HEADLESS, args: launchArgs };
  if (USE_PROXY && process.env.HTTPS_PROXY) { launchOpts.proxy = { server: process.env.HTTPS_PROXY }; launchArgs.push('--ssl-version-max=tls1.2'); }
  const browser = await chromium.launch(launchOpts);
  // viewport:null → use the real (maximized) window size so nothing sits below
  // the screen edge; the reCAPTCHA and Submit button stay reachable.
  const ctx = await browser.newContext({ ignoreHTTPSErrors: USE_PROXY, viewport: null });
  const page = await ctx.newPage();

  let ok = 0, err = 0, processed = 0;
  for (const ev of events) {
    const num = ev.num;
    if (+num < START_AT || +num > STOP_AT) continue;
    if (done.has(num)) { continue; }
    processed++;
    console.log(`\n[${num}] ${ev.title}`);
    try {
      await page.goto(FORM_URL, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1500);
      await fillEvent(page, ev);

      const res = await solveCaptchaAndSubmit(page);
      const shot = path.join(SHOTS, `event_${String(num).padStart(3, '0')}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

      if (res.status === 'submitted') {
        ok++; appendLog(num, ev.title, 'submitted', ev.notes ? 'FLAGGED: ' + ev.notes : '');
        console.log(`   ✅ submitted (${res.detail})  shot=${path.basename(shot)}`);
      } else if (res.status === 'paused') {
        appendLog(num, ev.title, 'paused: ' + res.detail, 'progress saved; re-run to resume at this event');
        console.log(`   ⏸  PAUSED on event ${num}: ${res.detail}. Nothing submitted for this row.`);
        break;
      } else {
        err++; appendLog(num, ev.title, 'error: no confirmation', 'url=' + (res.url || '') + ' errs=' + JSON.stringify(res.errs || []).slice(0, 160));
        console.log(`   ❌ no clear confirmation. url=${res.url} errs=${JSON.stringify(res.errs || []).slice(0,160)}`);
        console.log(`      Stopping so you can check this one before continuing (screenshot: ${path.basename(shot)}).`);
        break;
      }
    } catch (e) {
      err++; appendLog(num, ev.title, 'error: ' + e.message.split('\n')[0].slice(0, 120), '');
      console.log(`   ❌ error: ${e.message.split('\n')[0]}`);
      break;
    }
    if ((ok + err) % 10 === 0) console.log(`--- progress: ${ok} submitted, ${err} errored ---`);
    await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000)); // 2–4s
  }

  console.log(`\nDONE. submitted=${ok} errored=${err}. Log: ${LOG}`);
  await browser.close();
}
if (require.main === module) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
module.exports = { readEvents, fillEvent, parseRepeats, SUBMITTER };
