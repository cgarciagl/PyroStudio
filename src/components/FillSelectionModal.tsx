import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Edit3, Ban, Check } from "lucide-react";
import { primaryBtn } from "./ui/styles";
import { Modal } from "./ui/Modal";

interface FillSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  cellCount: number;
  onApply: (value: any) => void;
}

export const FillSelectionModal: React.FC<FillSelectionModalProps> = ({
  isOpen,
  onClose,
  cellCount,
  onApply,
}) => {
  const { t } = useTranslation("dataGrid");
  const [value, setValue] = useState("");
  const [isNull, setIsNull] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue("");
      setIsNull(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

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

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isNull) {
      onApply(null);
    } else {
      onApply(value);
    }
    onClose();
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={<>{t("fillModal.title")}</>}
      subtitle={<>{t("fillModal.subtitle", { count: cellCount })}</>}
      icon={<Edit3 className="w-4 h-4" />}
      size="sm"
      bodyClassName="flex flex-col overflow-hidden"
      zIndex="z-[110]"
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={`text-xs font-medium text-fg`}>
                {t("fillModal.label")}
              </label>
              <button
                type="button"
                onClick={() => setIsNull((prev) => !prev)}
                className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-mono border transition-all ${
                  isNull
                  ? "border-line text-warning font-bold"
                  : "bg-raised border-line text-fg-muted hover:text-fg"
                }`}
              >
                <Ban className="w-3 h-3 text-warning" />
                <span>{isNull ? t("fillModal.nullActive") : t("fillModal.setNull")}</span>
              </button>
            </div>

            {isNull ? (
              <div
                className={`w-full px-3 py-2.5 rounded-lg border text-xs font-mono font-bold flex items-center justify-between border-line text-warning`}
              >
                <span>{t("fillModal.nullBoxTitle")}</span>
                <span className="text-[11px] opacity-70">{t("fillModal.nullBoxHint")}</span>
              </div>
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t("fillModal.placeholder")}
                className={`w-full px-3 py-2 rounded-lg border text-xs font-mono transition-colors focus:outline-hidden bg-canvas border-line text-fg focus:border-accent`}
              />
            )}
            <p className={`text-[11px] text-fg-subtle`}>
              {isNull
                ? t("fillModal.hintNull")
                : t("fillModal.hintValue")}
            </p>
          </div>

          {/* Footer Actions */}
          <div
            className={`pt-3 border-t flex items-center justify-end space-x-2.5 border-line`}
          >
            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-raised hover:bg-hover border-line-strong text-fg`}
            >
              {t("fillModal.cancel")}
            </button>
            <button
              type="submit"
              className={primaryBtn}
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t("fillModal.apply", { count: cellCount })}</span>
            </button>
          </div>
        </form>
    </Modal>
  );
};

