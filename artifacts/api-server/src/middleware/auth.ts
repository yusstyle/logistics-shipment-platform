import {
  clerkClient,
  getAuth,
} from "@clerk/express";
import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, usersTable, type User } from "@workspace/db";

const adminRoles = new Set(["super_admin", "admin", "staff"]);

function displayName(first: string | null, last: string | null, email: string) {
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name || email;
}

async function synchronizeUser(clerkUserId: string): Promise<User> {
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const primaryEmail = clerkUser.emailAddresses.find(
    (email) => email.id === clerkUser.primaryEmailAddressId,
  );
  if (!primaryEmail || primaryEmail.verification?.status !== "verified") {
    throw Object.assign(new Error("A verified email address is required."), {
      status: 403,
    });
  }

  const email = primaryEmail.emailAddress.trim().toLowerCase();
  const trustedBootstrapEmails = (process.env.BOOTSTRAP_ADMIN_EMAIL || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const promoteToSuperAdmin = trustedBootstrapEmails.includes(email);
  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkUserId, clerkUserId),
  });

  if (existing?.status === "disabled") {
    throw Object.assign(new Error("This account has been disabled."), {
      status: 403,
    });
  }

  const values = {
    clerkUserId,
    name: displayName(
      clerkUser.firstName,
      clerkUser.lastName,
      email,
    ).slice(0, 120),
    email,
  };

  if (existing) {
    const [updated] = await db
      .update(usersTable)
      .set({
        ...values,
        ...(promoteToSuperAdmin ? { role: "super_admin" as const } : {}),
      })
      .where(eq(usersTable.id, existing.id))
      .returning();
    return updated;
  }

  try {
    const [created] = await db
      .insert(usersTable)
      .values({
        ...values,
        role: promoteToSuperAdmin ? "super_admin" : "customer",
      })
      .returning();
    return created;
  } catch (error) {
    // Clerk identity and local profile creation can race across requests.
    const raced = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkUserId, clerkUserId),
    });
    if (raced) return raced;
    throw error;
  }
}

export async function requireAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    res.locals.appUser = await synchronizeUser(userId);
    next();
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number"
        ? error.status
        : 401;
    res.status(status).json({
      error: status === 401 ? "Unable to verify your session." : (error as Error).message,
    });
  }
}

export function requireRoles(...roles: string[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.appUser as User | undefined;
    if (!user) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    if (!adminRoles.has(user.role) || !roles.includes(user.role)) {
      res.status(403).json({ error: "You do not have permission to do that." });
      return;
    }
    next();
  };
}

export function currentUser(res: Response): User {
  const user = res.locals.appUser as User | undefined;
  if (!user) throw new Error("Authenticated user was not loaded.");
  return user;
}

export async function optionalLocalUser(req: Request): Promise<User | null> {
  const userId = getAuth(req).userId;
  if (!userId) return null;
  return (
    (await db.query.usersTable.findFirst({
      where: and(eq(usersTable.clerkUserId, userId), eq(usersTable.status, "active")),
    })) ?? null
  );
}

export function isAdmin(user: User) {
  return adminRoles.has(user.role);
}