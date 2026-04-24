/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './web/templates/**/*.html',
    './web/paper/**/*.html',
    './web/src/**/*.js'
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Merriweather"', 'serif'],
        mono: ['"IBM Plex Mono"', 'monospace']
      },
      colors: {
        paper: {
          bg: '#f4efe3',
          ink: '#1f2a37',
          edge: '#d6cab2',
          accent: '#9b4d1e',
          cool: '#0f6a73'
        }
      },
      boxShadow: {
        folio: '0 24px 60px rgba(24, 28, 33, 0.18)'
      }
    }
  },
  plugins: []
}
