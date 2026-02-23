import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./auth";

export async function getServerSession() {
  return auth.api.getSession({
    headers: await headers()
  });
}

export async function requireServerSession() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect("/");
  }
  return session;
}
