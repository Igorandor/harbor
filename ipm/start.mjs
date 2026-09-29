import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) throw Error('Harbor requires Node.js 22.12 or newer.');
const directory = dirname(fileURLToPath(import.meta.url));
for (const name of ['IRIS_URL', 'IRIS_INSTANCE_ID', 'HARBOR_DATA_DIR', 'PUBLIC_ORIGIN', 'COOKIE_SECURE'])
  if (!process.env[name]?.trim()) throw Error(`Set ${name} before starting the IPM gateway.`);
const data = process.env.HARBOR_DATA_DIR;
if (!isAbsolute(data)) throw Error('HARBOR_DATA_DIR must be an absolute directory outside the installed package.');
// Require an existing directory so its actual target, including symlinks, can be checked.
const actualData = realpathSync(data);
const packageRoot = realpathSync(resolve(directory, '..'));
if (!statSync(actualData).isDirectory() || actualData === packageRoot || actualData.startsWith(packageRoot + sep))
  throw Error('HARBOR_DATA_DIR must be a directory outside the installed package tree.');
process.env.HARBOR_DATA_DIR = actualData;
process.chdir(directory);
await import('./server.cjs');
