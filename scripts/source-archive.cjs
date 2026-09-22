const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const roots = [
  'src',
  'scripts',
  'test',
  'assets',
  'docs',
  '.github',
  'package.json',
  'package-lock.json',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'LICENSE.md',
  'DESIGN.md',
  'PRODUCT.md',
  '.gitignore',
  '.prettierrc.json',
  '.prettierignore',
  'integrations',
];
const privateNames = new Set([
  'GameState.json',
  'CollectionState.json',
  'PlayState.json',
  'settings.json',
]);
const files = [];
function collect(relative) {
  const stat = fs.lstatSync(path.join(root, relative));
  if (stat.isSymbolicLink()) throw new Error(`Do not archive symlinks: ${relative}`);
  const name = path.basename(relative);
  if (
    privateNames.has(name) ||
    ['__pycache__', '.pytest_cache'].includes(name) ||
    /^\.env(?:\.|$)/.test(name) ||
    /\.(?:pem|key|pfx|p12|dmp|log|pyc)$/i.test(name)
  )
    throw new Error(`Private file in source tree: ${relative}`);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(path.join(root, relative)).sort())
      collect(path.join(relative, child));
  } else if (stat.isFile()) files.push(relative);
  else throw new Error(`Unsupported source entry: ${relative}`);
}
for (const entry of roots) collect(entry);
const { version } = require('../package.json');
if (!/^[\d]+\.[\d]+\.[\d]+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid package version');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const output = path.join(root, 'dist', `snapper-${version}-source.tar.gz`);
execFileSync('tar', ['-czf', output, '--', ...files], { cwd: root, stdio: 'inherit' });
console.log(
  `Source archive: ${output} (${files.length} files). Review contents before publishing.`,
);
