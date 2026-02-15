import bradgarropy from "@bradgarropy/eslint-config"
import {defineConfig} from "eslint/config"

export default defineConfig([
    ...bradgarropy,
    {
        ignores: [".react-router/", "worker-configuration.d.ts"],
    },
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ["eslint.config.js"],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
])
