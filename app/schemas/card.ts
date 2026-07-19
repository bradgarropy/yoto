import {z} from "zod"

const updateTitleSchema = z.object({
    title: z.string().trim().min(1, "Card title cannot be empty"),
})

const trackKeysSchema = z
    .array(z.string().min(1))
    .min(1, "Select at least one track")
    .refine(trackKeys => new Set(trackKeys).size === trackKeys.length, {
        message: "Track keys must be unique",
    })

type UpdateTitleData = z.infer<typeof updateTitleSchema>

export {trackKeysSchema, updateTitleSchema}
export type {UpdateTitleData}
