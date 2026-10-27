// Only for inherited offline verification. Never submit reference tests to a paid endpoint.
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
  const url=new URL(typeof input==='string'?input:input.url || input);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) return Promise.reject(new Error('离线验证：已阻止外部请求'));
  return originalFetch(input,init);
};
