import React, { useEffect } from "react";
import { AlertTriangle, Trash2, Info, X } from "lucide-react";
import { useIsLightTheme } from "../stores/preferenceStore";

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
  const isLight = useIsLightTheme();

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
        return <Trash2 className={`w-5 h-5 shrink-0 ${isLight ? "text-rose-600" : "text-rose-400"}`} />;
      case "alert":
        return <AlertTriangle className={`w-5 h-5 shrink-0 ${isLight ? "text-amber-600" : "text-amber-400"}`} />;
      case "info":
      default:
        return <Info className={`w-5 h-5 shrink-0 ${isLight ? "text-sky-600" : "text-sky-400"}`} />;
    }
  };

  const getHeaderStyles = () => {
    switch (variant) {
      case "danger":
        return isLight
          ? "bg-rose-50 border-rose-200 text-rose-900"
          : "bg-rose-950/30 border-rose-900/40 text-rose-200";
      case "warning":
        return isLight
          ? "bg-amber-50 border-amber-200 text-amber-900"
          : "bg-amber-950/30 border-amber-900/40 text-amber-200";
      case "info":
        return isLight
          ? "bg-sky-50 border-sky-200 text-sky-900"
          : "bg-sky-950/30 border-sky-900/40 text-sky-200";
      case "primary":
      default:
        return isLight
          ? "bg-slate-50 border-slate-200 text-slate-900"
          : "bg-[#141824] border-[#1e2434] text-white";
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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md rounded-xl border flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 ${
          isLight
            ? "bg-white border-slate-200 shadow-2xl"
            : "bg-[#10131b] border-[#2b3347] shadow-2xl shadow-black/80"
        }`}
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
            className={`p-1 rounded-md transition-colors ${
              isLight
                ? "text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
                : "text-neutral-400 hover:text-white hover:bg-neutral-800/60"
            }`}
            title="Cerrar (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className={`p-5 space-y-3.5 text-xs ${isLight ? "text-slate-700" : "text-neutral-300"}`}>
          <p className="text-xs leading-relaxed">{message}</p>
          {details && (
            <div
              className={`p-3 rounded-lg font-mono text-[11px] break-all whitespace-pre-wrap max-h-32 overflow-y-auto border ${
                isLight
                  ? "bg-slate-50 border-slate-200 text-slate-700"
                  : "bg-[#0a0c10] border-[#1e2434] text-neutral-400"
              }`}
            >
              {details}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={`px-5 py-3.5 border-t flex items-center justify-end space-x-3 ${
            isLight ? "bg-slate-50 border-slate-200" : "bg-[#0d1017] border-[#1e2434]"
          }`}
        >
          {!hideCancel && (
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 rounded-lg font-medium text-xs transition-colors border shadow-xs ${
                isLight
                  ? "bg-white hover:bg-slate-100 text-slate-700 border-slate-300"
                  : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border-neutral-700"
              }`}
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

