import { PrismaClient } from "@prisma/client";

// Singleton : en dev, Next recharge les modules à chaque édition et
// recréer un PrismaClient à chaque fois épuiserait les connexions.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
