import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cloudflare 根網域部署；絕對資產路徑讓 /workbench/ 直接開啟及重新整理正常。
export default defineConfig({
  base: "/",
  plugins: [react()],
});
