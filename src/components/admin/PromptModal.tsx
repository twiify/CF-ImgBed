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
        <dialog ref={dialogRef} className="modal">
            <div className="card-enhanced p-0 max-w-lg mx-auto my-auto ">
                <div className="p-6">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                            <span className="material-symbols-outlined text-primary">edit</span>
                        </div>
                        <h3 className="text-lg font-bold text-text">{title || '请输入'}</h3>
                    </div>

                    {/* Message */}
                    {message && (
                        <p className="text-text-secondary whitespace-pre-wrap leading-relaxed mb-4">
                            {message}
                        </p>
                    )}

                    {/* Input Field */}
                    <div className="mb-6">
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onInput={(e) =>
                                setInputValue((e.target as HTMLInputElement).value)
                            }
                            placeholder={inputPlaceholder}
                            className="input-enhanced w-full"
                        />
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="px-6 py-4 bg-surface/50 border-t border-border-light flex flex-wrap justify-end gap-3">
                    <form method="dialog" className="flex flex-wrap gap-3">
                        <button
                            className="btn-enhanced btn-ghost-enhanced px-4 py-2 rounded-lg"
                            onClick={handleCancel}
                        >
                            {cancelText}
                        </button>
                        <button
                            className="btn-enhanced btn-primary-enhanced px-4 py-2 rounded-lg"
                            onClick={handleSubmit}
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

export default PromptModal;
