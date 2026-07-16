import {describe, expect, it} from "vitest"

import {createMockEnv} from "~/tests/mocks"

import {
    createImportCredential,
    readImportCredential,
} from "./import-credential.server"

describe("import credential", () => {
    it("encrypts and decrypts an access token", async () => {
        const env = createMockEnv()
        const accessToken = "test-access-token"

        const credential = await createImportCredential(accessToken, env)

        expect(credential).not.toContain(accessToken)
        await expect(readImportCredential(credential, env)).resolves.toBe(
            accessToken,
        )
    })

    it("rejects a credential encrypted with another secret", async () => {
        const credential = await createImportCredential(
            "test-access-token",
            createMockEnv(),
        )
        const otherEnv = createMockEnv({YOTO_AUTH_SECRET: "other-secret"})

        await expect(
            readImportCredential(credential, otherEnv),
        ).rejects.toThrow()
    })
})
