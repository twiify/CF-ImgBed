import type { FunctionalComponent } from "preact";

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
  confirmText = "确定",
  cancelText = "取消",
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-background p-6 rounded-lg shadow-xl w-full max-w-md">
        <h3 class="text-xl font-semibold mb-4 text-text">{title || "请确认"}</h3>
        <p class="text-gray-700 mb-6 whitespace-pre-wrap">{message}</p>
        <div class="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            class="bg-gray-200 text-gray-700 py-2 px-4 hover:bg-gray-300 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 rounded"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            class="bg-red-600 text-white py-2 px-4 hover:bg-red-700 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 rounded"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
