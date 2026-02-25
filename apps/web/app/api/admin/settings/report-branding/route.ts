import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { reportBrandingSchema, systemSettings } from "@ton-audit/shared";

import { parseJsonBody, requireAdminSession, toApiErrorResponse } from "@/lib/server/api";
import { db } from "@/lib/server/db";

const PDF_BRANDING_SETTING_KEY = "pdf_report_branding";

export async function GET(request: Request) {
  try {
    await requireAdminSession(request);

    const existing = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, PDF_BRANDING_SETTING_KEY)
    });

    const branding = reportBrandingSchema.parse(
      (existing?.value as Record<string, unknown> | undefined) ?? {}
    );

    return NextResponse.json({
      key: PDF_BRANDING_SETTING_KEY,
      branding,
      updatedAt: existing?.updatedAt?.toISOString() ?? null
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdminSession(request);

    const branding = await parseJsonBody(request, reportBrandingSchema);

    const [updated] = await db
      .insert(systemSettings)
      .values({
        key: PDF_BRANDING_SETTING_KEY,
        value: branding,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          value: branding,
          updatedAt: new Date()
        }
      })
      .returning();

    return NextResponse.json({
      key: PDF_BRANDING_SETTING_KEY,
      branding: reportBrandingSchema.parse(
        (updated?.value as Record<string, unknown> | undefined) ?? branding
      ),
      updatedAt: updated?.updatedAt?.toISOString() ?? new Date().toISOString()
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
