import { describe, it, expect } from 'vitest';
import {
  IngestSession,
  mergeBatch,
  normalizePressure,
  BASE_PRESSURE,
  type RawEvent,
} from '../src/ink/ingest';
import { IDENTITY } from '../src/ink/geometry';
import type { ViewTransform } from '../src/ink/types';

function raw(x: number, y: number, pressure = 0.5, time = 0, pointerType: RawEvent['pointerType'] = 'pen'): RawEvent {
  return { x, y, pressure, time, pointerType };
}

describe('压感归一化', () => {
  it('正常压感裁剪到 (0,1]', () => {
    expect(normalizePressure(0.3)).toBe(0.3);
    expect(normalizePressure(1)).toBe(1);
    expect(normalizePressure(2)).toBe(1);
  });
  it('压感为 0 时回退到基准值（预测/设备不支持）', () => {
    expect(normalizePressure(0)).toBe(BASE_PRESSURE);
  });
});

describe('事件分批合并', () => {
  it('不同分批方式产生完全相同的笔画结果', () => {
    // 同一条轨迹，两种浏览器派发方式：
    const events: RawEvent[] = [
      raw(0, 0, 0.4, 1),
      raw(1, 1, 0.42, 2),
      raw(2, 2, 0.45, 3),
      raw(3, 3, 0.5, 4),
    ];

    // A：每个事件单独一次 move（无 coalesced）
    const a = new IngestSession(raw(0, 0, 0.4, 1), IDENTITY);
    for (const e of events.slice(1)) a.move([e], null, IDENTITY);

    // B：全部 coalesced 进一次 move
    const b = new IngestSession(raw(0, 0, 0.4, 1), IDENTITY);
    b.move(events.slice(1), null, IDENTITY);

    // C：分成两批
    const c = new IngestSession(raw(0, 0, 0.4, 1), IDENTITY);
    c.move(events.slice(1, 3), null, IDENTITY);
    c.move(events.slice(3), null, IDENTITY);

    const ra = a.finish()!;
    const rb = b.finish()!;
    const rc = c.finish()!;
    expect(ra.samples).toEqual(rb.samples);
    expect(rb.samples).toEqual(rc.samples);
    expect(ra.samples).toHaveLength(4);
  });

  it('时间戳重复的合并点去重', () => {
    // 主事件与最后一个 coalesced 事件时间戳相同
    const merged = mergeBatch(
      [raw(5, 5, 0.5, 10), raw(6, 6, 0.6, 11), raw(6, 6, 0.6, 11)],
      IDENTITY,
      null,
    );
    expect(merged).toHaveLength(2);
  });

  it('坐标重合的连续点折叠（与上一采样相比）', () => {
    const merged = mergeBatch([raw(3, 3, 0.5, 1), raw(3, 3, 0.9, 2)], IDENTITY, {
      x: 3,
      y: 3,
      p: 0.4,
    });
    expect(merged).toHaveLength(0);
  });

  it('压感与坐标绑定在同一条样本里，并按视图变换换算', () => {
    const v: ViewTransform = { scale: 2, tx: 10, ty: 20 };
    const s = new IngestSession(raw(50, 60, 0.8, 1), v);
    // 文档坐标 = (50-10)/2, (60-20)/2
    expect(s.samples[0]).toMatchObject({ x: 20, y: 20, p: 0.8 });
  });
});

describe('预测点隔离与回退', () => {
  it('预测点只进入预览，绝不进入提交样本', () => {
    const s = new IngestSession(raw(0, 0, 0.5, 1), IDENTITY);
    const committed = [raw(1, 1, 0.5, 2), raw(2, 2, 0.5, 3)];
    const predicted = [raw(3, 3, 0.5, 4), raw(4, 4, 0.5, 5), raw(5, 5, 0.5, 6)];
    s.move(committed, predicted, IDENTITY);

    expect(s.samples).toHaveLength(3); // down + 2 committed
    expect(s.predicted.length).toBeGreaterThan(1);
    // 预览延伸到了 (5,5)
    expect(s.predicted[s.predicted.length - 1]).toMatchObject({ x: 5, y: 5 });

    const done = s.finish()!;
    expect(done.samples).toHaveLength(3);
    expect(done.samples.map((q) => q.x)).not.toContain(5);
    // finish 后预览清空
    expect(s.predicted).toHaveLength(0);
  });

  it('不支持预测事件时回退：预览只有最后真实点，不影响保存', () => {
    const s = new IngestSession(raw(0, 0, 0.5, 1), IDENTITY);
    s.move([raw(2, 0, 0.6, 2)], null, IDENTITY); // null = 无 getPredictedEvents
    expect(s.predicted).toHaveLength(1);
    expect(s.predicted[0]).toMatchObject({ x: 2, y: 0 });
    expect(s.finish()!.samples).toHaveLength(2);
  });

  it('预测点压感为 0 也只影响预览（基准回退），真实样本不受污染', () => {
    const s = new IngestSession(raw(0, 0, 0.5, 1), IDENTITY);
    s.move([raw(1, 0, 0.7, 2)], [raw(2, 0, 0, 3)], IDENTITY);
    const tail = s.predicted[s.predicted.length - 1];
    expect(tail.p).toBe(BASE_PRESSURE);
    expect(s.finish()!.samples.map((q) => q.p)).toEqual([0.5, 0.7]);
  });
});

describe('取消语义', () => {
  it('pointercancel：整条未完成笔画作废，finish 不产生数据', () => {
    const s = new IngestSession(raw(0, 0, 0.5, 1), IDENTITY);
    s.move([raw(1, 1, 0.5, 2), raw(2, 2, 0.5, 3)], null, IDENTITY);
    s.cancel();
    expect(s.active).toBe(false);
    expect(s.samples).toHaveLength(0);
    expect(s.finish()).toBeNull();
  });

  it('finish 之后再次 finish 不会重复提交', () => {
    const s = new IngestSession(raw(0, 0, 0.5, 1), IDENTITY);
    expect(s.finish()).not.toBeNull();
    expect(s.finish()).toBeNull();
  });
});
