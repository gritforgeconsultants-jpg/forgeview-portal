import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = join(root, 'node_modules');
const output = join(root, 'dist', 'vendor');
const files = {
  'pdf/pdf.mjs': 'pdfjs-dist/build/pdf.min.mjs',
  'pdf/pdf.worker.mjs': 'pdfjs-dist/build/pdf.worker.min.mjs',
  'pdf/pdf.renderer.mjs': 'pdfjs-dist/build/pdf.renderer.min.mjs',
  'pdf/standard_fonts': 'pdfjs-dist/standard_fonts',
  'pdf/cmaps': 'pdfjs-dist/cmaps',
  'pdf/iccs': 'pdfjs-dist/iccs',
  'pdf/wasm': 'pdfjs-dist/wasm',
  'pdf/LICENSE': 'pdfjs-dist/LICENSE',
  'three/three.module.js': 'three/build/three.module.js',
  'three/three.core.js': 'three/build/three.core.js',
  'three/OrbitControls.js': 'three/examples/jsm/controls/OrbitControls.js',
  'three/RoomEnvironment.js': 'three/examples/jsm/environments/RoomEnvironment.js',
  'three/OBJLoader.js': 'three/examples/jsm/loaders/OBJLoader.js',
  'three/PLYLoader.js': 'three/examples/jsm/loaders/PLYLoader.js',
  'three/loaders/GLTFLoader.js': 'three/examples/jsm/loaders/GLTFLoader.js',
  'three/utils/BufferGeometryUtils.js': 'three/examples/jsm/utils/BufferGeometryUtils.js',
  'three/utils/SkeletonUtils.js': 'three/examples/jsm/utils/SkeletonUtils.js',
  'three/STLLoader.js': 'three/examples/jsm/loaders/STLLoader.js',
  'three/LICENSE': 'three/LICENSE',
  'ifc/0.0.81/LICENSE.md': 'web-ifc/LICENSE.md',
  'dxf-parser.js': 'dxf-parser/dist/dxf-parser.js',
  'dxf-parser-LICENSE': 'dxf-parser/LICENSE',
  'ocr/tesseract.mjs': 'tesseract.js/dist/tesseract.esm.min.js',
  'ocr/worker.min.js': 'tesseract.js/dist/worker.min.js',
  'ocr/tesseract-LICENSE': 'tesseract.js/LICENSE.md',
  'ocr/core-LICENSE': 'tesseract.js-core/LICENSE',
  'ocr/tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'ocr/tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'ocr/tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'ocr/eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'fonts/inter.woff2': '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'fonts/barlow.woff2': '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2',
  'fonts/inter-OFL.txt': '@fontsource-variable/inter/LICENSE',
  'fonts/barlow-OFL.txt': '@fontsource/barlow-condensed/LICENSE',
};

await Promise.all(Object.entries(files).map(async ([target, source]) => {
  const path = join(output, target);
  await mkdir(dirname(path), { recursive: true });
  await cp(join(packages, source), path, { recursive: true });
}));

// Fetch the IFC engine only when opening an IFC. Smaller files also fit the sealed static release.
const ifc = join(output, 'ifc', '0.0.81');
const manifest = { source: 'https://github.com/ThatOpen/engine_web-ifc/tree/0.81', license: 'LICENSE.md' };
for (const [key, filename] of [['module', 'web-ifc-api.js'], ['wasm', 'web-ifc.wasm']]) {
  const compressed = gzipSync(await readFile(join(packages, 'web-ifc', filename)), { level: 9 });
  manifest[key] = [];
  for (let start = 0; start < compressed.length; start += 96_000) {
    const part = filename + '.' + manifest[key].length;
    await writeFile(join(ifc, part), compressed.subarray(start, start + 96_000));
    manifest[key].push(part);
  }
}
await writeFile(join(ifc, 'manifest.json'), JSON.stringify(manifest));
console.log('ForgeView browser libraries copied to dist/vendor.');
