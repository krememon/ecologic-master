import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, User, Mail, Phone, MapPin, FileText, Loader2, FileCheck } from "lucide-react";
import { format } from "date-fns";
import { NewEstimateSheet } from "@/components/NewEstimateSheet";
import type { Customer } from "@shared/schema";

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
  createdAt: string;
  customer?: Customer;
}

export default function LeadDetails({ leadId }: LeadDetailsProps) {
  const [, navigate] = useLocation();
  const [estimateSheetOpen, setEstimateSheetOpen] = useState(false);

  const { data: lead, isLoading, error } = useQuery<Lead>({
    queryKey: [`/api/leads/${leadId}`],
    enabled: !!leadId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4">
        <p className="text-red-500 mb-4">Failed to load lead details</p>
        <button
          onClick={() => navigate("/leads")}
          className="text-blue-600 hover:underline"
        >
          Back to Leads
        </button>
      </div>
    );
  }

  const customerName = lead.customer
    ? `${lead.customer.firstName || ""} ${lead.customer.lastName || ""}`.trim()
    : "Lead";

  const handleConvertToEstimate = () => {
    setEstimateSheetOpen(true);
  };

  const handleEstimateCreated = () => {
    setEstimateSheetOpen(false);
    navigate("/leads");
  };

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
            
            {lead.createdAt && (
              <p className="text-xs text-slate-400 mt-4">
                Created {format(new Date(lead.createdAt), "MMM d, yyyy")}
              </p>
            )}
          </CardContent>
        </Card>
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
