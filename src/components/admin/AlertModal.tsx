import type { FunctionalComponent } from 'preact';
import { useRef, useEffect } from 'preact/hooks';

export interface AlertModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onClose: () => void;
    inputValue?: string;
    inputReadOnly?: boolean;
    primaryButtonText?: string;
    onPrimaryAction?: () => void;
    secondaryButtonText?: string;
    onSecondaryAction?: () => void;
}

const AlertModal: FunctionalComponent<AlertModalProps> = ({
    isOpen,
    title,
    message,
    onClose,
    inputValue,
    inputReadOnly = true,
    primaryButtonText,
    onPrimaryAction,
    secondaryButtonText,
    onSecondaryAction,
}) => {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const modal = dialogRef.current;
        if (modal) {
            if (isOpen) {
                if (!modal.open) {
                    modal.showModal();
                }
            } else {
                if (modal.open) {
                    modal.close();
                }
            }
        }
    }, [isOpen]);

    useEffect(() => {
        const modal = dialogRef.current;
        if (modal) {
            const handleDialogClose = () => {
                // This event fires after the dialog has closed.
                // Call onClose to ensure parent state (managing isOpen) is updated.
                onClose();
            };
            modal.addEventListener('close', handleDialogClose);
            return () => {
                modal.removeEventListener('close', handleDialogClose);
            };
        }
    }, [onClose]);

    return (
        <dialog ref={dialogRef} className="modal">
            <div className="card-enhanced p-0 max-w-lg mx-auto my-auto ">
                <div className="p-6">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                            <span className="material-symbols-outlined text-primary">info</span>
                        </div>
                        <h3 className="text-lg font-bold text-text">{title || '提示'}</h3>
                    </div>

                    {/* Message */}
                    <p className="text-text-secondary whitespace-pre-wrap mb-4 leading-relaxed">{message}</p>

                    {/* Input Field (if provided) */}
                    {typeof inputValue === 'string' && (
                        <div className="mb-6">
                            <input
                                type="text"
                                value={inputValue}
                                readOnly={inputReadOnly}
                                className="input-enhanced w-full font-mono text-sm"
                                onFocus={(e: FocusEvent) => {
                                    const target = e.target as HTMLInputElement | null;
                                    if (target) {
                                        target.select();
                                    }
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="px-6 py-4 bg-surface/50 border-t border-border-light flex flex-wrap justify-end gap-3">
                    <form method="dialog" className="flex flex-wrap gap-3">
                        {secondaryButtonText && onSecondaryAction && (
                            <button
                                className="btn-enhanced btn-ghost-enhanced px-4 py-2 rounded-lg"
                                onClick={onSecondaryAction}
                            >
                                {secondaryButtonText}
                            </button>
                        )}
                        <button
                            className="btn-enhanced btn-primary-enhanced px-4 py-2 rounded-lg"
                            onClick={onPrimaryAction}
                        >
                            {primaryButtonText || '确定'}
                        </button>
                    </form>
                </div>
            </div>

            {/* Backdrop */}
            <form method="dialog" className="modal-backdrop bg-black/20 backdrop-blur-sm">
                <button>close</button>
            </form>
        </dialog>
    );
};

export default AlertModal;
