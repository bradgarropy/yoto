import tsconfigPaths from "vite-tsconfig-paths"
import {defineConfig} from "vitest/config"

const config = defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
        setupFiles: ["./app/tests/setup.ts"],
    },
})

export default config
