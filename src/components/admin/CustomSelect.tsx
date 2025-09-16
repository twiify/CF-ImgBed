import type { FunctionalComponent } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';

interface Option {
    value: string;
    label: string;
}

interface CustomSelectProps {
    options: Option[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
}

const CustomSelect: FunctionalComponent<CustomSelectProps> = ({
    options,
    value,
    onChange,
    placeholder = "请选择...",
    className = "",
    disabled = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const selectRef = useRef<HTMLDivElement>(null);
    const optionsRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(option => option.value === value);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setFocusedIndex(-1);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    useEffect(() => {
        if (isOpen && focusedIndex >= 0 && optionsRef.current) {
            const focusedElement = optionsRef.current.children[focusedIndex] as HTMLElement;
            if (focusedElement) {
                focusedElement.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [focusedIndex, isOpen]);

    const handleToggle = () => {
        if (!disabled) {
            setIsOpen(!isOpen);
            if (!isOpen) {
                setFocusedIndex(selectedOption ? options.indexOf(selectedOption) : 0);
            }
        }
    };

    const handleOptionClick = (option: Option) => {
        onChange(option.value);
        setIsOpen(false);
        setFocusedIndex(-1);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (disabled) return;

        switch (event.key) {
            case 'Enter':
            case ' ':
                event.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                    setFocusedIndex(selectedOption ? options.indexOf(selectedOption) : 0);
                } else if (focusedIndex >= 0) {
                    handleOptionClick(options[focusedIndex]);
                }
                break;
            case 'Escape':
                setIsOpen(false);
                setFocusedIndex(-1);
                break;
            case 'ArrowDown':
                event.preventDefault();
                if (!isOpen) {
                    setIsOpen(true);
                    setFocusedIndex(selectedOption ? options.indexOf(selectedOption) : 0);
                } else {
                    setFocusedIndex(prev => Math.min(prev + 1, options.length - 1));
                }
                break;
            case 'ArrowUp':
                event.preventDefault();
                if (isOpen) {
                    setFocusedIndex(prev => Math.max(prev - 1, 0));
                }
                break;
            case 'Tab':
                setIsOpen(false);
                setFocusedIndex(-1);
                break;
        }
    };

    return (
        <div
            ref={selectRef}
            className={`relative ${className}`}
        >
            <div
                role="combobox"
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                tabIndex={disabled ? -1 : 0}
                className={`
                    input-enhanced w-full cursor-pointer transition-all duration-200 flex items-center justify-between
                    ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/50 hover:bg-background'}
                    ${isOpen ? 'border-primary bg-background shadow-lg' : ''}
                `}
                onClick={handleToggle}
                onKeyDown={handleKeyDown}
            >
                <span className={`flex-1 ${!selectedOption ? 'text-text-secondary' : 'text-text'}`}>
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <div className={`ml-2 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
                    <svg
                        width="12"
                        height="8"
                        viewBox="0 0 12 8"
                        fill="none"
                        className="text-text-secondary"
                    >
                        <path
                            d="M1 1.5L6 6.5L11 1.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>
            </div>

            {isOpen && (
                <div
                    ref={optionsRef}
                    role="listbox"
                    className="absolute top-full left-0 right-0 mt-2 bg-surface border-2 border-border-light rounded-xl shadow-xl z-50 overflow-hidden animate-scale-in"
                    style={{ transformOrigin: 'top' }}
                >
                    {options.map((option, index) => (
                        <div
                            key={option.value}
                            role="option"
                            aria-selected={option.value === value}
                            className={`
                                px-4 py-3 cursor-pointer transition-all duration-150 flex items-center gap-3
                                ${option.value === value
                                    ? 'bg-primary text-white font-medium'
                                    : index === focusedIndex
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-text hover:bg-primary/5'
                                }
                                ${index === 0 ? 'rounded-t-xl' : ''}
                                ${index === options.length - 1 ? 'rounded-b-xl' : ''}
                            `}
                            onClick={() => handleOptionClick(option)}
                            onMouseEnter={() => setFocusedIndex(index)}
                        >
                            <div className={`w-2 h-2 rounded-full ${option.value === value ? 'bg-white' : 'bg-primary/30'}`} />
                            <span className="flex-1">{option.label}</span>
                            {option.value === value && (
                                <span className="material-symbols-outlined text-sm">check</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CustomSelect;