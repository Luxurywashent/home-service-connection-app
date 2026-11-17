import { getJobSyncCompanyNativePaymentCapabilities } from "./jobsync-mobile-api";
import { NativeCheckoutUnavailableError, type NativeCheckoutTransport } from "./company-native-checkout";

const notReady = () => new NativeCheckoutUnavailableError();
/**
 * The delivered backend currently fails closed. Its quote, private approval,
 * confirmation and recovery acknowledgments still require exact source parity
 * before any secret or charge capability may be exposed by a mobile adapter.
 * Even an unexpected nativeEnabled:true cannot unlock a guessed contract.
 */
export const companyNativePaymentTransport: NativeCheckoutTransport = {
  capabilities: async (context) => {
    await getJobSyncCompanyNativePaymentCapabilities(context.token, context.jobId);
    throw notReady();
  },
  quote: async () => { throw notReady(); },
  approveSignature: async () => { throw notReady(); },
  prepare: async () => { throw notReady(); },
  authorizeConfirmation: async () => { throw notReady(); },
  status: async () => { throw notReady(); },
};
