import { cloneElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { errorMessage } from "../api";

export function PageHeader({ title, back, action }: { title: string; back?: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-header">
      {back}
      <h1>{title}</h1>
      {action}
    </header>
  );
}

export function QueryState({ isLoading, error }: { isLoading: boolean; error: unknown }) {
  if (isLoading) return <p className="muted">Caricamento…</p>;
  if (error) return <p className="error" role="alert">{errorMessage(error)}</p>;
  return null;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {typeof error === "string" ? error : errorMessage(error)}
    </p>
  );
}

/** Label + control + hint. The label is linked by id (not wrapping), so the control's accessible name is exactly `label`. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactElement<{ id?: string; "aria-describedby"?: string }> }) {
  const generatedId = useId();
  const id = children.props.id ?? generatedId;
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, { id, "aria-describedby": hint ? hintId : undefined })}
      {hint && (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * Modal built on the native <dialog> (focus trap, Esc to close, backdrop for free).
 * Portaled to <body> so a form inside it is never nested in the page's form.
 */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return createPortal(
    // React events bubble through portals: stop submits here so they never reach a form around <Dialog>.
    // A nested dialog's "close" also bubbles here through the React tree: react only to this dialog's own close.
    <dialog
      ref={ref}
      className="dialog"
      onClose={(e) => e.target === e.currentTarget && onClose()}
      aria-label={title}
      onSubmit={(e) => e.stopPropagation()}
    >
      {open && (
        <>
          <header className="dialog-header">
            <h2>{title}</h2>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Chiudi">
              ✕
            </button>
          </header>
          {children}
        </>
      )}
    </dialog>,
    document.body,
  );
}

/** Two-step delete: first tap arms, second tap confirms (no blocking confirm() dialogs). */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled }: { label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className="button danger"
      disabled={disabled}
      onClick={() => {
        setArmed(!armed);
        if (armed) onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
