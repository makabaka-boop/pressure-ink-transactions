/**
 * PointerEvent 适配器：把浏览器事件转成输入层的 RawEvent。
 * 真实数据 = getCoalescedEvents()（若有）+ 主事件；
 * 预测数据 = getPredictedEvents()（单独通道，只给预览）。
 */
import type { RawEvent } from './ingest';

function toRaw(e: PointerEvent): RawEvent {
  return {
    x: e.clientX,
    y: e.clientY,
    pressure: e.pressure,
    time: e.timeStamp,
    pointerType: (e.pointerType as 'pen' | 'mouse' | 'touch') ?? 'mouse',
  };
}

export function readPrimary(e: PointerEvent): RawEvent[] {
  const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  if (coalesced.length > 0) return [...coalesced].map(toRaw);
  return [toRaw(e)];
}

/** 预测事件可能不被支持，此时返回 null —— 预览回退为“无预测”。 */
export function readPredicted(e: PointerEvent): RawEvent[] | null {
  if (typeof e.getPredictedEvents !== 'function') return null;
  const list = e.getPredictedEvents();
  if (!list || list.length === 0) return null;
  return [...list].map(toRaw);
}

/** 橡皮擦输入：pointerType === 'eraser'，或笔的桶状按钮（buttons bit 32）。 */
export function isEraserInput(e: {
  pointerType: string;
  buttons: number;
}): boolean {
  return e.pointerType === 'eraser' || (e.pointerType === 'pen' && (e.buttons & 32) !== 0);
}
