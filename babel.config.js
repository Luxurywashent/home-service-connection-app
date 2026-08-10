module.exports = function (api) {
  api.cache(true);
  let plugins = [];

  // react-native-worklets/plugin handles Reanimated v4 worklet compilation.
  // react-native-reanimated/plugin is a re-export of this same plugin in v4,
  // so only one should be listed here.
  plugins.push("react-native-worklets/plugin");

  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
    plugins,
  };
};
