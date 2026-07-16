async function deriveKey(secret: string): Promise<CryptoKey> {
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(secret),
    )
    return crypto.subtle.importKey("raw", keyMaterial, "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ])
}

async function encrypt(data: string, secret: string): Promise<string> {
    const key = await deriveKey(secret)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoded = new TextEncoder().encode(data)
    const ciphertext = await crypto.subtle.encrypt(
        {name: "AES-GCM", iv},
        key,
        encoded,
    )

    const combined = new Uint8Array(iv.length + ciphertext.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(ciphertext), iv.length)
    return btoa(String.fromCharCode(...combined))
}

async function decrypt(encrypted: string, secret: string): Promise<string> {
    const key = await deriveKey(secret)
    const combined = Uint8Array.from(atob(encrypted), character =>
        character.charCodeAt(0),
    )
    const iv = combined.slice(0, 12)
    const ciphertext = combined.slice(12)
    const decrypted = await crypto.subtle.decrypt(
        {name: "AES-GCM", iv},
        key,
        ciphertext,
    )
    return new TextDecoder().decode(decrypted)
}

export {decrypt, encrypt}
