import logoImage from "@assets/3251306B-87CB-49B9-8FD2-0285B81BA09A.png";

interface EcoLogicLogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export default function EcoLogicLogo({
  size = 40,
  showText = true,
  className = "",
}: EcoLogicLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Water Droplet PNG Image to the left */}
      {showText && (
        <img
          src={logoImage}
          alt="EcoLogic Water Droplet"
          className="w-5 flex-shrink-0"
        />
      )}
      
      {/* EcoLogic Text */}
      {showText && (
        <span
          className="text-2xl font-bold tracking-wide text-slate-800 dark:text-white"
          style={{
            fontFamily: "system-ui, -apple-system, sans-serif",
            letterSpacing: "0.1em",
            fontWeight: "700",
          }}
        >
          ECOLOGIC
        </span>
      )}
    </div>
  );
}
