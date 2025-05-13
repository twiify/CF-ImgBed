import type { FunctionalComponent } from "preact";

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
  if (!isOpen) {
    return null;
  }

  const handlePrimaryAction = () => {
    if (onPrimaryAction) {
      onPrimaryAction();
    } else {
      onClose(); // Default to onClose if no primary action is defined
    }
  };

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-background p-6 rounded-lg shadow-xl w-full max-w-md">
        <h3 class="text-xl font-semibold mb-4 text-text">{title || "提示"}</h3>
        <p class="text-gray-700 mb-2 whitespace-pre-wrap">{message}</p>
        {typeof inputValue === 'string' && (
          <div class="my-4">
            <input
              type="text"
              value={inputValue}
              readOnly={inputReadOnly}
              class="w-full p-2 border border-border rounded-md bg-gray-100 dark:bg-gray-700 font-mono text-sm"
              onFocus={(e: FocusEvent) => {
                const target = e.target as HTMLInputElement | null;
                if (target) {
                  target.select();
                }
              }}
            />
          </div>
        )}
        <div class="flex justify-end space-x-3 mt-6">
          {secondaryButtonText && onSecondaryAction && (
            <button
              onClick={onSecondaryAction}
              class="border border-border py-2 px-4 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-text"
            >
              {secondaryButtonText}
            </button>
          )}
          <button
            onClick={handlePrimaryAction}
            class="bg-text text-background py-2 px-4 hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-text rounded"
          >
            {primaryButtonText || "确定"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlertModal;
