import { useEffect, useRef, useState, type ReactNode } from "react";

interface InputDialogProps {
  title: string;
  message?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  hint?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function InputDialog({
  title,
  message,
  placeholder,
  defaultValue = "",
  confirmText = "确定",
  hint,
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

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

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onConfirm(v);
  };

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
        {message && (
          <div className="break-all text-sm leading-relaxed text-ink-200">{message}</div>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          className="mt-2.5 w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-sm text-ink-200 placeholder:text-ink-400/70 focus:border-gold-500/70 focus:outline-none"
        />
        {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-ink-600 bg-ink-800 px-3 py-1.5 text-sm text-ink-200 transition-colors hover:border-gold-500/60 hover:bg-ink-700 hover:text-gold-300"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="rounded-md border border-gold-500/60 bg-ink-800 px-3 py-1.5 text-sm text-gold-300 transition-colors hover:border-gold-400 hover:bg-gold-400/10 hover:text-gold-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
