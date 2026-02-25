import { z } from "zod";

import { auditFindingSchema } from "./constants";

export const auditReportSchema = z.object({
  auditId: z.string().uuid(),
  projectId: z.string().uuid(),
  revisionId: z.string().uuid(),
  generatedAt: z.string(),
  model: z.object({
    used: z.string().min(1).optional(),
    primary: z.string().min(1),
    fallback: z.string().min(1)
  }),
  summary: z.object({
    overview: z.string().min(1),
    methodology: z.string().min(1),
    scope: z.array(z.string()).min(1),
    severityTotals: z.record(z.string(), z.number().int().nonnegative())
  }),
  findings: z.array(auditFindingSchema),
  appendix: z.object({
    references: z.array(z.string().url()),
    verificationNotes: z.array(z.string())
  })
});

export type AuditReport = z.infer<typeof auditReportSchema>;
