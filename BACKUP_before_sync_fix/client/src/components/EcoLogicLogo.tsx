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
    <div className={`flex items-center ${className}`}>
      {showText && (
        <span
          style={{
            fontFamily: "'Plus Jakarta Sans', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: "#0B0B0D",
            fontSize: "24px",
          }}
        >
          EcoLogic
        </span>
      )}
    </div>
  );
}
