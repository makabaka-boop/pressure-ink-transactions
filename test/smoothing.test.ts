import { describe, it, expect } from 'vitest';
import { smoothStroke } from '../src/ink/smoothing';
import { serializeDoc } from '../src/ink/export';
import { createDoc, reducer, resetStrokeId } from '../src/ink/docReducer';
import type { Sample } from '../src/ink/types';

const pts: Sample[] = [
  { x: 0, y: 0, p: 0.2 },
  { x: 10, y: 5, p: 0.4 },
  { x: 20, y: -5, p: 0.6 },
  { x: 30, y: 0, p: 0.8 },
];

describe('平滑（Worker 侧纯函数）', () => {
  it('确定性：同样输入多次结果完全一致（不同事件分批的下游也一致）', () => {
    const a = smoothStroke(pts, 6);
    const b = smoothStroke(pts.map((q) => ({ ...q })), 6);
    expect(a).toEqual(b);
  });

  it('细分段数决定输出密度，首尾点保持与原始一致', () => {
    const out = smoothStroke(pts, 6);
    expect(out[0]).toMatchObject({ x: 0, y: 0 });
    expect(out[out.length - 1]).toMatchObject({ x: 30, y: 0 });
    expect(out).toHaveLength((pts.length - 1) * 6 + 1);
  });

  it('压力随平滑点一起输出且在合理范围', () => {
    const out = smoothStroke(pts, 6);
    for (const q of out) {
      expect(q.p).toBeGreaterThanOrEqual(0);
      expect(q.p).toBeLessThanOrEqual(1);
    }
  });

  it('少于 3 点直接复制，不做样条（也不与空笔画产生意外输出）', () => {
    expect(smoothStroke([pts[0]])).toEqual([pts[0]]);
    expect(smoothStroke([])).toEqual([]);
    const two = smoothStroke([pts[0], pts[1]]);
    expect(two).toHaveLength(2);
  });
});

describe('导出', () => {
  it('只导出权威采样与压感，不含 smoothed / 预测点', () => {
    resetStrokeId(1);
    let d = createDoc();
    d = reducer(d, { type: 'commit', samples: pts });
    d = reducer(d, { type: 'smoothed', id: 1, gen: d.strokes[0].gen, points: smoothStroke(pts) });

    const text = serializeDoc(d);
    expect(text).not.toContain('smoothed');
    expect(text).not.toContain('predicted');
    const parsed = JSON.parse(text);
    expect(parsed.version).toBe(1);
    expect(parsed.strokes).toHaveLength(1);
    expect(parsed.strokes[0].samples).toHaveLength(4);
    expect(parsed.strokes[0].samples[1]).toEqual({ x: 10, y: 5, p: 0.4 });
  });
});
