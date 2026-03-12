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
import { User, Moon, Sun, Bell, Shield, Camera, Upload, BellRing, Send, Scale, Info, Headphones, ChevronRight, CreditCard } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BillingSection } from "@/components/BillingSection";
import { isNativePlatform, registerPushNotifications, scheduleLocalTestNotification, openAppSettings } from "@/lib/capacitor";
import { manualRegister } from "@/utils/pushDebug";
import { ToastAction } from "@/components/ui/toast";

import { useCan } from "@/hooks/useCan";
import { formatPhoneInput, getRawPhoneValue } from "@shared/phoneUtils";
import { Link } from "wouter";
import DeleteAccountModal from "@/components/DeleteAccountModal";
import ChangePasswordModal from "@/components/ChangePasswordModal";
import { Textarea } from "@/components/ui/textarea";
import TwoFactorSetupModal from "@/components/TwoFactorSetupModal";
import Disable2FAModal from "@/components/Disable2FAModal";
import { MessageSquare } from "lucide-react";

function SmsTestPanel() {
  const { toast } = useToast();
  const [telnyxPhone, setTelnyxPhone] = useState("");
  const [toPhone, setToPhone] = useState("");
  const [smsText, setSmsText] = useState("Hello from EcoLogic! This is a test message.");
  const [savingNumber, setSavingNumber] = useState(false);
  const [sending, setSending] = useState(false);

  const companyQuery = useQuery<any>({
    queryKey: ["/api/company/profile"],
  });

  useEffect(() => {
    if (companyQuery.data?.telnyxPhone) {
      setTelnyxPhone(companyQuery.data.telnyxPhone);
    }
  }, [companyQuery.data]);

  const handleSaveNumber = async () => {
    if (!telnyxPhone) return;
    setSavingNumber(true);
    try {
      const res = await apiRequest("POST", "/api/company/telnyx-number", { telnyxPhone });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Telnyx number saved", description: `Set to ${telnyxPhone}` });
        queryClient.invalidateQueries({ queryKey: ["/api/company/profile"] });
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to save number", variant: "destructive" });
    }
    setSavingNumber(false);
  };

  const handleSendTest = async () => {
    if (!toPhone || !smsText) return;
    setSending(true);
    try {
      const res = await apiRequest("POST", "/api/sms/test-send", { toPhone, text: smsText });
      const data = await res.json();
      if (data.success) {
        toast({ title: "SMS sent!", description: `Message ID: ${data.messageId?.slice(0, 16)}...` });
      } else {
        toast({ title: "Send failed", description: data.error, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Send failed", description: "Network error", variant: "destructive" });
    }
    setSending(false);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 mb-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            SMS Test (Telnyx)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Company Telnyx Number</Label>
            <div className="flex gap-2">
              <Input
                placeholder="+13472840837"
                value={telnyxPhone}
                onChange={(e) => setTelnyxPhone(e.target.value)}
                className="flex-1"
              />
              <Button size="sm" onClick={handleSaveNumber} disabled={savingNumber || !telnyxPhone}>
                {savingNumber ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">E.164 format required (e.g. +13472840837)</p>
          </div>

          <div className="border-t pt-4 space-y-2">
            <Label className="text-sm font-medium">Send Test SMS</Label>
            <Input
              placeholder="Recipient phone (e.g. +1234567890)"
              value={toPhone}
              onChange={(e) => setToPhone(e.target.value)}
            />
            <Textarea
              placeholder="Message text"
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              rows={2}
            />
            <Button size="sm" onClick={handleSendTest} disabled={sending || !toPhone || !smsText}>
              {sending ? "Sending..." : "Send Test"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PushTokenStatus() {
  const { data, isLoading } = useQuery<{ userId: number; count: number; tokens: any[] }>({
    queryKey: ['/api/push/tokens/me'],
    refetchInterval: 30000,
  });
  if (isLoading) return <p className="col-span-2 text-xs text-slate-400">Loading token status...</p>;
  if (!data) return <p className="col-span-2 text-xs text-red-400">Could not fetch token status</p>;
  return (
    <div className="col-span-2 p-2 rounded bg-slate-100 dark:bg-slate-800 text-xs space-y-1">
      <p className="font-medium">Push Tokens: {data.count}</p>
      {data.tokens.map((t: any) => (
        <p key={t.id} className="text-slate-500">
          {t.platform} · {t.tokenSuffix} · {t.isActive ? '✓ active' : '✗ inactive'}
        </p>
      ))}
      {data.count === 0 && <p className="text-amber-500">No tokens registered. Tap "Enable Notifications" first.</p>}
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { can } = useCan();
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
  const [twoFactorModalOpen, setTwoFactorModalOpen] = useState(false);
  const [disable2FAModalOpen, setDisable2FAModalOpen] = useState(false);
  const [pushEnabling, setPushEnabling] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(() => {
    return isNativePlatform() && !!localStorage.getItem("pushToken");
  });
  const [testingLocal, setTestingLocal] = useState(false);
  const [testingRemote, setTestingRemote] = useState(false);
  
  // Check if user can manage company (Owner/Supervisor only)
  const canManageCompany = can("org.view");
  
  // 2FA status query
  const { data: twoFactorStatus } = useQuery<{ enabled: boolean; enabledAt: string | null }>({
    queryKey: ["/api/auth/2fa/status"],
  });

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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="text-slate-600 dark:text-slate-400">Manage your account and preferences</p>
      </div>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
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



        {/* Appearance Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {theme === 'dark' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
              Appearance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="dark-mode">Dark Mode</Label>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Toggle dark mode theme
                </p>
              </div>
              <Switch
                id="dark-mode"
                checked={theme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              />
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
            {isNativePlatform() ? (
              <>
                <div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                    Enable push notifications to receive alerts for job assignments, messages, and other important updates.
                  </p>
                  <Button
                    className="w-full"
                    disabled={pushEnabling || pushEnabled}
                    onClick={async () => {
                      setPushEnabling(true);
                      try {
                        const result = await registerPushNotifications();
                        if (result.success) {
                          setPushEnabled(true);
                          toast({ title: "Notifications Enabled", description: "You will now receive push notifications." });
                        } else if (result.error === "unimplemented") {
                          toast({ title: "Plugin Not Installed", description: "Notifications plugin not available. Rebuild the app after running: npx cap sync ios", variant: "destructive" });
                        } else if (result.error === "denied") {
                          toast({
                            title: "Permission Denied",
                            description: "Please enable notifications in your device Settings.",
                            variant: "destructive",
                            action: (
                              <ToastAction altText="Open Settings" onClick={() => openAppSettings()}>
                                Open Settings
                              </ToastAction>
                            ),
                          });
                        } else {
                          toast({ title: "Error", description: "Could not enable notifications.", variant: "destructive" });
                        }
                      } catch {
                        toast({ title: "Error", description: "Could not enable notifications.", variant: "destructive" });
                      } finally {
                        setPushEnabling(false);
                      }
                    }}
                  >
                    <BellRing className="h-4 w-4 mr-2" />
                    {pushEnabled ? "Notifications Enabled" : pushEnabling ? "Enabling..." : "Enable Notifications"}
                  </Button>
                </div>

                <div className="grid gap-2 grid-cols-2">
                  <Button
                    variant="outline"
                    disabled={testingLocal}
                    onClick={async () => {
                      setTestingLocal(true);
                      try {
                        const result = await scheduleLocalTestNotification();
                        if (result.success) {
                          toast({ title: "Test Sent", description: "A test notification will appear in ~2 seconds." });
                        } else if (result.error === "unimplemented") {
                          toast({ title: "Plugin Not Installed", description: "Local notifications plugin not available. Rebuild after: npx cap sync ios", variant: "destructive" });
                        } else if (result.error === "denied") {
                          toast({
                            title: "Permission Denied",
                            description: "Enable notifications in device Settings first.",
                            variant: "destructive",
                            action: (
                              <ToastAction altText="Open Settings" onClick={() => openAppSettings()}>
                                Open Settings
                              </ToastAction>
                            ),
                          });
                        } else {
                          toast({ title: "Failed", description: "Could not send test notification.", variant: "destructive" });
                        }
                      } catch {
                        toast({ title: "Error", description: "Test notification failed.", variant: "destructive" });
                      } finally {
                        setTestingLocal(false);
                      }
                    }}
                  >
                    <Bell className="h-4 w-4 mr-2" />
                    {testingLocal ? "Sending..." : "Test Local"}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      await manualRegister();
                      toast({ title: "Register Called", description: "Check Xcode console for token output." });
                    }}
                  >
                    Get Token
                  </Button>

                  {import.meta.env.DEV && (
                    <>
                      <PushTokenStatus />
                      <Button
                        variant="default"
                        className="col-span-2 bg-blue-600 hover:bg-blue-700 text-white"
                        disabled={testingRemote}
                        onClick={async () => {
                          setTestingRemote(true);
                          try {
                            const res = await fetch("/api/push/test", { method: "POST", credentials: "include" });
                            const json = await res.json().catch(() => ({}));
                            console.log("[push-test]", res.status, json);
                            if (json.ok) {
                              toast({ title: "Remote Push Sent", description: `Sent: ${json.sent}, Failed: ${json.failed}. Tokens: ${json.tokensCount}` });
                            } else {
                              toast({ title: "Push Failed", description: json.message || "Server could not send push.", variant: "destructive" });
                            }
                          } catch (err) {
                            toast({ title: "Error", description: "Could not reach server.", variant: "destructive" });
                          } finally {
                            setTestingRemote(false);
                          }
                        }}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        {testingRemote ? "Sending..." : "Send Test Remote Push"}
                      </Button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="notifications">Push Notifications</Label>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Push notifications are available in the native app
                  </p>
                </div>
                <Switch
                  id="notifications"
                  checked={notifications}
                  onCheckedChange={setNotifications}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Billing & Subscription - Owner Only */}
        {user?.role === 'OWNER' && (
          <div className="lg:col-span-2">
            <BillingSection />
          </div>
        )}

        {/* Stripe Payouts */}
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <Link href="/settings/stripe-connect">
              <div className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors rounded-xl">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <CreditCard className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">Stripe Payouts</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Connect Stripe to receive subcontractor payouts</div>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </div>
            </Link>
          </CardContent>
        </Card>

        {/* Legal */}
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <Link href="/settings/legal">
              <div className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors rounded-xl">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <Scale className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  </div>
                  <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">Legal</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Terms of Service &amp; Privacy Policy</div>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </div>
            </Link>
          </CardContent>
        </Card>

        {/* Support */}
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <Link href="/settings/support">
              <div className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors rounded-xl">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <Headphones className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  </div>
                  <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">Support</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Get help &amp; send feedback</div>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </div>
            </Link>
          </CardContent>
        </Card>

        {/* About */}
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <Link href="/settings/about">
              <div className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors rounded-xl">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <Info className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  </div>
                  <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">About</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">App version, device &amp; account info</div>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </div>
            </Link>
          </CardContent>
        </Card>

        {/* Security Settings */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Button variant="outline" onClick={() => setChangePasswordModalOpen(true)}>Change Password</Button>
              {twoFactorStatus?.enabled ? (
                <Button 
                  variant="destructive"
                  onClick={() => setDisable2FAModalOpen(true)}
                >
                  Disable 2FA
                </Button>
              ) : (
                <Button 
                  onClick={() => setTwoFactorModalOpen(true)}
                >
                  Set Up Authenticator
                </Button>
              )}
              <Button variant="destructive" onClick={() => setDeleteAccountModalOpen(true)}>Delete Account</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {can("org.manage") && <SmsTestPanel />}

      <ChangePasswordModal
        open={changePasswordModalOpen}
        onOpenChange={setChangePasswordModalOpen}
        userEmail={user?.email || undefined}
      />

      <DeleteAccountModal
        open={deleteAccountModalOpen}
        onOpenChange={setDeleteAccountModalOpen}
      />

      <TwoFactorSetupModal
        open={twoFactorModalOpen}
        onOpenChange={setTwoFactorModalOpen}
        isEnabled={twoFactorStatus?.enabled || false}
      />

      <Disable2FAModal
        open={disable2FAModalOpen}
        onOpenChange={setDisable2FAModalOpen}
      />
    </div>
  );
}