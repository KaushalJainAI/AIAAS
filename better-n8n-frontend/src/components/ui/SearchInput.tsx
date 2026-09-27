import { Search } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
}

export default function SearchInput({ className, containerClassName, ...props }: SearchInputProps) {
  return (
    <div className={cn("relative w-full", containerClassName)}>
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
      <input 
        type="text" 
        className={cn(
          "w-full h-11 pl-11 pr-4 rounded-lg bg-background border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary transition-colors text-foreground placeholder:text-muted-foreground shadow-sm",
          className
        )}
        {...props}
      />
    </div>
  );
}
