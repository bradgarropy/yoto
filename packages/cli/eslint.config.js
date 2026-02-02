import bradgarropy from "@bradgarropy/eslint-config"
import {defineConfig} from "eslint/config"

export default defineConfig([
    ...bradgarropy,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: [
                        "eslint.config.js",
                        "vitest.config.ts",
                    ],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
])
