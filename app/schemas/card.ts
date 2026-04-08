import {z} from "zod"

const updateTitleSchema = z.object({
    title: z.string().trim().min(1, "Card title cannot be empty"),
})

type UpdateTitleData = z.infer<typeof updateTitleSchema>

export {updateTitleSchema}
export type {UpdateTitleData}
