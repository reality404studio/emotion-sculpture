// @solana/web3.js 는 브라우저에서 Buffer 전역을 기대한다. Vite 빌드용 얇은 폴리필.
import { Buffer } from 'buffer';
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
if (typeof globalThis.global === 'undefined') globalThis.global = globalThis;
