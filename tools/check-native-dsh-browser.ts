/** Actual nested browser UI + fake DSH SDK; never submits to a real model. */
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createWorkbenchHost } from '../lib/host.js';
const root = await mkdtemp(join(tmpdir(), 'gw-native-dsh-'));
let host: any, browser, page;
const boot = `
window.testRequests=[];window.testReleased=0;window.testOpened=[];
window.__ModuleLoader__={load(registration){
 const plugin=registration.factory(name=>{if(name==='react')return React;throw Error(name);});
 const sessions={create:async()=>('test-'+Date.now()),retain:()=>({ready:Promise.resolve(),release(){window.testReleased++;},binding:{session:{beginSubmission(input){return {requestId:'test-request',abandon(){}};},async prompt(parts,mode,unused,id){window.testRequests.push({parts,mode,id});return {ok:true};}}}})};
 const ctx={get:name=>name==='sessions'?sessions:name==='uiWorkspace'?{openSession:id=>window.testOpened.push(id)}:undefined,slots:{inject:(name,fn)=>fn(),register(spec,View){if(spec.name==='main')ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(View));return()=>{};}}};
 plugin.apply(ctx);
}};`;
const server = createServer(async (req, res) => {
    try {
        if (req.url === '/__dsh-test') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root" style="height:100vh"></div><script src="/game-workbench/vendor/react.js"></script><script src="/game-workbench/vendor/react-dom.js"></script><script src="/__boot.js"></script><script src="/__client.js"></script></body></html>');
        }
        else if (req.url === '/__boot.js') {
            res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            res.end(boot);
        }
        else if (req.url === '/__client.js') {
            res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
            res.end(await readFile('lib/client.js'));
        }
        else
            await host.handler(req, res);
    }
    catch (error: any) {
        res.writeHead(500);
        res.end(error.message);
    }
});
try {
    await new Promise<void>(resolve => server.listen(14182, '127.0.0.1', resolve));
    host = await createWorkbenchHost({ dataRoot: root, mountPath: '/game-workbench', presetBaseUrl: 'http://127.0.0.1:14182' });
    await host.studio.saveConfig({ musicApiKey: 'browser-test-placeholder-not-a-real-key' });
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:14182/__dsh-test');
    const app = page.frameLocator('iframe[title="游戏工作台"]');
    await app.locator('#sidebar').waitFor();
    await app.locator('body').evaluate(() => location.hash = '/tool/music');
    const music = app.frameLocator('.frame-wrap[data-tool=music] iframe');
    await music.getByTestId('music-prompt').waitFor({ timeout: 30000 });
    await music.getByTestId('music-prompt').fill('仅用于原生会话桥接验收的森林背景音乐，不调用模型。');
    await music.getByRole('button', { name: '生成并打开对话', exact: true }).click();
    await page.waitForFunction(() => window.testRequests.length === 1 && window.testReleased === 1, { timeout: 20000 });
    const sent = await page.evaluate(() => ({ requests: window.testRequests, opened: window.testOpened, released: window.testReleased }));
    assert.equal(sent.opened.length, 1);
    assert.equal(sent.requests[0].mode, 'queue');
    const text = sent.requests[0].parts[0].text;
    assert.ok(text.includes('workspaceId:"default"'));
    assert.ok(text.includes('game_workbench('));
    assert.ok(!/game_material\s*\(/.test(text));
    assert.deepEqual(errors, []);
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/native-dsh-session.png', fullPage: true });
    await writeFile('test-results/native-dsh-session.json', JSON.stringify({ ok: true, actualBrowser: true, fakeDshSdk: true, threeFrameMessageBridge: true, nativeSessionOpened: true, promptSubmitted: true, workspaceScoped: true, referenceReleased: true, paidGeneration: false, errors }, null, 2));
    console.log('PASS: actual nested UI -> native DSH session -> queue submission, scoped workspace, no model call');
}
catch (error) {
    if (page)
        await page.screenshot({ path: 'test-results/native-dsh-session-failure.png', fullPage: true }); await writeFile('test-results/native-dsh-session-debug.json', JSON.stringify({url:page.url(),frames:page.frames().map(f=>f.url()),outer:await page.locator('body').innerHTML()},null,2));
    throw error;
}
finally {
    if (browser)
        await browser.close();
    if (host)
        await host.dispose();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
}


