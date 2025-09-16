import type { FunctionalComponent } from 'preact';
import { useRef, useEffect } from 'preact/hooks';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
}

const ConfirmModal: FunctionalComponent<ConfirmModalProps> = ({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel,
    confirmText = '确定',
    cancelText = '取消',
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
                    modal.close(); // This will trigger the 'close' event
                }
            }
        }
    }, [isOpen]);

    useEffect(() => {
        const modal = dialogRef.current;
        if (modal) {
            const handleDialogClose = () => {
                // When the dialog is closed by any means (ESC, backdrop, form submission),
                // we call onCancel, as this is the typical behavior for a confirm dialog
                // if no explicit action (confirm) was taken.
                // If onConfirm was called, isOpen would likely be set to false by the parent,
                // leading to modal.close() and this handler.
                // If onCancel was called by button, isOpen would also be set to false.
                // This ensures that if ESC or backdrop click closes it, onCancel is called.
                onCancel();
            };
            modal.addEventListener('close', handleDialogClose);
            return () => {
                modal.removeEventListener('close', handleDialogClose);
            };
        }
    }, [onCancel]); // Rerun if onCancel changes, though typically stable

    return (
        <dialog ref={dialogRef} className="modal">
            <div className="card-enhanced p-0 max-w-lg mx-auto my-auto ">
                <div className="p-6">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-warning/10 rounded-xl flex items-center justify-center">
                            <span className="material-symbols-outlined text-warning">help</span>
                        </div>
                        <h3 className="text-lg font-bold text-text">{title || '请确认'}</h3>
                    </div>

                    {/* Message */}
                    <p className="text-text-secondary whitespace-pre-wrap leading-relaxed">
                        {message}
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="px-6 py-4 bg-surface/50 border-t border-border-light flex flex-wrap justify-end gap-3">
                    <form method="dialog" className="flex flex-wrap gap-3">
                        <button
                            className="btn-enhanced btn-ghost-enhanced px-4 py-2 rounded-lg"
                            onClick={() => {
                                onCancel();
                            }}
                        >
                            {cancelText}
                        </button>
                        <button
                            className="btn-enhanced btn-error-enhanced px-4 py-2 rounded-lg"
                            onClick={() => {
                                onConfirm();
                            }}
                        >
                            {confirmText}
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

export default ConfirmModal;
