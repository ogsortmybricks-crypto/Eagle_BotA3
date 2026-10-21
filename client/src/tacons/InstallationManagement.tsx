import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Banner, Modal, Spinner } from "@/components/ui";
import { positionAudience, studioPositionAudience, type Manifest } from "@shared/tacons";
import { accessRules, OPERATIONS, type AccessPolicy, type InstallControls } from "@shared/tacons/contract";
import { PermissionReview } from "./InstallationReview";
import { ConfigurationButton } from "./Configuration";

export type ControlResponse = { manifest: Manifest; controls: InstallControls; versionId: number; settings: Record<string, unknown> };
export function InstallationManagement({ installId }: { installId: number }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery<ControlResponse>({ queryKey: ["tacon-controls", installId], queryFn: () => apiGet(`/tacons/installs/${installId}/controls`) });
  const retry = useMutation({ mutationFn: () => apiPost(`/tacons/installs/${installId}/setup`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["tacon-controls", installId] }); void queryClient.invalidateQueries({ queryKey: ["positions"] }); } });
  return <div className="mt-3 space-y-2">
    {(query.error || retry.error) && <Banner tone="error">{(query.error ?? retry.error)!.message}</Banner>}
    {query.data?.controls.setupResults.map(result => <p key={result.id} className={`text-xs ${result.status === "failed" ? "text-red-700" : "text-gray-600"}`}>Setup {result.status}: {result.message}</p>)}
    <div className="flex flex-wrap gap-2">
      <button className="btn-secondary text-xs" disabled={!query.data} onClick={() => setOpen(true)}>Manage permissions & setup</button>
      <ConfigurationButton installId={installId} />
      {query.data?.controls.setupResults.some(result => result.status === "failed") && <button className="btn-secondary text-xs" onClick={() => retry.mutate()} disabled={retry.isPending}>Retry setup</button>}
    </div>
    {open && query.data && <ControlModal installId={installId} data={query.data} onClose={() => setOpen(false)} />}
  </div>;
}
function ControlModal({ installId, data, onClose }: { installId: number; data: ControlResponse; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [grants, setGrants] = useState(data.controls.grants);
  const [selectedSetup, setSelectedSetup] = useState(data.controls.selectedSetup);
  const [policyText, setPolicyText] = useState<Record<string, string>>(() => Object.fromEntries(OPERATIONS.map(operation => [operation, accessRules(data.manifest, data.controls, operation).join(", ")])));
  const policy = Object.fromEntries(OPERATIONS.map(operation => [operation, policyText[operation].split(",").map(value => value.trim()).filter(Boolean)])) as AccessPolicy;
  const save = useMutation({
    mutationFn: () => apiPatch(`/tacons/installs/${installId}/controls`, { reviewedVersionId: data.versionId, grants, policy, selectedSetup }),
    onSuccess: () => { void queryClient.invalidateQueries({ predicate: query => String(query.queryKey[0]).startsWith("tacon") || query.queryKey[0] === "positions" }); onClose(); },
  });
  const audiences = ["everyone", "none", "admin", "guide", "secretary", "learner", "dev",
    ...data.manifest.positions.map(position => positionAudience(position.name)),
    ...(data.manifest.studioPositions ?? []).map(studioPositionAudience)];
  return <Modal open onClose={onClose} title="Installation permissions & setup" footer={<button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Save & apply reviewed setup</button>}>
    <div className="space-y-4">
      {save.error && <Banner tone="error">{save.error.message}</Banner>}
      <p className="text-xs text-gray-600">Rules use comma-separated audiences. Empty means everyone. Academy admins always retain configuration access so a mistaken rule cannot lock them out.</p>
      <p className="break-words text-xs text-gray-500">Available: {audiences.join(", ")}</p>
      {OPERATIONS.map(operation => <label key={operation} className="block"><span className="label capitalize">{operation} audience</span>
        <input className="input" value={policyText[operation]} placeholder="everyone"
          onChange={event => setPolicyText({ ...policyText, [operation]: event.target.value })} />
      </label>)}
      <PermissionReview manifest={data.manifest} grants={grants} onGrants={setGrants} selectedSetup={selectedSetup} onSetup={setSelectedSetup} policy={policy} />
      <p className="text-xs text-gray-600">Revocation blocks future server operations; it cannot erase data already shown to a browser. Existing record history is kept.</p>
    </div>
  </Modal>;
}
