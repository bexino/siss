import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { cpSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      // 将 js/ 目录原样复制进 dist（经典 script 不参与打包）
      name: 'copy-js',
      closeBundle() {
        cpSync(resolve(__dirname, 'js'), resolve(__dirname, 'dist/js'), { recursive: true })
      },
    },
  ],
  // 使用相对路径，使 dist/index.html 可直接双击打开
  base: './',
})
