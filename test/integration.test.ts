import { describe, it, expect, beforeEach } from 'vitest';
import { IngestSession, type RawEvent } from '../src/ink/ingest';
import { createDoc, reducer, resetStrokeId } from '../src/ink/docReducer';
import { screenToDocument, strokeHit, zoomAt, type ViewTransform } from '../src/ink';
import { serializeDoc } from '../src/ink/export';

/**
 * 端到端（无 DOM）：模拟“缩放后书写 → 橡皮在变换坐标下命中 → 整组删除 →
 * 一次撤销恢复全部 → 导出”的完整数据流。
 */
describe('集成：坐标变换 + 擦除撤销 + 导出', () => {
  beforeEach(() => resetStrokeId(1));

  it('全链路', () => {
    let doc = createDoc();
    // 放大 2 倍、平移 (40, 60)
    const view: ViewTransform = { scale: 2, tx: 40, ty: 60 };

    // 笔画 1：屏幕轨迹 (100,100) → (200,100)
    const write = (screenPts: [number, number][]) => {
      const raws: RawEvent[] = screenPts.map(([x, y], i) => ({
        x,
        y,
        pressure: 0.5,
        time: i + 1,
        pointerType: 'pen',
      }));
      const s = new IngestSession(raws[0], view);
      s.move(raws.slice(1), null, view);
      return s.finish()!.samples;
    };

    doc = reducer(doc, { type: 'commit', samples: write([[100, 100], [140, 100], [200, 100]]) });
    // 笔画 2：另一条线
    doc = reducer(doc, { type: 'commit', samples: write([[100, 200], [200, 200]]) });
    expect(doc.strokes).toHaveLength(2);

    // 采样都已换算成文档坐标
    const first = doc.strokes[0].samples;
    expect(first[0]).toEqual({
      x: (100 - 40) / 2,
      y: (100 - 60) / 2,
      p: 0.5,
    });

    // 橡皮点在笔画 1 中段（屏幕 (150,100)），容差 14px → 7 文档单位
    const eraseDoc = screenToDocument({ x: 150, y: 100 }, view);
    const radius = 14 / view.scale;
    const hit = new Set<number>();
    for (const st of doc.strokes) if (strokeHit(st, eraseDoc, radius)) hit.add(st.id);
    expect(hit).toEqual(new Set([1])); // 笔画 2 在 y=70 文档处，不命中

    doc = reducer(doc, { type: 'erase', ids: hit });
    expect(doc.strokes.map((s) => s.id)).toEqual([2]);

    // 一次撤销恢复笔画 1
    doc = reducer(doc, { type: 'undo' });
    expect(doc.strokes.map((s) => s.id)).toEqual([1, 2]);

    const exported = JSON.parse(serializeDoc(doc));
    expect(exported.strokes).toHaveLength(2);
    expect(exported.sampleCount).toBe(5); // 第一笔 3 点 + 第二笔 2 点
    // 导出的是文档坐标（重绘/变换不改变保存的采样）
    expect(exported.strokes[0].samples[0].x).toBe(30);
  });

  it('zoomAt 后书写坐标与屏幕手势锚点一致', () => {
    const v0 = zoomAt({ scale: 1, tx: 0, ty: 0 }, { x: 300, y: 300 }, 1.5);
    const s = new IngestSession(
      { x: 300, y: 300, pressure: 0.9, time: 1, pointerType: 'pen' },
      v0,
    );
    const d = screenToDocument({ x: 300, y: 300 }, v0);
    expect(s.samples[0].x).toBeCloseTo(d.x, 10);
    expect(s.samples[0].p).toBe(0.9);
  });
});
