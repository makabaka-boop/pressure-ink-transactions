/**
 * Canvas 渲染。所有读取均基于传入状态快照，不修改任何采样；
 * 重绘只消费 samples / smoothed，永远不会反过来写数据。
 */
import { documentToScreen } from './geometry';
import type { Sample, Stroke, ViewTransform } from './types';

export interface RenderOptions {
  baseWidth: number;
}

function strokePath(ctx: CanvasRenderingContext2D, pts: readonly Sample[], v: ViewTransform): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const s = documentToScreen(pts[i], v);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
}

/** 以压感调制宽度逐段描边。 */
function drawVariableWidth(ctx: CanvasRenderingContext2D, pts: readonly Sample[], v: ViewTransform, baseWidth: number): void {
  if (pts.length === 0) return;
  if (pts.length === 1) {
    const q = documentToScreen(pts[0], v);
    ctx.beginPath();
    ctx.arc(q.x, q.y, (baseWidth * pts[0].p * v.scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const a = documentToScreen(pts[i - 1], v);
    const b = documentToScreen(pts[i], v);
    const w = baseWidth * ((pts[i - 1].p + pts[i].p) / 2) * v.scale;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

/** 绘制一条已提交笔画：有平滑结果用平滑结果（仅显示），否则用原始采样。 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, v: ViewTransform, opts: RenderOptions): void {
  const pts = stroke.smoothed ?? stroke.samples;
  ctx.strokeStyle = '#111111';
  ctx.fillStyle = '#111111';
  drawVariableWidth(ctx, pts, v, opts.baseWidth);
}

/** 正在书写的笔画（真实采样实线）+ 预测预览（虚线半透明）。 */
export function drawInProgress(
  ctx: CanvasRenderingContext2D,
  samples: readonly Sample[],
  predicted: readonly Sample[],
  v: ViewTransform,
  opts: RenderOptions,
): void {
  ctx.strokeStyle = '#111111';
  ctx.fillStyle = '#111111';
  drawVariableWidth(ctx, samples, v, opts.baseWidth);

  if (predicted.length > 1) {
    ctx.save();
    ctx.setLineDash([6 * v.scale, 5 * v.scale]);
    ctx.strokeStyle = 'rgba(30, 110, 220, 0.45)';
    ctx.lineWidth = opts.baseWidth * 0.7 * v.scale;
    ctx.lineCap = 'round';
    strokePath(ctx, predicted, v);
    ctx.stroke();
    ctx.restore();
  }
}

export function clear(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
}

/** 橡皮圈光标（屏幕坐标）。 */
export function drawEraserCursor(
  ctx: CanvasRenderingContext2D,
  screen: { x: number; y: number },
  radius: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(220, 60, 60, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
