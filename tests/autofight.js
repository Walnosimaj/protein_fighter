// Link-to-fight (the fork's addition), in headless Chrome: a fight named in the
// address — ?p1=<UniProt>&p2=<UniProt> — is fetched, rigged, installed and started
// on its own; with &go=0 the fighters load and the title screen stays. Nothing throws.
// Run with:  node tests/autofight.js      (CHROME=/path/to/chrome to override)
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/opt/meta-chromium/chrome';
const HTTP = 8850 + Math.floor(Math.random() * 100), DEV = 9550 + Math.floor(Math.random() * 100);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python3', ['-m', 'http.server', String(HTTP), '--directory', ROOT], { stdio: 'ignore' });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-autofight-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', `--remote-debugging-port=${DEV}`, `--user-data-dir=${dir}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
let failures = 0;
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) failures++; };
(async () => {
  try {
    await sleep(800);
    let made; for (let i = 0; i < 60; i++) { try { made = await (await fetch(`http://127.0.0.1:${DEV}/json/new?about:blank`, { method: 'PUT' })).json(); break; } catch {} await sleep(250); }
    const ws = new WebSocket(made.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
    let id = 0; const pending = {}; const errors = [];
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map(a => a.value ?? a.description).join(' ')); };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    const probe = await fetch(`http://127.0.0.1:${HTTP}/index.html`).then(r => r.status).catch(e => String(e));
    check(probe === 200, `the test server serves the game (got ${probe})`);

    // the fight in the address: GFP (P42212) vs hemoglobin alpha (P69905), both AlphaFold DB
    await send('Page.navigate', { url: `http://localhost:${HTTP}/index.html?p1=P42212&p2=P69905` });
    let phase = '';
    for (let i = 0; i < 120 && phase !== 'playing'; i++) { await sleep(500); phase = await ev(`window.proteinFighter && window.proteinFighter.phase`); }
    if (phase !== 'playing') console.log('  diag: proteinFighter =', await ev(`typeof window.proteinFighter`), '| errors:', errors.slice(0, 3).join(' | ') || 'none');
    check(phase === 'playing', `the linked fight started on its own (phase=${phase})`);
    const forms = (await ev(`window.proteinFighter && Object.keys(window.proteinFighter.forms)`)) || [];
    check(forms.includes('custom0') && forms.includes('custom1'), `both fighters are custom forms (${forms.join(', ')})`);
    const names = (await ev(`[document.getElementById('pick-custom-0').textContent, document.getElementById('pick-custom-1').textContent]`)) || ['', ''];
    check(/GFP|Aequorea/i.test(names[0]) && names[0].trim().length > 0, `P1 fights as ${names[0]}`);
    check(/HBA|HEMOGLOBIN/i.test(names[1]) && names[1].trim().length > 0, `P2 fights as ${names[1]}`);
    const hp = (await ev(`window.proteinFighter && window.proteinFighter.fighters.map(f => f.hp)`)) || [];
    check(hp.every(v => typeof v === 'number'), `both fighters have health (${hp.join(', ')})`);
    await sleep(3000);
    check((await ev(`window.proteinFighter.phase`)) === 'playing', 'the fight is still running after 3 s');

    // &go=0: ubiquitin (1UBQ, from the PDB) loads as P2 and the title screen stays
    await send('Page.navigate', { url: `http://localhost:${HTTP}/index.html?p2=1UBQ&go=0` });
    let loaded = false;
    for (let i = 0; i < 120 && !loaded; i++) { await sleep(500); loaded = await ev(`!!(window.proteinFighter && window.proteinFighter.forms.custom1)`); }
    check(loaded, 'with go=0 the linked fighter loaded');
    check((await ev(`window.proteinFighter.phase`)) === 'ready', 'with go=0 the fight did not start itself');
    check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ') || 'none'})`);
  } finally {
    chrome.kill(); server.kill();
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL OK');
  process.exit(failures ? 1 : 0);
})();
