import { describe, it, expect, beforeEach } from 'vitest';
import { createDoc, reducer, resetStrokeId } from '../src/ink/docReducer';
import type { Sample } from '../src/ink/types';

function samples(prefix: string, n: number, press = 0.5): Sample[] {
  // prefix 仅用于让不同笔画坐标不同
  const off = prefix.charCodeAt(0) * 10;
  return Array.from({ length: n }, (_, i) => ({ x: off + i, y: off, p: press }));
}

beforeEach(() => resetStrokeId(1));

describe('提交与采样上限', () => {
  it('抬笔提交完整笔画，压力随样本一起保存', () => {
    let d = createDoc();
    d = reducer(d, { type: 'commit', samples: samples('a', 3, 0.7) });
    expect(d.strokes).toHaveLength(1);
    expect(d.sampleCount).toBe(3);
    expect(d.strokes[0].samples[1].p).toBe(0.7);
    expect(d.gen).toBe(1);
    expect(d.strokes[0].gen).toBe(1);
  });

  it('总采样超过 20000 时整条笔画拒绝，已有数据不动', () => {
    let d = createDoc();
    d = reducer(d, { type: 'commit', samples: samples('a', 19999) });
    const before = d.strokes;
    d = reducer(d, { type: 'commit', samples: samples('b', 2) }); // 19999+2 > 20000
    expect(d.sampleCount).toBe(19999);
    expect(d.strokes).toBe(before);
    expect(d.lastCommitDropped).toBe(true);
  });

  it('恰好到 20000 可以提交，第 20001 个被拒', () => {
    let d = createDoc();
    d = reducer(d, { type: 'commit', samples: samples('a', 20000) });
    expect(d.sampleCount).toBe(20000);
    d = reducer(d, { type: 'commit', samples: samples('b', 1) });
    expect(d.strokes).toHaveLength(1);
    expect(d.lastCommitDropped).toBe(true);
  });
});

describe('擦除与撤销分组', () => {
  it('一次擦除经过多条笔画：打包为一个撤销操作', () => {
    let d = createDoc();
    d = reducer(d, { type: 'commit', samples: samples('a', 2) }); // id 1
    d = reducer(d, { type: 'commit', samples: samples('b', 2) }); // id 2
    d = reducer(d, { type: 'commit', samples: samples('c', 2) }); // id 3
    expect(d.undoStack).toHaveLength(3);

    // 一次擦除手势命中 1 和 3（中间 move 累积，up 时一次性 dispatch）
    d = reducer(d, { type: 'erase', ids: new Set([1, 3]) });
    expect(d.strokes.map((s) => s.id)).toEqual([2]);
    // 三个 add 记录 + 一个 erase 记录
    expect(d.undoStack).toHaveLength(4);

    // 单次撤销同时恢复两条，且保持原顺序
    d = reducer(d, { type: 'undo' });
    expect(d.strokes.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(d.sampleCount).toBe(6);
  });

  it('空擦除不产生撤销记录', () => {
    let d = createDoc();
    d = reducer(d, { type: 'commit', samples: samples('a', 2) });
    const stackLen = d.undoStack.length;
    d = reducer(d, { type: 'erase', ids: new Set() });
    expect(d.undoStack).toHaveLength(stackLen);
  });

  it('擦除后重做再次删除同一组', () => {
    let d = createDoc();
    d = reducer(d, { type: 'commit', samples: samples('a', 2) });
    d = reducer(d, { type: 'commit', samples: samples('b', 2) });
    d = reducer(d, { type: 'erase', ids: new Set([1]) });
    expect(d.strokes.map((s) => s.id)).toEqual([2]);
    d = reducer(d, { type: 'undo' });
    expect(d.strokes.map((s) => s.id)).toEqual([1, 2]);
    d = reducer(d, { type: 'redo' });
    expect(d.strokes.map((s) => s.id)).toEqual([2]);
  });
});

describe('编辑代次：旧 Worker 结果不能复活笔画', () => {
  it('笔画擦除后到达的旧 gen 平滑结果被丢弃', () => {
    let d = createDoc();
    d = reducer(d, { type: 'commit', samples: samples('a', 5) });
    const id = d.strokes[0].id;
    const genAtCommit = d.strokes[0].gen;

    d = reducer(d, { type: 'erase', ids: new Set([id]) });
    expect(d.strokes).toHaveLength(0);

    // Worker 此时才返回旧结果
    d = reducer(d, {
      type: 'smoothed',
      id,
      gen: genAtCommit,
      points: samples('z', 5),
    });
    // 笔画没有复活
    expect(d.strokes).toHaveLength(0);
  });

  it('撤销后重提的笔画会重打 gen，擦除期间的旧结果一律拒绝', () => {
    let d = createDoc();
    d = reducer(d, { type: 'commit', samples: samples('a', 4) });
    const id = d.strokes[0].id;
    const oldGen = d.strokes[0].gen;
    d = reducer(d, { type: 'undo' });
    d = reducer(d, { type: 'redo' }); // 复活：重打新 gen、清空平滑缓存
    const revived = d.strokes.find((s) => s.id === id)!;
    expect(revived.gen).not.toBe(oldGen);
    expect(revived.smoothed).toBeNull();

    // 在途的旧 gen Worker 结果到达 —— 必须拒绝
    const after = reducer(d, { type: 'smoothed', id, gen: oldGen, points: samples('z', 4) });
    expect(after.strokes.find((s) => s.id === id)!.smoothed).toBeNull();

    // 当前 gen 的结果正常采纳
    const ok = reducer(d, { type: 'smoothed', id, gen: revived.gen, points: samples('z', 4) });
    expect(ok.strokes.find((s) => s.id === id)!.smoothed).toHaveLength(4);
  });

  it('当前 gen 匹配时平滑结果正常采纳，且不改原始采样', () => {
    let d = createDoc();
    d = reducer(d, { type: 'commit', samples: samples('a', 4) });
    const st = d.strokes[0];
    const original = st.samples.map((q) => ({ ...q }));
    d = reducer(d, {
      type: 'smoothed',
      id: st.id,
      gen: st.gen,
      points: samples('s', 24),
    });
    const updated = d.strokes[0];
    expect(updated.smoothed).toHaveLength(24);
    expect(updated.samples).toEqual(original); // 权威采样不变
  });
});
