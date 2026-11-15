import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
// Embed the browser code in the BB server build: loading text controls must not
// require a running voice companion (or runtime paths outside the plugin bundle).
const result=await build({entryPoints:['src/browser.ts'],bundle:true,format:'iife',target:'es2022',write:false});
const source=result.outputFiles[0].text;
await writeFile('dist/browser.bundle.js',source);
await writeFile('dist/browser-source.mjs',`export default ${JSON.stringify(source)};\n`);
