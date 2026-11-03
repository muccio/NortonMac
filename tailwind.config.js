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
          blue: "#0000AA",
          darkblue: "#000080",
          cyan: "#00AAAA",
          brightcyan: "#55FFFF",
          white: "#FFFFFF",
          gray: "#AAAAAA",
          darkgray: "#555555",
          yellow: "#FFFF55",
          black: "#000000",
          red: "#AA0000",
          brightred: "#FF5555",
          green: "#00AA00",
          brightgreen: "#55FF55",
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
