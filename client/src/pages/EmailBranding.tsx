import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Loader2, ChevronLeft, Upload, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EmailBranding {
  id?: number;
  companyId?: number;
  headerBannerUrl?: string | null;
  fromName?: string | null;
  replyToEmail?: string | null;
  footerText?: string | null;
  showPhone?: boolean | null;
  showAddress?: boolean | null;
}

export default function EmailBranding() {
  const { isLoading: authLoading } = useAuth();
  const { can } = useCan();
  const { toast } = useToast();
  
  const [headerBannerUrl, setHeaderBannerUrl] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [footerText, setFooterText] = useState("");
  const [showPhone, setShowPhone] = useState(true);
  const [showAddress, setShowAddress] = useState(true);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  const { data: branding, isLoading } = useQuery<EmailBranding>({
    queryKey: ['/api/company/email-branding'],
  });

  const { data: company } = useQuery<{ name?: string; phone?: string; addressLine1?: string; city?: string; state?: string; postalCode?: string }>({
    queryKey: ['/api/company'],
  });

  useEffect(() => {
    if (branding) {
      setHeaderBannerUrl(branding.headerBannerUrl || "");
      setFromName(branding.fromName || "");
      setReplyToEmail(branding.replyToEmail || "");
      setFooterText(branding.footerText || "");
      setShowPhone(branding.showPhone ?? true);
      setShowAddress(branding.showAddress ?? true);
    }
  }, [branding]);

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<EmailBranding>) => {
      return apiRequest('PUT', '/api/company/email-branding', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/company/email-branding'] });
      toast({ title: "Saved", description: "Email branding settings saved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save settings", variant: "destructive" });
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/company/email-branding/test');
    },
    onSuccess: (data: any) => {
      toast({ title: "Test Email Sent", description: data.message || "Check your inbox" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to send test email", variant: "destructive" });
    },
  });

  const handleUploadBanner = async (file: File) => {
    setUploadingBanner(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Upload failed');
      }
      
      const data = await response.json();
      const url = data.url || data.fileUrl;
      
      if (!url) {
        throw new Error('No URL returned from upload');
      }
      
      setHeaderBannerUrl(url);
      
      await apiRequest('PUT', '/api/company/email-branding', {
        headerBannerUrl: url,
        fromName: fromName || null,
        replyToEmail: replyToEmail || null,
        footerText: footerText || null,
        showPhone,
        showAddress,
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/company/email-branding'] });
      toast({ title: "Uploaded & Saved", description: "Header image uploaded and saved" });
    } catch (error: any) {
      toast({ title: "Upload Failed", description: error.message || "Failed to upload", variant: "destructive" });
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleSave = () => {
    saveMutation.mutate({
      headerBannerUrl: headerBannerUrl || null,
      fromName: fromName || null,
      replyToEmail: replyToEmail || null,
      footerText: footerText || null,
      showPhone,
      showAddress,
    });
  };

  const handleRemoveHeaderImage = () => {
    setHeaderBannerUrl("");
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (!can('customize.manage')) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-8 text-center shadow-sm border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">Not Authorized</h2>
          <p className="text-slate-600 dark:text-slate-400">Only Owners can access email branding settings.</p>
        </div>
      </div>
    );
  }

  const displayFromName = fromName || company?.name || "Your Company";
  const footerParts: string[] = [];
  if (showPhone && company?.phone) {
    footerParts.push(`Phone: ${company.phone}`);
  }
  if (showAddress && company?.addressLine1) {
    const addr = [company.addressLine1, company.city, company.state, company.postalCode].filter(Boolean).join(', ');
    footerParts.push(addr);
  }
  if (footerText) {
    footerParts.push(footerText);
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="mb-6">
        <Link href="/customize">
          <button className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 mb-2">
            <ChevronLeft className="h-4 w-4" />
            Customize
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Email Branding
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Customize how your campaign emails look to customers
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Email Header</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Header Image</Label>
                <p className="text-xs text-slate-500 mb-3">Upload a custom header image for your emails</p>
                
                {headerBannerUrl ? (
                  <div className="space-y-3">
                    <div className="relative inline-block">
                      <img 
                        src={headerBannerUrl} 
                        alt="Header" 
                        className="max-w-full h-auto rounded-lg border border-slate-200 dark:border-slate-600" 
                        style={{ maxHeight: '120px' }}
                      />
                      <button
                        onClick={handleRemoveHeaderImage}
                        className="absolute -top-2 -right-2 w-7 h-7 min-w-0 p-0 bg-red-500 text-white rounded-full grid place-items-center leading-none hover:bg-red-600 transition-colors shadow-md"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div>
                      <label className="cursor-pointer inline-block">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadBanner(file);
                            e.target.value = '';
                          }}
                        />
                        <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors">
                          {uploadingBanner ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          Change
                        </div>
                      </label>
                    </div>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadBanner(file);
                        e.target.value = '';
                      }}
                    />
                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center hover:border-teal-500 dark:hover:border-teal-400 transition-colors">
                      {uploadingBanner ? (
                        <Loader2 className="h-8 w-8 animate-spin mx-auto text-slate-400" />
                      ) : (
                        <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                      )}
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                        {uploadingBanner ? 'Uploading...' : 'Click to upload header image'}
                      </p>
                    </div>
                  </label>
                )}
                <p className="text-xs text-slate-500 mt-2">Recommended size: 1200 x 300 pixels</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Sender Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="fromName">From Name</Label>
                <Input
                  id="fromName"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder={company?.name || "Your Company Name"}
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">Display name shown in the email header</p>
              </div>
              
              <div>
                <Label htmlFor="replyToEmail">Reply-To Email</Label>
                <Input
                  id="replyToEmail"
                  type="email"
                  value={replyToEmail}
                  onChange={(e) => setReplyToEmail(e.target.value)}
                  placeholder="support@yourcompany.com"
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">Where customer replies will go</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Footer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="showPhone">Show Phone Number</Label>
                  <p className="text-xs text-slate-500">Include company phone in footer</p>
                </div>
                <Switch
                  id="showPhone"
                  checked={showPhone}
                  onCheckedChange={setShowPhone}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="showAddress">Show Address</Label>
                  <p className="text-xs text-slate-500">Include company address in footer</p>
                </div>
                <Switch
                  id="showAddress"
                  checked={showAddress}
                  onCheckedChange={setShowAddress}
                />
              </div>
              
              <div>
                <Label htmlFor="footerText">Custom Footer Text</Label>
                <Textarea
                  id="footerText"
                  value={footerText}
                  onChange={(e) => setFooterText(e.target.value)}
                  placeholder="Thank you for choosing us!"
                  className="mt-1"
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saveMutation.isPending} className="flex-1">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Settings
            </Button>
            <Button 
              variant="outline" 
              onClick={() => testEmailMutation.mutate()}
              disabled={testEmailMutation.isPending}
            >
              {testEmailMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send Test
            </Button>
          </div>
        </div>

        <div>
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle className="text-lg">Live Preview</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="bg-slate-100 dark:bg-slate-700 p-4 rounded-b-lg">
                <div className="bg-white rounded-lg overflow-hidden shadow-sm max-w-[400px] mx-auto">
                  {headerBannerUrl ? (
                    <img 
                      src={headerBannerUrl} 
                      alt="Email header" 
                      className="w-full h-auto"
                    />
                  ) : (
                    <div className="h-16 bg-slate-200 dark:bg-slate-600 flex items-center justify-center">
                      <p className="text-xs text-slate-500 dark:text-slate-400">No header image</p>
                    </div>
                  )}
                  <div className="p-6">
                    <h2 className="text-lg font-semibold text-slate-800 mb-3">Sample Email Subject</h2>
                    <p className="text-sm text-slate-600 mb-4">
                      This is a preview of how your campaign emails will look to customers. 
                      The styling you configure here will be applied automatically.
                    </p>
                    <div className="inline-block px-4 py-2 rounded text-white text-sm font-medium bg-teal-600">
                      Call to Action
                    </div>
                  </div>
                  {footerParts.length > 0 && (
                    <div className="px-6 py-4 bg-slate-50 border-t text-center">
                      {footerParts.map((part, i) => (
                        <p key={i} className="text-xs text-slate-500">{part}</p>
                      ))}
                    </div>
                  )}
                  <div className="px-6 py-3 bg-slate-50 border-t text-center">
                    <p className="text-[10px] text-slate-400">
                      To unsubscribe, reply to this email or contact {displayFromName} directly.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
