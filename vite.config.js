import { defineConfig } from 'vite';

// @solana/web3.js 는 브라우저에서 Node 전역(global/process/Buffer)을 일부 기대한다.
// polyfills.js 가 Buffer/global 을 채우고, 여기서 process 를 정의한다.
export default defineConfig({
  define: {
    global: 'globalThis',
    'process.env': {},
  },
  optimizeDeps: {
    include: ['@solana/web3.js', 'buffer'],
  },
});
