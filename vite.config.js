import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { cpSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      // 将 js/ 与 docs/ 目录原样复制进 dist（经典 script 与页脚 Markdown 不参与打包）
      name: 'copy-static',
      closeBundle() {
        cpSync(resolve(__dirname, 'js'), resolve(__dirname, 'dist/js'), { recursive: true })
        cpSync(resolve(__dirname, 'docs'), resolve(__dirname, 'dist/docs'), { recursive: true })
      },
    },
  ],
  // 使用相对路径，使 dist/index.html 可直接双击打开
  base: './',
})
