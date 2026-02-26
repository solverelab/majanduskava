import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  base: '/majanduskava/',
  define: {
    __BUILD_COMMIT__: JSON.stringify(process.env.VITE_GIT_COMMIT || "unknown"),
  },
})