import { useId } from "react";

export function CoverArt({
  color = "amber",
  className = "",
  spinning = false,
}: {
  color?: "amber" | "mint" | "rose";
  className?: string;
  spinning?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const palette = {
    amber: ["#f8cd83", "#e29253", "#836a42"],
    mint: ["#bad3bd", "#789e84", "#365d50"],
    rose: ["#eab9a4", "#c97b76", "#854f56"],
  }[color];
  return (
    <div className={`cover-art cover-${color} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 320 320" className={spinning ? "record-spin" : ""}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor={palette[0]} />
            <stop offset="1" stopColor={palette[1]} />
          </linearGradient>
        </defs>
        <rect width="320" height="320" rx="16" fill={`url(#${id})`} />
        <path
          d="M-20 224C35 130 101 275 170 193S255 52 348 116"
          fill="none"
          stroke={palette[2]}
          strokeOpacity=".24"
          strokeWidth="54"
        />
        <path
          d="M-20 224C35 130 101 275 170 193S255 52 348 116"
          fill="none"
          stroke="#fff"
          strokeOpacity=".32"
          strokeWidth="2"
        />
        <circle cx="160" cy="160" r="108" fill="#203c32" />
        {[100, 92, 83, 74, 65, 56].map((r) => (
          <circle
            key={r}
            cx="160"
            cy="160"
            r={r}
            fill="none"
            stroke="#c9c8a2"
            strokeWidth=".65"
            opacity=".22"
          />
        ))}
        <path
          d="M83 107a94 94 0 0 1 101-36M236 213a94 94 0 0 1-98 37"
          fill="none"
          stroke="#fff"
          strokeWidth="18"
          opacity=".055"
        />
        <circle cx="160" cy="160" r="39" fill={palette[0]} />
        <circle
          cx="160"
          cy="160"
          r="29"
          fill="none"
          stroke={palette[2]}
          strokeWidth=".5"
          opacity=".5"
        />
        <path
          d="M149 160v-9m7 15v-22m8 29v-28m8 22v-14"
          stroke={palette[2]}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <circle cx="160" cy="160" r="4" fill="#f7f4ea" />
        <path
          d="M24 28h24M24 28v24M296 292h-24M296 292v-24"
          fill="none"
          stroke="#fff"
          opacity=".55"
        />
        <text x="26" y="292" fill={palette[2]} fontSize="10" letterSpacing="3">
          QINGCHANG ORIGINAL
        </text>
      </svg>
    </div>
  );
}
