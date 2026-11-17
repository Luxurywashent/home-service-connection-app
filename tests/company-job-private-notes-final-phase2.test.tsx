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
  canEditCompanyJobPrivateNotes,
  editableCompanyJobPrivateNotes,
  validCompanyJobPrivateNoteInput,
  type CompanyJobPrivateNotesDetail,
} from "../lib/company-job-private-notes";
import {
  companyJobPrivateNotesWriteBlocked,
  createCompanyJobPrivateNotesController,
  verifyCompanyJobPrivateNotesAck,
} from "../lib/company-job-private-notes-api";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const mocks = vi.hoisted(() => ({
  focused: true,
  state: "active",
  listeners: new Set<(state: string) => void>(),
  focusCleanup: null as null | (() => void),
  session: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../lib/jobsync-mobile-api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getJobSyncMobileSession: mocks.session,
  getJobSyncCompanyJobDetail: mocks.detail,
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
    TextInput: host("native-input"),
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
let sequence = 1000;
function fixture() {
  const session: JobSyncNativeSession = {
    token: `offline-private-note-${++sequence}`,
    portal: "company",
    user: {
      id: sequence,
      name: "Mock owner",
      email: null,
      role: "owner",
      calendarEligible: false,
    },
    company: {
      id: 9,
      name: "Mock Company",
      slug: "mock",
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
    title: "Mock Job",
    serviceName: "Service",
    status: "scheduled",
    scheduledStartAt: "2026-12-01T15:00:00Z",
    scheduledEndAt: "2026-12-01T16:00:00Z",
    updatedAt: "2026-12-01T12:00:00Z",
    addressLine1: null,
    city: null,
    amount: 125,
    customerName: "Mock customer",
    assignedName: "Mock technician",
    enRouteAt: null,
    onSiteAt: null,
    completedAt: null,
    photos: [],
    privateNotes: "  Internal original\nwith whitespace  ",
  };
  return { session, detail };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function controllerFixture() {
  const { session, detail } = fixture();
  let current = true;
  const api = {
    session: vi.fn().mockResolvedValue(session),
    detail: vi.fn().mockResolvedValue(detail),
  };
  const write = vi
    .fn()
    .mockImplementation(
      async (_token: string, jobId: number, privateNotes: string) => {
        api.detail.mockResolvedValue({ ...detail, privateNotes });
        return { success: true, jobId, privateNotes };
      },
    );
  const make = (actor = session, baseline = detail) =>
    createCompanyJobPrivateNotesController({
      session: actor,
      jobId: 42,
      detail: baseline,
      isCurrent: () => current,
      api,
      write,
    });
  return {
    session,
    detail,
    api,
    write,
    make,
    invalidate: () => {
      current = false;
    },
  };
}
beforeEach(() => {
  mocks.focused = true;
  mocks.state = "active";
  mocks.listeners.clear();
  mocks.focusCleanup = null;
  mocks.session.mockReset();
  mocks.detail.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Live HTTP forbidden")),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("private-only exact endpoint contract and defensive input", () => {
  it("verifies f3576bcb route, strict schema, membership, role, privacy and lack of server concurrency", () => {
    const base =
      "/home/ubuntu/hsc-mobile-final-phase2-20261116/backend-source-f3576bcb";
    const mobile = readFileSync(`${base}/server/mobileOperations.ts`, "utf8");
    const service = readFileSync(`${base}/server/jobService.ts`, "utf8");
    const auth = readFileSync(`${base}/server/mobileAuth.ts`, "utf8");
    const endpoint = mobile.slice(
      mobile.indexOf("async function updatePrivateJobNotes"),
      mobile.indexOf("async function jobStatus"),
    );
    const update = service.slice(
      service.indexOf("export async function updateJobNotes"),
      service.indexOf("export type JobImportRow"),
    );
    expect(mobile).toContain(
      "app.patch(`${BASE}/company/jobs/:jobId/private-notes`, updatePrivateJobNotes)",
    );
    expect(endpoint).toContain("requireMobileCompany(req)");
    expect(endpoint).toContain("requireManager(claims.role)");
    expect(endpoint).toContain(
      "z.object({ privateNotes: z.string().max(4000) }).strict()",
    );
    expect(endpoint).toContain(
      "updateJobNotes(db, company, { jobId, privateNotes: input.privateNotes })",
    );
    expect(endpoint).toContain(
      "success: true, jobId, privateNotes: (detail as any).internal_notes ?? null",
    );
    expect(endpoint).not.toMatch(/expectedUpdatedAt|idempotency|If-Match/);
    expect(update).toContain("requireManager(company)");
    expect(update).toContain("await requireOwnedJob(db, company, input.jobId)");
    expect(update).toContain(
      "input.serviceNotes ?? null, input.privateNotes ?? null",
    );
    expect(update).toContain(
      "details: { privateNotesChanged, serviceNotesChanged }",
    );
    expect(update).not.toMatch(/expectedUpdatedAt|FOR UPDATE|optimisticClause/);
    expect(service).toContain("...row,"); // getJob -> getJobDetail retain internal_notes for the ack.
    expect(service).toContain("...job,");
    expect(auth).toContain("cu.is_active = 1");
    expect(auth).toContain("withLiveMembershipRole(claims, profile.user.role)");
  });
  it.each([
    null,
    undefined,
    4,
    {},
    [],
    { privateNotes: "x", serviceNotes: "public" },
    new String("x"),
    "x".repeat(4001),
  ])("rejects coercion/oversized input %s", (value) => {
    expect(validCompanyJobPrivateNoteInput(value)).toBe(false);
  });
  it.each([
    "",
    "  preserve spaces  ",
    "<script>alert('x')</script>",
    "' OR 1=1 --",
    "\u0000private\nline",
    "__proto__",
    "x".repeat(4000),
  ])(
    "allows endpoint strings as inert text, without parsing or trimming (%s)",
    (value) => {
      expect(validCompanyJobPrivateNoteInput(value)).toBe(true);
    },
  );
  it.each([
    '[{"text":"private","authorId":91}]',
    '{"text":"private","authorId":91}',
    "[]",
    "{}",
  ])(
    "does not flatten structured legacy data to destructive plain text %s",
    (value) => {
      expect(editableCompanyJobPrivateNotes(value)).toBe(false);
    },
  );
  it.each([
    null,
    {},
    [],
    { success: true },
    { success: "true", jobId: 42, privateNotes: "new" },
    { success: true, jobId: "42", privateNotes: "new" },
    { success: true, jobId: 43, privateNotes: "new" },
    { success: true, jobId: 42, privateNotes: null },
    { success: true, jobId: 42, privateNotes: "different" },
    Object.create({ success: true, jobId: 42, privateNotes: "new" }),
  ])(
    "rejects missing, inherited, coerced, wrong-Job and mismatched acknowledgment %s",
    (ack) => {
      expect(verifyCompanyJobPrivateNotesAck(ack, 42, "new")).toBe(false);
    },
  );
  it("accepts exact empty-string acknowledgment, never null or alias", () => {
    expect(
      verifyCompanyJobPrivateNotesAck(
        { success: true, jobId: 42, privateNotes: "" },
        42,
        "",
      ),
    ).toBe(true);
  });
});

describe("fresh authorization/version and one-write canonical reconciliation", () => {
  it.each(["owner", "dispatcher"] as const)(
    "allows %s without assignee/calendar opt-in and verifies independent detail",
    async (role) => {
      const f = controllerFixture();
      f.session.user.role = role;
      const controller = f.make();
      const value = "<script>inert</script>\n' OR 1=1 --";
      expect((await controller.save(value)).status).toBe("saved");
      expect(f.api.session).toHaveBeenCalledTimes(2);
      expect(f.api.detail).toHaveBeenCalledTimes(2);
      expect(f.write).toHaveBeenCalledTimes(1);
      expect(f.write).toHaveBeenCalledWith(f.session.token, 42, value);
      expect((await controller.save(value)).status).toBe("blocked");
      expect(f.write).toHaveBeenCalledTimes(1);
    },
  );
  it("clears with an empty string, never a null/guessed mutation field", async () => {
    const f = controllerFixture();
    expect((await f.make().save("")).status).toBe("saved");
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.write).toHaveBeenCalledWith(f.session.token, 42, "");
  });
  it.each([
    "role",
    "tenant",
    "token",
    "user",
    "portal",
    "missing company",
    "read denied",
    "wrong job",
    "wrong detail tenant",
    "unknown note",
    "contradictory note",
  ])(
    "fails preflight closed without PATCH for fresh %s mismatch",
    async (kind) => {
      const f = controllerFixture();
      const actor = {
        ...f.session,
        user: { ...f.session.user },
        company: { ...f.session.company! },
      };
      if (kind === "role") actor.user.role = "technician";
      if (kind === "tenant") actor.company.id = 10;
      if (kind === "token") actor.token = "other-token";
      if (kind === "user") actor.user.id++;
      if (kind === "portal") actor.portal = "platform";
      if (kind === "missing company")
        actor.company = undefined as unknown as typeof actor.company;
      f.api.session.mockResolvedValue(actor);
      if (kind === "read denied")
        f.api.detail.mockRejectedValue(new Error("secret denied body"));
      if (kind === "wrong job")
        f.api.detail.mockResolvedValue({ ...f.detail, id: 43 });
      if (kind === "wrong detail tenant")
        f.api.detail.mockResolvedValue({ ...f.detail, companyId: 10 });
      if (kind === "unknown note")
        f.api.detail.mockResolvedValue({
          ...f.detail,
          privateNotes: undefined,
        });
      if (kind === "contradictory note")
        f.api.detail.mockResolvedValue({ ...f.detail, privateNotes: {} });
      const result = await f.make().save("new");
      expect(result.status).toBe("blocked");
      expect(result.message).not.toContain("secret");
      expect(f.write).not.toHaveBeenCalled();
    },
  );
  it.each(["version", "private note", "assignment", "missing version"])(
    "rejects stale %s baseline without sending unsupported fields",
    async (kind) => {
      const f = controllerFixture();
      const fresh = { ...f.detail };
      if (kind === "version") fresh.updatedAt = "2026-12-01T12:01:00Z";
      if (kind === "private note")
        fresh.privateNotes = "Someone else's concurrent edit";
      if (kind === "assignment") fresh.assignedUserId = 95;
      if (kind === "missing version") fresh.updatedAt = null;
      f.api.detail.mockResolvedValue(fresh);
      expect((await f.make().save("new")).status).toBe("conflict");
      expect(f.write).not.toHaveBeenCalled();
    },
  );
  it.each([
    "technician",
    "platform",
    "unavailable note",
    "structured note",
    "invalid version",
  ])("blocks initial %s editor authority", async (kind) => {
    const f = controllerFixture();
    if (kind === "technician") {
      f.session.user.role = "technician";
      f.detail.assignedUserId = f.session.user.id;
    }
    if (kind === "platform") f.session.portal = "platform";
    if (kind === "unavailable note") f.detail.privateNotes = undefined;
    if (kind === "structured note")
      f.detail.privateNotes = '[{"text":"legacy","authorId":12}]';
    if (kind === "invalid version") f.detail.updatedAt = "not-a-time";
    expect(
      canEditCompanyJobPrivateNotes(f.session, 42, {
        detail: f.detail,
        actor: f.session,
        loading: false,
        pending: false,
        error: null,
      }),
    ).toBe(false);
    expect((await f.make().save("new")).status).toBe("blocked");
    expect(f.write).not.toHaveBeenCalled();
  });
  it.each([
    "malformed ack",
    "wrong Job ack",
    "mismatched ack",
    "different readback",
    "failed readback",
    "fresh readback role",
  ])(
    "does not claim success or retry for %s, and requires explicit read reconciliation",
    async (kind) => {
      const f = controllerFixture();
      f.write.mockImplementation(async () => {
        f.api.detail.mockResolvedValue({
          ...f.detail,
          privateNotes: kind === "different readback" ? "other edit" : "new",
        });
        if (kind === "failed readback")
          f.api.detail.mockRejectedValue(new Error("sensitive backend body"));
        if (kind === "fresh readback role")
          f.api.session.mockResolvedValue({
            ...f.session,
            user: { ...f.session.user, role: "technician" },
          });
        return kind === "malformed ack"
          ? { success: true }
          : {
              success: true,
              jobId: kind === "wrong Job ack" ? 43 : 42,
              privateNotes: kind === "mismatched ack" ? null : "new",
            };
      });
      const controller = f.make();
      const result = await controller.save("new");
      expect(result.status).toBe("uncertain");
      expect(result.message).not.toContain("sensitive");
      expect(companyJobPrivateNotesWriteBlocked(f.session, 42)).toBe(true);
      expect((await controller.save("new")).status).toBe("blocked");
      expect((await f.make().save("new")).status).toBe("blocked");
      expect(f.write).toHaveBeenCalledTimes(1);
      f.api.session.mockResolvedValue(f.session);
      f.api.detail.mockResolvedValue({ ...f.detail, privateNotes: "new" });
      expect(await f.make().refresh()).toBe(true);
      expect(companyJobPrivateNotesWriteBlocked(f.session, 42)).toBe(false);
      expect(f.write).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["timeout", "rejected", "network"])(
    "treats %s PATCH as uncertain and never retries automatically",
    async (kind) => {
      const f = controllerFixture();
      f.write.mockRejectedValue(new Error(`${kind}: secret note body`));
      const result = await f.make().save("new");
      expect(result.status).toBe("uncertain");
      expect(result.message).not.toContain("secret");
      expect((await f.make().save("new")).status).toBe("blocked");
      expect(f.write).toHaveBeenCalledTimes(1);
    },
  );
  it("locks synchronously through token rotation and sheet reopen until write transport settles", async () => {
    const f = controllerFixture();
    const waiting = deferred<unknown>();
    f.write.mockReturnValue(waiting.promise);
    const controller = f.make();
    const first = controller.save("new");
    expect((await controller.save("new")).status).toBe("blocked");
    await vi.waitFor(() => expect(f.write).toHaveBeenCalledTimes(1));
    expect(
      (await f.make({ ...f.session, token: "rotated" }).save("new")).status,
    ).toBe("blocked");
    expect(await f.make().refresh()).toBe(false);
    f.invalidate();
    waiting.resolve({ success: true, jobId: 42, privateNotes: "new" });
    expect((await first).status).toBe("stale");
    expect(companyJobPrivateNotesWriteBlocked(f.session, 42)).toBe(true);
  });
  it("does not write when the current guard is invalidated while fresh session is pending", async () => {
    const f = controllerFixture();
    const waiting = deferred<JobSyncNativeSession>();
    f.api.session.mockReturnValue(waiting.promise);
    const pending = f.make().save("new");
    f.invalidate();
    waiting.resolve(f.session);
    expect((await pending).status).toBe("stale");
    expect(f.api.detail).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });
  it("does not clear unresolved outcome when fresh explicit reconciliation fails", async () => {
    const f = controllerFixture();
    f.write.mockRejectedValue(new Error("timeout"));
    const controller = f.make();
    expect((await controller.save("new")).status).toBe("uncertain");
    f.api.detail.mockRejectedValue(new Error("offline"));
    expect(await controller.refresh()).toBe(false);
    expect(companyJobPrivateNotesWriteBlocked(f.session, 42)).toBe(true);
  });
});

describe("actual React editor in existing compact slot — offline lifecycle fixtures", () => {
  let root: ReturnType<typeof createRoot>;
  let container: PhotoTestNode;
  let props: CompanyJobPrivateNotesProps;
  let writer: ReturnType<typeof vi.fn>;
  function all(node = container): NativeNode[] {
    return [
      node as NativeNode,
      ...node.childNodes.flatMap((child) => all(child)),
    ];
  }
  function find(label: string) {
    return all().find((node) => node.nativeProps?.accessibilityLabel === label);
  }
  function button(label: string) {
    const node = find(label);
    if (!node) throw new Error(`Missing ${label}`);
    return node.nativeProps;
  }
  async function render(patch: Partial<CompanyJobPrivateNotesProps> = {}) {
    props = { ...props, ...patch };
    await act(async () => root.render(<CompanyJobPrivateNotes {...props} />));
  }
  async function edit(value = "Private replacement") {
    await act(async () => button("Edit private job notes").onPress());
    await act(async () =>
      button("Edit internal Company private notes").onChangeText(value),
    );
  }
  async function state(next: string) {
    await act(async () => {
      mocks.state = next;
      mocks.listeners.forEach((listener) => listener(next));
    });
  }
  beforeEach(() => {
    const doc = installPhotoTestDOM();
    container = doc.createElement("main");
    doc.body.appendChild(container);
    root = createRoot(container);
    const { session, detail } = fixture();
    mocks.session.mockResolvedValue(session);
    mocks.detail.mockResolvedValue(detail);
    writer = vi
      .fn()
      .mockImplementation(
        async (_token: string, jobId: number, privateNotes: string) => {
          mocks.detail.mockResolvedValue({ ...detail, privateNotes });
          return { success: true, jobId, privateNotes };
        },
      );
    props = {
      session,
      jobId: 42,
      job: {
        detail,
        actor: session,
        loading: false,
        pending: false,
        error: null,
        refresh: vi.fn().mockResolvedValue(undefined),
      },
      isCurrent: () => true,
      writePrivateNotes: writer,
      onInputFocus: vi.fn(),
      onInputBlur: vi.fn(),
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    expect(mocks.listeners.size).toBe(0);
  });
  it("preserves the compact slot and raw plain text; Cancel discards the draft with no write", async () => {
    await render();
    expect(container.textContent).toContain(
      "Internal Company only · Not customer-visible",
    );
    await act(async () => button("Edit private job notes").onPress());
    expect(button("Edit internal Company private notes").value).toBe(
      props.job.detail!.privateNotes,
    );
    const input = button("Edit internal Company private notes");
    expect(input.multiline).toBe(true);
    expect(input.maxLength).toBe(4000);
    await act(async () => {
      input.onFocus({ currentTarget: {} });
      input.onBlur({});
      input.onChangeText("UNSAVED PRIVATE DRAFT");
    });
    expect(props.onInputFocus).toHaveBeenCalledTimes(1);
    expect(props.onInputBlur).toHaveBeenCalledTimes(1);
    await act(async () => button("Cancel private notes edit").onPress());
    expect(find("Edit internal Company private notes")).toBeUndefined();
    expect(container.textContent).not.toContain("UNSAVED PRIVATE DRAFT");
    expect(writer).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("Cancel invalidates retained Save in the same event turn and after a new editor opens", async () => {
    await render();
    await edit("Cancelled private draft");
    const save = button("Save private job notes").onPress;
    const change = button("Edit internal Company private notes").onChangeText;
    await act(async () => {
      button("Cancel private notes edit").onPress();
      save();
    });
    expect(writer).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    await edit("New reviewed draft");
    await act(async () => {
      save();
      change("Stale cancelled draft");
    });
    expect(button("Edit internal Company private notes").value).toBe(
      "New reviewed draft",
    );
    expect(writer).not.toHaveBeenCalled();
  });
  it.each(["owner", "dispatcher"] as const)(
    "makes only authorized %s editable",
    async (role) => {
      const actor = {
        ...props.session!,
        user: { ...props.session!.user, role },
      };
      await render({ session: actor, job: { ...props.job, actor } });
      expect(find("Edit private job notes")).toBeDefined();
    },
  );
  it("keeps an assigned technician read-only even with a writer and calendar eligibility", async () => {
    const actor = {
      ...props.session!,
      user: {
        ...props.session!.user,
        role: "technician" as const,
        calendarEligible: true,
      },
    };
    await render({
      session: actor,
      job: {
        ...props.job,
        actor,
        detail: { ...props.job.detail!, assignedUserId: actor.user.id },
      },
    });
    expect(container.textContent).toContain("Internal original");
    expect(find("Edit private job notes")).toBeUndefined();
    expect(find("Save private job notes")).toBeUndefined();
    expect(writer).not.toHaveBeenCalled();
  });
  it("fails closed read-only when the parent adapter is absent and preserves structured record metadata", async () => {
    await render({ writePrivateNotes: undefined });
    expect(find("Edit private job notes")).toBeUndefined();
    expect(container.textContent).toContain("not connected");
    const raw =
      '[{"text":"Internal structured text","authorId":"hidden-author-id"}]';
    await render({
      writePrivateNotes: writer,
      job: {
        ...props.job,
        detail: { ...props.job.detail!, privateNotes: raw },
      },
    });
    expect(container.textContent).toContain("Internal structured text");
    expect(container.textContent).not.toContain("hidden-author-id");
    expect(find("Edit private job notes")).toBeUndefined();
    expect(props.job.detail!.privateNotes).toBe(raw);
  });
  it("rejects malicious non-string input and oversized callback values without coercion", async () => {
    await render();
    await edit("safe draft");
    const input = button("Edit internal Company private notes");
    await act(async () => {
      input.onChangeText({
        privateNotes: "private",
        serviceNotes: "public overwrite",
      });
      input.onChangeText("x".repeat(4001));
    });
    expect(button("Edit internal Company private notes").value).toBe(
      "safe draft",
    );
    expect(writer).not.toHaveBeenCalled();
  });
  it("duplicates Save callbacks issue exactly one write and only update the parent after canonical verification", async () => {
    await render();
    await edit("Private replacement");
    const waiting = deferred<unknown>();
    writer.mockReturnValue(waiting.promise);
    const save = button("Save private job notes").onPress;
    await act(async () => {
      save();
      save();
    });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(props.job.refresh).not.toHaveBeenCalled();
    expect(button("Save private job notes").disabled).toBe(true);
    mocks.detail.mockResolvedValue({
      ...props.job.detail!,
      privateNotes: "Private replacement",
    });
    await act(async () =>
      waiting.resolve({
        success: true,
        jobId: 42,
        privateNotes: "Private replacement",
      }),
    );
    expect(props.job.refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("saved and verified");
    expect(props.job.detail!.privateNotes).not.toBe("Private replacement"); // Never optimistically mutate parent data.
    await act(async () => save());
    expect(writer).toHaveBeenCalledTimes(1);
  });
  it("mismatched acknowledgment hides draft, shows safe uncertainty and enables only explicit read refresh", async () => {
    writer.mockResolvedValue({
      success: true,
      jobId: 43,
      privateNotes: "private response body",
    });
    await render();
    await edit("Private replacement");
    const save = button("Save private job notes").onPress;
    await act(async () => save());
    expect(container.textContent).toContain("Save could not be confirmed");
    expect(container.textContent).not.toContain("private response body");
    expect(find("Edit private job notes")).toBeUndefined();
    expect(find("Edit internal Company private notes")).toBeUndefined();
    await act(async () => {
      save();
      button("Refresh private job notes").onPress();
    });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(find("Edit private job notes")).toBeDefined();
  });
  it.each([
    "tenant",
    "user",
    "role",
    "token",
    "job",
    "detail",
    "pending",
    "guard",
    "focus",
    "background",
    "unmount",
    "writer",
  ])(
    "rejects retained Save and hides private drafts after %s changes",
    async (kind) => {
      await render();
      await edit("NEVER EXPOSE STALE DRAFT");
      const save = button("Save private job notes").onPress;
      if (kind === "tenant")
        await render({
          session: {
            ...props.session!,
            company: { ...props.session!.company!, id: 10 },
          },
        });
      if (kind === "user")
        await render({
          session: {
            ...props.session!,
            user: { ...props.session!.user, id: 999 },
          },
        });
      if (kind === "role")
        await render({
          session: {
            ...props.session!,
            user: { ...props.session!.user, role: "dispatcher" },
          },
        });
      if (kind === "token")
        await render({ session: { ...props.session!, token: "rotated" } });
      if (kind === "job") await render({ jobId: 43 });
      if (kind === "detail")
        await render({
          job: {
            ...props.job,
            detail: {
              ...props.job.detail!,
              privateNotes: "New canonical note",
            },
          },
        });
      if (kind === "pending")
        await render({ job: { ...props.job, pending: true } });
      if (kind === "writer") await render({ writePrivateNotes: undefined });
      if (kind === "guard") await render({ isCurrent: () => false });
      if (kind === "focus") {
        await act(async () => mocks.focusCleanup?.());
        mocks.focused = false;
        await render();
      }
      if (kind === "background") await state("background");
      if (kind === "unmount") await act(async () => root.render(null));
      await act(async () => save());
      expect(writer).not.toHaveBeenCalled();
      expect(mocks.session).not.toHaveBeenCalled();
      expect(find("Edit internal Company private notes")).toBeUndefined();
      expect(container.textContent).not.toContain("NEVER EXPOSE STALE DRAFT");
    },
  );
  it.each(["version", "note", "assignment"])(
    "rejects retained Save after in-place canonical %s mutation even without rerender",
    async (kind) => {
      await render();
      await edit();
      const save = button("Save private job notes").onPress;
      if (kind === "version")
        props.job.detail!.updatedAt = "2026-12-01T12:01:00Z";
      if (kind === "note")
        props.job.detail!.privateNotes = "Different verified note";
      if (kind === "assignment") props.job.detail!.assignedUserId = 95;
      await act(async () => save());
      expect(writer).not.toHaveBeenCalled();
      expect(mocks.session).not.toHaveBeenCalled();
    },
  );
  it.each(["blur/refocus", "background/resume"])(
    "does not revive Save callbacks after %s",
    async (kind) => {
      await render();
      await edit();
      const save = button("Save private job notes").onPress;
      if (kind === "blur/refocus") {
        await act(async () => mocks.focusCleanup?.());
        mocks.focused = false;
        await render();
        mocks.focused = true;
        await render();
      } else {
        await state("background");
        await state("active");
      }
      await act(async () => save());
      expect(writer).not.toHaveBeenCalled();
      expect(find("Edit internal Company private notes")).toBeUndefined();
    },
  );
  it.each(["background", "focus", "unmount", "job", "guard"])(
    "invalidates in-flight freshness after %s without PATCH",
    async (kind) => {
      const waiting = deferred<JobSyncNativeSession>();
      mocks.session.mockReturnValue(waiting.promise);
      await render();
      await edit();
      await act(async () => button("Save private job notes").onPress());
      if (kind === "background") await state("background");
      if (kind === "focus") {
        await act(async () => mocks.focusCleanup?.());
        mocks.focused = false;
        await render();
      }
      if (kind === "unmount") await act(async () => root.render(null));
      if (kind === "job") await render({ jobId: 43 });
      if (kind === "guard") await render({ isCurrent: () => false });
      await act(async () => waiting.resolve(props.session!));
      expect(writer).not.toHaveBeenCalled();
      expect(props.job.refresh).not.toHaveBeenCalled();
    },
  );
  it("holds attempted write across same-Job close/reopen and ignores completion after background", async () => {
    const waiting = deferred<unknown>();
    writer.mockReturnValue(waiting.promise);
    await render();
    await edit();
    await act(async () => button("Save private job notes").onPress());
    expect(writer).toHaveBeenCalledTimes(1);
    await state("background");
    await act(async () => root.render(null));
    mocks.state = "active";
    await render();
    expect(find("Edit private job notes")).toBeUndefined();
    expect(container.textContent).toContain("pending or unconfirmed");
    await act(async () =>
      waiting.resolve({
        success: true,
        jobId: 42,
        privateNotes: "Private replacement",
      }),
    );
    expect(props.job.refresh).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("saved and verified");
    expect(find("Edit private job notes")).toBeUndefined();
    await act(async () => button("Refresh private job notes").onPress());
    expect(find("Edit private job notes")).toBeDefined();
    expect(writer).toHaveBeenCalledTimes(1);
  });
});
