import {z} from "zod"

const importSearchParamsSchema = z.object({
    url: z
        .string({error: "Missing url parameter"})
        .trim()
        .min(1, "Missing url parameter")
        .pipe(z.url("Invalid url parameter")),
    splitByChapters: z
        .enum(["true", "false"], {
            error: "Invalid splitByChapters parameter",
        })
        .default("false")
        .transform(value => value === "true"),
})

type ImportSearchParams = z.infer<typeof importSearchParamsSchema>

export {importSearchParamsSchema}
export type {ImportSearchParams}
