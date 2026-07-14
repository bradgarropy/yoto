const createMockEnv = (overrides: Partial<Env> = {}): Env => ({
    YOTO_AUTH_SECRET: "test-secret-key-for-testing",
    RESEND_API_KEY: "test-resend-api-key",
    SANDBOX: {} as Env["SANDBOX"],
    UPLOAD_WORKFLOW: {} as Env["UPLOAD_WORKFLOW"],
    ...overrides,
})

export {createMockEnv}
