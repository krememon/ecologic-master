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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Shield, User, Briefcase, CreditCard, Wifi, Terminal, FileText,
  Copy, RefreshCw, ExternalLink, CheckCircle, XCircle, AlertCircle,
  ChevronDown, ChevronRight, Trash2, Download, Bell, Search,
  Building2, Users, ClipboardList, ToggleLeft, ToggleRight, Lock, Unlock,
  RotateCcw, Calendar, AlertTriangle
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

// ─── CONFIRM-WITH-TYPING MODAL ──────────────────────────────────────────────
function ConfirmTypedModal({
  open, title, description, confirmWord = "CONFIRM", onConfirm, onCancel
}: { open: boolean; title: string; description: string; confirmWord?: string; onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="bg-slate-900 border-slate-700">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" /> {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="px-1 py-2">
          <p className="text-xs text-slate-500 mb-2">Type <span className="font-mono text-amber-400">{confirmWord}</span> to proceed</p>
          <input
            value={typed} onChange={e => setTyped(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm font-mono text-slate-200 outline-none focus:border-amber-500"
            placeholder={confirmWord}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} className="border-slate-600 text-slate-300 hover:bg-slate-800">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={typed !== confirmWord}
            className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── SOURCE BADGE ────────────────────────────────────────────────────────────
function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    override_free_access: { label: '✦ Free Access Override', cls: 'bg-violet-900 text-violet-300 border-violet-700' },
    override_bypass: { label: '⚡ Bypass Override', cls: 'bg-amber-900 text-amber-300 border-amber-700' },
    stripe: { label: '✓ Stripe Active', cls: 'bg-emerald-900 text-emerald-300 border-emerald-700' },
    trial: { label: '◷ Trial', cls: 'bg-blue-900 text-blue-300 border-blue-700' },
    blocked: { label: '✕ Blocked', cls: 'bg-red-900 text-red-300 border-red-700' },
  };
  const cfg = map[source] || { label: source, cls: 'bg-slate-800 text-slate-400 border-slate-600' };
  return <Badge className={cfg.cls}>{cfg.label}</Badge>;
}

// ─── COMPANY SEARCH SELECTOR ─────────────────────────────────────────────────
function CompanySelector({ onSelect }: { onSelect: (c: any) => void }) {
  const [q, setQ] = useState('');
  const [searched, setSearched] = useState(false);
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/api/dev/admin/company/search', q],
    enabled: false,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/dev/admin/company/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Search failed');
      return res.json();
    },
  });
  const search = async () => { setSearched(true); await refetch(); };
  const rows: any[] = (data as any)?.companies || [];
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Search by name, email, or leave blank for all…"
          className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-teal-500" />
        <Button size="sm" onClick={search} disabled={isLoading} className="bg-teal-600 hover:bg-teal-700 gap-1.5 shrink-0">
          <Search className="w-3.5 h-3.5" /> {isLoading ? 'Searching…' : 'Search'}
        </Button>
      </div>
      {searched && rows.length === 0 && !isLoading && <p className="text-sm text-slate-500 italic">No companies found</p>}
      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {rows.map((c: any) => (
          <button key={c.id} onClick={() => onSelect(c)}
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors">
            <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{c.name}</p>
              <p className="text-xs text-slate-500 truncate">{c.ownerEmail || c.email || '—'} · ID {c.id}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              {c.adminFreeAccess && <Badge className="bg-violet-900 text-violet-300 border-violet-700 text-xs">Free</Badge>}
              {c.adminBypassSubscription && <Badge className="bg-amber-900 text-amber-300 border-amber-700 text-xs">Bypass</Badge>}
              {c.adminPaused && <Badge className="bg-red-900 text-red-300 border-red-700 text-xs">Paused</Badge>}
              <Badge className={`text-xs ${c.subscriptionStatus === 'active' ? 'bg-emerald-900 text-emerald-300 border-emerald-700' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                {c.subscriptionStatus || 'inactive'}
              </Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── COMPANIES TAB ───────────────────────────────────────────────────────────
function CompaniesTab() {
  const [selected, setSelected] = useState<any>(null);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [note, setNote] = useState('');
  const [confirmPause, setConfirmPause] = useState<{ action: 'pause' | 'unpause' } | null>(null);
  const { toast } = useToast();

  const { data: detail, isLoading, refetch } = useQuery({
    queryKey: ['/api/dev/admin/company', selected?.id],
    enabled: !!selected?.id,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/dev/admin/company/${selected.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await fetch('/api/dev/admin/company/status', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      return res.json();
    },
    onSuccess: () => { toast({ title: 'Updated', description: 'Company status updated' }); refetch(); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const d = detail as any;
  const company = d?.company;
  const billing = d?.billing;

  return (
    <div className="space-y-5">
      <DevCard title="Company Search" icon={Building2}>
        <CompanySelector onSelect={(c) => { setSelected(c); }} />
      </DevCard>

      {selected && (
        <>
          {isLoading && <p className="text-sm text-slate-400 animate-pulse py-4">Loading company…</p>}
          {company && (
            <DevCard title={`Company · ${company.name}`} icon={Building2}>
              <div className="space-y-0 mb-4">
                <Field label="ID" value={company.id} mono />
                <Field label="Name" value={company.name} />
                <Field label="Email" value={company.email} mono />
                <Field label="Owner" value={d.owner ? `${d.owner.firstName || ''} ${d.owner.lastName || ''} (${d.owner.email})`.trim() : '—'} />
                <Field label="Members" value={d.memberCount} />
                <Field label="Created" value={company.createdAt ? new Date(company.createdAt).toLocaleDateString() : '—'} />
                <Field label="QBO" value={<StatusBadge ok={!!company.qboRealmId} label="QuickBooks" />} />
                <Field label="Stripe Connect" value={<StatusBadge ok={!!company.stripeConnectAccountId} label="Stripe Connect" />} />
                <Field label="Paused" value={company.adminPaused ? <Badge className="bg-red-900 text-red-300 border-red-700">Paused</Badge> : <Badge className="bg-slate-800 text-slate-400 border-slate-600">Active</Badge>} />
                <Field label="Demo" value={company.adminIsDemo ? <Badge className="bg-blue-900 text-blue-300 border-blue-700">Demo</Badge> : '—'} />
                {billing && <Field label="Billing Source" value={<SourceBadge source={billing.source} />} />}
                <Field label="Internal Note" value={company.adminNote || <span className="text-slate-600 italic">none</span>} />
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-700">
                <Button size="sm" variant="outline" onClick={() => setConfirmPause({ action: company.adminPaused ? 'unpause' : 'pause' })}
                  className={company.adminPaused ? 'border-emerald-700 text-emerald-300 hover:bg-emerald-950' : 'border-amber-700 text-amber-300 hover:bg-amber-950'}>
                  {company.adminPaused ? <><Unlock className="w-3.5 h-3.5 mr-1.5" /> Restore Access</> : <><Lock className="w-3.5 h-3.5 mr-1.5" /> Pause Company</>}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { statusMutation.mutate({ companyId: selected.id, isDemo: !company.adminIsDemo }); }}
                  className="border-blue-700 text-blue-300 hover:bg-blue-950">
                  {company.adminIsDemo ? 'Unmark Demo' : 'Mark as Demo'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setNote(company.adminNote || ''); setShowNoteEditor(true); }}
                  className="border-slate-600 text-slate-300 hover:bg-slate-800">
                  <FileText className="w-3.5 h-3.5 mr-1.5" /> Edit Note
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(d, null, 2));
                  toast({ title: 'Copied', description: 'Company debug snapshot in clipboard' });
                }} className="border-slate-600 text-slate-300 hover:bg-slate-800">
                  <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy Snapshot
                </Button>
              </div>
            </DevCard>
          )}
        </>
      )}

      {showNoteEditor && (
        <AlertDialog open>
          <AlertDialogContent className="bg-slate-900 border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">Edit Internal Note</AlertDialogTitle>
            </AlertDialogHeader>
            <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Internal note…"
              className="bg-slate-800 border-slate-600 text-slate-200 placeholder-slate-600 min-h-24 resize-none" />
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setShowNoteEditor(false)} className="border-slate-600 text-slate-300 hover:bg-slate-800">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { statusMutation.mutate({ companyId: selected.id, note }); setShowNoteEditor(false); }}
                className="bg-teal-600 hover:bg-teal-700 text-white">Save Note</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <ConfirmModal
        open={!!confirmPause}
        title={confirmPause?.action === 'pause' ? 'Pause Company Access' : 'Restore Company Access'}
        description={confirmPause?.action === 'pause' ? `This will mark ${selected?.name} as paused. They will still exist in the DB.` : `Restore full access for ${selected?.name}.`}
        danger={confirmPause?.action === 'pause'}
        onConfirm={() => { if (confirmPause) statusMutation.mutate({ companyId: selected.id, paused: confirmPause.action === 'pause' }); setConfirmPause(null); }}
        onCancel={() => setConfirmPause(null)}
      />
    </div>
  );
}

// ─── BILLING SOURCE MINI BADGE (compact, for list rows) ─────────────────────
function BillingSourceChip({ source, allowed }: { source: string; allowed: boolean }) {
  const map: Record<string, string> = {
    override_free_access: 'bg-violet-900 text-violet-300',
    override_bypass: 'bg-amber-900 text-amber-300',
    stripe: 'bg-emerald-900 text-emerald-300',
    trial: 'bg-blue-900 text-blue-300',
    blocked: 'bg-red-900 text-red-300',
  };
  const labels: Record<string, string> = {
    override_free_access: 'Free', override_bypass: 'Bypass',
    stripe: 'Stripe', trial: 'Trial', blocked: 'Blocked',
  };
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${map[source] || 'bg-slate-700 text-slate-400'}`}>
      {labels[source] || source}
    </span>
  );
}

// ─── BILLING TAB ─────────────────────────────────────────────────────────────
function BillingTab() {
  const [selected, setSelected] = useState<any>(null);
  const [emailFilter, setEmailFilter] = useState('');
  const [reason, setReason] = useState('');
  const [planOverride, setPlanOverride] = useState('');
  const [seatLimit, setSeatLimit] = useState('');
  const [unlimitedSeats, setUnlimitedSeats] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [trialDays, setTrialDays] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const { toast } = useToast();

  // ── All companies list (loads on mount) ──────────────────────────────────
  const { data: listData, isLoading: listLoading, refetch: refetchList } = useQuery({
    queryKey: ['/api/dev/admin/billing/companies'],
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/dev/admin/billing/companies', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load companies');
      return res.json();
    },
  });
  const allCompanies: any[] = (listData as any)?.companies || [];
  const totalCount: number = (listData as any)?.total || 0;

  // Client-side filter: email-first search
  const filterLower = emailFilter.trim().toLowerCase();
  const filtered = filterLower
    ? allCompanies.filter((c: any) =>
        (c.ownerEmail?.toLowerCase().includes(filterLower)) ||
        (c.email?.toLowerCase().includes(filterLower)) ||
        (c.name?.toLowerCase().includes(filterLower)) ||
        String(c.id).includes(filterLower)
      )
    : allCompanies;

  // ── Selected company billing detail ─────────────────────────────────────
  const { data: detailData, isLoading: detailLoading, refetch: refetchDetail } = useQuery({
    queryKey: ['/api/dev/admin/billing', selected?.id],
    enabled: !!selected?.id,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/dev/admin/billing/${selected.id}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await fetch('/api/dev/admin/billing/override', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Override applied', description: 'Billing state updated' });
      refetchDetail();
      refetchList();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/dev/admin/billing/restore-default', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: selected.id }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Restored', description: 'Billing reset to Stripe default' });
      refetchDetail();
      refetchList();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const d = detailData as any;

  const applyOverride = (type: string, value: any) => {
    overrideMutation.mutate({
      companyId: selected.id, type, value, reason: reason || undefined,
      planOverride: planOverride || undefined, seatLimit: seatLimit ? parseInt(seatLimit) : undefined,
      unlimitedSeats, expiresAt: expiresAt || undefined,
    });
  };

  return (
    <div className="space-y-5">

      {/* ── Company list panel ─────────────────────────────────────────── */}
      <DevCard title={`Companies ${totalCount > 0 ? `· ${totalCount} total` : ''}`} icon={Building2}>
        {/* Search input */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
          <input
            value={emailFilter}
            onChange={e => setEmailFilter(e.target.value)}
            placeholder="Search by owner or user email…"
            className="w-full bg-slate-800 border border-slate-600 rounded pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-teal-500"
          />
          {emailFilter && (
            <button onClick={() => setEmailFilter('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs px-1">✕</button>
          )}
        </div>

        {/* List */}
        {listLoading && (
          <div className="flex items-center gap-2 py-4 text-slate-500 text-sm animate-pulse">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading companies…
          </div>
        )}
        {!listLoading && filtered.length === 0 && (
          <p className="text-sm text-slate-500 italic py-4 text-center">
            {emailFilter ? 'No companies match that email' : 'No companies found'}
          </p>
        )}
        {!listLoading && filtered.length > 0 && (
          <div className="space-y-1 max-h-72 overflow-y-auto pr-0.5">
            {filtered.map((c: any) => {
              const isSelected = selected?.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                    isSelected
                      ? 'bg-teal-950 border-teal-600'
                      : 'bg-slate-800 border-slate-700 hover:bg-slate-750 hover:border-slate-600'
                  }`}
                >
                  <Building2 className={`w-4 h-4 shrink-0 ${isSelected ? 'text-teal-400' : 'text-slate-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isSelected ? 'text-teal-200' : 'text-slate-200'}`}>{c.name}</p>
                    <p className="text-xs text-slate-500 truncate">{c.ownerEmail || c.email || '—'} · ID {c.id}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.accessAllowed
                      ? <BillingSourceChip source={c.billingSource} allowed={c.accessAllowed} />
                      : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-900 text-red-300">Blocked</span>}
                    {c.hasOverride && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-900 text-violet-400">OVR</span>}
                    {c.adminPaused && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-600 text-slate-300">Paused</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {!listLoading && filterLower && filtered.length > 0 && (
          <p className="text-xs text-slate-600 mt-2">{filtered.length} of {totalCount} shown</p>
        )}
      </DevCard>

      {/* ── Selected company billing detail ────────────────────────────── */}
      {selected && (
        <>
          {detailLoading && <p className="text-sm text-slate-400 animate-pulse py-4">Loading billing details…</p>}
          {d && (
            <>
              <DevCard title="Current Billing State" icon={CreditCard}>
                <div className="space-y-0 mb-4">
                  <Field label="Company" value={`${d.companyName} (ID: ${d.companyId})`} />
                  <Field label="Effective Source" value={d.effectiveBilling && <SourceBadge source={d.effectiveBilling.source} />} />
                  <Field label="Effective Plan" value={d.effectiveBilling?.effectivePlan || '—'} mono />
                  <Field label="Seat Limit" value={d.effectiveBilling?.seatLimit} />
                  <Field label="DB Status" value={<Badge variant="outline" className="border-slate-600 text-slate-300">{d.subscriptionStatus || 'inactive'}</Badge>} />
                  <Field label="DB Plan" value={d.subscriptionPlan || '—'} mono />
                  <Field label="Max Users (DB)" value={d.maxUsers} />
                  <Field label="Trial Ends" value={d.trialEndsAt ? new Date(d.trialEndsAt).toLocaleString() : '—'} />
                  <Field label="Period End" value={d.currentPeriodEnd ? new Date(d.currentPeriodEnd).toLocaleString() : '—'} />
                  <Field label="Has Stripe Sub" value={<StatusBadge ok={d.hasStripeSubscription} label="Stripe" />} />
                </div>
                {(d.adminFreeAccess || d.adminBypassSubscription || d.adminPlanOverride || d.adminSeatLimitOverride || d.adminUnlimitedSeats) && (
                  <div className="rounded-lg border border-violet-700 bg-violet-950/20 p-3 space-y-1 mt-2">
                    <p className="text-xs font-semibold text-violet-400 uppercase tracking-wide mb-2">Active Overrides</p>
                    {d.adminFreeAccess && <p className="text-xs text-violet-300">✦ Free Access Override ON</p>}
                    {d.adminBypassSubscription && <p className="text-xs text-amber-300">⚡ Subscription Bypass ON</p>}
                    {d.adminPlanOverride && <p className="text-xs text-slate-300">Plan override → <span className="font-mono">{d.adminPlanOverride}</span></p>}
                    {d.adminSeatLimitOverride && <p className="text-xs text-slate-300">Seat limit → {d.adminSeatLimitOverride}</p>}
                    {d.adminUnlimitedSeats && <p className="text-xs text-slate-300">Unlimited seats ON</p>}
                    {d.adminOverrideReason && <p className="text-xs text-slate-500 italic">Reason: {d.adminOverrideReason}</p>}
                    {d.adminOverrideExpiresAt && <p className="text-xs text-slate-500">Expires: {new Date(d.adminOverrideExpiresAt).toLocaleString()}</p>}
                    {d.adminOverrideUpdatedByEmail && <p className="text-xs text-slate-500">Set by: {d.adminOverrideUpdatedByEmail}</p>}
                  </div>
                )}
              </DevCard>

              <DevCard title="Override Controls" icon={Shield}>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <Label className="text-xs text-slate-400 uppercase tracking-wide">Reason / Note</Label>
                      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional reason for audit log…"
                        className="w-full mt-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-teal-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-slate-400 uppercase tracking-wide">Plan Override</Label>
                        <Select value={planOverride || "none"} onValueChange={v => setPlanOverride(v === "none" ? "" : v)}>
                          <SelectTrigger className="mt-1 bg-slate-800 border-slate-600 text-slate-200 h-9">
                            <SelectValue placeholder="— no override —" />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-800 border-slate-700">
                            <SelectItem value="none">— no override —</SelectItem>
                            <SelectItem value="starter">starter</SelectItem>
                            <SelectItem value="team">team</SelectItem>
                            <SelectItem value="pro">pro</SelectItem>
                            <SelectItem value="scale">scale</SelectItem>
                            <SelectItem value="enterprise">enterprise</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs text-slate-400 uppercase tracking-wide">Seat Cap Override</Label>
                        <input value={seatLimit} onChange={e => setSeatLimit(e.target.value)} placeholder="e.g. 25"
                          className="w-full mt-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-teal-500" />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch checked={unlimitedSeats} onCheckedChange={setUnlimitedSeats} className="data-[state=checked]:bg-violet-600" />
                      <Label className="text-sm text-slate-300">Unlimited seats</Label>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 uppercase tracking-wide">Override Expiry (optional)</Label>
                      <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
                        className="w-full mt-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-teal-500" />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-700">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Apply Override</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => applyOverride('free_access', !d.adminFreeAccess)}
                        disabled={overrideMutation.isPending}
                        className={d.adminFreeAccess ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-violet-700 hover:bg-violet-600 text-white'}>
                        {d.adminFreeAccess ? <ToggleRight className="w-3.5 h-3.5 mr-1.5" /> : <ToggleLeft className="w-3.5 h-3.5 mr-1.5" />}
                        {d.adminFreeAccess ? 'Disable Free Access' : 'Enable Free Access'}
                      </Button>
                      <Button size="sm" onClick={() => applyOverride('bypass_subscription', !d.adminBypassSubscription)}
                        disabled={overrideMutation.isPending}
                        className={d.adminBypassSubscription ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-amber-700 hover:bg-amber-600 text-white'}>
                        {d.adminBypassSubscription ? 'Disable Bypass' : 'Enable Sub Bypass'}
                      </Button>
                      <Button size="sm" onClick={() => applyOverride('plan_override', true)}
                        disabled={overrideMutation.isPending || !planOverride}
                        variant="outline" className="border-teal-700 text-teal-300 hover:bg-teal-950">
                        Apply Plan Override
                      </Button>
                      <Button size="sm" onClick={() => applyOverride('seat_override', true)}
                        disabled={overrideMutation.isPending}
                        variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-800">
                        Apply Seat Override
                      </Button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-700">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Trial Extension</p>
                    <div className="flex items-center gap-2">
                      <input value={trialDays} onChange={e => setTrialDays(e.target.value)} placeholder="Days to add…"
                        className="w-32 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-teal-500" />
                      <Button size="sm" onClick={() => overrideMutation.mutate({ companyId: selected.id, type: 'trial_extend', days: parseInt(trialDays) || 0, reason })}
                        disabled={overrideMutation.isPending || !trialDays}
                        variant="outline" className="border-blue-700 text-blue-300 hover:bg-blue-950">
                        <Calendar className="w-3.5 h-3.5 mr-1.5" /> Extend Trial
                      </Button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-700">
                    <Button size="sm" onClick={() => setConfirmRestore(true)}
                      disabled={restoreMutation.isPending}
                      className="bg-red-900 hover:bg-red-800 text-red-200 border border-red-700">
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Restore Default Billing
                    </Button>
                    <p className="text-xs text-slate-600 mt-1.5">Removes all internal overrides. Stripe-driven billing resumes.</p>
                  </div>
                </div>
              </DevCard>

              <JsonViewer data={d} label="Raw Billing Debug Payload" />
            </>
          )}
        </>
      )}

      <ConfirmTypedModal
        open={confirmRestore}
        title="Restore Default Billing"
        description={`All internal billing overrides for ${selected?.name} will be cleared. The company will revert to normal Stripe-driven billing enforcement.`}
        confirmWord="CONFIRM"
        onConfirm={() => { setConfirmRestore(false); restoreMutation.mutate(); }}
        onCancel={() => setConfirmRestore(false)}
      />
    </div>
  );
}

// ─── USERS TAB ───────────────────────────────────────────────────────────────
function UsersTab() {
  const [q, setQ] = useState('');
  const [searched, setSearched] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newRole, setNewRole] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/api/dev/admin/user/search', q],
    enabled: false,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/dev/admin/user/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Search failed');
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await fetch('/api/dev/admin/user/update', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      return res.json();
    },
    onSuccess: () => { toast({ title: 'Updated', description: 'User updated successfully' }); refetch(); setSelectedUser(null); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const rows: any[] = (data as any)?.users || [];

  return (
    <div className="space-y-5">
      <DevCard title="User Search" icon={Users}>
        <div className="flex gap-2 mb-3">
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { setSearched(true); refetch(); } }}
            placeholder="Search by email or name…"
            className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-teal-500" />
          <Button size="sm" onClick={() => { setSearched(true); refetch(); }} disabled={isLoading}
            className="bg-teal-600 hover:bg-teal-700 gap-1.5 shrink-0">
            <Search className="w-3.5 h-3.5" /> {isLoading ? 'Searching…' : 'Search'}
          </Button>
        </div>
        {searched && rows.length === 0 && !isLoading && <p className="text-sm text-slate-500 italic">No users found</p>}
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {rows.map((u: any) => (
            <button key={u.id} onClick={() => { setSelectedUser(u); setNewRole(u.role || ''); }}
              className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors">
              <User className="w-4 h-4 text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{u.firstName} {u.lastName}</p>
                <p className="text-xs text-slate-500 truncate">{u.email} · Company {u.companyId || '—'}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {u.role && <Badge className="bg-teal-900 text-teal-300 border-teal-700 text-xs">{u.role}</Badge>}
                <Badge className={`text-xs ${u.status === 'ACTIVE' ? 'bg-emerald-900 text-emerald-300 border-emerald-700' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>{u.status}</Badge>
              </div>
            </button>
          ))}
        </div>
      </DevCard>

      {selectedUser && (
        <DevCard title={`User · ${selectedUser.email}`} icon={User}>
          <div className="space-y-0 mb-4">
            <Field label="ID" value={selectedUser.id} mono />
            <Field label="Email" value={selectedUser.email} mono />
            <Field label="Name" value={`${selectedUser.firstName || ''} ${selectedUser.lastName || ''}`.trim() || '—'} />
            <Field label="Company ID" value={selectedUser.companyId || '—'} mono />
            <Field label="Role" value={selectedUser.role ? <Badge className="bg-teal-900 text-teal-300 border-teal-700">{selectedUser.role}</Badge> : '—'} />
            <Field label="Status" value={<Badge className={selectedUser.status === 'ACTIVE' ? 'bg-emerald-900 text-emerald-300 border-emerald-700' : 'bg-red-900 text-red-300 border-red-700'}>{selectedUser.status}</Badge>} />
            <Field label="Sub Bypass" value={selectedUser.subscriptionBypass ? <Badge className="bg-violet-900 text-violet-300 border-violet-700">Active</Badge> : '—'} />
            <Field label="Last Login" value={selectedUser.lastLoginAt ? new Date(selectedUser.lastLoginAt).toLocaleString() : '—'} />
          </div>

          <div className="space-y-3 pt-3 border-t border-slate-700">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs text-slate-400 uppercase tracking-wide">Change Role</Label>
                <Select value={newRole} onValueChange={setNewRole}>
                  <SelectTrigger className="mt-1 bg-slate-800 border-slate-600 text-slate-200 h-9">
                    <SelectValue placeholder="Select role…" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="OWNER">OWNER</SelectItem>
                    <SelectItem value="SUPERVISOR">SUPERVISOR</SelectItem>
                    <SelectItem value="DISPATCHER">DISPATCHER</SelectItem>
                    <SelectItem value="TECHNICIAN">TECHNICIAN</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" onClick={() => updateMutation.mutate({ userId: selectedUser.id, role: newRole, companyId: selectedUser.companyId })}
                disabled={updateMutation.isPending || !newRole || newRole === selectedUser.role}
                className="bg-teal-600 hover:bg-teal-700">
                Apply Role
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline"
                onClick={() => updateMutation.mutate({ userId: selectedUser.id, status: selectedUser.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
                disabled={updateMutation.isPending}
                className={selectedUser.status === 'ACTIVE' ? 'border-red-700 text-red-300 hover:bg-red-950' : 'border-emerald-700 text-emerald-300 hover:bg-emerald-950'}>
                {selectedUser.status === 'ACTIVE' ? <><XCircle className="w-3.5 h-3.5 mr-1.5" /> Deactivate</> : <><CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Activate</>}
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => updateMutation.mutate({ userId: selectedUser.id, subscriptionBypass: !selectedUser.subscriptionBypass })}
                disabled={updateMutation.isPending}
                className="border-violet-700 text-violet-300 hover:bg-violet-950">
                {selectedUser.subscriptionBypass ? 'Revoke Sub Bypass' : 'Grant Sub Bypass'}
              </Button>
              <Button size="sm" variant="outline"
                onClick={() => updateMutation.mutate({ userId: selectedUser.id, resetOnboarding: true })}
                disabled={updateMutation.isPending}
                className="border-slate-600 text-slate-300 hover:bg-slate-800">
                Reset Onboarding
              </Button>
            </div>
          </div>
        </DevCard>
      )}
    </div>
  );
}

// ─── AUDIT LOGS TAB ──────────────────────────────────────────────────────────
function AuditLogsTab() {
  const [filterType, setFilterType] = useState('');
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['/api/dev/admin/audit-logs'],
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/dev/admin/audit-logs?limit=100', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const logs: any[] = (data as any)?.logs || [];
  const filtered = filterType ? logs.filter((l: any) => l.targetType === filterType) : logs;

  const actionColor: Record<string, string> = {
    billing_override_free_access: 'text-violet-400',
    billing_override_bypass_subscription: 'text-amber-400',
    billing_override_plan_override: 'text-teal-400',
    billing_override_seat_override: 'text-blue-400',
    billing_restore_default: 'text-red-400',
    trial_extend: 'text-blue-400',
    company_status_update: 'text-slate-300',
    user_update: 'text-slate-300',
  };

  return (
    <div className="space-y-5">
      <DevCard title="Admin Audit Log" icon={ClipboardList}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            {['', 'billing', 'company', 'user'].map(t => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterType === t ? 'bg-teal-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                {t || 'All'}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} className="border-slate-600 text-slate-400 hover:bg-slate-800 gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
        {isLoading && <p className="text-sm text-slate-400 animate-pulse">Loading…</p>}
        {!isLoading && filtered.length === 0 && <p className="text-sm text-slate-600 italic">No audit log entries yet</p>}
        <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {filtered.map((log: any) => (
            <div key={log.id} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <span className={`text-sm font-mono font-medium ${actionColor[log.action] || 'text-slate-300'}`}>{log.action}</span>
                <span className="text-xs text-slate-500 shrink-0">{log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">{log.targetType}</Badge>
                <span className="text-xs text-slate-400">{log.targetName || log.targetId}</span>
                <span className="text-xs text-slate-600">by {log.actorEmail}</span>
              </div>
              {log.note && <p className="text-xs text-slate-500 italic">{log.note}</p>}
              {(log.beforeValue || log.afterValue) && (
                <div className="flex gap-2 mt-1 flex-wrap">
                  {log.beforeValue && <span className="text-xs font-mono text-slate-600">before: {JSON.stringify(log.beforeValue)}</span>}
                  {log.afterValue && <span className="text-xs font-mono text-teal-700">after: {JSON.stringify(log.afterValue)}</span>}
                </div>
              )}
            </div>
          ))}
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
        <Tabs defaultValue="billing">
          <TabsList className="bg-slate-800 border border-slate-700 mb-6 h-auto flex-wrap gap-y-1">
            <TabsTrigger value="billing" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <CreditCard className="w-3.5 h-3.5" /> Billing
            </TabsTrigger>
            <TabsTrigger value="companies" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <Building2 className="w-3.5 h-3.5" /> Companies
            </TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <Users className="w-3.5 h-3.5" /> Users
            </TabsTrigger>
            <TabsTrigger value="audit" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <ClipboardList className="w-3.5 h-3.5" /> Audit Logs
            </TabsTrigger>
            <TabsTrigger value="session" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <User className="w-3.5 h-3.5" /> Session
            </TabsTrigger>
            <TabsTrigger value="jobs" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <Briefcase className="w-3.5 h-3.5" /> Jobs
            </TabsTrigger>
            <TabsTrigger value="payments" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <AlertCircle className="w-3.5 h-3.5" /> Payments
            </TabsTrigger>
            <TabsTrigger value="integrations" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <Wifi className="w-3.5 h-3.5" /> Integrations
            </TabsTrigger>
            <TabsTrigger value="inspector" className="data-[state=active]:bg-teal-700 data-[state=active]:text-white text-slate-400 gap-1.5 text-xs">
              <Terminal className="w-3.5 h-3.5" /> Inspector
            </TabsTrigger>
          </TabsList>

          <TabsContent value="billing"><BillingTab /></TabsContent>
          <TabsContent value="companies"><CompaniesTab /></TabsContent>
          <TabsContent value="users"><UsersTab /></TabsContent>
          <TabsContent value="audit"><AuditLogsTab /></TabsContent>
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
