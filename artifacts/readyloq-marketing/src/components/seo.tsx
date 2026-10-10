import { useEffect } from "react";

interface SeoProps {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
}

export function Seo({
  title,
  description,
  canonical,
  ogImage = "https://readyloq.com/og-image.png",
}: SeoProps) {
  useEffect(() => {
    document.title = title;

    const setMeta = (name: string, content: string, property = false) => {
      let el = document.querySelector(
        property ? `meta[property="${name}"]` : `meta[name="${name}"]`
      );
      if (!el) {
        el = document.createElement("meta");
        if (property) el.setAttribute("property", name);
        else el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("description", description);
    setMeta("og:title", title, true);
    setMeta("og:description", description, true);
    setMeta("og:image", ogImage, true);
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    setMeta("twitter:image", ogImage);

    if (canonical) {
      let link = document.querySelector(`link[rel="canonical"]`);
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", canonical);
    }
  }, [title, description, canonical, ogImage]);

  return null;
}
