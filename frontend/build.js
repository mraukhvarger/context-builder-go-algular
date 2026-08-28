import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

// 1. Компилируем TS с сохранением метаданных декораторов
console.log('Компиляция TypeScript...');
execSync('npx tsc', { stdio: 'inherit' });

// 2. Копируем index.html
fs.copyFileSync('index.html', path.join('dist', 'index.html'));

// 3. Бандлим скомпилированный JS
console.log('Бандлинг esbuild...');
await esbuild.build({
  entryPoints: ['out/main.js'],
  bundle: true,
  outfile: 'dist/bundle.js',
  minify: false, // выключаем минификацию для отладки
  sourcemap: true,
  format: 'esm',
  target: ['es2022'],
  define: {
    'ngDevMode': 'false',
    'ngJitMode': 'true'
  }
});

// Удаляем временную папку tsc
fs.rmSync('out', { recursive: true, force: true });
console.log('Angular готов!');