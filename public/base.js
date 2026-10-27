/** 计算页面所在目录，供所有绝对接口/资源地址拼前缀（经典脚本，最先执行）。 */
(() => {
    const path = location.pathname;
    window.__GW_BASE__ = path.charAt(path.length - 1) === '/'
        ? path.slice(0, -1)
        : path.replace(/\/[^/]*$/, '');
})();
