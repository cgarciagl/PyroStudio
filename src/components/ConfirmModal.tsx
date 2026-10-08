import React, { useEffect } from "react";
import { AlertTriangle, Trash2, Info, X } from "lucide-react";

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
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const defaultConfirmText =
    hideCancel
      ? "Entendido"
      : variant === "danger"
      ? "Eliminar"
      : "Confirmar";
  const displayConfirmText = confirmText || defaultConfirmText;

  const getIcon = () => {
    const iconType =
      icon ||
      (variant === "danger"
        ? "trash"
        : variant === "warning"
        ? "alert"
        : "info");
    switch (iconType) {
      case "trash":
        return <Trash2 className="w-5 h-5 text-rose-400 shrink-0" />;
      case "alert":
        return <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />;
      case "info":
      default:
        return <Info className="w-5 h-5 text-sky-400 shrink-0" />;
    }
  };

  const getHeaderStyles = () => {
    switch (variant) {
      case "danger":
        return "bg-rose-950/30 border-rose-900/40 text-rose-200";
      case "warning":
        return "bg-amber-950/30 border-amber-900/40 text-amber-200";
      case "info":
        return "bg-sky-950/30 border-sky-900/40 text-sky-200";
      case "primary":
      default:
        return "bg-[#141824] border-[#1e2434] text-white";
    }
  };

  const getConfirmButtonStyles = () => {
    switch (variant) {
      case "danger":
        return "bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/30";
      case "warning":
        return "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/30";
      case "info":
        return "bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-900/30";
      case "primary":
      default:
        return "bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-900/30";
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-[#10131b] border border-[#2b3347] w-full max-w-md rounded-xl shadow-2xl shadow-black/80 flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`px-5 py-4 flex items-center justify-between border-b ${getHeaderStyles()}`}>
          <div className="flex items-center space-x-3">
            {getIcon()}
            <h2 className="text-sm font-bold tracking-wide">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800/60 transition-colors"
            title="Cerrar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3.5 text-xs text-neutral-300">
          <p className="text-xs leading-relaxed text-neutral-300">{message}</p>
          {details && (
            <div className="p-3 bg-[#0a0c10] border border-[#1e2434] rounded-lg font-mono text-[11px] text-neutral-400 break-all whitespace-pre-wrap max-h-32 overflow-y-auto">
              {details}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-[#0d1017] border-t border-[#1e2434] flex items-center justify-end space-x-3">
          {!hideCancel && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium text-xs transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (onConfirm) {
                onConfirm();
              }
              onClose();
            }}
            className={`px-4 py-2 rounded-lg font-medium text-xs transition-all flex items-center space-x-1.5 ${getConfirmButtonStyles()}`}
            autoFocus
          >
            <span>{displayConfirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

