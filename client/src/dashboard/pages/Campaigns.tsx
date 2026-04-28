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
import { Copy, Pencil, Plus, Power, ExternalLink, Smartphone, RefreshCw, Link2 } from "lucide-react";
import type { GrowthCampaign } from "@shared/schema";
import {
  GROWTH_SOURCE_TYPES,
  GROWTH_SOURCE_LABELS,
  type GrowthSourceType,
} from "@shared/growthSources";

interface CampaignWithMetrics extends GrowthCampaign {
  signups: number;
  paid: number;
  mrr: number;
  mobileClicks: number;
  mobileInstalls: number;
  mobileOpens: number;
}

// Branch-config probe shape — matches getBranchPublicConfigSummary() server-side.
interface BranchConfigSummary {
  enabled: boolean;
  hasKey: boolean;
  hasDomain: boolean;
  hasIosFallback: boolean;
  hasAndroidFallback: boolean;
  hasWebhookSecret: boolean;
}

// Smart-link config probe shape — matches getSmartLinkPublicConfig() server-side.
interface SmartLinkConfigSummary {
  smartLinkDomain: string | null;
  webBaseUrl: string;
  hasAppStoreUrl: boolean;
  hasPlayStoreUrl: boolean;
  knownHosts: string[];
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

// ── Smart-link generation (custom branded redirector) ────────────────────────
//
// Format: https://<smartLinkDomain>/<referralCode>
//
// Hostname precedence (mirrors customerOriginForTrackingLink so prod/staging
// can never get crossed up):
//   1. staging-dashboard.ecologicc.com → staging-go.ecologicc.com
//   2. dashboard.ecologicc.com         → go.ecologicc.com
//   3. Server-provided smartLinkDomain (env var SMART_LINK_DOMAIN)
//   4. Same-origin path-style fallback `<origin>/go/<code>` (Replit preview).
function smartLinkOriginForDashboard(serverDomain: string | null | undefined): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (/^staging-dashboard\.ecologicc\.com$/i.test(host)) {
      return "https://staging-go.ecologicc.com";
    }
    if (/^dashboard\.ecologicc\.com$/i.test(host)) {
      return "https://go.ecologicc.com";
    }
  }
  if (serverDomain && serverDomain.trim()) {
    return `https://${serverDomain.trim()}`;
  }
  if (typeof window !== "undefined") {
    return window.location.origin; // path-style fallback (will append /go/...)
  }
  return "https://staging-go.ecologicc.com";
}

function buildSmartLink(opts: {
  referralCode: string | null;
  serverDomain: string | null | undefined;
}): string | null {
  if (!opts.referralCode) return null;
  const code = opts.referralCode.trim().toLowerCase();
  if (!code) return null;
  const origin = smartLinkOriginForDashboard(opts.serverDomain);
  // If origin matches a "real" smart-link host (DNS configured), use the
  // bare `/<code>` form. Otherwise use the path-style `/go/<code>` form so
  // it works on Replit preview without DNS.
  const isSmartHost = /\bgo\.ecologicc\.com$/i.test(origin) || /\bstaging-go\.ecologicc\.com$/i.test(origin);
  return isSmartHost ? `${origin}/${code}` : `${origin}/go/${code}`;
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
  // Branch.io: opt-in toggle. The Branch link itself is generated by clicking
  // a separate button in the row — flipping this on by itself does NOT call
  // Branch (no implicit network calls during a normal save).
  mobileTrackingEnabled: boolean;
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
    mobileTrackingEnabled: false,
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
    mobileTrackingEnabled: Boolean((c as any).mobileTrackingEnabled),
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
    mobileTrackingEnabled: !!f.mobileTrackingEnabled,
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

  // Branch.io: probe server-side config so we can show a helpful disabled
  // state on the mobile-link buttons when env vars are missing. Failures here
  // are non-fatal — we silently degrade to "Branch not configured" text.
  const { data: branchConfig } = useQuery<BranchConfigSummary>({
    queryKey: ["/api/admin/dashboard/branch/config"],
  });
  const branchReady = !!(branchConfig?.enabled && branchConfig?.hasKey);
  // When Branch is not enabled (the default since we paused that integration),
  // the entire Branch UI surface — toggle in form, mobile column, mobile-link
  // buttons — is hidden so it never confuses admins. This flips back on as
  // soon as BRANCH_INTEGRATION_ENABLED=true.
  const branchUiVisible = !!branchConfig?.enabled;

  // Smart-link config — feeds the Smart link column. Always-on; this is the
  // primary mobile attribution path going forward.
  const { data: smartLinkConfig } = useQuery<SmartLinkConfigSummary>({
    queryKey: ["/api/admin/dashboard/smart-link/config"],
  });

  // Track which row is currently regenerating its Branch link so we can show
  // a per-row spinner (multiple in flight is allowed but rare in practice).
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const regenerateBranchLinkMutation = useMutation({
    mutationFn: async (campaignId: number) => {
      setRegeneratingId(campaignId);
      const res = await apiRequest(
        "POST",
        `/api/admin/dashboard/campaigns/${campaignId}/branch-link`,
        {},
      );
      const json = await res.json();
      console.log("[dashboard-campaigns] branch-link response", { status: res.status, body: json });
      return json;
    },
    onSuccess: (json: any) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/dashboard/campaigns"] });
      const url = json?.campaign?.branchLinkUrl;
      toast({
        title: "Mobile link generated",
        description: url ? `Branch link: ${url}` : "Branch link saved.",
      });
    },
    onError: async (err: any) => {
      const raw = (err?.message || "Failed to generate mobile link").toString();
      console.error("[dashboard-campaigns] branch-link error", raw);
      let title = "Could not generate mobile link";
      let description = raw;
      if (/^503:/.test(raw)) {
        title = "Branch is not configured";
        description = "Set the Branch env vars in staging before generating mobile links.";
      } else if (/^400:/.test(raw)) {
        title = "Branch link request rejected";
        // surface the JSON message portion when present
        const match = raw.match(/^400:\s*(.*)$/);
        description = match?.[1] ?? raw;
      }
      toast({ title, description, variant: "destructive" as any });
    },
    onSettled: () => setRegeneratingId(null),
  });

  function onCopyMobileLink(c: CampaignWithMetrics) {
    if (!c.branchLinkUrl) return;
    navigator.clipboard
      .writeText(c.branchLinkUrl)
      .then(() => toast({ title: "Mobile link copied", description: c.branchLinkUrl ?? "" }))
      .catch(() => toast({ title: "Copy failed", description: c.branchLinkUrl ?? "", variant: "destructive" as any }));
  }

  function onCopySmartLink(_c: CampaignWithMetrics, smartLink: string) {
    navigator.clipboard
      .writeText(smartLink)
      .then(() => toast({ title: "Smart link copied", description: smartLink }))
      .catch(() => toast({ title: "Copy failed", description: smartLink, variant: "destructive" as any }));
  }

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
            showBranchToggle={branchUiVisible}
            smartLinkDomain={smartLinkConfig?.smartLinkDomain ?? null}
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
                  <th
                    className="text-right px-4 py-3"
                    title="Clicks on the smart link (go.ecologicc.com/<code>)"
                  >
                    Clicks
                  </th>
                  <th className="text-right px-4 py-3">Signups</th>
                  <th
                    className="text-right px-4 py-3"
                    title="Subscribers with subscription_status = active"
                  >
                    Paid
                  </th>
                  <th
                    className="text-right px-4 py-3"
                    title="Sum of monthly_revenue across active subscribers"
                  >
                    MRR
                  </th>
                  {branchUiVisible ? (
                    <th
                      className="text-right px-4 py-3"
                      title="Mobile clicks / installs / opens (Branch — disabled by default)"
                    >
                      Mobile
                    </th>
                  ) : null}
                  <th className="text-right px-4 py-3">Cost</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const link = c.referralCode
                    ? buildTrackingLink({ sourceType: c.sourceType as string, referralCode: c.referralCode })
                    : null;
                  const smartLink = buildSmartLink({
                    referralCode: c.referralCode,
                    serverDomain: smartLinkConfig?.smartLinkDomain,
                  });
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
                      <td
                        className="px-4 py-3 text-right text-slate-600 tabular-nums"
                        title="Smart-link clicks (growth_mobile_events.event_type=click)"
                      >
                        {c.mobileClicks}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.signups}</td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {c.paid}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {c.mrr > 0 ? `$${c.mrr.toFixed(0)}` : "—"}
                      </td>
                      {branchUiVisible ? (
                        <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                          {c.mobileTrackingEnabled ? (
                            <span title="Clicks · Installs · Opens (Branch)">
                              {c.mobileClicks} · {c.mobileInstalls} · {c.mobileOpens}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      ) : null}
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {c.cost != null ? `$${Number(c.cost).toFixed(0)}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {/* ── Web tracking link ── */}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={!link}
                            onClick={() => onCopyLink(c)}
                            title={link ? `Copy web link: ${link}` : "Add a referral code first"}
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
                              title={`Open web link: ${link}`}
                              data-testid={`open-link-${c.id}`}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          ) : null}
                          {/* ── Smart link (custom branded redirector) ── */}
                          {smartLink ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => onCopySmartLink(c, smartLink)}
                                title={`Copy smart link: ${smartLink}`}
                                data-testid={`copy-smart-link-${c.id}`}
                              >
                                <Link2 className="w-4 h-4 text-emerald-600" />
                              </Button>
                              <a
                                href={smartLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                title={`Open smart link: ${smartLink}`}
                                data-testid={`open-smart-link-${c.id}`}
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </>
                          ) : null}
                          {/* ── Mobile (Branch) link controls — hidden unless Branch is enabled ── */}
                          {branchUiVisible && c.mobileTrackingEnabled ? (
                            c.branchLinkUrl ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => onCopyMobileLink(c)}
                                  title={`Copy Branch link: ${c.branchLinkUrl}`}
                                  data-testid={`copy-mobile-link-${c.id}`}
                                >
                                  <Smartphone className="w-4 h-4 text-emerald-600" />
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => regenerateBranchLinkMutation.mutate(c.id)}
                                  disabled={regeneratingId === c.id || !branchReady}
                                  title={
                                    branchReady
                                      ? "Regenerate Branch link"
                                      : "Branch is not configured on this server"
                                  }
                                  data-testid={`regenerate-mobile-link-${c.id}`}
                                >
                                  <RefreshCw
                                    className={`w-4 h-4 ${regeneratingId === c.id ? "animate-spin" : ""}`}
                                  />
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => regenerateBranchLinkMutation.mutate(c.id)}
                                disabled={
                                  regeneratingId === c.id ||
                                  !branchReady ||
                                  !c.referralCode
                                }
                                title={
                                  !branchReady
                                    ? "Branch is not configured on this server"
                                    : !c.referralCode
                                      ? "Add a referral code first"
                                      : "Generate Branch deep link"
                                }
                                data-testid={`generate-mobile-link-${c.id}`}
                              >
                                <Smartphone
                                  className={`w-4 h-4 text-slate-400 ${regeneratingId === c.id ? "animate-pulse" : ""}`}
                                />
                              </Button>
                            )
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
            showBranchToggle={branchUiVisible}
            smartLinkDomain={smartLinkConfig?.smartLinkDomain ?? null}
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
  showBranchToggle,
  smartLinkDomain,
}: {
  title: string;
  description: string;
  form: CampaignFormState;
  setForm: (next: CampaignFormState) => void;
  onSubmit: () => void;
  submitLabel: string;
  submitting: boolean;
  showBranchToggle: boolean;
  smartLinkDomain: string | null;
}) {
  const previewLink = form.referralCode.trim()
    ? buildTrackingLink({
        sourceType: form.sourceType,
        referralCode: form.referralCode.trim().toLowerCase(),
      })
    : null;
  const previewSmartLink = buildSmartLink({
    referralCode: form.referralCode.trim() || null,
    serverDomain: smartLinkDomain,
  });
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

        {/* ── Branch.io: opt-in mobile install tracking ────────────────────── */}
        {/* Hidden by default since Branch is paused. Re-appears when         */}
        {/* BRANCH_INTEGRATION_ENABLED=true on the server.                    */}
        {showBranchToggle ? (
          <div className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg bg-slate-50">
            <input
              id="campaign-mobile-tracking"
              type="checkbox"
              className="mt-1 h-4 w-4 accent-emerald-600"
              checked={!!form.mobileTrackingEnabled}
              onChange={(e) => setForm({ ...form, mobileTrackingEnabled: e.target.checked })}
              data-testid="campaign-mobile-tracking-toggle"
            />
            <div className="text-xs text-slate-600 leading-snug">
              <Label
                htmlFor="campaign-mobile-tracking"
                className="text-sm font-medium text-slate-800 cursor-pointer"
              >
                Enable mobile install tracking with Branch
              </Label>
              <p className="mt-0.5 text-slate-500">
                When on, you can generate a Branch deep link for this campaign from the row actions.
                Mobile clicks, installs and opens will be recorded once Branch is configured on the server.
              </p>
            </div>
          </div>
        ) : null}

        {(previewLink || previewSmartLink) ? (
          <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 break-all">
            {previewSmartLink ? (
              <div>
                <div className="text-slate-500 mb-1">Smart link preview:</div>
                <a
                  href={previewSmartLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-emerald-700 hover:text-emerald-800 underline-offset-2 hover:underline"
                  data-testid="campaign-smart-link-preview"
                >
                  {previewSmartLink}
                </a>
              </div>
            ) : null}
            {previewLink ? (
              <div>
                <div className="text-slate-500 mb-1">Web link preview:</div>
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
