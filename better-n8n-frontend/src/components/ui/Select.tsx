
import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Option {
  label: string;
  value: string;
  icon?: React.ReactNode;
  is_free?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  icon?: React.ReactNode;
  showSearch?: boolean;
}

export default function Select({ 
  value, 
  onChange, 
  options, 
  placeholder = 'Select...', 
  className,
  icon,
  showSearch = false
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter(opt => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    
    // Default name/label match
    const matchesName = opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q);
    if (matchesName) return true;

    // Advanced filters
    if (q === 'free' && opt.is_free === true) return true;
    if (q === 'paid' && opt.is_free === false) return true;

    return false;
  });

  const selectedOption = options.find(opt => opt.value === value);

  // Reset highlighted index when filtered options change. Adjusted during
  // render: an effect would paint the stale highlight for one frame first.
  const [seenFilter, setSeenFilter] = useState([filteredOptions.length, searchQuery] as const);
  if (seenFilter[0] !== filteredOptions.length || seenFilter[1] !== searchQuery) {
    setSeenFilter([filteredOptions.length, searchQuery]);
    setHighlightedIndex(0);
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (!isOpen || highlightedIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-select-option]');
    const item = items[highlightedIndex] as HTMLElement;
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Opening highlights the current value; closing clears the search. Both are
  // state derived from `isOpen` changing, so they happen during render.
  const [seenOpen, setSeenOpen] = useState(isOpen);
  if (isOpen !== seenOpen) {
    setSeenOpen(isOpen);
    if (isOpen) {
      const idx = filteredOptions.findIndex(opt => opt.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    } else {
      setSearchQuery('');
    }
  }

  // Focusing the search box is a real side effect on the DOM, so it stays one.
  useEffect(() => {
    if (!isOpen || !showSearch) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [isOpen, showSearch]);

  const handleSelect = useCallback((optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    // Return focus to trigger button
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, [onChange]);

  const openDropdown = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  // Keyboard handling for the trigger button
  const handleTriggerKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        if (!isOpen) openDropdown();
        break;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        openDropdown();
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        openDropdown();
        break;
      case 'Escape':
        if (isOpen) {
          e.preventDefault();
          e.stopPropagation();
          closeDropdown();
        }
        break;
    }
  }, [isOpen, openDropdown, closeDropdown]);

  // Keyboard handling inside the dropdown (search input or list)
  const handleDropdownKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(prev => 
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
          handleSelect(filteredOptions[highlightedIndex].value);
        }
        break;
      case 'Tab':
        // Allow Tab to close dropdown and move focus naturally
        setIsOpen(false);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
        break;
      case 'Home':
        e.preventDefault();
        setHighlightedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setHighlightedIndex(filteredOptions.length - 1);
        break;
    }
  }, [filteredOptions, highlightedIndex, handleSelect, closeDropdown]);

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-background border border-input rounded-lg hover:bg-secondary transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isOpen && "border-primary/50 ring-2 ring-primary/20"
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          {selectedOption?.icon && <span className="text-foreground">{selectedOption.icon}</span>}
          <span className={cn(
            "text-sm font-medium truncate",
            !selectedOption && "text-muted-foreground"
          )}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown className={cn(
          "w-4 h-4 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-180"
        )} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute z-50 w-full mt-2 bg-card border border-border rounded-lg shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top p-1"
          onKeyDown={handleDropdownKeyDown}
          role="listbox"
        >
          {showSearch && (
            <div className="p-2 border-b border-border/10">
              <input
                ref={searchInputRef}
                type="text"
                autoFocus
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-muted/50 border-none px-3 py-1.5 rounded-lg text-xs focus:ring-1 focus:ring-primary/20 outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div ref={listRef} className="max-h-[240px] overflow-auto py-1 custom-scrollbar">
            {filteredOptions.map((option, index) => {
              const isSelected = option.value === value;
              const isHighlighted = index === highlightedIndex;
              return (
                <button
                  key={option.value}
                  data-select-option
                  onClick={() => handleSelect(option.value)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors",
                    isSelected && !isHighlighted
                      ? "bg-primary/10 text-primary font-medium" 
                      : isHighlighted
                        ? "bg-primary/15 text-primary font-medium"
                        : "text-foreground/80 hover:bg-muted hover:text-foreground"
                  )}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className="flex items-center gap-2 truncate">
                    {option.icon}
                    <span>{option.label}</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 opacity-100" />}
                </button>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {searchQuery ? 'No Results' : 'No options'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
