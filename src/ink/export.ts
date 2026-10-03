/**
 * 导出：只包含已提交笔画的权威采样（坐标 + 压感，文档坐标）。
 * 预测点从不进入文档状态，因此天然不可能出现在导出中；
 * smoothed 仅是显示缓存，也不导出。
 */
import type { DocState } from './docReducer';
import type { Stroke } from './types';

export interface ExportStroke {
  id: number;
  samples: { x: number; y: number; p: number }[];
}

export interface ExportDoc {
  version: 1;
  sampleCount: number;
  strokes: ExportStroke[];
}

export function serializeDoc(state: DocState): string {
  const doc: ExportDoc = {
    version: 1,
    sampleCount: state.sampleCount,
    strokes: state.strokes.map((st: Stroke): ExportStroke => ({
      id: st.id,
      samples: st.samples.map((q) => ({ x: q.x, y: q.y, p: q.p })),
    })),
  };
  return JSON.stringify(doc);
}

export function download(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
