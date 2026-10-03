/**
 * 笔画平滑：均匀 Catmull-Rom 样条重采样。
 *
 * - 输入 / 输出都是采样点；压力从最近的原始采样线性继承（压力绑定坐标一起输出）；
 * - 纯函数、确定性：同样的采样必然得到同样的结果（测试直接依赖这一点）；
 * - 只在 Worker 里执行，结果仅用于显示，绝不写回 Stroke.samples。
 */
import type { Sample } from './types';

const SUBDIV = 6; // 每段原始点之间插值的份数

function interp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 均匀 Catmull-Rom，t∈[0,1] 在 p1→p2 之间。 */
function catmull(p0: Sample, p1: Sample, p2: Sample, p3: Sample, t: number): Sample {
  const t2 = t * t;
  const t3 = t2 * t;
  const w0 = -t3 + 2 * t2 - t;
  const w1 = 3 * t3 - 5 * t2 + 2;
  const w2 = -3 * t3 + 4 * t2 + t;
  const w3 = t3 - t2;
  return {
    x: (w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x) / 2,
    y: (w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y) / 2,
    p: (w0 * p0.p + w1 * p1.p + w2 * p2.p + w3 * p3.p) / 2,
  };
}

export function smoothStroke(samples: readonly Sample[], subdiv = SUBDIV): Sample[] {
  if (samples.length < 3) return samples.map((q) => ({ ...q }));

  // 端点复制，使样条穿过首尾。
  const pts: Sample[] = [samples[0], ...samples.map((q) => ({ ...q })), samples[samples.length - 1]];
  const out: Sample[] = [];
  // pts[0..n+1]，原始点 i 对应 pts[i+1]。
  for (let i = 0; i < samples.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const p2 = pts[i + 2];
    const p3 = pts[i + 3];
    for (let k = 0; k < subdiv; k++) {
      const t = k / subdiv;
      // 压力：跟随当前段起点的原始采样（保留笔画的压感节奏）。
      const q = catmull(p0, p1, p2, p3, t);
      q.p = interp(p1.p, p2.p, t);
      out.push(q);
    }
  }
  out.push({ ...samples[samples.length - 1] });
  return out;
}
