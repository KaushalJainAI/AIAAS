/* Decouples page title bars from the sidebar's own collapsed state. Title bars
   fire `openSidebar()`; Sidebar listens for the event and opens. This replaces
   the old `fixed` floating button, which every page had to work around with
   `pl-12` clearance hacks and which painted over drawer headers
   (the "Conversations" collision) on phones. An in-flow button in each title
   bar needs no clearance and cannot collide with anything. */
export const OPEN_SIDEBAR_EVENT = 'aiaas:open-sidebar';

export function openSidebar() {
  window.dispatchEvent(new CustomEvent(OPEN_SIDEBAR_EVENT));
}
