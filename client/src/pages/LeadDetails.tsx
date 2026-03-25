import { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, User, Mail, Phone, MapPin, FileText, Loader2, FileCheck, AlertCircle, Megaphone, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { NewEstimateSheet } from "@/components/NewEstimateSheet";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import type { Customer } from "@shared/schema";

interface ErrorBoundaryProps {
  children: ReactNode;
  onBack: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class LeadDetailsErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[LeadDetails] Error boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
          <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
          <p className="text-slate-700 dark:text-slate-300 mb-4">Something went wrong loading this lead.</p>
          <Button variant="outline" onClick={this.props.onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Leads
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

interface LeadDetailsProps {
  leadId: string;
}

interface Lead {
  id: number;
  companyId: number;
  customerId: number | null;
  description: string | null;
  notes: string | null;
  status: string;
  source: string | null;
  campaignId: number | null;
  campaignSubject: string | null;
  interestMessage: string | null;
  campaignResponseAt: string | null;
  createdAt: string;
  customer?: Customer;
}

function safeFormatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return format(date, "MMM d, yyyy");
  } catch {
    return null;
  }
}

function LeadDetailsContent({ leadId }: LeadDetailsProps) {
  const [, navigate] = useLocation();
  const [estimateSheetOpen, setEstimateSheetOpen] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const numericLeadId = parseInt(leadId, 10);
  const isValidId = !isNaN(numericLeadId) && numericLeadId > 0;

  console.log("[LeadDetails] leadId:", leadId, "numericId:", numericLeadId, "isValid:", isValidId);

  const { data: lead, isLoading, error, refetch, isFetching } = useQuery<Lead>({
    queryKey: [`/api/leads/${leadId}`],
    enabled: isValidId,
    retry: false,
  });

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (error && isValidId && retryCount < 3) {
      const errorMessage = (error as any)?.message || '';
      const isNotFound = errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.toLowerCase().includes('not found');
      
      console.log("[LeadDetails] fetch error:", errorMessage, "retryCount:", retryCount, "isNotFound:", isNotFound);
      
      if (isNotFound) {
        const delays = [250, 500, 1000];
        const delay = delays[retryCount] || 1000;
        
        console.log("[LeadDetails] scheduling retry", retryCount + 1, "in", delay, "ms");
        setIsRetrying(true);
        
        retryTimeoutRef.current = setTimeout(() => {
          setRetryCount(prev => prev + 1);
          refetch();
        }, delay);
      }
    } else if (lead) {
      setIsRetrying(false);
    }
  }, [error, isValidId, retryCount, refetch, lead]);

  const updateLeadStatusMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/leads/${leadId}`, { status: "won" });
      if (!res.ok) throw new Error("Failed to update lead status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    },
  });

  const handleConvertToEstimate = () => {
    setEstimateSheetOpen(true);
  };

  const handleEstimateCreated = () => {
    setEstimateSheetOpen(false);
    updateLeadStatusMutation.mutate();
    navigate("/leads");
  };

  if (!isValidId) {
    console.log("[LeadDetails] invalid leadId, showing loading");
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (isLoading || isFetching || isRetrying) {
    console.log("[LeadDetails] loading state - isLoading:", isLoading, "isFetching:", isFetching, "isRetrying:", isRetrying);
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error && retryCount >= 3) {
    const errorMessage = (error as any)?.message || '';
    const isPermissionError = errorMessage.includes('401') || errorMessage.includes('403');
    
    console.log("[LeadDetails] error after retries exhausted:", errorMessage, "isPermissionError:", isPermissionError);
    
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <p className="text-slate-700 dark:text-slate-300 mb-4">
          {isPermissionError ? "You don't have permission to view this lead" : "Lead not found"}
        </p>
        <Button variant="outline" onClick={() => navigate("/leads")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Leads
        </Button>
      </div>
    );
  }

  if (error || !lead) {
    console.log("[LeadDetails] error or no lead, retrying...", "error:", error, "lead:", lead);
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  console.log("[LeadDetails] successfully loaded lead:", lead.id);

  const customerName = lead.customer
    ? `${lead.customer.firstName || ""} ${lead.customer.lastName || ""}`.trim() || "Customer"
    : "Lead";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate("/leads")}
            className="p-2 -ml-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate flex-1">
            {customerName}
          </h1>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {lead.customer && (
          <Button 
            onClick={handleConvertToEstimate}
            className="w-full"
          >
            <FileCheck className="h-4 w-4 mr-2" />
            Convert to Estimate
          </Button>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <User className="h-4 w-4 text-slate-500" />
              Customer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lead.customer ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                    <User className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {customerName}
                    </p>
                  </div>
                </div>

                {lead.customer.email && (
                  <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
                    <Mail className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate">{lead.customer.email}</span>
                  </div>
                )}

                {lead.customer.phone && (
                  <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
                    <Phone className="h-4 w-4 flex-shrink-0" />
                    <span>{lead.customer.phone}</span>
                  </div>
                )}

                {lead.customer.address && (
                  <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-400">
                    <MapPin className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{lead.customer.address}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">No customer information</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-500" />
              Description
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lead.description ? (
              <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                {lead.description}
              </p>
            ) : (
              <p className="text-sm text-slate-500 italic">No description provided</p>
            )}
            
            {safeFormatDate(lead.createdAt) && (
              <p className="text-xs text-slate-400 mt-4">
                Created {safeFormatDate(lead.createdAt)}
              </p>
            )}
          </CardContent>
        </Card>

        {lead.source === "campaign" && (
          <Card className="border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-blue-500" />
                Campaign Source
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lead.campaignSubject && (
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">Campaign</p>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{lead.campaignSubject}</p>
                </div>
              )}

              {lead.interestMessage && (
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5 flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" />
                    Customer's message
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-white dark:bg-slate-900 rounded-lg border border-blue-100 dark:border-blue-800 px-3 py-2.5">
                    {lead.interestMessage}
                  </p>
                </div>
              )}

              {lead.campaignResponseAt && safeFormatDate(lead.campaignResponseAt) && (
                <p className="text-xs text-blue-500 dark:text-blue-400">
                  Responded {safeFormatDate(lead.campaignResponseAt)}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <NewEstimateSheet
        open={estimateSheetOpen}
        onOpenChange={setEstimateSheetOpen}
        onEstimateCreated={handleEstimateCreated}
        initialCustomer={lead.customer || null}
      />
    </div>
  );
}

export default function LeadDetails({ leadId }: LeadDetailsProps) {
  const [, navigate] = useLocation();
  
  return (
    <LeadDetailsErrorBoundary onBack={() => navigate("/leads")}>
      <LeadDetailsContent leadId={leadId} />
    </LeadDetailsErrorBoundary>
  );
}
