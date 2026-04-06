import {render} from "@react-email/render"
import {Resend} from "resend"

import {FeedbackEmail} from "~/components/FeedbackEmail"
import {cloudflareContext} from "~/lib/cloudflare-context"
import {isValidOrigin} from "~/lib/security.server"

import type {Route} from "./+types/api.feedback"

export async function action({request, context}: Route.ActionArgs) {
    if (!isValidOrigin(request)) {
        return Response.json({error: "Forbidden"}, {status: 403})
    }

    const {env} = context.get(cloudflareContext)

    const formData = await request.formData()
    const category = formData.get("category")
    const message = formData.get("message")
    const email = formData.get("email")

    if (!category || !message) {
        return Response.json(
            {error: "Category and message are required."},
            {status: 400},
        )
    }

    const categoryLabels: Record<string, string> = {
        bug: "Bug Report",
        feature: "Feature Request",
        feedback: "General Feedback",
    }

    const categoryLabel = categoryLabels[String(category)] ?? String(category)
    const emailValue = email ? String(email) : "Not provided"
    const messageValue = String(message)
    const subject = categoryLabels[String(category)] ?? "Feedback"

    try {
        const resend = new Resend(env.RESEND_API_KEY)

        const html = await render(
            <FeedbackEmail
                categoryLabel={categoryLabel}
                email={emailValue}
                message={messageValue}
            />,
        )

        await resend.emails.send({
            from: "Yoto Sync <feedback@yoto.bradgarropy.com>",
            to: "bradgarropy@gmail.com",
            subject,
            html,
        })

        return Response.json({success: true})
    } catch (error) {
        console.error("Failed to send feedback email:", error)

        return Response.json(
            {error: "Failed to send feedback. Please try again."},
            {status: 500},
        )
    }
}
