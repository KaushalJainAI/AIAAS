/**
 * The assistant context object and the hook that reads it.
 *
 * Split from `AssistantContext.tsx` so that file exports the provider alone —
 * a module exporting both a component and a plain function opts out of fast
 * refresh, so editing the provider would remount the tree and close the open
 * assistant panel. Same reasoning as BrowserOS's `osState.ts` / `OSContext.tsx`.
 */
import { createContext, useContext } from 'react';

export interface AssistantContextType {
  isAssistantOpen: boolean;
  toggleAssistant: () => void;
  openAssistant: () => void;
  closeAssistant: () => void;
  llmProvider: string;
  setLlmProvider: (provider: string) => void;
  llmModel: string;
  setLlmModel: (model: string) => void;
  /**
   * Reasoning effort for this surface, `''` for the model's own default.
   *
   * Local to the assistant: like the provider and model above, it is seeded
   * from the account default and stops tracking it the moment it is set here.
   */
  llmEffort: string;
  setLlmEffort: (level: string) => void;
  hasCredentials: boolean | null;
  refreshCredentials: () => Promise<void>;
}

export const AssistantContext = createContext<AssistantContextType | undefined>(undefined);

export function useAssistant() {
  const context = useContext(AssistantContext);
  if (context === undefined) {
    throw new Error('useAssistant must be used within an AssistantProvider');
  }
  return context;
}
