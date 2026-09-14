import { useEffect, useRef, useState, type RefObject } from "react";

const MIN = 220;
const MAX = 480;
const DEFAULT = 280;
const STORAGE_KEY = "memoapp_sidebar_width";
const clamp = (value: number, max = MAX) => Math.max(MIN, Math.min(max, value));

export function SidebarResizer({
  container,
  disabled,
}: {
  container: RefObject<HTMLDivElement | null>;
  disabled: boolean;
}) {
  const [preferred, setPreferred] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isFinite(saved) && saved > 0 ? clamp(saved) : DEFAULT;
    } catch {
      return DEFAULT;
    }
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(
    null,
  );
  const latest = useRef(preferred);
  const max = Math.max(MIN, Math.min(MAX, viewport - 400));
  const width = viewport <= 700 ? preferred : clamp(preferred, max);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    container.current?.style.setProperty("--sidebar-width", `${width}px`);
    container.current?.classList.toggle("is-resizing-sidebar", dragging);
  }, [container, width, dragging]);
  function change(value: number, save = false) {
    const next = clamp(value, max);
    latest.current = next;
    setPreferred(next);
    if (save) persist(next);
  }
  function persist(value: number) {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Resizing remains available when browser storage is unavailable.
    }
  }
  function finish() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    persist(latest.current);
  }
  return (
    <div
      role="separator"
      aria-label="サイドバーの幅"
      aria-orientation="vertical"
      aria-valuemin={MIN}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)}ピクセル`}
      title="ドラッグで幅を調整・ダブルクリックで標準幅に戻す"
      tabIndex={disabled ? -1 : 0}
      inert={disabled}
      className={`sidebar-resizer ${dragging ? "is-dragging" : ""}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width, pointer: event.pointerId };
        latest.current = width;
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointer === event.pointerId)
          change(start.width + event.clientX - start.x);
      }}
      onPointerUp={(event) => {
        finish();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => change(DEFAULT, true)}
      onKeyDown={(event) => {
        const steps: Record<string, number> = {
          ArrowLeft: width - 16,
          ArrowRight: width + 16,
          Home: MIN,
          End: max,
        };
        if (!(event.key in steps)) return;
        event.preventDefault();
        change(steps[event.key], true);
      }}
    />
  );
}
