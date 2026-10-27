import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await mkdir('test-results', { recursive: true });
try {
  await page.goto('http://127.0.0.1:4173');
  await page.locator('.matrix').waitFor();
  await page.screenshot({ path: 'test-results/workbench.png', fullPage: true });
  console.log('首页：', (await page.locator('#view').innerText()).slice(0, 200).replace(/\n/g, ' | '));

  await page.locator('#sidebar .nav-space[data-space="assets"]').click();
  await page.locator('.tool-card').first().waitFor();
  console.log('素材工坊：', await page.locator('.tool-card').count(), '个工具');

  await page.locator('a[href="#/tool/matte"]').first().click();
  await page.locator('.dropzone').first().waitFor();
  await page.screenshot({ path: 'test-results/matte.png', fullPage: true });

  await page.goto('http://127.0.0.1:4173/#/settings');
  await page.frameLocator('.frame-wrap[data-tool="settings"] iframe').locator('body').waitFor({ timeout: 30000 });
  await page.screenshot({ path: 'test-results/settings.png' });

  await page.goto('http://127.0.0.1:4173/#/tool/stitch');
  await page.frameLocator('.frame-wrap[data-tool="stitch"] iframe').locator('body').waitFor({ timeout: 30000 });
  await page.screenshot({ path: 'test-results/mapstitch.png' });

  await page.goto('http://127.0.0.1:4173/#/tasks');
  await page.locator('.tasks-summary').waitFor();
  await page.screenshot({ path: 'test-results/chatgpt.png' });

  await writeFile('test-results/browser-errors.json', JSON.stringify(errors, null, 2));
  if (errors.length) throw Error(errors.join('\n'));
  console.log('浏览器检查通过');
} finally {
  await browser.close();
}
