import {z} from "zod"

const feedbackSchema = z.object({
    category: z.enum(["bug", "feature", "feedback"]),
    message: z
        .string()
        .trim()
        .min(1, "Message is required")
        .max(5000, "Message is too long"),
    email: z.email("Invalid email address").optional(),
})

type FeedbackData = z.infer<typeof feedbackSchema>

export {feedbackSchema}
export type {FeedbackData}
