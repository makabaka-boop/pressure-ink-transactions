/**
 * 核心领域类型。
 *
 * 关键约定：
 * - 采样点坐标一律是“文档坐标”（document space），与视图缩放/平移无关；
 * - pressure 与坐标绑定在同一个 Sample 上，属于其所在笔画，永不单独漂移；
 * - 预测点只有 {x,y,p} 的形态，且只活在输入层的临时预览里。
 */

export interface Pt {
  x: number;
  y: number;
}

/** 一个已提交的采样点：坐标 + 绑定的压感。 */
export interface Sample extends Pt {
  p: number;
}

/**
 * 一条笔画。
 * - samples：权威采样（原始保存数据），重绘 / Worker 都不会改动它；
 * - smoothed：Worker 异步平滑结果，仅用于显示，为 null 时退回原始采样。
 */
export interface Stroke {
  id: number;
  samples: Sample[];
  /** 该笔画提交时文档所处的编辑代次，用来裁决过期的 Worker 结果。 */
  gen: number;
  smoothed: Sample[] | null;
}

/** 视图变换：screen = document * scale + translate。 */
export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

export type Tool = 'pen' | 'eraser' | 'hand';

export const DOC_SAMPLE_LIMIT = 20000;
