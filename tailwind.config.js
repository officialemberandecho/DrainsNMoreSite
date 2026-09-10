module.exports = {
  content: ['./*.html', './partials/**/*.html'],
  theme: {
    extend: {
      // Height-aware breakpoints. The default `md:` is width-only, so a phone
      // in landscape (844-932px wide, ~390px tall) matches it and picks up
      // desktop sizing on a very short screen. These two are disjoint and
      // cover every viewport between them.
      screens: {
        mdtall: { raw: '(min-width: 768px) and (min-height: 501px)' },
        short: { raw: '(max-height: 500px)' }
      },
      colors: {
        brand: {
          50: '#ecf7ff',
          100: '#d9f0ff',
          400: '#38a9f5',
          500: '#0a8cf0',
          600: '#0a6fcd',
          700: '#0d5ca6',
          900: '#0b1729'
        },
        accent: '#f5b93d'
      },
      boxShadow: {
        soft: '0 20px 45px rgba(15, 52, 86, 0.12)'
      }
    }
  }
};