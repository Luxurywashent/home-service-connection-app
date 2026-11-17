import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installPhotoTestDOM,
  PhotoTestNode,
} from "./helpers/company-photo-test-dom";
import {
  CompanyJobPrivateNotes,
  type CompanyJobPrivateNotesProps,
} from "../components/company-job-private-notes";
import {
  normalizeCompanyJobPrivateNotes,
  formatCompanyJobPrivateNotes,
  companyJobPrivateNotesScope,
  type CompanyJobPrivateNotesDetail,
} from "../lib/company-job-private-notes";
import {
  createJobSyncCompanyJobPayload,
  normalizeJobSyncCompanyCustomers,
  getCompanyJobBillingState,
} from "../lib/jobsync-mobile-api";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const mocks = vi.hoisted(() => ({
  focused: true,
  state: "active",
  listeners: new Set<(state: string) => void>(),
  focusCleanup: null as null | (() => void),
}));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return {
    useIsFocused: () => mocks.focused,
    useFocusEffect: (callback: () => void | (() => void)) =>
      R.useEffect(() => {
        if (!mocks.focused) return;
        const cleanup = callback();
        mocks.focusCleanup = typeof cleanup === "function" ? cleanup : null;
        return () => {
          if (typeof cleanup === "function") cleanup();
        };
      }, [callback]),
  };
});
vi.mock("@/hooks/use-job-sheet-colors", () => ({
  useJobSheetColors: () => ({
    background: "#101319",
    surface: "#1c2028",
    foreground: "#f8fafc",
    muted: "#a5a9b2",
    border: "#2e333c",
    primary: "#0068ff",
    error: "#F06A6A",
  }),
}));
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) =>
    R.createElement(
      name,
      {
        ref: (node: PhotoTestNode | null) => {
          if (node) (node as NativeNode).nativeProps = props;
        },
      },
      props.children,
    );
  return {
    View: host("native-view"),
    Text: host("native-text"),
    TouchableOpacity: host("native-touch"),
    ActivityIndicator: host("native-activity"),
    StyleSheet: { create: (styles: unknown) => styles },
    AppState: {
      get currentState() {
        return mocks.state;
      },
      addEventListener: (_name: string, listener: (state: string) => void) => {
        mocks.listeners.add(listener);
        return { remove: () => mocks.listeners.delete(listener) };
      },
    },
  };
});
const nativeRequire = createRequire(import.meta.url);
const { createRoot } = nativeRequire("react-dom/client") as {
  createRoot: (container: unknown) => {
    render: (node: React.ReactNode) => void;
    unmount: () => void;
  };
};
let root: ReturnType<typeof createRoot>;
let container: PhotoTestNode;
let props: CompanyJobPrivateNotesProps;
function all(node = container): NativeNode[] {
  return [
    node as NativeNode,
    ...node.childNodes.flatMap((child) => all(child)),
  ];
}
function button() {
  const found = all().find(
    (node) =>
      node.nativeProps?.accessibilityLabel === "Refresh private job notes",
  );
  if (!found) throw new Error("Missing refresh");
  return found;
}
function body() {
  return all().find(
    (node) => node.nativeProps?.testID === "company-job-private-notes-body",
  )?.textContent;
}
async function render(patch: Partial<CompanyJobPrivateNotesProps> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(<CompanyJobPrivateNotes {...props} />));
}
async function appState(state: string) {
  await act(async () => {
    mocks.state = state;
    mocks.listeners.forEach((listener) => listener(state));
  });
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const session: JobSyncNativeSession = {
  token: "local-company-notes-token",
  portal: "company",
  user: { id: 91, name: "Company owner", role: "owner", email: null },
  company: {
    id: 9,
    name: "Company",
    slug: "company",
    logoUrl: null,
    primaryColor: null,
    accentColor: null,
  },
};
const detail: CompanyJobPrivateNotesDetail = {
  id: 42,
  companyId: 9,
  customerId: 12,
  assignedUserId: 93,
  title: "Job",
  serviceName: "Service",
  status: "scheduled",
  scheduledStartAt: "2026-12-01T15:00:00Z",
  scheduledEndAt: "2026-12-01T16:00:00Z",
  updatedAt: "2026-12-01T12:00:00Z",
  addressLine1: null,
  city: null,
  amount: 125,
  customerName: "Customer",
  assignedName: "Assigned technician",
  enRouteAt: null,
  onSiteAt: null,
  completedAt: null,
  photos: [],
  privateNotes: "Internal access instruction",
};

beforeEach(() => {
  mocks.focused = true;
  mocks.state = "active";
  mocks.listeners.clear();
  mocks.focusCleanup = null;
  const doc = installPhotoTestDOM();
  container = doc.createElement("main");
  doc.body.appendChild(container);
  root = createRoot(container);
  const actor = {
    ...session,
    user: { ...session.user },
    company: { ...session.company! },
  };
  props = {
    session: actor,
    jobId: 42,
    job: {
      detail: { ...detail },
      actor,
      loading: false,
      pending: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    },
    isCurrent: () => true,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Live transport forbidden")),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.listeners.size).toBe(0);
  vi.unstubAllGlobals();
});

describe("Company private notes — actual React visibility, no native-device claims", () => {
  it.each(["owner", "dispatcher", "technician"] as const)(
    "shows verified internal notes for authorized %s without field eligibility inference",
    async (role) => {
      const actor = {
        ...props.session!,
        user: { ...props.session!.user, role, calendarEligible: false },
      };
      await render({
        session: actor,
        job: {
          ...props.job,
          actor,
          detail: {
            ...detail,
            assignedUserId: role === "technician" ? actor.user.id : 999,
          },
        },
      });
      expect(body()).toBe("Internal access instruction");
      expect(container.textContent).toContain("Internal Company only");
      expect(container.textContent).toContain("Read-only on mobile");
      expect(
        all().some(
          (node) =>
            node.nodeName === "NATIVE-INPUT" ||
            /Save|Edit|Add private/i.test(
              node.nativeProps?.accessibilityLabel ?? "",
            ),
        ),
      ).toBe(false);
    },
  );
  it.each([
    "signed out",
    "platform",
    "unsupported role",
    "missing company",
    "invalid token",
    "legacy job",
    "wrong tenant",
    "wrong job",
    "missing actor",
    "actor tenant",
    "actor user",
    "actor role",
    "actor token",
    "unassigned technician",
  ])("does not expose private text for %s", async (kind) => {
    let actor = props.job.actor!;
    let signed = props.session!;
    let job = { ...props.job, detail: { ...detail } };
    let jobId: number | null = 42;
    if (kind === "signed out") signed = null as unknown as JobSyncNativeSession;
    if (kind === "platform") signed = { ...signed, portal: "platform" };
    if (kind === "unsupported role")
      signed = { ...signed, user: { ...signed.user, role: "operations" } };
    if (kind === "missing company") signed = { ...signed, company: undefined };
    if (kind === "invalid token") signed = { ...signed, token: "bad token" };
    if (kind === "legacy job") jobId = null;
    if (kind === "wrong tenant") job.detail.companyId = 10;
    if (kind === "wrong job") job.detail.id = 43;
    if (kind === "actor tenant")
      actor = { ...actor, company: { ...actor.company!, id: 10 } };
    if (kind === "actor user")
      actor = { ...actor, user: { ...actor.user, id: 92 } };
    if (kind === "actor role")
      actor = { ...actor, user: { ...actor.user, role: "dispatcher" } };
    if (kind === "actor token") actor = { ...actor, token: "other-token" };
    if (kind === "unassigned technician")
      signed = actor = {
        ...actor,
        user: { ...actor.user, role: "technician" },
      };
    job = {
      ...job,
      actor: kind === "missing actor" ? null : actor,
    } as typeof job;
    await render({ session: signed, job, jobId });
    expect(container.textContent).not.toContain("Internal access instruction");
  });
  it.each(["loading", "pending", "error"] as const)(
    "hides previously returned text during %s",
    async (field) => {
      await render();
      await render({
        job: {
          ...props.job,
          [field]: field === "error" ? "Backend denied read" : true,
        },
      });
      expect(body()).not.toBe("Internal access instruction");
      expect(button().nativeProps.disabled).toBe(field !== "error");
    },
  );
  it.each([null, ""])(
    "distinguishes verified empty notes (%s) from unavailable data",
    async (value) => {
      await render({
        job: { ...props.job, detail: { ...detail, privateNotes: value } },
      });
      expect(body()).toBe("No private notes.");
      await render({
        job: { ...props.job, detail: { ...detail, privateNotes: undefined } },
      });
      expect(body()).toContain("unavailable");
    },
  );
  it("formats structured legacy notes without rendering metadata or changing stored content", async () => {
    const raw = JSON.stringify([
      {
        text: "First internal note",
        authorId: "private-author-id",
        hidden: true,
      },
      { text: "Second internal note", authorName: "private-author-name" },
    ]);
    await render({
      job: { ...props.job, detail: { ...detail, privateNotes: raw } },
    });
    expect(body()).toBe("First internal note\n\nSecond internal note");
    expect(container.textContent).not.toContain("private-author");
    expect(props.job.detail?.privateNotes).toBe(raw);
  });
  it("only reads normalized private fields, never customer or service notes, invoice data or payment notes", async () => {
    const row = {
      private_notes: "Internal only",
      internal_notes: "Internal only",
      notes: "PUBLIC SERVICE NOTE",
      serviceNotes: "PUBLIC SERVICE NOTE",
      customer: { privateNotes: "CUSTOMER RECORD" },
      invoice: { notes: "PUBLIC INVOICE" },
      payments: [{ notes: "PAYMENT NOTE" }],
    };
    await render({
      job: {
        ...props.job,
        detail: {
          ...detail,
          privateNotes: normalizeCompanyJobPrivateNotes(row),
        },
      },
    });
    expect(body()).toBe("Internal only");
    expect(container.textContent).not.toMatch(
      /PUBLIC|CUSTOMER RECORD|PAYMENT NOTE/,
    );
    await render({
      job: {
        ...props.job,
        detail: {
          ...detail,
          privateNotes: normalizeCompanyJobPrivateNotes({
            notes: row.notes,
            serviceNotes: row.serviceNotes,
          }),
        },
      },
    });
    expect(body()).toContain("unavailable");
    const customer = normalizeJobSyncCompanyCustomers({
      customers: [
        {
          id: 12,
          name: "Customer",
          private_notes: row.private_notes,
          internal_notes: row.internal_notes,
        },
      ],
    })[0];
    expect(JSON.stringify(customer)).not.toContain("Internal only");
    expect(JSON.stringify(getCompanyJobBillingState(detail))).not.toContain(
      "Internal access instruction",
    );
  });
  it("retains existing Add Job private creation as a separate field", () => {
    const payload = createJobSyncCompanyJobPayload({
      customerId: 12,
      priceBookServiceId: 31,
      scheduledStartAt: "2026-12-01T15:00:00Z",
      privateNotes: "Internal only",
      serviceNotes: "Customer-visible instructions",
    });
    expect(payload.privateNotes).toBe("Internal only");
    expect(payload.serviceNotes).toBe("Customer-visible instructions");
  });
  it("uses only the parent canonical refresh and prevents duplicate refresh taps", async () => {
    const wait = deferred();
    props.onRefresh = vi.fn().mockReturnValue(wait.promise);
    await render();
    const callback = button().nativeProps.onPress;
    await act(async () => {
      callback();
      callback();
    });
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(props.job.refresh).not.toHaveBeenCalled();
    expect(body()).toBe("Loading private notes…");
    await act(async () => wait.resolve());
    expect(body()).toBe("Internal access instruction");
  });
  it("reports a safe refresh error without rendering potentially sensitive backend error text", async () => {
    props.job.refresh = vi
      .fn()
      .mockRejectedValue(new Error("secret private data from an old request"));
    await render();
    await act(async () => button().nativeProps.onPress());
    expect(body()).toContain("could not be verified");
    expect(container.textContent).not.toContain("secret private data");
  });
  it.each([
    "tenant",
    "token",
    "user",
    "role",
    "job",
    "detail",
    "guard",
    "focus",
    "AppState",
    "unmount",
  ])("rejects retained refresh callbacks after %s changes", async (kind) => {
    await render();
    const old = button().nativeProps.onPress;
    const refresh = props.job.refresh;
    if (kind === "tenant")
      await render({
        session: {
          ...props.session!,
          company: { ...props.session!.company!, id: 10 },
        },
      });
    if (kind === "token")
      await render({ session: { ...props.session!, token: "new-token" } });
    if (kind === "user")
      await render({
        session: {
          ...props.session!,
          user: { ...props.session!.user, id: 92 },
        },
      });
    if (kind === "role")
      await render({
        session: {
          ...props.session!,
          user: { ...props.session!.user, role: "dispatcher" },
        },
      });
    if (kind === "job") await render({ jobId: 43 });
    if (kind === "detail")
      await render({
        job: {
          ...props.job,
          detail: { ...detail, privateNotes: "New current note" },
        },
      });
    if (kind === "guard") await render({ isCurrent: () => false });
    if (kind === "focus") {
      await act(async () => mocks.focusCleanup?.());
      mocks.focused = false;
      await render();
    }
    if (kind === "AppState") await appState("background");
    if (kind === "unmount") await act(async () => root.render(null));
    await act(async () => old());
    expect(refresh).not.toHaveBeenCalled();
  });
  it("does not reactivate old callbacks after blur/refocus or AppState resume", async () => {
    await render();
    const old = button().nativeProps.onPress;
    await act(async () => mocks.focusCleanup?.());
    mocks.focused = false;
    await render();
    mocks.focused = true;
    await render();
    await appState("background");
    expect(container.textContent).toBe("");
    await appState("active");
    await act(async () => old());
    expect(props.job.refresh).not.toHaveBeenCalled();
  });
  it("ignores stale refresh rejection after switching Job and accepts only current notes", async () => {
    const wait = deferred();
    props.job.refresh = vi.fn().mockReturnValue(wait.promise);
    await render();
    await act(async () => button().nativeProps.onPress());
    await render({
      jobId: 43,
      job: {
        ...props.job,
        detail: { ...detail, id: 43, privateNotes: "Current Job note" },
      },
    });
    await act(async () => wait.reject(new Error("Old Job private error")));
    expect(body()).toBe("Current Job note");
    expect(container.textContent).not.toContain("Old Job");
  });
});

describe("exact local backend contract evidence and private-only normalization", () => {
  it.each(["002e0b8f", "a07b8077"])(
    "verifies read storage, protected Company authority, route gap and billing boundary at %s",
    (snapshot) => {
      const base = `/home/ubuntu/hsc-mobile-four-repairs-20261116/backend-source-${snapshot}`;
      const mobile = readFileSync(`${base}/server/mobileOperations.ts`, "utf8");
      const service = readFileSync(`${base}/server/jobService.ts`, "utf8");
      const router = readFileSync(
        `${base}/server/fieldServiceRouter.ts`,
        "utf8",
      );
      const context = readFileSync(`${base}/server/companyContext.ts`, "utf8");
      const auth = readFileSync(`${base}/server/mobileAuth.ts`, "utf8");
      expect(mobile).toContain("app.get(`${BASE}/jobs/:jobId`, jobDetail)");
      expect(mobile).not.toMatch(
        /app\.(patch|put|post)\([^\n]*(?:\/notes|\/private-notes)/,
      );
      expect(service).toContain(
        "private_notes: (job as { internal_notes?: unknown }).internal_notes ?? null",
      );
      expect(service).toContain(
        "notes: (job as { service_notes?: unknown }).service_notes ?? null",
      );
      expect(service).toContain(
        "internal_notes = COALESCE(?, internal_notes) WHERE id = ? AND company_id = ?",
      );
      expect(router).toContain(
        'updateNotes: tenantProcedure(["owner", "dispatcher"])',
      );
      expect(context).toContain('clause: " AND j.assigned_user_id = ?"');
      expect(auth).toContain('claims.accountType !== "company"');
      expect(auth).toContain("cu.is_active = 1");
      expect(auth).toContain(
        "withLiveMembershipRole(claims, profile.user.role)",
      );
      const update = service.slice(
        service.indexOf("export async function updateJobNotes"),
        service.indexOf("export type JobImportRow"),
      );
      expect(update).toContain("requireManager(company)");
      expect(update).toContain(
        "details: { privateNotesChanged, serviceNotesChanged }",
      );
      for (const path of [
        "server/publicRevenueAccess.ts",
        "client/src/pages/PublicInvoicePage.tsx",
        "server/mobileCompanyJobDto.ts",
      ])
        expect(readFileSync(`${base}/${path}`, "utf8")).not.toMatch(
          /private.?notes|internal_notes|service_notes/i,
        );
    },
  );
  it("preserves empty and legacy values but rejects conflicting or malformed private fields", () => {
    expect(
      normalizeCompanyJobPrivateNotes({ private_notes: "  internal  " }),
    ).toBe("  internal  ");
    expect(
      normalizeCompanyJobPrivateNotes({ internal_notes: "legacy private" }),
    ).toBe("legacy private");
    expect(
      normalizeCompanyJobPrivateNotes({
        private_notes: null,
        internal_notes: null,
      }),
    ).toBeNull();
    expect(
      normalizeCompanyJobPrivateNotes({ private_notes: "", notes: "public" }),
    ).toBe("");
    expect(
      normalizeCompanyJobPrivateNotes({
        private_notes: null,
        internal_notes: "conflict",
      }),
    ).toBeUndefined();
    expect(
      normalizeCompanyJobPrivateNotes({
        private_notes: ["not the stored text contract"],
      }),
    ).toBeUndefined();
    expect(
      normalizeCompanyJobPrivateNotes({
        privateNotes: "unverified camel alias",
        notes: "public",
      }),
    ).toBeUndefined();
    expect(formatCompanyJobPrivateNotes("[malformed plain note")).toBe(
      "[malformed plain note",
    );
  });
  it("validates numeric signed Company scope and rejects customer/platform role identities", () => {
    expect(companyJobPrivateNotesScope(session, 42)).not.toBeNull();
    expect(
      companyJobPrivateNotesScope(
        {
          ...session,
          company: { ...session.company!, id: "9" as unknown as number },
        },
        42,
      ),
    ).toBeNull();
    expect(companyJobPrivateNotesScope(session, NaN)).toBeNull();
  });
});
