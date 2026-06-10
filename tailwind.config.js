/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Nusa Safety brand (also used inline throughout App.jsx)
        navy: "#1F3864",
        "deep-navy": "#0D1F3C",
        "nusa-red": "#C00000",
      },
    },
  },
  plugins: [],
};
