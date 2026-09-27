import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
 
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateUniqueNodeLabel(baseName: string, existingNodes: { data?: { label?: string } }[]): string {
  const existingLabels = new Set(existingNodes.map(n => n.data?.label).filter(Boolean));
  
  // If baseName is generic or missing, use a better default
  let name = baseName || 'Node';
  if (name.toLowerCase() === 'node' || name === 'custom' || name === 'generic') {
    name = 'Node';
  }

  if (!existingLabels.has(name)) {
    return name;
  }

  let counter = 1;
  while (existingLabels.has(`${name} ${counter}`)) {
    counter++;
  }

  return `${name} ${counter}`;
}
