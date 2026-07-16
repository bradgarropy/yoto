import {DurableObject} from "cloudflare:workers"

import type {ImportStreamEvent, ImportSuccess} from "~/lib/import"
import type {ImportProgress as ImportProgressState} from "~/lib/import-utils"

type Subscriber = {
    controller: ReadableStreamDefaultController<Uint8Array>
    importId: string
}

class ImportProgress extends DurableObject<Env> {
    private subscribers = new Set<Subscriber>()
    private encoder = new TextEncoder()

    async reportProgress(progress: ImportProgressState): Promise<void> {
        await this.publish({type: "progress", ...progress})
    }

    async reportComplete(result: ImportSuccess): Promise<void> {
        await this.publish({
            type: "complete",
            success: true,
            message: result.message,
            added: result.added,
            skipped: result.skipped,
        })
    }

    async reportError(error: string): Promise<void> {
        await this.publish({type: "error", error})
    }

    async fetch(request: Request): Promise<Response> {
        const importId = request.headers.get("X-Import-Id")
        if (!importId) {
            return new Response("Missing import ID", {status: 400})
        }

        const latestEvent =
            await this.ctx.storage.get<ImportStreamEvent>("event")
        let subscriber: Subscriber | undefined

        const stream = new ReadableStream<Uint8Array>({
            start: controller => {
                subscriber = {controller, importId}
                this.subscribers.add(subscriber)
                this.enqueue(subscriber, {type: "started", importId})

                if (latestEvent) {
                    this.enqueue(subscriber, latestEvent)
                    if (this.isTerminal(latestEvent)) {
                        controller.close()
                        this.subscribers.delete(subscriber)
                    }
                }
            },
            cancel: () => {
                if (subscriber) {
                    this.subscribers.delete(subscriber)
                }
            },
        })

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        })
    }

    private async publish(event: ImportStreamEvent): Promise<void> {
        await this.ctx.storage.put("event", event)

        for (const subscriber of this.subscribers) {
            try {
                this.enqueue(subscriber, event)
                if (this.isTerminal(event)) {
                    subscriber.controller.close()
                    this.subscribers.delete(subscriber)
                }
            } catch {
                this.subscribers.delete(subscriber)
            }
        }
    }

    private enqueue(
        subscriber: Subscriber,
        event: ImportStreamEvent | {type: "started"; importId: string},
    ): void {
        subscriber.controller.enqueue(
            this.encoder.encode(
                `id: ${subscriber.importId}\n` +
                    `data: ${JSON.stringify(event)}\n\n`,
            ),
        )
    }

    private isTerminal(event: ImportStreamEvent): boolean {
        return event.type === "complete" || event.type === "error"
    }
}

export {ImportProgress}
