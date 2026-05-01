/**
 * Dashboard → Settings page
 * ─────────────────────────
 * Read-only control center showing admin access, attribution config,
 * platform billing status, feature flags, and live data counts.
 * Secrets are NEVER exposed — only presence flags / masked values.
 */

import { useState, type ReactNode } from "react";
import { useQuery }  from "@tanstack/react-query";
import { setAppMode, clearAppModeOverride } from "../lib/host";
import { Check, X, AlertCircle, Copy, CheckCheck } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppsflyerSummary {
  oneLinkConfigured: boolean;
  apiConfigured: boolean;
  oneLinkDomain: string | null;
  oneLinkTemplateId: string | null;
  hasDevKey: boolean;
  hasIosAppId: boolean;
  hasAndroidAppId: boolean;
}

interface SettingsData {
  admin: {
    adminEmails: string[];
    environment: "production" | "staging" | "development";
    appBaseUrl: string;
  };
  attribution: {
    webAttributionEnabled: boolean;
    appsflyer: AppsflyerSummary;
    smartLinkDomain: string | null;
    branchConfigured: boolean;
    branchEnabled: boolean;
  };
  platforms: {
    stripeConfigured: boolean;
    appleIapConfigured: boolean;
    googlePlayConfigured: boolean;
    appsflyerOneLinkConfigured: boolean;
  };
  featureFlags: {
    accountDeletionEnabled: boolean;
    selfDeleteAllowed: boolean;
    branchEnabled: boolean;
    appsflyerEnabled: boolean;
    smartLinksEnabled: boolean;
  };
  dataStats: {
    totalSubscribers: number;
    totalCampaigns: number;
    totalMobileEvents: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ ok, labelOk = "Configured", labelNo = "Not configured" }: {
  ok: boolean; labelOk?: string; labelNo?: string;
}) {
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700">
        <Check className="w-3 h-3" /> {labelOk}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">
      <X className="w-3 h-3" /> {labelNo}
    </span>
  );
}

function FeatureBadge({ on, labelOn = "Enabled", labelOff = "Disabled" }: {
  on: boolean; labelOn?: string; labelOff?: string;
}) {
  if (on) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700">
        <Check className="w-3 h-3" /> {labelOn}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-400">
      <X className="w-3 h-3" /> {labelOff}
    </span>
  );
}

function EnvBadge({ env }: { env: "production" | "staging" | "development" }) {
  const config = {
    production:  { cls: "bg-red-50 border-red-200 text-red-700",    label: "Production"  },
    staging:     { cls: "bg-amber-50 border-amber-200 text-amber-700", label: "Staging"  },
    development: { cls: "bg-blue-50 border-blue-200 text-blue-700",  label: "Development" },
  }[env];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${config.cls}`}>
      {config.label}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500 shrink-0 min-w-[180px]">{label}</span>
      <div className="text-sm text-slate-900 text-right flex-1 flex justify-end flex-wrap gap-1">
        {children}
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); } catch { /* ignore */ }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="ml-1.5 text-slate-400 hover:text-slate-600 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <CheckCheck className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function SectionCard({ title, subtitle, children }: {
  title: string; subtitle?: string; children: ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="divide-y divide-slate-50">
        {children}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-xl p-5 animate-pulse h-40" />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Settings({ email }: { email: string | null }) {
  const { data, isLoading, error } = useQuery<SettingsData>({
    queryKey: ["/api/admin/dashboard/settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dashboard/settings", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Dashboard configuration, platform status, and feature flags. Read-only — secrets are never shown.
        </p>
      </header>

      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-center gap-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Failed to load settings. {String(error)}
        </div>
      ) : data ? (
        <>
          {/* 1. Admin access */}
          <SectionCard
            title="Admin access"
            subtitle="Who can access this dashboard and what environment it's running in."
          >
            <Row label="Signed in as">
              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{email ?? "—"}</span>
            </Row>
            <Row label="Admin emails">
              {data.admin.adminEmails.length > 0 ? (
                <div className="flex flex-wrap gap-1 justify-end">
                  {data.admin.adminEmails.map((e) => (
                    <span key={e} className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{e}</span>
                  ))}
                </div>
              ) : (
                <span className="text-slate-400 text-xs">DASHBOARD_ADMIN_EMAILS not set</span>
              )}
            </Row>
            <Row label="Environment">
              <EnvBadge env={data.admin.environment} />
            </Row>
            <Row label="App base URL">
              {data.admin.appBaseUrl ? (
                <span className="flex items-center font-mono text-xs text-slate-700">
                  {data.admin.appBaseUrl}
                  <CopyButton value={data.admin.appBaseUrl} />
                </span>
              ) : (
                <span className="text-slate-400 text-xs">APP_PUBLIC_BASE_URL / APP_BASE_URL not set</span>
              )}
            </Row>
          </SectionCard>

          {/* 2. Attribution settings */}
          <SectionCard
            title="Attribution"
            subtitle="First-touch attribution system — web and mobile deep links."
          >
            <Row label="Web attribution">
              <FeatureBadge on={data.attribution.webAttributionEnabled} labelOn="Enabled (always on)" />
            </Row>
            <Row label="Attribution window">
              <span className="text-slate-700">90 days (first-touch wins)</span>
            </Row>
            <Row label="AppsFlyer OneLink domain">
              {data.attribution.appsflyer.oneLinkDomain ? (
                <span className="font-mono text-xs text-slate-700">{data.attribution.appsflyer.oneLinkDomain}</span>
              ) : (
                <span className="text-slate-400 text-xs">APPSFLYER_ONELINK_DOMAIN not set</span>
              )}
            </Row>
            <Row label="AppsFlyer template ID">
              {data.attribution.appsflyer.oneLinkTemplateId ? (
                <span className="font-mono text-xs text-slate-700">{data.attribution.appsflyer.oneLinkTemplateId}</span>
              ) : (
                <span className="text-slate-400 text-xs">APPSFLYER_ONELINK_TEMPLATE_ID not set</span>
              )}
            </Row>
            <Row label="AppsFlyer API token">
              <StatusBadge ok={data.attribution.appsflyer.apiConfigured} labelOk="Configured" labelNo="Not configured" />
            </Row>
            <Row label="AppsFlyer dev key">
              <StatusBadge ok={data.attribution.appsflyer.hasDevKey} />
            </Row>
            <Row label="AppsFlyer iOS app ID">
              <StatusBadge ok={data.attribution.appsflyer.hasIosAppId} />
            </Row>
            <Row label="AppsFlyer Android app ID">
              <StatusBadge ok={data.attribution.appsflyer.hasAndroidAppId} />
            </Row>
            <Row label="Smart link domain">
              {data.attribution.smartLinkDomain ? (
                <span className="font-mono text-xs text-slate-700">{data.attribution.smartLinkDomain}</span>
              ) : (
                <span className="text-slate-400 text-xs">SMART_LINK_DOMAIN not set</span>
              )}
            </Row>
            <Row label="Branch.io">
              <StatusBadge ok={data.attribution.branchConfigured} />
            </Row>
          </SectionCard>

          {/* 3. Platform billing */}
          <SectionCard
            title="Platform billing"
            subtitle="Subscription payment processors. Secrets are never shown — only yes/no status."
          >
            <Row label="Stripe">
              <StatusBadge ok={data.platforms.stripeConfigured} />
            </Row>
            <Row label="Apple IAP (APNS)">
              <StatusBadge ok={data.platforms.appleIapConfigured} />
            </Row>
            <Row label="Google Play billing">
              <StatusBadge ok={data.platforms.googlePlayConfigured} />
            </Row>
            <Row label="AppsFlyer OneLink">
              <StatusBadge ok={data.platforms.appsflyerOneLinkConfigured} />
            </Row>
          </SectionCard>

          {/* 4. Feature flags */}
          <SectionCard
            title="Feature flags"
            subtitle="Environment-controlled flags. Change via environment variables — no UI toggle."
          >
            <Row label="Account deletion">
              <FeatureBadge
                on={data.featureFlags.accountDeletionEnabled}
                labelOn="Enabled (ALLOW_DASHBOARD_ACCOUNT_DELETION=true)"
                labelOff="Disabled"
              />
            </Row>
            <Row label="Self-delete allowed">
              <FeatureBadge
                on={data.featureFlags.selfDeleteAllowed}
                labelOn="Enabled (ALLOW_SELF_ACCOUNT_DELETE=true)"
                labelOff="Disabled"
              />
            </Row>
            <Row label="Branch.io integration">
              <FeatureBadge
                on={data.featureFlags.branchEnabled}
                labelOn="Enabled (BRANCH_INTEGRATION_ENABLED=true)"
                labelOff="Disabled"
              />
            </Row>
            <Row label="AppsFlyer OneLink">
              <FeatureBadge on={data.featureFlags.appsflyerEnabled} />
            </Row>
            <Row label="Smart links">
              <FeatureBadge on={data.featureFlags.smartLinksEnabled} />
            </Row>
          </SectionCard>

          {/* 5. Data stats */}
          <SectionCard
            title="Data"
            subtitle="Live counts from growth_subscribers, growth_campaigns, and growth_mobile_events."
          >
            <Row label="Total subscribers">
              <span className="font-semibold tabular-nums">{data.dataStats.totalSubscribers.toLocaleString()}</span>
            </Row>
            <Row label="Total campaigns">
              <span className="font-semibold tabular-nums">{data.dataStats.totalCampaigns.toLocaleString()}</span>
            </Row>
            <Row label="Mobile attribution events">
              <span className="font-semibold tabular-nums">{data.dataStats.totalMobileEvents.toLocaleString()}</span>
            </Row>
          </SectionCard>

          {/* 6. Danger zone — only if deletion is enabled */}
          {data.featureFlags.accountDeletionEnabled && (
            <section className="bg-red-50 border border-red-200 rounded-xl p-5">
              <h2 className="font-semibold text-red-800 mb-2">Danger zone</h2>
              <p className="text-sm text-red-700">
                Account deletion is enabled in this environment. You can permanently delete company accounts
                from the <span className="font-medium">Accounts</span> page — use with care.
                This action cannot be undone.
              </p>
              <p className="text-xs text-red-500 mt-2">
                Set <code className="bg-red-100 px-1 rounded">ALLOW_DASHBOARD_ACCOUNT_DELETION=false</code> to disable.
              </p>
            </section>
          )}
        </>
      ) : null}

      {/* App switcher — always visible */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-semibold text-slate-900 mb-1">App switcher</h2>
        <p className="text-sm text-slate-500 mb-3">
          Override the local app mode — useful for development on localhost.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setAppMode("customer"); window.location.assign("/"); }}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
            data-testid="btn-switch-to-customer"
          >
            Switch to customer app
          </button>
          <button
            type="button"
            onClick={() => { clearAppModeOverride(); window.location.reload(); }}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
            data-testid="btn-clear-override"
          >
            Clear local override
          </button>
        </div>
      </section>
    </div>
  );
}
