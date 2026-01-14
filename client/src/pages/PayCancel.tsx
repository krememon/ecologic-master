import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";

export default function PayCancel() {
  const [, setLocation] = useLocation();
  
  // Get invoiceId from URL params to potentially navigate back to job
  const params = new URLSearchParams(window.location.search);
  const invoiceId = params.get('invoiceId');
  
  // Auto-redirect to jobs after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setLocation("/jobs");
    }, 5000);
    return () => clearTimeout(timer);
  }, [setLocation]);
  
  const handleGoBack = () => {
    // Navigate to jobs list
    setLocation("/jobs");
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <XCircle className="h-16 w-16 text-gray-400" />
          </div>
          <CardTitle className="text-2xl">Payment Cancelled</CardTitle>
          <CardDescription className="text-base mt-2">
            Your payment was not processed. No charges have been made.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            You will be redirected back to your jobs in a few seconds.
          </p>
          <Button
            onClick={handleGoBack}
            className="w-full"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Jobs
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
