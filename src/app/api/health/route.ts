import { prisma } from "@/lib/prisma";

// Utilisé par le HEALTHCHECK Docker : doit rester public et ne rien divulguer
// d'autre que « la base répond ».
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
