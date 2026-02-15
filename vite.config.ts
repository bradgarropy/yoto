import {cloudflare} from "@cloudflare/vite-plugin"
import {reactRouter} from "@react-router/dev/vite"
import tailwindcss from "@tailwindcss/vite"
import {defineConfig} from "vite"
import devtoolsJson from "vite-plugin-devtools-json"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
    plugins: [
        tailwindcss(),
        reactRouter(),
        cloudflare({viteEnvironment: {name: "ssr"}}),
        tsconfigPaths(),
        devtoolsJson(),
    ],
    server: {
        port: 3000,
    },
})
