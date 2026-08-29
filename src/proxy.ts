import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/session";

// Next 16 : le fichier `middleware` a été renommé `proxy`.
//
// On ne fait ici qu'un aiguillage sur la présence du cookie — pas de requête
// base de données, pas de vérification de signature. L'autorisation réelle est
// faite par le DAL (`requireUser`) dans chaque page et action serveur ; ceci
// évite juste un aller-retour inutile vers une page qui redirigerait.
const PUBLIC_PATHS = ["/login", "/manifest.webmanifest", "/sw.js", "/api/health", "/offline"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSessionCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Mémorise la destination pour y revenir après connexion.
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Sans matcher, le proxy tournerait aussi sur les assets statiques et
  // bloquerait le CSS et le JS de la page de connexion elle-même.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.png$|.*\\.svg$).*)"],
};
