import { useEffect } from "react";

/** While `active`, any window click or scroll calls `onDismiss` (closes floating menus). */
export function useDismissOnOutsideClick(active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active) return;
    window.addEventListener("click", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    return () => {
      window.removeEventListener("click", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
    };
  }, [active, onDismiss]);
}
