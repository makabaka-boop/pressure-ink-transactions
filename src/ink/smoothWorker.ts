/// <reference lib="webworker" />
/**
 * 平滑 Worker：按笔画（id + 提交时的编辑代次 gen）返回结果。
 * 主线程只接受 gen 与笔画当前 gen 完全一致的结果。
 */
import { smoothStroke } from './smoothing';
import type { Sample } from './types';

export interface SmoothRequest {
  id: number;
  gen: number;
  samples: Sample[];
}

export interface SmoothResponse {
  id: number;
  gen: number;
  points: Sample[];
}

self.onmessage = (ev: MessageEvent<SmoothRequest>) => {
  const { id, gen, samples } = ev.data;
  const points = smoothStroke(samples);
  const res: SmoothResponse = { id, gen, points };
  (self as DedicatedWorkerGlobalScope).postMessage(res);
};
