import {describe, expect, it} from "vitest"
import {z} from "zod"

import {parseFormData} from "./validation.server"

const testSchema = z.object({
    name: z.string().min(1, "Name is required"),
    age: z.string(),
})

const createFormData = (fields: Record<string, string>) => {
    const formData = new FormData()

    for (const [key, value] of Object.entries(fields)) {
        formData.set(key, value)
    }

    return formData
}

describe("parseFormData", () => {
    it("should return success with typed data for valid input", () => {
        const formData = createFormData({name: "Brad", age: "30"})
        const result = parseFormData(formData, testSchema)

        expect(result.success).toBe(true)
        expect(result.data).toEqual({name: "Brad", age: "30"})
    })

    it("should return error for missing required fields", () => {
        const formData = createFormData({age: "30"})
        const result = parseFormData(formData, testSchema)

        expect(result.success).toBe(false)

        const {fieldErrors} = z.flattenError(result.error!)
        expect(fieldErrors.name).toBeDefined()
    })

    it("should return error for invalid field values", () => {
        const formData = createFormData({name: "", age: "30"})
        const result = parseFormData(formData, testSchema)

        expect(result.success).toBe(false)

        const {fieldErrors} = z.flattenError(result.error!)
        expect(fieldErrors.name?.[0]).toBe("Name is required")
    })

    it("should return multiple errors for multiple invalid fields", () => {
        const strictSchema = z.object({
            name: z.string().min(1, "Name is required"),
            email: z.email("Invalid email"),
        })

        const formData = createFormData({name: "", email: "not-an-email"})
        const result = parseFormData(formData, strictSchema)

        expect(result.success).toBe(false)

        const {fieldErrors} = z.flattenError(result.error!)
        expect(fieldErrors.name).toBeDefined()
        expect(fieldErrors.email).toBeDefined()
    })
})
