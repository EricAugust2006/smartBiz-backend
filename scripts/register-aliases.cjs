const { resolve } = require('node:path');
const { register } = require('tsconfig-paths');

// ts-node tests resolve source files; compiled application processes resolve dist.
register({
  baseUrl: resolve(__dirname, '..', require.extensions['.ts'] ? 'src' : 'dist'),
  paths: {
    '@common/*': ['common/*'],
    '@modules/*': ['modules/*'],
    '@database/*': ['database/*'],
    '@config/*': ['config/*'],
  },
});
