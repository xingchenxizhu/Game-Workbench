/** 启动失败时把真实错误显示出来，避免只剩一片黑屏（经典脚本）。 */
(() => {
    const errors: string[] = [];
    function report(entry: any): void {
        try {
            (navigator as any).sendBeacon(((window as any).__GW_BASE__ || '') + '/api/client-error', JSON.stringify(entry));
        }
        catch { /* 忽略上报失败 */ }
    }
    function show(): void {
        const app = document.querySelector('#app');
        if (!app || app.childElementCount > 0)
            return;
        const box = document.createElement('div');
        box.className = 'boot-error';
        box.innerHTML = '<h1>工作台启动失败</h1><p>这是前端脚本错误，把下面的信息贴回对话即可定位。</p><pre></pre>';
        box.querySelector('pre')!.textContent = errors.join('\n\n') || '没有捕获到错误。';
        document.body.append(box);
    }
    window.addEventListener('error', (event: ErrorEvent) => {
        const entry = {
            type: 'error', message: event.message, file: event.filename, line: event.lineno,
            column: event.colno, stack: (event.error as any)?.stack
        };
        errors.push([event.message, `${event.filename}:${event.lineno}:${event.colno}`, (event.error as any)?.stack].filter(Boolean).join('\n'));
        report(entry);
        document.title = `启动失败 · ${event.message}`;
        setTimeout(show, 300);
    });
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        const reason: any = event.reason;
        const entry = { type: 'rejection', message: String(reason?.message || reason), stack: reason?.stack };
        errors.push(`Promise 拒绝：${reason?.stack || reason?.message || reason}`);
        report(entry);
        setTimeout(show, 300);
    });
    setTimeout(show, 1800);
})();
