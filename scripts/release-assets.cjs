const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { version } = require('../package.json');
const files = [`Snapper-${version}-linux-x86_64.AppImage`, `snapper-${version}-source.tar.gz`];
const lines = files.map(
  (file) =>
    `${createHash('sha256')
      .update(fs.readFileSync(path.join('dist', file)))
      .digest('hex')}  ${file}`,
);
fs.writeFileSync('dist/SHA256SUMS', lines.join('\n') + '\n');
console.log(lines.join('\n'));
