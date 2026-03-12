import { useEffect } from 'react';

export default function ChoosePlan() {
  useEffect(() => {
    // Redirect to dashboard since app is now free
    window.location.href = '/dashboard';
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Redirecting to Dashboard...</h1>
        <p className="text-gray-600">The app is now free to use!</p>
      </div>
    </div>
  );
}