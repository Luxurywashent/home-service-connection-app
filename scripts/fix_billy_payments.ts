import "./load-env.js";
import * as investorDb from "../server/investorDb";

const INVESTOR_ID = "inv_1782439983807_3p0avj";

async function main() {
  // 1. Get all investments for Billy
  const invs = await investorDb.getInvestmentsByInvestor(INVESTOR_ID);
  console.log("Investments:", invs.length);

  for (const inv of invs) {
    const summary = await investorDb.getRepaymentSummary(inv.investmentId);
    const pmts = summary.payments;
    console.log(`\nInvestment ${inv.investmentId} (${inv.investmentAmount}):`);
    pmts.forEach((p: any, i: number) => {
      console.log(`  Payment ${i + 1}: id=${p.paymentId} dueDate=${p.dueDate} paidDate=${p.paidDate} amount=${p.amountPaid} status=${p.status}`);
    });

    // Fix the second payment: change June 11 to June 22, 2026
    const june11Payment = pmts.find((p: any) =>
      (p.paidDate && String(p.paidDate).includes("2026-06-11")) ||
      (p.dueDate && String(p.dueDate).includes("2026-06-11"))
    );
    if (june11Payment) {
      console.log(`\nFixing payment ${june11Payment.paymentId}: June 11 → June 22`);
      const updates: any = {};
      if (String(june11Payment.paidDate).includes("2026-06-11")) updates.paidDate = "2026-06-22";
      if (String(june11Payment.dueDate).includes("2026-06-11")) updates.dueDate = "2026-06-22";
      await investorDb.updatePayment(june11Payment.paymentId, updates);
      console.log("  ✅ Date updated to June 22, 2026");
    } else {
      console.log("  ⚠️  No June 11 payment found — printing all dates for review:");
      pmts.forEach((p: any) => console.log(`    paidDate=${p.paidDate} dueDate=${p.dueDate}`));
    }

    // Add new payment for July 3, 2026 — $2,500
    console.log(`\nAdding $2,500 payment for July 3, 2026 to investment ${inv.investmentId}`);
    const newPaymentId = await investorDb.createPayment({
      investmentId: inv.investmentId,
      dueDate: "2026-07-03",
      paidDate: "2026-07-03",
      amountDue: "2500",
      amountPaid: "2500",
      status: "completed",
      paymentMethod: "cash",
      adminNotes: "Payment received July 3, 2026",
    });
    console.log("  ✅ New payment added:", newPaymentId);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
