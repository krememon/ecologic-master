import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Loader2, ChevronLeft, Upload, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ImageCropModal from "@/components/ImageCropModal";

interface EmailBranding {
  id?: number;
  companyId?: number;
  logoUrl?: string | null;
  headerBannerUrl?: string | null;
  primaryColor?: string | null;
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
  
  const [logoUrl, setLogoUrl] = useState("");
  const [headerBannerUrl, setHeaderBannerUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#2563EB");
  const [fromName, setFromName] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [footerText, setFooterText] = useState("");
  const [showPhone, setShowPhone] = useState(true);
  const [showAddress, setShowAddress] = useState(true);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropMode, setCropMode] = useState<"logo" | "banner">("logo");

  const { data: branding, isLoading } = useQuery<EmailBranding>({
    queryKey: ['/api/company/email-branding'],
  });

  const { data: company } = useQuery<{ name?: string; phone?: string; addressLine1?: string; city?: string; state?: string; postalCode?: string }>({
    queryKey: ['/api/company'],
  });

  useEffect(() => {
    if (branding) {
      setLogoUrl(branding.logoUrl || "");
      setHeaderBannerUrl(branding.headerBannerUrl || "");
      setPrimaryColor(branding.primaryColor || "#2563EB");
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

  const openCropModal = (file: File, mode: "logo" | "banner") => {
    setCropFile(file);
    setCropMode(mode);
    setCropModalOpen(true);
  };

  const handleCroppedUpload = async (croppedFile: File) => {
    await handleUpload(croppedFile, cropMode);
  };

  const handleUpload = async (file: File, type: 'logo' | 'banner') => {
    if (type === 'logo') setUploadingLogo(true);
    else setUploadingBanner(true);
    
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
      
      // Update local state
      if (type === 'logo') {
        setLogoUrl(url);
      } else {
        setHeaderBannerUrl(url);
      }
      
      // Auto-save to server
      await apiRequest('PUT', '/api/company/email-branding', {
        logoUrl: type === 'logo' ? url : (logoUrl || null),
        headerBannerUrl: type === 'banner' ? url : (headerBannerUrl || null),
        primaryColor: primaryColor || '#2563EB',
        fromName: fromName || null,
        replyToEmail: replyToEmail || null,
        footerText: footerText || null,
        showPhone,
        showAddress,
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/company/email-branding'] });
      toast({ title: "Uploaded & Saved", description: `${type === 'logo' ? 'Logo' : 'Banner'} uploaded and saved` });
    } catch (error: any) {
      toast({ title: "Upload Failed", description: error.message || "Failed to upload", variant: "destructive" });
    } finally {
      if (type === 'logo') setUploadingLogo(false);
      else setUploadingBanner(false);
    }
  };

  const handleSave = () => {
    saveMutation.mutate({
      logoUrl: logoUrl || null,
      headerBannerUrl: headerBannerUrl || null,
      primaryColor: primaryColor || '#2563EB',
      fromName: fromName || null,
      replyToEmail: replyToEmail || null,
      footerText: footerText || null,
      showPhone,
      showAddress,
    });
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
              <CardTitle className="text-lg">Header</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Logo</Label>
                <div className="mt-2 flex items-center gap-3">
                  {logoUrl && (
                    <img src={logoUrl} alt="Logo" className="h-12 max-w-[120px] object-contain rounded border" />
                  )}
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) openCropModal(file, 'logo');
                        e.target.value = '';
                      }}
                    />
                    <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-sm">
                      {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {logoUrl ? 'Change' : 'Upload'}
                    </div>
                  </label>
                  {logoUrl && (
                    <Button variant="ghost" size="sm" onClick={() => setLogoUrl("")}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">Recommended: 200x60px PNG or SVG</p>
              </div>
              
              <div>
                <Label>Header Banner (optional)</Label>
                <div className="mt-2 flex items-center gap-3">
                  {headerBannerUrl && (
                    <img src={headerBannerUrl} alt="Banner" className="h-16 max-w-[200px] object-cover rounded border" />
                  )}
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) openCropModal(file, 'banner');
                        e.target.value = '';
                      }}
                    />
                    <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 text-sm">
                      {uploadingBanner ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {headerBannerUrl ? 'Change' : 'Upload'}
                    </div>
                  </label>
                  {headerBannerUrl && (
                    <Button variant="ghost" size="sm" onClick={() => setHeaderBannerUrl("")}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">Full-width banner above header. Recommended: 600x150px</p>
              </div>
              
              <div>
                <Label htmlFor="primaryColor">Brand Color</Label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="color"
                    id="primaryColor"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-10 w-14 rounded cursor-pointer border border-slate-200"
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#2563EB"
                    className="w-28"
                  />
                </div>
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
                  placeholder="hello@yourcompany.com"
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 mt-1">Where replies will be sent</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Footer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="footerText">Footer Text</Label>
                <Textarea
                  id="footerText"
                  value={footerText}
                  onChange={(e) => setFooterText(e.target.value)}
                  placeholder="Additional information to show in the footer..."
                  className="mt-1"
                  rows={2}
                />
              </div>
              
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
                  {headerBannerUrl && (
                    <img src={headerBannerUrl} alt="Banner" className="w-full h-auto" />
                  )}
                  <div 
                    className="p-6 text-center"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {logoUrl ? (
                      <img src={logoUrl} alt="Logo" className="h-10 max-w-[150px] mx-auto object-contain" />
                    ) : (
                      <h1 className="text-xl font-bold text-white">{displayFromName}</h1>
                    )}
                  </div>
                  <div className="p-6">
                    <h2 className="text-lg font-semibold text-slate-800 mb-3">Sample Email Subject</h2>
                    <p className="text-sm text-slate-600 mb-4">
                      This is a preview of how your campaign emails will look to customers. 
                      The styling you configure here will be applied automatically.
                    </p>
                    <div 
                      className="inline-block px-4 py-2 rounded text-white text-sm font-medium"
                      style={{ backgroundColor: primaryColor }}
                    >
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

      <ImageCropModal
        open={cropModalOpen}
        onClose={() => {
          setCropModalOpen(false);
          setCropFile(null);
        }}
        file={cropFile}
        mode={cropMode}
        onCropped={handleCroppedUpload}
      />
    </div>
  );
}
