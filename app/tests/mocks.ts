const createMockEnv = (overrides: Partial<Env> = {}): Env => ({
    YOTO_AUTH_SECRET: "test-secret-key-for-testing",
    RESEND_API_KEY: "test-resend-api-key",
    SANDBOX: {} as Env["SANDBOX"],
    IMPORT_WORKFLOW: {} as Env["IMPORT_WORKFLOW"],
    ...overrides,
})

export {createMockEnv}
