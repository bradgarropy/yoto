import {Resend} from "resend"

import {cloudflareContext} from "~/lib/cloudflare-context"
import {isValidOrigin} from "~/lib/security.server"

import type {Route} from "./+types/api.feedback"

const buildFeedbackHtml = ({
    categoryLabel,
    email,
    message,
}: {
    categoryLabel: string
    email: string
    message: string
}) => {
    const escapedMessage = message
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")

    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
    <h2 style="margin: 0 0 20px; font-size: 20px;">${categoryLabel}</h2>
    <div style="border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
        <table style="border-collapse: collapse; width: 100%;">
            <tr>
                <td style="padding: 10px 14px; font-weight: 600; color: #555; background: #f5f5f5; border-bottom: 1px solid #e0e0e0; width: 100px;">Category</td>
                <td style="padding: 10px 14px; background: #f5f5f5; border-bottom: 1px solid #e0e0e0;">${categoryLabel}</td>
            </tr>
            <tr>
                <td style="padding: 10px 14px; font-weight: 600; color: #555; width: 100px;">Email</td>
                <td style="padding: 10px 14px;">${email}</td>
            </tr>
        </table>
    </div>
    <div style="padding: 16px; background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 6px;">
        <p style="margin: 0 0 8px; font-weight: 600; color: #555; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Message</p>
        <p style="margin: 0; white-space: pre-wrap; line-height: 1.5;">${escapedMessage}</p>
    </div>
    <p style="margin: 20px 0 0; font-size: 12px; color: #999;">Sent from Yoto Sync feedback form</p>
</div>`.trim()
}

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

    const text = [
        `Category: ${categoryLabel}`,
        `Email: ${emailValue}`,
        "",
        "Message:",
        messageValue,
    ].join("\n")

    const html = buildFeedbackHtml({
        categoryLabel,
        email: emailValue,
        message: messageValue,
    })

    try {
        const resend = new Resend(env.RESEND_API_KEY)

        await resend.emails.send({
            from: "Yoto Sync <feedback@yoto.bradgarropy.com>",
            to: "bradgarropy@gmail.com",
            subject,
            text,
            html,
        })

        return Response.json({success: true})
    } catch {
        return Response.json(
            {error: "Failed to send feedback. Please try again."},
            {status: 500},
        )
    }
}
