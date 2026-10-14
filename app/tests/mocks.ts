const createMockEnv = (overrides: Partial<Env> = {}): Env => ({
    YOTO_CLIENT_ID: "tpc_nbBiRwSYohrNKK15CDemgw",
    YOTO_AUTH_SECRET: "test-secret-key-for-testing",
    RESEND_API_KEY: "test-resend-api-key",
    SANDBOX: {} as Env["SANDBOX"],
    IMPORT_PROGRESS: {} as Env["IMPORT_PROGRESS"],
    IMPORT_WORKFLOW: {} as Env["IMPORT_WORKFLOW"],
    ...overrides,
})

export {createMockEnv}
