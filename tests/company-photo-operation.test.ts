import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanyPhotoOperation, type CompanyPhotoOperationApi, type CompanyPhotoOperationState } from "../lib/company-photo-operation";
import { encodeCompanyPhotoDraft, COMPANY_PHOTO_DRAFT_MAX_BYTES, type LocalPhotoDraft } from "../lib/company-photo-draft";
import { canDeleteCompanyPhoto } from "../lib/company-photo-view";
import { JobSyncApiError, type JobSyncNativeSession, type JobSyncCompanyJobDetail } from "../lib/jobsync-mobile-api";
vi.mock("expo-router", () => ({ useIsFocused: () => true }));
vi.mock("expo-file-system/legacy", () => ({ getInfoAsync: vi.fn(), readAsStringAsync: vi.fn(), EncodingType: { Base64: "base64" } }));
const session = (role: "owner" | "dispatcher" | "technician" = "owner"): JobSyncNativeSession => ({ token: "fixture-operation-token", portal: "company", user: { id: 42, role, name: "Fixture", email: null, calendarEligible: false }, company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } });
const photo = { id: 7, imageUrl: "https://fixture.invalid/manus-storage/photo?expires=300&signature=fixture", caption: null, uploadedByUserId: 42, createdAt: null };
const detail = (photos = [photo], assignedUserId: number | null = 42) => ({ id: 12, companyId: 9, status: "scheduled", assignedUserId, photos, persistedPhotoIds: photos.map((photo) => photo.id) }) as JobSyncCompanyJobDetail;
const draft: LocalPhotoDraft = { uri: "file:///fixture/a photo.jpg", mimeType: "image/jpeg", size: 512 };
const bytes = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(509)]).toString("base64");
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; }
function setup(actor = session()) {
  let current = true;
  const states: CompanyPhotoOperationState[] = [];
  const api = { session: vi.fn().mockResolvedValue(actor), detail: vi.fn().mockResolvedValue(detail()), upload: vi.fn().mockResolvedValue({ photo }), remove: vi.fn().mockResolvedValue({ success: true }) };
  const refresh = vi.fn().mockResolvedValue(undefined);
  const encode = vi.fn().mockResolvedValue({ contentType: "image/jpeg", base64: bytes });
  const operation = createCompanyPhotoOperation({ session: actor, jobId: 12, api: api as CompanyPhotoOperationApi, isCurrent: () => current, onState: (state) => states.push(state), onRefresh: refresh, encode });
  return { api, operation, states, refresh, encode, cancel: () => { current = false; }, last: () => states.at(-1)! };
}
beforeEach(() => vi.restoreAllMocks());
describe("actual prepared file byte validation", () => {
  it.each(["image/jpeg", "image/png", "image/webp"] as const)("encodes actual readable %s bytes", async (mimeType) => {
    const buffer = Buffer.alloc(512);
    if (mimeType === "image/jpeg") Buffer.from([255,216,255]).copy(buffer);
    if (mimeType === "image/png") Buffer.from([137,80,78,71,13,10,26,10]).copy(buffer);
    if (mimeType === "image/webp") { buffer.write("RIFF",0); buffer.write("WEBP",8); }
    const getInfo=vi.fn().mockResolvedValue({ exists:true,isDirectory:false,size:512 });
    const read=vi.fn().mockResolvedValue(buffer.toString("base64"));
    await expect(encodeCompanyPhotoDraft({ ...draft,mimeType },getInfo,read)).resolves.toEqual({contentType:mimeType,base64:buffer.toString("base64")});
    expect(read).toHaveBeenCalledWith(draft.uri);
  });
  it.each(["", "!!!!AAAAAAAAAAAA", "data:image/jpeg;base64,"+bytes, bytes+"\n", "AAAA-_AAAAAAAAAA"])("rejects unreadable/noncanonical payload %#", async (payload) => {
    await expect(encodeCompanyPhotoDraft(draft,vi.fn().mockResolvedValue({exists:true,isDirectory:false,size:512}),vi.fn().mockResolvedValue(payload))).rejects.toThrow();
  });
  it("rejects MIME signature mismatch and changed actual byte size", async () => {
    const info=vi.fn().mockResolvedValue({exists:true,isDirectory:false,size:512});
    await expect(encodeCompanyPhotoDraft({...draft,mimeType:"image/png"},info,vi.fn().mockResolvedValue(bytes))).rejects.toThrow("bytes do not match");
    await expect(encodeCompanyPhotoDraft(draft,info,vi.fn().mockResolvedValue(Buffer.alloc(511).toString("base64")))).rejects.toThrow("changed after selection");
  });
  it("accepts exact decoded 15 MiB and rejects one byte over even when base64 schema length fits", async () => {
    const buffer=Buffer.alloc(COMPANY_PHOTO_DRAFT_MAX_BYTES); Buffer.from([255,216,255]).copy(buffer);
    const info=vi.fn().mockResolvedValue({exists:true,isDirectory:false,size:buffer.length});
    await expect(encodeCompanyPhotoDraft({...draft,size:buffer.length},info,vi.fn().mockResolvedValue(buffer.toString("base64")))).resolves.toMatchObject({contentType:"image/jpeg"});
    const over=Buffer.concat([buffer,Buffer.alloc(1)]);
    await expect(encodeCompanyPhotoDraft({...draft,size:buffer.length},info,vi.fn().mockResolvedValue(over.toString("base64")))).rejects.toThrow("15 MiB");
  });
  it("sanitizes filesystem encoding exceptions", async () => {
    await expect(encodeCompanyPhotoDraft(draft,vi.fn().mockResolvedValue({exists:true,isDirectory:false,size:512}),vi.fn().mockRejectedValue(new Error("private path/token")))).rejects.toThrow("Could not read this local photo");
  });
});
describe("finite signed upload/remove operations", () => {
  it("requires acknowledged upload ID in fresh detail and does not append an acknowledgement", async () => {
    const s=setup(); const initial=detail([]); s.api.detail.mockResolvedValueOnce(initial).mockResolvedValueOnce(detail());
    expect(await s.operation.upload(draft)).toBe(true);
    expect(s.api.upload).toHaveBeenCalledTimes(1);
    expect(s.api.upload).toHaveBeenCalledWith(session().token,12,{contentType:"image/jpeg",base64:bytes});
    expect(s.api.session).toHaveBeenCalledTimes(2);
    expect(s.api.detail).toHaveBeenCalledTimes(2);
    expect(initial.photos).toEqual([]);
    expect(s.last().message).toContain("confirmed by fresh");
  });
  it("does not equate resolved caller refresh with successful reload", async () => {
    const s=setup(); s.api.detail.mockResolvedValueOnce(detail([])).mockRejectedValue(new Error("read denied"));
    expect(await s.operation.upload(draft)).toBe(false);
    expect(s.last().message).toBeNull();
    expect(s.last().error).toContain("confirmation failed");
    expect(s.api.upload).toHaveBeenCalledTimes(1);
  });
  it("acknowledged upload missing from canonical gallery is not success", async () => {
    const s=setup(); s.api.detail.mockResolvedValue(detail([]));
    expect(await s.operation.upload(draft)).toBe(false);
    expect(s.last().error).toContain("does not confirm");
    expect(s.last().detail!.photos).toEqual([]);
  });
  it.each([new JobSyncApiError("A valid Job photo upload request is required.",400,"BAD_REQUEST"),new JobSyncApiError("Timed out",null,"TIMEOUT"),new Error("network lost")])("reconciles ambiguous upload without automatic retry %#", async (error) => {
    const s=setup(); s.api.upload.mockRejectedValue(error);
    expect(await s.operation.upload(draft)).toBe(false);
    expect(s.api.upload).toHaveBeenCalledTimes(1);
    expect(s.api.detail).toHaveBeenCalledTimes(2);
    expect(s.last().detail!.photos).toEqual([photo]);
    expect(s.last().error).toContain("may already have been saved");
    expect(s.last().error).toContain("duplicates are possible");
    expect(s.last().message).toBeNull();
  });
  it.each(["company","user","role","token","assignment","denial"])("does not POST after failed signed preflight %s", async (change) => {
    const s=setup(session("technician")); const actor=session("technician");
    if(change==="company") actor.company!.id=10;
    if(change==="user") actor.user.id=43;
    if(change==="role") actor.user.role="owner";
    if(change==="token") actor.token="other";
    s.api.session.mockResolvedValue(actor);
    if(change==="assignment") s.api.detail.mockResolvedValue(detail([],43));
    if(change==="denial") s.api.session.mockRejectedValue(new JobSyncApiError("denied",403,"FORBIDDEN"));
    expect(await s.operation.upload(draft)).toBe(false);
    expect(s.api.upload).not.toHaveBeenCalled();
    expect(s.last().error).toContain("No photo request was sent");
  });
  it("synchronously blocks duplicate upload and remove taps until readback ends", async () => {
    const s=setup(); const wait=deferred<any>(); s.encode.mockReturnValue(wait.promise);
    const pending=s.operation.upload(draft);
    expect(await s.operation.upload(draft)).toBe(false);
    expect(await s.operation.remove(7)).toBe(false);
    expect(s.encode).toHaveBeenCalledTimes(1);
    wait.resolve({contentType:"image/jpeg",base64:bytes});
    expect(await pending).toBe(true);
    expect(s.api.upload).toHaveBeenCalledTimes(1);
  });
  it.each(["encoding","preflight","sending","readback"])("discards late %s operation after lifecycle cancellation", async (stage) => {
    const s=setup(); const wait=deferred<any>();
    if(stage==="encoding") s.encode.mockReturnValue(wait.promise);
    if(stage==="preflight") s.api.detail.mockReturnValueOnce(wait.promise);
    if(stage==="sending") s.api.upload.mockReturnValue(wait.promise);
    if(stage==="readback") s.api.detail.mockResolvedValueOnce(detail()).mockReturnValueOnce(wait.promise);
    const result=s.operation.upload(draft);
    for(let i=0;i<10;i++) await Promise.resolve();
    const count=s.states.length; s.cancel();
    wait.resolve(stage==="encoding"?{contentType:"image/jpeg",base64:bytes}:stage==="sending"?{photo}:detail());
    expect(await result).toBe(false);
    expect(s.states).toHaveLength(count);
    if(stage==="encoding"||stage==="preflight") expect(s.api.upload).not.toHaveBeenCalled();
    if(stage==="sending") expect(s.refresh).not.toHaveBeenCalled();
  });
  it.each(["owner","dispatcher","technician"] as const)("permits %s with retained photo policy (no field opt-in)", async role => {
    const s=setup(session(role)); s.api.detail.mockResolvedValueOnce(detail([photo],role==="technician"?42:null)).mockResolvedValueOnce(detail([],role==="technician"?42:null));
    expect(await s.operation.remove(7)).toBe(true);
    expect(s.api.remove).toHaveBeenCalledWith(session().token,12,7);
    expect(s.last().message).toContain("absence confirmed");
  });
  it.each([undefined,{}, {success:false}, {success:"true"}])("requires strict delete acknowledgement %# even when readback is absent", async response => {
    const s=setup(); s.api.remove.mockResolvedValue(response); s.api.detail.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail([]));
    expect(await s.operation.remove(7)).toBe(false);
    expect(s.last().error).toContain("absent from the refreshed Job, but this request was not confirmed");
    expect(s.last().message).toBeNull();
    expect(s.api.remove).toHaveBeenCalledTimes(1);
  });
  it("delete acknowledgement while target remains is not confirmed removal", async () => {
    const s=setup(); expect(await s.operation.remove(7)).toBe(false);
    expect(s.last().error).toContain("remains in the refreshed Job");
  });
  it.each([new JobSyncApiError("Job photo not found in this Company.",404,"NOT_FOUND"),new JobSyncApiError("A valid Job photo deletion request is required.",400,"BAD_REQUEST"),new JobSyncApiError("Timed out",null,"TIMEOUT")])("delete failure reconciles absence without false success or retry %#", async error => {
    const s=setup(); s.api.remove.mockRejectedValue(error); s.api.detail.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail([]));
    expect(await s.operation.remove(7)).toBe(false);
    expect(s.last().error).toContain(error.message);
    expect(s.last().error).toContain("request was not confirmed");
    expect(s.api.remove).toHaveBeenCalledTimes(1);
  });
  it("fresh technician assignment AND uploader are required for delete", async () => {
    const s=setup(session("technician")); s.api.detail.mockResolvedValue(detail([{...photo,uploadedByUserId:43}]));
    expect(await s.operation.remove(7)).toBe(false);
    expect(s.api.remove).not.toHaveBeenCalled();
  });
  it.each([null,0,1.5,Number.NaN])("unknown/noncanonical uploader %s never enables delete", uploadedByUserId => {
    expect(canDeleteCompanyPhoto({session:session(),jobId:12,job:{detail:detail([{...photo,uploadedByUserId} as any]),loading:false,pending:false,error:null}},7)).toBe(false);
  });
  it.each([0,-1,1.5,Number.MAX_SAFE_INTEGER+1])("noncanonical photo ID %s never enables delete", id => {
    expect(canDeleteCompanyPhoto({session:session(),jobId:12,job:{detail:detail([{...photo,id}]),loading:false,pending:false,error:null}},id)).toBe(false);
  });
});

describe("complete persisted-photo-ID mutation readback", () => {
  it.each([undefined, null, "[]", [0], [7, 7], [8]])("does not send a mutation when the complete ID list is unverifiable %j", async (persistedPhotoIds) => {
    const s = setup();
    s.api.detail.mockResolvedValue({ ...detail(), persistedPhotoIds } as JobSyncCompanyJobDetail);
    expect(await s.operation.upload(draft)).toBe(false);
    expect(s.api.upload).not.toHaveBeenCalled();
    expect(s.last().error).toContain("No photo request was sent");
  });
  it("does not confirm removal when the persisted target only disappeared from renderable images", async () => {
    const s = setup();
    s.api.detail.mockResolvedValueOnce(detail()).mockResolvedValueOnce({ ...detail([]), persistedPhotoIds: [7] });
    expect(await s.operation.remove(7)).toBe(false);
    expect(s.api.remove).toHaveBeenCalledTimes(1);
    expect(s.last().error).toContain("remains in the refreshed Job");
    expect(s.last().message).toBeNull();
  });
  it("does not report ambiguous removal as absence when a persisted photo has an unusable URL", async () => {
    const s = setup();
    s.api.remove.mockRejectedValue(new Error("response lost"));
    s.api.detail.mockResolvedValueOnce(detail()).mockResolvedValueOnce({ ...detail([]), persistedPhotoIds: [7] });
    expect(await s.operation.remove(7)).toBe(false);
    expect(s.last().error).toContain("still contains this photo");
    expect(s.api.remove).toHaveBeenCalledTimes(1);
  });
});
