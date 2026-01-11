import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ChevronLeft, Settings2, Upload, X, Building2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCan } from "@/hooks/useCan";

interface CompanyProfileData {
  name: string;
  logo: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  licenseNumber: string | null;
  defaultFooterText: string | null;
}

export default function CompanyProfile() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { can } = useCan();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [formData, setFormData] = useState<CompanyProfileData>({
    name: "",
    logo: null,
    phone: null,
    email: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    licenseNumber: null,
    defaultFooterText: null,
  });

  const { data: profile, isLoading } = useQuery<CompanyProfileData>({
    queryKey: ['/api/company/profile'],
    enabled: isAuthenticated && can('customize.manage'),
  });

  useEffect(() => {
    if (profile) {
      setFormData(profile);
      setIsDirty(false);
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: async (data: CompanyProfileData) => {
      const res = await apiRequest('PATCH', '/api/company/profile', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/company/profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/company'] });
      toast({ title: "Success", description: "Company profile updated" });
      setIsDirty(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update company profile", variant: "destructive" });
    },
  });

  const handleChange = (field: keyof CompanyProfileData, value: string | null) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: "Validation Error", description: "Company name is required", variant: "destructive" });
      return;
    }
    updateMutation.mutate(formData);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log("[CompanyLogo] selected file", file.name, file.type, file.size);

    // Validate type is PNG or JPG
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      toast({ title: "Invalid file", description: "Please select a PNG or JPG image", variant: "destructive" });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Please select an image under 5MB", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);
      
      console.log("[CompanyLogo] uploading to /api/upload...");
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formDataUpload,
        credentials: 'include',
      });
      
      const responseText = await res.text();
      console.log("[CompanyLogo] response", res.status, responseText);
      
      if (!res.ok) {
        const errorData = JSON.parse(responseText);
        throw new Error(errorData.error || 'Upload failed');
      }
      
      const { url } = JSON.parse(responseText);
      console.log("[CompanyLogo] got url:", url);
      handleChange('logo', url);
      toast({ title: "Success", description: "Logo uploaded" });
    } catch (error: any) {
      console.error("[CompanyLogo] error:", error);
      toast({ title: "Error", description: error.message || "Failed to upload logo", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const removeLogo = () => {
    handleChange('logo', null);
  };

  if (authLoading) {
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
          <Settings2 className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">Not Authorized</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Only Owners can access the company profile.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/customize">
          <button className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
          </button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Company Profile
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            This information appears on estimates, invoices, and customer documents
          </p>
        </div>
        <Button 
          onClick={handleSubmit}
          disabled={!isDirty || updateMutation.isPending}
          className="bg-teal-600 hover:bg-teal-700 disabled:opacity-50"
        >
          {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Company Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Your Company Name"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Company Logo</Label>
              <div className="flex items-start gap-4">
                {formData.logo ? (
                  <div className="relative">
                    <img 
                      src={formData.logo} 
                      alt="Company logo" 
                      className="w-24 h-24 object-contain rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      onClick={removeLogo}
                      className="absolute -top-2 -right-2 p-1 bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 rounded-full hover:bg-red-200 dark:hover:bg-red-800"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center bg-slate-50 dark:bg-slate-900">
                    <Building2 className="h-8 w-8 text-slate-400" />
                  </div>
                )}
                <div className="flex-1">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleLogoUpload}
                    accept="image/png,image/jpeg"
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    Upload Logo
                  </Button>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    PNG or JPG, max 5MB
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone || ""}
                  onChange={(e) => handleChange('phone', e.target.value || null)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email || ""}
                  onChange={(e) => handleChange('email', e.target.value || null)}
                  placeholder="contact@company.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="addressLine1">Address Line 1</Label>
              <Input
                id="addressLine1"
                value={formData.addressLine1 || ""}
                onChange={(e) => handleChange('addressLine1', e.target.value || null)}
                placeholder="123 Main Street"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="addressLine2">Address Line 2</Label>
              <Input
                id="addressLine2"
                value={formData.addressLine2 || ""}
                onChange={(e) => handleChange('addressLine2', e.target.value || null)}
                placeholder="Suite 100"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={formData.city || ""}
                  onChange={(e) => handleChange('city', e.target.value || null)}
                  placeholder="City"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={formData.state || ""}
                  onChange={(e) => handleChange('state', e.target.value || null)}
                  placeholder="CA"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="postalCode">ZIP Code</Label>
                <Input
                  id="postalCode"
                  value={formData.postalCode || ""}
                  onChange={(e) => handleChange('postalCode', e.target.value || null)}
                  placeholder="12345"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value={formData.country || ""}
                  onChange={(e) => handleChange('country', e.target.value || null)}
                  placeholder="US"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="licenseNumber">License Number</Label>
              <Input
                id="licenseNumber"
                value={formData.licenseNumber || ""}
                onChange={(e) => handleChange('licenseNumber', e.target.value || null)}
                placeholder="e.g., CA-123456"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="defaultFooterText">Default Footer Text</Label>
              <Textarea
                id="defaultFooterText"
                value={formData.defaultFooterText || ""}
                onChange={(e) => handleChange('defaultFooterText', e.target.value || null)}
                placeholder="Licensed & insured. Thank you for your business."
                rows={3}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                This text can be used in estimate and invoice footers
              </p>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
