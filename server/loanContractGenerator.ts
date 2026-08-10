const formatCurrency = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

interface LoanContractData {
  loanId: string;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone?: string;
  principalAmount: number;
  totalRepaymentAmount: number;
  numberOfPayments: number;
  paymentFrequency: string;
  paymentAmount: number;
  interest: number;
  startDate: Date;
  schedule: Array<{ paymentNumber: number; dueDate: Date; amountDue: number; }>;
}

export async function generateLoanContractPDF(data: LoanContractData): Promise<Buffer> {
  const scheduleRows = data.schedule.map(p =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${p.paymentNumber}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${formatDate(p.dueDate)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${formatCurrency(p.amountDue)}</td></tr>`
  ).join("");
  const freqLabel = data.paymentFrequency === "weekly" ? "Weekly" : data.paymentFrequency === "biweekly" ? "Bi-Weekly" : "Monthly";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Loan Agreement</title></head><body>
<h1>Loan Agreement — ${data.loanId}</h1>
<p><b>Lender:</b> ${data.borrowerName} | <b>Email:</b> ${data.borrowerEmail}</p>
<p><b>Principal:</b> ${formatCurrency(data.principalAmount)} | <b>Total:</b> ${formatCurrency(data.totalRepaymentAmount)} | <b>Interest:</b> ${formatCurrency(data.interest)}</p>
<p><b>Payments:</b> ${data.numberOfPayments} × ${formatCurrency(data.paymentAmount)} (${freqLabel}) starting ${formatDate(data.startDate)}</p>
<table border="1" cellpadding="6"><thead><tr><th>#</th><th>Due Date</th><th>Amount</th></tr></thead><tbody>${scheduleRows}</tbody></table>
<p>Governed by the laws of the State of Florida. Disputes resolved in Okaloosa County, FL.</p>
<p>Lender Signature: _________________________ Date: _____________</p>
</body></html>`;
  return Buffer.from(html, "utf-8");
}
