import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, FileText, DollarSign, Calendar, Camera, Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertInvoiceSchema, type InsertInvoice, type Invoice } from "@shared/schema";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorBoundary, InvoiceErrorFallback } from "@/components/ErrorBoundary";

function CreateInvoiceForm({ onSubmit, isLoading }: { onSubmit: (data: any) => void; isLoading: boolean }) {
  const { toast } = useToast();
  
  // Fetch clients for selection
  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  const [formData, setFormData] = useState({
    invoiceNumber: `INV-${Date.now()}`,
    amount: "",
    clientId: "none",
    status: "pending",
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: "",
  });

  const [isScanning, setIsScanning] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scanInvoiceMutation = useMutation({
    mutationFn: async (imageData: string) => {
      const res = await apiRequest("POST", "/api/scan-invoice", { imageData });
      return await res.json();
    },
    onSuccess: (extractedData) => {
      setFormData({
        ...formData,
        ...extractedData,
        invoiceNumber: extractedData.invoiceNumber || formData.invoiceNumber,
      });
      toast({
        title: "Invoice Scanned Successfully",
        description: "Invoice details have been automatically filled",
      });
      setIsScanning(false);
      setCapturedImage(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Scan Failed",
        description: error.message || "Could not extract invoice details",
        variant: "destructive",
      });
      setIsScanning(false);
    },
  });

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } // Use back camera on mobile
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsScanning(true);
      }
    } catch (error) {
      toast({
        title: "Camera Error",
        description: "Could not access camera. Please try uploading an image instead.",
        variant: "destructive",
      });
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        const imageData = canvas.toDataURL('image/jpeg', 0.8);
        setCapturedImage(imageData);
        
        // Stop camera
        const stream = video.srcObject as MediaStream;
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
        
        // Process the image
        scanInvoiceMutation.mutate(imageData);
      }
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = e.target?.result as string;
        setCapturedImage(imageData);
        scanInvoiceMutation.mutate(imageData);
      };
      reader.readAsDataURL(file);
    }
  };

  const stopScanning = () => {
    if (videoRef.current) {
      const stream = videoRef.current.srcObject as MediaStream;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    }
    setIsScanning(false);
    setCapturedImage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.amount || formData.amount === "") {
      alert("Amount is required");
      return;
    }
    
    const submitData = {
      invoiceNumber: formData.invoiceNumber,
      clientId: formData.clientId === "none" ? null : parseInt(formData.clientId),
      amount: formData.amount,
      status: formData.status,
      issueDate: formData.issueDate,
      dueDate: formData.dueDate,
      notes: formData.notes,
    };
    
    await onSubmit(submitData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Invoice Scanning Section */}
      <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-4">
        <div className="text-center space-y-3">
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Scan Invoice with AI
          </h3>
          
          {isScanning ? (
            <div className="space-y-3">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full max-w-sm mx-auto rounded-lg"
              />
              <div className="flex gap-2 justify-center">
                <Button type="button" onClick={capturePhoto} disabled={scanInvoiceMutation.isPending}>
                  <Camera className="w-4 h-4 mr-2" />
                  Capture
                </Button>
                <Button type="button" variant="outline" onClick={stopScanning}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 justify-center">
              <Button type="button" variant="outline" onClick={startCamera}>
                <Camera className="w-4 h-4 mr-2" />
                Take Photo
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => fileInputRef.current?.click()}
                disabled={scanInvoiceMutation.isPending}
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload Image
              </Button>
            </div>
          )}
          
          {scanInvoiceMutation.isPending && (
            <p className="text-sm text-blue-600 dark:text-blue-400">
              Analyzing invoice with AI...
            </p>
          )}
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          
          <canvas ref={canvasRef} className="hidden" />
        </div>
      </div>

      <div>
        <label className="text-sm font-medium">Invoice Number</label>
        <Input 
          value={formData.invoiceNumber}
          onChange={(e) => setFormData({...formData, invoiceNumber: e.target.value})}
          placeholder="INV-001"
        />
      </div>
      
      <div>
        <label className="text-sm font-medium">Client {(!clients || clients.length === 0) && "(Optional)"}</label>
        <Select 
          value={formData.clientId} 
          onValueChange={(value) => setFormData({...formData, clientId: value})}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No client</SelectItem>
            {clients && Array.isArray(clients) && clients.length > 0 && (
              clients.map((client: any) => (
                <SelectItem key={client?.id || 'unknown'} value={client?.id?.toString() || 'unknown'}>
                  {client?.name || 'Unknown Client'}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      
      <div>
        <label className="text-sm font-medium">Amount *</label>
        <Input 
          type="text" 
          value={formData.amount}
          onChange={(e) => setFormData({...formData, amount: e.target.value})}
          placeholder="1500.00"
          required
        />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Issue Date</label>
          <Input 
            type="date" 
            value={formData.issueDate}
            onChange={(e) => setFormData({...formData, issueDate: e.target.value})}
          />
        </div>
        
        <div>
          <label className="text-sm font-medium">Due Date</label>
          <Input 
            type="date" 
            value={formData.dueDate}
            onChange={(e) => setFormData({...formData, dueDate: e.target.value})}
          />
        </div>
      </div>
      
      <div>
        <label className="text-sm font-medium">Notes</label>
        <Textarea 
          value={formData.notes}
          onChange={(e) => setFormData({...formData, notes: e.target.value})}
          placeholder="Payment terms and additional notes..."
        />
      </div>
      
      <Button 
        type="submit" 
        className="w-full" 
        disabled={isLoading}
      >
        {isLoading ? "Creating..." : "Create Invoice"}
      </Button>
    </form>
  );
}

export default function Invoicing() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: invoices = [], isLoading: invoicesLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
    enabled: isAuthenticated,
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (invoiceData: InsertInvoice) => {
      console.log("Sending invoice data:", invoiceData);
      try {
        const res = await apiRequest("POST", "/api/invoices", invoiceData);
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        return await res.json();
      } catch (error) {
        console.error("Invoice creation failed:", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Invoice created successfully",
      });
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      console.error("Invoice creation error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create invoice",
        variant: "destructive",
      });
      // Don't close the dialog on error so user can try again
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Authentication Required</h2>
          <p className="text-muted-foreground">Please log in to access invoicing.</p>
        </div>
      </div>
    );
  }

  if (invoicesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Invoicing</h1>
        <p className="text-slate-600 dark:text-slate-400">Create and manage invoices for your projects</p>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[350px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Generate New Invoice</DialogTitle>
          </DialogHeader>
          <ErrorBoundary fallback={InvoiceErrorFallback}>
            <CreateInvoiceForm onSubmit={createInvoiceMutation.mutate} isLoading={createInvoiceMutation.isPending} />
          </ErrorBoundary>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Invoices ({invoices.length})
        </h3>
        <Button onClick={() => {
          console.log("Create Invoice button clicked");
          setIsDialogOpen(true);
        }}>
          <Plus className="w-4 h-4 mr-2" />
          Create Invoice
        </Button>
      </div>

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No invoices yet</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Start billing your clients by creating your first invoice.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Invoice
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {invoices.map((invoice: any) => (
            <Card key={invoice.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  Invoice #{invoice.id}
                </CardTitle>
                <Badge variant={invoice.status === 'paid' ? 'default' : 'secondary'}>
                  {invoice.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {invoice.client && (
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {invoice.client.name}
                  </p>
                )}
                {invoice.amount && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <DollarSign className="h-4 w-4" />
                    ${invoice.amount.toLocaleString()}
                  </div>
                )}
                {invoice.dueDate && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                    <Calendar className="h-4 w-4" />
                    Due: {new Date(invoice.dueDate).toLocaleDateString()}
                  </div>
                )}
                
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500">
                    Created {new Date(invoice.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

    </div>
  );
}