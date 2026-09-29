import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'ipm/harbor-gateway');
if (output !== root + sep + 'ipm' + sep + 'harbor-gateway') throw Error('Invalid payload directory');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, 'dist'), resolve(output, 'dist'), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['server/index.ts'],
  outfile: resolve(output, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  metafile: true,
  legalComments: 'linked',
});
await writeFile(resolve(output, 'start.mjs'), (await readFile(resolve(root, 'ipm/start.mjs'), 'utf8')).replaceAll('\r\n', '\n'));
await writeFile(resolve(output, 'LICENSE'), (await readFile(resolve(root, 'LICENSE'), 'utf8')).replaceAll('\r\n', '\n'));
const names = new Set(['@fontsource-variable/dm-sans', '@fontsource-variable/manrope', 'react', 'react-dom', 'scheduler', 'lucide-react']);
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.replaceAll('\\', '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (match) names.add(match[1]);
}
let notices = '# Bundled third-party licenses\n\n';
for (const name of [...names].sort()) {
  const directory = resolve(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const entries = await readdir(directory);
  const files = entries.filter(name => /^(licen[cs]e|copying|ofl)(\.|$)/i.test(name)).sort();
  notices += `## ${name} ${pkg.version}\n\n`;
  if (!files.length) {
    const readme = entries.find(name => /^readme\.md$/i.test(name));
    const text = readme ? await readFile(resolve(directory, readme), 'utf8') : '';
    const section = text.match(/^##? License\s*\r?\n([\s\S]*)/im);
    if (!section || !section[1].includes('Permission is hereby granted')) throw Error('Missing license text: ' + name);
    notices += section[1].replaceAll('\r\n', '\n') + '\n\n';
  }
  for (const file of files) notices += (await readFile(resolve(directory, file), 'utf8')).replaceAll('\r\n', '\n') + '\n\n';
}
await writeFile(resolve(output, 'THIRD_PARTY_LICENSES.txt'), notices.trimEnd() + '\n');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const files = {};
async function inventory(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await inventory(resolve(directory, entry.name), name + '/');
    else if (entry.isFile()) {
      const path = resolve(directory, entry.name);
      // Git stores text payloads as LF; hash exactly the bytes installed from a checkout.
      if (/\.(html|svg|js|cjs|mjs|css|json|txt)$/.test(name) || name === 'LICENSE')
        await writeFile(path, (await readFile(path, 'utf8')).replaceAll('\r\n', '\n'));
      files[name] = createHash('sha256').update(await readFile(path)).digest('hex');
    }
    else throw Error('Unexpected payload entry: ' + name);
  }
}
await inventory(output);
await writeFile(resolve(output, 'payload.json'), JSON.stringify({ version: pkg.version, files }, null, 2) + '\n');
console.log(`Built IPM gateway ${pkg.version}: ${Object.keys(files).length} files; Node runtime required, no npm install on target.`);
