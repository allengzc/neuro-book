import {z} from "zod";

/**
 * retrieval profile 输入结构。
 */
export const RetrievalInputSchema = z.object({
    targetProfile: z.string().trim().min(1).describe("Target profile key that will consume the retrieved context."),
    task: z.string().trim().min(1).describe("Task description for this retrieval run."),
    prompt: z.string().trim().min(1).describe("User prompt or instruction that needs context."),
    chapterOutline: z.string().trim().min(1).optional().describe("Optional chapter outline or planned scene beats."),
    recentText: z.string().trim().min(1).optional().describe("Optional recent chapter text or nearby manuscript context."),
    constraints: z.array(z.string().trim().min(1)).optional().describe("Optional retrieval constraints."),
    maxEntries: z.number().int().positive().max(20).optional().describe("Maximum number of entries to return."),
});

/**
 * retrieval profile 输出结构。
 */
export const RetrievalOutputSchema = z.array(
    z.string().trim().min(1),
).describe("Ordered workspace content node paths selected by retrieval.");

export type RetrievalProfileInput = z.infer<typeof RetrievalInputSchema>;
export type RetrievalProfileOutput = z.infer<typeof RetrievalOutputSchema>;
