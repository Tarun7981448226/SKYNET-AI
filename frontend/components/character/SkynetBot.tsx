import type { Ref } from "react";

// EVE — the same WALL-E-inspired silhouette this project has used since
// Mark V (oval body, rounded binocular-eyed head, paddle arms) — but
// rendered with real shading instead of flat single-tone fills: layered
// gradients, a specular highlight sweep, tread/joint detail, a visor rim
// bezel, and glow-filtered lens-style eyes. Shared by every place she
// appears (EvePublic.tsx, SkynetPresentation.tsx's MiniEve, and
// EveIntro.tsx's dashboard arrival animation) so this shading only has to
// be built once instead of tripling the maintenance burden.
//
// `idPrefix` namespaces the SVG gradient/filter ids — EvePublic's
// character and SkynetPresentation's MiniEve can both be mounted at the
// same time (the presentation opens as an overlay *while* she's still on
// screen), so two instances sharing literal ids would collide in the DOM.
export function SkynetBot({
  idPrefix,
  eyeColor,
  armLeftRef,
  armRightRef,
}: {
  idPrefix: string;
  eyeColor: string;
  armLeftRef?: Ref<SVGGElement>;
  armRightRef?: Ref<SVGGElement>;
}) {
  const bodyGradId = `${idPrefix}BodyGrad`;
  const headGradId = `${idPrefix}HeadGrad`;
  const armGradId = `${idPrefix}ArmGrad`;
  const eyeGradId = `${idPrefix}EyeGrad`;

  return (
    <svg
      viewBox="0 0 240 330"
      style={{
        display: "block",
        width: "100%",
        height: "auto",
        overflow: "visible",
        filter: "drop-shadow(0 8px 10px rgba(10,14,24,0.35))",
      }}
    >
      <defs>
        <linearGradient id={bodyGradId} x1="0.1" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="22%" stopColor="#eef2fa" />
          <stop offset="50%" stopColor="#d3dbec" />
          <stop offset="78%" stopColor="#aab5cf" />
          <stop offset="100%" stopColor="#7a86a3" />
        </linearGradient>
        <radialGradient id={headGradId} cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="35%" stopColor="#f5f8fc" />
          <stop offset="65%" stopColor="#dbe2f0" />
          <stop offset="88%" stopColor="#b7c0d9" />
          <stop offset="100%" stopColor="#96a0bd" />
        </radialGradient>
        <linearGradient id={armGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8fafd" />
          <stop offset="55%" stopColor="#d7deec" />
          <stop offset="100%" stopColor="#9aa4bd" />
        </linearGradient>
        <radialGradient id={eyeGradId} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#eaf7ff" />
          <stop offset="45%" stopColor={eyeColor} />
          <stop offset="100%" stopColor={eyeColor} stopOpacity=".75" />
        </radialGradient>
      </defs>

      {/* ground contact shadow */}
      <ellipse cx="120" cy="320" rx="48" ry="8" fill="#000" opacity=".28" />

      {/* body */}
      <path
        d="M58,150 C40,188 40,246 78,296 Q120,320 162,296 C200,246 200,188 182,150 Q120,166 58,150 Z"
        fill={`url(#${bodyGradId})`}
        stroke="#6d7996"
        strokeWidth="1"
        strokeOpacity=".35"
      />
      {/* specular highlight sweep along the upper-left edge */}
      <path
        d="M64,160 C52,190 50,230 66,268"
        stroke="#ffffff"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
        opacity=".35"
      />
      {/* tread/panel seam lines near the base, echoing WALL-E's segmented treads */}
      <path d="M82,286 Q120,306 158,286" stroke="#4a5268" strokeWidth="2" fill="none" opacity=".28" />
      <path d="M76,270 Q120,290 164,270" stroke="#4a5268" strokeWidth="2" fill="none" opacity=".2" />

      {/* soft ambient-occlusion shadow where the head sits on the body */}
      <ellipse cx="120" cy="150" rx="70" ry="14" fill="#000" opacity=".14" />

      {/* arm joint sockets, drawn before the arms so the arms overlap them */}
      <ellipse cx="66" cy="158" rx="10" ry="8" fill="#6b7690" opacity=".5" />
      <ellipse cx="174" cy="158" rx="10" ry="8" fill="#6b7690" opacity=".5" />

      <g ref={armLeftRef} style={{ transformOrigin: "66px 158px" }}>
        <path
          d="M0,0 C-14,26 -22,64 -14,104 C-9,120 4,122 10,106 C18,66 14,26 4,-4 Z"
          fill={`url(#${armGradId})`}
          transform="translate(66,158)"
        />
      </g>
      <g ref={armRightRef} style={{ transformOrigin: "174px 158px" }}>
        <path
          d="M0,0 C14,26 22,64 14,104 C9,120 -4,122 -10,106 C-18,66 -14,26 -4,-4 Z"
          fill={`url(#${armGradId})`}
          transform="translate(174,158)"
        />
      </g>

      <g>
        <ellipse
          cx="120"
          cy="92"
          rx="98"
          ry="80"
          fill={`url(#${headGradId})`}
          stroke="#8892ae"
          strokeWidth="1.5"
          strokeOpacity=".4"
        />
        {/* glossy dome highlight */}
        <ellipse cx="90" cy="55" rx="34" ry="16" fill="#ffffff" opacity=".4" transform="rotate(-18 90 55)" />
        <path
          d="M35,96 C35,56 73,20 120,20 C167,20 205,56 205,96 C205,110 195,118 180,112 C160,104 140,100 120,100 C100,100 80,104 60,112 C45,118 35,110 35,96 Z"
          fill="#090b12"
          opacity=".97"
          stroke="#454e63"
          strokeWidth="1.5"
          strokeOpacity=".55"
        />
        <circle
          cx="96"
          cy="94"
          r="15"
          fill={`url(#${eyeGradId})`}
          style={{ filter: `drop-shadow(0 0 6px ${eyeColor})`, transition: "fill 300ms ease" }}
        />
        <circle
          cx="146"
          cy="94"
          r="15"
          fill={`url(#${eyeGradId})`}
          style={{ filter: `drop-shadow(0 0 6px ${eyeColor})`, transition: "fill 300ms ease" }}
        />
        <circle cx="91" cy="89" r="4" fill="#eaf7ff" opacity=".85" />
        <circle cx="141" cy="89" r="4" fill="#eaf7ff" opacity=".85" />
      </g>
    </svg>
  );
}
