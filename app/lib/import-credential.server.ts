import {decrypt, encrypt} from "./encryption.server"

function getSecret(env: Env): string {
    const secret = env.YOTO_AUTH_SECRET
    if (!secret) {
        throw new Error("YOTO_AUTH_SECRET environment variable is required")
    }
    return secret
}

async function createImportCredential(
    accessToken: string,
    env: Env,
): Promise<string> {
    return encrypt(accessToken, getSecret(env))
}

async function readImportCredential(
    credential: string,
    env: Env,
): Promise<string> {
    return decrypt(credential, getSecret(env))
}

export {createImportCredential, readImportCredential}
