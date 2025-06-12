import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
      <div className="w-full max-w-sm mx-auto p-8">
        
        {/* Simple Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-500 rounded-lg mx-auto mb-4 flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
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