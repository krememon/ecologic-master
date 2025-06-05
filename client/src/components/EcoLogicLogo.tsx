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
        {/* Water droplet shape - more accurate teardrop */}
        <path
          d="M50 8C50 8 22 38 22 58C22 73.464 34.536 86 50 86C65.464 86 78 73.464 78 58C78 38 50 8 50 8Z"
          fill="url(#waterGradient)"
          stroke="#1E3A8A"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        
        {/* Leaf shape inside droplet - more organic curve */}
        <path
          d="M45 42C45 42 48 38 54 40C60 42 62 48 60 52C58 56 52 58 48 56C44 54 43 48 45 42Z"
          fill="#84CC16"
          stroke="#1E3A8A"
          strokeWidth="2"
        />
        
        {/* Leaf vein - curved line */}
        <path
          d="M47 44C49 46 52 48 55 50"
          stroke="#1E3A8A"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
        
        {/* Water highlight - softer glow */}
        <ellipse
          cx="40"
          cy="32"
          rx="5"
          ry="8"
          fill="rgba(255,255,255,0.4)"
          transform="rotate(-25 40 32)"
        />
        
        {/* Small highlight dot */}
        <circle
          cx="38"
          cy="28"
          r="2"
          fill="rgba(255,255,255,0.6)"
        />
        
        {/* Gradients */}
        <defs>
          <linearGradient id="waterGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7DD3FC" />
            <stop offset="30%" stopColor="#38BDF8" />
            <stop offset="70%" stopColor="#0EA5E9" />
            <stop offset="100%" stopColor="#0284C7" />
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