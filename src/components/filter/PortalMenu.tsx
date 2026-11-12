import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { menuPanel } from "../ui/styles";

/**
 * Action menu rendered above everything (scrollable lists clip absolute menus),
 * aligned to the right edge of its button, flipped up when there is no room.
 */
export function PortalMenu({ anchor, onClose, children, width = 240 }: { anchor: HTMLElement; onClose: () => void; children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 240;
    const up = window.innerHeight - r.bottom < h + 8 && r.top > h;
    setPos({ left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
  }, [anchor, width]);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("scroll", onScroll, true);
    ref.current?.querySelector<HTMLElement>("[role^=menuitem]:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", width, zIndex: 9999, ...pos }}
      className={`${menuPanel} mt-0`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault(); // close this menu, not the whole panel
          onClose();
          anchor.focus();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? [])];
          const i = items.indexOf(document.activeElement as HTMLElement);
          items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
