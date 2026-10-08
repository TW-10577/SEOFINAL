import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n.ts';
import { Icon } from './Icon.tsx';

type Kind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
}

const ToastContext = createContext<(kind: Kind, title: string, body?: string) => void>(() => {});

/** Short-lived notifications (upload succeeded / failed, delete…), announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), []);
  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = next.current++;
    setToasts((all) => [...all.slice(-3), { id, kind, title, body }]);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => <ToastItem key={x.id} toast={x} onClose={() => dismiss(x.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, toast.kind === 'error' ? 8000 : 4500);
    return () => clearTimeout(timer);
  }, [toast, onClose]);
  const icon = toast.kind === 'success' ? 'checkCircle' : toast.kind === 'error' ? 'xCircle' : 'info';
  return (
    <div className={`toast toast-${toast.kind}`}>
      <Icon name={icon} size={18} className="toast-icon" />
      <div className="toast-text">
        <div className="toast-title">{toast.title}</div>
        {toast.body && <div className="toast-body">{toast.body}</div>}
      </div>
      <button className="btn icon ghost" onClick={onClose} aria-label={t('Close')}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export const useToast = () => useContext(ToastContext);
