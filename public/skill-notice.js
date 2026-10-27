/** 素材 iframe 里的「有任务待回填」提示条（经典脚本）。 */
(() => {
    const base = () => window.__GW_BASE__ || '';
    const skillNotice = document.createElement('aside');
    skillNotice.id = 'skill-notice';
    skillNotice.hidden = true;
    const skillText = document.createElement('span');
    const skillButton = document.createElement('button');
    skillButton.textContent = '查看生图任务';
    skillButton.onclick = () => {
        if (parent === window)
            location.assign(`${base()}/#/tasks`);
        else
            parent.postMessage({ type: 'open-chatgpt-images' }, location.origin);
    };
    skillNotice.append(skillText, skillButton);
    document.body.append(skillNotice);
    async function refreshSkillNotice() {
        try {
            const response = await fetch(`${base()}/api/chatgpt/tasks`);
            if (!response.ok)
                return;
            const pending = (await response.json()).filter((task) => task.status === 'waiting' && task.source === 'material-provider');
            skillNotice.hidden = pending.length === 0;
            skillText.textContent = `${pending.length} 个任务等待 ChatGPT 技能执行。打开任务页，复制交接指令到当前聊天；生成并回填后会自动继续。`;
        }
        catch { /* 忽略轮询失败 */ }
    }
    void refreshSkillNotice();
    setInterval(() => { void refreshSkillNotice(); }, 3000);
})();
