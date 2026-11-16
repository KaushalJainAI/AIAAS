// The chat feature's front door. Code outside `features/chat/` imports from
// here and nowhere deeper (ESLint enforces it), so everything else in this
// folder can be renamed or split without touching the rest of the app.
//
// Keep this list short. It is a public API, not a barrel of every file: a
// re-export of everything defeats the boundary and slows Vite's dev server.
export { default } from './AIChat';
