const isValidOrigin = (request: Request): boolean => {
    const origin = request.headers.get("Origin")

    if (!origin) {
        return false
    }

    try {
        const url = new URL(request.url)
        return new URL(origin).origin === url.origin
    } catch {
        return false
    }
}

export {isValidOrigin}
