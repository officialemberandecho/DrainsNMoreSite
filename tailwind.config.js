module.exports = {
  content: ['./*.html', './partials/**/*.html'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ecf7ff',
          100: '#d9f0ff',
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