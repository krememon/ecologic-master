import { Button } from "@/components/ui/button";
import EcoLogicLogo from "@/components/EcoLogicLogo";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 dark:from-slate-900 dark:via-slate-950 dark:to-black flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-transparent to-emerald-900/20"></div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent"></div>
      
      {/* Main Content Container */}
      <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 py-12 max-w-lg mx-auto">
        
        {/* Logo */}
        <div className="mb-12">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/25 mb-8">
            <EcoLogicLogo size={48} showText={false} className="text-white" />
          </div>
        </div>

        {/* Welcome Text */}
        <div className="mb-12">
          <h1 className="text-4xl font-light text-white mb-4 tracking-wide">
            Welcome to EcoLogic
          </h1>
          <p className="text-lg text-slate-300 font-light leading-relaxed">
            Professional contractor management platform
          </p>
        </div>

        {/* Sign In Button */}
        <div className="w-full mb-8">
          <Button 
            onClick={() => window.location.href = "/api/login"}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 text-lg font-medium rounded-xl shadow-lg shadow-blue-600/25 transition-all duration-200 hover:shadow-blue-600/40 hover:scale-[1.02]"
            size="lg"
          >
            <span className="mr-2">→</span>
            Sign In with Replit
          </Button>
        </div>

        {/* Security Note */}
        <p className="text-sm text-slate-400 font-light">
          Secure authentication powered by Replit
        </p>
      </div>

      {/* Bottom Gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-slate-950 to-transparent"></div>
    </div>
  );
}