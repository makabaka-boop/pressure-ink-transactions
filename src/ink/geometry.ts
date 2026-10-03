import type { Pt, Sample, Stroke, ViewTransform } from './types';

export const IDENTITY: ViewTransform = { scale: 1, tx: 0, ty: 0 };

export function screenToDocument(p: Pt, v: ViewTransform): Pt {
  return { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale };
}

export function documentToScreen(p: Pt, v: ViewTransform): Pt {
  return { x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty };
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 以屏幕上的某个点为锚点缩放：保持锚点对应的文档坐标在屏幕上不动。
 */
export function zoomAt(v: ViewTransform, screen: Pt, factor: number, min = 0.1, max = 16): ViewTransform {
  const scale = clamp(v.scale * factor, min, max);
  const realFactor = scale / v.scale;
  return {
    scale,
    tx: screen.x - (screen.x - v.tx) * realFactor,
    ty: screen.y - (screen.y - v.ty) * realFactor,
  };
}

/** 平移视图（delta 为屏幕像素）。 */
export function pan(v: ViewTransform, dx: number, dy: number): ViewTransform {
  return { scale: v.scale, tx: v.tx + dx, ty: v.ty + dy };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** 点到线段距离（文档坐标）。 */
export function distancePointSegment(p: Pt, a: Pt, b: Pt): number {
  const l2 = dist2(a.x, a.y, b.x, b.y);
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/**
 * 橡皮命中测试：点（文档坐标）是否落在笔画的某条线段的容差范围内。
 * radius 为文档坐标下的容差半径。
 */
export function strokeHit(stroke: Stroke, docPt: Pt, radius: number): boolean {
  const s = stroke.samples;
  if (s.length === 0) return false;
  if (s.length === 1) return Math.hypot(docPt.x - s[0].x, docPt.y - s[0].y) <= radius;
  for (let i = 1; i < s.length; i++) {
    if (distancePointSegment(docPt, s[i - 1], s[i]) <= radius) return true;
  }
  return false;
}

/** 点序列的包围盒（文档坐标）。 */
export function bounds(points: readonly Pt[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of points) {
    if (q.x < minX) minX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.x > maxX) maxX = q.x;
    if (q.y > maxY) maxY = q.y;
  }
  return { minX, minY, maxX, maxY };
}

/** 把若干文档坐标点变为屏幕坐标（渲染器用，返回普通数组）。 */
export function toScreenPath(points: readonly Sample[], v: ViewTransform): Pt[] {
  return points.map((q) => documentToScreen(q, v));
}
