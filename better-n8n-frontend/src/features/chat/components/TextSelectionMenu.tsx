import { useEffect } from 'react';
import { Copy, Quote } from 'lucide-react';

interface Position {
  x: number;
  y: number;
}

interface TextSelectionMenuProps {
  position: Position | null;
  onCopy: () => void;
  onReference: () => void;
  onClose: () => void;
}

export function TextSelectionMenu({ position, onCopy, onReference, onClose }: TextSelectionMenuProps) {
  // `isVisible` used to be state, set from an effect to exactly `position !==
  // null` — a whole render pass to compute something already known during the
  // first one. Its only real job was the one-frame gap that let the opacity
  // transition run, so the entrance is a CSS enter animation now and the state
  // is gone. (`react-hooks/set-state-in-effect` is what flagged it.)

  useEffect(() => {
    // Listen for mousedown outside the menu or selection changes to close it
    const handleOutsideClick = () => {
      // Small timeout to allow the actual buttons to trigger their onClick events first
      setTimeout(() => {
         const selection = window.getSelection();
         if (!selection || selection.isCollapsed) {
            onClose();
         }
      }, 100);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [onClose]);

  if (!position) return null;

  return (
    <div
      className="fixed z-50 origin-bottom animate-in fade-in-0 zoom-in-95 duration-200 ease-out"
      style={{
        left: position?.x || 0,
        top: position?.y || 0,
        transform: 'translate(-50%, -100%) translateY(-10px)',
      }}
    >
      <div className="flex items-center gap-1 p-1 bg-card border border-border rounded-lg shadow-lg">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
          Copy
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReference();
          }}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-lg transition-colors"
        >
          <Quote className="w-3.5 h-3.5" />
          Quote
        </button>
        
        {/* Downward pointing triangle (caret) */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-zinc-900/90" />
      </div>
    </div>
  );
}
