/** 「智能拆分」结果送入骨骼装配：建骨骼任务 → 上传拆件图 → 返回任务 id。 */
import { api } from './api.js';

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * 把一个已完成生图任务的图作为「拆件总览图」导入骨骼模块。
 * 失败时会删掉刚建的空任务，避免在骨骼列表里留下垃圾。
 */
export async function sendTaskToRig(task: any, { name }: any = {}) {
  if (!task?.id || !task?.result) throw new Error('任务还没有生成结果');
  const response = await fetch(api.resultUrl(task));
  if (!response.ok) throw new Error('结果图读取失败');
  const data = await blobToBase64(await response.blob());

  const created = await api.rpc('createRigJob', { name: name || `AI 拆件 ${task.id.slice(0, 8)}` });
  const jobId = created?.value?.jobId;
  if (!jobId) throw new Error('创建骨骼任务失败');

  try {
    await api.rpc('uploadRigSheet', { jobId, name: `sheet-${task.id.slice(0, 8)}.png`, data });
  } catch (error) {
    await api.rpc('deleteRigJob', { jobId }).catch(() => {});
    throw error;
  }
  return jobId;
}

/** 打开骨骼模块并直接落到某个任务的拆件阶段。 */
export function rigDeepLink(jobId) {
  return `dsh-gmm=1&module=rig&job=${encodeURIComponent(jobId)}&stage=parts`;
}
