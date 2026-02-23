import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/server/auth";

export const { GET, POST, PUT, PATCH, DELETE } = toNextJsHandler(auth);