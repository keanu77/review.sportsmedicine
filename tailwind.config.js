/** @type {import('tailwindcss').Config} */

// 色彩與字體對齊主站 sportsmedicine.tw：OKLCH 色相 228（藍青）為品牌主色，
// 標題 Barlow Condensed、內文 Inter，中文一律 PingFang TC / Noto Sans CJK TC。
// 這裡的每一組色都以 sRGB hex 落定並驗過對比：文字 ≥4.5:1、非文字元件 ≥3:1，
// 明暗兩套皆然。語意命名（ink/body/muted/brand/surface/line）而非色名，
// 避免再出現「用 slate-400 當內文」這種對比不足的選色。
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        // 頁面底色
        page: { DEFAULT: "#f9fcfc", dark: "#03141c" },
        // 卡片與區塊底色
        surface: {
          DEFAULT: "#ffffff",
          alt: "#edf7fc",
          dark: "#061e27",
          altdark: "#102731",
        },
        // 標題
        ink: { DEFAULT: "#002b3d", dark: "#eff7fa" },
        // 內文
        body: { DEFAULT: "#464e55", dark: "#b7c7ce" },
        // 次要說明文字
        muted: { DEFAULT: "#616a71", dark: "#95a8b1" },
        // 品牌色：連結與強調
        brand: {
          DEFAULT: "#0078a2",
          strong: "#006288", // 實心底，配白字 6.77:1
          dark: "#62c5ef",
        },
        // 分隔線：line 為裝飾性，linestrong 為元件邊界（達 3:1）
        line: { DEFAULT: "#cae2ee", dark: "#1e3946" },
        linestrong: { DEFAULT: "#608798", dark: "#527889" },
        // 免費全文：與主站同一套 OKLCH 明度／彩度，只換色相到綠
        free: { DEFAULT: "#00704a", dark: "#73cd9f" },
      },
      fontFamily: {
        sans: [
          "Inter",
          "PingFang TC",
          "Microsoft JhengHei",
          "Noto Sans CJK TC",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "Barlow Condensed",
          "PingFang TC",
          "Microsoft JhengHei",
          "Noto Sans CJK TC",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
