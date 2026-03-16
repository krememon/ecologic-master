import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Shield, User, Briefcase, CreditCard, Wifi, Terminal, FileText,
  Copy, RefreshCw, ExternalLink, CheckCircle, XCircle, AlertCircle,
  ChevronDown, ChevronRight, Trash2, Download, Bell, Search
} from "lucide-react";

// ─── DEV ALLOWLIST (client-side guard) ─────────────────────────────────────
const DEV_ALLOWLIST = ['pjpell077@gmail.com'];

// ─── FEATURE FLAGS ──────────────────────────────────────────────────────────
const FLAG_STORAGE_KEY = 'ecologic_dev_flags';
const DEFAULT_FLAGS: Record<string, boolean> = {
  forceShowPaymentsDebug: false,
  enableExperimentalUI: false,
  showHiddenRoutes: false,
  bypassNonCriticalAnimations: false,
  showApiLogsPanel: true,
};

function loadFlags(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FLAG_STORAGE_KEY);
    return raw ? { ...DEFAULT_FLAGS, ...JSON.parse(raw) } : { ...DEFAULT_FLAGS };
  } catch { return { ...DEFAULT_FLAGS }; }
}

function saveFlags(flags: Record<string, boolean>) {
  localStorage.setItem(FLAG_STORAGE_KEY, JSON.stringify(flags));
}

// ─── API INSPECTOR LOG ──────────────────────────────────────────────────────
export interface ApiLogEntry {
  id: number;
  method: string;
  route: string;
  status: number | null;
  durationMs: number | null;
  error: string | null;
  ts: number;
}

const apiLog: ApiLogEntry[] = [];
let apiLogCounter = 0;
let interceptorInstalled = false;
const apiLogListeners: Set<() => void> = new Set();

function notifyListeners() {
  apiLogListeners.forEach(fn => fn());
}

function installApiInterceptor() {
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    if (!url.startsWith('/api/')) return origFetch(input, init);
    const id = ++apiLogCounter;
    const start = Date.now();
    const entry: ApiLogEntry = { id, method: method.toUpperCase(), route: url, status: null, durationMs: null, error: null, ts: start };
    apiLog.unshift(entry);
    if (apiLog.length > 25) apiLog.pop();
    notifyListeners();
    try {
      const resp = await origFetch(input, init);
      entry.status = resp.status;
      entry.durationMs = Date.now() - start;
      notifyListeners();
      return resp;
    } catch (e: any) {
      entry.error = e.message;
      entry.durationMs = Date.now() - start;
      notifyListeners();
      throw e;
    }
  };
}

// ─── UTILITY: PRETTY JSON ───────────────────────────────────────────────────
function JsonViewer({ data, label }: { data: unknown; label?: string }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const str = JSON.stringify(data, null, 2);
  const handleCopy = () => {
    navigator.clipboard.writeText(str).then(() => toast({ title: "Copied!", description: "JSON copied to clipboard" }));
  };
  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-sm font-mono text-slate-300 transition-colors"
      >
        <span>{label || "JSON"}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{str.split('\n').length} lines</span>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>
      {open && (
        <div className="relative">
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 z-10 p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
            title="Copy JSON"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <pre className="p-4 text-xs text-slate-300 font-mono overflow-x-auto max-h-80 bg-slate-900 whitespace-pre-wrap break-all">
            {str}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── STATUS BADGE ───────────────────────────────────────────────────────────
function StatusBadge({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <Badge variant="outline" className="text-slate-400 border-slate-600">{label}: checking…</Badge>;
  return ok
    ? <Badge className="bg-emerald-900 text-emerald-300 border-emerald-700">{label}: ✓ active</Badge>
    : <Badge className="bg-slate-800 text-slate-400 border-slate-600">{label}: not configured</Badge>;
}

// ─── CONFIRMATION MODAL ─────────────────────────────────────────────────────
function ConfirmModal({
  open, title, description, onConfirm, onCancel, danger
}: { open: boolean; title: string; description: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="bg-slate-900 border-slate-700">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} className="border-slate-600 text-slate-300 hover:bg-slate-800">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={danger ? "bg-red-600 hover:bg-red-700 text-white" : "bg-teal-600 hover:bg-teal-700 text-white"}
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── CARD WRAPPER ───────────────────────────────────────────────────────────
function DevCard({ title, icon: Icon, children }: { title: string; icon: React.FC<any>; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-700 bg-slate-800/60">
        <Icon className="w-4 h-4 text-teal-400" />
        <h3 className="text-sm font-semibold text-slate-200 tracking-wide uppercase">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── FIELD ROW ──────────────────────────────────────────────────────────────
function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-800 last:border-0">
      <span className="text-xs font-medium text-slate-500 w-36 shrink-0 pt-0.5 uppercase tracking-wide">{label}</span>
      <span className={`text-sm text-slate-200 break-all ${mono ? 'font-mono' : ''}`}>{value ?? <span className="text-slate-600 italic">null</span>}</span>
    </div>
  );
}

// ─── PLATFORM DETECTION ─────────────────────────────────────────────────────
function detectPlatform(): string {
  const ua = navigator.userAgent;
  if ((window as any).Capacitor?.isNativePlatform?.()) return 'native (Capacitor)';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS browser';
  if (/Android/.test(ua)) return 'Android browser';
  return 'web';
}

// ─── SESSION TAB ────────────────────────────────────────────────────────────
function SessionTab() {
  const { user } = useAuth() as { user: any };
  const { toast } = useToast();
  const { data: devMe } = useQuery({ queryKey: ['/api/dev/me'], retry: false });
  const [flags, setFlags] = useState<Record<string, boolean>>(loadFlags);

  const toggleFlag = (key: string) => {
    setFlags(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveFlags(next);
      return next;
    });
  };

  const copySnapshot = () => {
    const snap = {
      timestamp: new Date().toISOString(),
      session: devMe,
      frontendUser: { id: user?.id, email: user?.email, role: user?.role, companyId: user?.companyId },
      platform: detectPlatform(),
      flags,
      url: window.location.href,
      userAgent: navigator.userAgent,
    };
    navigator.clipboard.writeText(JSON.stringify(snap, null, 2))
      .then(() => toast({ title: "Snapshot copied!", description: "Debug snapshot in clipboard" }));
  };

  const flagLabels: Record<string, string> = {
    forceShowPaymentsDebug: "Force Show Payments Debug",
    enableExperimentalUI: "Enable Experimental UI",
    showHiddenRoutes: "Show Hidden Routes",
    bypassNonCriticalAnimations: "Bypass Non-Critical Animations",
    showApiLogsPanel: "Show API Logs Panel",
  };

  return (
    <div className="space-y-5">
      <DevCard title="Account / Session" icon={User}>
        <div className="space-y-0">
          <Field label="User ID" value={(devMe as any)?.userId || user?.id} mono />
          <Field label="Email" value={(devMe as any)?.email || user?.email} mono />
          <Field label="Company ID" value={(devMe as any)?.companyId || user?.companyId} mono />
          <Field label="Role" value={<Badge className="bg-teal-900 text-teal-300 border-teal-700">{(devMe as any)?.role || user?.role}</Badge>} />
          <Field label="Platform" value={<Badge variant="outline" className="border-slate-600 text-slate-300">{detectPlatform()}</Badge>} />
          <Field label="Session ID" value={(devMe as any)?.sessionId} mono />
          <Field label="Session Status" value={user ? <Badge className="bg-emerald-900 text-emerald-300 border-emerald-700">Authenticated</Badge> : <Badge className="bg-red-900 text-red-300 border-red-700">None</Badge>} />
          <Field label="Dev Allowlist" value={<Badge className="bg-violet-900 text-violet-300 border-violet-700">✓ authorized</Badge>} />
        </div>
        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={copySnapshot} className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-1.5">
            <Download className="w-3.5 h-3.5" /> Copy Debug Snapshot
          </Button>
        </div>
      </DevCard>

      <DevCard title="Feature Flags" icon={Shield}>
        <p className="text-xs text-slate-500 mb-4">Stored in localStorage. Affect dev-mode UI only.</p>
        <div className="space-y-3">
          {Object.keys(DEFAULT_FLAGS).map(key => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-200">{flagLabels[key] || key}</p>
                <p className="text-xs text-slate-500 font-mono">{key}</p>
              </div>
              <Switch
                checked={!!flags[key]}
                onCheckedChange={() => toggleFlag(key)}
                className="data-[state=checked]:bg-teal-600"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-slate-700">
          <Button
            size="sm" variant="outline"
            onClick={() => { saveFlags(DEFAULT_FLAGS); setFlags({ ...DEFAULT_FLAGS }); }}
            className="border-slate-600 text-slate-400 hover:bg-slate-800 gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> Reset All Flags
          </Button>
        </div>
      </DevCard>
    </div>
  );
}

// ─── JOB DEBUGGER TAB ───────────────────────────────────────────────────────
function JobDebuggerTab() {
  const [jobId, setJobId] = useState('');
  const [searchId, setSearchId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/dev/job', searchId],
    enabled: searchId !== null,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/dev/job/${searchId}`, { credentials: 'include' });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
      return res.json();
    },
  });

  const search = () => {
    const n = parseInt(jobId.trim());
    if (isNaN(n)) { toast({ title: "Invalid", description: "Enter a valid job ID", variant: "destructive" }); return; }
    setSearchId(n);
  };

  const copyJson = () => {
    if (!data) return;
    navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      .then(() => toast({ title: "Copied!", description: "Job JSON in clipboard" }));
  };

  const job = (data as any)?.job;
  const invoice = (data as any)?.invoice;
  const crew = (data as any)?.crew;

  return (
    <div className="space-y-5">
      <DevCard title="Job Debugger" icon={Briefcase}>
        <div className="flex gap-2 mb-5">
          <Input
            placeholder="Job ID…"
            value={jobId}
            onChange={e => setJobId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            className="bg-slate-800 border-slate-600 text-slate-200 placeholder-slate-500 h-9 w-48"
          />
          <Button size="sm" onClick={search} className="bg-teal-600 hover:bg-teal-700 gap-1.5">
            <Search className="w-3.5 h-3.5" /> Inspect
          </Button>
        </div>

        {isLoading && <p className="text-sm text-slate-400 animate-pulse">Loading…</p>}
        {error && <p className="text-sm text-red-400">Error: {(error as any)?.message || 'Not found'}</p>}

        {job && (
          <div className="space-y-4">
            <div className="space-y-0">
              <Field label="Job ID" value={job.id} mono />
              <Field label="Title" value={job.title} />
              <Field label="Status" value={<Badge variant="outline" className="border-slate-600 text-slate-300">{job.status}</Badge>} />
              <Field label="Company ID" value={job.companyId} mono />
              <Field label="Customer ID" value={job.customerId} mono />
              <Field label="Invoice ID" value={invoice?.id ?? '—'} mono />
              <Field label="Invoice Status" value={invoice?.status ?? '—'} />
              <Field label="Estimate ID" value={job.estimateId ?? '—'} mono />
              <Field label="Referral ID" value={job.referralId ?? '—'} mono />
              <Field label="Crew Members" value={crew?.length ?? 0} />
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={() => navigate(`/jobs/${job.id}`)}
                className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-1.5">
                <ExternalLink className="w-3.5 h-3.5" /> Open Job
              </Button>
              <Button size="sm" variant="outline" onClick={copyJson}
                className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-1.5">
                <Copy className="w-3.5 h-3.5" /> Copy JSON
              </Button>
              <Button size="sm" variant="outline" onClick={() => refetch()}
                className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Refetch
              </Button>
              {invoice && (
                <Button size="sm" variant="outline" onClick={() => navigate(`/jobs/${job.id}/pay/${invoice.id}`)}
                  className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" /> Open Invoice
                </Button>
              )}
            </div>

            <JsonViewer data={data} label="Full Job Debug Payload" />
          </div>
        )}
      </DevCard>
    </div>
  );
}

// ─── PAYMENTS DEBUGGER TAB ──────────────────────────────────────────────────
function PaymentsDebuggerTab() {
  const [jobId, setJobId] = useState('');
  const [searchId, setSearchId] = useState<number | null>(null);
  const [confirmRecompute, setConfirmRecompute] = useState(false);
  const { toast } = useToast();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/dev/payments/job', searchId],
    enabled: searchId !== null,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/dev/payments/job/${searchId}`, { credentials: 'include' });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
      return res.json();
    },
  });

  const recomputeMutation = useMutation({
    mutationFn: async (invoiceId: number) =>
      apiRequest('POST', `/api/dev/recompute/invoice/${invoiceId}`),
    onSuccess: () => {
      toast({ title: "Recomputed!", description: "Invoice totals updated" });
      refetch();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const search = () => {
    const n = parseInt(jobId.trim());
    if (isNaN(n)) { toast({ title: "Invalid", description: "Enter a valid job ID", variant: "destructive" }); return; }
    setSearchId(n);
  };

  const invoice = (data as any)?.invoice;
  const payments = (data as any)?.payments || [];

  return (
    <div className="space-y-5">
      <DevCard title="Payments Debugger" icon={CreditCard}>
        <div className="flex gap-2 mb-5">
          <Input
            placeholder="Job ID…"
            value={jobId}
            onChange={e => setJobId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            className="bg-slate-800 border-slate-600 text-slate-200 placeholder-slate-500 h-9 w-48"
          />
          <Button size="sm" onClick={search} className="bg-teal-600 hover:bg-teal-700 gap-1.5">
            <Search className="w-3.5 h-3.5" /> Inspect
          </Button>
        </div>

        {isLoading && <p className="text-sm text-slate-400 animate-pulse">Loading…</p>}
        {error && <p className="text-sm text-red-400">Not found or error</p>}

        {data && (
          <div className="space-y-4">
            {invoice ? (
              <div className="space-y-0">
                <Field label="Invoice ID" value={invoice.id} mono />
                <Field label="Status" value={<Badge variant="outline" className="border-slate-600 text-slate-300">{invoice.status}</Badge>} />
                <Field label="Total" value={`$${invoice.totalAmount || '0.00'}`} mono />
                <Field label="Balance" value={`$${invoice.balanceDue || '0.00'}`} mono />
                <Field label="Paid" value={`$${invoice.paidAmount || '0.00'}`} mono />
                <Field label="Payments Count" value={payments.length} />
              </div>
            ) : (
              <p className="text-sm text-slate-500 italic">No invoice found for this job</p>
            )}

            {payments.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Payment Records</p>
                {payments.map((p: any) => (
                  <div key={p.id} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 space-y-0">
                    <Field label="Payment ID" value={p.id} mono />
                    <Field label="Method" value={p.paymentMethod} />
                    <Field label="Amount" value={`$${p.amount}`} mono />
                    <Field label="Status" value={p.status} />
                    <Field label="Stripe PI" value={p.stripePaymentIntentId} mono />
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={() => refetch()}
                className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
              {invoice && (
                <Button size="sm" variant="outline" onClick={() => setConfirmRecompute(true)}
                  className="border-amber-700 text-amber-300 hover:bg-amber-950 gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5" /> Recompute Totals
                </Button>
              )}
            </div>

            <JsonViewer data={data} label="Raw Payment Debug Payload" />
          </div>
        )}
      </DevCard>

      <ConfirmModal
        open={confirmRecompute}
        title="Recompute Invoice Totals"
        description={`This will recompute and persist invoice totals for invoice #${invoice?.id} from raw payment records. Safe action — no data is deleted.`}
        onConfirm={() => { setConfirmRecompute(false); if (invoice) recomputeMutation.mutate(invoice.id); }}
        onCancel={() => setConfirmRecompute(false)}
      />
    </div>
  );
}

// ─── INTEGRATIONS TAB ───────────────────────────────────────────────────────
function IntegrationsTab() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/api/dev/integrations/status'],
    retry: false,
  });

  const d = data as any;

  const IntCard = ({ icon: Icon, label, ok, detail }: { icon: React.FC<any>; label: string; ok: boolean | null; detail?: string }) => (
    <div className={`flex items-center gap-3 p-4 rounded-xl border ${ok ? 'border-emerald-700 bg-emerald-950/30' : 'border-slate-700 bg-slate-800/40'}`}>
      <div className={`p-2 rounded-lg ${ok ? 'bg-emerald-900/50' : 'bg-slate-700/50'}`}>
        <Icon className={`w-4 h-4 ${ok ? 'text-emerald-400' : 'text-slate-500'}`} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {detail && <p className="text-xs text-slate-500 font-mono">{detail}</p>}
      </div>
      {ok === null ? (
        <AlertCircle className="w-4 h-4 text-slate-500" />
      ) : ok ? (
        <CheckCircle className="w-4 h-4 text-emerald-400" />
      ) : (
        <XCircle className="w-4 h-4 text-slate-600" />
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <DevCard title="Environment / Integration Status" icon={Wifi}>
        {isLoading && <p className="text-sm text-slate-400 animate-pulse">Checking integrations…</p>}
        {d && (
          <div className="space-y-3">
            <IntCard icon={CreditCard} label="Stripe" ok={d.stripe?.configured}
              detail={d.stripe?.keyPrefix ? `key: ${d.stripe.keyPrefix}…` : undefined} />
            <IntCard icon={RefreshCw} label="QuickBooks Online" ok={d.quickBooks?.connected}
              detail={d.quickBooks?.realmId ? `realm: ${d.quickBooks.realmId}` : 'Not connected'} />
            <IntCard icon={FileText} label="Email (Resend)" ok={d.email?.configured}
              detail={d.email?.from || undefined} />
            <IntCard icon={Bell} label="Push Notifications (APNs)" ok={d.pushNotifications?.configured} />
            <IntCard icon={Shield} label="Stripe Connect" ok={d.stripeConnect?.connected}
              detail={d.stripeConnect?.accountId || 'Not connected'} />
            <IntCard icon={Wifi} label="Plaid Bank Link" ok={d.plaid?.configured} />
            <IntCard icon={Terminal} label="Native Wrapper" ok={!!(window as any).Capacitor?.isNativePlatform?.()} />

            <div className="pt-2 border-t border-slate-700 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-28">NODE_ENV</span>
                <Badge variant="outline" className="font-mono text-xs border-slate-600 text-slate-300">{d.nodeEnv}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-28">APP_BASE_URL</span>
                <span className="text-xs font-mono text-slate-400">{d.appBaseUrl || '(not set)'}</span>
              </div>
            </div>

            <Button size="sm" variant="outline" onClick={() => refetch()}
              className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh Status
            </Button>
          </div>
        )}
      </DevCard>
    </div>
  );
}

// ─── INSPECTOR TAB (API LOGS + NOTES) ───────────────────────────────────────
function InspectorTab() {
  const [entries, setEntries] = useState<ApiLogEntry[]>([...apiLog]);
  const [notes, setNotes] = useState(() => localStorage.getItem('ecologic_dev_notes') || '');
  const { toast } = useToast();

  useEffect(() => {
    installApiInterceptor();
    const update = () => setEntries([...apiLog]);
    apiLogListeners.add(update);
    return () => { apiLogListeners.delete(update); };
  }, []);

  const saveNotes = (v: string) => {
    setNotes(v);
    localStorage.setItem('ecologic_dev_notes', v);
  };

  const copyEnvSummary = () => {
    const summary = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      platform: detectPlatform(),
      flags: loadFlags(),
      notes,
    };
    navigator.clipboard.writeText(JSON.stringify(summary, null, 2))
      .then(() => toast({ title: "Copied!", description: "Environment summary in clipboard" }));
  };

  const methodColor: Record<string, string> = {
    GET: 'text-blue-400',
    POST: 'text-emerald-400',
    PUT: 'text-amber-400',
    PATCH: 'text-amber-400',
    DELETE: 'text-red-400',
  };

  const statusColor = (s: number | null) => {
    if (s === null) return 'text-slate-500';
    if (s < 300) return 'text-emerald-400';
    if (s < 400) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="space-y-5">
      <DevCard title="API Inspector" icon={Terminal}>
        <p className="text-xs text-slate-500 mb-3">Last 25 API requests from this session. Updates live.</p>
        <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
          {entries.length === 0 && <p className="text-sm text-slate-600 italic">No API calls yet</p>}
          {entries.map(e => (
            <div key={e.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 font-mono text-xs">
              <span className={`w-14 shrink-0 font-bold ${methodColor[e.method] || 'text-slate-400'}`}>{e.method}</span>
              <span className="flex-1 text-slate-300 truncate">{e.route}</span>
              <span className={`w-10 text-right shrink-0 ${statusColor(e.status)}`}>{e.status ?? '…'}</span>
              <span className="w-16 text-right shrink-0 text-slate-500">{e.durationMs != null ? `${e.durationMs}ms` : '—'}</span>
              {e.error && <span className="text-red-400 text-xs truncate max-w-24" title={e.error}>⚠ {e.error}</span>}
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-700">
          <Button size="sm" variant="outline"
            onClick={() => { apiLog.length = 0; setEntries([]); }}
            className="border-slate-600 text-slate-400 hover:bg-slate-800 gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Clear Log
          </Button>
        </div>
      </DevCard>

      <DevCard title="Dev Notes" icon={FileText}>
        <Textarea
          value={notes}
          onChange={e => saveNotes(e.target.value)}
          placeholder="Type temporary dev notes here… auto-saved to browser storage."
          className="bg-slate-800 border-slate-700 text-slate-200 placeholder-slate-600 min-h-32 font-mono text-sm resize-none"
        />
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" onClick={copyEnvSummary}
            className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-1.5">
            <Download className="w-3.5 h-3.5" /> Copy Environment Summary
          </Button>
          <Button size="sm" variant="outline" onClick={() => { saveNotes(''); }}
            className="border-slate-600 text-slate-400 hover:bg-slate-800 gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Clear Notes
          </Button>
        </div>
      </DevCard>
    </div>
  );
}

// ─── MAIN PAGE ──────────────────────────────────────────────────────────────
export default function DevTools() {
  const { user } = useAuth() as { user: any };
  const [, navigate] = useLocation();

  const email = user?.email;
  const isAllowed = email && DEV_ALLOWLIST.includes(email);

  useEffect(() => {
    installApiInterceptor();
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400">Loading…</p>
      </div>
    );
  }

  if (!isAllowed) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <XCircle className="w-12 h-12 text-red-500" />
        <h1 className="text-xl font-bold text-white">Access Denied</h1>
        <p className="text-slate-400 text-sm">This area is restricted.</p>
        <Button size="sm" onClick={() => navigate('/jobs')} variant="outline" className="border-slate-700 text-slate-300">
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-teal-900/60 border border-teal-700/40">
            <Shield className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-wide">DEVELOPER TOOLS</h1>
            <p className="text-xs text-slate-500">EcoLogic Internal Console · {email}</p>
          </div>
          <Badge className="ml-auto bg-violet-900/50 text-violet-300 border-violet-700 text-xs">DEV ONLY</Badge>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-5 py-6">
        <Tabs defaultValue="session">
          <TabsList className="bg-slate-800 border border-slate-700 mb-6 h-auto flex-wrap">
            <TabsTrigger value="session" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <User className="w-3.5 h-3.5" /> Session
            </TabsTrigger>
            <TabsTrigger value="jobs" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <Briefcase className="w-3.5 h-3.5" /> Jobs
            </TabsTrigger>
            <TabsTrigger value="payments" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <CreditCard className="w-3.5 h-3.5" /> Payments
            </TabsTrigger>
            <TabsTrigger value="integrations" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <Wifi className="w-3.5 h-3.5" /> Integrations
            </TabsTrigger>
            <TabsTrigger value="inspector" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <Terminal className="w-3.5 h-3.5" /> Inspector
            </TabsTrigger>
          </TabsList>

          <TabsContent value="session"><SessionTab /></TabsContent>
          <TabsContent value="jobs"><JobDebuggerTab /></TabsContent>
          <TabsContent value="payments"><PaymentsDebuggerTab /></TabsContent>
          <TabsContent value="integrations"><IntegrationsTab /></TabsContent>
          <TabsContent value="inspector"><InspectorTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
