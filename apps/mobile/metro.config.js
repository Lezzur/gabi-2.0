const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the entire monorepo so Metro reacts to changes in packages/
config.watchFolders = [workspaceRoot];

// Resolve node_modules from both the app and the workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Transpile @gaia/shared from TypeScript source — no build step required in dev.
// Maps @gaia/shared/<subpath> → packages/shared/<subpath>/index.ts
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@gaia/shared/')) {
    const subpath = moduleName.slice('@gaia/shared/'.length);
    return {
      filePath: path.resolve(workspaceRoot, 'packages/shared', subpath, 'index.ts'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
