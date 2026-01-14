import { useEffect } from "react";
import { useLocation } from "wouter";

export default function PaySuccess() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/jobs", { replace: true });
  }, [setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
  );
}
