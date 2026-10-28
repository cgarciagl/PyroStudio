import React, { useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { iconBtn, modalBackdrop, modalFooter, modalHeader, modalPanel, modalSizes, modalTitle } from "./styles";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Muted line under the title (context such as `db.table`). */
  subtitle?: React.ReactNode;
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
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, closeOnEscape]);

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
        className={`${modalPanel} ${modalSizes[size]} max-h-[90vh] ${className}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={modalHeader}>
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="text-fg-muted shrink-0">{icon}</span>}
            <div className="min-w-0">
              <h2 className={modalTitle}>{title}</h2>
              {subtitle && <p className="text-[11px] text-fg-muted truncate">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className={iconBtn} title="Cerrar (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className={`flex-1 min-h-0 ${bodyClassName}`}>{children}</div>
        {footer && <div className={modalFooter}>{footer}</div>}
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
