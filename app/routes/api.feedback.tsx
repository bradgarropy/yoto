import {render} from "@react-email/render"
import {Resend} from "resend"
import {z} from "zod"

import {FeedbackEmail} from "~/components/FeedbackEmail"
import {cloudflareContext} from "~/lib/cloudflare-context"
import {logger} from "~/lib/logger.server"
import {isValidOrigin} from "~/lib/security.server"
import {parseFormData} from "~/lib/validation.server"
import {feedbackSchema} from "~/schemas/feedback"

import type {Route} from "./+types/api.feedback"

type FeedbackResponse =
    | {success: true}
    | {error: string}
    | {errors: Record<string, string[]>}

const categoryLabels: Record<string, string> = {
    bug: "Bug Report",
    feature: "Feature Request",
    feedback: "General Feedback",
}

export async function action({request, context}: Route.ActionArgs) {
    if (!isValidOrigin(request)) {
        return Response.json({error: "Forbidden"}, {status: 403})
    }

    const {env} = context.get(cloudflareContext)

    const formData = await request.formData()
    const result = parseFormData(formData, feedbackSchema)

    if (!result.success) {
        const {fieldErrors} = z.flattenError(result.error)
        return Response.json({errors: fieldErrors}, {status: 400})
    }

    const {category, message, email} = result.data
    const categoryLabel = categoryLabels[category]
    const emailValue = email ?? "Not provided"
    const subject = categoryLabel

    try {
        const resend = new Resend(env.RESEND_API_KEY)

        const html = await render(
            <FeedbackEmail
                categoryLabel={categoryLabel}
                email={emailValue}
                message={message}
            />,
        )

        await resend.emails.send({
            from: "Yoto Sync <feedback@yoto.bradgarropy.com>",
            to: "bradgarropy@gmail.com",
            replyTo: email,
            subject,
            html,
        })

        return Response.json({success: true})
    } catch (error) {
        logger.error({
            message: "feedback.email.send_failed",
            error,
        })

        return Response.json(
            {error: "Failed to send feedback. Please try again."},
            {status: 500},
        )
    }
}

export type {FeedbackResponse}
