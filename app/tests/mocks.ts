const createMockEnv = (overrides: Partial<Env> = {}): Env => ({
    YOTO_AUTH_SECRET: "test-secret-key-for-testing",
    RESEND_API_KEY: "test-resend-api-key",
    CF_VERSION_METADATA: {
        id: "test-worker-version",
        tag: "",
        timestamp: "2026-01-01T00:00:00.000Z",
    },
    SANDBOX: {} as Env["SANDBOX"],
    IMPORT_PROGRESS: {} as Env["IMPORT_PROGRESS"],
    IMPORT_WORKFLOW: {} as Env["IMPORT_WORKFLOW"],
    ...overrides,
})

export {createMockEnv}
