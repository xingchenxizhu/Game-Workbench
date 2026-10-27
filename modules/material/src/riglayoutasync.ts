import { Worker } from "node:worker_threads";
import type { Rgba, LayoutPartInput, LayoutSolveOptions, LayoutSolveResult } from "./rigpose.js";

const workers = new Set<Worker>();

/** CPU-heavy matching must not block HTTP status queries or the interactive editor. */
export function solveLayoutAsync(reference: Rgba, parts: LayoutPartInput[], options: LayoutSolveOptions): Promise<LayoutSolveResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./riglayoutworker.js", import.meta.url), { workerData: { reference, parts, options } });
    workers.add(worker);
    const timer = setTimeout(() => finish(new Error("自动装配计算超过3分钟，请减少部件或降低匹配分辨率后重试")), 180000);
    let settled = false;
    function finish(error?: Error, value?: LayoutSolveResult) {
      if (settled) return;
      settled = true; clearTimeout(timer); workers.delete(worker);
      void worker.terminate().catch(() => undefined);
      if (error) reject(error); else resolve(value!);
    }
    worker.once("message", message => message.ok ? finish(undefined, message.value) : finish(new Error(message.error)));
    worker.once("error", error => finish(error));
    worker.once("exit", code => { if (!settled) finish(new Error(`自动装配计算线程退出（${code}）`)); });
  });
}

export function disposeLayoutWorkers(): void {
  for (const worker of workers) void worker.terminate().catch(() => undefined);
  workers.clear();
}
