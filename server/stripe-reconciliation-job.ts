/**
 * Stripe Reconciliation Background Job
 * 
 * Automatically reconciles unpaid jobs against Stripe every 5 minutes.
 * Finds succeeded PaymentIntents in Stripe and marks matching jobs as paid.
 * 
 * This runs continuously in the background without requiring manual intervention.
 */

import * as db from './db';

const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 50; // Process up to 50 unpaid jobs per run

interface UnpaidJob {
  jobId: string;
  customerName: string;
  balanceDue: number;
  invoiceToken?: string | null;
}

/**
 * Fetch all unpaid jobs from the database
 */
async function getUnpaidJobs(): Promise<UnpaidJob[]> {
  try {
    const drizzleDb = await db.getDb();
    if (!drizzleDb) {
      console.log('[Stripe Reconciliation] Database not available');
      return [];
    }

    const { scheduleJobs: sjTbl } = await import('../drizzle/schema');
    const { isNull, inArray, and, isNotNull, ne } = await import('drizzle-orm');

    const rows = await drizzleDb
      .select({
        jobId: sjTbl.jobId,
        customerName: sjTbl.customerName,
        totalPrice: sjTbl.totalPrice,
        customPrice: sjTbl.customPrice,
        depositAmount: sjTbl.depositAmount,
        discountAmount: sjTbl.discountAmount,
        invoiceToken: sjTbl.invoiceToken,
      })
      .from(sjTbl)
      .where(
        and(
          inArray(sjTbl.status, ['confirmed', 'in_progress', 'completed']),
          isNull(sjTbl.paymentPaidAt),
          isNull(sjTbl.paymentMethod),
          isNotNull(sjTbl.totalPrice),
          ne(sjTbl.totalPrice, '0.00')
        )
      )
      .limit(BATCH_SIZE);

    return rows.map((j: any) => {
      const total = parseFloat(j.totalPrice ?? j.customPrice ?? '0');
      const deposit = parseFloat(j.depositAmount ?? '0');
      const discount = parseFloat(j.discountAmount ?? '0');
      const balanceDue = Math.max(0, total - deposit - discount);
      return {
        jobId: j.jobId,
        customerName: j.customerName,
        balanceDue,
        invoiceToken: j.invoiceToken ?? null,
      };
    });
  } catch (err) {
    console.error('[Stripe Reconciliation] Error fetching unpaid jobs:', err);
    return [];
  }
}

/**
 * Search Stripe for a succeeded PaymentIntent matching a job ID or invoice token
 */
async function findStripePaymentForJob(jobId: string, invoiceToken?: string | null): Promise<any | null> {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY ?? process.env.STRIPE_SK ?? '';
    if (!stripeKey) {
      console.warn('[Stripe Reconciliation] Stripe key not configured');
      return null;
    }

    const searchStripe = async (query: string): Promise<any | null> => {
      const searchRes = await fetch(
        `https://api.stripe.com/v1/payment_intents/search?query=${encodeURIComponent(query)}&limit=1`,
        { headers: { Authorization: `Bearer ${stripeKey}` } }
      );
      if (!searchRes.ok) {
        console.error('[Stripe Reconciliation] Stripe API error:', searchRes.status);
        if (searchRes.status === 400 || searchRes.status === 401 || searchRes.status === 403) {
          throw new Error(`Stripe API returned ${searchRes.status} — aborting reconciliation cycle`);
        }
        return null;
      }
      const data = (await searchRes.json()) as any;
      const intents = data?.data ?? [];
      return intents.length > 0 ? intents[0] : null;
    };

    // 1. Try matching by job_id metadata (admin-created jobs)
    const byJobId = await searchStripe(`metadata['job_id']:'${jobId}' AND status:'succeeded'`);
    if (byJobId) return byJobId;

    // 2. Try matching by invoice_token metadata (email invoice payments)
    if (invoiceToken) {
      const byToken = await searchStripe(`metadata['invoice_token']:'${invoiceToken}' AND status:'succeeded'`);
      if (byToken) return byToken;
    }

    return null;
  } catch (err) {
    console.error('[Stripe Reconciliation] Error searching Stripe:', err);
    return null;
  }
}

/**
 * Mark a job as paid based on Stripe payment
 */
async function markJobAsPaid(jobId: string, stripePayment: any): Promise<boolean> {
  try {
    const amountTotal = (stripePayment.amount ?? 0) / 100;
    const amountTip = stripePayment.metadata?.tip_amount ? parseFloat(stripePayment.metadata.tip_amount) : 0;
    const amountSubtotal = amountTotal - amountTip;

    await db.saveJobPayment(jobId, {
      paymentMethod: 'credit_debit',
      paymentIntentId: stripePayment.id,
      paymentSubtotal: String(amountSubtotal.toFixed(2)),
      paymentTip: String(amountTip.toFixed(2)),
      paymentTotal: String(amountTotal.toFixed(2)),
      paymentPaidAt: new Date(stripePayment.created * 1000).toISOString(),
      paymentSignatureUrl: undefined,
      paymentReferenceNote: `Auto-reconciled from Stripe (${stripePayment.id})`,
    });

    // Update status to completed
    const numericId = parseInt(jobId, 10);
    if (!isNaN(numericId)) {
      const drizzleDb = await db.getDb();
      if (drizzleDb) {
        const { sql: drizzleSql } = await import('drizzle-orm');
        await drizzleDb.execute(drizzleSql`UPDATE schedule_jobs SET status = 'completed' WHERE id = ${numericId}`);
      }
    }

    return true;
  } catch (err) {
    console.error('[Stripe Reconciliation] Error marking job as paid:', err);
    return false;
  }
}

/**
 * Run one reconciliation cycle
 */
async function runReconciliationCycle(): Promise<void> {
  try {
    const unpaidJobs = await getUnpaidJobs();
    if (unpaidJobs.length === 0) {
      console.log('[Stripe Reconciliation] No unpaid jobs to reconcile');
      return;
    }

    console.log(`[Stripe Reconciliation] Found ${unpaidJobs.length} unpaid jobs, searching Stripe...`);

    let reconciled = 0;
    let failed = 0;

    for (const job of unpaidJobs) {
      const stripePayment = await findStripePaymentForJob(job.jobId, job.invoiceToken);
      if (stripePayment) {
        const success = await markJobAsPaid(job.jobId, stripePayment);
        if (success) {
          console.log(
            `[Stripe Reconciliation] ✅ Reconciled job ${job.jobId} (${job.customerName}) - $${job.balanceDue.toFixed(2)}`
          );
          reconciled++;
        } else {
          console.error(`[Stripe Reconciliation] ❌ Failed to mark job ${job.jobId} as paid`);
          failed++;
        }
      }
    }

    if (reconciled > 0 || failed > 0) {
      console.log(
        `[Stripe Reconciliation] Cycle complete: ${reconciled} reconciled, ${failed} failed, ${unpaidJobs.length - reconciled - failed} still unpaid`
      );
    }
  } catch (err) {
    console.error('[Stripe Reconciliation] Cycle error:', err);
  }
}

/**
 * Start the background reconciliation job
 */
export function startStripeReconciliationJob(): void {
  console.log('[Stripe Reconciliation] Starting background job (runs every 5 minutes)');

  // Run immediately on startup
  runReconciliationCycle();

  // Then run every 5 minutes
  setInterval(() => {
    runReconciliationCycle();
  }, RECONCILIATION_INTERVAL_MS);
}
