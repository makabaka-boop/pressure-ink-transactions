/**
 * 输入层：把 Pointer Events 合并成笔画采样。
 *
 * 铁律：
 * 1. 预测事件（getPredictedEvents）只写入 `predicted`（临时预览），
 *    任何情况下都不会进入 `samples`，因此不可能进入保存 / 擦除判断 / 导出。
 * 2. 每条输入在进入会话时立刻用当时的视图变换换算成文档坐标，
 *    并与归一化后的压感打包成同一个 Sample —— 压力与坐标终生绑定。
 * 3. move 只负责追加；完整笔画在 pointerup 时一次性提交，
 *    cancel / 丢失指针捕获则丢弃整条未完成笔画。
 */
import type { Pt, Sample, ViewTransform } from './types';
import { screenToDocument } from './geometry';

export type PointerType = 'pen' | 'mouse' | 'touch';

/** 适配器从 PointerEvent 读出的原始字段（屏幕/层坐标），便于用合成数据做测试。 */
export interface RawEvent {
  x: number;
  y: number;
  pressure: number;
  time: number;
  pointerType: PointerType;
}

export interface Normalized extends Pt {
  p: number;
  t: number;
}

export const BASE_PRESSURE = 0.5;

/**
 * 压感归一化：
 * - 正常读数直接裁剪到 (0, 1]；
 * - 读数为 0（部分手写笔移动中偶发 0、不支持 force 的触摸设备）回退到基准压感。
 */
export function normalizePressure(rawPressure: number): number {
  if (rawPressure > 0) return Math.min(1, rawPressure);
  return BASE_PRESSURE;
}

/**
 * 把一批原始事件（coalesced 事件 + 主事件）去重并转成文档坐标。
 * - 同一时间戳只保留第一个；
 * - 与上一条完全重合（x/y 相同）的连续点折叠；
 * - 顺序保持设备产生的顺序（coalesced 在前、主事件在尾）。
 */
export function mergeBatch(
  raw: readonly RawEvent[],
  view: ViewTransform,
  last: Sample | null,
): Normalized[] {
  const out: Normalized[] = [];
  let lastTime: number | null = null;
  let px = last?.x;
  let py = last?.y;
  for (const e of raw) {
    if (e.time === lastTime) continue;
    lastTime = e.time;
    const d = screenToDocument(e, view);
    if (px === d.x && py === d.y) continue;
    px = d.x;
    py = d.y;
    out.push({ x: d.x, y: d.y, p: normalizePressure(e.pressure), t: e.time });
  }
  return out;
}

/**
 * 一次指针手势的输入会话。生命周期：down -> (move)* -> up|cancel。
 */
export class IngestSession {
  /** 权威采样，只包含真实事件；抬笔提交时直接成为 Stroke.samples。 */
  samples: Sample[] = [];
  /** 预测预览点（含最后一个真实点作为预览起点）。仅供渲染，不保存、不导出。 */
  predicted: Sample[] = [];
  active = true;
  readonly pointerType: PointerType;

  constructor(down: RawEvent, view: ViewTransform) {
    this.pointerType = down.pointerType;
    this.samples = mergeBatch([down], view, null).map((n) => ({ x: n.x, y: n.y, p: n.p }));
  }

  private get last(): Sample | null {
    return this.samples.length ? this.samples[this.samples.length - 1] : null;
  }

  /**
   * 处理一次 pointermove。
   * @param committed coalesced 事件 + 主事件（真实数据）
   * @param predicted 主事件的 getPredictedEvents()（可能不存在——此时回退为无预测）
   */
  move(committed: readonly RawEvent[], predicted: readonly RawEvent[] | null, view: ViewTransform): void {
    if (!this.active) return;
    const merged = mergeBatch(committed, view, this.last);
    for (const n of merged) this.samples.push({ x: n.x, y: n.y, p: n.p });

    // 预测点只进入预览，从不 push 进 samples。
    const prev: Sample[] = [];
    const lastReal = this.last;
    if (lastReal) prev.push(lastReal);
    if (predicted && predicted.length && lastReal) {
      // 预测点只做几何去重（含与真实末点的重合），时间戳不参与折叠；压感缺失回退基准值。
      let px = lastReal.x;
      let py = lastReal.y;
      for (const e of predicted) {
        const d = screenToDocument(e, view);
        if (px === d.x && py === d.y) continue;
        px = d.x;
        py = d.y;
        prev.push({ x: d.x, y: d.y, p: normalizePressure(e.pressure) });
      }
    }
    this.predicted = prev;
  }

  /** 抬笔：固化真实采样（清除预测），返回要提交的笔画数据；无效笔画返回 null。 */
  finish(): { samples: Sample[]; pointerType: PointerType } | null {
    if (!this.active) return null;
    this.active = false;
    this.predicted = [];
    if (this.samples.length === 0) return null;
    return { samples: this.samples, pointerType: this.pointerType };
  }

  /** 取消（pointercancel / 丢失捕获）：整条未完成笔画作废，什么都不提交。 */
  cancel(): void {
    this.active = false;
    this.samples = [];
    this.predicted = [];
  }
}
