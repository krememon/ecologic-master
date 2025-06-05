interface EcoLogicLogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export default function EcoLogicLogo({ size = 40, showText = true, className = "" }: EcoLogicLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Water Droplet with Leaf SVG Logo */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
      >
        {/* Water droplet shape */}
        <path
          d="M50 10C50 10 25 35 25 55C25 69.0345 36.9655 81 50 81C63.0345 81 75 69.0345 75 55C75 35 50 10 50 10Z"
          fill="url(#waterGradient)"
          stroke="#1E3A8A"
          strokeWidth="3"
        />
        
        {/* Leaf shape inside droplet */}
        <ellipse
          cx="52"
          cy="45"
          rx="12"
          ry="8"
          fill="#84CC16"
          stroke="#365314"
          strokeWidth="2"
          transform="rotate(-15 52 45)"
        />
        
        {/* Leaf vein */}
        <path
          d="M45 42L58 48"
          stroke="#365314"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        
        {/* Water highlight */}
        <ellipse
          cx="42"
          cy="35"
          rx="4"
          ry="6"
          fill="rgba(255,255,255,0.3)"
          transform="rotate(-20 42 35)"
        />
        
        {/* Gradients */}
        <defs>
          <linearGradient id="waterGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#60A5FA" />
            <stop offset="50%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#1D4ED8" />
          </linearGradient>
        </defs>
      </svg>
      
      {/* EcoLogic Text */}
      {showText && (
        <span 
          className="text-2xl font-bold tracking-wide text-slate-800 dark:text-white"
          style={{ 
            fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: '0.1em',
            fontWeight: '700'
          }}
        >
          ECOLOGIC
        </span>
      )}
    </div>
  );
}