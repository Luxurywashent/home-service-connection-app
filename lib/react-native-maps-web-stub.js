/**
 * Web stub for react-native-maps.
 * react-native-maps is native-only and cannot run on web.
 * Metro resolves this file instead of the real package when bundling for web.
 */
const React = require("react");
const { View } = require("react-native");

const noop = () => null;

const MapView = noop;
MapView.Animated = noop;

module.exports = {
  default: MapView,
  MapView,
  Marker: noop,
  Callout: noop,
  Polyline: noop,
  Polygon: noop,
  Circle: noop,
  Overlay: noop,
  UrlTile: noop,
  PROVIDER_GOOGLE: "google",
  PROVIDER_DEFAULT: null,
};
