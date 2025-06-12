import { Button } from "@/components/ui/button";
import EcoLogicLogo from "@/components/EcoLogicLogo";

export default function Landing() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 flex flex-col items-center justify-center px-6">
      {/* Main Content Container */}
      <div className="flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-8">
        
        {/* Logo */}
        <div className="flex flex-col items-center space-y-6">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
            <EcoLogicLogo size={32} showText={false} className="text-white" />
          </div>
          
          {/* Brand Name */}
          <div className="flex items-center space-x-3">
            <EcoLogicLogo size={32} showText={false} className="text-blue-600" />
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
              ECOLOGIC
            </h1>
          </div>
        </div>

        {/* Welcome Text */}
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">
            Welcome to EcoLogic
          </h2>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Professional contractor management platform
          </p>
        </div>

        {/* Sign In Button */}
        <div className="w-full space-y-4">
          <Button 
            onClick={() => window.location.href = "/api/login"}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 text-base font-medium rounded-lg shadow-sm transition-colors"
            size="lg"
          >
            Sign In with Replit
          </Button>
        </div>

        {/* Security Note */}
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Secure authentication powered by Replit
        </p>
      </div>
    </div>
  );
}