interface FeedbackEmailProps {
    categoryLabel: string
    email: string
    message: string
}

const FeedbackEmail = ({categoryLabel, email, message}: FeedbackEmailProps) => {
    return (
        <div
            style={{
                fontFamily:
                    "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                maxWidth: 600,
                margin: "0 auto",
                color: "#1a1a1a",
            }}
        >
            <h2 style={{margin: "0 0 20px", fontSize: 20}}>{categoryLabel}</h2>

            <div
                style={{
                    border: "1px solid #e0e0e0",
                    borderRadius: 8,
                    overflow: "hidden",
                    marginBottom: 20,
                }}
            >
                <table
                    style={{
                        borderCollapse: "collapse",
                        width: "100%",
                    }}
                >
                    <thead>
                        <tr>
                            <th
                                style={{
                                    padding: "10px 14px",
                                    fontWeight: 600,
                                    color: "#555",
                                    background: "#f5f5f5",
                                    borderBottom: "1px solid #e0e0e0",
                                    textAlign: "left",
                                    width: "50%",
                                }}
                            >
                                Category
                            </th>

                            <th
                                style={{
                                    padding: "10px 14px",
                                    fontWeight: 600,
                                    color: "#555",
                                    background: "#f5f5f5",
                                    borderBottom: "1px solid #e0e0e0",
                                    textAlign: "left",
                                    width: "50%",
                                }}
                            >
                                Email
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        <tr>
                            <td style={{padding: "10px 14px"}}>
                                {categoryLabel}
                            </td>

                            <td style={{padding: "10px 14px"}}>{email}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div
                style={{
                    padding: 16,
                    border: "1px solid #e0e0e0",
                    borderRadius: 6,
                }}
            >
                <p
                    style={{
                        margin: "0 0 8px",
                        fontWeight: 600,
                        color: "#555",
                        fontSize: 13,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                    }}
                >
                    Message
                </p>

                <p
                    style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        lineHeight: 1.5,
                    }}
                >
                    {message}
                </p>
            </div>

            <p style={{margin: "20px 0 0", fontSize: 12, color: "#999"}}>
                Sent from Yoto Sync feedback form
            </p>
        </div>
    )
}

export {FeedbackEmail}
