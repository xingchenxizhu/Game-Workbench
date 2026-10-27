import { parentPort, workerData } from "node:worker_threads";
import { solveLayout, type Rgba, type LayoutPartInput } from "./rigpose.js";

try {
  const restore = (image: Rgba): Rgba => ({ ...image, data: Buffer.from(image.data) });
  const result = solveLayout(restore(workerData.reference), workerData.parts.map((part: LayoutPartInput) => ({ ...part, rgba: restore(part.rgba) })), workerData.options);
  parentPort!.postMessage({ ok: true, value: result });
} catch (error) {
  parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
parentPort!.close();
