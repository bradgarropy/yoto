import {defineConfig} from "vitest/config"

const config = defineConfig({
    test: {
        globals: true,
    },
    resolve: {
        alias: {
            "~": new URL("./src", import.meta.url).pathname,
        },
    },
})

export default config
