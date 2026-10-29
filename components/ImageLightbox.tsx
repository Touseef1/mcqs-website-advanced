"use client";

import Image from "next/image";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type LightboxImage = { src: string; alt: string };
type LightboxContextValue = { openImage: (image: LightboxImage) => void };
const LightboxContext = createContext<LightboxContextValue | null>(null);

function LightboxImageView({ image }: { image: LightboxImage }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className={`image-lightbox-frame ${loaded || failed ? "is-settled" : "is-loading"}`}>
    {!loaded && !failed && <span className="mcq-image-skeleton" aria-hidden="true" />}
    {failed ? <span className="mcq-image-fallback" role="img" aria-label={`${image.alt} unavailable`}>Image unavailable</span> : <Image src={image.src} alt={image.alt} fill sizes="90vw" unoptimized loading="eager" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
  </div>;
}

export function useImageLightbox() {
  const context = useContext(LightboxContext);
  if (!context) throw new Error("useImageLightbox must be used within ImageLightboxProvider.");
  return context;
}

export function ImageLightboxProvider({ children }: { children: ReactNode }) {
  const [image, setImage] = useState<LightboxImage | null>(null);

  useEffect(() => {
    if (!image) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setImage(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [image]);

  return <LightboxContext.Provider value={{ openImage: setImage }}>
    {children}
    {image && <div className="image-lightbox-backdrop" role="presentation" onClick={() => setImage(null)}>
      <section className="image-lightbox" role="dialog" aria-modal="true" aria-label={image.alt} onClick={(event) => event.stopPropagation()}>
        <button className="image-lightbox-close" type="button" onClick={() => setImage(null)} aria-label="Close image">×</button>
        <LightboxImageView image={image} />
        <p>{image.alt}</p>
      </section>
    </div>}
  </LightboxContext.Provider>;
}
