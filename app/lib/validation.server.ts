import type {z} from "zod"

const parseFormData = <T extends z.ZodType>(formData: FormData, schema: T) => {
    const raw = Object.fromEntries(formData)
    return schema.safeParse(raw)
}

export {parseFormData}
