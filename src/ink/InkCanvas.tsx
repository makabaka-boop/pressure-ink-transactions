import { useEffect, useReducer, useRef, useState, useCallback } from 'react';
import { createDoc, reducer } from './docReducer';
import {
  IDENTITY,
  pan,
  screenToDocument,
  strokeHit,
  zoomAt,
} from './geometry';
import { IngestSession, type RawEvent } from './ingest';
import { isEraserInput, readPredicted, readPrimary } from './pointerAdapter';
import {
  clear,
  drawEraserCursor,
  drawInProgress,
  drawStroke,
} from './render';
import type { Tool, ViewTransform } from './types';
import SmoothWorker from './smoothWorker?worker';
import type { SmoothResponse } from './smoothWorker';

const BASE_WIDTH = 3;
const ERASER_RADIUS_SCREEN = 14;

type EraseState = { ids: Set<number> } | null;

export default function InkCanvas() {
  const [doc, dispatch] = useReducer(reducer, undefined, createDoc);
  const [tool, setTool] = useState<Tool>('pen');
  const [showSmooth, setShowSmooth] = useState(true);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const sessionRef = useRef<IngestSession | null>(null);
  const eraseRef = useRef<EraseState>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  /** 是否触发过 pointercancel / lostpointercapture，up 时据此撤销未完成笔画。 */
  const cancelledRef = useRef(false);
  const viewRef = useRef<ViewTransform>(IDENTITY);
  const toolRef = useRef<Tool>('pen');
  const showSmoothRef = useRef(true);

  const workerRef = useRef<Worker | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    showSmoothRef.current = showSmooth;
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSmooth]);

  // ---- Worker：按笔画 id + gen 接收平滑结果，旧代次在 reducer 内被丢弃 ----
  useEffect(() => {
    const w = new SmoothWorker();
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<SmoothResponse>) => {
      const { id, gen, points } = ev.data;
      dispatch({ type: 'smoothed', id, gen, points });
    };
    return () => w.terminate();
  }, []);

  // ---- 自适应尺寸 / DPR ----
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);
    resize();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resize = useCallback(() => {
    const base = baseRef.current;
    const overlay = overlayRef.current;
    const wrap = wrapRef.current;
    if (!base || !overlay || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    sizeRef.current = { w, h, dpr };
    for (const c of [base, overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    scheduleDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 用 ref 持有最新的 draw，rAF 回调永远执行当次渲染的闭包（读到最新 doc/cursor）。
  const drawRef = useRef<() => void>(() => {});

  const scheduleDraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      drawRef.current();
    });
  }, []);

  // 文档状态变化后重绘（渲染不修改任何采样）。
  useEffect(() => {
    scheduleDraw();
  }, [doc, scheduleDraw]);

  // 上限提示短暂展示后自动清除。
  useEffect(() => {
    if (!doc.lastCommitDropped) return;
    const t = setTimeout(() => dispatch({ type: 'clearDroppedFlag' }), 2500);
    return () => clearTimeout(t);
  }, [doc.lastCommitDropped]);

  drawRef.current = () => {
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (!base || !overlay) return;
    const { w, h, dpr } = sizeRef.current;
    const v = viewRef.current;
    const bctx = base.getContext('2d');
    const octx = overlay.getContext('2d');
    if (!bctx || !octx) return;

    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clear(bctx, w, h);
    clear(octx, w, h);

    bctx.fillStyle = '#ffffff';
    bctx.fillRect(0, 0, w, h);

    for (const st of doc.strokes) {
      // 擦除手势进行中：命中的笔画即时淡化（状态尚未删除，松手才提交删除）。
      const erasing = eraseRef.current?.ids.has(st.id);
      bctx.globalAlpha = erasing ? 0.2 : 1;
      drawStroke(bctx, showSmoothRef.current ? st : { ...st, smoothed: null }, v, { baseWidth: BASE_WIDTH });
    }
    bctx.globalAlpha = 1;

    const session = sessionRef.current;
    if (session && session.active) {
      drawInProgress(octx, session.samples, session.predicted, v, { baseWidth: BASE_WIDTH });
    }
    if (toolRef.current === 'eraser' && cursor) {
      drawEraserCursor(octx, cursor, ERASER_RADIUS_SCREEN);
    }
  };

  // ---- 坐标：屏幕(相对画布) -> 文档 ----
  const localPt = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = baseRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const eraseAt = useCallback(
    (local: { x: number; y: number }) => {
      const v = viewRef.current;
      const radius = ERASER_RADIUS_SCREEN / v.scale;
      const docPt = screenToDocument(local, v);
      // 命中即删除整条笔画；一次手势经过的笔画累积进同一个集合（一个撤销操作）。
      for (const st of doc.strokes) {
        if (!eraseRef.current!.ids.has(st.id) && strokeHit(st, docPt, radius)) {
          eraseRef.current!.ids.add(st.id);
        }
      }
      scheduleDraw();
    },
    [doc.strokes, scheduleDraw],
  );

  // ---- Pointer handlers ----
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // 捕获必须设在事件所在元素（overlay），move/up 才会继续派发到这里。
      e.currentTarget.setPointerCapture(e.pointerId);
      cancelledRef.current = false;
      const local = localPt(e);
      const activeTool: Tool = toolRef.current === 'pen' && isEraserInput(e) ? 'eraser' : toolRef.current;

      if (activeTool === 'hand' || e.button === 1) {
        panRef.current = { x: local.x, y: local.y };
        return;
      }
      if (activeTool === 'eraser') {
        eraseRef.current = { ids: new Set() };
        eraseAt(local);
        return;
      }

      const down: RawEvent = {
        x: local.x,
        y: local.y,
        pressure: e.pressure,
        time: e.timeStamp,
        pointerType: (e.pointerType as RawEvent['pointerType']) ?? 'mouse',
      };
      sessionRef.current = new IngestSession(down, viewRef.current);
      scheduleDraw();
    },
    [eraseAt, localPt, scheduleDraw],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const local = localPt(e);
      setCursor(local);

      if (panRef.current) {
        const dx = local.x - panRef.current.x;
        const dy = local.y - panRef.current.y;
        viewRef.current = pan(viewRef.current, dx, dy);
        panRef.current = { x: local.x, y: local.y };
        scheduleDraw();
        return;
      }
      if (eraseRef.current) {
        eraseAt(local);
        return;
      }
      const session = sessionRef.current;
      if (session && session.active) {
        session.move(readPrimary(e.nativeEvent), readPredicted(e.nativeEvent), viewRef.current);
        scheduleDraw();
      }
    },
    [eraseAt, localPt, scheduleDraw],
  );

  const finishStroke = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    if (cancelledRef.current) {
      // 取消 / 失去捕获：撤销未完成笔画（不提交任何采样）。
      session.cancel();
      return;
    }
    const done = session.finish(); // 抬笔提交完整笔画
    if (done && done.samples.length > 0) {
      dispatch({ type: 'commit', samples: done.samples });
    }
  }, []);

  const onPointerUp = useCallback(
    () => {
      if (panRef.current) {
        panRef.current = null;
        return;
      }
      if (eraseRef.current) {
        const ids = eraseRef.current.ids;
        eraseRef.current = null;
        if (ids.size > 0) dispatch({ type: 'erase', ids });
        scheduleDraw();
        return;
      }
      // 不显式 release：pointerup 后浏览器自动释放，避免与 lostcapture 竞态误撤销。
      finishStroke();
    },
    [finishStroke, scheduleDraw],
  );

  const onPointerCancel = useCallback(() => {
    cancelledRef.current = true;
    finishStroke();
  }, [finishStroke]);

  // 丢失捕获等同取消：正在进行的笔画整体撤销。
  const onLostCapture = useCallback(() => {
    if (sessionRef.current?.active) {
      cancelledRef.current = true;
      finishStroke();
    }
  }, [finishStroke]);

  // ---- 缩放 / 平移：ctrl+wheel 以光标为锚缩放，普通 wheel 平移 ----
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0015);
        viewRef.current = zoomAt(viewRef.current, local, factor);
      } else {
        viewRef.current = pan(viewRef.current, -e.deltaX, -e.deltaY);
      }
      scheduleDraw();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scheduleDraw]);

  // ---- 平滑派发：提交的笔画（未被擦除、尚无平滑结果）送进 Worker ----
  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    for (const st of doc.strokes) {
      if (st.smoothed == null) {
        w.postMessage({ id: st.id, gen: st.gen, samples: st.samples });
      }
    }
  }, [doc]);

  const zoomBy = useCallback(
    (factor: number) => {
      const { w, h } = sizeRef.current;
      viewRef.current = zoomAt(viewRef.current, { x: w / 2, y: h / 2 }, factor);
      scheduleDraw();
    },
    [scheduleDraw],
  );

  const resetView = useCallback(() => {
    viewRef.current = IDENTITY;
    scheduleDraw();
  }, [scheduleDraw]);

  return (
    <div className="app">
      <Toolbar
        tool={tool}
        setTool={setTool}
        showSmooth={showSmooth}
        setShowSmooth={setShowSmooth}
        sampleCount={doc.sampleCount}
        canUndo={doc.undoStack.length > 0}
        canRedo={doc.redoStack.length > 0}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onZoomIn={() => zoomBy(1.2)}
        onZoomOut={() => zoomBy(1 / 1.2)}
        onResetView={resetView}
        doc={doc}
      />
      {doc.lastCommitDropped && <div className="toast">已达 20,000 采样上限，该笔画未保存</div>}
      <div ref={wrapRef} className="canvas-wrap">
        <canvas ref={baseRef} className="layer" />
        <canvas
          ref={overlayRef}
          className="layer overlay"
          style={{
            cursor:
              tool === 'eraser' ? 'none' : tool === 'hand' ? 'grab' : 'crosshair',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onLostCapture}
          onPointerLeave={() => setCursor(null)}
          onPointerEnter={(e) => setCursor(localPt(e))}
        />
        <div className="hint-inner">
          缩放 Ctrl+滚轮 · 平移 滚轮 / 抓手拖拽 · 压感笔自动识别 · 视图 {Math.round(viewRef.current.scale * 100)}%
        </div>
      </div>
    </div>
  );
}

// ---- Toolbar ----
import { serializeDoc, download } from './export';
import type { DocState } from './docReducer';

interface ToolbarProps {
  tool: Tool;
  setTool: (t: Tool) => void;
  showSmooth: boolean;
  setShowSmooth: (b: boolean) => void;
  sampleCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  doc: DocState;
}

function Toolbar(p: ToolbarProps) {
  const btn = (active: boolean) => 'tb-btn' + (active ? ' active' : '');
  return (
    <div className="toolbar">
      <button className={btn(p.tool === 'pen')} onClick={() => p.setTool('pen')}>
        ✏️ 笔
      </button>
      <button className={btn(p.tool === 'eraser')} onClick={() => p.setTool('eraser')}>
        🧽 橡皮
      </button>
      <button className={btn(p.tool === 'hand')} onClick={() => p.setTool('hand')}>
        ✋ 平移
      </button>
      <span className="sep" />
      <button className="tb-btn" onClick={p.onUndo} disabled={!p.canUndo}>
        ↶ 撤销
      </button>
      <button className="tb-btn" onClick={p.onRedo} disabled={!p.canRedo}>
        ↷ 重做
      </button>
      <span className="sep" />
      <button className="tb-btn" onClick={p.onZoomOut}>
        −
      </button>
      <button className="tb-btn" onClick={p.onZoomIn}>
        +
      </button>
      <button className="tb-btn" onClick={p.onResetView}>
        1:1
      </button>
      <label className="tb-check">
        <input type="checkbox" checked={p.showSmooth} onChange={(e) => p.setShowSmooth(e.target.checked)} />
        Worker 平滑
      </label>
      <span className="sep" />
      <button
        className="tb-btn"
        onClick={() => download('strokes.json', serializeDoc(p.doc))}
      >
        ⬇ 导出 JSON
      </button>
      <span className="count">
        采样 {p.sampleCount.toLocaleString()} / 20,000
      </span>
    </div>
  );
}
