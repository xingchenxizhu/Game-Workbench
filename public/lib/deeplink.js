/** 旧插件的深链接解析：/?dsh-gmm=1&module=map&stage=paint */
import { getTool } from '../registry.js';
export function resolveDeepLink(search) {
    const query = new URLSearchParams(search);
    if (!query.has('dsh-gmm'))
        return null;
    const tool = getTool(query.get('module') || 'sprite');
    if (!tool)
        return null;
    const extra = String(search).replace(/^\?/, '');
    return { toolId: tool.id, url: extra ? `${tool.url}&${extra}` : tool.url, search: extra };
}
