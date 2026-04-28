/**
 * Dashboard → Campaigns page
 * ──────────────────────────
 * Full CRUD for marketing campaigns. Admins can:
 *   • View all campaigns + their signup counts
 *   • Create a campaign
 *   • Edit a campaign
 *   • Activate/deactivate a campaign
 *   • Copy the generated tracking link to clipboard
 *
 * Tracking links are generated based on the dashboard hostname:
 *   • staging-dashboard.ecologicc.com → https://staging.ecologicc.com/signup?…
 *   • dashboard.ecologicc.com         → https://app.ecologicc.com/signup?…
 *   • localhost / *.replit.dev        → mirror of current origin (for testing)
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Copy, Pencil, Plus, Power, ExternalLink } from "lucide-react";
import type { GrowthCampaign } from "@shared/schema";
import {
  GROWTH_SOURCE_TYPES,
  GROWTH_SOURCE_LABELS,
  type GrowthSourceType,
} from "@shared/growthSources";

interface CampaignWithMetrics extends GrowthCampaign {
  signups: number;
}

// ── Tracking-link generation ─────────────────────────────────────────────────
//
// Precedence rules (most → least specific):
//   1. Hostname `staging-dashboard.ecologicc.com` → https://staging.ecologicc.com
//   2. Hostname `dashboard.ecologicc.com`         → https://app.ecologicc.com
//   3. VITE_ATTRIBUTION_APP_BASE_URL env var (anything else, e.g. Replit preview)
//   4. Bare `window.location.origin` as a last-resort dev fallback
//
// Staging env var to set:   VITE_ATTRIBUTION_APP_BASE_URL=https://staging.ecologicc.com
// Production env var later: VITE_ATTRIBUTION_APP_BASE_URL=https://app.ecologicc.com
function normalizeBaseUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim().replace(/\/+$/, ""); // strip trailing slashes
  if (!/^https?:\/\//i.test(trimmed)) return null; // require explicit scheme
  return trimmed;
}

function customerOriginForTrackingLink(): string {
  if (typeof window === "undefined") return "https://app.ecologicc.com";
  const host = window.location.hostname;
  // 1 + 2: known dashboard hostnames win unconditionally — these are the
  // single source of truth for prod/staging splits and must not be overridable
  // by an env var, since flipping the var on staging-dashboard would otherwise
  // start handing out prod links from the staging UI.
  if (/^staging-dashboard\.ecologicc\.com$/i.test(host)) {
    return "https://staging.ecologicc.com";
  }
  if (/^dashboard\.ecologicc\.com$/i.test(host)) {
    return "https://app.ecologicc.com";
  }
  // 3: explicit env override for any other host (Replit preview, local dev).
  const fromEnv = normalizeBaseUrl(import.meta.env.VITE_ATTRIBUTION_APP_BASE_URL);
  if (fromEnv) return fromEnv;
  // 4: dev fallback — same-origin so manual testing still works without setup.
  return window.location.origin;
}

function buildTrackingLink(c: { sourceType: string; referralCode: string | null }): string {
  const origin = customerOriginForTrackingLink();
  const params = new URLSearchParams();
  params.set("source", c.sourceType);
  if (c.referralCode) params.set("ref", c.referralCode);
  return `${origin}/signup?${params.toString()}`;
}

// ── Form state ───────────────────────────────────────────────────────────────
interface CampaignFormState {
  name: string;
  sourceType: GrowthSourceType;
  sourceName: string;
  referralCode: string;
  cost: string;
  notes: string;
  status: "active" | "inactive";
}

function emptyForm(): CampaignFormState {
  return {
    name: "",
    sourceType: "instagram_creator",
    sourceName: "",
    referralCode: "",
    cost: "",
    notes: "",
    status: "active",
  };
}

function fromCampaign(c: GrowthCampaign): CampaignFormState {
  return {
    name: c.name ?? "",
    sourceType: (c.sourceType as GrowthSourceType) ?? "other",
    sourceName: c.sourceName ?? "",
    referralCode: (c.referralCode ?? "").toUpperCase(),
    cost: c.cost != null ? String(c.cost) : "",
    notes: c.notes ?? "",
    status: (c.status as "active" | "inactive") ?? "active",
  };
}

function formToPayload(f: CampaignFormState) {
  const payload: Record<string, any> = {
    name: f.name.trim(),
    sourceType: f.sourceType,
    sourceName: f.sourceName.trim() || null,
    referralCode: f.referralCode.trim().toLowerCase() || null,
    notes: f.notes.trim() || null,
    status: f.status,
  };
  const costTrim = f.cost.trim();
  if (costTrim === "") {
    payload.cost = null;
  } else {
    const parsed = Number(costTrim);
    if (Number.isFinite(parsed) && parsed >= 0) {
      payload.cost = parsed.toFixed(2);
    } else {
      payload.cost = null;
    }
  }
  // tracking URL is derived in the UI; not stored, but we save it for reference.
  if (payload.referralCode) {
    payload.trackingUrl = buildTrackingLink({
      sourceType: payload.sourceType,
      referralCode: payload.referralCode,
    });
  } else {
    payload.trackingUrl = null;
  }
  return payload;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Campaigns() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<CampaignWithMetrics[]>({
    queryKey: ["/api/admin/dashboard/campaigns"],
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<GrowthCampaign | null>(null);
  const [createForm, setCreateForm] = useState<CampaignFormState>(emptyForm());
  const [editForm, setEditForm] = useState<CampaignFormState>(emptyForm());
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const createMutation = useMutation({
    mutationFn: async (form: CampaignFormState) => {
      const payload = formToPayload(form);
      console.log("[dashboard-campaigns] create payload", payload);
      const res = await apiRequest("POST", "/api/admin/dashboard/campaigns", payload);
      const json = await res.json();
      console.log("[dashboard-campaigns] create response", { status: res.status, body: json });
      return json;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/dashboard/campaigns"] });
      setCreateOpen(false);
      setCreateForm(emptyForm());
      toast({ title: "Campaign created", description: row?.name ? `“${row.name}” is live.` : undefined });
    },
    onError: async (err: any) => {
      const raw = (err?.message || "Failed to create campaign").toString();
      console.error("[dashboard-campaigns] create error", raw);
      let title = "Could not create campaign";
      let description = raw;
      // apiRequest throws messages of the form "STATUS: BODY".
      if (/^403:/.test(raw)) {
        title = "Permission denied";
        description = "You do not have permission to create campaigns.";
      } else if (/^401:/.test(raw)) {
        title = "Not signed in";
        description = "Your session has ended — please sign in again.";
      } else if (/DUPLICATE_REFERRAL_CODE|already in use/i.test(raw)) {
        title = "Duplicate referral code";
        description = "That referral code already exists. Pick a different one.";
      } else if (/Validation failed/i.test(raw)) {
        description = "One of the fields is invalid. Check the form and try again.";
      }
      toast({ title, description, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: number; form: CampaignFormState }) => {
      const res = await apiRequest("PATCH", `/api/admin/dashboard/campaigns/${vars.id}`, formToPayload(vars.form));
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/dashboard/campaigns"] });
      setEditing(null);
      toast({ title: "Campaign updated" });
    },
    onError: (err: any) => {
      const msg = (err?.message || "Failed to update campaign").toString();
      toast({ title: "Could not update campaign", description: msg, variant: "destructive" });
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async (c: GrowthCampaign) => {
      const next = c.status === "active" ? "inactive" : "active";
      const res = await apiRequest("PATCH", `/api/admin/dashboard/campaigns/${c.id}`, { status: next });
      return res.json();
    },
    onSuccess: (row: GrowthCampaign) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/dashboard/campaigns"] });
      toast({ title: row.status === "active" ? "Campaign activated" : "Campaign deactivated" });
    },
    onError: (err: any) => {
      toast({ title: "Could not change status", description: err?.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (statusFilter === "all") return data;
    return data.filter((c) => c.status === statusFilter);
  }, [data, statusFilter]);

  const onCopyLink = async (c: GrowthCampaign) => {
    if (!c.referralCode) {
      toast({ title: "No referral code", description: "Add a referral code first.", variant: "destructive" });
      return;
    }
    const link = buildTrackingLink({ sourceType: c.sourceType as string, referralCode: c.referralCode });
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Tracking link copied", description: link });
    } catch {
      toast({ title: "Could not copy", description: link, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Campaigns</h1>
          <p className="text-sm text-slate-500 mt-1">
            Marketing campaigns, supply-house promos, and creator codes. Each campaign generates a
            tracking link that captures attribution when prospects open it.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-campaign-button">
              <Plus className="w-4 h-4 mr-2" /> New Campaign
            </Button>
          </DialogTrigger>
          <CampaignFormDialog
            title="New Campaign"
            description="Create a tracked campaign. The referral code is normalized to lowercase and must be unique."
            form={createForm}
            setForm={setCreateForm}
            onSubmit={() => createMutation.mutate(createForm)}
            submitLabel={createMutation.isPending ? "Creating…" : "Create campaign"}
            submitting={createMutation.isPending}
          />
        </Dialog>
      </header>

      <div className="flex items-center gap-3">
        <Label className="text-xs text-slate-500">Status</Label>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-40 h-8 text-xs" data-testid="campaign-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-400">
          {filtered.length} campaign{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-slate-500">No campaigns to show.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Signups</th>
                  <th className="text-right px-4 py-3">Cost</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const link = c.referralCode
                    ? buildTrackingLink({ sourceType: c.sourceType as string, referralCode: c.referralCode })
                    : null;
                  const statusActive = c.status === "active";
                  return (
                    <tr key={c.id} className="hover:bg-slate-50" data-testid={`campaign-row-${c.id}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        <div>{c.name}</div>
                        {c.sourceName ? (
                          <div className="text-xs text-slate-400 mt-0.5">{c.sourceName}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {GROWTH_SOURCE_LABELS[c.sourceType as GrowthSourceType] ?? c.sourceType}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {c.referralCode ? c.referralCode.toUpperCase() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-full ${
                            statusActive
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-100 text-slate-500 border border-slate-200"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              statusActive ? "bg-emerald-500" : "bg-slate-400"
                            }`}
                          />
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.signups}</td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {c.cost != null ? `$${Number(c.cost).toFixed(0)}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={!link}
                            onClick={() => onCopyLink(c)}
                            title={link ?? "Add a referral code first"}
                            data-testid={`copy-link-${c.id}`}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          {link ? (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center h-8 w-8 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                              title={link}
                              data-testid={`open-link-${c.id}`}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(c);
                              setEditForm(fromCampaign(c));
                            }}
                            data-testid={`edit-campaign-${c.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleStatusMutation.mutate(c)}
                            disabled={toggleStatusMutation.isPending}
                            title={statusActive ? "Deactivate" : "Activate"}
                            data-testid={`toggle-campaign-${c.id}`}
                          >
                            <Power className={`w-4 h-4 ${statusActive ? "text-emerald-600" : "text-slate-400"}`} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        {editing ? (
          <CampaignFormDialog
            title={`Edit: ${editing.name}`}
            description="Update campaign details. Changing the referral code may affect future attribution."
            form={editForm}
            setForm={setEditForm}
            onSubmit={() => updateMutation.mutate({ id: editing.id, form: editForm })}
            submitLabel={updateMutation.isPending ? "Saving…" : "Save changes"}
            submitting={updateMutation.isPending}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

// ── Form dialog component ────────────────────────────────────────────────────
function CampaignFormDialog({
  title,
  description,
  form,
  setForm,
  onSubmit,
  submitLabel,
  submitting,
}: {
  title: string;
  description: string;
  form: CampaignFormState;
  setForm: (next: CampaignFormState) => void;
  onSubmit: () => void;
  submitLabel: string;
  submitting: boolean;
}) {
  const previewLink = form.referralCode.trim()
    ? buildTrackingLink({
        sourceType: form.sourceType,
        referralCode: form.referralCode.trim().toLowerCase(),
      })
    : null;
  const canSubmit = form.name.trim().length > 0 && form.referralCode.trim().length > 0 && !submitting;

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <Label htmlFor="campaign-name">Name</Label>
          <Input
            id="campaign-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Joe Plumbing — March promo"
            data-testid="campaign-name-input"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Source type</Label>
            <Select
              value={form.sourceType}
              onValueChange={(v) => setForm({ ...form, sourceType: v as GrowthSourceType })}
            >
              <SelectTrigger data-testid="campaign-source-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROWTH_SOURCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {GROWTH_SOURCE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v as "active" | "inactive" })}
            >
              <SelectTrigger data-testid="campaign-status-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="campaign-source-name">
            Source name <span className="text-slate-400 font-normal">(optional)</span>
          </Label>
          <Input
            id="campaign-source-name"
            value={form.sourceName}
            onChange={(e) => setForm({ ...form, sourceName: e.target.value })}
            placeholder="e.g. @joeplumbing"
            data-testid="campaign-source-name-input"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="campaign-code">Referral code</Label>
            <Input
              id="campaign-code"
              value={form.referralCode}
              onChange={(e) => setForm({ ...form, referralCode: e.target.value.toUpperCase() })}
              placeholder="JOEPLUMBING"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              data-testid="campaign-code-input"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Stored lowercase; must be unique across all campaigns.
            </p>
          </div>
          <div>
            <Label htmlFor="campaign-cost">
              Cost <span className="text-slate-400 font-normal">(optional)</span>
            </Label>
            <Input
              id="campaign-cost"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              placeholder="500"
              inputMode="decimal"
              data-testid="campaign-cost-input"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="campaign-notes">
            Notes <span className="text-slate-400 font-normal">(optional)</span>
          </Label>
          <Textarea
            id="campaign-notes"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Internal notes about this campaign"
            data-testid="campaign-notes-input"
          />
        </div>

        {previewLink ? (
          <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 break-all">
            <div className="text-slate-500 mb-1">Tracking link preview:</div>
            <a
              href={previewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-slate-800 hover:text-slate-900 underline-offset-2 hover:underline"
            >
              {previewLink}
            </a>
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          data-testid="campaign-submit-button"
        >
          {submitLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
