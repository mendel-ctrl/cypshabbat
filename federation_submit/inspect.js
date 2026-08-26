const { chromium } = require('playwright');

(async () => {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--ssl-version-max=tls1.2'], proxy: proxy ? { server: proxy } : undefined });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1600 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto('https://www.jewishgulfcoast.org/calendar/submit', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);

  // Dump all form controls
  const controls = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input, textarea, select').forEach(el => {
      out.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        id: el.id || '',
        placeholder: el.placeholder || '',
        cls: (el.className || '').toString().slice(0, 80),
        label: (el.labels && el.labels[0] && el.labels[0].innerText || '').slice(0, 60),
      });
    });
    return out;
  });
  console.log('=== FORM CONTROLS ===');
  console.log(JSON.stringify(controls, null, 1));

  // Detect recaptcha
  const recaptcha = await page.evaluate(() => {
    const info = {};
    info.grecaptcha_present = !!window.grecaptcha;
    info.iframe_srcs = Array.from(document.querySelectorAll('iframe')).map(f => f.src).filter(s => /recaptcha|captcha|hcaptcha/i.test(s));
    info.recaptcha_divs = Array.from(document.querySelectorAll('.g-recaptcha, [data-sitekey], [class*="captcha"]')).map(d => ({cls: d.className, sitekey: d.getAttribute('data-sitekey'), size: d.getAttribute('data-size')}));
    // scripts
    info.recaptcha_scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src).filter(s => /recaptcha|captcha/i.test(s));
    return info;
  });
  console.log('=== RECAPTCHA ===');
  console.log(JSON.stringify(recaptcha, null, 1));

  // Page title & headings
  const meta = await page.evaluate(() => ({
    title: document.title,
    h1: Array.from(document.querySelectorAll('h1,h2,h3,legend,label')).map(h=>h.innerText.trim()).filter(Boolean).slice(0,40),
    buttons: Array.from(document.querySelectorAll('button, input[type=submit]')).map(b=>({t:(b.innerText||b.value||'').trim(), type:b.type})),
  }));
  console.log('=== META ===');
  console.log(JSON.stringify(meta, null, 1));

  await page.screenshot({ path: 'screenshots/form_initial.png', fullPage: true });
  console.log('screenshot saved');

  // Also dump a chunk of visible text to understand structure
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  console.log('=== BODY TEXT (first 3000) ===');
  console.log(bodyText);

  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
