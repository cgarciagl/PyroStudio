import React, { useEffect, useId, useRef } from "react";
import { X, Loader2 } from "lucide-react";
import { iconBtn, modalBackdrop, modalFooter, modalHeader, modalPanel, modalSizes, modalTitle } from "./styles";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Muted line under the title (context such as `db.table`). */
  subtitle?: React.ReactNode;
  /** Additional element that describes the dialog body. */
  describedBy?: string;
  /** Optional leading icon; kept muted, never tinted. */
  icon?: React.ReactNode;
  size?: keyof typeof modalSizes;
  footer?: React.ReactNode;
  /** Extra classes for the panel (e.g. a fixed height). */
  className?: string;
  bodyClassName?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  zIndex?: string;
  children: React.ReactNode;
}

/** Shared modal shell: backdrop, panel, header with close and optional footer. Escape closes. */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  describedBy,
  icon,
  size = "md",
  footer,
  className = "",
  bodyClassName = "p-5 overflow-y-auto",
  closeOnBackdrop = true,
  closeOnEscape = true,
  zIndex,
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const frame = window.requestAnimationFrame(() => {
      // Respeta el foco que ya colocó un hijo (p. ej. `autoFocus` de React,
      // que no escribe el atributo en el DOM y llega antes que este frame).
      if (panel?.contains(document.activeElement)) return;
      const focusable =
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])";
      // Prioriza cuerpo y pie: el botón de cerrar del encabezado es el último recurso.
      const target =
        panel?.querySelector<HTMLElement>(`[data-modal-body] :is(${focusable})`) ??
        panel?.querySelector<HTMLElement>(`[data-modal-footer] :is(${focusable})`) ??
        panel?.querySelector<HTMLElement>(focusable);
      (target ?? panel)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (previousFocusRef.current?.isConnected && !previousFocusRef.current.hasAttribute("disabled")) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={zIndex ? modalBackdrop.replace("z-50", zIndex) : modalBackdrop}
      onClick={closeOnBackdrop ? onClose : undefined}
      // Keys typed inside the modal must not reach grid/editor shortcuts underneath.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && closeOnEscape) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`${modalPanel} ${modalSizes[size]} max-h-[90vh] ${className}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && closeOnEscape) {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key !== "Tab") return;
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(
            "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
          )).filter((el) => el.offsetParent !== null);
          if (!items.length) {
            e.preventDefault();
            e.currentTarget.focus();
          } else if (!e.currentTarget.contains(document.activeElement)) {
            e.preventDefault();
            (e.shiftKey ? items[items.length - 1] : items[0]).focus();
          } else if (e.shiftKey && document.activeElement === items[0]) {
            e.preventDefault();
            items[items.length - 1].focus();
          } else if (!e.shiftKey && document.activeElement === items[items.length - 1]) {
            e.preventDefault();
            items[0].focus();
          }
        }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={[subtitle ? descriptionId : undefined, describedBy].filter(Boolean).join(" ") || undefined}
      >
        <div className={modalHeader}>
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="text-fg-muted shrink-0">{icon}</span>}
            <div className="min-w-0">
              <h2 id={titleId} className={modalTitle}>{title}</h2>
              {subtitle && <p id={descriptionId} className="text-[11px] text-fg-muted truncate">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className={iconBtn} title="Cerrar (Esc)" aria-label="Cerrar diálogo">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div data-modal-body className={`flex-1 min-h-0 ${bodyClassName}`}>{children}</div>
        {footer && <div data-modal-footer className={modalFooter}>{footer}</div>}
      </div>
    </div>
  );
};

export const Spinner: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <Loader2 className={`${className} animate-spin text-fg-muted`} />
);

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

/** Centered message for empty, loading or error views. */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-2">
    {icon && <div className="text-fg-subtle mb-1">{icon}</div>}
    <p className="text-sm font-medium text-fg">{title}</p>
    {description && <p className="text-xs text-fg-muted max-w-md">{description}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);
