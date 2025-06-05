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
        {/* Main water droplet shape - exact match to reference */}
        <path
          d="M50 8C50 8 18 40 18 62C18 79.673 32.327 94 50 94C67.673 94 82 79.673 82 62C82 40 50 8 50 8Z"
          fill={`url(#lightBlueGradient-${size})`}
          stroke="#334155"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Inner droplet curve - creating the layered effect */}
        <path
          d="M50 25C50 25 35 50 35 65C35 75.493 43.507 84 54 84C64.493 84 73 75.493 73 65C73 50 50 25 50 25Z"
          fill="none"
          stroke="#334155"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Leaf shape - positioned like reference image */}
        <ellipse
          cx="54"
          cy="52"
          rx="15"
          ry="10"
          fill="#84CC16"
          stroke="#334155"
          strokeWidth="4"
          transform="rotate(-20 54 52)"
        />
        
        {/* Leaf center vein - dark line through leaf */}
        <path
          d="M45 47C50 50 58 55 63 58"
          stroke="#334155"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        
        {/* Gradients matching reference image colors */}
        <defs>
          <radialGradient id={`lightBlueGradient-${size}`} cx="50%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#E0F2FE" />
            <stop offset="30%" stopColor="#BAE6FD" />
            <stop offset="60%" stopColor="#7DD3FC" />
            <stop offset="80%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#0EA5E9" />
          </radialGradient>
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