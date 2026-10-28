import React from "react";
import { AlertTriangle, Trash2, Info } from "lucide-react";
import { Modal } from "./ui/Modal";
import { dangerBtn, primaryBtn, secondaryBtn } from "./ui/styles";

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  details?: string;
  confirmText?: string;
  cancelText?: string;
  hideCancel?: boolean;
  variant?: "danger" | "warning" | "primary" | "info";
  icon?: "trash" | "alert" | "info";
  onConfirm?: () => void;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  details,
  confirmText,
  cancelText = "Cancelar",
  hideCancel = false,
  variant = "danger",
  icon,
  onConfirm,
  onClose,
}) => {
  const defaultConfirmText = hideCancel ? "Entendido" : variant === "danger" ? "Eliminar" : "Confirmar";

  const iconType = icon || (variant === "danger" ? "trash" : variant === "warning" ? "alert" : "info");
  // Semantic color lives on the icon only.
  const headerIcon =
    iconType === "trash" ? (
      <Trash2 className="w-4 h-4 text-danger" />
    ) : iconType === "alert" ? (
      <AlertTriangle className="w-4 h-4 text-warning" />
    ) : (
      <Info className="w-4 h-4 text-info" />
    );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={headerIcon}
      size="sm"
      zIndex="z-[100]"
      bodyClassName="p-5 space-y-3 text-xs text-fg"
      footer={
        <>
          {!hideCancel && (
            <button type="button" onClick={onClose} className={secondaryBtn}>
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onConfirm?.();
              onClose();
            }}
            className={variant === "danger" ? dangerBtn : primaryBtn}
            autoFocus
          >
            {confirmText || defaultConfirmText}
          </button>
        </>
      }
    >
      <p className="leading-relaxed">{message}</p>
      {details && (
        <div className="p-3 rounded-md font-mono text-[11px] break-all whitespace-pre-wrap max-h-32 overflow-y-auto border border-line bg-canvas text-fg-muted">
          {details}
        </div>
      )}
    </Modal>
  );
};
