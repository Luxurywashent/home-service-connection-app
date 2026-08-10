/**
 * Web stub for @stripe/stripe-react-native.
 * The real SDK uses native modules that crash on web.
 * This stub exports no-ops so web builds don't fail.
 */
const React = require("react");

module.exports = {
  StripeProvider: ({ children }) => children,
  CardField: () => null,
  useStripe: () => ({
    confirmPayment: async () => ({ error: { message: "Not available on web" } }),
    createPaymentMethod: async () => ({ error: { message: "Not available on web" } }),
    initPaymentSheet: async () => ({ error: { message: "Not available on web" } }),
    presentPaymentSheet: async () => ({ error: { message: "Not available on web" } }),
  }),
  useConfirmPayment: () => [async () => ({ error: { message: "Not available on web" } }), { loading: false }],
};
