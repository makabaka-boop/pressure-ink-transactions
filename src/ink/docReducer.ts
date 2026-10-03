/**
 * 文档状态（纯函数 reducer，可直接单测）。
 *
 * 编辑代次 gen：每次改变笔画集合的操作（提交 / 撤销 / 重做 / 擦除）都 +1。
 * Worker 的平滑结果带着请求时的 gen 返回，只有 gen 与笔画当前 gen 一致才采纳，
 * 因此旧结果不可能复活已擦除 / 已撤销的笔画。
 */
import { DOC_SAMPLE_LIMIT, type Sample, type Stroke } from './types';

export interface DocState {
  strokes: Stroke[];
  /** 已保存采样总数（仅统计真实笔画）。 */
  sampleCount: number;
  gen: number;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  /** 最近一次提交是否因超出两万点上限被丢弃（供 UI 提示）。 */
  lastCommitDropped: boolean;
}

type UndoEntry =
  | { kind: 'add'; stroke: Stroke }
  | {
      kind: 'erase';
      /** 擦除前的完整笔画顺序，保证撤销时按原位恢复 */
      before: Stroke[];
      /** 擦除后的笔画顺序，重做时直接使用 */
      after: Stroke[];
    };

let nextStrokeId = 1;
export function resetStrokeId(start = 1): void {
  nextStrokeId = start;
}

export function createDoc(): DocState {
  return { strokes: [], sampleCount: 0, gen: 0, undoStack: [], redoStack: [], lastCommitDropped: false };
}

function bump(strokes: Stroke[], s: DocState, undo: UndoEntry): DocState {
  return {
    strokes,
    sampleCount: countSamples(strokes),
    gen: s.gen + 1,
    undoStack: [...s.undoStack, undo],
    redoStack: [],
    lastCommitDropped: false,
  };
}

export function countSamples(strokes: readonly Stroke[]): number {
  let n = 0;
  for (const st of strokes) n += st.samples.length;
  return n;
}

export type DocAction =
  | { type: 'commit'; samples: Sample[] }
  | {
      type: 'erase';
      /** 本次擦除手势命中的笔画 id（组件层用 strokeHit 算好，多次 move 累积） */
      ids: ReadonlySet<number>;
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'smoothed'; id: number; gen: number; points: Sample[] }
  | { type: 'clearDroppedFlag' };

/**
 * 让一组（可能是从 undo/redo 记录里取出的旧对象）笔画在“当前代次”复活：
 * 重打 gen 并清空平滑缓存，使得擦除/撤销期间在途的旧 Worker 结果全部失效。
 */
function retag(strokes: Stroke[], gen: number): Stroke[] {
  return strokes.map((st) => (st.gen === gen ? st : { ...st, gen, smoothed: null }));
}

export function reducer(s: DocState, a: DocAction): DocState {
  switch (a.type) {
    case 'commit': {
      if (a.samples.length === 0) return { ...s, lastCommitDropped: false };
      // 上限在“提交完整笔画”时判定：放不下则整条拒绝，绝不保存半截笔画。
      if (s.sampleCount + a.samples.length > DOC_SAMPLE_LIMIT) {
        return { ...s, lastCommitDropped: true };
      }
      const stroke: Stroke = { id: nextStrokeId++, samples: a.samples, gen: s.gen + 1, smoothed: null };
      return bump([...s.strokes, stroke], s, { kind: 'add', stroke });
    }

    case 'erase': {
      if (a.ids.size === 0) return s;
      const removed = new Set(a.ids);
      const survivors = s.strokes.filter((st) => !removed.has(st.id));
      if (survivors.length === s.strokes.length) return s;
      // 一次擦除手势的全部删除打包成一个 UndoEntry —— 撤销即整体恢复。
      return bump(survivors, s, { kind: 'erase', before: s.strokes, after: survivors });
    }

    case 'undo': {
      const entry = s.undoStack[s.undoStack.length - 1];
      if (!entry) return s;
      const gen = s.gen + 1;
      const undoStack = s.undoStack.slice(0, -1);
      let strokes: Stroke[];
      if (entry.kind === 'add') {
        strokes = s.strokes.filter((st) => st.id !== entry.stroke.id);
      } else {
        strokes = retag(entry.before, gen);
      }
      return {
        strokes,
        sampleCount: countSamples(strokes),
        gen,
        undoStack,
        redoStack: [...s.redoStack, entry],
        lastCommitDropped: false,
      };
    }

    case 'redo': {
      const entry = s.redoStack[s.redoStack.length - 1];
      if (!entry) return s;
      const gen = s.gen + 1;
      const redoStack = s.redoStack.slice(0, -1);
      let strokes: Stroke[];
      if (entry.kind === 'add') {
        // id 单调不复用；即便复用，新 gen 也会拒绝旧在途结果。
        strokes = retag([...s.strokes, entry.stroke], gen);
      } else {
        strokes = retag(entry.after, gen);
      }
      return {
        strokes,
        sampleCount: countSamples(strokes),
        gen,
        undoStack: [...s.undoStack, entry],
        redoStack,
        lastCommitDropped: false,
      };
    }

    case 'smoothed': {
      // 代次裁决：id + gen 同时匹配才采纳；旧结果直接丢弃，已擦除笔画不会复活。
      const strokes = s.strokes.map((st) =>
        st.id === a.id && st.gen === a.gen ? { ...st, smoothed: a.points } : st,
      );
      return { ...s, strokes };
    }

    case 'clearDroppedFlag':
      return s.lastCommitDropped ? { ...s, lastCommitDropped: false } : s;

    default:
      return s;
  }
}
