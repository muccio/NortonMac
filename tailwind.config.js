/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        nc: {
          blue: "rgb(var(--nc-blue-rgb) / <alpha-value>)",
          darkblue: "rgb(var(--nc-darkblue-rgb) / <alpha-value>)",
          cyan: "rgb(var(--nc-cyan-rgb) / <alpha-value>)",
          brightcyan: "rgb(var(--nc-brightcyan-rgb) / <alpha-value>)",
          white: "rgb(var(--nc-white-rgb) / <alpha-value>)",
          gray: "rgb(var(--nc-gray-rgb) / <alpha-value>)",
          darkgray: "rgb(var(--nc-darkgray-rgb) / <alpha-value>)",
          yellow: "rgb(var(--nc-yellow-rgb) / <alpha-value>)",
          black: "rgb(var(--nc-black-rgb) / <alpha-value>)",
          red: "rgb(var(--nc-red-rgb) / <alpha-value>)",
          brightred: "rgb(var(--nc-brightred-rgb) / <alpha-value>)",
          green: "rgb(var(--nc-green-rgb) / <alpha-value>)",
          brightgreen: "rgb(var(--nc-brightgreen-rgb) / <alpha-value>)",
          // Granular Selection & Item Element Colors
          cursorbg: "rgb(var(--nc-cursor-bg-rgb) / <alpha-value>)",
          cursortext: "rgb(var(--nc-cursor-text-rgb) / <alpha-value>)",
          marked: "rgb(var(--nc-marked-text-rgb) / <alpha-value>)",
          cursormarkedbg: "rgb(var(--nc-cursor-marked-bg-rgb) / <alpha-value>)",
          cursormarkedtext: "rgb(var(--nc-cursor-marked-text-rgb) / <alpha-value>)",
          dir: "rgb(var(--nc-dir-text-rgb) / <alpha-value>)",
          file: "rgb(var(--nc-file-text-rgb) / <alpha-value>)",
          archive: "rgb(var(--nc-archive-text-rgb) / <alpha-value>)",
          updir: "rgb(var(--nc-updir-text-rgb) / <alpha-value>)",
        }
      },
      fontFamily: {
        mono: [
          '"SF Mono"',
          '"Menlo"',
          '"Monaco"',
          '"Cascadia Code"',
          '"Courier New"',
          'monospace'
        ]
      }
    },
  },
  plugins: [],
}
