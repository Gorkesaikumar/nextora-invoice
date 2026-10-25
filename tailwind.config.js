/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "cyan-accent": "#00AEEF",
        "primary": "#111111",
        "on-primary": "#ffffff",
        "surface": "#FFFFFF",
        "surface-dim": "#FAFAFA",
        "on-surface": "#111111",
        "on-surface-variant": "#6B7280",
        "outline": "#ECECEC",
        "outline-variant": "#ECECEC"
      },
      borderRadius: {
        "DEFAULT": "0px",
        "lg": "4px",
        "xl": "8px",
        "full": "9999px"
      },
      spacing: {
        "container-max": "1440px",
        "margin-desktop": "80px",
        "margin-mobile": "24px",
        "base": "8px",
        "gutter": "32px"
      },
      fontFamily: {
        "headline": ["Hanken Grotesk", "sans-serif"],
        "mono": ["JetBrains Mono", "monospace"],
        "body": ["Inter", "sans-serif"]
      },
      fontSize: {
        "display-huge": ["120px", { "lineHeight": "110px", "letterSpacing": "-0.05em", "fontWeight": "900" }],
        "display-xl": ["80px", { "lineHeight": "80px", "letterSpacing": "-0.04em", "fontWeight": "800" }],
        "label-technical": ["11px", { "lineHeight": "16px", "letterSpacing": "0.1em", "fontWeight": "700" }]
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ],
}
