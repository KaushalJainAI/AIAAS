/** @type {import('tailwindcss').Config} */

/* The app carries ~600 hardcoded palette classes (bg-emerald-500, text-blue-500,
   text-slate-400 …) spread over 40 files. Rather than hand-edit every call site,
   the default Tailwind ramps are redefined here onto the Fluent palette, so those
   classes keep working and land on the right colour.

   The semantic pairing:
     blue / indigo / sky / cyan   → communication blue  = a human acted
     violet / purple / fuchsia    → agent violet        = the agent acted alone
     green / emerald / teal       → Fluent success
     amber / orange / yellow      → Fluent warning
     red / rose / pink            → Fluent danger
     slate / gray / zinc / neutral→ Fluent true neutrals
*/
const blue = {
  50: '#f3f9fd', 100: '#ebf3fc', 200: '#b4d6fa', 300: '#83bdf0', 400: '#3b8fdd',
  500: '#0f6cbd', 600: '#115ea3', 700: '#0e4f88', 800: '#0b3b64', 900: '#082944', 950: '#05192a',
};
const violet = {
  50: '#f8f6fd', 100: '#f3f0fb', 200: '#d6cdf2', 300: '#b9abe6', 400: '#8f79d3',
  500: '#6b4fbb', 600: '#5a3fa3', 700: '#4a3487', 800: '#382865', 900: '#251a43', 950: '#170f2b',
};
const green = {
  50: '#f1faf1', 100: '#e9f5e9', 200: '#c5e8c5', 300: '#9fd89f', 400: '#4aa64a',
  500: '#0e700e', 600: '#0c5e0c', 700: '#0a4e0a', 800: '#073807', 900: '#052605', 950: '#031803',
};
const amber = {
  50: '#fdf8f1', 100: '#fdf3e7', 200: '#f7d8ba', 300: '#f2c69b', 400: '#dd7a20',
  500: '#bc4b09', 600: '#a04008', 700: '#843506', 800: '#612705', 900: '#411a03', 950: '#291002',
};
const red = {
  50: '#fdf5f6', 100: '#fdf3f4', 200: '#f4bfc4', 300: '#eeacb2', 400: '#d43a48',
  500: '#b10e1c', 600: '#970c18', 700: '#7c0a14', 800: '#5a070e', 900: '#3d0509', 950: '#260306',
};
/* 500 stays dark enough to read as secondary text on white (as slate-500 did). */
const neutral = {
  50: '#fafafa', 100: '#f5f5f5', 200: '#ebebeb', 300: '#e0e0e0', 400: '#b3b3b3',
  500: '#808080', 600: '#616161', 700: '#424242', 800: '#303030', 900: '#242424', 950: '#141414',
};

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Segoe UI Variable Text', 'Segoe UI', 'Open Sans', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Segoe UI Variable Display', 'Segoe UI', 'Open Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.98)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        /* agent-at-work indicator */
        'agent-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.35', transform: 'scale(0.8)' },
        },
      },
      animation: {
        /* Fluent motion is short and near-linear; the old 500ms eases read as sluggish. */
        'fade-in': 'fade-in 0.15s linear',
        'slide-up': 'slide-up 0.2s cubic-bezier(0.33, 0, 0.67, 1)',
        'scale-in': 'scale-in 0.15s cubic-bezier(0.33, 0, 0.67, 1)',
        shimmer: 'shimmer 2.5s linear infinite',
        'agent-pulse': 'agent-pulse 1.4s ease-in-out infinite',
      },
      colors: {
        /* semantic */
        border: "hsl(var(--border))",
        'border-strong': "hsl(var(--border-strong))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          subtle: "hsl(var(--primary-subtle))",
          line: "hsl(var(--primary-line))",
        },
        /* the agent accent — violet means "ran without you" */
        agent: {
          DEFAULT: "hsl(var(--agent))",
          foreground: "hsl(var(--agent-foreground))",
          subtle: "hsl(var(--agent-subtle))",
          line: "hsl(var(--agent-line))",
        },
        /* chart marks — validated per-mode steps, see note in index.css */
        chart: {
          work: "hsl(var(--chart-work))",
          fail: "hsl(var(--chart-fail))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          subtle: "hsl(var(--success-subtle))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          subtle: "hsl(var(--warning-subtle))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          subtle: "hsl(var(--destructive-subtle))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        /* palette remap — see note at top of file */
        blue, indigo: blue, sky: blue, cyan: blue,
        violet, purple: violet, fuchsia: violet,
        green, emerald: green, teal: green, lime: green,
        amber, orange: amber, yellow: amber,
        red, rose: red, pink: red,
        slate: neutral, gray: neutral, zinc: neutral, neutral, stone: neutral,
      },
      /* Fluent shape scale. Collapsing xl/2xl/3xl onto it retires the
         pill-and-blob look across ~850 existing radius classes. */
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: 'var(--radius)',      /* 6px */
        xl: '8px',
        '2xl': '8px',
        '3xl': '12px',
        full: '9999px',
      },
      /* Fluent depth tokens — neutral, tight, no coloured glow */
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)',
        DEFAULT: '0 1px 2px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)',
        md: '0 2px 4px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)',
        lg: '0 4px 8px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)',
        xl: '0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12)',
        '2xl': '0 14px 28px rgba(0,0,0,.14), 0 0 8px rgba(0,0,0,.12)',
        none: 'none',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    /* Supplies animate-in / fade-in / slide-in-from-* / zoom-in-*. The app used
       ~106 of these classes for a year with the plugin absent, so every one of
       them compiled to nothing and the elements they decorated simply popped
       into place. Registering it is what makes those existing call sites real. */
    require('tailwindcss-animate'),
  ],
}
