import { useEffect, useRef } from "react";

/**
 * Last pointer position on the window (captured on pointerdown/contextmenu),
 * used to place context menus exactly where the user clicked.
 */
export function useLastPointerPosition() {
  const lastMousePosRef = useRef<{ x: number; y: number }>({
    x: typeof window !== "undefined" ? Math.round(window.innerWidth / 2) : 400,
    y: typeof window !== "undefined" ? Math.round(window.innerHeight / 2) : 300,
  });

  useEffect(() => {
    const handlePointer = (e: MouseEvent | PointerEvent) => {
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("contextmenu", handlePointer, true);
    window.addEventListener("pointerdown", handlePointer, true);
    return () => {
      window.removeEventListener("contextmenu", handlePointer, true);
      window.removeEventListener("pointerdown", handlePointer, true);
    };
  }, []);

  return lastMousePosRef;
}
