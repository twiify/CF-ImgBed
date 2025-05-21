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
        <dialog ref={dialogRef} class="modal">
            <div class="modal-box">
                <h3 class="font-bold text-lg text-text">{title || '请确认'}</h3>
                <p class="py-4 whitespace-pre-wrap text-base-content">
                    {message}
                </p>
                <div class="modal-action">
                    <form method="dialog" class="flex flex-wrap gap-2">
                        <button
                            class="btn"
                            onClick={() => {
                                // Explicitly call onCancel before the dialog closes.
                                // The form will then close the dialog, triggering the 'close' event.
                                // The 'close' event handler also calls onCancel, which is fine;
                                // parent should handle multiple calls idempotently if necessary.
                                onCancel();
                            }}
                        >
                            {cancelText}
                        </button>
                        <button
                            class="btn btn-error"
                            onClick={() => {
                                // Explicitly call onConfirm before the dialog closes.
                                onConfirm();
                            }}
                        >
                            {confirmText}
                        </button>
                    </form>
                </div>
            </div>
            <form method="dialog" class="modal-backdrop">
                <button>close</button>{' '}
                {/* This button is for accessibility and allows backdrop click to close */}
            </form>
        </dialog>
    );
};

export default ConfirmModal;
