const path = require('path');
const TerserPlugin = require("terser-webpack-plugin");
const CopyRenameWebpackPlugin = require("copy-rename-webpack-plugin");


module.exports = {
  mode: 'production',
  resolve: {
    extensions: ['.ts', '.js'],
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: { transpileOnly: true },
        },
        exclude: /node_modules/,
      },
    ],
  },
  entry: {
    iob: './src/iob/index.ts',
    meal: './src/meal/index.ts',
    "determineBasal": './src/determine-basal/index.ts',
    "glucoseGetLast": './src/glucose/index.ts',
    "basalSetTemp": './src/set-temp-basal/index.ts',
    autosens: './src/autosens/index.ts',
    profile: './src/profile/index.ts',
    "autotunePrep": './src/autotune-prep/index.ts',
    "autotuneCore": './src/autotune/index.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'var',
    library: 'trio_[name]'
  },
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()],
  },
  plugins: [
    new CopyRenameWebpackPlugin({
      entry: "determineBasal.js",
      output: [
        "bundle/determine-basal.js"
      ],
    }),
    new CopyRenameWebpackPlugin({
      entry: "glucoseGetLast.js",
      output: [
        "bundle/glucose-get-last.js"
      ],
    }),
    new CopyRenameWebpackPlugin({
      entry: "basalSetTemp.js",
      output: [
        "bundle/basal-set-temp.js"
      ],
    }),
    new CopyRenameWebpackPlugin({
      entry: "iob.js",
      output: [
        "bundle/iob.js"
      ],
    }),
    new CopyRenameWebpackPlugin({
      entry: "meal.js",
      output: [
        "bundle/meal.js"
      ],
    }),
    new CopyRenameWebpackPlugin({
      entry: "autosens.js",
      output: [
        "bundle/autosens.js"
      ],
    }),
    new CopyRenameWebpackPlugin({
      entry: "profile.js",
      output: [
        "bundle/profile.js"
      ],
    }),
    new CopyRenameWebpackPlugin({
      entry: "autotunePrep.js",
      output: [
        "bundle/autotune-prep.js"
      ],
    }),
    new CopyRenameWebpackPlugin({
      entry: "autotuneCore.js",
      output: [
        "bundle/autotune-core.js"
      ],
    }),
  ],
};
