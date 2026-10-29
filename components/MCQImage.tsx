"use client";

import Image from "next/image";
import { useState } from "react";
import { useImageLightbox } from "@/components/ImageLightbox";

type Props = { src?: string | null; alt: string; size?: "question" | "option" | "compact"; className?: string; onActivate?: () => void };

function safeImageSource(value?: string | null) {
  const src = value?.trim();
  if (!src) return null;
  if (src.startsWith("/")) return src;
  try {
    const url = new URL(src);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function MCQImage({ src, alt, size = "question", className = "", onActivate }: Props) {
  const source = safeImageSource(src);
  if (!source) return null;
  return <MCQImageView key={source} source={source} alt={alt} size={size} className={className} onActivate={onActivate} />;
}

function MCQImageView({ source, alt, size, className, onActivate }: { source: string; alt: string; size: "question" | "option" | "compact"; className: string; onActivate?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const { openImage } = useImageLightbox();

  return <button type="button" className={`mcq-image-trigger mcq-image-${size} ${className}`.trim()} aria-label={`Enlarge ${alt}`} onClick={(event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!failed) { onActivate?.(); openImage({ src: source, alt }); }
  }}>
    <span className={`mcq-image-frame ${loaded || failed ? "is-settled" : "is-loading"}`}>
      {!loaded && !failed && <span className="mcq-image-skeleton" aria-hidden="true" />}
      {failed ? <span className="mcq-image-fallback" role="img" aria-label={`${alt} unavailable`}>Image unavailable</span> : <Image
        src={source}
        alt={alt}
        fill
        sizes={size === "question" ? "(max-width: 760px) 90vw, 640px" : size === "option" ? "(max-width: 760px) 80vw, 360px" : "220px"}
        loading="lazy"
        unoptimized
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />}
    </span>
  </button>;
}
