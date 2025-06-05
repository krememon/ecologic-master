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
        {/* Outer water droplet with gradient fill */}
        <path
          d="M50 5C50 5 20 35 20 58C20 75.673 34.327 90 52 90C69.673 90 84 75.673 84 58C84 35 50 5 50 5Z"
          fill={`url(#waterGradient-${size})`}
          stroke="#2563EB"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Inner water droplet curve with lighter fill */}
        <path
          d="M50 20C50 20 30 45 30 62C30 73.046 38.954 82 50 82C61.046 82 70 73.046 70 62C70 45 50 20 50 20Z"
          fill={`url(#innerWaterGradient-${size})`}
          stroke="#2563EB"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Leaf shape - elliptical with precise positioning */}
        <ellipse
          cx="52"
          cy="48"
          rx="14"
          ry="9"
          fill="#84CC16"
          stroke="#2563EB"
          strokeWidth="3"
          transform="rotate(-15 52 48)"
        />
        
        {/* Leaf center vein */}
        <path
          d="M44 44L60 52"
          stroke="#2563EB"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
        
        {/* Gradients for consistent unique IDs */}
        <defs>
          <linearGradient id={`waterGradient-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7DD3FC" />
            <stop offset="25%" stopColor="#38BDF8" />
            <stop offset="50%" stopColor="#0EA5E9" />
            <stop offset="75%" stopColor="#0284C7" />
            <stop offset="100%" stopColor="#0369A1" />
          </linearGradient>
          <linearGradient id={`innerWaterGradient-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#E0F2FE" />
            <stop offset="30%" stopColor="#BAE6FD" />
            <stop offset="60%" stopColor="#7DD3FC" />
            <stop offset="100%" stopColor="#38BDF8" />
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