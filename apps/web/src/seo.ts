const siteUrl = "https://mahjong.hydrava.cc/";

export interface PageSeo {
  title: string;
  description: string;
  robots: string;
}

const homeSeo: PageSeo = {
  title: "雀局｜免費線上台灣 16 張與日式立直麻將",
  description: "雀局是支援台灣 16 張與日式立直規則的免費線上麻將遊戲，可直接用瀏覽器開房、加入好友、補 AI 玩家、即時對局與自動結算。",
  robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
};

export function seoForPath(pathname: string): PageSeo {
  if (pathname === "/" || pathname === "/index.html") {
    return homeSeo;
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return {
      title: "雀局管理員後台",
      description: "雀局管理員專用營運頁面。",
      robots: "noindex, nofollow"
    };
  }

  if (pathname.startsWith("/room/") || pathname.startsWith("/spectate/")) {
    return {
      title: "雀局房間｜線上麻將",
      description: "透過受邀連結進入雀局線上麻將房間。",
      robots: "noindex, nofollow"
    };
  }

  return {
    title: "找不到頁面｜雀局",
    description: "這個雀局頁面不存在。",
    robots: "noindex, nofollow"
  };
}

export function applyDocumentSeo(pathname: string): void {
  const seo = seoForPath(pathname);
  document.title = seo.title;
  setMetaContent("name", "description", seo.description);
  setMetaContent("name", "robots", seo.robots);

  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical) {
    canonical.href = new URL(pathname === "/index.html" ? "/" : pathname, siteUrl).toString();
  }
}

function setMetaContent(attribute: "name" | "property", value: string, content: string): void {
  const element = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${value}"]`);
  if (element) {
    element.content = content;
  }
}
