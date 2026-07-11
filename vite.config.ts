import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 相對 base：同時相容 GitHub Pages 子路徑（/review.sportsmedicine/）
// 與未來自訂網域根域（review.sportsmedicine.tw/）。
// 搭配 ReviewsIndex 的 fetch 用 import.meta.env.BASE_URL 取資料。
export default defineConfig({
  base: "./",
  plugins: [react()],
});
