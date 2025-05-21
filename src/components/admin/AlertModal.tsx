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
        <dialog ref={dialogRef} class="modal">
            <div class="modal-box">
                <h3 class="font-bold text-lg text-text">{title || '提示'}</h3>
                <p class="py-4 whitespace-pre-wrap text-gray-700">{message}</p>
                {typeof inputValue === 'string' && (
                    <div class="my-4">
                        <input
                            type="text"
                            value={inputValue}
                            readOnly={inputReadOnly}
                            class="input input-bordered w-full font-mono text-sm"
                            onFocus={(e: FocusEvent) => {
                                const target =
                                    e.target as HTMLInputElement | null;
                                if (target) {
                                    target.select();
                                }
                            }}
                        />
                    </div>
                )}
                <div class="modal-action">
                    {/* Wrap buttons in a form with method="dialog" to enable default close behavior */}
                    <form method="dialog" class="flex flex-wrap gap-2">
                        {secondaryButtonText && onSecondaryAction && (
                            <button class="btn" onClick={onSecondaryAction}>
                                {secondaryButtonText}
                            </button>
                        )}
                        <button
                            class="btn btn-primary"
                            onClick={onPrimaryAction} // onPrimaryAction is called, then form closes dialog
                        >
                            {primaryButtonText || '确定'}
                        </button>
                    </form>
                </div>
            </div>
            {/* Clicking on the backdrop will close the modal */}
            <form method="dialog" class="modal-backdrop">
                <button>close</button>
            </form>
        </dialog>
    );
};

export default AlertModal;
