import React, { useCallback, useEffect, useRef, useState } from "react";

/** Ancho mínimo de ventana a partir del cual los paneles laterales se acoplan en vez de superponerse. */
export const WIDE_LAYOUT_QUERY = "(min-width: 1400px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export const useIsWideLayout = () => useMediaQuery(WIDE_LAYOUT_QUERY);

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;

const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

/** Ancho persistido de un panel acoplado, identificado por `storageKey`. */
export function useDockWidth(storageKey: string, defaultWidth: number) {
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (saved) return clampWidth(saved);
    } catch {
      // Almacenamiento no disponible: usar el valor por defecto.
    }
    return defaultWidth;
  });

  const update = useCallback(
    (w: number) => {
      const next = clampWidth(w);
      setWidth(next);
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // Ignorar: el ancho solo es una preferencia de comodidad.
      }
    },
    [storageKey],
  );

  return [width, update] as const;
}

interface RightDockProps {
  width: number;
  onResize: (width: number) => void;
  children: React.ReactNode;
}

/**
 * Panel lateral derecho acoplado dentro de un contenedor `relative`.
 * El contenedor debe reservar `padding-right: width` para que el contenido no quede tapado.
 */
export const RightDock: React.FC<RightDockProps> = ({ width, onResize, children }) => {
  const startX = useRef(0);
  const startWidth = useRef(width);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";

    const onMove = (ev: MouseEvent) => onResize(startWidth.current + (startX.current - ev.clientX));
    const onUp = () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex" style={{ width }}>
      <div
        onMouseDown={onMouseDown}
        title="Arrastrar para redimensionar"
        className="w-1.5 h-full shrink-0 bg-surface hover:bg-accent/40 active:bg-accent/60 border-l border-line cursor-col-resize transition-colors select-none"
      />
      <div className="flex-1 min-w-0 h-full">{children}</div>
    </div>
  );
};
