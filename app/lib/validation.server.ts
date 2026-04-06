import type {ZodType} from "zod"

const parseFormData = <T extends ZodType>(formData: FormData, schema: T) => {
    const raw = Object.fromEntries(formData)
    return schema.safeParse(raw)
}

export {parseFormData}
