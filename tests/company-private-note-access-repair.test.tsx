import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
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
  canReadCompanyJobPrivateNotes,
  canEditCompanyJobPrivateNotes,
  type CompanyJobPrivateNotesDetail,
} from "../lib/company-job-private-notes";
import { createCompanyJobPrivateNotesController } from "../lib/company-job-private-notes-api";
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
let sequence = 8000;
function fixture(
  role: "owner" | "dispatcher" | "technician" = "technician",
  assignment: "assigned" | "unassigned" | "other" = "other",
) {
  const userId = ++sequence;
  const session: JobSyncNativeSession = {
    token: `offline-note-access-${userId}`,
    portal: "company",
    user: {
      id: userId,
      role,
      name: "Offline actor",
      email: null,
      calendarEligible: false,
    },
    company: {
      id: 9,
      name: "Offline Company",
      slug: "offline",
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
    },
  };
  const detail: CompanyJobPrivateNotesDetail = {
    id: 42,
    companyId: 9,
    customerId: 12,
    assignedUserId:
      assignment === "assigned"
        ? userId
        : assignment === "unassigned"
          ? null
          : 93,
    title: "Offline Job",
    serviceName: "Service",
    status: "scheduled",
    scheduledStartAt: "2026-12-01T15:00:00Z",
    scheduledEndAt: "2026-12-01T16:00:00Z",
    updatedAt: "2026-12-01T12:00:00Z",
    addressLine1: null,
    city: null,
    amount: 125,
    customerName: "Offline customer",
    assignedName: null,
    enRouteAt: null,
    onSiteAt: null,
    completedAt: null,
    photos: [],
    privateNotes: "Internal Company instruction",
  };
  const job = {
    detail,
    actor: session,
    loading: false,
    pending: false,
    error: null,
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  return { session, detail, job };
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

describe("private notes follow fresh same-Company detail authority, not assignment", () => {
  it.each(["assigned", "unassigned", "other"] as const)(
    "technician %s can read and GET-only refresh, never save",
    async (assignment) => {
      const f = fixture("technician", assignment);
      expect(canReadCompanyJobPrivateNotes(f.session, 42, f.job)).toBe(true);
      expect(canEditCompanyJobPrivateNotes(f.session, 42, f.job)).toBe(false);
      const api = {
        session: vi.fn().mockResolvedValue(f.session),
        detail: vi.fn().mockResolvedValue(f.detail),
      };
      const write = vi.fn();
      const controller = createCompanyJobPrivateNotesController({
        session: f.session,
        jobId: 42,
        detail: f.detail,
        isCurrent: () => true,
        api,
        write,
      });
      expect((await controller.save("Forbidden technician draft")).status).toBe(
        "blocked",
      );
      expect(await controller.refresh()).toBe(true);
      expect(api.session).toHaveBeenCalledWith(f.session.token);
      expect(api.detail).toHaveBeenCalledWith(f.session.token, 42, 9);
      expect(write).not.toHaveBeenCalled();
    },
  );
  it.each(["owner", "dispatcher"] as const)(
    "%s editing remains versioned, exact-acknowledged and canonical-readback verified",
    async (role) => {
      const f = fixture(role, "unassigned");
      const api = {
        session: vi.fn().mockResolvedValue(f.session),
        detail: vi.fn().mockResolvedValue(f.detail),
      };
      const value = "  Manager private text\n  ";
      const write = vi.fn(
        async (token: string, jobId: number, privateNotes: string) => {
          expect(token).toBe(f.session.token);
          api.detail.mockResolvedValue({
            ...f.detail,
            privateNotes,
            updatedAt: "2026-12-01T12:01:00Z",
          });
          return { success: true, jobId, privateNotes };
        },
      );
      expect(canEditCompanyJobPrivateNotes(f.session, 42, f.job)).toBe(true);
      const controller = createCompanyJobPrivateNotesController({
        session: f.session,
        jobId: 42,
        detail: f.detail,
        isCurrent: () => true,
        api,
        write,
      });
      expect((await controller.save(value)).status).toBe("saved");
      expect(api.session).toHaveBeenCalledTimes(2);
      expect(api.detail).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenCalledTimes(1);
      expect((await controller.save(value)).status).toBe("blocked");
      expect(f.detail.privateNotes).toBe("Internal Company instruction");
    },
  );
  it.each([
    "missing actor",
    "actor role",
    "actor tenant",
    "actor user",
    "actor token",
    "actor platform",
    "wrong tenant",
    "wrong Job",
    "loading",
    "pending",
    "error",
    "unsupported role",
  ])("denies note exposure for %s without weakening freshness", (kind) => {
    const f = fixture();
    const actor = {
      ...f.session,
      user: { ...f.session.user },
      company: { ...f.session.company! },
    };
    if (kind === "actor role") actor.user.role = "dispatcher";
    if (kind === "actor tenant") actor.company.id = 10;
    if (kind === "actor user") actor.user.id++;
    if (kind === "actor token") actor.token = "rotated";
    if (kind === "actor platform") actor.portal = "platform";
    if (kind === "unsupported role")
      f.session.user.role = actor.user.role = "operations";
    if (kind === "wrong tenant") f.detail.companyId = 10;
    if (kind === "wrong Job") f.detail.id = 43;
    const job = {
      ...f.job,
      actor: kind === "missing actor" ? null : actor,
      loading: kind === "loading",
      pending: kind === "pending",
      error: kind === "error" ? "Access denied" : null,
    };
    expect(canReadCompanyJobPrivateNotes(f.session, 42, job)).toBe(false);
    expect(canEditCompanyJobPrivateNotes(f.session, 42, job)).toBe(false);
  });
});

describe("actual compact note component for newly authorized readers", () => {
  let root: ReturnType<typeof createRoot>;
  let container: PhotoTestNode;
  let props: CompanyJobPrivateNotesProps;
  let write: ReturnType<typeof vi.fn>;
  function all(node = container): NativeNode[] {
    return [
      node as NativeNode,
      ...node.childNodes.flatMap((child) => all(child)),
    ];
  }
  function find(label: string) {
    return all().find((node) => node.nativeProps?.accessibilityLabel === label)
      ?.nativeProps;
  }
  async function render(patch: Partial<CompanyJobPrivateNotesProps> = {}) {
    props = { ...props, ...patch };
    await act(async () => root.render(<CompanyJobPrivateNotes {...props} />));
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
    const f = fixture();
    mocks.session.mockResolvedValue(f.session);
    mocks.detail.mockResolvedValue(f.detail);
    write = vi.fn();
    props = {
      session: f.session,
      jobId: 42,
      job: f.job,
      isCurrent: () => true,
      writePrivateNotes: write,
    };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    expect(mocks.listeners.size).toBe(0);
  });
  it.each(["assigned", "unassigned", "other"] as const)(
    "shows %s technician internal notes read-only with the real writer supplied",
    async (assignment) => {
      const f = fixture("technician", assignment);
      mocks.session.mockResolvedValue(f.session);
      mocks.detail.mockResolvedValue(f.detail);
      await render({ session: f.session, job: f.job });
      expect(container.textContent).toContain("Internal Company instruction");
      expect(container.textContent).toContain("Not customer-visible");
      expect(find("Edit private job notes")).toBeUndefined();
      expect(find("Save private job notes")).toBeUndefined();
      await act(async () => find("Refresh private job notes")!.onPress());
      expect(props.job.refresh).toHaveBeenCalledTimes(1);
      expect(mocks.session).toHaveBeenCalledTimes(1);
      expect(mocks.detail).toHaveBeenCalledTimes(1);
      expect(write).not.toHaveBeenCalled();
    },
  );
  it.each(["guard", "focus", "background", "role", "tenant", "unmount"])(
    "hides newly authorized reader notes and rejects retained refresh after %s",
    async (kind) => {
      await render();
      const oldRefresh = find("Refresh private job notes")!.onPress;
      const refresh = props.job.refresh;
      if (kind === "guard") await render({ isCurrent: () => false });
      if (kind === "focus") {
        await act(async () => mocks.focusCleanup?.());
        mocks.focused = false;
        await render();
      }
      if (kind === "background") await state("background");
      if (kind === "role")
        await render({
          session: {
            ...props.session!,
            user: { ...props.session!.user, role: "dispatcher" },
          },
        });
      if (kind === "tenant")
        await render({
          job: {
            ...props.job,
            detail: { ...props.job.detail!, companyId: 10 },
          },
        });
      if (kind === "unmount") await act(async () => root.render(null));
      await act(async () => oldRefresh());
      expect(container.textContent).not.toContain(
        "Internal Company instruction",
      );
      expect(refresh).not.toHaveBeenCalled();
      expect(mocks.session).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    },
  );
  it.each(["blur/refocus", "background/resume"])(
    "never revives a retained technician callback after %s",
    async (kind) => {
      await render();
      const oldRefresh = find("Refresh private job notes")!.onPress;
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
      await act(async () => oldRefresh());
      expect(props.job.refresh).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(container.textContent).toContain("Internal Company instruction");
    },
  );
});

/** Extract only named declarations into a denied-network, denied-import VM. No backend bootstrap. */
function exactDeclarations(
  relative: string,
  names: string[],
  deps: Record<string, unknown>,
) {
  const path = `/home/ubuntu/hsc-mobile-release-readiness-20261117/backend-source-66141c98/${relative}`;
  const text = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter((statement) =>
    names.includes((statement as ts.FunctionDeclaration).name?.text ?? ""),
  );
  expect(declarations).toHaveLength(names.length);
  const code =
    declarations
      .map((statement) => statement.getText(ast).replace(/^export\s+/, ""))
      .join("\n") + `\nmodule.exports = {${names.join(",")}};`;
  const output = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const deny = () => {
    throw new Error("External backend operation forbidden");
  };
  const sandbox = {
    module: { exports: {} },
    fetch: deny,
    require: deny,
    process: { env: Object.freeze({}) },
    ...deps,
  };
  vm.runInNewContext(output, sandbox, { filename: path, timeout: 2000 });
  return sandbox.module.exports as Record<string, (...args: any[]) => any>;
}
describe("66141 read scope and incomplete manager context — defect evidence, not route success", () => {
  it.each([null, 7, 93])(
    "actual getJob SQL has only tenant/Job scope for technician assignee %s",
    async (assignedUserId) => {
      const context = exactDeclarations(
        "server/companyContext.ts",
        ["technicianScopeSql"],
        {},
      );
      const domain = exactDeclarations(
        "server/domainErrors.ts",
        ["DomainError"],
        {},
      );
      const service = exactDeclarations(
        "server/jobService.ts",
        ["toNumber", "iso", "getJob"],
        {
          ...context,
          ...domain,
          confirmationProjection: () => ({}),
          recurrenceLabelFromParts: () => null,
        },
      );
      const execute = vi
        .fn()
        .mockResolvedValue([
          [
            {
              id: 42,
              company_id: 9,
              assigned_user_id: assignedUserId,
              internal_notes: "Private exact-source fixture",
            },
          ],
          [],
        ]);
      const detail = await service.getJob(
        { execute },
        { companyId: 9, userId: 7, role: "technician" },
        42,
      );
      expect(execute).toHaveBeenCalledTimes(1);
      const [sql, params] = execute.mock.calls[0];
      expect(sql).toContain("WHERE j.id = ? AND j.company_id = ?");
      expect(sql).not.toContain("AND j.assigned_user_id = ?");
      expect(params).toEqual([42, 9]);
      expect(detail.internal_notes).toBe("Private exact-source fixture");
    },
  );
  it.each(["owner", "dispatcher"])(
    "actual updateJobNotes with handler-shaped incomplete %s context throws before any SQL",
    async (role) => {
      const context = exactDeclarations(
        "server/companyContext.ts",
        ["requireManager"],
        {},
      );
      const denied = vi.fn(() => {
        throw new Error("Unexpected collaborator reached");
      });
      const service = exactDeclarations(
        "server/jobService.ts",
        ["updateJobNotes"],
        {
          ...context,
          requireOwnedJob: denied,
          insertJobEvent: denied,
          writeCompanyAuditLog: denied,
        },
      );
      const execute = vi.fn();
      await expect(
        service.updateJobNotes(
          { execute },
          { companyId: 9, userId: 7, role, name: "Offline actor" },
          { jobId: 42, privateNotes: "Not committed" },
        ),
      ).rejects.toThrow(/canManageJobs/);
      expect(execute).not.toHaveBeenCalled();
      expect(denied).not.toHaveBeenCalled();
    },
  );
});
