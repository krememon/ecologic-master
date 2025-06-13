import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, Mail, Shield } from "lucide-react";
import { FaGoogle } from "react-icons/fa";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface LinkedAccounts {
  hasEmailPassword: boolean;
  hasGoogle: boolean;
  profileImageUrl?: string;
}

export default function ProfileNew() {
  const { toast } = useToast();

  // Fetch user data
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ["/api/auth/user"],
  });

  // Fetch linked accounts
  const { data: linkedAccounts, isLoading: linkedAccountsLoading, error: linkedAccountsError } = useQuery<LinkedAccounts>({
    queryKey: ["/api/auth/linked-accounts"],
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
                <CardTitle>Profile Information</CardTitle>
                <CardDescription>Your basic account information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p><strong>Name:</strong> {(user as any)?.firstName} {(user as any)?.lastName}</p>
                  <p><strong>Email:</strong> {(user as any)?.email}</p>
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
                  Authentication Methods
                </CardTitle>
                <CardDescription>
                  Ways you can sign in to your account
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Debug info for linked accounts */}
                {linkedAccountsError && (
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg mb-4">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      Debug: Unable to load account linking status. Showing fallback view.
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
                    {linkedAccountsError || linkedAccounts?.hasEmailPassword ? (
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
                    {linkedAccounts?.hasGoogle ? (
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
                          onClick={() => window.location.href = '/auth/google'}
                          className="text-xs ml-2"
                        >
                          Link Google Account
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Info for users with both methods */}
                {linkedAccounts?.hasGoogle && linkedAccounts?.hasEmailPassword && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <CheckCircle className="h-4 w-4 inline mr-1" />
                      You can sign in with either Google or your email and password.
                    </p>
                  </div>
                )}

                {/* Show current status for debugging */}
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs">
                  <p className="font-mono">
                    Debug: Email/Password: {linkedAccounts?.hasEmailPassword ? '✅' : '❌'}, 
                    Google: {linkedAccounts?.hasGoogle ? '✅' : '❌'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}