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
import { Settings as SettingsIcon, User, Moon, Sun, Bell, Shield, Camera, Upload, Globe, CheckCircle, Mail, X } from "lucide-react";
import { FaGoogle } from "react-icons/fa";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import LanguageSelector from "@/components/LanguageSelector";
import CompanyInviteCode from "@/components/CompanyInviteCode";

export default function Settings() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [notifications, setNotifications] = useState(true);
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const { data: company = {} } = useQuery<any>({
    queryKey: ["/api/company"],
    enabled: isAuthenticated,
  });

  // Fetch linked accounts for authentication methods section
  const { data: linkedAccounts, isLoading: linkedAccountsLoading, error: linkedAccountsError } = useQuery<{
    hasEmailPassword: boolean;
    hasGoogle: boolean;
    profileImageUrl?: string;
  }>({
    queryKey: ["/api/auth/linked-accounts"],
    enabled: isAuthenticated,
    retry: false,
  });

  // Handle URL parameters for Google account linking feedback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const error = urlParams.get('error');
    const message = urlParams.get('message');

    if (success === 'google_linked') {
      toast({
        title: "Google Account Linked",
        description: message || "Your Google account has been successfully linked.",
      });
      // Refresh linked accounts data
      queryClient.invalidateQueries({ queryKey: ["/api/auth/linked-accounts"] });
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (error === 'email_mismatch') {
      toast({
        title: "Email Mismatch",
        description: message || "The Google account email doesn't match your current account.",
        variant: "destructive",
      });
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [toast]);

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
                <Input id="firstName" defaultValue={user?.firstName || ""} />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" defaultValue={user?.lastName || ""} />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" defaultValue={user?.email || ""} />
              </div>
            </div>
            
            <Button className="w-full">Update Profile</Button>
          </CardContent>
        </Card>



        {/* Company Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5" />
              Company
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="companyName">Company Name</Label>
              <Input id="companyName" defaultValue={company?.name || ""} />
            </div>
            <div>
              <Label htmlFor="companyEmail">Company Email</Label>
              <Input id="companyEmail" type="email" defaultValue={company?.email || ""} />
            </div>
            <div>
              <Label htmlFor="companyPhone">Phone Number</Label>
              <Input id="companyPhone" defaultValue={company?.phone || ""} />
            </div>
            
            <Button className="w-full">Update Company</Button>
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

        {/* Company Management */}
        <CompanyInviteCode />

        {/* Authentication Methods */}
        <Card className="shadow-lg bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 border-0 rounded-2xl overflow-hidden">
          <CardHeader className="pb-6">
            <CardTitle className="text-2xl font-bold flex items-center gap-3 text-slate-800 dark:text-slate-100">
              <Shield className="h-7 w-7 text-blue-600 dark:text-blue-400" />
              Authentication Methods
            </CardTitle>
            <p className="text-slate-600 dark:text-slate-400 text-base">
              Secure ways to access your account
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {linkedAccountsLoading ? (
              <div className="space-y-4">
                <div className="animate-pulse">
                  <div className="h-20 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
                </div>
                <div className="animate-pulse">
                  <div className="h-20 bg-slate-200 dark:bg-slate-700 rounded-xl"></div>
                </div>
              </div>
            ) : linkedAccountsError ? (
              <div className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-4 rounded-xl">
                Unable to load authentication methods
              </div>
            ) : (
              <div className="space-y-4">
                {/* Email/Password Method */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-all hover:shadow-md relative">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                        <Mail className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                            Email & Password
                          </h3>
                          {linkedAccounts?.hasEmailPassword && (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          )}
                        </div>
                        <p className="text-slate-600 dark:text-slate-400">
                          Traditional email and password authentication
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Google Method */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-all hover:shadow-md relative">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-full">
                        <FaGoogle className="h-6 w-6 text-red-600 dark:text-red-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                            Google
                          </h3>
                          {linkedAccounts?.hasGoogle ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <X className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                        <p className="text-slate-600 dark:text-slate-400">
                          Sign in with your Google account
                        </p>
                      </div>
                    </div>
                    {!linkedAccounts?.hasGoogle && (
                      <div className="flex items-center">
                        <Button
                          onClick={() => window.location.href = '/api/auth/google/link'}
                          className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white border-0 rounded-full px-6 py-2.5 font-medium shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
                        >
                          Link Google Account
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

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
              <Button variant="outline">Change Password</Button>
              <Button variant="outline">Two-Factor Authentication</Button>
              <Button variant="outline">Download Data</Button>
              <Button variant="destructive">Delete Account</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}