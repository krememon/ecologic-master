import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, Mail, Shield, User as UserIcon, Eye, EyeOff } from "lucide-react";
import { FaGoogle } from "react-icons/fa";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { type User } from "@shared/schema";

interface LinkedAccounts {
  hasEmailPassword: boolean;
  hasGoogle: boolean;
  profileImageUrl?: string;
}

export default function Profile() {
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Fetch user data
  const { data: user, isLoading: userLoading } = useQuery<User>({
    queryKey: ["/api/auth/user"],
  });

  // Fetch linked accounts
  const { data: linkedAccounts, isLoading: linkedAccountsLoading, error: linkedAccountsError } = useQuery<LinkedAccounts>({
    queryKey: ["/api/auth/linked-accounts"],
    retry: false,
  });

  // Set password mutation for users who only have Google auth
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
  }, [toast, queryClient]);

  const setPasswordMutation = useMutation({
    mutationFn: async (data: { password: string }) => {
      const response = await apiRequest("POST", "/api/set-password", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Password Set Successfully",
        description: "You can now sign in with email and password.",
      });
      setNewPassword("");
      setConfirmPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/linked-accounts"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Set Password",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSetPassword = () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords Don't Match",
        description: "Please make sure both passwords are identical.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 8) {
      toast({
        title: "Password Too Short",
        description: "Password must be at least 8 characters long.",
        variant: "destructive",
      });
      return;
    }

    setPasswordMutation.mutate({ password: newPassword });
  };

  if (userLoading || linkedAccountsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Profile Settings</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Manage your account information and authentication methods
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Profile Information */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserIcon className="h-5 w-5" />
                  Profile Information
                </CardTitle>
                <CardDescription>
                  Your basic account information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarImage src={user?.profileImageUrl || undefined} alt={user?.firstName || undefined} />
                    <AvatarFallback className="text-lg">
                      {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                      {user?.firstName} {user?.lastName}
                    </h3>
                    <p className="text-gray-600 dark:text-gray-400">{user?.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={user?.firstName || ""}
                      disabled
                      className="bg-gray-50 dark:bg-gray-800"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={user?.lastName || ""}
                      disabled
                      className="bg-gray-50 dark:bg-gray-800"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={user?.email || ""}
                    disabled
                    className="bg-gray-50 dark:bg-gray-800"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Linked Accounts */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Linked Accounts
                </CardTitle>
                <CardDescription>
                  Authentication methods for your account
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Debug info for linked accounts */}
                {linkedAccountsError && (
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg mb-4">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      Debug: Unable to load account linking status. Showing default view.
                    </p>
                  </div>
                )}

                {/* Email/Password Status */}
                <div className="flex items-center justify-between p-3 border rounded-lg dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">Email & Password</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Sign in with email and password
                      </p>
                    </div>
                  </div>
                  <div>
                    {linkedAccountsError ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Linked
                      </Badge>
                    ) : linkedAccounts?.hasEmailPassword ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Linked
                      </Badge>
                    ) : (
                      <Badge variant="outline">Not Set</Badge>
                    )}
                  </div>
                </div>

                {/* Google Status */}
                <div className="flex items-center justify-between p-3 border rounded-lg dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <FaGoogle className="h-5 w-5 text-red-500" />
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">Google</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Sign in with Google account
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {linkedAccountsError ? (
                      <>
                        <Badge variant="outline">Not Linked</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.location.href = '/api/auth/google'}
                          className="text-xs"
                        >
                          Link Google Account
                        </Button>
                      </>
                    ) : linkedAccounts?.hasGoogle ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Linked
                      </Badge>
                    ) : (
                      <>
                        <Badge variant="outline">Not Linked</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.location.href = '/api/auth/google'}
                          className="text-xs"
                        >
                          Link Google Account
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Set Password Section for Google-only users */}
                {linkedAccounts?.hasGoogle && !linkedAccounts?.hasEmailPassword && (
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-gray-900 dark:text-white mb-2">
                        Add Password Authentication
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Set a password to enable email/password login alongside Google.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="newPassword">New Password</Label>
                        <div className="relative">
                          <Input
                            id="newPassword"
                            type={showPassword ? "text" : "password"}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Enter new password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="confirmPassword">Confirm Password</Label>
                        <Input
                          id="confirmPassword"
                          type={showPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Confirm new password"
                        />
                      </div>

                      <Button
                        onClick={handleSetPassword}
                        disabled={!newPassword || !confirmPassword || setPasswordMutation.isPending}
                        className="w-full"
                      >
                        {setPasswordMutation.isPending ? "Setting Password..." : "Set Password"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Info for users with both methods */}
                {linkedAccounts?.hasGoogle && linkedAccounts?.hasEmailPassword && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <CheckCircle className="h-4 w-4 inline mr-1" />
                      You can sign in with either Google or your email and password.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}