import { describe, it, expect } from 'vitest';
import {
  IDENTITY,
  documentToScreen,
  screenToDocument,
  zoomAt,
  pan,
  strokeHit,
  distancePointSegment,
  clamp,
} from '../src/ink/geometry';
import type { Stroke, ViewTransform } from '../src/ink/types';

function stroke(id: number, pts: [number, number][]): Stroke {
  return {
    id,
    gen: 0,
    smoothed: null,
    samples: pts.map(([x, y]) => ({ x, y, p: 0.5 })),
  };
}

describe('坐标变换', () => {
  it('文档↔屏幕互逆', () => {
    const v: ViewTransform = { scale: 2.5, tx: 31, ty: -17 };
    const doc = { x: 120, y: -40 };
    const back = screenToDocument(documentToScreen(doc, v), v);
    expect(back.x).toBeCloseTo(doc.x, 10);
    expect(back.y).toBeCloseTo(doc.y, 10);
  });

  it('平移只改 translate', () => {
    const v = pan(IDENTITY, 10, -5);
    expect(v.scale).toBe(1);
    expect(documentToScreen({ x: 0, y: 0 }, v)).toEqual({ x: 10, y: -5 });
  });

  it('zoomAt 保持锚点对应的文档坐标不动', () => {
    const v0: ViewTransform = { scale: 1, tx: 0, ty: 0 };
    const anchor = { x: 200, y: 100 };
    const docBefore = screenToDocument(anchor, v0);
    const v1 = zoomAt(v0, anchor, 2);
    const docAfter = screenToDocument(anchor, v1);
    expect(docAfter.x).toBeCloseTo(docBefore.x, 10);
    expect(docAfter.y).toBeCloseTo(docBefore.y, 10);
    expect(v1.scale).toBeCloseTo(2, 10);
  });

  it('clamp 钳制缩放范围', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('点到线段距离', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(distancePointSegment({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 10);
    expect(distancePointSegment({ x: 20, y: 0 }, a, b)).toBeCloseTo(10, 10);
  });
});

describe('橡皮命中与坐标变换', () => {
  it('放大视图后：屏幕容差换算成文档容差，命中仍正确', () => {
    // 文档里一条横线 y = 100
    const s = stroke(1, [
      [0, 100],
      [100, 100],
    ]);
    const scale = 2;
    const v: ViewTransform = { scale, tx: 0, ty: 0 };
    // 指针在屏幕 (50, 220)，对应文档 (25, 110)，距笔画 10 文档单位
    const local = { x: 50, y: 220 };
    const docPt = screenToDocument(local, v);
    const screenRadius = 14; // px
    const docRadius = screenRadius / v.scale; // 7 文档单位 → 不命中
    expect(strokeHit(s, docPt, docRadius)).toBe(false);
    // 容差 12 文档单位 → 命中
    expect(strokeHit(s, docPt, 12)).toBe(true);
  });

  it('平移后用文档坐标命中，不受 translate 影响', () => {
    const s = stroke(7, [
      [10, 10],
      [20, 20],
    ]);
    const v = pan(IDENTITY, 500, 500);
    // 屏幕 (515,515) 对应文档 (15,15)，就在笔画上
    const docPt = screenToDocument({ x: 515, y: 515 }, v);
    expect(strokeHit(s, docPt, 1)).toBe(true);
  });
});
