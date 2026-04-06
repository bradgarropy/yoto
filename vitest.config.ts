import tsconfigPaths from "vite-tsconfig-paths"
import {defineConfig} from "vitest/config"

const config = defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
    },
})

export default config
