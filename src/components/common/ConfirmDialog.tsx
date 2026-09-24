import { useEffect, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  hint?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  hint,
  confirmText = "确定",
  cancelText = "取消",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70"
      onClick={onCancel}
    >
      <div
        className="w-[340px] rounded-xl border border-gold-500/40 bg-ink-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 text-sm font-bold text-gold-300">{title}</div>
        <div className="break-all text-sm leading-relaxed text-ink-200">{message}</div>
        {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-gold-500/60 hover:bg-ink-700 hover:text-gold-300"
          >
            {cancelText}
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            className="rounded-md border border-verm-500/50 bg-ink-800 px-3 py-1.5 text-sm text-verm-400 transition-colors hover:border-verm-500 hover:bg-verm-500/10 hover:text-verm-300"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}