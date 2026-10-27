/** Shared export path: browser download + explicit local material library. */
import { withBase } from './api.js';
import { download, toast } from './dom.js';
let zipReady: Promise<any> | undefined;
let psdReady: Promise<any> | undefined;
export function loadPsd(): Promise<any> {
    if ((window as any).agPsd)
        return Promise.resolve((window as any).agPsd);
    return psdReady ||= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = withBase('/vendor/ag-psd.js');
        script.onload = () => { const lib = (window as any).agPsd; if (lib?.writePsd)
            resolve(lib);
        else {
            psdReady = undefined;
            reject(new Error('PSD 模块无效'));
        } };
        script.onerror = () => { psdReady = undefined; reject(new Error('PSD 模块加载失败')); };
        document.head.append(script);
    });
}
export function loadZip(): Promise<any> {
    if ((window as any).JSZip)
        return Promise.resolve((window as any).JSZip);
    return zipReady ||= new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = withBase('/vendor/jszip.js'); script.onload = () => resolve((window as any).JSZip); script.onerror = () => { zipReady = undefined; reject(new Error('ZIP 模块加载失败')); }; document.head.append(script); });
}
export async function blobData(blob: Blob): Promise<string> { return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); }); }
export async function exportBlob(blob: Blob, name: string, save = true): Promise<void> {
    if (save) {
        try {
            const response = await fetch(withBase('/api/assets/save'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data: await blobData(blob) }) });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.error?.message || '保存失败');
            toast('已保存到素材目录：' + result.path);
        }
        catch (error: any) {
            toast('本机素材目录未保存：' + error.message + '。仍提供浏览器下载。', 'warn', 7000);
        }
    }
    const url = URL.createObjectURL(blob);
    download(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
