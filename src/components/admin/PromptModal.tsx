import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';

interface PromptModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    initialValue?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
    inputPlaceholder?: string;
}

const PromptModal: FunctionalComponent<PromptModalProps> = ({
    isOpen,
    title,
    message,
    initialValue = '',
    onConfirm,
    onCancel,
    confirmText = '确定',
    cancelText = '取消',
    inputPlaceholder = '请输入...',
}) => {
    const [inputValue, setInputValue] = useState(initialValue);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setInputValue(initialValue); // Reset input value when modal opens
        }
    }, [isOpen, initialValue]);

    useEffect(() => {
        const modal = dialogRef.current;
        if (modal) {
            if (isOpen) {
                if (!modal.open) {
                    modal.showModal();
                    // Optionally focus the input when modal opens
                    inputRef.current?.focus();
                    inputRef.current?.select();
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
                // Call onCancel to ensure parent state is updated or cleanup occurs.
                onCancel();
            };
            modal.addEventListener('close', handleDialogClose);
            return () => {
                modal.removeEventListener('close', handleDialogClose);
            };
        }
    }, [onCancel]);

    const handleSubmit = () => {
        onConfirm(inputValue);
        // The dialog will be closed by the form submission if button is type="submit" or form has method="dialog"
    };

    const handleCancel = () => {
        onCancel();
        // The dialog will be closed by the form submission
    };

    return (
        <dialog ref={dialogRef} class="modal">
            <div class="modal-box">
                <h3 class="font-bold text-lg text-text">{title || '请输入'}</h3>
                {message && (
                    <p class="py-4 whitespace-pre-wrap text-base-content">
                        {message}
                    </p>
                )}
                <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onInput={(e) =>
                        setInputValue((e.target as HTMLInputElement).value)
                    }
                    placeholder={inputPlaceholder}
                    class="input input-bordered w-full"
                />
                <div class="modal-action">
                    <form method="dialog" class="flex flex-wrap gap-2">
                        <button class="btn" onClick={handleCancel}>
                            {cancelText}
                        </button>
                        <button class="btn btn-primary" onClick={handleSubmit}>
                            {confirmText}
                        </button>
                    </form>
                </div>
            </div>
            <form method="dialog" class="modal-backdrop">
                <button>close</button>
            </form>
        </dialog>
    );
};

export default PromptModal;
