/**
 * Dashboard → Subscribers page
 * ────────────────────────────
 * Unified view of every attributed signup with source/campaign/platform/MRR.
 * Revenue and platform stay blank until Stripe/Apple/Google sync wires them up.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GrowthSubscriber } from "@shared/schema";
import { GROWTH_SOURCE_LABELS, type GrowthSourceType } from "@shared/growthSources";

interface SubscriberWithCampaign extends GrowthSubscriber {
  campaignName: string | null;
}

const PLATFORMS = ["unknown", "stripe", "apple", "google", "manual"] as const;
const STATUSES = ["unknown", "trialing", "active", "past_due", "canceled", "expired"] as const;

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(0)}`;
}

function fmtDate(v: Date | string | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return "—";
  }
}

export default function Subscribers() {
  const { data, isLoading } = useQuery<SubscriberWithCampaign[]>({
    queryKey: ["/api/admin/dashboard/subscribers"],
  });

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const campaignOptions = useMemo(() => {
    if (!data) return [] as Array<{ id: string; name: string }>;
    const map = new Map<string, string>();
    for (const s of data) {
      if (s.campaignId != null) {
        const id = String(s.campaignId);
        if (!map.has(id)) map.set(id, s.campaignName ?? `Campaign #${id}`);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter((s) => {
      if (sourceFilter !== "all" && (s.sourceType ?? "") !== sourceFilter) return false;
      if (campaignFilter !== "all" && String(s.campaignId ?? "") !== campaignFilter) return false;
      if (platformFilter !== "all" && s.platform !== platformFilter) return false;
      if (statusFilter !== "all" && s.subscriptionStatus !== statusFilter) return false;
      if (q) {
        const hay = [
          s.companyName ?? "",
          s.ownerEmail ?? "",
          s.referralCode ?? "",
          s.sourceName ?? "",
          s.campaignName ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, search, sourceFilter, campaignFilter, platformFilter, statusFilter]);

  return (
    <div className="space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Subscribers</h1>
        <p className="text-sm text-slate-500 mt-1">
          Unified view of attributed signups across Stripe, Apple, Google Play, and manual entries.
        </p>
      </header>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Label className="text-xs text-slate-500">Search</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Company, email, code…"
            className="h-8 text-sm"
            data-testid="subscribers-search"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Source type</Label>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-44 h-8 text-xs" data-testid="subscribers-source-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {(Object.keys(GROWTH_SOURCE_LABELS) as GrowthSourceType[]).map((s) => (
                <SelectItem key={s} value={s}>{GROWTH_SOURCE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-slate-500">Campaign</Label>
          <Select value={campaignFilter} onValueChange={setCampaignFilter}>
            <SelectTrigger className="w-44 h-8 text-xs" data-testid="subscribers-campaign-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaignOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-slate-500">Platform</Label>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="w-32 h-8 text-xs" data-testid="subscribers-platform-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-slate-500">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 h-8 text-xs" data-testid="subscribers-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="text-xs text-slate-400 ml-auto pb-1">
          {filtered.length} subscriber{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-sm text-slate-500">No subscribers match these filters.</div>
            <div className="text-xs text-slate-400 mt-2">
              Once an attributed signup completes onboarding, it will appear here.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-3">Company</th>
                  <th className="text-left px-4 py-3">Owner email</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Source name</th>
                  <th className="text-left px-4 py-3">Campaign</th>
                  <th className="text-left px-4 py-3">Code</th>
                  <th className="text-left px-4 py-3">Platform</th>
                  <th className="text-left px-4 py-3">Plan</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">MRR</th>
                  <th className="text-left px-4 py-3">Signed up</th>
                  <th className="text-left px-4 py-3">Onboarded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50" data-testid={`subscriber-row-${s.id}`}>
                    <td className="px-4 py-3 font-medium text-slate-900">{s.companyName ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{s.ownerEmail ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {s.sourceType
                        ? GROWTH_SOURCE_LABELS[s.sourceType as GrowthSourceType] ?? s.sourceType
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.sourceName ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{s.campaignName ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {s.referralCode ? s.referralCode.toUpperCase() : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{s.platform}</td>
                    <td className="px-4 py-3 text-slate-500">{s.plan ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{s.subscriptionStatus}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {fmtMoney(s.monthlyRevenue as any)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(s.signupAt as any)}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(s.onboardingCompletedAt as any)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
