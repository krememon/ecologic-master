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
  RotateCcw, Calendar, AlertTriangle, DollarSign
} from "lucide-react";

// ─── DEV ALLOWLIST ──────────────────────────────────────────────────────────
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

// ─── API INSPECTOR ──────────────────────────────────────────────────────────
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

function notifyListeners() { apiLogListeners.forEach(fn => fn()); }

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
          <button onClick={handleCopy}
            className="absolute top-2 right-2 z-10 p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
            title="Copy JSON">
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
function ConfirmModal({ open, title, description, onConfirm, onCancel, danger }: {
  open: boolean; title: string; description: string; onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="bg-slate-900 border-slate-700">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} className="border-slate-600 text-slate-300 hover:bg-slate-800">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}
            className={danger ? "bg-red-600 hover:bg-red-700 text-white" : "bg-teal-600 hover:bg-teal-700 text-white"}>
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── CONFIRM-WITH-TYPING MODAL ──────────────────────────────────────────────
function ConfirmTypedModal({ open, title, description, confirmWord = "CONFIRM", onConfirm, onCancel }: {
  open: boolean; title: string; description: string; confirmWord?: string; onConfirm: () => void; onCancel: () => void;
}) {
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
          <input value={typed} onChange={e => setTyped(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm font-mono text-slate-200 outline-none focus:border-amber-500"
            placeholder={confirmWord} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} className="border-slate-600 text-slate-300 hover:bg-slate-800">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={typed !== confirmWord}
            className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-30 disabled:cursor-not-allowed">
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── CARD WRAPPER ───────────────────────────────────────────────────────────
function DevCard({ title, icon: Icon, children, collapsible = false }: {
  title: string; icon: React.FC<any>; children: React.ReactNode; collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 overflow-hidden">
      <button
        onClick={() => collapsible && setOpen(o => !o)}
        className={`w-full flex items-center gap-2.5 px-5 py-3.5 border-b border-slate-700 bg-slate-800/60 ${collapsible ? 'hover:bg-slate-700/50 transition-colors' : ''}`}
      >
        <Icon className="w-4 h-4 text-teal-400" />
        <h3 className="text-sm font-semibold text-slate-200 tracking-wide uppercase flex-1 text-left">{title}</h3>
        {collapsible && (open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />)}
      </button>
      {open && <div className="p-5">{children}</div>}
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

// ─── SOURCE BADGE ────────────────────────────────────────────────────────────
function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    override_free_access: { label: '✦ Free Access', cls: 'bg-violet-900 text-violet-300 border-violet-700' },
    override_bypass: { label: '⚡ Manual Bypass', cls: 'bg-amber-900 text-amber-300 border-amber-700' },
    stripe: { label: '✓ Paid Plan', cls: 'bg-emerald-900 text-emerald-300 border-emerald-700' },
    trial: { label: '◷ Trial Active', cls: 'bg-blue-900 text-blue-300 border-blue-700' },
    blocked: { label: '✕ Blocked', cls: 'bg-red-900 text-red-300 border-red-700' },
  };
  const cfg = map[source] || { label: source, cls: 'bg-slate-800 text-slate-400 border-slate-600' };
  return <Badge className={cfg.cls}>{cfg.label}</Badge>;
}

// ─── BILLING SOURCE CHIP ─────────────────────────────────────────────────────
function BillingSourceChip({ source }: { source: string }) {
  const map: Record<string, string> = {
    override_free_access: 'bg-violet-900 text-violet-300',
    override_bypass: 'bg-amber-900 text-amber-300',
    stripe: 'bg-emerald-900 text-emerald-300',
    trial: 'bg-blue-900 text-blue-300',
    blocked: 'bg-red-900 text-red-300',
  };
  const labels: Record<string, string> = {
    override_free_access: 'Free Access', override_bypass: 'Manual Bypass',
    stripe: 'Paid Plan', trial: 'Trial', blocked: 'Blocked',
  };
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${map[source] || 'bg-slate-700 text-slate-400'}`}>
      {labels[source] || source}
    </span>
  );
}

// ─── COMPANY CONSOLE ─────────────────────────────────────────────────────────
function CompanyConsole({ companyCode, initialData, onClear }: {
  companyCode: string;
  initialData: { company: any; owner: any; memberCount: number; billing: any };
  onClear: () => void;
}) {
  const { company, owner, memberCount, billing } = initialData;
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // ── State ──────────────────────────────────────────────────────────────
  const [confirmBypassOn, setConfirmBypassOn] = useState(false);
  const [confirmBypassOff, setConfirmBypassOff] = useState(false);
  const [confirmFreeOn, setConfirmFreeOn] = useState(false);
  const [confirmFreeOff, setConfirmFreeOff] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmPlanChange, setConfirmPlanChange] = useState(false);
  const [confirmLimitChange, setConfirmLimitChange] = useState(false);
  const [planChoice, setPlanChoice] = useState('');
  const [seatInput, setSeatInput] = useState('');
  const [unlimitedToggle, setUnlimitedToggle] = useState(false);
  const [trialCustomDate, setTrialCustomDate] = useState('');
  const [billingNote, setBillingNote] = useState('');
  const [billingPending, setBillingPending] = useState<string | null>(null);
  const [confirmPause, setConfirmPause] = useState<'pause' | 'unpause' | null>(null);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [noteText, setNoteText] = useState(company.adminNote || '');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newRole, setNewRole] = useState('');

  // ── Billing detail query ──────────────────────────────────────────────
  const { data: billingDetail, refetch: refetchBilling, isFetching: billingFetching } = useQuery({
    queryKey: ['/api/dev/admin/company/by-code/billing', companyCode],
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/dev/admin/company/by-code/${companyCode}/billing`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  // ── Company people query ──────────────────────────────────────────────
  const { data: usersData, refetch: refetchUsers } = useQuery({
    queryKey: ['/api/dev/admin/company/by-code/users', companyCode],
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/dev/admin/company/by-code/${companyCode}/users`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  // ── Jobs query ────────────────────────────────────────────────────────
  const { data: jobsData } = useQuery({
    queryKey: ['/api/dev/admin/company/by-code/jobs', companyCode],
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/dev/admin/company/by-code/${companyCode}/jobs`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  // ── Payments query ────────────────────────────────────────────────────
  const { data: paymentsData } = useQuery({
    queryKey: ['/api/dev/admin/company/by-code/payments', companyCode],
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/dev/admin/company/by-code/${companyCode}/payments`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const d = billingDetail as any;
  const companyUsers: any[] = (usersData as any)?.users || [];
  const companyJobs: any[] = (jobsData as any)?.jobs || [];
  const companyInvoices: any[] = (paymentsData as any)?.invoices || [];
  const companyPayments: any[] = (paymentsData as any)?.payments || [];

  // ── Billing action helper ─────────────────────────────────────────────
  const callBilling = async (endpoint: string, body: any, successTitle: string, successDesc?: string) => {
    setBillingPending(endpoint);
    try {
      const res = await fetch(`/api/dev/admin/company/by-code/${companyCode}/billing/${endpoint}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      toast({ title: successTitle, description: successDesc });
      refetchBilling();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setBillingPending(null);
    }
  };

  // ── Other mutations ───────────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await fetch('/api/dev/admin/company/status', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: company.id, ...body }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Updated', description: 'Company status updated' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const userUpdateMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await fetch('/api/dev/admin/user/update', { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Updated', description: 'User updated successfully' });
      refetchUsers();
      setSelectedUser(null);
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const statusColor: Record<string, string> = {
    PENDING: 'bg-slate-700 text-slate-300',
    SCHEDULED: 'bg-blue-900 text-blue-300',
    IN_PROGRESS: 'bg-amber-900 text-amber-300',
    COMPLETED: 'bg-emerald-900 text-emerald-300',
    CANCELLED: 'bg-red-900 text-red-300',
  };

  const invoiceStatusColor: Record<string, string> = {
    DRAFT: 'bg-slate-700 text-slate-400',
    SENT: 'bg-blue-900 text-blue-300',
    PAID: 'bg-emerald-900 text-emerald-300',
    PARTIAL: 'bg-amber-900 text-amber-300',
    OVERDUE: 'bg-red-900 text-red-300',
  };

  return (
    <div className="space-y-4">
      {/* ── Console header ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-1">
        <div className="p-2 rounded-lg bg-teal-900/50 border border-teal-700/50">
          <Building2 className="w-4 h-4 text-teal-400" />
        </div>
        <div className="flex-1">
          <p className="text-base font-bold text-white">{company.name}</p>
          <p className="text-xs text-slate-500 font-mono">Code: {company.companyCode} · ID: {company.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {billing.allowed
            ? <BillingSourceChip source={billing.source} />
            : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-900 text-red-300">Blocked</span>}
          {company.adminPaused && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-600 text-slate-300">Paused</span>}
        </div>
        <Button size="sm" variant="outline" onClick={onClear}
          className="border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
          <XCircle className="w-3.5 h-3.5 mr-1.5" /> Clear
        </Button>
      </div>

      {/* ── Company Summary ────────────────────────────────────────────────── */}
      <DevCard title="Company Summary" icon={Building2}>
        <div className="space-y-0 mb-4">
          <Field label="Company ID" value={company.id} mono />
          <Field label="Company Code" value={company.companyCode} mono />
          <Field label="Name" value={company.name} />
          <Field label="Email" value={company.email} mono />
          <Field label="Owner" value={owner ? `${[owner.firstName, owner.lastName].filter(Boolean).join(' ')} · ${owner.email}` : '—'} />
          <Field label="Members" value={memberCount} />
          <Field label="Created" value={company.createdAt ? new Date(company.createdAt).toLocaleDateString() : '—'} />
          <Field label="Status" value={company.adminPaused
            ? <Badge className="bg-red-900 text-red-300 border-red-700">Paused</Badge>
            : <Badge className="bg-emerald-900 text-emerald-300 border-emerald-700">Active</Badge>} />
          <Field label="Demo" value={company.adminIsDemo ? <Badge className="bg-blue-900 text-blue-300 border-blue-700">Demo</Badge> : '—'} />
          <Field label="Billing" value={<SourceBadge source={billing.source} />} />
          <Field label="QBO" value={<StatusBadge ok={!!company.qboRealmId} label="QuickBooks" />} />
          <Field label="Stripe Connect" value={<StatusBadge ok={!!company.stripeConnectAccountId} label="Stripe Connect" />} />
          <Field label="Internal Note" value={company.adminNote || <span className="text-slate-600 italic">none</span>} />
        </div>
        <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-700">
          <Button size="sm" variant="outline"
            onClick={() => setConfirmPause(company.adminPaused ? 'unpause' : 'pause')}
            disabled={statusMutation.isPending}
            className={company.adminPaused
              ? 'border-emerald-700 text-emerald-300 hover:bg-emerald-950'
              : 'border-amber-700 text-amber-300 hover:bg-amber-950'}>
            {company.adminPaused
              ? <><Unlock className="w-3.5 h-3.5 mr-1.5" /> Restore Access</>
              : <><Lock className="w-3.5 h-3.5 mr-1.5" /> Pause Company</>}
          </Button>
          <Button size="sm" variant="outline"
            onClick={() => statusMutation.mutate({ isDemo: !company.adminIsDemo })}
            disabled={statusMutation.isPending}
            className="border-blue-700 text-blue-300 hover:bg-blue-950">
            {company.adminIsDemo ? 'Unmark Demo' : 'Mark as Demo'}
          </Button>
          <Button size="sm" variant="outline"
            onClick={() => { setNoteText(company.adminNote || ''); setShowNoteEditor(true); }}
            className="border-slate-600 text-slate-300 hover:bg-slate-800">
            <FileText className="w-3.5 h-3.5 mr-1.5" /> Edit Note
          </Button>
          <Button size="sm" variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify({ company, owner, memberCount, billing, billingDetail }, null, 2));
              toast({ title: 'Copied', description: 'Company snapshot in clipboard' });
            }}
            className="border-slate-600 text-slate-300 hover:bg-slate-800">
            <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy Snapshot
          </Button>
        </div>
      </DevCard>

      {/* ── Billing Access ─────────────────────────────────────────────────── */}
      <DevCard title="Billing Access" icon={CreditCard}>
        {!d ? (
          <p className="text-sm text-slate-500 italic">{billingFetching ? 'Loading billing data…' : 'Billing data unavailable'}</p>
        ) : (() => {
          const eb = d.effectiveBilling;
          const aeb = d.appEffectiveBilling;
          const hasManualChanges = d.adminFreeAccess || d.adminBypassSubscription || d.adminPlanOverride || d.adminSeatLimitOverride || d.adminUnlimitedSeats;
          const mismatch = aeb && (aeb.allowed !== eb?.allowed || aeb.source !== eb?.source);

          // Primary banner = what the app actually enforces (appEffectiveBilling)
          const appStatusSentence = (() => {
            if (!aeb) return { text: 'App access state unavailable.', cls: 'bg-slate-800 border-slate-700 text-slate-400' };
            if (d.adminPaused) return { text: 'This company is paused by an admin — no app access.', cls: 'bg-red-950/60 border-red-800 text-red-300' };
            switch (aeb.source) {
              case 'dev_env_bypass': return { text: 'Allowed — BYPASS_SUBSCRIPTION env var is active (dev/preview only). All companies bypass subscription checks in this environment.', cls: 'bg-yellow-950/60 border-yellow-700 text-yellow-300' };
              case 'user_subscription_bypass': return { text: `Allowed — one or more users have a personal subscription bypass set.`, cls: 'bg-yellow-950/60 border-yellow-700 text-yellow-300' };
              case 'override_free_access': return { text: 'Allowed — free access is turned on manually.', cls: 'bg-violet-950/60 border-violet-700 text-violet-300' };
              case 'override_bypass': return { text: 'Allowed — subscription bypass is active manually.', cls: 'bg-amber-950/60 border-amber-800 text-amber-300' };
              case 'stripe': return { text: 'Allowed — active paid Stripe subscription.', cls: 'bg-emerald-950/60 border-emerald-800 text-emerald-300' };
              case 'trial': return { text: 'Allowed — active trial.', cls: 'bg-blue-950/60 border-blue-800 text-blue-300' };
              default: return { text: 'Blocked — this company does not have an active subscription, trial, or manual access grant.', cls: 'bg-red-950/60 border-red-800 text-red-300' };
            }
          })();

          return (
            <div className="space-y-5">
              {/* Primary status — what the app actually sees */}
              <div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1.5">What the App Currently Sees</p>
                <div className={`flex items-start gap-2.5 px-4 py-3.5 rounded-xl border ${appStatusSentence.cls}`}>
                  {aeb?.allowed ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                  <p className="text-sm font-medium leading-snug">{appStatusSentence.text}</p>
                </div>
              </div>

              {/* Mismatch warning — if app state differs from resolver state */}
              {mismatch && (
                <div className="rounded-xl border border-yellow-700/60 bg-yellow-950/20 px-4 py-3 space-y-1">
                  <p className="text-xs font-bold text-yellow-400 uppercase tracking-widest mb-1">⚠ Dev Tools ≠ Real App</p>
                  <p className="text-xs text-yellow-300">The billing resolver says <span className="font-mono font-bold">{eb?.allowed ? 'allowed' : 'blocked'}</span> ({eb?.source}), but the app is actually enforcing <span className="font-mono font-bold">{aeb?.allowed ? 'allowed' : 'blocked'}</span> ({aeb?.source}).</p>
                  <p className="text-xs text-yellow-500 mt-1">{aeb?.reason}</p>
                </div>
              )}

              {/* Quick facts grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { label: 'App Access Source', val: <span className="font-mono text-xs text-slate-300">{aeb?.source || '—'}</span> },
                  { label: 'DB Resolver Result', val: <SourceBadge source={eb?.source} /> },
                  { label: 'Effective Plan', val: <span className="font-mono text-slate-200">{aeb?.effectivePlan || eb?.effectivePlan || '—'}</span> },
                  { label: 'User Limit', val: <span className="text-slate-200">{d.adminUnlimitedSeats ? 'Unlimited' : (eb?.seatLimit ?? '—')}</span> },
                  { label: 'Stripe Status', val: <Badge variant="outline" className="border-slate-600 text-slate-300 text-[10px]">{d.subscriptionStatus || 'inactive'}</Badge> },
                  { label: 'Trial End', val: <span className="text-slate-300">{d.trialEndsAt ? new Date(d.trialEndsAt).toLocaleDateString() : '—'}</span> },
                  { label: 'Block Reason', val: <span className="font-mono text-xs text-slate-400">{eb?.blockReason || '—'}</span> },
                  { label: 'Stripe Connected', val: <StatusBadge ok={d.hasStripeSubscription} label={d.hasStripeSubscription ? 'Yes' : 'No'} /> },
                ].map(({ label, val }) => (
                  <div key={label} className="flex flex-col gap-0.5 bg-slate-800/60 rounded-lg px-3 py-2.5">
                    <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">{label}</span>
                    <span className="text-sm">{val}</span>
                  </div>
                ))}
              </div>

              {/* Dev bypass warning */}
              {d.globalDevBypass && (
                <div className="rounded-xl border border-yellow-700 bg-yellow-950/20 px-4 py-3 space-y-1.5">
                  <p className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest mb-1">Global Dev Environment Bypass Active</p>
                  <p className="text-xs text-yellow-300">The <span className="font-mono">BYPASS_SUBSCRIPTION=1</span> environment variable is set. All users in all companies bypass the subscription gate in this dev/preview environment. This does NOT apply in production.</p>
                  <p className="text-xs text-yellow-600 mt-1">To test real billing enforcement, unset the BYPASS_SUBSCRIPTION env var or deploy to production.</p>
                </div>
              )}

              {/* User bypass */}
              {d.userBypasses?.length > 0 && (
                <div className="rounded-xl border border-yellow-700/60 bg-yellow-950/10 px-4 py-3">
                  <p className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest mb-1">Personal User Bypass</p>
                  <p className="text-xs text-yellow-300">These users have a personal subscription bypass: <span className="font-mono">{d.userBypasses.join(', ')}</span></p>
                </div>
              )}

              {/* Manual overrides notice */}
              {hasManualChanges && (
                <div className="rounded-xl border border-violet-700/60 bg-violet-950/20 px-4 py-3 space-y-1.5">
                  <p className="text-[10px] font-bold text-violet-400 uppercase tracking-widest mb-2">Manual Billing Overrides Active</p>
                  {d.adminFreeAccess && <p className="text-xs text-violet-300">✦ Free access is turned on</p>}
                  {d.adminBypassSubscription && <p className="text-xs text-amber-300">⚡ Subscription check is bypassed</p>}
                  {d.adminPlanOverride && <p className="text-xs text-slate-300">Forced plan: <span className="font-mono font-bold">{d.adminPlanOverride}</span></p>}
                  {d.adminSeatLimitOverride && <p className="text-xs text-slate-300">Forced user limit: {d.adminSeatLimitOverride}</p>}
                  {d.adminUnlimitedSeats && <p className="text-xs text-slate-300">Unlimited users is on</p>}
                  {d.adminOverrideUpdatedByEmail && <p className="text-xs text-slate-500 mt-1">Last changed by: {d.adminOverrideUpdatedByEmail}</p>}
                </div>
              )}

              {/* Optional note input */}
              <div>
                <Label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Reason / Note (optional — saved to audit log)</Label>
                <input value={billingNote} onChange={e => setBillingNote(e.target.value)} placeholder="e.g. Trial extension for sales demo"
                  className="w-full mt-1.5 bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-teal-500 transition-colors" />
              </div>

              {/* ── PRIMARY ACTIONS ─────────────────────────────── */}
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Access Controls</p>

                {/* Bypass button */}
                {d.adminBypassSubscription ? (
                  <div className="rounded-xl border border-amber-700 bg-amber-950/30 px-4 py-3.5 flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-200">Subscription Lock Is Bypassed</p>
                      <p className="text-xs text-amber-500 mt-0.5">This company can use EcoLogic without a subscription.</p>
                    </div>
                    {confirmBypassOff ? (
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" onClick={() => { callBilling('bypass', { value: false, note: billingNote }, 'Bypass Removed', 'Subscription lock is back on'); setConfirmBypassOff(false); }}
                          disabled={billingPending === 'bypass'} className="bg-amber-700 hover:bg-amber-600 h-8 text-xs">
                          {billingPending === 'bypass' ? 'Removing…' : 'Confirm — Turn Off'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmBypassOff(false)} className="border-slate-600 text-slate-400 h-8 text-xs">Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirmBypassOff(true)}
                        className="border-amber-700 text-amber-300 hover:bg-amber-950 shrink-0 h-8 text-xs">
                        Turn Off Bypass
                      </Button>
                    )}
                  </div>
                ) : (
                  confirmBypassOn ? (
                    <div className="rounded-xl border border-slate-600 bg-slate-800/80 px-4 py-3.5">
                      <p className="text-sm text-slate-200 mb-1 font-medium">This will let this company use EcoLogic even without an active subscription. Continue?</p>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" onClick={() => { callBilling('bypass', { value: true, note: billingNote }, 'Bypass Active', 'Subscription lock is now skipped'); setConfirmBypassOn(false); }}
                          disabled={billingPending === 'bypass'} className="bg-amber-600 hover:bg-amber-700 h-9">
                          {billingPending === 'bypass' ? 'Saving…' : 'Yes, Bypass Subscription Lock'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmBypassOn(false)} className="border-slate-600 text-slate-400 h-9">Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmBypassOn(true)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-600 bg-slate-800 hover:border-amber-700/60 hover:bg-amber-950/20 active:scale-[0.99] transition-all text-left">
                      <div className="p-1.5 rounded-lg bg-amber-900/40 shrink-0"><AlertTriangle className="w-4 h-4 text-amber-400" /></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-200">Bypass Subscription Lock</p>
                        <p className="text-xs text-slate-500 mt-0.5">Let this company in even without an active subscription</p>
                      </div>
                    </button>
                  )
                )}

                {/* Free Access button */}
                {d.adminFreeAccess ? (
                  <div className="rounded-xl border border-violet-700 bg-violet-950/30 px-4 py-3.5 flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-violet-200">Free Access Is On</p>
                      <p className="text-xs text-violet-500 mt-0.5">This company is using EcoLogic for free.</p>
                    </div>
                    {confirmFreeOff ? (
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" onClick={() => { callBilling('free-access', { value: false, note: billingNote }, 'Free Access Removed'); setConfirmFreeOff(false); }}
                          disabled={billingPending === 'free-access'} className="bg-violet-700 hover:bg-violet-600 h-8 text-xs">
                          {billingPending === 'free-access' ? 'Removing…' : 'Confirm — Turn Off'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmFreeOff(false)} className="border-slate-600 text-slate-400 h-8 text-xs">Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirmFreeOff(true)}
                        className="border-violet-700 text-violet-300 hover:bg-violet-950 shrink-0 h-8 text-xs">
                        Turn Off Free Access
                      </Button>
                    )}
                  </div>
                ) : (
                  confirmFreeOn ? (
                    <div className="rounded-xl border border-slate-600 bg-slate-800/80 px-4 py-3.5">
                      <p className="text-sm text-slate-200 mb-1 font-medium">This will give this company free access to EcoLogic until you turn it off. Continue?</p>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" onClick={() => { callBilling('free-access', { value: true, note: billingNote }, 'Free Access On', 'Company can now use EcoLogic for free'); setConfirmFreeOn(false); }}
                          disabled={billingPending === 'free-access'} className="bg-violet-600 hover:bg-violet-700 h-9">
                          {billingPending === 'free-access' ? 'Saving…' : 'Yes, Give Free Access'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmFreeOn(false)} className="border-slate-600 text-slate-400 h-9">Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmFreeOn(true)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-slate-600 bg-slate-800 hover:border-violet-700/60 hover:bg-violet-950/20 active:scale-[0.99] transition-all text-left">
                      <div className="p-1.5 rounded-lg bg-violet-900/40 shrink-0"><DollarSign className="w-4 h-4 text-violet-400" /></div>
                      <div>
                        <p className="text-sm font-semibold text-slate-200">Give Free Access</p>
                        <p className="text-xs text-slate-500 mt-0.5">Manually allow this company to use EcoLogic for free</p>
                      </div>
                    </button>
                  )
                )}

                {/* Refresh */}
                <button onClick={() => refetchBilling()}
                  disabled={billingFetching}
                  className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border border-slate-700 bg-slate-800/50 hover:bg-slate-800 active:scale-[0.99] transition-all text-left">
                  <RefreshCw className={`w-4 h-4 text-slate-500 shrink-0 ${billingFetching ? 'animate-spin' : ''}`} />
                  <p className="text-sm text-slate-400">{billingFetching ? 'Refreshing billing info…' : 'Refresh Billing Info'}</p>
                </button>
              </div>

              {/* ── CHANGE PLAN ────────────────────────────────── */}
              <div className="space-y-2.5 pt-4 border-t border-slate-800">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Change Company Plan</p>
                  <p className="text-xs text-slate-600 mt-0.5">Choose what EcoLogic plan this company should use right now.</p>
                </div>
                {d.adminPlanOverride && (
                  <p className="text-xs text-teal-500 font-medium">Currently forced to: <span className="font-mono">{d.adminPlanOverride}</span></p>
                )}
                <div className="flex gap-2.5">
                  <Select value={planChoice || 'none'} onValueChange={v => setPlanChoice(v === 'none' ? '' : v)}>
                    <SelectTrigger className="flex-1 bg-slate-800 border-slate-600 text-slate-200 h-10">
                      <SelectValue placeholder="— select plan —" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="none">— no override —</SelectItem>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="team">Team</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="scale">Scale</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={() => setConfirmPlanChange(true)} disabled={!planChoice || billingPending === 'plan'}
                    className="bg-teal-700 hover:bg-teal-600 h-10 px-4 shrink-0">
                    Apply Plan Change
                  </Button>
                </div>
                {confirmPlanChange && (
                  <div className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-3">
                    <p className="text-sm text-slate-200 mb-3 font-medium">This will manually change the company's current plan inside EcoLogic to <span className="font-mono text-teal-300">{planChoice}</span>. Continue?</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => { callBilling('plan', { plan: planChoice, note: billingNote }, 'Plan Changed', `Plan is now ${planChoice}`); setConfirmPlanChange(false); setPlanChoice(''); }}
                        disabled={billingPending === 'plan'} className="bg-teal-600 hover:bg-teal-700 h-9">
                        {billingPending === 'plan' ? 'Saving…' : 'Yes, Apply Plan'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmPlanChange(false)} className="border-slate-600 text-slate-400 h-9">Cancel</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── CHANGE USER LIMIT ──────────────────────────── */}
              <div className="space-y-2.5 pt-4 border-t border-slate-800">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Change User Limit</p>
                  <p className="text-xs text-slate-600 mt-0.5">Control how many people this company can have in the app.</p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={unlimitedToggle} onCheckedChange={setUnlimitedToggle} className="data-[state=checked]:bg-violet-600" />
                  <Label className="text-sm text-slate-300">Unlimited Users</Label>
                </div>
                {!unlimitedToggle && (
                  <input value={seatInput} onChange={e => setSeatInput(e.target.value)} placeholder="e.g. 25"
                    type="number" min={1}
                    className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-teal-500 transition-colors" />
                )}
                <Button onClick={() => setConfirmLimitChange(true)}
                  disabled={billingPending === 'user-limit' || (!unlimitedToggle && !seatInput)}
                  className="w-full h-10 bg-slate-700 hover:bg-slate-600 text-slate-200">
                  Apply User Limit
                </Button>
                {confirmLimitChange && (
                  <div className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-3">
                    <p className="text-sm text-slate-200 mb-3 font-medium">
                      This will set the user limit to {unlimitedToggle ? 'unlimited' : seatInput}. Continue?
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => { callBilling('user-limit', { limit: unlimitedToggle ? null : parseInt(seatInput), unlimited: unlimitedToggle, note: billingNote }, 'User Limit Updated'); setConfirmLimitChange(false); }}
                        disabled={billingPending === 'user-limit'} className="bg-teal-600 hover:bg-teal-700 h-9">
                        {billingPending === 'user-limit' ? 'Saving…' : 'Yes, Apply Limit'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmLimitChange(false)} className="border-slate-600 text-slate-400 h-9">Cancel</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── TRIAL ACCESS ───────────────────────────────── */}
              <div className="space-y-2.5 pt-4 border-t border-slate-800">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Trial Access</p>
                  <p className="text-xs text-slate-600 mt-0.5">Extend or update this company's trial period.{d.trialEndsAt ? ` Currently ends ${new Date(d.trialEndsAt).toLocaleDateString()}.` : ''}</p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => callBilling('trial', { days: 7, note: billingNote }, 'Trial Extended', 'Added 7 days to trial')}
                    disabled={billingPending === 'trial'}
                    variant="outline" className="flex-1 border-blue-800 text-blue-300 hover:bg-blue-950 h-10">
                    {billingPending === 'trial' ? '…' : '+ 7 Days'}
                  </Button>
                  <Button onClick={() => callBilling('trial', { days: 30, note: billingNote }, 'Trial Extended', 'Added 30 days to trial')}
                    disabled={billingPending === 'trial'}
                    variant="outline" className="flex-1 border-blue-800 text-blue-300 hover:bg-blue-950 h-10">
                    {billingPending === 'trial' ? '…' : '+ 30 Days'}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <input type="date" value={trialCustomDate} onChange={e => setTrialCustomDate(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500 transition-colors" />
                  <Button onClick={() => { if (trialCustomDate) { callBilling('trial', { endDate: trialCustomDate, note: billingNote }, 'Trial Updated', `Trial end set to ${trialCustomDate}`); setTrialCustomDate(''); }}}
                    disabled={!trialCustomDate || billingPending === 'trial'}
                    variant="outline" className="border-blue-800 text-blue-300 hover:bg-blue-950 h-10 px-4 shrink-0">
                    <Calendar className="w-4 h-4 mr-1.5" /> Set Date
                  </Button>
                </div>
              </div>

              {/* ── RETURN TO NORMAL ────────────────────────────── */}
              <div className="pt-4 border-t border-slate-800">
                {confirmRestore ? (
                  <div className="rounded-xl border border-red-800/60 bg-red-950/30 px-4 py-3.5">
                    <p className="text-sm text-red-200 font-medium mb-1">This will remove all manual billing changes and make this company follow normal billing rules again. Continue?</p>
                    <p className="text-xs text-red-400 mb-3">Bypass, free access, forced plan, and custom seat limits will all be cleared.</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => { callBilling('restore', { note: billingNote }, 'Billing Reset', 'All manual overrides removed'); setConfirmRestore(false); }}
                        disabled={billingPending === 'restore'} className="bg-red-700 hover:bg-red-600 h-9">
                        {billingPending === 'restore' ? 'Resetting…' : 'Yes, Return to Normal Billing'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmRestore(false)} className="border-slate-600 text-slate-400 h-9">Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmRestore(true)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-red-900/60 bg-red-950/20 hover:bg-red-950/40 hover:border-red-800 active:scale-[0.99] transition-all text-left">
                    <RotateCcw className="w-4 h-4 text-red-400 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-red-300">Return to Normal Billing</p>
                      <p className="text-xs text-red-500/80 mt-0.5">Remove all manual overrides — company follows normal subscription rules</p>
                    </div>
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </DevCard>

      {/* ── People ────────────────────────────────────────────────────────── */}
      <DevCard title={`People · ${companyUsers.length} member${companyUsers.length !== 1 ? 's' : ''}`} icon={Users}>
        {companyUsers.length === 0
          ? <p className="text-sm text-slate-500 italic">No members found</p>
          : <div className="space-y-1.5">
              {companyUsers.map((u: any) => (
                <button key={u.id} onClick={() => { setSelectedUser(u); setNewRole(u.role || ''); }}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${selectedUser?.id === u.id ? 'bg-teal-950 border-teal-600' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'}`}>
                  <User className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</p>
                    <p className="text-xs text-slate-500 truncate font-mono">{u.email}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {u.role && <Badge className="bg-teal-900 text-teal-300 border-teal-700 text-xs">{u.role}</Badge>}
                    <Badge className={`text-xs ${u.status === 'ACTIVE' ? 'bg-emerald-900 text-emerald-300 border-emerald-700' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>{u.status}</Badge>
                  </div>
                </button>
              ))}
            </div>
        }

        {selectedUser && (
          <div className="mt-4 pt-4 border-t border-slate-700 space-y-4">
            <div className="space-y-0">
              <Field label="User ID" value={selectedUser.id} mono />
              <Field label="Email" value={selectedUser.email} mono />
              <Field label="Role" value={selectedUser.role ? <Badge className="bg-teal-900 text-teal-300 border-teal-700">{selectedUser.role}</Badge> : '—'} />
              <Field label="Status" value={<Badge className={selectedUser.status === 'ACTIVE' ? 'bg-emerald-900 text-emerald-300 border-emerald-700' : 'bg-red-900 text-red-300 border-red-700'}>{selectedUser.status}</Badge>} />
              <Field label="Sub Bypass" value={selectedUser.subscriptionBypass ? <Badge className="bg-violet-900 text-violet-300 border-violet-700">Active</Badge> : '—'} />
              <Field label="Last Login" value={selectedUser.lastLoginAt ? new Date(selectedUser.lastLoginAt).toLocaleString() : '—'} />
            </div>
            <div className="space-y-3">
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
                <Button size="sm" onClick={() => userUpdateMutation.mutate({ userId: selectedUser.id, role: newRole, companyId: company.id })}
                  disabled={userUpdateMutation.isPending || !newRole || newRole === selectedUser.role}
                  className="bg-teal-600 hover:bg-teal-700">
                  Apply Role
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline"
                  onClick={() => userUpdateMutation.mutate({ userId: selectedUser.id, status: selectedUser.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
                  disabled={userUpdateMutation.isPending}
                  className={selectedUser.status === 'ACTIVE' ? 'border-red-700 text-red-300 hover:bg-red-950' : 'border-emerald-700 text-emerald-300 hover:bg-emerald-950'}>
                  {selectedUser.status === 'ACTIVE' ? <><XCircle className="w-3.5 h-3.5 mr-1.5" /> Deactivate</> : <><CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Activate</>}
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => userUpdateMutation.mutate({ userId: selectedUser.id, subscriptionBypass: !selectedUser.subscriptionBypass })}
                  disabled={userUpdateMutation.isPending}
                  className="border-violet-700 text-violet-300 hover:bg-violet-950">
                  {selectedUser.subscriptionBypass ? 'Revoke Sub Bypass' : 'Grant Sub Bypass'}
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => userUpdateMutation.mutate({ userId: selectedUser.id, resetOnboarding: true })}
                  disabled={userUpdateMutation.isPending}
                  className="border-slate-600 text-slate-300 hover:bg-slate-800">
                  Reset Onboarding
                </Button>
              </div>
            </div>
          </div>
        )}
      </DevCard>

      {/* ── Jobs ──────────────────────────────────────────────────────────── */}
      <DevCard title={`Jobs · ${companyJobs.length} recent`} icon={Briefcase} collapsible>
        {companyJobs.length === 0
          ? <p className="text-sm text-slate-500 italic">No jobs found</p>
          : <div className="space-y-1 max-h-72 overflow-y-auto">
              {companyJobs.map((j: any) => (
                <div key={j.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{j.title || `Job #${j.id}`}</p>
                    <p className="text-xs text-slate-500">ID: {j.id} · {j.scheduledDate ? new Date(j.scheduledDate).toLocaleDateString() : 'No date'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={`text-xs ${statusColor[j.status] || 'bg-slate-700 text-slate-400'}`}>{j.status}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/jobs/${j.id}`)}
                      className="h-7 w-7 p-0 text-slate-500 hover:text-slate-200">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
        }
      </DevCard>

      {/* ── Payments ──────────────────────────────────────────────────────── */}
      <DevCard title={`Payments · ${companyInvoices.length} invoices`} icon={DollarSign} collapsible>
        {companyInvoices.length === 0
          ? <p className="text-sm text-slate-500 italic">No invoices found</p>
          : <div className="space-y-2 max-h-80 overflow-y-auto">
              {companyInvoices.map((inv: any) => {
                const invPayments = companyPayments.filter((p: any) => p.invoiceId === inv.id);
                return (
                  <div key={inv.id} className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-200">Invoice #{inv.id}</span>
                      <Badge className={`text-xs ${invoiceStatusColor[inv.status] || 'bg-slate-700 text-slate-400'}`}>{inv.status}</Badge>
                    </div>
                    <div className="flex gap-4 text-xs text-slate-400">
                      <span>Total: <span className="font-mono text-slate-200">${inv.totalAmount || '0.00'}</span></span>
                      <span>Paid: <span className="font-mono text-slate-200">${inv.paidAmount || '0.00'}</span></span>
                      <span>Due: <span className="font-mono text-slate-200">${inv.balanceDue || '0.00'}</span></span>
                    </div>
                    {invPayments.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {invPayments.map((p: any) => (
                          <div key={p.id} className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                            <span className="text-slate-400">${p.amount}</span>
                            <span>·</span>
                            <span>{p.paymentMethod}</span>
                            <span>·</span>
                            <span className={p.status === 'COMPLETED' ? 'text-emerald-400' : 'text-amber-400'}>{p.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
        }
      </DevCard>

      {/* ── Internal Snapshot ─────────────────────────────────────────────── */}
      <DevCard title="Internal Snapshot" icon={Download} collapsible>
        <JsonViewer data={{ company, owner, memberCount, billing, billingDetail: d, users: companyUsers, jobs: companyJobs, invoices: companyInvoices }} label="Full Company Debug Payload" />
      </DevCard>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <ConfirmModal
        open={!!confirmPause}
        title={confirmPause === 'pause' ? 'Pause Company Access' : 'Restore Company Access'}
        description={confirmPause === 'pause'
          ? `This will mark ${company.name} as paused. They will still exist in the DB but cannot access EcoLogic.`
          : `Restore full access for ${company.name}.`}
        danger={confirmPause === 'pause'}
        onConfirm={() => { if (confirmPause) statusMutation.mutate({ paused: confirmPause === 'pause' }); setConfirmPause(null); }}
        onCancel={() => setConfirmPause(null)}
      />


      {showNoteEditor && (
        <AlertDialog open>
          <AlertDialogContent className="bg-slate-900 border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">Edit Internal Note</AlertDialogTitle>
            </AlertDialogHeader>
            <Textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Internal note…"
              className="bg-slate-800 border-slate-600 text-slate-200 placeholder-slate-600 min-h-24 resize-none" />
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setShowNoteEditor(false)} className="border-slate-600 text-slate-300 hover:bg-slate-800">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { statusMutation.mutate({ note: noteText }); setShowNoteEditor(false); }}
                className="bg-teal-600 hover:bg-teal-700 text-white">Save Note</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

// ─── SESSION SECTION ─────────────────────────────────────────────────────────
function SessionSection() {
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
    <div className="space-y-4">
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

      <DevCard title="Feature Flags" icon={Shield} collapsible>
        <p className="text-xs text-slate-500 mb-4">Stored in localStorage. Affect dev-mode UI only.</p>
        <div className="space-y-3">
          {Object.keys(DEFAULT_FLAGS).map(key => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-200">{flagLabels[key] || key}</p>
                <p className="text-xs text-slate-500 font-mono">{key}</p>
              </div>
              <Switch checked={!!flags[key]} onCheckedChange={() => toggleFlag(key)} className="data-[state=checked]:bg-teal-600" />
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-slate-700">
          <Button size="sm" variant="outline"
            onClick={() => { saveFlags(DEFAULT_FLAGS); setFlags({ ...DEFAULT_FLAGS }); }}
            className="border-slate-600 text-slate-400 hover:bg-slate-800 gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Reset All Flags
          </Button>
        </div>
      </DevCard>
    </div>
  );
}

// ─── AUDIT LOGS SECTION ───────────────────────────────────────────────────────
function AuditLogsSection() {
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
    <DevCard title="Admin Audit Log" icon={ClipboardList} collapsible>
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
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
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
          </div>
        ))}
      </div>
    </DevCard>
  );
}

// ─── INTEGRATIONS SECTION ─────────────────────────────────────────────────────
function IntegrationsSection() {
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
      {ok === null ? <AlertCircle className="w-4 h-4 text-slate-500" />
        : ok ? <CheckCircle className="w-4 h-4 text-emerald-400" />
        : <XCircle className="w-4 h-4 text-slate-600" />}
    </div>
  );

  return (
    <DevCard title="Integration Status" icon={Wifi} collapsible>
      {isLoading && <p className="text-sm text-slate-400 animate-pulse">Checking integrations…</p>}
      {d && (
        <div className="space-y-3">
          <IntCard icon={CreditCard} label="Stripe" ok={d.stripe?.configured} detail={d.stripe?.keyPrefix ? `key: ${d.stripe.keyPrefix}…` : undefined} />
          <IntCard icon={RefreshCw} label="QuickBooks Online" ok={d.quickBooks?.connected} detail={d.quickBooks?.realmId ? `realm: ${d.quickBooks.realmId}` : 'Not connected'} />
          <IntCard icon={FileText} label="Email (Resend)" ok={d.email?.configured} detail={d.email?.from || undefined} />
          <IntCard icon={Bell} label="Push Notifications (APNs)" ok={d.pushNotifications?.configured} />
          <IntCard icon={Shield} label="Stripe Connect" ok={d.stripeConnect?.connected} detail={d.stripeConnect?.accountId || 'Not connected'} />
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
          <Button size="sm" variant="outline" onClick={() => refetch()} className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh Status
          </Button>
        </div>
      )}
    </DevCard>
  );
}

// ─── INSPECTOR SECTION ────────────────────────────────────────────────────────
function InspectorSection() {
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

  const methodColor: Record<string, string> = {
    GET: 'text-blue-400', POST: 'text-emerald-400', PUT: 'text-amber-400',
    PATCH: 'text-amber-400', DELETE: 'text-red-400',
  };
  const statusColor = (s: number | null) => {
    if (s === null) return 'text-slate-500';
    if (s < 300) return 'text-emerald-400';
    if (s < 400) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="space-y-4">
      <DevCard title="API Inspector" icon={Terminal} collapsible>
        <p className="text-xs text-slate-500 mb-3">Last 25 API requests from this session. Updates live.</p>
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
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
          <Button size="sm" variant="outline" onClick={() => { apiLog.length = 0; setEntries([]); }}
            className="border-slate-600 text-slate-400 hover:bg-slate-800 gap-1.5">
            <Trash2 className="w-3.5 h-3.5" /> Clear Log
          </Button>
        </div>
      </DevCard>

      <DevCard title="Dev Notes" icon={FileText} collapsible>
        <Textarea value={notes} onChange={e => saveNotes(e.target.value)}
          placeholder="Type temporary dev notes here… auto-saved to browser storage."
          className="bg-slate-800 border-slate-700 text-slate-200 placeholder-slate-600 min-h-28 font-mono text-sm resize-none" />
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline"
            onClick={() => {
              const summary = { timestamp: new Date().toISOString(), url: window.location.href, userAgent: navigator.userAgent, platform: detectPlatform(), flags: loadFlags(), notes };
              navigator.clipboard.writeText(JSON.stringify(summary, null, 2))
                .then(() => toast({ title: "Copied!", description: "Environment summary in clipboard" }));
            }}
            className="border-slate-600 text-slate-300 hover:bg-slate-800 gap-1.5">
            <Download className="w-3.5 h-3.5" /> Copy Environment Summary
          </Button>
          <Button size="sm" variant="outline" onClick={() => saveNotes('')}
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
  const { toast } = useToast();

  const [codeInput, setCodeInput] = useState('');
  const [lookupCode, setLookupCode] = useState('');
  const [consoleData, setConsoleData] = useState<any>(null);
  const [lookupError, setLookupError] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);

  useEffect(() => { installApiInterceptor(); }, []);

  const email = user?.email;
  const isAllowed = email && DEV_ALLOWLIST.includes(email);

  const handleLookup = async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setIsLookingUp(true);
    setLookupError('');
    setConsoleData(null);
    try {
      const res = await fetch(`/api/dev/admin/company/by-code/${code}`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) { setLookupError(json.error || 'Company not found'); return; }
      setLookupCode(code);
      setConsoleData(json);
    } catch (e: any) {
      setLookupError('Request failed — check console');
    } finally {
      setIsLookingUp(false);
    }
  };

  const toggleTool = (tool: string) => {
    setActiveTools(prev => prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool]);
  };

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
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-teal-900/60 border border-teal-700/40 shrink-0">
            <Shield className="w-5 h-5 text-teal-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-white tracking-widest uppercase">Developer Tools</h1>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">{email}</p>
          </div>
          <Badge className="shrink-0 bg-violet-900/60 text-violet-300 border-violet-700/60 text-[10px] font-bold tracking-widest px-2.5 py-1">
            DEV ONLY
          </Badge>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-7 space-y-6">

        {/* Company Lookup */}
        <div className="rounded-2xl border border-slate-700 bg-slate-900 overflow-hidden shadow-xl shadow-black/20">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/80 bg-slate-800/60">
            <div className="p-1.5 rounded-lg bg-teal-900/50 border border-teal-700/30 shrink-0">
              <Search className="w-4 h-4 text-teal-400" />
            </div>
            <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Company Lookup</h3>
          </div>
          <div className="px-5 py-5 space-y-5">
            <p className="text-sm text-slate-400 leading-relaxed">
              Enter a 6-character Company ID to open the full admin console — billing, team, jobs, payments, and more.
            </p>

            {/* Input + Button — stacked for clean mobile layout */}
            <div className="flex flex-col gap-3">
              <input
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.toUpperCase().slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                placeholder="e.g. YKUUC7"
                maxLength={6}
                className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3.5 text-lg font-mono font-semibold text-white placeholder-slate-600 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 tracking-[0.35em] uppercase transition-colors"
              />
              <Button onClick={handleLookup} disabled={isLookingUp || codeInput.length < 4}
                className="w-full h-12 bg-teal-600 hover:bg-teal-700 text-sm font-semibold gap-2 rounded-xl">
                {isLookingUp
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Looking up…</>
                  : <><Search className="w-4 h-4" /> Look Up Company</>}
              </Button>
            </div>

            {lookupError && (
              <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-red-950/50 border border-red-800/50">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-sm text-red-300">{lookupError}</p>
              </div>
            )}

            {/* Quick Load pills */}
            {!consoleData && !lookupError && (
              <div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-3">Quick Load</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { name: 'EcoLogic', id: 415, code: 'YKUUC7' },
                    { name: 'ZSL', id: 533, code: 'EHGYWQ' },
                  ].map(c => (
                    <button key={c.code}
                      onClick={() => setCodeInput(c.code)}
                      className="flex flex-col items-start px-4 py-3.5 rounded-xl bg-slate-800/80 border border-slate-700 hover:border-teal-700/60 hover:bg-slate-800 active:scale-[0.98] transition-all text-left">
                      <span className="text-sm font-semibold text-slate-200">{c.name}</span>
                      <span className="text-[10px] text-slate-600 mt-0.5">ID {c.id}</span>
                      <span className="text-sm font-mono font-bold text-teal-400 mt-2 tracking-widest">{c.code}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Company Console */}
        {consoleData && (
          <CompanyConsole
            companyCode={lookupCode}
            initialData={{ company: consoleData.company, owner: consoleData.owner, memberCount: consoleData.memberCount, billing: consoleData.billing }}
            onClear={() => { setConsoleData(null); setLookupCode(''); setCodeInput(''); }}
          />
        )}

        {/* Empty State — shown when no company is loaded */}
        {!consoleData && (
          <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
            <div className="p-5 rounded-2xl bg-slate-800/50 border border-slate-700/40 mb-5">
              <Building2 className="w-9 h-9 text-slate-600" />
            </div>
            <h3 className="text-base font-semibold text-slate-400 mb-2">Load a company to view its admin console</h3>
            <p className="text-sm text-slate-600 max-w-xs leading-relaxed">
              Use a 6-character Company ID above to open billing controls, team members, jobs, payments, and internal company details.
            </p>
          </div>
        )}

        {/* Internal Dev Tools */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/50 bg-slate-800/30">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Internal Dev Tools</p>
            <p className="text-xs text-slate-600 mt-0.5">Session, audit log, integrations, and API inspector</p>
          </div>
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'session', label: 'My Session', icon: User, desc: 'Auth & feature flags' },
                { key: 'audit', label: 'Audit Log', icon: ClipboardList, desc: 'Admin actions history' },
                { key: 'integrations', label: 'Integrations', icon: Wifi, desc: 'Third-party status' },
                { key: 'inspector', label: 'Inspector', icon: Terminal, desc: 'API log & dev notes' },
              ].map(({ key, label, icon: Icon, desc }) => (
                <button key={key} onClick={() => toggleTool(key)}
                  className={`flex flex-col items-start px-4 py-4 rounded-xl border transition-all active:scale-[0.98] text-left ${
                    activeTools.includes(key)
                      ? 'bg-teal-900/30 border-teal-700 text-teal-200'
                      : 'bg-slate-800 border-slate-700 hover:border-slate-600 hover:bg-slate-800/80'
                  }`}>
                  <div className="flex items-center justify-between w-full mb-2.5">
                    <div className={`p-1.5 rounded-lg ${activeTools.includes(key) ? 'bg-teal-900/60' : 'bg-slate-700/60'}`}>
                      <Icon className={`w-4 h-4 ${activeTools.includes(key) ? 'text-teal-400' : 'text-slate-400'}`} />
                    </div>
                    {activeTools.includes(key)
                      ? <ChevronDown className="w-4 h-4 text-teal-500" />
                      : <ChevronRight className="w-4 h-4 text-slate-600" />}
                  </div>
                  <p className={`text-sm font-semibold leading-tight ${activeTools.includes(key) ? 'text-teal-200' : 'text-slate-200'}`}>{label}</p>
                  <p className={`text-xs mt-1 leading-tight ${activeTools.includes(key) ? 'text-teal-500/80' : 'text-slate-500'}`}>{desc}</p>
                </button>
              ))}
            </div>

            {activeTools.includes('session') && <SessionSection />}
            {activeTools.includes('audit') && <AuditLogsSection />}
            {activeTools.includes('integrations') && <IntegrationsSection />}
            {activeTools.includes('inspector') && <InspectorSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
