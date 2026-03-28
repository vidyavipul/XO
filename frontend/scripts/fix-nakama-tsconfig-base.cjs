#!/usr/bin/env node
// This script ensures node_modules/tsconfig.base.json exists for Nakama JS SDK
const fs = require('fs');
const path = require('path');

const nodeModulesDir = path.join(__dirname, '..', 'node_modules');
const tsconfigBasePath = path.join(nodeModulesDir, 'tsconfig.base.json');

if (!fs.existsSync(tsconfigBasePath)) {
  fs.writeFileSync(
    tsconfigBasePath,
    JSON.stringify({
      "extends": "./typescript/lib/tsconfig.base.json"
    }, null, 2) + '\n',
    'utf8'
  );
  console.log('Created node_modules/tsconfig.base.json');
} else {
  console.log('node_modules/tsconfig.base.json already exists');
}
