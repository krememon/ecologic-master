import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { User, Building2, Palette, Bell, Shield, LogOut, Smartphone } from "lucide-react";

export default function Settings() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { theme } = useTheme();
  const { 
    isSupported, 
    isSubscribed, 
    isLoading: notificationLoading, 
    subscribeToPush, 
    unsubscribeFromPush, 
    sendTestNotification 
  } = usePushNotifications();

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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="flex">
        <Sidebar user={user} company={user.company} />
        <div className="flex-1 ml-64">
          <Header 
            title="Settings" 
            subtitle="Manage your account and company preferences"
            user={user} 
          />
          <main className="p-6 space-y-6">
            
            {/* Profile Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Profile Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-4">
                  <img 
                    src={user?.profileImageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.firstName || 'U')}&background=random`}
                    alt="Profile picture" 
                    className="w-16 h-16 rounded-full object-cover"
                  />
                  <div>
                    <h3 className="text-lg font-medium">{user?.firstName} {user?.lastName}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{user?.email}</p>
                    <Badge variant="secondary" className="mt-1">Project Manager</Badge>
                  </div>
                </div>
                
                <Separator />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="firstName">First Name</Label>
                    <Input 
                      id="firstName" 
                      value={user?.firstName || ""} 
                      disabled 
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input 
                      id="lastName" 
                      value={user?.lastName || ""} 
                      disabled 
                      className="mt-1"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input 
                      id="email" 
                      value={user?.email || ""} 
                      disabled 
                      className="mt-1"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Company Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Company Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input 
                    id="companyName" 
                    value={user?.company?.name || "EcoLogic"} 
                    disabled 
                    className="mt-1"
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="primaryColor">Primary Color</Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <div 
                        className="w-8 h-8 rounded border"
                        style={{ backgroundColor: user?.company?.primaryColor || '#3B82F6' }}
                      ></div>
                      <Input 
                        id="primaryColor" 
                        value={user?.company?.primaryColor || '#3B82F6'} 
                        disabled 
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="secondaryColor">Secondary Color</Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <div 
                        className="w-8 h-8 rounded border"
                        style={{ backgroundColor: user?.company?.secondaryColor || '#1E40AF' }}
                      ></div>
                      <Input 
                        id="secondaryColor" 
                        value={user?.company?.secondaryColor || '#1E40AF'} 
                        disabled 
                        className="flex-1"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Preferences */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-5 w-5" />
                  Preferences
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Dark Mode</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Switch between light and dark themes</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {theme}
                    </Badge>
                    <ThemeToggle />
                  </div>
                </div>
                
                <Separator />
                
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Language</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Choose your preferred language</p>
                  </div>
                  <Button variant="outline" disabled>
                    English
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Notifications */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Mobile Push Notifications
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isSupported ? (
                  <div className="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Push notifications are not supported in this browser
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium">Real-time Alerts</h4>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Get instant notifications on your phone for job updates, messages, and schedule changes
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isSubscribed ? (
                          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            Disabled
                          </Badge>
                        )}
                      </div>
                    </div>
                    
                    <Separator />
                    
                    <div className="flex flex-col gap-3">
                      {!isSubscribed ? (
                        <Button 
                          onClick={async () => {
                            const success = await subscribeToPush();
                            if (success) {
                              toast({
                                title: "Notifications Enabled",
                                description: "You'll now receive alerts on your mobile device",
                              });
                            } else {
                              toast({
                                title: "Failed to Enable",
                                description: "Please check permissions and try again",
                                variant: "destructive",
                              });
                            }
                          }}
                          disabled={notificationLoading}
                          className="w-full"
                        >
                          {notificationLoading ? "Enabling..." : "Enable Mobile Notifications"}
                        </Button>
                      ) : (
                        <div className="flex gap-2">
                          <Button 
                            onClick={async () => {
                              const success = await sendTestNotification();
                              if (success) {
                                toast({
                                  title: "Test Sent",
                                  description: "Check your iPhone for the notification",
                                });
                              }
                            }}
                            variant="outline"
                            className="flex-1"
                            disabled={notificationLoading}
                          >
                            Send Test
                          </Button>
                          <Button 
                            onClick={async () => {
                              const success = await unsubscribeFromPush();
                              if (success) {
                                toast({
                                  title: "Notifications Disabled",
                                  description: "You won't receive alerts anymore",
                                });
                              }
                            }}
                            variant="destructive"
                            className="flex-1"
                            disabled={notificationLoading}
                          >
                            Disable
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Security */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Security
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Authentication</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Managed through Replit Authentication</p>
                  </div>
                  <Badge variant="outline" className="text-green-600 border-green-600">
                    Secure
                  </Badge>
                </div>
                
                <Separator />
                
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">Session Management</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Active sessions are automatically managed</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="flex items-center gap-2 text-red-600 border-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </Button>
                </div>
              </CardContent>
            </Card>

          </main>
        </div>
      </div>
    </div>
  );
}