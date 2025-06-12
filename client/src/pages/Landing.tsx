import { Button } from "@/components/ui/button";
import logoImage from "@assets/IMG_6171 2_1749763982284.jpg";

export default function Landing() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
      <div className="w-full max-w-sm mx-auto p-8">
        
        {/* Logo and Branding */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full overflow-hidden bg-white shadow-lg">
            <img 
              src={logoImage} 
              alt="EcoLogic Logo" 
              className="w-full h-full object-cover"
            />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white mb-2 tracking-wider uppercase">
            EcoLogic
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            Construction Management Platform
          </p>
        </div>

        {/* Sign In */}
        <Button 
          onClick={() => window.location.href = "/api/login"}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white"
        >
          Sign In
        </Button>
        
        <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-4">
          Powered by Replit
        </p>
      </div>
    </div>
  );
}