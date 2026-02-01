import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTheme } from "@/components/ThemeProvider";
import { User, Moon, Sun, Bell, Shield, Camera, Upload } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import LanguageSelector from "@/components/LanguageSelector";
import CompanyInviteCode from "@/components/CompanyInviteCode";
import { BillingSection } from "@/components/BillingSection";
import { useCan } from "@/hooks/useCan";
import { formatPhoneInput, getRawPhoneValue } from "@shared/phoneUtils";
import DeleteAccountModal from "@/components/DeleteAccountModal";
import ChangePasswordModal from "@/components/ChangePasswordModal";

export default function Settings() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { can } = useCan();
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [notifications, setNotifications] = useState(true);
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [changePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
  const [profileData, setProfileData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: ""
  });
  const [emailAvailability, setEmailAvailability] = useState<'checking' | 'available' | 'taken' | null>(null);
  const [emailError, setEmailError] = useState<string>("");
  const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false);
  
  // Check if user can manage company (Owner/Supervisor only)
  const canManageCompany = can("org.view");

  // Initialize profile data when user loads
  useEffect(() => {
    if (user) {
      setProfileData({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phone: formatPhoneInput(user.phone || "")
      });
    }
  }, [user]);

  // Debounced email availability check (only when email changes from original)
  useEffect(() => {
    const checkEmailAvailability = async () => {
      // Don't check if email is the same as original
      if (!profileData.email || profileData.email === user?.email) {
        setEmailAvailability(null);
        setEmailError("");
        return;
      }

      // Basic email format validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileData.email)) {
        setEmailAvailability(null);
        return;
      }

      setEmailAvailability('checking');

      try {
        const response = await fetch(`/api/auth/email-available?email=${encodeURIComponent(profileData.email)}`);
        const data = await response.json();
        
        if (data.available) {
          setEmailAvailability('available');
          setEmailError("");
        } else {
          setEmailAvailability('taken');
          setEmailError("This email is currently in use");
        }
      } catch (error) {
        console.error("Email availability check failed:", error);
        setEmailAvailability(null);
        setEmailError("");
      }
    };

    const timeoutId = setTimeout(checkEmailAvailability, 500); // 500ms debounce
    return () => clearTimeout(timeoutId);
  }, [profileData.email, user?.email]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  // Profile picture upload mutation
  const updateProfilePictureMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/auth/user/profile-image", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to upload profile picture");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setProfileImagePreview(null);
      toast({
        title: "Success",
        description: "Profile picture updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update profile picture",
        variant: "destructive",
      });
    },
  });

  // Profile update mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: typeof profileData) => {
      const res = await apiRequest("PATCH", "/api/auth/user", {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: getRawPhoneValue(data.phone)
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        
        // Handle 409 EMAIL_IN_USE error
        if (res.status === 409 && errorData.code === 'EMAIL_IN_USE') {
          setEmailError("This email is currently in use");
          throw new Error("EMAIL_IN_USE");
        }
        
        throw new Error(errorData.message || "Failed to update profile");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Success",
        description: "Profile updated successfully",
      });
      setEmailError("");
    },
    onError: (error: Error) => {
      // Don't show toast for email in use - we show inline error instead
      if (error.message === "EMAIL_IN_USE") {
        return;
      }
      
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        toast({
          title: "Error",
          description: "Image size must be less than 5MB",
          variant: "destructive",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        setProfileImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImageUpload = () => {
    const file = fileInputRef.current?.files?.[0];
    if (file) {
      const formData = new FormData();
      formData.append("profileImage", file);
      updateProfilePictureMutation.mutate(formData);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t('settings.title')}</h1>
        <p className="text-slate-600 dark:text-slate-400">{t('settings.subtitle')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Profile Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Profile Picture Section */}
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Avatar className="w-20 h-20">
                  <AvatarImage src={profileImagePreview || user?.profileImageUrl || undefined} />
                  <AvatarFallback>
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
                <Button
                  size="sm"
                  variant="secondary"
                  className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full p-0 shadow-lg border-2 border-white dark:border-slate-800"
                  onClick={triggerFileInput}
                  disabled={updateProfilePictureMutation.isPending}
                >
                  <Camera className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1">
                <h3 className="font-medium">{user?.firstName} {user?.lastName}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">{user?.email}</p>
                {profileImagePreview && (
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      onClick={handleImageUpload}
                      disabled={updateProfilePictureMutation.isPending}
                      className="h-8 text-xs"
                    >
                      {updateProfilePictureMutation.isPending ? (
                        <>Uploading...</>
                      ) : (
                        <>
                          <Upload className="h-3 w-3 mr-1" />
                          Save
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setProfileImagePreview(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="h-8 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
            
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="hidden"
            />
            
            <div className="space-y-3">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input 
                  id="firstName" 
                  value={profileData.firstName}
                  onChange={(e) => setProfileData(prev => ({ ...prev, firstName: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input 
                  id="lastName" 
                  value={profileData.lastName}
                  onChange={(e) => setProfileData(prev => ({ ...prev, lastName: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input 
                  id="email" 
                  type="email" 
                  value={profileData.email}
                  onChange={(e) => setProfileData(prev => ({ ...prev, email: e.target.value }))}
                  className={emailError ? "border-red-500" : ""}
                  data-testid="input-email"
                />
                {emailError && (
                  <p className="text-sm text-red-500 mt-1">{emailError}</p>
                )}
                {emailAvailability === 'checking' && (
                  <p className="text-sm text-slate-500 mt-1">Checking availability...</p>
                )}
              </div>
              <div>
                <Label htmlFor="phone">Phone Number</Label>
                <Input 
                  id="phone" 
                  placeholder="555-123-4567"
                  value={profileData.phone}
                  onChange={(e) => setProfileData(prev => ({ ...prev, phone: formatPhoneInput(e.target.value) }))}
                  inputMode="numeric"
                  autoComplete="tel"
                />
              </div>
            </div>
            
            <Button 
              className="w-full"
              onClick={() => updateProfileMutation.mutate(profileData)}
              disabled={updateProfileMutation.isPending}
            >
              {updateProfileMutation.isPending ? "Updating..." : "Update Profile"}
            </Button>
          </CardContent>
        </Card>



        {/* Appearance & Language Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {theme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
              {t('settings.appearance')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="dark-mode">{t('settings.darkMode')}</Label>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {t('settings.darkModeDescription')}
                </p>
              </div>
              <Switch
                id="dark-mode"
                checked={theme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              />
            </div>
            
            <div className="border-t pt-4">
              <LanguageSelector variant="dropdown" showLabel={true} />
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                {t('settings.languageDescription')}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="notifications">Push Notifications</Label>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Receive notifications for important updates
                </p>
              </div>
              <Switch
                id="notifications"
                checked={notifications}
                onCheckedChange={setNotifications}
              />
            </div>
          </CardContent>
        </Card>

        {/* Company Management - Owner/Supervisor Only */}
        {canManageCompany && <CompanyInviteCode />}

        {/* Billing & Subscription - Owner Only */}
        {user?.role === 'OWNER' && (
          <div className="md:col-span-3">
            <BillingSection />
          </div>
        )}

        {/* Security Settings */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Button variant="outline" onClick={() => setChangePasswordModalOpen(true)}>Change Password</Button>
              <Button variant="outline">Two-Factor Authentication</Button>
              <Button variant="outline">Download Data</Button>
              <Button variant="destructive" onClick={() => setDeleteAccountModalOpen(true)}>Delete Account</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <ChangePasswordModal
        open={changePasswordModalOpen}
        onOpenChange={setChangePasswordModalOpen}
        userEmail={user?.email || undefined}
      />

      <DeleteAccountModal
        open={deleteAccountModalOpen}
        onOpenChange={setDeleteAccountModalOpen}
      />
    </div>
  );
}