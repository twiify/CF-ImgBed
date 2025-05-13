import type { FunctionalComponent } from "preact";
import { useState, useEffect } from "preact/hooks";

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
  initialValue = "",
  onConfirm,
  onCancel,
  confirmText = "确定",
  cancelText = "取消",
  inputPlaceholder = "请输入...",
}) => {
  const [inputValue, setInputValue] = useState(initialValue);

  useEffect(() => {
    if (isOpen) {
      setInputValue(initialValue); // Reset input value when modal opens
    }
  }, [isOpen, initialValue]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = () => {
    onConfirm(inputValue);
  };

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-background p-6 rounded-lg shadow-xl w-full max-w-md">
        <h3 class="text-xl font-semibold mb-4 text-text">{title || "请输入"}</h3>
        {message && <p class="text-gray-700 mb-4 whitespace-pre-wrap">{message}</p>}
        <input
          type="text"
          value={inputValue}
          onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
          placeholder={inputPlaceholder}
          class="w-full p-2 border border-border rounded mb-6 focus:ring-text focus:border-text"
        />
        <div class="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            class="bg-gray-200 text-gray-700 py-2 px-4 hover:bg-gray-300 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 rounded"
          >
            {cancelText}
          </button>
          <button
            onClick={handleSubmit}
            class="bg-text text-background py-2 px-4 hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-text rounded"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptModal;
